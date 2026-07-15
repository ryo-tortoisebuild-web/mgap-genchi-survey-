/* 状態管理・IndexedDB自動保存（複数物件対応）・JSONエクスポート/インポート
   IndexedDBのキー構成：
     prj_xxx        … 物件ごとのドキュメント（project/elements/drawings）
     projectIndex   … 物件一覧用の軽量インデックス {id: {id,name,updatedAt,elementCount,drawingCount}}
     lastOpenedId   … 最後に開いていた物件ID
     current        … 旧・単一物件時代のキー（初回起動時に物件として自動移行） */
window.App = window.App || {};

(function () {
  var DB_NAME = 'genchi-survey';
  var STORE_NAME = 'app';
  var APP_ID = 'genchi-survey';
  var SCHEMA_VERSION = 1;
  var INDEX_KEY = 'projectIndex';
  var LAST_KEY = 'lastOpenedId';
  var LEGACY_KEY = 'current';

  /* ---- イベント（簡易pub/sub） ---- */
  var listeners = {};
  App.events = {
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, data) {
      (listeners[ev] || []).forEach(function (fn) { fn(data); });
    },
  };

  /* ---- 画像の表示元 ----
     ローカルで撮影した写真は dataUrl（Base64・即時表示・オフライン可）を持つ。
     他端末で登録されサーバー経由で来た写真は url（サーバー上のファイル）を持つ。
     表示側は必ずこのヘルパー経由で src を取る（dataUrl優先→url） */
  App.photoSrc = function (p) { return (p && (p.dataUrl || p.url)) || ''; };
  App.bgSrc = function (bg) { return (bg && (bg.dataUrl || bg.url)) || ''; };

  /* ---- ID生成 ---- */
  App.uid = function (prefix) {
    var body = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
    return prefix + '_' + body;
  };

  /* ---- IndexedDB ---- */
  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB未対応')); return; }
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(STORE_NAME);
      };
      rq.onsuccess = function (e) { resolve(e.target.result); };
      rq.onerror = function () { reject(rq.error); };
    });
    return dbPromise;
  }

  function idbPut(value, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var rq = tx.objectStore(STORE_NAME).get(key);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error); };
      });
    });
  }

  function idbDel(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ---- ドキュメント ---- */
  function newDoc(name) {
    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      project: {
        id: App.uid('prj'),
        name: name || '新規物件',
        address: '',
        surveyDate: new Date().toISOString().slice(0, 10),
        surveyor: '',
        memo: '',
        updatedAt: new Date().toISOString(),
      },
      elements: [],
      drawings: [],
    };
  }

  /* 旧データ・旧JSONとの互換性維持のためのフィールド補完。
     - 背景画像：位置(x,y)・拡縮(scale)・実寸(naturalW/H)
     - 写真：職人別書き込みレイヤー annotations（photoId × 職人タグ）
     - project.assignees：依頼先（職人タグ）リスト。無ければ使用中タグから生成 */
  function normalizeDoc(doc) {
    (doc.drawings || []).forEach(function (dw) {
      var bg = dw.background = dw.background || {};
      if (bg.opacity == null) bg.opacity = 0.35;
      if (bg.x == null) bg.x = 0;
      if (bg.y == null) bg.y = 0;
      if (bg.scale == null) bg.scale = 1;
      if (bg.naturalW == null) bg.naturalW = 0;
      if (bg.naturalH == null) bg.naturalH = 0;
      if (!Array.isArray(dw.strokes)) dw.strokes = [];
      if (!Array.isArray(dw.dims)) dw.dims = [];
      if (!Array.isArray(dw.annotations)) dw.annotations = [];
      if (!Array.isArray(dw.pins)) dw.pins = [];
    });

    var usedTrades = {};
    (doc.elements || []).forEach(function (el) {
      (el.trades || []).forEach(function (t) { usedTrades[t] = true; });
      (el.photos || []).forEach(function (p) {
        if (!p.annotations || typeof p.annotations !== 'object') p.annotations = {};
        if (!Array.isArray(p.excludedFor)) p.excludedFor = [];
      });
    });

    if (!Array.isArray(doc.project.assignees)) {
      /* 既存物件は使われている職人タグを依頼先として自動生成（定義順を維持） */
      doc.project.assignees = App.TRADES
        .map(function (t) { return t.key; })
        .filter(function (k) { return usedTrades[k]; });
    }
    return doc;
  }

  App.state = null;

  /* ---- 物件インデックス（一覧表示用の軽量データ。写真は含まない） ---- */
  var projectIndex = {};

  function indexEntry(doc) {
    return {
      id: doc.project.id,
      name: doc.project.name,
      updatedAt: doc.project.updatedAt || new Date().toISOString(),
      elementCount: doc.elements.length,
      drawingCount: doc.drawings.length,
    };
  }

  function sortedIndex() {
    return Object.keys(projectIndex).map(function (k) { return projectIndex[k]; })
      .sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  }

  /* ---- 保存 ---- */
  var saveTimer = null;
  var saveFailed = false;

  function persist(doc) {
    doc.project.updatedAt = new Date().toISOString();
    projectIndex[doc.project.id] = indexEntry(doc);
    return idbPut(doc, doc.project.id).then(function () {
      return idbPut(projectIndex, INDEX_KEY);
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persist(App.state).then(function () {
        saveFailed = false;
      }).catch(function () {
        if (!saveFailed) {
          saveFailed = true;
          App.ui.toast('⚠ 自動保存に失敗しました。必ずJSONを書き出してください', 6000);
        }
      });
    }, 500);
  }

  /* 保留中の自動保存を即時確定（物件切替の前に呼ぶ） */
  function saveNow() {
    if (saveTimer === null) return Promise.resolve();
    clearTimeout(saveTimer);
    saveTimer = null;
    return persist(App.state).catch(function () { /* 失敗はscheduleSave側で通知済みの想定 */ });
  }

  /* 指定IDの物件を読み込んでカレントにする（保存はしない） */
  function loadProject(id) {
    return idbGet(id).then(function (doc) {
      if (!doc || doc.app !== APP_ID) throw new Error('物件データを読み込めませんでした');
      App.state = normalizeDoc(doc);
      idbPut(id, LAST_KEY).catch(function () {});
      App.events.emit('change');
    });
  }

  App.store = {
    init: function () {
      return idbGet(INDEX_KEY).then(function (idx) {
        projectIndex = (idx && typeof idx === 'object') ? idx : {};
        /* 旧・単一物件データ（currentキー）があれば物件として移行 */
        return idbGet(LEGACY_KEY).then(function (legacy) {
          if (!legacy || legacy.app !== APP_ID) return null;
          projectIndex[legacy.project.id] = indexEntry(legacy);
          return idbPut(legacy, legacy.project.id)
            .then(function () { return idbPut(projectIndex, INDEX_KEY); })
            .then(function () { return idbDel(LEGACY_KEY); })
            .then(function () { return legacy.project.id; });
        });
      }).then(function (migratedId) {
        return idbGet(LAST_KEY).then(function (lastId) {
          var id = null;
          if (lastId && projectIndex[lastId]) id = lastId;
          else if (migratedId) id = migratedId;
          else {
            var list = sortedIndex();
            if (list.length) id = list[0].id;
          }
          if (id) return idbGet(id);
          return null;
        });
      }).then(function (doc) {
        if (doc && doc.app === APP_ID) {
          App.state = normalizeDoc(doc);
        } else {
          App.state = newDoc();
        }
        idbPut(App.state.project.id, LAST_KEY).catch(function () {});
      }).catch(function () {
        App.state = newDoc();
        projectIndex = {};
        App.ui.toast('⚠ 自動保存が使えない環境です。JSON書き出しで保存してください', 6000);
      });
    },

    /* 変更確定：自動保存＋再描画イベント */
    commit: function () {
      if (App.state) {
        /* 一覧表示用インデックスは即時更新（保存自体はdebounce） */
        projectIndex[App.state.project.id] = indexEntry(App.state);
      }
      scheduleSave();
      App.events.emit('change');
    },

    saveNow: saveNow,

    /* ---- 物件 ---- */
    listProjects: sortedIndex,

    currentProjectId: function () {
      return App.state ? App.state.project.id : null;
    },

    newProject: function (name) {
      return saveNow().then(function () {
        App.state = newDoc(name);
        idbPut(App.state.project.id, LAST_KEY).catch(function () {});
        App.events.emit('change');
        return persist(App.state);
      });
    },

    openProject: function (id) {
      if (App.state && App.state.project.id === id) return Promise.resolve();
      return saveNow().then(function () { return loadProject(id); });
    },

    deleteProject: function (id) {
      delete projectIndex[id];
      var wasCurrent = App.state && App.state.project.id === id;
      if (wasCurrent) {
        /* カレント削除時はsaveNowしない（消した物件を保存し直さないため） */
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      return idbDel(id).then(function () {
        return idbPut(projectIndex, INDEX_KEY);
      }).then(function () {
        if (!wasCurrent) return;
        var list = sortedIndex();
        if (list.length) return loadProject(list[0].id);
        App.state = newDoc();
        idbPut(App.state.project.id, LAST_KEY).catch(function () {});
        App.events.emit('change');
        return persist(App.state);
      });
    },

    /* ---- 要素 ---- */
    addElement: function (data) {
      var now = new Date().toISOString();
      var el = Object.assign({
        id: App.uid('el'),
        category: 'equipment',
        label: '',
        locationText: '',
        dimensions: { w: null, d: null, h: null, measureType: 'uchinori' },
        trades: [],
        visible: true,
        condition: '残置',
        conditionNote: '',
        note: '',
        instruction: '',
        photos: [],
        createdAt: now,
        updatedAt: now,
      }, data);
      App.state.elements.push(el);
      App.store.commit();
      return el;
    },

    updateElement: function (id, data) {
      var el = App.store.getElement(id);
      if (!el) return null;
      Object.assign(el, data, { updatedAt: new Date().toISOString() });
      App.store.commit();
      return el;
    },

    deleteElement: function (id) {
      App.state.elements = App.state.elements.filter(function (e) { return e.id !== id; });
      App.state.drawings.forEach(function (d) {
        d.pins = d.pins.filter(function (p) { return p.elementId !== id; });
      });
      App.store.commit();
    },

    getElement: function (id) {
      return App.state.elements.find(function (e) { return e.id === id; }) || null;
    },

    /* ---- 図面 ---- */
    addDrawing: function (type, title) {
      var dw = {
        id: App.uid('dw'),
        type: type,
        title: title || App.drawingTypeLabel(type),
        canvas: { width: 1600, height: 1200 },
        background: { dataUrl: null, opacity: 0.35, x: 0, y: 0, scale: 1, naturalW: 0, naturalH: 0 },
        strokes: [],
        dims: [],
        annotations: [],
        pins: [],
      };
      App.state.drawings.push(dw);
      App.store.commit();
      return dw;
    },

    deleteDrawing: function (id) {
      App.state.drawings = App.state.drawings.filter(function (d) { return d.id !== id; });
      App.store.commit();
    },

    getDrawing: function (id) {
      return App.state.drawings.find(function (d) { return d.id === id; }) || null;
    },

    /* 要素が置かれている図面のピン情報一覧 */
    pinsOfElement: function (elementId) {
      var out = [];
      App.state.drawings.forEach(function (d) {
        d.pins.forEach(function (p) {
          if (p.elementId === elementId) out.push({ drawing: d, pin: p });
        });
      });
      return out;
    },

    /* 撮影ポイントの番号＝一覧（elements配列）の並び順。①②③…はここが唯一の基準。
       間取りピン・情報カード・依頼先・出力すべてこの番号を使う */
    pointNumber: function (elementId) {
      var i = App.state.elements.findIndex(function (e) { return e.id === elementId; });
      return i === -1 ? null : i + 1;
    },
    isPlaced: function (elementId) {
      return App.store.pinsOfElement(elementId).length > 0;
    },

    /* 撮影ポイントを1つ上(dir=-1)／下(dir=+1)へ入れ替え。番号は並び順から自動再計算 */
    moveElement: function (elementId, dir) {
      var arr = App.state.elements;
      var i = arr.findIndex(function (e) { return e.id === elementId; });
      if (i === -1) return false;
      var j = i + dir;
      if (j < 0 || j >= arr.length) return false;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      App.store.commit();
      return true;
    },

    /* 旧API互換：配置済みなら番号、未配置は null（既存呼び出し向け） */
    pinNumOf: function (elementId) {
      return App.store.isPlaced(elementId) ? App.store.pointNumber(elementId) : null;
    },

    /* ---- 写真 ---- */
    getPhoto: function (photoId) {
      var els = App.state.elements;
      for (var i = 0; i < els.length; i++) {
        var ps = els[i].photos;
        for (var j = 0; j < ps.length; j++) {
          if (ps[j].id === photoId) return { photo: ps[j], element: els[i] };
        }
      }
      return null;
    },

    /* photo × 職人タグ の書き込みレイヤー（配列）。無ければ生成 */
    annotationsOf: function (photo, trade) {
      if (!photo.annotations) photo.annotations = {};
      if (!Array.isArray(photo.annotations[trade])) photo.annotations[trade] = [];
      return photo.annotations[trade];
    },

    /* photo × 職人タグ の「対象外」フラグ（職人ごと独立・写真は複製しない） */
    isPhotoExcluded: function (photo, trade) {
      return (photo.excludedFor || []).indexOf(trade) !== -1;
    },
    togglePhotoExcluded: function (photo, trade) {
      if (!Array.isArray(photo.excludedFor)) photo.excludedFor = [];
      var i = photo.excludedFor.indexOf(trade);
      if (i === -1) photo.excludedFor.push(trade); else photo.excludedFor.splice(i, 1);
      App.store.commit();
      return i === -1; /* trueなら対象外にした */
    },
    /* 指定職人にとって出力対象の写真だけ返す */
    photosForTrade: function (el, trade) {
      return (el.photos || []).filter(function (p) { return (p.excludedFor || []).indexOf(trade) === -1; });
    },

    /* ---- 依頼先（職人タグ） ---- */
    assignees: function () {
      return (App.state.project.assignees || []).slice();
    },

    addAssignee: function (trade) {
      var list = App.state.project.assignees || (App.state.project.assignees = []);
      if (list.indexOf(trade) === -1) {
        /* 定義順を維持して挿入 */
        var order = App.TRADES.map(function (t) { return t.key; });
        list.push(trade);
        list.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
        App.store.commit();
      }
    },

    removeAssignee: function (trade) {
      var list = App.state.project.assignees || [];
      App.state.project.assignees = list.filter(function (t) { return t !== trade; });
      App.store.commit();
    },

    /* 指定職人が担当する要素（表示ON・当該タグ保持）を一覧の並び順（新番号順）で返す。
       filterは配列順を保持するため、そのままが①②③…の順 */
    pointsForTrade: function (trade) {
      return App.state.elements.filter(function (el) {
        return el.visible && el.trades.indexOf(trade) !== -1;
      });
    },

    /* ---- JSONエクスポート／インポート ----
       スキーマは従来どおり「1ファイル＝1物件」。互換性維持 */
    exportJSON: function () {
      var doc = Object.assign({}, App.state, { exportedAt: new Date().toISOString() });
      var json = JSON.stringify(doc);
      var sizeMB = json.length / 1024 / 1024;
      var blob = new Blob([json], { type: 'application/json' });
      var name = (App.state.project.name || '物件').replace(/[\\/:*?"<>|\s]+/g, '_');
      var date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '_' + date + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      var msg = 'JSONを書き出しました（' + sizeMB.toFixed(1) + 'MB）';
      if (sizeMB > 10) msg += ' ⚠ サイズが大きめです。写真の枚数にご注意ください';
      App.ui.toast(msg, 5000);
    },

    /* 読み込んだ物件は一覧に「追加」される（他の物件は消えない）。
       同じ物件IDが既にあれば上書き（同じ物件の更新版として扱う） */
    importJSON: function (file) {
      return file.text().then(function (text) {
        var doc = JSON.parse(text);
        if (!doc || doc.app !== APP_ID) {
          throw new Error('このアプリのJSONファイルではありません');
        }
        if (doc.schemaVersion > SCHEMA_VERSION) {
          throw new Error('新しいバージョンのデータです。アプリを更新してください');
        }
        delete doc.exportedAt;
        normalizeDoc(doc);
        return saveNow().then(function () {
          App.state = doc;
          idbPut(doc.project.id, LAST_KEY).catch(function () {});
          App.events.emit('change');
          return persist(doc);
        });
      });
    },
  };

  /* ======================================================================
     サーバー同期サポート（js/sync.js から使用）
     ・doc単位でサーバーに保存／取得する。写真Base64はサーバーには送らずURLで持つ。
     ・updatedAt(サーバー時刻・エポックms)で新旧を判定（最終書き込み優先）。
     ====================================================================== */

  /* 全物件のドキュメントを返す（ログイン直後の一括アップロード用） */
  App.store.getAllDocs = function () {
    var ids = Object.keys(projectIndex);
    return Promise.all(ids.map(function (id) { return idbGet(id); }))
      .then(function (docs) { return docs.filter(function (d) { return d && d.app === APP_ID; }); });
  };

  /* updatedAtを変えずに保存（写真URL付与など、内容変更でない更新用）。再送ループ防止 */
  App.store.persistQuiet = function (doc) {
    doc = doc || App.state;
    if (!doc) return Promise.resolve();
    projectIndex[doc.project.id] = indexEntry(doc);
    return idbPut(doc, doc.project.id).then(function () { return idbPut(projectIndex, INDEX_KEY); });
  };

  /* サーバーから来たドキュメントをローカルへ反映（上書き）。開いている物件なら画面も更新 */
  App.store.applyRemoteDoc = function (doc) {
    if (!doc || doc.app !== APP_ID) return Promise.resolve();
    normalizeDoc(doc);
    projectIndex[doc.project.id] = indexEntry(doc);
    var isCurrent = App.state && App.state.project.id === doc.project.id;
    return idbPut(doc, doc.project.id)
      .then(function () { return idbPut(projectIndex, INDEX_KEY); })
      .then(function () {
        if (isCurrent) App.state = doc;
        App.events.emit('change');
      });
  };

  /* サーバーで削除された物件をローカルからも消す */
  App.store.removeRemoteDoc = function (projectId) {
    if (!projectIndex[projectId]) return Promise.resolve();
    delete projectIndex[projectId];
    var wasCurrent = App.state && App.state.project.id === projectId;
    return idbDel(projectId).then(function () { return idbPut(projectIndex, INDEX_KEY); })
      .then(function () {
        if (!wasCurrent) { App.events.emit('change'); return; }
        var list = sortedIndex();
        if (list.length) return loadProject(list[0].id);
        App.state = newDoc();
        idbPut(App.state.project.id, LAST_KEY).catch(function () {});
        return persist(App.state).then(function () { App.events.emit('change'); });
      });
  };

  /* 同期メタ（物件UID→最後に取り込んだサーバー時刻）。自分の書き込みを再取得しないため */
  App.store.getSyncMeta = function () {
    return idbGet('syncMeta').then(function (m) { return (m && typeof m === 'object') ? m : {}; });
  };
  App.store.setSyncMeta = function (m) { return idbPut(m, 'syncMeta'); };
})();
