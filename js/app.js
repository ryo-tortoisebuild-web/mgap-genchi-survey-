/* 起動処理 */
window.App = window.App || {};

document.addEventListener('DOMContentLoaded', function () {
  App.store.init().then(function () {
    App.input.init();
    App.editor.init();
    App.annot.init();
    App.output.init();
    App.ui.initTabs();
  });

  /* Service Worker（https/localhost配信時のみ。失敗しても無視） */
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* noop */ });
  }
});
