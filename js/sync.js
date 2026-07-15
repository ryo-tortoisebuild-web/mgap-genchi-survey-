/* サーバー同期エンジン（ローカル優先＋自動同期）。
   ・保存：変更のたびに現在の物件をサーバーへ送る（写真はファイルとしてアップロードしURL化、Base64はサーバーに送らない）
   ・取得：一定間隔でサーバーの更新を確認し、新しければ取り込む（最終書き込み優先）
   ・オフライン時はローカル(IndexedDB)に保存され、接続回復後に自動で送られる */
window.App = window.App || {};

(function () {
  var running = false;
  var busy = false;
  var pushTimer = null;
  var pollTimer = null;
  var meta = {};          // 物件UID → 最後に取り込んだサーバー時刻(ms)
  var lastPushed = {};    // 物件UID → 最後に送信した時点の updatedAt(ローカルISO)
  var lastError = 0;

  function log() { /* console.debug.apply(console, arguments); */ }

  /* dataURL(JPEG) → Blob */
  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var meta0 = dataUrl.slice(0, comma);
    var mime = (meta0.match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    var bin = atob(dataUrl.slice(comma + 1));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* この物件内で、まだサーバーURLの無いBase64画像を集める（写真＋間取り背景） */
  function pendingUploads(doc) {
    var jobs = [];
    (doc.elements || []).forEach(function (el) {
      (el.photos || []).forEach(function (p) {
        if (p.dataUrl && !p.url) jobs.push({ ref: p, uid: p.id, dataUrl: p.dataUrl });
      });
    });
    (doc.drawings || []).forEach(function (dw) {
      var bg = dw.background;
      if (bg && bg.dataUrl && !bg.url) jobs.push({ ref: bg, uid: 'bg_' + dw.id, dataUrl: bg.dataUrl });
    });
    return jobs;
  }

  /* サーバーへ送るドキュメントを作る（Base64を除去しURLだけ残す） */
  function toServerDoc(doc) {
    var clone = JSON.parse(JSON.stringify(doc));
    (clone.elements || []).forEach(function (el) {
      (el.photos || []).forEach(function (p) { delete p.dataUrl; });
    });
    (clone.drawings || []).forEach(function (dw) {
      if (dw.background) delete dw.background.dataUrl;
    });
    return clone;
  }

  /* 中身が空の新規プレースホルダは同期しない（端末ごとの空「新規物件」乱立を防ぐ） */
  function isEmptyDoc(doc) {
    return (!doc.elements || doc.elements.length === 0) &&
           (!doc.drawings || doc.drawings.length === 0);
  }

  /* 1物件をサーバーへ保存。成功でtrue、未完了(オフライン等)でfalse */
  function pushDoc(doc) {
    if (isEmptyDoc(doc)) return Promise.resolve(true);
    var jobs = pendingUploads(doc);
    var chain = Promise.resolve(true);
    jobs.forEach(function (job) {
      chain = chain.then(function (okSoFar) {
        if (!okSoFar) return false;
        return App.api.uploadPhoto(doc.project.id, job.uid, dataUrlToBlob(job.dataUrl))
          .then(function (r) {
            if (r && r.ok && r.url) { job.ref.url = r.url; return true; }
            return false;   // 1枚でも失敗したら中断（次回リトライ）
          });
      });
    });
    return chain.then(function (uploadsOk) {
      if (!uploadsOk) return false;
      // アップロードで付与したURLをローカルに保存（updatedAtは変えない＝再送ループ防止）
      return App.store.persistQuiet(doc).then(function () {
        var payload = {
          projectUid: doc.project.id,
          name: doc.project.name || '',
          address: doc.project.address || '',
          surveyDate: doc.project.surveyDate || '',
          doc: toServerDoc(doc),
        };
        return App.api.saveProject(payload).then(function (r) {
          if (r && r.ok) {
            meta[doc.project.id] = r.updatedAt;
            lastPushed[doc.project.id] = doc.project.updatedAt;
            return App.store.setSyncMeta(meta).then(function () { return true; });
          }
          return false;
        });
      });
    });
  }

  /* 現在の物件が未送信なら送る */
  function pushCurrentIfDirty() {
    var s = App.state;
    if (!s) return Promise.resolve();
    if (lastPushed[s.project.id] === s.project.updatedAt) return Promise.resolve();
    return pushDoc(s);
  }

  /* サーバー未登録のローカル物件を全部送る（初回ログイン時の移行） */
  function pushLocalNotOnServer(serverUids) {
    return App.store.getAllDocs().then(function (docs) {
      var chain = Promise.resolve();
      docs.forEach(function (doc) {
        if (serverUids.indexOf(doc.project.id) === -1) {
          chain = chain.then(function () { return pushDoc(doc); });
        }
      });
      return chain;
    });
  }

  /* サーバーの一覧を確認し、新しい物件を取り込む／削除を反映する */
  function pullChanges() {
    return App.api.listProjects().then(function (r) {
      if (!r || !r.ok || !r.projects) return { list: [] };
      var chain = Promise.resolve();
      r.projects.forEach(function (row) {
        var uid = row.projectUid;
        var seenTs = meta[uid] || 0;
        if (row.updatedAt <= seenTs) return;  // 既知（自分の送信含む）
        if (row.deleted) {
          chain = chain.then(function () {
            return App.store.removeRemoteDoc(uid).then(function () {
              meta[uid] = row.updatedAt;
              return App.store.setSyncMeta(meta);
            });
          });
        } else {
          chain = chain.then(function () {
            return App.api.getProject(uid).then(function (pr) {
              if (!pr || !pr.ok || !pr.doc) return;
              return App.store.applyRemoteDoc(pr.doc).then(function () {
                meta[uid] = row.updatedAt;
                lastPushed[uid] = pr.doc.project.updatedAt;  // 取り込んだ直後に送り返さない
                return App.store.setSyncMeta(meta);
              });
            });
          });
        }
      });
      return chain.then(function () { return { list: r.projects }; });
    });
  }

  /* 1サイクル：送る→取り込む */
  function syncOnce() {
    if (busy) return Promise.resolve();
    busy = true;
    return pushCurrentIfDirty()
      .then(function () { return pullChanges(); })
      .then(function () { lastError = 0; })
      .catch(function () { lastError++; })
      .then(function () { busy = false; });
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; syncOnce(); }, 1200);
  }

  App.sync = {
    isRunning: function () { return running; },

    /* ログイン成功後に開始 */
    start: function () {
      if (running || !App.api.enabled()) return Promise.resolve();
      running = true;
      return App.store.getSyncMeta().then(function (m) {
        meta = m || {};
        // 初回：サーバー未登録のローカル物件を移行アップロード → 取り込み
        return App.api.listProjects().then(function (r) {
          var uids = (r && r.ok && r.projects) ? r.projects.map(function (p) { return p.projectUid; }) : [];
          return pushLocalNotOnServer(uids);
        }).then(function () {
          return syncOnce();
        }).then(function () {
          clearInterval(pollTimer);
          pollTimer = setInterval(function () {
            if (navigator.onLine !== false) syncOnce();
          }, (App.config.pollIntervalMs || 8000));
          // 変更のたびに送信（デバウンス）
          App.events.on('change', function () { if (running) schedulePush(); });
          // オンライン復帰で即同期
          window.addEventListener('online', function () { if (running) syncOnce(); });
        });
      });
    },

    stop: function () {
      running = false;
      clearInterval(pollTimer);
      clearTimeout(pushTimer);
    },

    /* 明示的に今すぐ同期（「サーバーに取り込む」ボタン等） */
    now: function () { return syncOnce(); },
  };
})();
