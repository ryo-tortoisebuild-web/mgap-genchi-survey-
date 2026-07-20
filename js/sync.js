/* サーバー同期エンジン（ローカル優先＋自動同期）。
   ・保存：変更のたびに現在の物件をサーバーへ送る（写真はファイルとしてアップロードしURL化、Base64はサーバーに送らない）
   ・取得：一定間隔でサーバーの更新を確認し、新しければ取り込む（最終書き込み優先）
   ・毎サイクル、サーバーに無いローカル物件を自動アップロード（初回移行の失敗も自己修復）
   ・オフライン時はローカル(IndexedDB)に保存され、接続回復後に自動で送られる
   ・同期の成否は正直に通知する（成功と失敗で表示を分ける） */
window.App = window.App || {};

(function () {
  var running = false;
  var busy = false;
  var pushTimer = null;
  var pollTimer = null;
  var meta = {};          // 物件UID → 最後に取り込んだサーバー時刻(ms)
  var lastPushed = {};    // 物件UID → 最後に送信した時点の updatedAt(ローカルISO)
  var wasFailing = false; // 直前サイクルが失敗していたか（通知のスパム防止）
  var lastResult = { ok: true, error: null };

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

  function apiErr(r, what) {
    if (r && r.offline) return what + '：サーバーに接続できません';
    return what + '：' + ((r && r.error) || '不明なエラー');
  }

  /* 1物件をサーバーへ保存。resolve({ok, error}) */
  function pushDoc(doc) {
    if (isEmptyDoc(doc)) return Promise.resolve({ ok: true });
    var jobs = pendingUploads(doc);
    var chain = Promise.resolve(null);   // null=エラーなし／文字列=エラー内容
    jobs.forEach(function (job) {
      chain = chain.then(function (err) {
        if (err) return err;             // 1枚でも失敗したら以降は送らない（次回リトライ）
        return App.api.uploadPhoto(doc.project.id, job.uid, dataUrlToBlob(job.dataUrl))
          .then(function (r) {
            if (r && r.ok && r.url) { job.ref.url = r.url; return null; }
            return apiErr(r, '写真の送信に失敗');
          });
      });
    });
    return chain.then(function (err) {
      if (err) return { ok: false, error: err };
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
            return App.store.setSyncMeta(meta).then(function () { return { ok: true }; });
          }
          return { ok: false, error: apiErr(r, '「' + (doc.project.name || '物件') + '」の保存に失敗') };
        });
      });
    });
  }

  /* 現在の物件が未送信なら送る */
  function pushCurrentIfDirty() {
    var s = App.state;
    if (!s || isEmptyDoc(s)) return Promise.resolve({ ok: true });
    if (lastPushed[s.project.id] === s.project.updatedAt) return Promise.resolve({ ok: true });
    return pushDoc(s);
  }

  /* サーバーの一覧を確認し、新しい物件を取り込む／削除を反映する。
     resolve({ok, error, serverUids}) */
  function pullChanges() {
    return App.api.listProjects().then(function (r) {
      if (!r || !r.ok || !r.projects) {
        return { ok: false, error: apiErr(r, '一覧の取得に失敗'), serverUids: null };
      }
      var chain = Promise.resolve();
      r.projects.forEach(function (row) {
        var uid = row.projectUid;
        var seenTs = meta[uid] || 0;
        if (row.updatedAt <= seenTs) return;  // 既知（自分の送信含む）
        if (row.deleted) {
          /* 他端末で削除された → ローカルもゴミ箱へ（実データは残す＝復元できる） */
          chain = chain.then(function () {
            return App.store.markDeletedLocal(uid, row.deletedAt).then(function () {
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
      return chain.then(function () {
        var serverUids = r.projects.map(function (p) { return p.projectUid; });
        /* サーバー側で保管期限切れ→完全削除された物件は、ローカルのゴミ箱からも消す。
           （一度サーバーに載った＝metaに記録がある物件だけを対象にし、
             まだ送信できていないローカル物件を誤って消さない） */
        var gone = App.store.listTrashedProjects().filter(function (t) {
          return serverUids.indexOf(t.id) === -1 && meta[t.id];
        });
        var chain2 = Promise.resolve();
        gone.forEach(function (t) {
          chain2 = chain2.then(function () {
            delete meta[t.id];
            return App.store.dropProjectLocal(t.id);
          });
        });
        return chain2.then(function () { return { ok: true, serverUids: serverUids }; });
      });
    });
  }

  /* サーバーに無いローカル物件を送る（初回移行＋失敗時の自己修復。毎サイクル実行） */
  function pushMissing(serverUids) {
    /* ゴミ箱に入っている物件は送らない（削除したものが復活しないように） */
    var trashed = {};
    App.store.listTrashedProjects().forEach(function (t) { trashed[t.id] = true; });
    return App.store.getAllDocs().then(function (docs) {
      var chain = Promise.resolve({ ok: true });
      docs.forEach(function (doc) {
        if (trashed[doc.project.id]) return;
        if (serverUids.indexOf(doc.project.id) === -1 && !isEmptyDoc(doc)) {
          chain = chain.then(function (res) { return res.ok ? pushDoc(doc) : res; });
        }
      });
      return chain;
    });
  }

  /* 同期結果の通知。手動時は毎回、自動時は「失敗し始めた／回復した」の変わり目だけ表示 */
  function notifyStatus(result, manual) {
    if (manual) {
      if (result.ok) App.ui.toast('✅ 同期しました（サーバー保存済み）', 2500);
      else App.ui.toast('⚠ 同期に失敗しました。' + result.error + '（データは端末内に保存されています）', 7000);
      wasFailing = !result.ok;
      return;
    }
    if (!result.ok && !wasFailing) {
      wasFailing = true;
      App.ui.toast('⚠ サーバー同期に失敗しています。' + result.error + '（データは端末内に保存されています）', 7000);
    } else if (result.ok && wasFailing) {
      wasFailing = false;
      App.ui.toast('✅ サーバー同期が回復しました', 3000);
    }
  }

  /* 1サイクル：送る→取り込む→未送信を補う。resolve({ok, error}) */
  function syncOnce(manual) {
    if (busy) return Promise.resolve(lastResult);
    busy = true;
    var result = { ok: true, error: null };
    return pushCurrentIfDirty()
      .then(function (r) {
        if (!r.ok) result = r;
        return pullChanges();
      })
      .then(function (pr) {
        if (!pr.ok) { if (result.ok) result = { ok: false, error: pr.error }; return null; }
        return pushMissing(pr.serverUids);
      })
      .then(function (mr) {
        if (mr && !mr.ok && result.ok) result = mr;
      })
      .catch(function (e) {
        result = { ok: false, error: '同期処理でエラー（' + (e && e.message ? e.message : e) + '）' };
      })
      .then(function () {
        busy = false;
        lastResult = result;
        notifyStatus(result, manual);
        return result;
      });
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; syncOnce(false); }, 1200);
  }

  App.sync = {
    isRunning: function () { return running; },
    lastResult: function () { return lastResult; },

    /* 物件の削除をサーバーへ伝える（他端末のゴミ箱にも入る） */
    pushDelete: function (projectUid) {
      if (!running) return Promise.resolve({ ok: false });
      return App.api.deleteProject(projectUid).then(function (r) {
        if (r && r.ok) {
          meta[projectUid] = r.updatedAt;
          delete lastPushed[projectUid];
          return App.store.setSyncMeta(meta).then(function () { return { ok: true }; });
        }
        return { ok: false, error: apiErr(r, '削除の同期に失敗') };
      });
    },

    /* 物件の復元をサーバーへ伝える */
    pushRestore: function (projectUid) {
      if (!running) return Promise.resolve({ ok: false });
      return App.api.restoreProject(projectUid).then(function (r) {
        if (r && r.ok) {
          meta[projectUid] = r.updatedAt;
          delete lastPushed[projectUid];
          return App.store.setSyncMeta(meta).then(function () { return { ok: true }; });
        }
        return { ok: false, error: apiErr(r, '復元の同期に失敗') };
      });
    },

    /* ログイン成功後に開始 */
    start: function () {
      if (running || !App.api.enabled()) return Promise.resolve();
      running = true;
      return App.store.getSyncMeta().then(function (m) {
        meta = m || {};
        return syncOnce(false);
      }).then(function () {
        clearInterval(pollTimer);
        pollTimer = setInterval(function () {
          if (navigator.onLine !== false) syncOnce(false);
        }, (App.config.pollIntervalMs || 8000));
        // 変更のたびに送信（デバウンス）
        App.events.on('change', function () { if (running) schedulePush(); });
        // オンライン復帰で即同期
        window.addEventListener('online', function () { if (running) syncOnce(false); });
      });
    },

    stop: function () {
      running = false;
      clearInterval(pollTimer);
      clearTimeout(pushTimer);
    },

    /* 明示的に今すぐ同期（「今すぐ同期」ボタン）。結果は必ずトーストで通知される */
    now: function () { return syncOnce(true); },
  };
})();
