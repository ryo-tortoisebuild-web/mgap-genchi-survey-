/* JSON自動バックアップ。
   ・1日1回、起動時に全物件のJSONスナップショットを自動生成して端末内に保管する
   ・世代を複数持ち、古いものから自動的に整理する
   ・任意の世代をJSONファイルとして書き出せる／その時点の内容に復元できる

   ※写真のBase64は保管しない（端末の保存容量を超えないため）。写真はサーバー上の
     ファイルとして保存されておりURLで参照される。手動の「⬇ JSON書き出し」は
     従来どおり写真も含んだ完全な形で書き出される（用途で使い分け）。
   ※サーバー本体のDBバックアップはエックスサーバー標準機能を使う（重複して作らない）。 */
window.App = window.App || {};

(function () {
  var META_KEY = 'backupMeta';     // { lastAt: ISO }
  var LIST_KEY = 'backups';        // [{ id, createdAt, projectCount, docs:[...] }]
  var INTERVAL_MS = 24 * 60 * 60 * 1000;   // 1日1回
  var KEEP = 10;                   // 保管する世代数
  var overlay = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 写真のBase64を除いたドキュメント（URLは残す） */
  function slim(doc) {
    var c = JSON.parse(JSON.stringify(doc));
    (c.elements || []).forEach(function (el) {
      (el.photos || []).forEach(function (p) { delete p.dataUrl; });
    });
    (c.deletedElements || []).forEach(function (t) {
      ((t.element || {}).photos || []).forEach(function (p) { delete p.dataUrl; });
    });
    (c.drawings || []).forEach(function (dw) { if (dw.background) delete dw.background.dataUrl; });
    return c;
  }

  function approxSizeMB(list) {
    try { return (JSON.stringify(list).length / 1024 / 1024); } catch (e) { return 0; }
  }

  /* スナップショットを1つ作る。resolve({ok, error, snapshot}) */
  function createSnapshot() {
    return App.store.getAllDocs().then(function (docs) {
      var real = docs.filter(function (d) {
        return (d.elements && d.elements.length) || (d.drawings && d.drawings.length);
      });
      if (!real.length) return { ok: false, error: 'バックアップ対象の物件がありません' };
      var snap = {
        id: App.uid('bk'),
        createdAt: new Date().toISOString(),
        projectCount: real.length,
        docs: real.map(slim),
      };
      return App.store.getBackups().then(function (list) {
        list.unshift(snap);
        /* 世代を整理（新しいものからKEEP件だけ残す） */
        while (list.length > KEEP) list.pop();
        /* 念のため容量が大きすぎる場合はさらに古い世代を落とす */
        while (list.length > 1 && approxSizeMB(list) > 40) list.pop();
        return App.store.setBackups(list).then(function () {
          return App.store.setBackupMeta({ lastAt: snap.createdAt }).then(function () {
            return { ok: true, snapshot: snap };
          });
        });
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    });
  }

  /* 前回から24時間以上経っていれば自動でバックアップ */
  function autoRun() {
    return App.store.getBackupMeta().then(function (meta) {
      var last = meta && meta.lastAt ? Date.parse(meta.lastAt) : 0;
      if (last && (Date.now() - last) < INTERVAL_MS) return { ok: true, skipped: true };
      return createSnapshot().then(function (r) {
        if (r.ok) App.ui.toast('💾 自動バックアップを作成しました（' + r.snapshot.projectCount + '件）', 2500);
        return r;
      });
    });
  }

  /* 起動時に呼ぶ。
     起動直後はサーバーからの同期がまだで物件が空のことがあるため、
     一定間隔でも判定し直す（同期でデータが届いた後に確実に1回作られる） */
  var timer = null;
  function start() {
    var kick = function () { return autoRun().catch(function () { /* 本体機能に影響させない */ }); };
    clearInterval(timer);
    timer = setInterval(kick, 10 * 60 * 1000);   // 10分ごとに判定（作成は1日1回まで）
    /* 同期でデータが入った直後にも作れるよう、初回は少し待ってから */
    setTimeout(kick, 15 * 1000);
    return kick();
  }

  /* 1世代をJSONファイルとして書き出す */
  function download(snap) {
    var payload = {
      app: 'genchi-survey',
      backup: true,
      createdAt: snap.createdAt,
      projectCount: snap.projectCount,
      docs: snap.docs,
    };
    var json = JSON.stringify(payload);
    var blob = new Blob([json], { type: 'application/json' });
    var stamp = snap.createdAt.slice(0, 10).replace(/-/g, '');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'genchi_backup_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    App.ui.toast('JSONを書き出しました（' + (json.length / 1024 / 1024).toFixed(1) + 'MB）', 3000);
  }

  /* 1世代の内容をアプリに戻す（今のデータに上書き・追加） */
  function restore(snap) {
    return App.ui.confirm(
      fmt(snap.createdAt) + ' のバックアップ（' + snap.projectCount + '件）を復元しますか？\n' +
      '同じ物件は、この時点の内容で上書きされます。'
    ).then(function (ok) {
      if (!ok) return { ok: false, cancelled: true };
      var chain = Promise.resolve();
      snap.docs.forEach(function (d) {
        chain = chain.then(function () { return App.store.applyRemoteDoc(JSON.parse(JSON.stringify(d))); });
      });
      return chain.then(function () { return { ok: true }; });
    });
  }

  /* ---------------- 画面 ---------------- */
  function render() {
    var box = overlay.querySelector('.modal-box');
    App.store.getBackups().then(function (list) {
      var rows = list.length ? list.map(function (s) {
        return '<div class="trash-row">' +
          '<div class="trash-info">' +
            '<div class="trash-name">' + fmt(s.createdAt) + '</div>' +
            '<div class="muted trash-meta">物件 ' + s.projectCount + '件</div>' +
          '</div>' +
          '<div class="member-actions">' +
            '<button type="button" class="btn btn-small" data-dl="' + s.id + '">JSON書き出し</button>' +
            '<button type="button" class="btn btn-small" data-rs="' + s.id + '">この時点に復元</button>' +
          '</div>' +
        '</div>';
      }).join('') : '<p class="empty-note">バックアップはまだありません</p>';

      box.innerHTML =
        '<h2 class="modal-title">💾 自動バックアップ</h2>' +
        '<p class="muted trash-note">1日1回、起動時に自動でJSONのスナップショットを作成し、最新' + KEEP + '世代を端末内に保管します。' +
          '写真そのものはサーバーに保存されているため、ここには含めていません（容量対策）。' +
          '写真ごと完全に保存したいときは、ヘッダーの「⬇ JSON書き出し」をお使いください。</p>' +
        '<button type="button" class="btn btn-primary btn-block" id="backup-now">今すぐバックアップを作成</button>' +
        '<div class="trash-list">' + rows + '</div>' +
        '<p class="trash-msg" id="backup-msg" hidden></p>' +
        '<div class="modal-actions"><button type="button" class="btn" id="backup-close">閉じる</button></div>';

      bind(list);
    });
  }

  function setMsg(text, isError) {
    var m = overlay.querySelector('#backup-msg');
    if (!m) return;
    if (!text) { m.hidden = true; return; }
    m.hidden = false;
    m.textContent = text;
    m.className = 'trash-msg ' + (isError ? 'is-error' : 'is-ok');
  }

  function bind(list) {
    var box = overlay.querySelector('.modal-box');

    box.querySelector('#backup-close').addEventListener('click', function () {
      App.ui.closeModal(overlay); overlay = null;
    });

    box.querySelector('#backup-now').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      setMsg('作成しています…', false);
      createSnapshot().then(function (r) {
        btn.disabled = false;
        if (r.ok) {
          App.ui.toast('✅ バックアップを作成しました', 2500);
          render();
        } else {
          setMsg('作成できませんでした：' + r.error, true);
        }
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-dl]'), function (b) {
      b.addEventListener('click', function () {
        var s = list.find(function (x) { return x.id === b.getAttribute('data-dl'); });
        if (s) download(s);
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-rs]'), function (b) {
      b.addEventListener('click', function () {
        var s = list.find(function (x) { return x.id === b.getAttribute('data-rs'); });
        if (!s) return;
        setMsg('', false);
        restore(s).then(function (r) {
          if (r.cancelled) return;
          if (r.ok) {
            App.ui.toast('✅ バックアップから復元しました', 3000);
            setMsg('復元しました。「物件一覧」から内容をご確認ください。', false);
          } else {
            setMsg('復元できませんでした', true);
          }
        }).catch(function (e) {
          setMsg('復元できませんでした：' + (e && e.message ? e.message : e), true);
        });
      });
    });
  }

  App.backup = {
    start: start,
    autoRun: autoRun,
    createSnapshot: createSnapshot,
    open: function () {
      overlay = App.ui.openModal('<p class="muted">読み込み中…</p>');
      render();
    },
  };
})();
