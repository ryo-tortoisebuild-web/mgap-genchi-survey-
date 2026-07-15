# 現地調査アプリ｜サーバー（Xserver）設置ガイド

全端末（スマホ・タブレット・MacBook）で同じデータを見るための、サーバー側の設置手順です。
**MySQL接続情報・FTP情報は、このリポジトリやチャットに絶対に書きません。サーバー上で直接入力します。**

---

## 全体像
- 画面（フロント）：GitHub Pages のまま（変更なし）
- サーバー：Xserver に PHP の API を置く（このフォルダ `server/` の中身）
- データベース：Xserver の MySQL（作成済みのDB・ユーザーを使う）
- 写真：サーバー上にファイルとして保存（DBにはURLだけ。Base64は保存しない）

---

## 手順

### 1. アップロードするファイル
`server/` の中身を、Xserverの公開フォルダの下に **`genchi-api`** というフォルダを作ってアップロードします。
（例：`/ドメイン/public_html/genchi-api/`）

アップロードするもの：
- `api.php` `db.php` `lib.php` `.htaccess`
- `config.sample.php`
- `uploads/`（中の `.htaccess` ごと。ここに写真が保存されます）

> `config.php` はまだありません（次の手順で作ります）。`data/` は不要（MySQL利用のため）。

### 2. SSL（https）を有効化
Xserverのサーバーパネル →「SSL設定」で対象ドメインの**無料独自SSL**をON（反映に数分〜数十分）。
`.htaccess` が http アクセスを自動で https に転送します。

### 3. config.php を作る（← ここでDB情報を直接入力）
サーバー上で `config.sample.php` を **`config.php`** という名前でコピーし、
ファイルマネージャ（またはSSH）で開いて、次を自分の値に書き換えます。

```php
'db' => array(
  'driver' => 'mysql',
  'host'   => 'mysqlXXXX.xserver.jp',   // XserverのMySQLホスト名
  'name'   => '（作成済みのDB名）',
  'user'   => '（作成済みのDBユーザー名）',
  'pass'   => '（DBユーザーのパスワード）',   // ← ここに直接入力。GitHubには絶対上げない
  'charset'=> 'utf8mb4',
),
'allowed_origins' => array(
  'https://ryo-tortoisebuild-web.github.io',   // 公開アプリのオリジン（このままでOK）
),
'upload_base_url' => 'https://（あなたのドメイン）/genchi-api/uploads',
```

- `host` はサーバーパネルの「MySQL設定」→「MySQL一覧」に表示されるホスト名。
- `config.php` は `.htaccess` で外部から読めないよう保護されています（念のためパーミッションは 600 推奨）。

### 4. 動作確認（ブラウザ）
`https://（あなたのドメイン）/genchi-api/api.php?action=status` を開いて
`{"ok":true,"hasUser":false,...}` が出れば成功です。
（`config.php がありません` と出たら手順3、`データベースに接続できません` と出たらDB情報を再確認）

### 5. フロント側にURLを設定
リポジトリの `js/config.js` の `apiBase` を、自分のAPIのURLにします。

```js
apiBase: 'https://（あなたのドメイン）/genchi-api/api.php',
```

これを GitHub に反映（push）すると、公開アプリがサーバー同期モードになります。
`apiBase` が空文字のままなら、従来どおり「この端末だけで保存」で動きます。

### 6. 最初のアカウントを作る
公開アプリを開くと初回だけ「管理者アカウントを作成」画面が出ます。
IDと6文字以上のパスワードを決めて作成。以降はどの端末でもそのID/パスワードでログインします。
（登録は最初の1人だけ。2人目以降の登録口は自動で閉じます）

---

## データベースについて
テーブルは初回アクセス時に**自動で作成**されます（手動SQL不要）。
- `users`：ログイン用（パスワードは `password_hash` でハッシュ化して保存。平文は保存しない）
- `auth_tokens`：ログイン中の端末を表すトークン（ハッシュ化して保存）
- `projects` / `project_docs`：物件のメタ情報と本体データ（JSON）
- `photos`：アップロード写真のメタ情報（実体はファイル、URLを保持）

---

## バックアップ
アプリの「⬇ JSON書き出し」は従来どおり使えます（1物件＝1ファイル）。
サーバーが不調でも、各端末のローカル（IndexedDB）にデータは残り、復旧後に自動で同期されます。
