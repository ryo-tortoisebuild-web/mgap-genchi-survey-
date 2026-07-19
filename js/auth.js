/* ログイン管理。
   ・apiBase未設定（この端末だけモード）→ ログインUIは出さず、従来どおり動く。
   ・apiBase設定あり → ログイン必須。未ログインなら全画面のログイン画面を出す。
   ・最初の1人はこの画面から「初回登録」で管理者アカウントを作成できる。 */
window.App = window.App || {};

(function () {
  var overlay, accountArea, mode = 'login', hasUser = true;
  var currentUser = '', currentIsAdmin = false;

  function el(id) { return document.getElementById(id); }

  function renderAccount(username, isAdmin) {
    if (!accountArea) return;
    currentUser = username;
    currentIsAdmin = !!isAdmin;
    accountArea.hidden = false;
    accountArea.innerHTML =
      '<span class="acct-name">👤 ' + escapeHtml(username) + (isAdmin ? '<span class="acct-admin">管理者</span>' : '') + '</span>' +
      (isAdmin ? '<button type="button" class="btn btn-small" id="btn-members">👥 メンバー</button>' : '') +
      '<button type="button" class="btn btn-small" id="btn-sync-now">🔄 今すぐ同期</button>' +
      '<button type="button" class="btn btn-small" id="btn-logout">ログアウト</button>';
    if (isAdmin && el('btn-members')) {
      el('btn-members').addEventListener('click', function () { App.members.open(); });
    }
    el('btn-sync-now').addEventListener('click', function () {
      App.ui.toast('同期しています…', 1200);
      App.sync.now();   // 成否はsync側が実結果に基づきトースト表示する
    });
    el('btn-logout').addEventListener('click', doLogout);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showOverlay(note) {
    mode = hasUser ? 'login' : 'register';
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="login-box">' +
        '<h1 class="login-title">📋 現地調査引き継ぎ</h1>' +
        '<p class="login-sub">' + (mode === 'register'
          ? 'はじめての方：管理者アカウントを作成します'
          : 'ログインしてください') + '</p>' +
        (note ? '<p class="login-note">' + escapeHtml(note) + '</p>' : '') +
        '<label class="login-field"><span>ID</span><input type="text" id="login-user" autocomplete="username" autocapitalize="none"></label>' +
        '<label class="login-field"><span>パスワード' + (mode === 'register' ? '（6文字以上）' : '') + '</span>' +
          '<input type="password" id="login-pass" autocomplete="' + (mode === 'register' ? 'new-password' : 'current-password') + '"></label>' +
        (mode === 'register'
          ? '<label class="login-field"><span>初期設定キー（サーバーのconfig.phpに設定した値）</span>' +
              '<input type="password" id="login-setupkey" autocomplete="off"></label>'
          : '') +
        '<p class="login-error" id="login-error" hidden></p>' +
        '<button type="button" class="btn btn-primary btn-block" id="login-submit">' +
          (mode === 'register' ? 'アカウントを作成して開始' : 'ログイン') + '</button>' +
      '</div>';
    var submit = el('login-submit');
    submit.addEventListener('click', onSubmit);
    el('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(); });
    el('login-user').focus();
  }

  function setError(msg) {
    var e = el('login-error');
    if (!e) return;
    if (msg) { e.textContent = msg; e.hidden = false; } else { e.hidden = true; }
  }

  function onSubmit() {
    var u = (el('login-user').value || '').trim();
    var p = el('login-pass').value || '';
    if (!u || !p) { setError('IDとパスワードを入力してください'); return; }
    setError('');
    el('login-submit').disabled = true;
    var setupKey = el('login-setupkey') ? (el('login-setupkey').value || '') : '';
    var req = mode === 'register' ? App.api.register(u, p, setupKey) : App.api.login(u, p);
    req.then(function (r) {
      el('login-submit').disabled = false;
      if (r && r.ok && r.token) {
        App.api.setToken(r.token);
        overlay.hidden = true;
        onLoggedIn(r.username || u);
      } else if (r && r.offline) {
        setError('サーバーに接続できません。通信環境を確認してください');
      } else {
        setError((r && r.error) || 'ログインに失敗しました');
      }
    });
  }

  /* isAdmin未確定のときは me で確認してから表示（管理者ボタンの出し分けのため） */
  function onLoggedIn(username, isAdmin) {
    if (isAdmin === undefined) {
      renderAccount(username, false);
      App.api.me().then(function (me) {
        if (me && me.ok) renderAccount(me.username, me.isAdmin);
      });
    } else {
      renderAccount(username, isAdmin);
    }
    App.sync.start();
  }

  function doLogout() {
    App.api.logout();          // best-effort（応答は待たない）
    App.api.setToken('');
    App.sync.stop();
    location.reload();
  }

  App.auth = {
    username: function () { return currentUser; },
    isAdmin: function () { return currentIsAdmin; },

    /* 起動時に呼ぶ。ローカルのみモードなら即resolve */
    init: function () {
      overlay = el('login-overlay');
      accountArea = el('account-area');
      if (!App.api.enabled()) {
        if (accountArea) accountArea.hidden = true;
        return Promise.resolve();   // 従来どおり端末内保存で動作
      }
      return App.api.status().then(function (st) {
        if (st && st.ok) hasUser = !!st.hasUser;
        var token = App.api.getToken();
        if (st && st.offline && token) {
          // オフラインでもトークンがあれば利用継続（同期は回復後）
          renderAccount('（オフライン）', false);
          App.sync.start();
          return;
        }
        if (token) {
          return App.api.me().then(function (me) {
            if (me && me.ok) { onLoggedIn(me.username, me.isAdmin); }
            else { App.api.setToken(''); showOverlay(); }
          });
        }
        showOverlay(st && st.offline ? 'オフラインです。接続後に再度お試しください' : '');
      });
    },
  };
})();
