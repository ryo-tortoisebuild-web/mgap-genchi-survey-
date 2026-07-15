/* 画面1：入力（要素一覧＋要素フォーム＋現場情報＋JSON入出力） */
window.App = window.App || {};

(function () {
  App.input = {};

  /* ================= 要素一覧 ================= */
  App.input.renderList = function () {
    var list = document.getElementById('element-list');
    if (!list) return;
    var els = App.state.elements;
    if (!els.length) {
      list.innerHTML = '<p class="empty-note">まだ要素がありません。「＋ 要素を追加」から登録してください。</p>';
      return;
    }
    list.innerHTML = els.map(function (el) {
      var cat = App.catOf(el.category);
      var tags = el.trades.map(function (t) {
        return '<span class="chip chip-trade">' + App.esc(App.tradeLabel(t)) + '</span>';
      }).join('');
      var photoBadge = el.photos.length
        ? '<span class="photo-badge">📷 ' + el.photos.length + '</span>' : '';
      return (
        '<div class="element-card' + (el.visible ? '' : ' element-hidden') + '" data-id="' + el.id + '">' +
          '<div class="element-card-main">' +
            '<div class="element-card-head">' +
              '<span class="chip" style="background:' + cat.color + '">' + App.esc(cat.label) + '</span>' +
              '<strong class="element-label">' + App.esc(el.label) + '</strong>' +
              '<span class="chip chip-cond">' + App.esc(el.condition) + '</span>' +
              photoBadge +
            '</div>' +
            '<div class="element-card-tags">' + (tags || '<span class="muted">職人タグ未設定</span>') + '</div>' +
          '</div>' +
          '<label class="visible-toggle" title="表示ON/OFF">' +
            '<input type="checkbox" data-visible="' + el.id + '"' + (el.visible ? ' checked' : '') + '>' +
            '<span>表示</span>' +
          '</label>' +
        '</div>'
      );
    }).join('');

    list.querySelectorAll('.element-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.visible-toggle')) return;
        App.input.openForm(card.getAttribute('data-id'));
      });
    });
    list.querySelectorAll('[data-visible]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        App.store.updateElement(cb.getAttribute('data-visible'), { visible: cb.checked });
      });
    });
  };

  /* ================= 要素フォーム（新規/編集共用） ================= */
  App.input.openForm = function (elementId) {
    var el = elementId ? App.store.getElement(elementId) : null;
    var isNew = !el;
    /* フォーム内で編集中の写真（保存までstateに入れない） */
    var photos = el ? el.photos.slice() : [];

    var tradeChecks = App.TRADES.map(function (t) {
      var checked = el && el.trades.indexOf(t.key) !== -1;
      return '<label class="tag-chip"><input type="checkbox" name="f-trade" value="' + t.key + '"' +
        (checked ? ' checked' : '') + '><span>' + t.label + '</span></label>';
    }).join('');

    var box = document.createElement('div');
    box.className = 'element-form';
    box.innerHTML =
      '<div class="form-header">' +
        '<h2>' + (isNew ? '要素を追加' : '要素を編集') + '</h2>' +
        '<button type="button" class="btn-icon" data-act="close">✕</button>' +
      '</div>' +
      '<div class="form-body">' +
        '<label class="field"><span class="field-label">名称（ラベル）<em>必須</em></span>' +
          '<input type="text" id="f-label" placeholder="例：キッチン" value="' + App.esc(el ? el.label : '') + '"></label>' +
        '<label class="field"><span class="field-label">位置メモ</span>' +
          '<input type="text" id="f-location" placeholder="例：キッチン北側壁面" value="' + App.esc(el ? el.locationText : '') + '"></label>' +
        '<div class="field"><span class="field-label">職人タグ（複数可）</span>' +
          '<div class="tag-grid">' + tradeChecks + '</div></div>' +
        '<label class="field"><span class="field-label">施工指示・注意点</span>' +
          '<textarea id="f-instruction" rows="3" placeholder="職人への指示・注意点">' + App.esc(el ? el.instruction : '') + '</textarea></label>' +
        '<div class="field"><span class="field-label">写真</span>' +
          '<p class="muted field-note">寸法は依頼先タブで写真に「寸法」書き込みとして記入します。</p>' +
          '<div id="f-dropzone" class="photo-dropzone">' +
            '<div id="f-photos" class="photo-grid"></div>' +
            '<button type="button" class="btn" data-act="add-photo">📷 写真を追加（複数可）</button>' +
            '<p class="muted dz-hint">PCはここに写真をまとめてドラッグ&ドロップ／スマホはボタンから複数選択</p>' +
          '</div>' +
          '<input type="file" id="f-photo-input" accept="image/*" multiple hidden>' +
        '</div>' +
        '<label class="field field-inline"><input type="checkbox" id="f-visible"' +
          ((el ? el.visible : true) ? ' checked' : '') + '><span>間取り・依頼書に表示する</span></label>' +
      '</div>' +
      '<div class="form-footer">' +
        (isNew ? '' : '<button type="button" class="btn btn-danger" data-act="delete">削除</button>') +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn" data-act="close">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>' +
      '</div>';

    var overlay = App.ui.openModal(box, { full: true, noBackdropClose: true });

    /* --- 写真 --- */
    function renderPhotos() {
      var grid = box.querySelector('#f-photos');
      grid.innerHTML = photos.map(function (p, i) {
        return '<div class="photo-thumb"><img src="' + p.dataUrl + '" alt="">' +
          '<button type="button" class="photo-del" data-photo-del="' + i + '">✕</button></div>';
      }).join('');
      grid.querySelectorAll('[data-photo-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          photos.splice(Number(btn.getAttribute('data-photo-del')), 1);
          renderPhotos();
        });
      });
    }
    renderPhotos();

    var photoInput = box.querySelector('#f-photo-input');
    box.querySelector('[data-act="add-photo"]').addEventListener('click', function () {
      photoInput.click();
    });
    function intakeFiles(files) {
      if (!files.length) return;
      App.ui.toast('写真を取り込み中…');
      App.photo.importFiles(files).then(function (newPhotos) {
        if (!newPhotos.length) { App.ui.toast('⚠ 写真を取り込めませんでした'); return; }
        newPhotos.forEach(function (p) { photos.push(p); });
        renderPhotos();
        App.ui.toast('写真を追加しました（' + newPhotos.length + '枚）');
      }).catch(function (err) { App.ui.toast('⚠ ' + err.message); });
    }
    photoInput.addEventListener('change', function () {
      /* iOS Safari対策：input.value をクリアする前に配列へスナップショットする。
         photoInput.files はライブ参照で、value='' すると空になるため */
      var files = Array.prototype.slice.call(photoInput.files || []);
      photoInput.value = '';
      intakeFiles(files);
    });

    /* ドラッグ&ドロップ（PC） */
    var dz = box.querySelector('#f-dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); if (e.target === dz) dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) intakeFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });

    /* --- 保存・削除・閉じる ---
       カテゴリ・寸法・状態・備考はフォームから外したため data に含めない。
       既存要素はこれらの既存値がそのまま保持される（上書きしない）。 */
    box.querySelectorAll('[data-act="close"]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.ui.closeModal(overlay); });
    });

    box.querySelector('[data-act="save"]').addEventListener('click', function () {
      var label = box.querySelector('#f-label').value.trim();
      if (!label) { App.ui.toast('⚠ 名称（ラベル）を入力してください'); return; }
      var data = {
        label: label,
        locationText: box.querySelector('#f-location').value.trim(),
        trades: Array.from(box.querySelectorAll('input[name="f-trade"]:checked')).map(function (cb) { return cb.value; }),
        instruction: box.querySelector('#f-instruction').value.trim(),
        photos: photos,
        visible: box.querySelector('#f-visible').checked,
      };
      if (isNew) App.store.addElement(data);
      else App.store.updateElement(elementId, data);
      App.ui.closeModal(overlay);
      App.ui.toast(isNew ? '撮影ポイントを追加しました' : '撮影ポイントを更新しました');
    });

    var delBtn = box.querySelector('[data-act="delete"]');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        App.ui.confirm('この撮影ポイントを削除しますか？（間取り上のピン・写真・書き込みも消えます）').then(function (ok) {
          if (!ok) return;
          App.store.deleteElement(elementId);
          App.ui.closeModal(overlay);
          App.ui.toast('削除しました');
        });
      });
    }
  };

  /* ================= 物件一覧 ================= */
  App.input.openProjectList = function () {
    var box = document.createElement('div');
    box.className = 'project-list-modal';

    function render() {
      var list = App.store.listProjects();
      var currentId = App.store.currentProjectId();
      var rows = list.map(function (e) {
        var current = e.id === currentId;
        var updated = (e.updatedAt || '').slice(0, 16).replace('T', ' ');
        return (
          '<div class="project-row' + (current ? ' current' : '') + '" data-open="' + e.id + '">' +
            '<div class="project-row-main">' +
              '<div class="project-row-name"><strong>' + App.esc(e.name) + '</strong>' +
                (current ? '<span class="chip chip-current">編集中</span>' : '') + '</div>' +
              '<div class="muted">更新：' + updated + '　要素 ' + e.elementCount + '件・図面 ' + e.drawingCount + '枚</div>' +
            '</div>' +
            '<button type="button" class="btn-icon" data-del="' + e.id + '" title="物件を削除">🗑</button>' +
          '</div>'
        );
      }).join('');

      box.innerHTML =
        '<h2 class="modal-title">物件一覧</h2>' +
        '<button type="button" class="btn btn-primary project-create" id="btn-create-project">＋ 新規物件を作成</button>' +
        '<div class="project-list">' + (rows || '<p class="empty-note">物件がありません</p>') + '</div>' +
        '<div class="modal-actions"><button type="button" class="btn" data-act="close">閉じる</button></div>';

      box.querySelector('[data-act="close"]').addEventListener('click', function () {
        App.ui.closeModal(overlay);
      });

      box.querySelector('#btn-create-project').addEventListener('click', function () {
        App.store.newProject().then(function () {
          App.ui.closeModal(overlay);
          App.input.openProjectForm();  /* すぐ物件名を入れてもらう */
        });
      });

      box.querySelectorAll('[data-open]').forEach(function (row) {
        row.addEventListener('click', function (ev) {
          if (ev.target.closest('[data-del]')) return;
          var id = row.getAttribute('data-open');
          App.store.openProject(id).then(function () {
            App.ui.closeModal(overlay);
            App.ui.toast('「' + App.state.project.name + '」を開きました');
          }).catch(function (err) {
            App.ui.toast('⚠ ' + err.message, 5000);
          });
        });
      });

      box.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del');
          var entry = App.store.listProjects().find(function (e) { return e.id === id; });
          App.ui.confirm('物件「' + (entry ? entry.name : '') + '」を削除しますか？（元に戻せません。必要なら先にJSON書き出しを）').then(function (ok) {
            if (!ok) return;
            App.store.deleteProject(id).then(function () {
              App.ui.toast('削除しました');
              render();  /* 一覧を更新して開いたまま */
            });
          });
        });
      });
    }

    var overlay = App.ui.openModal(box);
    render();
  };

  /* ================= 現場情報 ================= */
  App.input.renderProjectHeader = function () {
    var el = document.getElementById('project-name');
    if (el) el.textContent = App.state.project.name || '（現場名未設定）';
  };

  App.input.openProjectForm = function () {
    var p = App.state.project;
    var box = document.createElement('div');
    box.innerHTML =
      '<h2 class="modal-title">現場情報</h2>' +
      '<label class="field"><span class="field-label">現場名</span>' +
        '<input type="text" id="p-name" value="' + App.esc(p.name) + '"></label>' +
      '<label class="field"><span class="field-label">住所</span>' +
        '<input type="text" id="p-address" value="' + App.esc(p.address) + '"></label>' +
      '<label class="field"><span class="field-label">調査日</span>' +
        '<input type="date" id="p-date" value="' + App.esc(p.surveyDate) + '"></label>' +
      '<label class="field"><span class="field-label">調査担当</span>' +
        '<input type="text" id="p-surveyor" value="' + App.esc(p.surveyor) + '"></label>' +
      '<label class="field"><span class="field-label">メモ</span>' +
        '<textarea id="p-memo" rows="2">' + App.esc(p.memo) + '</textarea></label>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="close">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>' +
      '</div>';
    var overlay = App.ui.openModal(box);
    box.querySelector('[data-act="close"]').addEventListener('click', function () { App.ui.closeModal(overlay); });
    box.querySelector('[data-act="save"]').addEventListener('click', function () {
      Object.assign(App.state.project, {
        name: box.querySelector('#p-name').value.trim(),
        address: box.querySelector('#p-address').value.trim(),
        surveyDate: box.querySelector('#p-date').value,
        surveyor: box.querySelector('#p-surveyor').value.trim(),
        memo: box.querySelector('#p-memo').value.trim(),
      });
      App.store.commit();
      App.ui.closeModal(overlay);
    });
  };

  /* ================= 初期化 ================= */
  App.input.init = function () {
    /* 要素追加は間取りタブから（App.input.openForm(null)）。ここでは共通ヘッダーのみ束ねる */
    document.getElementById('project-name').addEventListener('click', App.input.openProjectForm);

    document.getElementById('btn-export').addEventListener('click', function () {
      App.store.exportJSON();
    });

    var importInput = document.getElementById('import-input');
    document.getElementById('btn-import').addEventListener('click', function () {
      importInput.click();
    });
    importInput.addEventListener('change', function () {
      var file = importInput.files[0];
      importInput.value = '';
      if (!file) return;
      App.ui.confirm('JSONを物件として読み込みます（他の物件は消えません。同じ物件が既にある場合は更新されます）。よろしいですか？').then(function (ok) {
        if (!ok) return;
        App.store.importJSON(file).then(function () {
          App.ui.toast('読み込みました：' + App.state.project.name);
        }).catch(function (err) {
          App.ui.toast('⚠ 読み込み失敗：' + err.message, 5000);
        });
      });
    });

    document.getElementById('btn-projects').addEventListener('click', App.input.openProjectList);

    App.events.on('change', function () {
      App.input.renderProjectHeader();
    });
    App.input.renderProjectHeader();
  };
})();
