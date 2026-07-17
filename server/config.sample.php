<?php
/* 設定テンプレート。
   サーバー上でこのファイルを config.php にコピーし、下記の値を記入してください。
   ※ config.php は GitHub にも公開ページにも置きません（.gitignore済み・要 .htaccess保護）。
   ※ パスワードはこのファイル内（サーバー上）にのみ記入し、チャット等に貼らないでください。 */
return array(

  // ---- データベース接続（エックスサーバーのMySQL） ----
  'db' => array(
    'driver' => 'mysql',              // 本番: 'mysql'（ローカル検証時のみ 'sqlite'）
    'host'   => 'localhost',          // Xserverは通常 localhost（管理画面のMySQLホスト名に合わせる）
    'name'   => 'YOUR_DB_NAME',       // 作成済みのデータベース名
    'user'   => 'YOUR_DB_USER',       // データベースユーザー名
    'pass'   => 'YOUR_DB_PASSWORD',   // ← ここにパスワードを直接記入（サーバー上のみ）
    'charset'=> 'utf8mb4',
    'sqlite_path' => __DIR__ . '/data/app.sqlite', // driver=sqlite のときのみ使用
  ),

  // ---- CORS（GitHub Pagesのオリジンを許可。ワイルドカード不可） ----
  'allowed_origins' => array(
    'https://ryo-tortoisebuild-web.github.io',
    // ローカル検証用（不要なら削除可）
    'http://localhost:8642',
    'http://127.0.0.1:8642',
  ),

  // ---- 写真アップロード ----
  'upload_dir'      => __DIR__ . '/uploads',
  // 写真の公開URLの元（末尾スラッシュなし）。例: https://あなたのドメイン/genchi-api/uploads
  'upload_base_url' => 'https://YOUR_DOMAIN/genchi-api/uploads',
  'max_upload_bytes'=> 8 * 1024 * 1024, // 1枚あたり上限（既定8MB）

  // ---- 認証トークン ----
  'token_ttl_days'  => 30,

  // ---- 初期設定キー（重要・セキュリティ）----
  // 空 '' のあいだは「新規登録」を完全に無効化します（誰も登録できない）。
  // 最初の管理者アカウントを作るときだけ、推測されにくい長い文字列を設定し、
  // アプリの登録画面で同じ値を入力します。登録が終わったら必ず '' に戻してください。
  // これにより、公開URLを知られても第三者が勝手に登録することはできません。
  'setup_key' => '',
);
