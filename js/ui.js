/* 画面切替・モーダル・トースト等の共通UI */
window.App = window.App || {};

(function () {
  App.ui = {};

  /* ---- タブ（画面）切替 ---- */
  var TABS = ['map', 'assign', 'output'];

  App.ui.switchTab = function (tab) {
    if (TABS.indexOf(tab) === -1) tab = 'map';
    TABS.forEach(function (t) {
      var sec = document.getElementById('screen-' + t);
      if (sec) sec.classList.toggle('active', t === tab);
      document.querySelectorAll('[data-tab="' + t + '"]').forEach(function (btn) {
        btn.classList.toggle('active', t === tab);
      });
    });
    document.body.setAttribute('data-active-tab', tab);
    if (location.hash !== '#' + tab) {
      history.replaceState(null, '', '#' + tab);
    }
    App.events.emit('tab', tab);
  };

  App.ui.currentTab = function () {
    return document.body.getAttribute('data-active-tab') || 'map';
  };

  App.ui.initTabs = function () {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.ui.switchTab(btn.getAttribute('data-tab'));
      });
    });
    window.addEventListener('hashchange', function () {
      App.ui.switchTab(location.hash.slice(1));
    });
    App.ui.switchTab(location.hash.slice(1) || 'map');
  };

  /* ---- トースト ---- */
  var toastTimer = null;
  App.ui.toast = function (msg, duration) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, duration || 3000);
  };

  /* ---- モーダル ----
     openModal(contentEl or html) → モーダル要素を返す。closeModal()で閉じる */
  App.ui.openModal = function (content, opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var box = document.createElement('div');
    box.className = 'modal-box' + (opts.full ? ' modal-full' : '');
    if (typeof content === 'string') box.innerHTML = content;
    else box.appendChild(content);
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target !== overlay) return;
      if (opts.onBackdrop) { opts.onBackdrop(); return; }
      if (!opts.noBackdropClose) App.ui.closeModal(overlay);
    });
    return overlay;
  };

  App.ui.closeModal = function (overlay) {
    if (overlay && overlay.parentNode) overlay.remove();
    else {
      var root = document.getElementById('modal-root');
      if (root.lastElementChild) root.lastElementChild.remove();
    }
  };

  /* ---- 確認ダイアログ ---- */
  App.ui.confirm = function (msg) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.innerHTML =
        '<p class="confirm-msg"></p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="cancel">キャンセル</button>' +
        '<button type="button" class="btn btn-danger" data-act="ok">OK</button>' +
        '</div>';
      box.querySelector('.confirm-msg').textContent = msg;
      var overlay = App.ui.openModal(box, { noBackdropClose: true });
      box.querySelector('[data-act="ok"]').addEventListener('click', function () {
        App.ui.closeModal(overlay); resolve(true);
      });
      box.querySelector('[data-act="cancel"]').addEventListener('click', function () {
        App.ui.closeModal(overlay); resolve(false);
      });
    });
  };

  /* ---- 入力ダイアログ（Promise<string|null>） ---- */
  App.ui.prompt = function (msg, defVal) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.innerHTML =
        '<p class="confirm-msg"></p>' +
        '<input type="text" class="prompt-input" inputmode="text">' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="cancel">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">OK</button>' +
        '</div>';
      box.querySelector('.confirm-msg').textContent = msg;
      var input = box.querySelector('.prompt-input');
      input.value = defVal == null ? '' : defVal;
      var overlay = App.ui.openModal(box, { noBackdropClose: true });
      function done(val) { App.ui.closeModal(overlay); resolve(val); }
      box.querySelector('[data-act="ok"]').addEventListener('click', function () { done(input.value.trim()); });
      box.querySelector('[data-act="cancel"]').addEventListener('click', function () { done(null); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') done(input.value.trim());
        if (e.key === 'Escape') done(null);
      });
      setTimeout(function () { input.focus(); input.select(); }, 30);
    });
  };

  /* ---- 複数行入力（Promise<string|null>） ----
     Enterは改行（IME確定も邪魔しない）。登録は「保存」または枠外（背景）タップ。
     キャンセルのみ null を返す */
  App.ui.promptMultiline = function (msg, initial) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.innerHTML =
        '<p class="confirm-msg"></p>' +
        '<textarea class="prompt-textarea" rows="3"></textarea>' +
        '<p class="muted field-note">改行はエンター。登録は「保存」または枠の外をタップ。</p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn" data-act="cancel">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">保存</button>' +
        '</div>';
      box.querySelector('.confirm-msg').textContent = msg;
      var ta = box.querySelector('.prompt-textarea');
      ta.value = initial == null ? '' : initial;
      var done = false;
      function finish(val) { if (done) return; done = true; App.ui.closeModal(overlay); resolve(val); }
      /* 背景（枠の外）タップ＝保存 */
      var overlay = App.ui.openModal(box, { onBackdrop: function () { finish(ta.value); } });
      box.querySelector('[data-act="ok"]').addEventListener('click', function () { finish(ta.value); });
      box.querySelector('[data-act="cancel"]').addEventListener('click', function () { finish(null); });
      setTimeout(function () { ta.focus(); }, 30);
    });
  };

  /* ---- HTMLエスケープ ---- */
  App.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
})();
