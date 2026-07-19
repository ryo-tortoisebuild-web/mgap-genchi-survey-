/* サーバーAPIクライアント（fetchの薄いラッパー）。
   認証はログインで得たトークンを Authorization: Bearer で送る（Cookie不使用でCORSが単純）。 */
window.App = window.App || {};

(function () {
  var TOKEN_KEY = 'genchi_token';

  function base() { return (App.config && App.config.apiBase) || ''; }

  App.api = {
    enabled: function () { return !!base(); },

    getToken: function () {
      try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    },
    setToken: function (t) {
      try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    },

    /* JSONで叩く共通処理。ネットワーク不通は {ok:false, offline:true} を返す */
    call: function (action, opts) {
      opts = opts || {};
      var url = base() + '?action=' + encodeURIComponent(action);
      if (opts.query) {
        Object.keys(opts.query).forEach(function (k) {
          url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]);
        });
      }
      var headers = {};
      var token = App.api.getToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
        headers['X-Auth-Token'] = token;   // FastCGI環境でAuthorizationが剥がされる場合の代替
      }
      var init = { method: opts.method || 'GET', headers: headers };
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      return fetch(url, init).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { data = data || {}; data.ok = false; data.status = res.status; }
          return data;
        }).catch(function () {
          return { ok: false, error: 'サーバー応答が不正です', status: res.status };
        });
      }).catch(function () {
        return { ok: false, offline: true, error: 'サーバーに接続できません' };
      });
    },

    /* 写真アップロード（multipart）。dataUrl(JPEG) をファイルとして送る */
    uploadPhoto: function (projectUid, photoUid, blob) {
      var url = base() + '?action=photo';
      var fd = new FormData();
      fd.append('projectUid', projectUid);
      fd.append('photoUid', photoUid);
      fd.append('file', blob, photoUid + '.jpg');
      var headers = {};
      var token = App.api.getToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
        headers['X-Auth-Token'] = token;
      }
      return fetch(url, { method: 'POST', headers: headers, body: fd })
        .then(function (res) { return res.json(); })
        .catch(function () { return { ok: false, offline: true }; });
    },

    // --- 各エンドポイント ---
    status:      function () { return App.api.call('status'); },
    register:    function (u, p, setupKey) { return App.api.call('register', { method: 'POST', body: { username: u, password: p, setupKey: setupKey || '' } }); },
    login:       function (u, p) { return App.api.call('login', { method: 'POST', body: { username: u, password: p } }); },
    logout:      function () { return App.api.call('logout', { method: 'POST' }); },
    me:          function () { return App.api.call('me'); },
    listProjects:function () { return App.api.call('projects'); },
    getProject:  function (uid) { return App.api.call('project', { query: { uid: uid } }); },
    saveProject: function (payload) { return App.api.call('project_save', { method: 'POST', body: payload }); },
    deleteProject: function (uid) { return App.api.call('project_delete', { method: 'POST', body: { projectUid: uid } }); },

    // --- メンバー管理（管理者のみ） ---
    listMembers:  function () { return App.api.call('members'); },
    addMember:    function (u, p, isAdmin) { return App.api.call('member_add', { method: 'POST', body: { username: u, password: p, isAdmin: !!isAdmin } }); },
    resetMemberPassword: function (id, p) { return App.api.call('member_password', { method: 'POST', body: { id: id, password: p } }); },
    deleteMember: function (id) { return App.api.call('member_delete', { method: 'POST', body: { id: id } }); },
  };
})();
