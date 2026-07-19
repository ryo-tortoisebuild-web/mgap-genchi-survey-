/* メンバー管理（管理者のみ）。
   ・ID/パスワードを発行して利用者を追加する恒久的な経路（setup_keyとは別）
   ・追加された人は物件について全員フル権限（方式A）。メンバー管理だけ管理者限定
   ・成功/失敗の表示は必ずサーバー応答を確認してから出す（見た目だけの成功表示はしない） */
window.App = window.App || {};

(function () {
  var overlay = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(Number(ms));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setMsg(text, isError) {
    var box = overlay && overlay.querySelector('#member-msg');
    if (!box) return;
    if (!text) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = text;
    box.className = 'member-msg ' + (isError ? 'is-error' : 'is-ok');
  }

  function render(members, myUsername) {
    var rows = members.map(function (m) {
      var isMe = m.username === myUsername;
      return '<div class="member-row">' +
        '<div class="member-info">' +
          '<span class="member-name">' + esc(m.username) + '</span>' +
          (m.isAdmin ? '<span class="member-badge">管理者</span>' : '') +
          (isMe ? '<span class="member-badge member-badge-me">自分</span>' : '') +
          '<span class="member-date">追加：' + fmtDate(m.createdAt) + '</span>' +
        '</div>' +
        '<div class="member-actions">' +
          '<button type="button" class="btn btn-small" data-reset="' + m.id + '">パスワード再発行</button>' +
          (isMe ? '' : '<button type="button" class="btn btn-small btn-danger" data-del="' + m.id + '" data-name="' + esc(m.username) + '">削除</button>') +
        '</div>' +
      '</div>';
    }).join('');

    return '<h2 class="modal-title">👥 メンバー管理</h2>' +
      '<p class="muted member-note">追加した人は、全ての物件を作成・閲覧・編集できます（全員フル権限）。メンバーの追加・削除は管理者のみです。</p>' +
      '<div class="member-list">' + (rows || '<p class="muted">メンバーがいません</p>') + '</div>' +
      '<div class="member-add">' +
        '<h3>＋ メンバーを追加</h3>' +
        '<label class="login-field"><span>ID（ログイン用）</span><input type="text" id="member-new-user" autocapitalize="none"></label>' +
        '<label class="login-field"><span>パスワード（6文字以上）</span><input type="text" id="member-new-pass"></label>' +
        '<label class="field-inline"><input type="checkbox" id="member-new-admin"><span>この人も管理者にする（メンバー追加が可能になる）</span></label>' +
        '<button type="button" class="btn btn-primary btn-block" id="member-add-btn">この内容で追加する</button>' +
        '<p class="muted member-hint">発行したID・パスワードは、本人に安全な方法で伝えてください。</p>' +
      '</div>' +
      '<p class="member-msg" id="member-msg" hidden></p>' +
      '<div class="modal-actions"><button type="button" class="btn" id="member-close">閉じる</button></div>';
  }

  function reload() {
    return App.api.listMembers().then(function (r) {
      if (!r || !r.ok) {
        setMsg((r && r.offline) ? 'サーバーに接続できません' : ((r && r.error) || '一覧を取得できません'), true);
        return;
      }
      var box = overlay.querySelector('.modal-box');
      box.innerHTML = render(r.members, App.auth.username());
      bind();
    });
  }

  function bind() {
    var box = overlay.querySelector('.modal-box');

    box.querySelector('#member-close').addEventListener('click', function () {
      App.ui.closeModal(overlay); overlay = null;
    });

    box.querySelector('#member-add-btn').addEventListener('click', function () {
      var btn = this;
      var u = (box.querySelector('#member-new-user').value || '').trim();
      var p = box.querySelector('#member-new-pass').value || '';
      var isAdmin = box.querySelector('#member-new-admin').checked;
      if (!u || p.length < 6) { setMsg('IDと6文字以上のパスワードを入力してください', true); return; }
      btn.disabled = true;
      setMsg('追加しています…', false);
      App.api.addMember(u, p, isAdmin).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) {
          App.ui.toast('✅ メンバー「' + u + '」を追加しました', 3000);
          reload().then(function () { setMsg('「' + u + '」を追加しました。IDとパスワードを本人にお伝えください。', false); });
        } else {
          setMsg('追加できませんでした：' + ((r && r.offline) ? 'サーバーに接続できません' : (r && r.error) || '不明なエラー'), true);
        }
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-reset]'), function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-reset'));
        App.ui.prompt('新しいパスワードを入力してください（6文字以上）', '').then(function (np) {
          if (np === null) return;
          if (!np || np.length < 6) { setMsg('パスワードは6文字以上にしてください', true); return; }
          setMsg('変更しています…', false);
          App.api.resetMemberPassword(id, np).then(function (r) {
            if (r && r.ok) {
              App.ui.toast('✅ パスワードを再発行しました', 3000);
              setMsg('パスワードを変更しました。本人は再ログインが必要です。', false);
            } else {
              setMsg('変更できませんでした：' + ((r && r.error) || '不明なエラー'), true);
            }
          });
        });
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-del'));
        var name = b.getAttribute('data-name');
        App.ui.confirm('「' + name + '」を削除しますか？\nこの人はログインできなくなります（物件データは残ります）').then(function (yes) {
          if (!yes) return;
          setMsg('削除しています…', false);
          App.api.deleteMember(id).then(function (r) {
            if (r && r.ok) {
              App.ui.toast('✅ 「' + name + '」を削除しました', 3000);
              reload();
            } else {
              setMsg('削除できませんでした：' + ((r && r.error) || '不明なエラー'), true);
            }
          });
        });
      });
    });
  }

  App.members = {
    open: function () {
      overlay = App.ui.openModal('<p class="muted">読み込み中…</p>');
      reload();
    },
  };
})();
