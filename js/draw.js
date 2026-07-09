/* 共通の書き込み描画コア（写真=依頼先タブ／間取り=作図 で共用）。
   注釈型：line / circle / rect / arrow / free / comment / dim
   共通プロパティ：{ id, type, color, width('thin'|'medium'|'thick') }
   丸・四角は angle(度) を持ち、回転・つぶし・サイズ変更が可能。 */
window.App = window.App || {};

(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  App.draw = App.draw || {};

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  App.draw.svgEl = svgEl;

  var WIDTHS = { thin: 0.55, medium: 1, thick: 1.9 };
  App.draw.WIDTH_KEYS = ['thin', 'medium', 'thick'];
  App.draw.WIDTH_LABELS = { thin: '細', medium: '中', thick: '太' };
  function widthMul(w) { return WIDTHS[w] || WIDTHS.medium; }

  function baseStroke(W, H) { return Math.max(2, Math.round(Math.max(W, H) / 200)); }
  function fontSize(W, H) { return Math.max(12, Math.round(Math.max(W, H) / 26)); }

  App.draw.isShape = function (t) { return t === 'circle' || t === 'rect'; };
  App.draw.hasText = function (t) { return t === 'dim' || t === 'comment'; };

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---- 四角：4頂点(quad)。旧データ(x/y/w/h/angle)からは導出 ---- */
  function rectQuad(a) {
    if (a.quad && a.quad.length === 4) return a.quad;
    var x = a.x, y = a.y, w = a.w, h = a.h, ang = (a.angle || 0) * Math.PI / 180;
    var cx = x + w / 2, cy = y + h / 2;
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * Math.cos(ang) - dy * Math.sin(ang), cy + dx * Math.sin(ang) + dy * Math.cos(ang)];
    });
  }
  App.draw.rectQuad = rectQuad;
  App.draw.ensureQuad = function (a) {
    if (!(a.quad && a.quad.length === 4)) a.quad = rectQuad(a).map(function (p) { return [round1(p[0]), round1(p[1])]; });
    return a.quad;
  };

  /* ---- コメント：折り返し・寸法計算 ---- */
  function charW(ch, fontPx) { return /[\x00-\xFF]/.test(ch) ? fontPx * 0.55 : fontPx; }
  function wrapText(text, fontPx, maxW) {
    var out = [];
    String(text == null ? '' : text).split('\n').forEach(function (para) {
      if (para === '') { out.push(''); return; }
      var line = '', w = 0;
      for (var i = 0; i < para.length; i++) {
        var cw = charW(para[i], fontPx);
        if (w + cw > maxW && line !== '') { out.push(line); line = para[i]; w = cw; }
        else { line += para[i]; w += cw; }
      }
      out.push(line);
    });
    return out.length ? out : [''];
  }
  App.draw.wrapText = wrapText;

  function commentMetrics(a, W, H) {
    var fontPx = a.fontPx || (fontSize(W, H) * (a.width === 'thin' ? 0.85 : a.width === 'thick' ? 1.35 : 1.05));
    var pad = fontPx * 0.4;
    var w = a.w;
    if (w == null) {
      var single = 0, tx = String(a.text == null ? '' : a.text).split('\n')[0] || '';
      for (var i = 0; i < tx.length; i++) single += charW(tx[i], fontPx);
      w = Math.max(fontPx * 4, single + pad * 2);
    }
    var lines = wrapText(a.text, fontPx, Math.max(fontPx, w - pad * 2));
    var lineH = fontPx * 1.35;
    var boxH = pad * 2 + lines.length * lineH;
    return { fontPx: fontPx, w: w, pad: pad, lines: lines, lineH: lineH, boxH: boxH };
  }
  App.draw.commentMetrics = commentMetrics;

  /* ---- 1件の注釈を <g data-annid> として構築 ---- */
  App.draw.buildNode = function (a, W, H, opts) {
    opts = opts || {};
    var interactive = opts.interactive;
    var sw = baseStroke(W, H) * widthMul(a.width);
    var fs = fontSize(W, H);
    var color = a.color || '#e53935';
    var g = svgEl('g', { 'data-annid': a.id });

    /* 丸のみ中心まわりに回転（四角はquadで表現） */
    if (a.type === 'circle' && a.angle) {
      var rcx = a.x + a.w / 2, rcy = a.y + a.h / 2;
      g.setAttribute('transform', 'rotate(' + a.angle + ' ' + rcx + ' ' + rcy + ')');
    }

    if (a.type === 'line') {
      g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round' }));
      if (interactive) g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'rgba(0,0,0,0)', 'stroke-width': sw + 22 }));

    } else if (a.type === 'arrow') {
      g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round' }));
      var ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      var hl = sw * 4.5;
      var p1 = [a.x2 - hl * Math.cos(ang - 0.42), a.y2 - hl * Math.sin(ang - 0.42)];
      var p2 = [a.x2 - hl * Math.cos(ang + 0.42), a.y2 - hl * Math.sin(ang + 0.42)];
      g.appendChild(svgEl('polygon', { points: a.x2 + ',' + a.y2 + ' ' + p1[0] + ',' + p1[1] + ' ' + p2[0] + ',' + p2[1], fill: color }));
      if (interactive) g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'rgba(0,0,0,0)', 'stroke-width': sw + 22 }));

    } else if (a.type === 'circle') {
      var ecx = a.x + a.w / 2, ecy = a.y + a.h / 2;
      g.appendChild(svgEl('ellipse', { cx: ecx, cy: ecy, rx: Math.abs(a.w) / 2, ry: Math.abs(a.h) / 2, fill: 'none', stroke: color, 'stroke-width': sw }));
      if (interactive) g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: Math.abs(a.w), height: Math.abs(a.h), fill: 'rgba(0,0,0,0)' }));

    } else if (a.type === 'rect') {
      var q = rectQuad(a);
      var qs = q.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      g.appendChild(svgEl('polygon', { points: qs, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linejoin': 'round' }));
      if (interactive) g.appendChild(svgEl('polygon', { points: qs, fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', 'stroke-width': sw + 22 }));

    } else if (a.type === 'free') {
      var pts = (a.points || []).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      g.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      if (interactive) g.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': sw + 22 }));

    } else if (a.type === 'comment') {
      var m = commentMetrics(a, W, H);
      g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: m.w, height: m.boxH, fill: '#ffffff', 'fill-opacity': 0.92, stroke: color, 'stroke-width': Math.max(1.5, sw * 0.5), rx: m.fontPx * 0.2 }));
      m.lines.forEach(function (line, i) {
        var t = svgEl('text', { x: a.x + m.pad, y: a.y + m.pad + (i + 0.82) * m.lineH, 'font-size': m.fontPx, fill: color, 'font-family': 'sans-serif', 'font-weight': 'bold' });
        t.textContent = line;
        g.appendChild(t);
      });

    } else if (a.type === 'dim') {
      var dx = a.x2 - a.x1, dy = a.y2 - a.y1;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var px = -dy / len, py = dx / len;
      var tick = sw * 3;
      g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: color, 'stroke-width': sw }));
      [[a.x1, a.y1], [a.x2, a.y2]].forEach(function (p) {
        g.appendChild(svgEl('line', { x1: p[0] - px * tick, y1: p[1] - py * tick, x2: p[0] + px * tick, y2: p[1] + py * tick, stroke: color, 'stroke-width': sw }));
      });
      var mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
      var dtext = a.text || '?';
      var dtw = dtext.length * fs * 0.62 + fs * 0.5;
      g.appendChild(svgEl('rect', { x: mx - dtw / 2, y: my - fs * 0.8, width: dtw, height: fs * 1.4, fill: '#ffffff', 'fill-opacity': 0.85, rx: fs * 0.2 }));
      var dt = svgEl('text', { x: mx, y: my + fs * 0.34, 'text-anchor': 'middle', 'font-size': fs, fill: color, 'font-family': 'sans-serif', 'font-weight': 'bold' });
      dt.textContent = dtext;
      g.appendChild(dt);
      if (interactive) g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'rgba(0,0,0,0)', 'stroke-width': sw + 22 }));
    }
    return g;
  };

  App.draw.bbox = function (a) {
    if (a.type === 'circle' || a.type === 'rect' || a.type === 'comment') {
      return { x: a.x, y: a.y, w: a.w || 10, h: a.h || 10 };
    }
    if (a.type === 'free') {
      var xs = a.points.map(function (p) { return p[0]; });
      var ys = a.points.map(function (p) { return p[1]; });
      var minx = Math.min.apply(null, xs), miny = Math.min.apply(null, ys);
      return { x: minx, y: miny, w: Math.max.apply(null, xs) - minx, h: Math.max.apply(null, ys) - miny };
    }
    var x1 = Math.min(a.x1, a.x2), y1 = Math.min(a.y1, a.y2);
    return { x: x1, y: y1, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  };

  /* svgにレイヤーを描画。opts:{interactive,selectedId} */
  App.draw.renderInto = function (svg, W, H, list, opts) {
    opts = opts || {};
    (list || []).forEach(function (a) {
      svg.appendChild(App.draw.buildNode(a, W, H, {
        interactive: opts.interactive,
        selected: opts.selectedId && a.id === opts.selectedId,
      }));
    });
  };

  /* ---- 作図の下書き ---- */
  App.draw.resolveType = function (tool, shapeSub) {
    if (tool === 'shape') return shapeSub || 'circle';
    return tool;
  };

  App.draw.beginDraft = function (type, color, width, pt) {
    if (type === 'free') return { type: 'free', color: color, width: width, points: [[pt.x, pt.y]] };
    if (type === 'comment') return { type: 'comment', color: color, width: width, x: pt.x, y: pt.y };
    return { type: type, color: color, width: width, sx: pt.x, sy: pt.y, cx: pt.x, cy: pt.y };
  };

  App.draw.updateDraft = function (draft, pt) {
    if (draft.type === 'free') draft.points.push([pt.x, pt.y]);
    else if (draft.type !== 'comment') { draft.cx = pt.x; draft.cy = pt.y; }
  };

  /* 下書き→注釈geom（id無し）。小さすぎる場合はnull。commentはtext未確定 */
  App.draw.draftToGeom = function (draft) {
    var t = draft.type;
    if (t === 'free') {
      if (draft.points.length < 2) return null;
      return { type: 'free', color: draft.color, width: draft.width, points: draft.points.slice() };
    }
    if (t === 'comment') {
      return { type: 'comment', color: draft.color, width: draft.width, x: draft.x, y: draft.y };
    }
    if (t === 'circle' || t === 'rect') {
      var x = Math.min(draft.sx, draft.cx), y = Math.min(draft.sy, draft.cy);
      var w = Math.abs(draft.cx - draft.sx), h = Math.abs(draft.cy - draft.sy);
      if (w < 5 && h < 5) return null;
      return { type: t, color: draft.color, width: draft.width, x: x, y: y, w: w, h: h, angle: 0 };
    }
    var dx = draft.cx - draft.sx, dy = draft.cy - draft.sy;
    if (Math.sqrt(dx * dx + dy * dy) < 6) return null;
    return { type: t, color: draft.color, width: draft.width, x1: draft.sx, y1: draft.sy, x2: draft.cx, y2: draft.cy };
  };

  /* 下書きプレビュー用（仮id付き注釈） */
  App.draw.draftPreview = function (draft) {
    var g = App.draw.draftToGeom(draft);
    if (!g) {
      /* comment等でまだ確定できない小さな下書きはbox表示のみ */
      if (draft.type === 'circle' || draft.type === 'rect') {
        return { id: '_draft', type: draft.type, color: draft.color, width: draft.width,
          x: Math.min(draft.sx, draft.cx), y: Math.min(draft.sy, draft.cy),
          w: Math.abs(draft.cx - draft.sx), h: Math.abs(draft.cy - draft.sy), angle: 0 };
      }
      return null;
    }
    g.id = '_draft';
    return g;
  };

  /* ---- 平行移動（全型） ---- */
  App.draw.translate = function (a, dx, dy) {
    if (a.type === 'free') { a.points = a.points.map(function (p) { return [p[0] + dx, p[1] + dy]; }); return; }
    if (a.quad) a.quad = a.quad.map(function (p) { return [p[0] + dx, p[1] + dy]; });
    if (a.x != null) { a.x += dx; a.y += dy; }
    if (a.x1 != null) { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; }
  };

  /* ================= 直接ハンドル操作 ================= */
  /* 選択中の注釈のハンドル位置一覧（注釈座標系）。unit=viewBox単位/画面px */
  App.draw.getHandles = function (a, W, H, unit) {
    var hs = [];
    if (a.type === 'rect') {
      rectQuad(a).forEach(function (p, i) { hs.push({ role: 'v' + i, x: p[0], y: p[1], kind: 'vertex' }); });
    } else if (a.type === 'circle') {
      var cx = a.x + a.w / 2, cy = a.y + a.h / 2, hw = a.w / 2, hh = a.h / 2, ang = (a.angle || 0) * Math.PI / 180;
      function loc(lx, ly) { return { x: cx + lx * Math.cos(ang) - ly * Math.sin(ang), y: cy + lx * Math.sin(ang) + ly * Math.cos(ang) }; }
      var pos = [['c0', -hw, -hh, 'corner'], ['c1', hw, -hh, 'corner'], ['c2', hw, hh, 'corner'], ['c3', -hw, hh, 'corner'],
        ['ew', hw, 0, 'edge'], ['eh', 0, hh, 'edge']];
      pos.forEach(function (p) { var q = loc(p[1], p[2]); hs.push({ role: p[0], x: q.x, y: q.y, kind: p[3] }); });
      var r = loc(0, -hh - 36 * unit); hs.push({ role: 'rot', x: r.x, y: r.y, kind: 'rotate' });
    } else if (a.type === 'comment') {
      var m = commentMetrics(a, W, H);
      hs.push({ role: 'cw', x: a.x + m.w, y: a.y + m.boxH / 2, kind: 'edge' });
      hs.push({ role: 'ch', x: a.x + m.w / 2, y: a.y + m.boxH, kind: 'edge' });
      hs.push({ role: 'cwh', x: a.x + m.w, y: a.y + m.boxH, kind: 'corner' });
    } else if (a.type === 'line' || a.type === 'arrow' || a.type === 'dim') {
      hs.push({ role: 'p1', x: a.x1, y: a.y1, kind: 'end' });
      hs.push({ role: 'p2', x: a.x2, y: a.y2, kind: 'end' });
    }
    return hs;
  };

  /* 選択中注釈の輪郭＋ハンドルを g に描画（ハンドルは data-handle 付き） */
  App.draw.renderHandles = function (g, a, W, H, unit) {
    var os = 2 * unit, dash = (7 * unit) + ' ' + (5 * unit);
    if (a.type === 'rect') {
      var qs = rectQuad(a).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      g.appendChild(svgEl('polygon', { points: qs, fill: 'none', stroke: '#1565c0', 'stroke-width': os, 'stroke-dasharray': dash }));
    } else if (a.type === 'circle') {
      var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      var o = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#1565c0', 'stroke-width': os, 'stroke-dasharray': dash });
      if (a.angle) o.setAttribute('transform', 'rotate(' + a.angle + ' ' + cx + ' ' + cy + ')');
      g.appendChild(o);
    } else if (a.type === 'comment') {
      var m = commentMetrics(a, W, H);
      g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: m.w, height: m.boxH, fill: 'none', stroke: '#1565c0', 'stroke-width': os, 'stroke-dasharray': dash }));
    } else {
      var bb = App.draw.bbox(a);
      g.appendChild(svgEl('rect', { x: bb.x, y: bb.y, width: bb.w, height: bb.h, fill: 'none', stroke: '#1565c0', 'stroke-width': os, 'stroke-dasharray': dash }));
    }
    var vr = 11 * unit, hitr = 26 * unit;
    App.draw.getHandles(a, W, H, unit).forEach(function (h) {
      var col = h.kind === 'rotate' ? '#2e7d32' : '#1565c0';
      var hg = svgEl('g', { 'data-handle': h.role, 'data-annid': a.id });
      hg.appendChild(svgEl('circle', { cx: h.x, cy: h.y, r: hitr, fill: 'rgba(0,0,0,0)' }));
      hg.appendChild(svgEl('circle', { cx: h.x, cy: h.y, r: vr, fill: '#ffffff', stroke: col, 'stroke-width': 2.5 * unit }));
      if (h.kind === 'rotate') hg.appendChild(svgEl('circle', { cx: h.x, cy: h.y, r: vr * 0.4, fill: col }));
      g.appendChild(hg);
    });
  };

  /* ハンドルのドラッグを注釈に適用。orig=ドラッグ開始時のスナップショット */
  App.draw.applyHandleDrag = function (a, role, pt, orig, W, H) {
    if (a.type === 'rect') {
      App.draw.ensureQuad(a);
      var idx = parseInt(role.slice(1), 10);
      a.quad[idx] = [round1(pt.x), round1(pt.y)];
      return;
    }
    if (a.type === 'circle') {
      var cx = orig.x + orig.w / 2, cy = orig.y + orig.h / 2, ang = (orig.angle || 0) * Math.PI / 180;
      if (role === 'rot') {
        a.angle = Math.round(Math.atan2(pt.y - cy, pt.x - cx) * 180 / Math.PI + 90);
        a.w = orig.w; a.h = orig.h; a.x = orig.x; a.y = orig.y;
        return;
      }
      var dx = pt.x - cx, dy = pt.y - cy;
      var lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      var ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      var hw = orig.w / 2, hh = orig.h / 2;
      if (role === 'ew') hw = Math.max(6, Math.abs(lx));
      else if (role === 'eh') hh = Math.max(6, Math.abs(ly));
      else { hw = Math.max(6, Math.abs(lx)); hh = Math.max(6, Math.abs(ly)); }
      a.w = round1(hw * 2); a.h = round1(hh * 2); a.x = round1(cx - hw); a.y = round1(cy - hh); a.angle = orig.angle || 0;
      return;
    }
    if (a.type === 'comment') {
      var om = commentMetrics(orig, W, H);
      if (a.fontPx == null) a.fontPx = om.fontPx;
      if (a.w == null) a.w = om.w;
      if (role === 'cw' || role === 'cwh') a.w = round1(Math.max(a.fontPx * 2, pt.x - a.x));
      if (role === 'ch' || role === 'cwh') {
        var lc = om.lines.length || 1;
        var targetH = Math.max(a.fontPx * 0.6, pt.y - a.y);
        a.fontPx = round1(Math.max(8, targetH / (lc * 1.35)));
      }
      return;
    }
    if (a.type === 'line' || a.type === 'arrow' || a.type === 'dim') {
      if (role === 'p1') { a.x1 = round1(pt.x); a.y1 = round1(pt.y); }
      else { a.x2 = round1(pt.x); a.y2 = round1(pt.y); }
    }
  };

  App.draw.hasHandles = function (a) {
    return a && ['rect', 'circle', 'comment', 'line', 'arrow', 'dim'].indexOf(a.type) !== -1;
  };

  /* ================= 共通ツールバー ================= */
  /* container に描画ツール群を生成。api={getTool,setTool,getShapeSub,setShapeSub,getColor,setColor,getWidth,setWidth}
     戻り値 {refresh} */
  App.draw.buildToolbar = function (container, api) {
    var TOOLS = [
      { tool: 'shape', label: '図形 ▾', shape: true },
      { tool: 'arrow', label: '↗ 矢印' },
      { tool: 'free', label: '✎ 手書き' },
      { tool: 'comment', label: '💬 コメント' },
      { tool: 'dim', label: '↔ 寸法' },
    ];
    var SHAPES = [
      { key: 'line', label: '／ 線' },
      { key: 'circle', label: '◯ 丸' },
      { key: 'rect', label: '▭ 四角' },
    ];

    var html = '<div class="draw-tools">';
    TOOLS.forEach(function (t) {
      if (t.shape) {
        html += '<span class="draw-shape-wrap">' +
          '<button type="button" class="tool-btn" data-dtool="shape">' + t.label + '</button>' +
          '<div class="draw-shape-menu">' +
            SHAPES.map(function (s) { return '<button type="button" class="draw-shape-item" data-dshape="' + s.key + '">' + s.label + '</button>'; }).join('') +
          '</div></span>';
      } else {
        html += '<button type="button" class="tool-btn" data-dtool="' + t.tool + '">' + t.label + '</button>';
      }
    });
    html += '</div>';

    html += '<div class="draw-widths">' +
      App.draw.WIDTH_KEYS.map(function (w) {
        return '<button type="button" class="width-btn" data-dwidth="' + w + '"><span class="width-dot width-' + w + '"></span>' + App.draw.WIDTH_LABELS[w] + '</button>';
      }).join('') + '</div>';

    html += '<div class="draw-colors">' +
      App.ANNOT_COLORS.map(function (c) {
        return '<button type="button" class="swatch" data-dcolor="' + c.value + '" style="background:' + c.value + '"></button>';
      }).join('') + '</div>';

    var wrap = document.createElement('div');
    wrap.className = 'draw-toolbar';
    wrap.innerHTML = html;
    container.appendChild(wrap);

    var shapeWrap = wrap.querySelector('.draw-shape-wrap');
    var shapeMenu = wrap.querySelector('.draw-shape-menu');

    wrap.querySelectorAll('[data-dtool]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var tool = btn.getAttribute('data-dtool');
        if (tool === 'shape') {
          e.stopPropagation();
          shapeMenu.classList.toggle('open');
          if (api.getTool() !== 'shape') { api.setTool('shape'); }
          refresh();
          return;
        }
        shapeMenu.classList.remove('open');
        api.setTool(tool);
        refresh();
      });
    });
    wrap.querySelectorAll('[data-dshape]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        api.setShapeSub(btn.getAttribute('data-dshape'));
        shapeMenu.classList.remove('open');
        refresh();
      });
    });
    wrap.querySelectorAll('[data-dwidth]').forEach(function (btn) {
      btn.addEventListener('click', function () { api.setWidth(btn.getAttribute('data-dwidth')); refresh(); });
    });
    wrap.querySelectorAll('[data-dcolor]').forEach(function (btn) {
      btn.addEventListener('click', function () { api.setColor(btn.getAttribute('data-dcolor')); refresh(); });
    });
    /* メニュー外クリックで閉じる */
    document.addEventListener('click', function () { shapeMenu.classList.remove('open'); });

    function refresh() {
      var tool = api.getTool();
      var sub = api.getShapeSub();
      wrap.querySelectorAll('[data-dtool]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-dtool') === tool);
      });
      var shapeBtn = wrap.querySelector('[data-dtool="shape"]');
      if (shapeBtn) shapeBtn.textContent = (tool === 'shape' ? (sub === 'line' ? '／ 線 ▾' : sub === 'rect' ? '▭ 四角 ▾' : '◯ 丸 ▾') : '図形 ▾');
      wrap.querySelectorAll('[data-dwidth]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-dwidth') === api.getWidth());
      });
      wrap.querySelectorAll('[data-dcolor]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-dcolor') === api.getColor());
      });
    }
    refresh();
    return { refresh: refresh };
  };

})();
