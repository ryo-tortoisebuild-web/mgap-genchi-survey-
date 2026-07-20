/* 起動処理 */
window.App = window.App || {};

document.addEventListener('DOMContentLoaded', function () {
  App.store.init().then(function () {
    App.input.init();
    App.editor.init();
    App.annot.init();
    App.output.init();
    App.ui.initTabs();
    /* サーバー同期（apiBase未設定なら何もしない＝従来どおり端末内保存） */
    if (App.auth) App.auth.init();
    /* 1日1回の自動バックアップ（起動時＋定期判定。失敗しても本体機能に影響させない） */
    if (App.backup) App.backup.start();
  });

  /* Service Worker（https/localhost配信時のみ。失敗しても無視） */
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* noop */ });
  }
});
