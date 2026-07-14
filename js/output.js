/* 出力タブ：職人を選ぶ → その職人の担当ポイントだけを、写真を主役サイズで
   ①から並べた依頼書を生成 → window.print()。写真にはその職人の書き込みを重ねる。 */
window.App = window.App || {};

(function () {
  App.output = {};

  var selectedTrade = null;
  var renderToken = 0;

  function renderTradeChips() {
    var bar = document.getElementById('output-trades');
    bar.innerHTML = App.TRADES.map(function (t) {
      var count = App.store.pointsForTrade(t.key).length;
      return '<button type="button" class="trade-chip' + (selectedTrade === t.key ? ' active' : '') + '"' +
        ' data-trade="' + t.key + '"' + (count ? '' : ' disabled') + '>' +
        t.label + (count ? ' <span class="count">' + count + '</span>' : '') +
        '</button>';
    }).join('');
    bar.querySelectorAll('[data-trade]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedTrade = btn.getAttribute('data-trade');
        App.output.render();
      });
    });
  }

  function buildPointInfo(el) {
    /* 寸法・状態は削除。位置メモ・施工指示のみ（写真＋書き込みが主役） */
    var html = '<div class="print-point-info">';
    if (el.locationText) {
      html += '<div class="pi-row"><span class="pi-key">位置</span><span class="pi-val">' +
        App.esc(el.locationText) + '</span></div>';
    }
    if (el.instruction) {
      html += '<div class="pi-instruction"><span class="pi-key">⚠ 施工指示・注意点</span>' +
        '<span class="pi-val">' + App.esc(el.instruction).replace(/\n/g, '<br>') + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  /* 依頼書DOMを #print-root に生成（写真の実寸取得のため非同期） */
  function renderPreview() {
    var root = document.getElementById('print-root');
    var printBtn = document.getElementById('btn-print');
    var token = ++renderToken;

    if (!selectedTrade) {
      root.innerHTML = '<p class="empty-note">職人を選ぶと、その職人向けの依頼書プレビューが表示されます。</p>';
      printBtn.disabled = true;
      return;
    }

    var trade = selectedTrade;
    var tradeLabel = App.tradeLabel(trade);
    var points = App.store.pointsForTrade(trade);

    if (!points.length) {
      root.innerHTML = '<p class="empty-note">「' + App.esc(tradeLabel) + '」が担当する撮影ポイントがありません。</p>';
      printBtn.disabled = true;
      return;
    }

    root.innerHTML = '<p class="empty-note">プレビューを作成中…</p>';
    printBtn.disabled = true;

    /* 全対象写真の実寸を保証してからDOM構築（対象外は除外） */
    var allPhotos = [];
    points.forEach(function (el) { App.store.photosForTrade(el, trade).forEach(function (p) { allPhotos.push(p); }); });

    Promise.all(allPhotos.map(function (p) { return App.photo.ensureDims(p); })).then(function () {
      if (token !== renderToken) return; /* 途中で選択が変わった */
      build(root, trade, tradeLabel, points);
      printBtn.disabled = false;
    });
  }

  function build(root, trade, tradeLabel, points) {
    var p = App.state.project;
    var today = new Date().toISOString().slice(0, 10);
    var includeFloor = document.getElementById('output-include-bg').checked;

    var sheet = document.createElement('div');
    sheet.className = 'print-sheet';

    /* 表紙 */
    var cover = document.createElement('div');
    cover.className = 'print-cover';
    cover.innerHTML =
      '<h1>作業依頼書</h1>' +
      '<div class="print-trade-big">' + App.esc(tradeLabel) + '</div>' +
      '<table class="print-meta"><tbody>' +
        '<tr><th>現場名</th><td>' + App.esc(p.name) + '</td></tr>' +
        (p.address ? '<tr><th>住所</th><td>' + App.esc(p.address) + '</td></tr>' : '') +
        '<tr><th>調査日</th><td>' + App.esc(p.surveyDate) + '</td></tr>' +
        (p.surveyor ? '<tr><th>調査担当</th><td>' + App.esc(p.surveyor) + '</td></tr>' : '') +
        '<tr><th>発行日</th><td>' + today + '</td></tr>' +
        '<tr><th>担当箇所</th><td>' + points.length + '箇所</td></tr>' +
      '</tbody></table>' +
      (p.memo ? '<p class="print-memo">' + App.esc(p.memo) + '</p>' : '');
    sheet.appendChild(cover);

    /* 間取り（任意・該当ピン強調） */
    if (includeFloor) {
      var targetIds = points.map(function (el) { return el.id; });
      App.state.drawings.forEach(function (dw) {
        var hasPins = dw.pins.some(function (pin) { return targetIds.indexOf(pin.elementId) !== -1; });
        if (!hasPins) return;
        var block = document.createElement('div');
        block.className = 'print-drawing-block';
        var h = document.createElement('h2');
        h.textContent = App.drawingTypeLabel(dw.type) + '：' + dw.title;
        block.appendChild(h);
        block.appendChild(App.editor.renderDrawingForPrint(dw, trade, true));
        sheet.appendChild(block);
      });
    }

    /* 各ポイント：写真を大きく＋書き込み＋情報 */
    points.forEach(function (el) {
      var num = App.store.pointNumber(el.id);
      var block = document.createElement('div');
      block.className = 'print-point';

      var head = document.createElement('div');
      head.className = 'print-point-head';
      head.innerHTML =
        '<span class="point-num" style="background:' + App.catOf(el.category).color + '">' + num + '</span>' +
        '<strong>' + App.esc(el.label) + '</strong>' +
        (el.locationText ? '<span class="muted"> ' + App.esc(el.locationText) + '</span>' : '');
      block.appendChild(head);

      /* その職人にとって対象外(✕)の写真は出力に含めない */
      var outPhotos = App.store.photosForTrade(el, trade);
      if (outPhotos.length) {
        outPhotos.forEach(function (ph) {
          var pw = document.createElement('div');
          pw.className = 'print-photo';
          var img = document.createElement('img');
          img.src = ph.dataUrl;
          pw.appendChild(img);
          pw.appendChild(App.annot.buildOverlay(ph, trade));
          block.appendChild(pw);
        });
      } else {
        var np = document.createElement('p');
        np.className = 'muted';
        np.textContent = '写真なし';
        block.appendChild(np);
      }

      var info = document.createElement('div');
      info.innerHTML = buildPointInfo(el);
      block.appendChild(info.firstChild);

      sheet.appendChild(block);
    });

    root.innerHTML = '';
    root.appendChild(sheet);
  }

  App.output.render = function () {
    renderTradeChips();
    renderPreview();
  };

  App.output.init = function () {
    document.getElementById('btn-print').addEventListener('click', function () {
      window.print();
    });
    document.getElementById('output-include-bg').addEventListener('change', function () {
      App.output.render();
    });
    App.events.on('change', function () {
      if (App.ui.currentTab() === 'output') App.output.render();
    });
    App.events.on('tab', function (tab) {
      if (tab === 'output') App.output.render();
    });
  };
})();
