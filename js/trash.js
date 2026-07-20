/* ゴミ箱：削除した物件・撮影ポイントを保管期間内なら復元できる。
   実データは消さずに隠しているだけ（写真の「対象外フラグ」と同じ考え方）。
   保管期間を過ぎたものは自動で完全削除される。 */
window.App = window.App || {};

(function () {
  var overlay = null;
  var tab = 'projects';   // projects | points

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function remainLabel(days) {
    if (days <= 0) return '<span class="trash-remain trash-remain-soon">まもなく完全削除</span>';
    if (days <= 7) return '<span class="trash-remain trash-remain-soon">あと' + days + '日</span>';
    return '<span class="trash-remain">あと' + days + '日</span>';
  }

  function render() {
    var box = overlay.querySelector('.modal-box');
    var days = App.TRASH_RETENTION_DAYS;

    var projects = App.store.listTrashedProjects();
    var points = App.store.listDeletedElements();

    var body;
    if (tab === 'projects') {
      body = projects.length ? projects.map(function (p) {
        return '<div class="trash-row">' +
          '<div class="trash-info">' +
            '<div class="trash-name">' + esc(p.name || '（名称未設定）') + '</div>' +
            '<div class="muted trash-meta">削除：' + fmt(p.deletedAt) +
              '　要素 ' + (p.elementCount || 0) + '件・図面 ' + (p.drawingCount || 0) + '枚　' + remainLabel(p.remainingDays) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-small" data-restore-prj="' + esc(p.id) + '">復元する</button>' +
        '</div>';
      }).join('') : '<p class="empty-note">削除した物件はありません</p>';
    } else {
      body = points.length ? points.map(function (p) {
        return '<div class="trash-row">' +
          '<div class="trash-info">' +
            '<div class="trash-name">' + esc(p.label) + '</div>' +
            '<div class="muted trash-meta">削除：' + fmt(p.deletedAt) +
              '　写真 ' + p.photoCount + '枚　' + remainLabel(p.remainingDays) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-small" data-restore-pt="' + esc(p.id) + '">復元する</button>' +
        '</div>';
      }).join('') : '<p class="empty-note">この物件で削除した撮影ポイントはありません</p>';
    }

    box.innerHTML =
      '<h2 class="modal-title">🗑 ゴミ箱</h2>' +
      '<p class="muted trash-note">削除したものは' + days + '日間ここに保管され、期限を過ぎると自動的に完全削除されます。期間内なら復元できます。</p>' +
      '<div class="trash-tabs">' +
        '<button type="button" class="trash-tab' + (tab === 'projects' ? ' active' : '') + '" data-tab="projects">物件（' + projects.length + '）</button>' +
        '<button type="button" class="trash-tab' + (tab === 'points' ? ' active' : '') + '" data-tab="points">撮影ポイント（' + points.length + '）</button>' +
      '</div>' +
      (tab === 'points' ? '<p class="muted trash-scope">表示中の物件「' + esc(App.state.project.name || '') + '」の中で削除したものです</p>' : '') +
      '<div class="trash-list">' + body + '</div>' +
      '<p class="trash-msg" id="trash-msg" hidden></p>' +
      '<div class="modal-actions"><button type="button" class="btn" id="trash-close">閉じる</button></div>';

    bind();
  }

  function setMsg(text, isError) {
    var m = overlay.querySelector('#trash-msg');
    if (!m) return;
    if (!text) { m.hidden = true; return; }
    m.hidden = false;
    m.textContent = text;
    m.className = 'trash-msg ' + (isError ? 'is-error' : 'is-ok');
  }

  function bind() {
    var box = overlay.querySelector('.modal-box');

    box.querySelector('#trash-close').addEventListener('click', function () {
      App.ui.closeModal(overlay); overlay = null;
      if (App.input && App.input.refresh) App.input.refresh();
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); render(); });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-restore-prj]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-restore-prj');
        b.disabled = true;
        setMsg('復元しています…', false);
        App.store.restoreProject(id).then(function () {
          App.ui.toast('✅ 物件を復元しました', 2500);
          render();
          setMsg('物件を復元しました。「物件一覧」から開けます。', false);
        }).catch(function (e) {
          b.disabled = false;
          setMsg('復元できませんでした：' + (e && e.message ? e.message : e), true);
        });
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-restore-pt]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-restore-pt');
        if (App.store.restoreElement(id)) {
          App.ui.toast('✅ 撮影ポイントを復元しました', 2500);
          render();
          setMsg('撮影ポイントを復元しました（一覧の最後に戻ります）。', false);
        } else {
          setMsg('復元できませんでした（対象が見つかりません）', true);
        }
      });
    });
  }

  App.trash = {
    open: function (which) {
      tab = which === 'points' ? 'points' : 'projects';
      overlay = App.ui.openModal('<p class="muted">読み込み中…</p>');
      render();
    },
  };
})();
