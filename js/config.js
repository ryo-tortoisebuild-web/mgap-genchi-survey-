/* サーバー同期の設定。
   apiBase が空文字のときは「この端末だけで保存」モード（従来どおり・サーバー通信なし）。
   Xserverにデプロイ後、下の apiBase を自分のドメインの api.php のURLに書き換える。
     例: 'https://example.com/genchi-api/api.php'
   ※このURLは公開情報（ブラウザから呼ぶ）。パスワード等の秘密情報はここに書かない。 */
window.App = window.App || {};
App.config = {
  apiBase: '',
  pollIntervalMs: 8000,   // 他端末の変更を取りに行く間隔（ミリ秒）
};
