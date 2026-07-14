/* 画面2：作図（SVG。線・寸法・ピン。マウス／タッチ両対応） */
window.App = window.App || {};

(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CANVAS_W = 1600;
  var CANVAS_H = 1200;

  var state = {
    drawingId: null,       // 表示中の図面
    mode: 'select',        // select | pin | bg | delete | line|circle|rect|arrow|free|comment|dim
    selected: null,        // { kind: 'stroke'|'dim'|'pin'|'annot', id }
    pinElementId: null,    // ピンツールで配置する要素
    view: null,            // { x, y, w, h } 表示中viewBox
    drag: null,            // ドラッグ中の状態
    shapeSub: 'circle',    // 図形サブツール
    color: '#e53935',
    width: 'medium',
  };

  var svg, wrap, drawTb;

  function currentDrawing() {
    return state.drawingId ? App.store.getDrawing(state.drawingId) : null;
  }

  /* ---- 座標変換：スクリーン → SVG viewBox座標 ---- */
  function toSvg(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function toScreen(x, y) {
    var pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    return pt.matrixTransform(svg.getScreenCTM());
  }

  function resetView() {
    state.view = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    applyView();
  }
  function applyView() {
    if (!svg) return;
    var v = state.view;
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
  }
  function zoom(factor) {
    var v = state.view;
    var cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    var nw = Math.min(CANVAS_W * 4, Math.max(CANVAS_W / 8, v.w * factor));
    var nh = nw * (CANVAS_H / CANVAS_W);
    state.view = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    applyView();
  }

  /* ================= SVG描画 ================= */

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  App.editor = App.editor || {};

  /* 図面の中身を丸ごと描画。opts.filterTrade / opts.hideBg は依頼書出力用 */
  function buildSvgContent(dw, target, opts) {
    opts = opts || {};
    target.innerHTML = '';

    // 背景（白地＋方眼）
    target.appendChild(svgEl('rect', {
      x: 0, y: 0, width: CANVAS_W, height: CANVAS_H,
      fill: '#ffffff', 'data-kind': 'canvas',
    }));
    if (!opts.forPrint) {
      var gridG = svgEl('g', { 'data-kind': 'grid' });
      for (var gx = 100; gx < CANVAS_W; gx += 100) {
        gridG.appendChild(svgEl('line', { x1: gx, y1: 0, x2: gx, y2: CANVAS_H, stroke: '#eef1f4', 'stroke-width': 1 }));
      }
      for (var gy = 100; gy < CANVAS_H; gy += 100) {
        gridG.appendChild(svgEl('line', { x1: 0, y1: gy, x2: CANVAS_W, y2: gy, stroke: '#eef1f4', 'stroke-width': 1 }));
      }
      target.appendChild(gridG);
    }

    // 間取り画像（背景）：位置(x,y)と拡縮(scale)を反映。旧データ(naturalW/H無し)は従来通りキャンバス全面フィット
    if (dw.background.dataUrl && !opts.hideBg) {
      var bg = dw.background;
      var bw = (bg.naturalW || CANVAS_W) * (bg.scale || 1);
      var bh = (bg.naturalH || CANVAS_H) * (bg.scale || 1);
      var img = svgEl('image', {
        x: bg.x || 0, y: bg.y || 0, width: bw, height: bh,
        opacity: bg.opacity,
        preserveAspectRatio: 'xMidYMid meet',
        'data-kind': 'bg',
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', bg.dataUrl);
      img.setAttribute('href', bg.dataUrl);
      target.appendChild(img);
    }

    // 線
    var strokesG = svgEl('g', { id: 'layer-strokes' });
    dw.strokes.forEach(function (st) {
      var selected = !opts.forPrint && state.selected && state.selected.kind === 'stroke' && state.selected.id === st.id;
      var g = svgEl('g', { 'data-kind': 'stroke', 'data-id': st.id });
      g.appendChild(svgEl('line', {
        x1: st.x1, y1: st.y1, x2: st.x2, y2: st.y2,
        stroke: selected ? '#d32f2f' : '#263238',
        'stroke-width': selected ? 6 : (st.width || 3),
        'stroke-linecap': 'round',
      }));
      if (!opts.forPrint) {
        // タッチ用の透明な当たり判定
        g.appendChild(svgEl('line', {
          x1: st.x1, y1: st.y1, x2: st.x2, y2: st.y2,
          stroke: 'rgba(0,0,0,0)', 'stroke-width': 24, 'stroke-linecap': 'round',
        }));
      }
      strokesG.appendChild(g);
    });
    target.appendChild(strokesG);

    // 寸法（旧データ・後方互換）
    var dimsG = svgEl('g', { id: 'layer-dims' });
    dw.dims.forEach(function (dm) {
      dimsG.appendChild(buildDimNode(dm, !opts.forPrint));
    });
    target.appendChild(dimsG);

    // 書き込み（共通コア：線・丸・四角・矢印・手書き・コメント・寸法）
    var annG = svgEl('g', { id: 'layer-annots' });
    App.draw.renderInto(annG, CANVAS_W, CANVAS_H, dw.annotations || [], { interactive: !opts.forPrint });
    if (!opts.forPrint) {
      var selA = selectedAnnot();
      if (selA) App.draw.renderHandles(annG, selA, CANVAS_W, CANVAS_H, unitNow());
    }
    target.appendChild(annG);

    // ピン
    var pinsG = svgEl('g', { id: 'layer-pins' });
    dw.pins.forEach(function (pin) {
      var el = App.store.getElement(pin.elementId);
      if (!el) return;
      if (opts.filterTrade) {
        if (!el.visible || el.trades.indexOf(opts.filterTrade) === -1) return;
      } else if (opts.forPrint && !el.visible) {
        return;
      }
      pinsG.appendChild(buildPinNode(pin, el, opts));
    });
    target.appendChild(pinsG);
  }

  function buildDimNode(dm, interactive) {
    var selected = interactive && state.selected && state.selected.kind === 'dim' && state.selected.id === dm.id;
    var color = selected ? '#d32f2f' : '#1565c0';
    var g = svgEl('g', { 'data-kind': 'dim', 'data-id': dm.id });
    var dx = dm.x2 - dm.x1, dy = dm.y2 - dm.y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    // 端点ティック（線に垂直）
    var px = -dy / len, py = dx / len;
    var tick = 10;
    g.appendChild(svgEl('line', { x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2, stroke: color, 'stroke-width': 2 }));
    if (interactive) {
      // タッチ用の透明な当たり判定
      g.appendChild(svgEl('line', {
        x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2,
        stroke: 'rgba(0,0,0,0)', 'stroke-width': 24,
      }));
    }
    [[dm.x1, dm.y1], [dm.x2, dm.y2]].forEach(function (p) {
      g.appendChild(svgEl('line', {
        x1: p[0] - px * tick, y1: p[1] - py * tick,
        x2: p[0] + px * tick, y2: p[1] + py * tick,
        stroke: color, 'stroke-width': 2,
      }));
    });
    // 中央テキスト（白背景）
    var mx = (dm.x1 + dm.x2) / 2, my = (dm.y1 + dm.y2) / 2;
    var text = dm.text || '?';
    var fontSize = 26;
    var tw = text.length * fontSize * 0.62 + 12;
    g.appendChild(svgEl('rect', {
      x: mx - tw / 2, y: my - fontSize * 0.8, width: tw, height: fontSize * 1.4,
      fill: '#ffffff', 'fill-opacity': 0.9, rx: 4,
    }));
    var t = svgEl('text', {
      x: mx, y: my + fontSize * 0.32,
      'text-anchor': 'middle', 'font-size': fontSize,
      fill: color, 'font-family': 'sans-serif',
    });
    t.textContent = text;
    g.appendChild(t);
    return g;
  }

  function buildPinNode(pin, el, opts) {
    opts = opts || {};
    var cat = App.catOf(el.category);
    var selected = !opts.forPrint && state.selected && state.selected.kind === 'pin' && state.selected.id === pin.id;
    var dimmed = !opts.forPrint && !el.visible;
    var g = svgEl('g', {
      transform: 'translate(' + pin.x + ',' + pin.y + ')',
      'data-kind': 'pin', 'data-id': pin.id,
      opacity: dimmed ? 0.35 : 1,
      cursor: 'pointer',
    });
    if (selected) {
      g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 30, fill: 'none', stroke: '#d32f2f', 'stroke-width': 3, 'stroke-dasharray': '6 4' }));
    }
    g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 22, fill: cat.color, stroke: '#ffffff', 'stroke-width': 3 }));
    var num = svgEl('text', {
      x: 0, y: 8, 'text-anchor': 'middle', 'font-size': 24,
      fill: '#ffffff', 'font-weight': 'bold', 'font-family': 'sans-serif',
    });
    num.textContent = App.store.pointNumber(pin.elementId); /* 番号は一覧の並び順 */
    g.appendChild(num);
    // ラベル（短縮）
    var label = el.label.length > 7 ? el.label.slice(0, 7) + '…' : el.label;
    var lw = label.length * 20 + 10;
    g.appendChild(svgEl('rect', { x: -lw / 2, y: 26, width: lw, height: 28, fill: '#ffffff', 'fill-opacity': 0.85, rx: 4 }));
    var lt = svgEl('text', {
      x: 0, y: 47, 'text-anchor': 'middle', 'font-size': 20,
      fill: '#37474f', 'font-family': 'sans-serif',
    });
    lt.textContent = label;
    g.appendChild(lt);
    return g;
  }

  /* output.js から依頼書用SVGを生成するための公開関数 */
  App.editor.renderDrawingForPrint = function (dw, filterTrade, includeBg) {
    var s = svgEl('svg', {
      xmlns: SVG_NS,
      viewBox: '0 0 ' + CANVAS_W + ' ' + CANVAS_H,
      class: 'print-drawing-svg',
    });
    buildSvgContent(dw, s, { forPrint: true, filterTrade: filterTrade, hideBg: !includeBg });
    return s;
  };

  /* ================= 画面の再描画 ================= */

  function renderTabs() {
    var bar = document.getElementById('drawing-tabs');
    var dws = App.state.drawings;
    if (state.drawingId && !App.store.getDrawing(state.drawingId)) state.drawingId = null;
    if (!state.drawingId && dws.length) state.drawingId = dws[0].id;

    bar.innerHTML = dws.map(function (d) {
      return '<button type="button" class="drawing-tab' + (d.id === state.drawingId ? ' active' : '') + '" data-dwid="' + d.id + '">' +
        '<span class="drawing-tab-type">' + App.drawingTypeLabel(d.type) + '</span> ' + App.esc(d.title) + '</button>';
    }).join('') + '<button type="button" class="drawing-tab drawing-tab-add" id="btn-add-drawing">＋ 図面追加</button>';

    bar.querySelectorAll('[data-dwid]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.drawingId = btn.getAttribute('data-dwid');
        state.selected = null;
        resetView();
        renderAll();
      });
    });
    bar.querySelector('#btn-add-drawing').addEventListener('click', openAddDrawingForm);
  }

  function renderCanvas() {
    var dw = currentDrawing();
    var emptyNote = document.getElementById('editor-empty');
    var toolbar = document.getElementById('editor-toolbar');
    var hint = document.getElementById('editor-hint');
    var stage = document.getElementById('editor-stage');
    /* 間取りが無くてもパネル（撮影ポイント一覧）は表示。キャンバス部分だけ切替 */
    document.getElementById('editor-body').style.display = '';
    if (!dw) {
      emptyNote.style.display = '';
      toolbar.style.display = 'none';
      hint.style.display = 'none';
      stage.style.display = 'none';
      return;
    }
    emptyNote.style.display = 'none';
    toolbar.style.display = '';
    hint.style.display = '';
    stage.style.display = '';
    buildSvgContent(dw, svg, {});
  }

  var DRAW_MODES = ['line', 'circle', 'rect', 'arrow', 'free', 'comment', 'dim'];
  function isDrawMode(m) { return DRAW_MODES.indexOf(m) !== -1; }

  function renderToolbar() {
    document.querySelectorAll('#editor-toolbar [data-mode]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === state.mode);
    });
    if (drawTb) drawTb.refresh();
    var hint = document.getElementById('editor-hint');
    var hints = {
      select: '書き込み・撮影ポイントをタップで選択、ドラッグで移動。丸・四角を選ぶと変形バーが出ます',
      pin: '右の一覧で撮影ポイントの「配置」を押し、間取り上の撮った場所をタップ',
      bg: '間取り画像をドラッグで移動できます。拡大縮小・位置合わせは右のパネルから',
      delete: '削除したい書き込み・撮影ポイントをタップ（撮影ポイントを外しても要素データは残ります）',
      line: 'ドラッグで線を引きます', circle: 'ドラッグで丸を描きます', rect: 'ドラッグで四角を描きます',
      arrow: 'ドラッグで矢印を描きます', free: 'ドラッグで手書きします',
      comment: 'タップした位置にコメント（文字）を置きます', dim: 'ドラッグで寸法線を引き、数値を入力します',
    };
    hint.textContent = hints[state.mode] || '';
  }

  function selectedAnnot() {
    var dw = currentDrawing();
    if (!dw || !state.selected || state.selected.kind !== 'annot') return null;
    return (dw.annotations || []).find(function (a) { return a.id === state.selected.id; }) || null;
  }

  function renderPanel() {
    var panel = document.getElementById('editor-panel');
    var dw = currentDrawing();
    var html = '';

    /* 撮影ポイント一覧（間取りの有無に関わらず常時表示）：並び替え・配置・編集。
       番号は一覧の並び順（pointNumber）。↑↓で入れ替え→全画面に反映 */
    var total = App.state.elements.length;
    var items = App.state.elements.map(function (el, idx) {
      var cat = App.catOf(el.category);
      var num = App.store.pointNumber(el.id);
      var placed = App.store.isPlaced(el.id);
      var placing = state.pinElementId === el.id;
      var upDis = idx === 0 ? ' disabled' : '';
      var downDis = idx === total - 1 ? ' disabled' : '';
      return '<div class="point-row' + (placing ? ' placing' : '') + '" data-elid="' + el.id + '">' +
        '<span class="point-reorder">' +
          '<button type="button" class="point-move" data-moveup="' + el.id + '"' + upDis + ' title="上へ">▲</button>' +
          '<button type="button" class="point-move" data-movedown="' + el.id + '"' + downDis + ' title="下へ">▼</button>' +
        '</span>' +
        '<span class="point-num" style="background:' + cat.color + '">' + num + '</span>' +
        '<span class="point-label">' + App.esc(el.label || '(名称未設定)') +
          '<span class="point-meta">📷' + el.photos.length + (placed ? '' : ' <span class="unplaced">未配置</span>') + '</span></span>' +
        '<button type="button" class="point-act" data-place="' + el.id + '">' + (placed ? '移動' : '配置') + '</button>' +
        '<button type="button" class="point-act" data-editel="' + el.id + '">編集</button>' +
      '</div>';
    }).join('');
    html += '<div class="panel-section"><h3>撮影ポイント</h3>' +
      '<button type="button" class="btn btn-primary" id="btn-add-point">＋ 撮影ポイントを追加</button>' +
      '<div class="point-list">' + (items || '<p class="muted">まだありません。「＋撮影ポイントを追加」から。</p>') + '</div>' +
      (dw ? '' : '<p class="muted panel-note">間取りを追加すると、ここから間取り上にピンを配置できます。</p>') +
      '</div>';

    /* 選択オブジェクトのプロパティ */
    if (dw && state.selected) {
      html += '<div class="panel-section"><h3>選択中</h3>';
      if (state.selected.kind === 'dim') {
        var dm = dw.dims.find(function (d) { return d.id === state.selected.id; });
        if (dm) {
          html += '<label class="field"><span class="field-label">寸法テキスト</span>' +
            '<input type="text" id="panel-dim-text" value="' + App.esc(dm.text) + '"></label>';
        }
      }
      if (state.selected.kind === 'pin') {
        var pin = dw.pins.find(function (p) { return p.id === state.selected.id; });
        var pel = pin && App.store.getElement(pin.elementId);
        if (pel) html += '<p class="panel-note">撮影ポイント ' + pin.num + '：' + App.esc(pel.label) + '</p>' +
          '<button type="button" class="btn" id="panel-show-card">情報カードを表示</button>';
      }
      html += '<button type="button" class="btn btn-danger" id="panel-delete">選択中を削除</button></div>';
    }

    if (dw) {
      /* 間取り画像（背景） */
      html += '<div class="panel-section"><h3>間取り画像（背景）</h3>';
      if (dw.background.dataUrl) {
        html +=
          '<div class="bg-zoom-row">' +
            '<button type="button" class="btn btn-small" id="btn-bg-zoom-out">－ 縮小</button>' +
            '<button type="button" class="btn btn-small" id="btn-bg-zoom-in">＋ 拡大</button>' +
            '<button type="button" class="btn btn-small" id="btn-bg-fit">⤢ 全体に合わせる</button>' +
          '</div>' +
          '<p class="muted panel-note">「🖼 背景」ツールでドラッグすると位置を移動できます</p>' +
          '<label class="field"><span class="field-label">透過度 <span id="bg-op-val">' +
          Math.round(dw.background.opacity * 100) + '%</span></span>' +
          '<input type="range" id="bg-opacity" min="5" max="100" value="' + Math.round(dw.background.opacity * 100) + '"></label>' +
          '<button type="button" class="btn" id="btn-bg-remove">間取り画像を外す</button>';
      } else {
        html += '<button type="button" class="btn" id="btn-bg-set">🖼 間取り画像を設定</button>';
      }
      html += '<input type="file" id="bg-input" accept="image/*" hidden></div>';

      /* 図面操作 */
      html += '<div class="panel-section"><h3>間取り図</h3>' +
        '<button type="button" class="btn btn-danger" id="btn-del-drawing">この間取りを削除</button></div>';
    }

    panel.innerHTML = html;

    /* --- パネル内イベント --- */
    var addPointBtn = panel.querySelector('#btn-add-point');
    if (addPointBtn) {
      addPointBtn.addEventListener('click', function () { App.input.openForm(null); });
    }
    panel.querySelectorAll('[data-moveup]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.store.moveElement(btn.getAttribute('data-moveup'), -1); });
    });
    panel.querySelectorAll('[data-movedown]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.store.moveElement(btn.getAttribute('data-movedown'), 1); });
    });
    panel.querySelectorAll('[data-place]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!currentDrawing()) {
          App.ui.toast('先に「＋間取りを追加」で間取り図を用意してください');
          return;
        }
        state.mode = 'pin';
        state.pinElementId = btn.getAttribute('data-place');
        renderToolbar();
        renderPanel();
        App.ui.toast('間取り上のその場所をタップして配置してください');
      });
    });
    panel.querySelectorAll('[data-editel]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.input.openForm(btn.getAttribute('data-editel')); });
    });

    var dimText = panel.querySelector('#panel-dim-text');
    if (dimText) {
      dimText.addEventListener('change', function () {
        var dm = dw.dims.find(function (d) { return d.id === state.selected.id; });
        if (dm) { dm.text = dimText.value.trim(); App.store.commit(); }
      });
    }

    var showCard = panel.querySelector('#panel-show-card');
    if (showCard) {
      showCard.addEventListener('click', function () {
        var pin = dw.pins.find(function (p) { return p.id === state.selected.id; });
        if (pin) App.card.show(pin.elementId, { pinId: pin.id, drawingId: dw.id });
      });
    }

    var delBtn = panel.querySelector('#panel-delete');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        deleteSelected();
      });
    }

    var bgInput = panel.querySelector('#bg-input');
    var bgSet = panel.querySelector('#btn-bg-set');
    if (bgSet) {
      bgSet.addEventListener('click', function () { bgInput.click(); });
    }
    if (bgInput) {
      bgInput.addEventListener('change', function () {
        var file = bgInput.files[0];
        bgInput.value = '';
        if (!file) return;
        App.ui.toast('間取り画像を取り込み中…');
        App.photo.fileToDataUrlSized(file, 1600, 0.75).then(function (r) {
          dw.background.dataUrl = r.dataUrl;
          dw.background.naturalW = r.width;
          dw.background.naturalH = r.height;
          fitBackground(dw);  /* 読み込んだらまず画面いっぱいにフィット配置 */
          App.store.commit();
        }).catch(function (err) { App.ui.toast('⚠ ' + err.message); });
      });
    }
    var bgOpacity = panel.querySelector('#bg-opacity');
    if (bgOpacity) {
      bgOpacity.addEventListener('input', function () {
        dw.background.opacity = Number(bgOpacity.value) / 100;
        panel.querySelector('#bg-op-val').textContent = bgOpacity.value + '%';
        var img = svg.querySelector('[data-kind="bg"]');
        if (img) img.setAttribute('opacity', dw.background.opacity);
      });
      bgOpacity.addEventListener('change', function () { App.store.commit(); });
    }
    var bgRemove = panel.querySelector('#btn-bg-remove');
    if (bgRemove) {
      bgRemove.addEventListener('click', function () {
        dw.background.dataUrl = null;
        App.store.commit();
      });
    }
    var bgZoomIn = panel.querySelector('#btn-bg-zoom-in');
    if (bgZoomIn) bgZoomIn.addEventListener('click', function () { scaleBackground(dw, 1.15); });
    var bgZoomOut = panel.querySelector('#btn-bg-zoom-out');
    if (bgZoomOut) bgZoomOut.addEventListener('click', function () { scaleBackground(dw, 1 / 1.15); });
    var bgFitBtn = panel.querySelector('#btn-bg-fit');
    if (bgFitBtn) bgFitBtn.addEventListener('click', function () { fitBackground(dw); App.store.commit(); });

    var delDrawingBtn = panel.querySelector('#btn-del-drawing');
    if (delDrawingBtn) {
      delDrawingBtn.addEventListener('click', function () {
        App.ui.confirm('間取り「' + dw.title + '」を削除しますか？（ピン・線・寸法も消えます。撮影ポイントの写真データは残ります）').then(function (ok) {
          if (!ok) return;
          App.store.deleteDrawing(dw.id);
          state.drawingId = null;
          state.selected = null;
        });
      });
    }
  }

  /* 間取り画像をキャンバス全体にフィット（アスペクト比維持・中央寄せ） */
  function fitBackground(dw) {
    var bg = dw.background;
    var w = bg.naturalW || CANVAS_W, h = bg.naturalH || CANVAS_H;
    var scale = Math.min(CANVAS_W / w, CANVAS_H / h);
    bg.scale = scale;
    bg.x = round1((CANVAS_W - w * scale) / 2);
    bg.y = round1((CANVAS_H - h * scale) / 2);
    renderCanvas();
  }

  /* 中心位置を保ったまま拡縮（ボタン方式。ホイール/ピンチは使わない） */
  function scaleBackground(dw, factor) {
    var bg = dw.background;
    var w = bg.naturalW || CANVAS_W, h = bg.naturalH || CANVAS_H;
    var oldScale = bg.scale || 1;
    var newScale = Math.max(0.1, Math.min(8, oldScale * factor));
    var cx = bg.x + w * oldScale / 2, cy = bg.y + h * oldScale / 2;
    bg.scale = newScale;
    bg.x = round1(cx - w * newScale / 2);
    bg.y = round1(cy - h * newScale / 2);
    renderCanvas();
    App.store.commit();
  }

  function renderAll() {
    renderTabs();
    renderToolbar();
    renderCanvas();
    renderPanel();
  }

  /* 対象1つを即削除（削除ツール用）。ピンは紐付け解除のみで要素データは消えない */
  function deleteObject(dw, kind, id) {
    var label = '';
    if (kind === 'stroke') {
      dw.strokes = dw.strokes.filter(function (s) { return s.id !== id; });
      label = '線を削除しました';
    }
    if (kind === 'dim') {
      dw.dims = dw.dims.filter(function (d) { return d.id !== id; });
      label = '寸法を削除しました';
    }
    if (kind === 'annot') {
      dw.annotations = (dw.annotations || []).filter(function (a) { return a.id !== id; });
      label = '書き込みを削除しました';
    }
    if (kind === 'pin') {
      var pin = dw.pins.find(function (p) { return p.id === id; });
      var el = pin && App.store.getElement(pin.elementId);
      dw.pins = dw.pins.filter(function (p) { return p.id !== id; });
      label = 'ピン' + (el ? '「' + el.label + '」' : '') + 'を外しました（要素データは残っています）';
    }
    if (state.selected && state.selected.kind === kind && state.selected.id === id) {
      state.selected = null;
    }
    App.store.commit();
    if (label) App.ui.toast(label);
  }

  function deleteSelected() {
    var dw = currentDrawing();
    if (!dw || !state.selected) return;
    var sel = state.selected;
    if (sel.kind === 'pin') {
      App.ui.confirm('このピンを図面から外しますか？（要素データは残ります）').then(function (ok) {
        if (ok) deleteObject(dw, sel.kind, sel.id);
      });
    } else {
      deleteObject(dw, sel.kind, sel.id);
    }
  }

  /* ================= 図面追加フォーム ================= */
  function openAddDrawingForm() {
    var typeRadios = App.DRAWING_TYPES.map(function (t, i) {
      return '<label class="seg-item"><input type="radio" name="dw-type" value="' + t.key + '"' +
        (i === 0 ? ' checked' : '') + '><span>' + t.label + '</span></label>';
    }).join('');
    var box = document.createElement('div');
    box.innerHTML =
      '<h2 class="modal-title">図面を追加</h2>' +
      '<div class="field"><span class="field-label">種別</span><div class="seg">' + typeRadios + '</div></div>' +
      '<label class="field"><span class="field-label">図面名</span>' +
        '<input type="text" id="dw-title" placeholder="例：LDK 平面図"></label>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="close">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">追加</button>' +
      '</div>';
    var overlay = App.ui.openModal(box);
    box.querySelector('[data-act="close"]').addEventListener('click', function () { App.ui.closeModal(overlay); });
    box.querySelector('[data-act="save"]').addEventListener('click', function () {
      var type = box.querySelector('input[name="dw-type"]:checked').value;
      var title = box.querySelector('#dw-title').value.trim() || App.drawingTypeLabel(type);
      var dw = App.store.addDrawing(type, title);
      state.drawingId = dw.id;
      resetView();
      App.ui.closeModal(overlay);
    });
  }

  /* ================= ポインタ操作 ================= */

  var CLICK_THRESHOLD = 5; // これ未満の移動はクリック扱い

  function snapLine(x1, y1, x2, y2) {
    var dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dy <= dx * 0.12) return { x2: x2, y2: y1 };  // 水平
    if (dx <= dy * 0.12) return { x2: x1, y2: y2 };  // 垂直
    return { x2: x2, y2: y2 };
  }

  function onPointerDown(e) {
    var dw = currentDrawing();
    if (!dw) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント等では失敗しても続行 */ }
    var pt = toSvg(e);

    /* ハンドル優先（選択中の書き込みの図形操作） */
    var hEl = e.target.closest('[data-handle]');
    if (hEl && state.selected && state.selected.kind === 'annot' && hEl.getAttribute('data-annid') === state.selected.id) {
      state.drag = { type: 'annotHandle', role: hEl.getAttribute('data-handle'), orig: snapshotObject(dw, 'annot', state.selected.id) };
      return;
    }

    if (isDrawMode(state.mode)) {
      var draft = App.draw.beginDraft(state.mode, state.color, state.width, pt);
      state.drag = { type: 'annotDraw', draft: draft };
      repaintAnnots(previewNodeFor(draft));
      return;
    }

    if (state.mode === 'pin') {
      if (!state.pinElementId) {
        App.ui.toast('先に右の「配置する要素」から要素を選んでください');
        return;
      }
      placePin(dw, state.pinElementId, pt.x, pt.y);
      return;
    }

    if (state.mode === 'delete') {
      var annDel = e.target.closest('[data-annid]');
      if (annDel) { deleteObject(dw, 'annot', annDel.getAttribute('data-annid')); return; }
      var delTarget = e.target.closest('[data-kind][data-id]');
      if (delTarget) {
        deleteObject(dw, delTarget.getAttribute('data-kind'), delTarget.getAttribute('data-id'));
      }
      return;
    }

    if (state.mode === 'bg') {
      if (!dw.background.dataUrl) {
        App.ui.toast('先に右のパネルで間取り画像を設定してください');
        return;
      }
      state.drag = {
        type: 'bg-pan', startX: pt.x, startY: pt.y,
        orig: { x: dw.background.x || 0, y: dw.background.y || 0 },
        moved: false,
      };
      return;
    }

    /* select */
    var annSel = e.target.closest('[data-annid]');
    if (annSel) {
      var aid = annSel.getAttribute('data-annid');
      var already = state.selected && state.selected.kind === 'annot' && state.selected.id === aid;
      state.selected = { kind: 'annot', id: aid };
      repaintAnnots(); /* ハンドル表示 */
      state.drag = {
        type: 'move', kind: 'annot', id: aid,
        startX: pt.x, startY: pt.y, moved: false, unit: unitNow(), already: already,
        orig: snapshotObject(dw, 'annot', aid),
      };
      return;
    }
    var target = e.target.closest('[data-kind][data-id]');
    if (target) {
      var kind = target.getAttribute('data-kind');
      var id = target.getAttribute('data-id');
      state.drag = {
        type: 'move', kind: kind, id: id,
        startX: pt.x, startY: pt.y, moved: false,
        orig: snapshotObject(dw, kind, id),
        node: target,
      };
    } else {
      if (state.selected) {
        state.selected = null;
        renderCanvas();
        renderPanel();
        renderToolbar();
      }
    }
  }

  function snapshotObject(dw, kind, id) {
    if (kind === 'stroke') {
      var st = dw.strokes.find(function (s) { return s.id === id; });
      return st ? { x1: st.x1, y1: st.y1, x2: st.x2, y2: st.y2 } : null;
    }
    if (kind === 'dim') {
      var dm = dw.dims.find(function (d) { return d.id === id; });
      return dm ? { x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2 } : null;
    }
    if (kind === 'pin') {
      var p = dw.pins.find(function (p) { return p.id === id; });
      return p ? { x: p.x, y: p.y } : null;
    }
    if (kind === 'annot') {
      var an = (dw.annotations || []).find(function (a) { return a.id === id; });
      return an ? JSON.parse(JSON.stringify(an)) : null;
    }
    return null;
  }

  function onPointerMove(e) {
    if (!state.drag) return;
    var dw = currentDrawing();
    if (!dw) return;
    e.preventDefault();
    var pt = toSvg(e);
    var drag = state.drag;

    if (drag.type === 'annotDraw') {
      App.draw.updateDraft(drag.draft, pt);
      repaintAnnots(previewNodeFor(drag.draft));
      return;
    }

    if (drag.type === 'annotHandle') {
      var ha = selectedAnnot();
      if (ha) { App.draw.applyHandleDrag(ha, drag.role, pt, drag.orig, CANVAS_W, CANVAS_H); repaintAnnots(); }
      return;
    }

    if (drag.type === 'bg-pan') {
      var bdx = pt.x - drag.startX, bdy = pt.y - drag.startY;
      if (Math.sqrt(bdx * bdx + bdy * bdy) > CLICK_THRESHOLD) drag.moved = true;
      if (!drag.moved) return;
      dw.background.x = drag.orig.x + bdx;
      dw.background.y = drag.orig.y + bdy;
      var bgNode = svg.querySelector('[data-kind="bg"]');
      if (bgNode) {
        bgNode.setAttribute('x', dw.background.x);
        bgNode.setAttribute('y', dw.background.y);
      }
      return;
    }

    if (drag.type === 'move' && drag.orig) {
      var dx = pt.x - drag.startX, dy = pt.y - drag.startY;
      if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === 'pin') {
        var p = dw.pins.find(function (p) { return p.id === drag.id; });
        if (p) {
          p.x = drag.orig.x + dx; p.y = drag.orig.y + dy;
          drag.node.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
        }
      } else if (drag.kind === 'annot') {
        var an = (dw.annotations || []).find(function (a) { return a.id === drag.id; });
        if (an && drag.orig) {
          var fresh = JSON.parse(JSON.stringify(drag.orig));
          for (var k in fresh) an[k] = fresh[k];
          App.draw.translate(an, dx, dy);
          repaintAnnots();
        }
      } else {
        var obj = drag.kind === 'stroke'
          ? dw.strokes.find(function (s) { return s.id === drag.id; })
          : dw.dims.find(function (d) { return d.id === drag.id; });
        if (obj) {
          obj.x1 = drag.orig.x1 + dx; obj.y1 = drag.orig.y1 + dy;
          obj.x2 = drag.orig.x2 + dx; obj.y2 = drag.orig.y2 + dy;
          renderCanvas(); // 寸法はティック・テキストが連動するため再描画
        }
      }
    }
  }

  function onPointerUp(e) {
    var drag = state.drag;
    state.drag = null;
    if (!drag) return;
    var dw = currentDrawing();
    if (!dw) return;

    if (drag.type === 'bg-pan') {
      if (drag.moved) App.store.commit();
      return;
    }

    if (drag.type === 'annotHandle') {
      App.store.commit();
      return;
    }

    if (drag.type === 'annotDraw') {
      var d = drag.draft;
      var type = d.type;
      if (type === 'comment') {
        App.ui.promptMultiline('コメントを入力', '').then(function (text) {
          if (text == null || text.trim() === '') { repaintAnnots(); return; }
          var cm = App.draw.commentMetrics({ type: 'comment', width: d.width, x: d.x, y: d.y, text: text }, CANVAS_W, CANVAS_H);
          dw.annotations.push({ id: App.uid('an'), type: 'comment', color: d.color, width: d.width, x: round1(d.x), y: round1(d.y), w: cm.w, fontPx: cm.fontPx, text: text });
          App.store.commit();
        });
        return;
      }
      var geom = App.draw.draftToGeom(d);
      if (!geom) { repaintAnnots(); return; }
      geom.id = App.uid('an');
      roundGeom(geom);
      if (type === 'dim') {
        repaintAnnots(App.draw.buildNode(Object.assign({}, geom, { id: '_draft' }), CANVAS_W, CANVAS_H, {}));
        App.ui.prompt('寸法の数値を入力（例：910）', '').then(function (val) {
          if (val == null || val === '') { repaintAnnots(); return; }
          geom.text = val; dw.annotations.push(geom); App.store.commit();
        });
        return;
      }
      dw.annotations.push(geom); App.store.commit();
      return;
    }

    if (drag.type === 'move') {
      if (drag.moved) {
        App.store.commit();
        return;
      }
      /* 書き込みは既に選択済み。コメント再タップでテキスト編集 */
      if (drag.kind === 'annot') {
        if (drag.already) {
          var an = (dw.annotations || []).find(function (a) { return a.id === drag.id; });
          if (an && an.type === 'comment') editAnnotCommentText(an);
        }
        return;
      }
      /* クリック（移動なし）→ 選択。ピンは情報カードを表示 */
      state.selected = { kind: drag.kind, id: drag.id };
      renderCanvas();
      renderPanel();
      renderToolbar();
      if (drag.kind === 'pin') {
        var pin = dw.pins.find(function (p) { return p.id === drag.id; });
        if (pin) App.card.show(pin.elementId, { pinId: pin.id, drawingId: dw.id });
      }
      if (drag.kind === 'dim') {
        var dmSel = dw.dims.find(function (d) { return d.id === drag.id; });
        if (dmSel) openDimInput(dw, dmSel);
      }
    }
  }

  function dist(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  function roundGeom(g) {
    ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'].forEach(function (k) { if (g[k] != null) g[k] = round1(g[k]); });
    if (g.points) g.points = g.points.map(function (p) { return [round1(p[0]), round1(p[1])]; });
    return g;
  }

  function unitNow() { var m = svg.getScreenCTM(); return m ? 1 / m.a : 1; }

  /* 書き込みレイヤーだけ軽量に再描画（背景を再構築しないため作図中も軽い） */
  function repaintAnnots(draftNode) {
    var g = svg.querySelector('#layer-annots');
    var dw = currentDrawing();
    if (!g || !dw) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    App.draw.renderInto(g, CANVAS_W, CANVAS_H, dw.annotations || [], { interactive: true });
    var sel = selectedAnnot();
    if (sel) App.draw.renderHandles(g, sel, CANVAS_W, CANVAS_H, unitNow());
    if (draftNode) g.appendChild(draftNode);
  }
  function previewNodeFor(draft) {
    var d = App.draw.draftPreview(draft);
    return d ? App.draw.buildNode(d, CANVAS_W, CANVAS_H, {}) : null;
  }

  function editAnnotCommentText(a) {
    App.ui.promptMultiline('コメントを編集', a.text || '').then(function (text) {
      if (text == null) return;
      a.text = text; App.store.commit();
    });
  }

  /* ツール切替（静的ボタン・共通ツールバー共用） */
  function setMode(mode) {
    state.mode = mode;
    if (mode !== 'pin') state.pinElementId = null;
    if (mode !== 'select') state.selected = null;
    renderToolbar();
    renderPanel();
    renderCanvas();
  }

  function placePin(dw, elementId, x, y) {
    if (!App.store.getElement(elementId)) {
      /* 物件切替などで要素が存在しなくなった場合 */
      state.pinElementId = null;
      renderPanel();
      App.ui.toast('要素を選び直してください');
      return;
    }
    var existing = dw.pins.find(function (p) { return p.elementId === elementId; });
    if (existing) {
      existing.x = round1(x); existing.y = round1(y);
      App.ui.toast('ピンを移動しました');
    } else {
      var maxNum = dw.pins.reduce(function (m, p) { return Math.max(m, p.num); }, 0);
      dw.pins.push({
        id: App.uid('pin'), elementId: elementId,
        x: round1(x), y: round1(y), num: maxNum + 1,
      });
      var el = App.store.getElement(elementId);
      App.ui.toast('「' + (el ? el.label : '') + '」を配置しました');
    }
    App.store.commit();
  }

  /* 寸法テキストのインライン入力 */
  function openDimInput(dw, dm) {
    var mx = (dm.x1 + dm.x2) / 2, my = (dm.y1 + dm.y2) / 2;
    var sp = toScreen(mx, my);
    var wrapRect = wrap.getBoundingClientRect();
    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.className = 'dim-inline-input';
    input.placeholder = '寸法(mm)';
    input.value = dm.text || '';
    input.style.left = (sp.x - wrapRect.left - 55) + 'px';
    input.style.top = (sp.y - wrapRect.top - 18) + 'px';
    wrap.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      input.remove();
      if (save && v) {
        dm.text = v;
        App.store.commit();
      } else if (!dm.text) {
        /* テキストなしの新規寸法はキャンセル扱いで削除 */
        dw.dims = dw.dims.filter(function (d) { return d.id !== dm.id; });
        App.store.commit();
      } else {
        renderCanvas();
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  /* ================= 初期化 ================= */
  App.editor.init = function () {
    svg = document.getElementById('editor-svg');
    wrap = document.getElementById('editor-stage');
    resetView();

    document.querySelectorAll('#editor-toolbar [data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
    });

    /* 共通描画ツールバー（写真側と統一）＋変形バー */
    drawTb = App.draw.buildToolbar(document.getElementById('editor-drawtools'), {
      getTool: function () {
        if (!isDrawMode(state.mode)) return null;
        return (state.mode === 'line' || state.mode === 'circle' || state.mode === 'rect') ? 'shape' : state.mode;
      },
      setTool: function (t) { setMode(t === 'shape' ? (state.shapeSub || 'circle') : t); },
      getShapeSub: function () { return state.shapeSub; },
      setShapeSub: function (s) { state.shapeSub = s; setMode(s); },
      getColor: function () { return state.color; },
      setColor: function (c) { state.color = c; var a = selectedAnnot(); if (a) { a.color = c; App.store.commit(); } },
      getWidth: function () { return state.width; },
      setWidth: function (w) { state.width = w; var a = selectedAnnot(); if (a) { a.width = w; App.store.commit(); } },
    });
    document.getElementById('btn-zoom-in').addEventListener('click', function () { zoom(1 / 1.4); });
    document.getElementById('btn-zoom-out').addEventListener('click', function () { zoom(1.4); });
    document.getElementById('btn-zoom-fit').addEventListener('click', resetView);
    document.getElementById('btn-add-drawing-empty').addEventListener('click', openAddDrawingForm);

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    document.addEventListener('keydown', function (e) {
      if (App.ui.currentTab() !== 'map') return;
      if (e.target.matches('input, textarea, select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
        e.preventDefault();
        deleteSelected();
      }
    });

    App.events.on('change', function () {
      if (App.ui.currentTab() === 'map') renderAll();
    });
    App.events.on('tab', function (tab) {
      if (tab === 'map') renderAll();
    });
    renderAll();
  };
})();
