/* 画面3：情報カード（モーダル表示＋依頼書用HTML生成の共通部品）
   表示順：ヘッダー（名称・位置・職人タグ）→ 寸法 → 仕様・状態 → 施工指示・注意点 → 写真 */
window.App = window.App || {};

(function () {
  App.card = {};

  function dimText(d) {
    if (!d) return '';
    var parts = [];
    if (d.w != null) parts.push('W ' + d.w);
    if (d.d != null) parts.push('D ' + d.d);
    if (d.h != null) parts.push('H ' + d.h);
    if (!parts.length) return '';
    var meas = App.measureLabel(d.measureType);
    return parts.join(' × ') + ' mm' + (meas ? '（' + meas + '）' : '');
  }

  function locationLine(el) {
    var parts = [];
    if (el.locationText) parts.push(el.locationText);
    App.store.pinsOfElement(el.id).forEach(function (info) {
      parts.push(info.drawing.title + ' ピン' + info.pin.num);
    });
    return parts.join(' ／ ');
  }

  /* カード本体HTML（モーダルと依頼書で共用）。opts.pinNum で番号を先頭表示 */
  App.card.buildHTML = function (el, opts) {
    opts = opts || {};
    var cat = App.catOf(el.category);
    var tags = el.trades.map(function (t) {
      return '<span class="chip chip-trade">' + App.esc(App.tradeLabel(t)) + '</span>';
    }).join('');
    var dims = dimText(el.dimensions);
    var loc = locationLine(el);
    var condition = App.esc(el.condition) + (el.conditionNote ? '：' + App.esc(el.conditionNote) : '');

    var html = '<div class="info-card">';

    /* 1. ヘッダー */
    html += '<div class="card-header">' +
      '<div class="card-title">' +
        (opts.pinNum ? '<span class="card-pin-num" style="background:' + cat.color + '">' + opts.pinNum + '</span>' : '') +
        '<span class="chip" style="background:' + cat.color + '">' + App.esc(cat.label) + '</span>' +
        '<strong>' + App.esc(el.label) + '</strong>' +
      '</div>' +
      (loc ? '<div class="card-location">📍 ' + App.esc(loc) + '</div>' : '') +
      '<div class="card-tags">' + (tags || '<span class="muted">職人タグ未設定</span>') + '</div>' +
    '</div>';

    /* 2. 寸法 */
    html += '<div class="card-section"><h4>寸法</h4><p>' + (dims ? App.esc(dims) : '<span class="muted">未計測</span>') + '</p></div>';

    /* 3. 仕様・状態 */
    html += '<div class="card-section"><h4>仕様・状態</h4>' +
      '<p><span class="chip chip-cond">' + condition + '</span></p>' +
      (el.note ? '<p class="card-note">' + App.esc(el.note).replace(/\n/g, '<br>') + '</p>' : '') +
    '</div>';

    /* 4. 施工指示・注意点 */
    if (el.instruction) {
      html += '<div class="card-section card-instruction"><h4>⚠ 施工指示・注意点</h4>' +
        '<p>' + App.esc(el.instruction).replace(/\n/g, '<br>') + '</p></div>';
    }

    /* 5. 写真 */
    if (el.photos.length) {
      html += '<div class="card-section"><h4>写真</h4><div class="card-photos">' +
        el.photos.map(function (p) {
          return '<img src="' + p.dataUrl + '" alt="" data-photo-zoom>';
        }).join('') +
      '</div></div>';
    }

    html += '</div>';
    return html;
  };

  /* モーダルで表示。opts: { pinId, drawingId }（作図画面から開いた場合） */
  App.card.show = function (elementId, opts) {
    opts = opts || {};
    var el = App.store.getElement(elementId);
    if (!el) return;
    var pinNum = null;
    if (opts.pinId && opts.drawingId) {
      var dw = App.store.getDrawing(opts.drawingId);
      var pin = dw && dw.pins.find(function (p) { return p.id === opts.pinId; });
      if (pin) pinNum = pin.num;
    }

    var box = document.createElement('div');
    box.className = 'card-modal';
    box.innerHTML =
      App.card.buildHTML(el, { pinNum: pinNum }) +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="edit">✏ 編集</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-primary" data-act="close">閉じる</button>' +
      '</div>';

    var overlay = App.ui.openModal(box);

    box.querySelector('[data-act="close"]').addEventListener('click', function () {
      App.ui.closeModal(overlay);
    });
    box.querySelector('[data-act="edit"]').addEventListener('click', function () {
      App.ui.closeModal(overlay);
      App.input.openForm(elementId);
    });

    /* 写真タップで拡大 */
    box.querySelectorAll('[data-photo-zoom]').forEach(function (img) {
      img.addEventListener('click', function () {
        var zoomBox = document.createElement('div');
        zoomBox.className = 'photo-zoom';
        var big = document.createElement('img');
        big.src = img.src;
        zoomBox.appendChild(big);
        var zOverlay = App.ui.openModal(zoomBox, { full: true });
        zoomBox.addEventListener('click', function () { App.ui.closeModal(zOverlay); });
      });
    });
  };
})();
