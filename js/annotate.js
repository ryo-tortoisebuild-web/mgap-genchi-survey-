/* 依頼先タブ：職人ごとに写真へ書き込み（線／丸／四角／矢印／手書き／コメント／寸法）。
   書き込みは photo.annotations[職人タグ] のレイヤーとして保持し、写真は複製しない。
   描画コアは js/draw.js を共用（間取り側と同じツール一式）。 */
window.App = window.App || {};

(function () {
  App.annot = {};
  var activeTrade = null;

  /* サムネ・印刷用：写真×職人の書き込みを載せたSVGを生成（要 photo.w/h） */
  App.annot.buildOverlay = function (photo, trade) {
    var W = photo.w || 1000, H = photo.h || 750;
    var svg = App.draw.svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'annot-svg' });
    App.draw.renderInto(svg, W, H, (photo.annotations || {})[trade] || []);
    return svg;
  };

  /* ================= 書き込みエディタ（モーダル） ================= */
  App.annot.openEditor = function (photoId, trade) {
    var found = App.store.getPhoto(photoId);
    if (!found) { App.ui.toast('写真が見つかりません'); return; }
    var photo = found.photo, el = found.element;

    var tool = 'shape', shapeSub = 'circle', color = '#e53935', width = 'medium';
    var selectedId = null;
    var W = 1000, H = 750;

    var box = document.createElement('div');
    box.className = 'annot-editor';
    box.innerHTML =
      '<div class="annot-head">' +
        '<span class="annot-title">🖍 ' + App.esc(App.tradeLabel(trade)) + '｜' + App.esc(el.label) + '</span>' +
        '<button type="button" class="btn-icon" data-act="close">✕</button>' +
      '</div>' +
      '<div class="annot-toolbar">' +
        '<div class="annot-drawtools"></div>' +
        '<div class="annot-utils">' +
          '<button type="button" class="tool-btn" data-util="select">☝ 選択</button>' +
          '<button type="button" class="tool-btn" data-util="pan">✋ 移動</button>' +
          '<button type="button" class="tool-btn tool-btn-delete" data-util="delete">🗑 削除</button>' +
          '<span class="annot-zoom">' +
            '<button type="button" class="tool-btn" data-zoom="out" title="縮小">－</button>' +
            '<button type="button" class="tool-btn" data-zoom="in" title="拡大">＋ 拡大</button>' +
            '<button type="button" class="tool-btn" data-zoom="reset" title="等倍に戻す">等倍</button>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="annot-stage">' +
        '<div class="annot-stage-inner">' +
          '<img class="annot-photo" src="' + App.photoSrc(photo) + '" alt="">' +
          '<svg class="annot-svg annot-draw"></svg>' +
        '</div>' +
      '</div>' +
      '<div class="annot-foot">' +
        '<span class="muted annot-hint">図形・コメントは「☝ 選択」でつまんで調整（四角は四隅で台形化）</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-danger" data-act="clear">すべて消去</button>' +
        '<button type="button" class="btn btn-primary" data-act="close">閉じる（保存）</button>' +
      '</div>';

    var overlay = App.ui.openModal(box, { full: true, noBackdropClose: true });
    var svg = box.querySelector('.annot-draw');
    var stage = box.querySelector('.annot-stage');
    var inner = box.querySelector('.annot-stage-inner');

    /* 表示ズーム（見た目のみ。描画座標はviewBox基準のまま＝保存データはズレない） */
    var zoom = 1, tx = 0, ty = 0;
    function applyView() { inner.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + zoom + ')'; }
    function zoomBy(f) {
      var sw = stage.clientWidth, sh = stage.clientHeight;
      var nz = Math.max(1, Math.min(6, zoom * f));
      var af = nz / zoom;
      /* 画面中央の点を保持したまま拡縮 */
      tx = sw / 2 - (sw / 2 - tx) * af;
      ty = sh / 2 - (sh / 2 - ty) * af;
      zoom = nz;
      if (zoom === 1) { tx = 0; ty = 0; } /* 等倍に戻ったら位置もリセット */
      applyView();
      repaint(); /* ハンドルを画面上一定サイズで再描画 */
    }
    function resetView() { zoom = 1; tx = 0; ty = 0; applyView(); repaint(); }

    function list() { return App.store.annotationsOf(photo, trade); }
    function selectedAnnot() { return selectedId ? list().find(function (a) { return a.id === selectedId; }) : null; }
    function unitNow() { var m = svg.getScreenCTM(); return m ? 1 / m.a : 1; }

    function repaint(draft) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      App.draw.renderInto(svg, W, H, list(), { interactive: true });
      var sel = selectedAnnot();
      if (sel) {
        var hg = App.draw.svgEl('g', {});
        App.draw.renderHandles(hg, sel, W, H, unitNow());
        svg.appendChild(hg);
      }
      if (draft) { var d = App.draw.draftPreview(draft); if (d) svg.appendChild(App.draw.buildNode(d, W, H, {})); }
    }

    /* --- 共通ツールバー --- */
    var drawTb = App.draw.buildToolbar(box.querySelector('.annot-drawtools'), {
      getTool: function () { return tool; },
      setTool: function (t) { tool = t; clearSelect(); updateUtil(); },
      getShapeSub: function () { return shapeSub; },
      setShapeSub: function (s) { shapeSub = s; tool = 'shape'; clearSelect(); updateUtil(); },
      getColor: function () { return color; },
      setColor: function (c) { color = c; var a = selectedAnnot(); if (a) { a.color = c; App.store.commit(); repaint(); } },
      getWidth: function () { return width; },
      setWidth: function (w) { width = w; var a = selectedAnnot(); if (a) { a.width = w; App.store.commit(); repaint(); } },
    });

    function updateUtil() {
      box.querySelectorAll('[data-util]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-util') === tool);
      });
      drawTb.refresh();
    }
    box.querySelectorAll('[data-util]').forEach(function (btn) {
      btn.addEventListener('click', function () { tool = btn.getAttribute('data-util'); clearSelect(); updateUtil(); });
    });
    box.querySelector('[data-zoom="in"]').addEventListener('click', function () { zoomBy(1.3); });
    box.querySelector('[data-zoom="out"]').addEventListener('click', function () { zoomBy(1 / 1.3); });
    box.querySelector('[data-zoom="reset"]').addEventListener('click', function () { resetView(); });

    function clearSelect() { selectedId = null; repaint(); }
    function removeById(id) {
      var arr = list(); var i = arr.findIndex(function (a) { return a.id === id; });
      if (i !== -1) { arr.splice(i, 1); if (selectedId === id) selectedId = null; App.store.commit(); repaint(); App.ui.toast('書き込みを削除しました'); }
    }
    function editCommentText(a) {
      App.ui.promptMultiline('コメントを編集', a.text || '').then(function (text) {
        if (text == null) return;
        a.text = text; App.store.commit(); repaint();
      });
    }

    App.photo.ensureDims(photo).then(function (d) {
      W = d.w; H = d.h;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      repaint();
    });

    /* --- 座標変換・ポインタ --- */
    function toSvg(e) {
      var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    var drag = null;

    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}

      /* ✋移動ツール：ドラッグで表示位置を移動（画面px基準・描画データには影響しない） */
      if (tool === 'pan') {
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty };
        return;
      }
      var pt = toSvg(e);

      /* ハンドル優先（選択中の図形のみ） */
      var hEl = e.target.closest('[data-handle]');
      if (hEl && selectedId && hEl.getAttribute('data-annid') === selectedId) {
        drag = { type: 'handle', role: hEl.getAttribute('data-handle'), orig: JSON.parse(JSON.stringify(selectedAnnot())) };
        return;
      }
      var target = e.target.closest('[data-annid]');

      if (tool === 'delete') {
        if (target) removeById(target.getAttribute('data-annid'));
        return;
      }
      if (tool === 'select') {
        if (target) {
          var id = target.getAttribute('data-annid');
          var already = (selectedId === id);
          selectedId = id; repaint();
          drag = { type: 'move', startX: pt.x, startY: pt.y, moved: false, unit: unitNow(), already: already, orig: JSON.parse(JSON.stringify(selectedAnnot())) };
        } else { clearSelect(); }
        return;
      }
      /* 作図ツール */
      var type = App.draw.resolveType(tool, shapeSub);
      drag = { type: 'draw', draft: App.draw.beginDraft(type, color, width, pt) };
    }

    function onMove(e) {
      if (!drag) return;
      e.preventDefault();
      if (drag.type === 'pan') { tx = drag.tx0 + (e.clientX - drag.sx); ty = drag.ty0 + (e.clientY - drag.sy); applyView(); return; }
      var pt = toSvg(e);
      if (drag.type === 'draw') { App.draw.updateDraft(drag.draft, pt); repaint(drag.draft); return; }
      if (drag.type === 'handle') { var a = selectedAnnot(); if (a) { App.draw.applyHandleDrag(a, drag.role, pt, drag.orig, W, H); repaint(); } return; }
      if (drag.type === 'move') {
        var m = selectedAnnot(); if (!m) return;
        var dx = pt.x - drag.startX, dy = pt.y - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 4 * drag.unit) drag.moved = true;
        if (!drag.moved) return;
        var fresh = JSON.parse(JSON.stringify(drag.orig));
        Object.keys(fresh).forEach(function (k) { m[k] = fresh[k]; });
        App.draw.translate(m, dx, dy);
        repaint();
      }
    }

    function onUp(e) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.type === 'handle') { App.store.commit(); repaint(); return; }
      if (d.type === 'move') {
        if (d.moved) { App.store.commit(); return; }
        var a = selectedAnnot();
        if (a && a.type === 'comment' && d.already) editCommentText(a);
        return;
      }
      if (d.type === 'draw') {
        var dr = d.draft; var type = dr.type;
        if (type === 'comment') {
          App.ui.promptMultiline('コメントを入力', '').then(function (text) {
            if (text == null || text.trim() === '') { repaint(); return; }
            var m = App.draw.commentMetrics({ type: 'comment', width: dr.width, x: dr.x, y: dr.y, text: text }, W, H);
            list().push({ id: App.uid('an'), type: 'comment', color: dr.color, width: dr.width, x: dr.x, y: dr.y, w: m.w, fontPx: m.fontPx, text: text });
            App.store.commit(); repaint();
          });
          return;
        }
        var geom = App.draw.draftToGeom(dr);
        if (!geom) { repaint(); return; }
        geom.id = App.uid('an');
        if (type === 'dim') {
          repaint(dr);
          App.ui.prompt('寸法の数値を入力（例：910）', '').then(function (val) {
            if (val == null || val === '') { repaint(); return; }
            geom.text = val; list().push(geom); App.store.commit(); repaint();
          });
          return;
        }
        list().push(geom); App.store.commit(); repaint();
      }
    }

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    /* iOS対策：描画/操作中はタッチのスクロール・バウンスを完全に抑止（非パッシブ） */
    svg.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });

    /* --- クリア・閉じる --- */
    box.querySelector('[data-act="clear"]').addEventListener('click', function () {
      if (!list().length) return;
      App.ui.confirm('この職人の書き込みをすべて消去しますか？（他の職人の書き込みは残ります）').then(function (ok) {
        if (!ok) return;
        photo.annotations[trade] = []; App.store.commit(); clearSelect();
      });
    });
    box.querySelectorAll('[data-act="close"]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.ui.closeModal(overlay); App.annot.render(); });
    });

    updateUtil();
  };

  /* ================= 依頼先タブ ================= */
  function renderTabs() {
    var wrap = document.getElementById('assign-tabs');
    if (!wrap) return;
    var assignees = App.store.assignees();
    if (activeTrade && assignees.indexOf(activeTrade) === -1) activeTrade = null;
    if (!activeTrade && assignees.length) activeTrade = assignees[0];

    var html = assignees.map(function (t) {
      var n = App.store.pointsForTrade(t).length;
      return '<span class="assign-tab' + (t === activeTrade ? ' active' : '') + '">' +
        '<button type="button" class="assign-tab-main" data-trade="' + t + '">' +
          App.esc(App.tradeLabel(t)) + ' <span class="count">' + n + '</span></button>' +
        '<button type="button" class="assign-tab-x" data-remove="' + t + '" title="この依頼先を外す">✕</button>' +
      '</span>';
    }).join('');
    html += '<button type="button" class="assign-tab-add" id="btn-add-assignee">＋ 職人を追加</button>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-trade]').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTrade = btn.getAttribute('data-trade'); App.annot.render(); });
    });
    wrap.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-remove');
        App.ui.confirm('依頼先「' + App.tradeLabel(t) + '」を一覧から外しますか？（書き込みデータは残ります）').then(function (ok) {
          if (ok) App.store.removeAssignee(t);
        });
      });
    });
    wrap.querySelector('#btn-add-assignee').addEventListener('click', openAssigneePicker);
  }

  function openAssigneePicker() {
    var assignees = App.store.assignees();
    var remaining = App.TRADES.filter(function (t) { return assignees.indexOf(t.key) === -1; });
    var box = document.createElement('div');
    box.innerHTML =
      '<h2 class="modal-title">依頼先の職人を追加</h2>' +
      (remaining.length
        ? '<div class="tag-grid">' + remaining.map(function (t) { return '<button type="button" class="tag-pick" data-pick="' + t.key + '">' + t.label + '</button>'; }).join('') + '</div>'
        : '<p class="muted">14職種すべて追加済みです。</p>') +
      '<div class="modal-actions"><button type="button" class="btn" data-act="close">閉じる</button></div>';
    var overlay = App.ui.openModal(box);
    box.querySelector('[data-act="close"]').addEventListener('click', function () { App.ui.closeModal(overlay); });
    box.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-pick');
        App.store.addAssignee(t); activeTrade = t; App.ui.closeModal(overlay); App.annot.render();
      });
    });
  }

  function renderBody() {
    var body = document.getElementById('assign-body');
    if (!body) return;

    if (!activeTrade) {
      body.innerHTML = '<p class="empty-note">「＋ 職人を追加」で依頼先を選ぶと、その職人が担当する撮影ポイントの写真が並びます。</p>';
      return;
    }
    var points = App.store.pointsForTrade(activeTrade);
    if (!points.length) {
      body.innerHTML = '<p class="empty-note">「' + App.esc(App.tradeLabel(activeTrade)) +
        '」が担当する撮影ポイントがありません。<br>間取りタブで撮影ポイントの職人タグに「' +
        App.esc(App.tradeLabel(activeTrade)) + '」を付けてください。</p>';
      return;
    }

    var html = points.map(function (el) {
      var num = App.store.pointNumber(el.id);
      var head = '<div class="annot-point-head">' +
        '<span class="point-num" style="background:' + App.catOf(el.category).color + '">' + num + '</span>' +
        '<strong>' + App.esc(el.label) + '</strong>' +
        (el.locationText ? '<span class="muted"> ' + App.esc(el.locationText) + '</span>' : '') +
        '</div>';
      var photos;
      if (!el.photos.length) {
        photos = '<p class="muted annot-nophoto">写真がありません（ここに写真をドラッグ&ドロップ、または間取りタブで追加）</p>';
      } else {
        photos = '<div class="annot-thumbs">' + el.photos.map(function (p) {
          var n = ((p.annotations || {})[activeTrade] || []).length;
          var excluded = App.store.isPhotoExcluded(p, activeTrade);
          return '<div class="annot-thumb' + (excluded ? ' excluded' : '') + '" data-photoid="' + p.id + '">' +
            '<img src="' + App.photoSrc(p) + '" alt="">' +
            '<span class="annot-thumb-svg"></span>' +
            '<button type="button" class="thumb-exclude" data-exclude="' + p.id + '" title="' + (excluded ? 'この職人の対象外を解除' : 'この職人の対象外にする（他職人・出力に影響なし）') + '">' + (excluded ? '↩' : '✕') + '</button>' +
            '<span class="annot-thumb-badge">' + (excluded ? '対象外' : (n ? '🖍 ' + n : '書き込む')) + '</span>' +
          '</div>';
        }).join('') + '</div>';
      }
      return '<div class="annot-point" data-elid="' + el.id + '">' + head + photos +
        '<p class="muted dz-hint annot-dz-hint">PCはこの箇所に写真をドラッグ&ドロップで追加できます</p>' +
        '</div>';
    }).join('');
    body.innerHTML = html;

    body.querySelectorAll('.annot-thumb').forEach(function (thumb) {
      var pid = thumb.getAttribute('data-photoid');
      var found = App.store.getPhoto(pid);
      if (found) {
        App.photo.ensureDims(found.photo).then(function () {
          var holder = thumb.querySelector('.annot-thumb-svg');
          if (holder) holder.appendChild(App.annot.buildOverlay(found.photo, activeTrade));
        });
      }
      thumb.addEventListener('click', function (e) {
        if (e.target.closest('.thumb-exclude')) return;
        App.annot.openEditor(pid, activeTrade);
      });
    });

    /* ✕ 対象外トグル（職人ごと独立） */
    body.querySelectorAll('[data-exclude]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var found = App.store.getPhoto(btn.getAttribute('data-exclude'));
        if (!found) return;
        var nowExcluded = App.store.togglePhotoExcluded(found.photo, activeTrade);
        App.ui.toast(nowExcluded ? 'この職人の対象外にしました' : '対象外を解除しました');
      });
    });

    /* 撮影ポイントへの写真ドラッグ&ドロップ（PC） */
    body.querySelectorAll('.annot-point').forEach(function (pt) {
      var elid = pt.getAttribute('data-elid');
      ['dragenter', 'dragover'].forEach(function (ev) {
        pt.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); pt.classList.add('dragover'); });
      });
      ['dragleave', 'dragend'].forEach(function (ev) {
        pt.addEventListener(ev, function (e) { if (e.target === pt) pt.classList.remove('dragover'); });
      });
      pt.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation(); pt.classList.remove('dragover');
        if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
        var el = App.store.getElement(elid);
        if (!el) return;
        App.ui.toast('写真を取り込み中…');
        App.photo.importFiles(e.dataTransfer.files).then(function (photos) {
          if (!photos.length) return;
          el.photos = el.photos.concat(photos);
          App.store.commit();
          App.ui.toast('写真を追加しました（' + photos.length + '枚）');
        }).catch(function (err) { App.ui.toast('⚠ ' + err.message); });
      });
    });
  }

  App.annot.render = function () { renderTabs(); renderBody(); };
  App.annot.activeTrade = function () { return activeTrade; };

  App.annot.init = function () {
    App.events.on('change', function () { if (App.ui.currentTab() === 'assign') App.annot.render(); });
    App.events.on('tab', function (tab) { if (tab === 'assign') App.annot.render(); });
    if (App.ui.currentTab() === 'assign') App.annot.render();
  };
})();
