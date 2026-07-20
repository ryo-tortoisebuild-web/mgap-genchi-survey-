<?php
/* DB接続（PDO）＋スキーマ自動作成。MySQL/SQLite両対応（本番MySQL・ローカル検証SQLite）。
   タイムスタンプはエポックミリ秒(INTEGER)で保持し方言差を回避。 */

function db_connect($cfg) {
  $d = $cfg['db'];
  if ($d['driver'] === 'sqlite') {
    $dir = dirname($d['sqlite_path']);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $pdo = new PDO('sqlite:' . $d['sqlite_path']);
    $pdo->exec('PRAGMA journal_mode=WAL');
  } else {
    $charset = isset($d['charset']) ? $d['charset'] : 'utf8mb4';
    $dsn = 'mysql:host=' . $d['host'] . ';dbname=' . $d['name'] . ';charset=' . $charset;
    $pdo = new PDO($dsn, $d['user'], $d['pass']);
  }
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  db_migrate($pdo, $d['driver']);
  return $pdo;
}

function db_migrate($pdo, $driver) {
  $mysql = ($driver !== 'sqlite');
  $pk   = $mysql ? 'BIGINT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  $txt  = $mysql ? 'LONGTEXT'  : 'TEXT';
  $vc   = $mysql ? 'VARCHAR(255)' : 'TEXT';
  $eng  = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

  $pdo->exec("CREATE TABLE IF NOT EXISTS users (
    id $pk,
    username $vc NOT NULL,
    password_hash $vc NOT NULL,
    created_at BIGINT NOT NULL
  )$eng");
  // usernameの一意制約（MySQLはインデックス長を考慮しVARCHAR(191)相当で運用）
  try { $pdo->exec("CREATE UNIQUE INDEX ux_users_username ON users (username" . ($mysql ? "(191)" : "") . ")"); } catch (Exception $e) {}

  /* 管理者フラグ（後から追加した列。既存DBにも安全に足す）。
     1=メンバー追加などの管理操作が可能。データ（物件）は全ユーザー共有で全員フル権限。 */
  try { $pdo->exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); } catch (Exception $e) { /* 既にある */ }
  /* 管理者が1人もいなければ、最初のユーザー（＝初回登録した本人）を管理者に昇格 */
  try {
    $adminCount = (int) $pdo->query('SELECT COUNT(*) c FROM users WHERE is_admin = 1')->fetch()['c'];
    if ($adminCount === 0) {
      $first = $pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetch();
      if ($first) {
        $up = $pdo->prepare('UPDATE users SET is_admin = 1 WHERE id = ?');
        $up->execute(array($first['id']));
      }
    }
  } catch (Exception $e) { /* usersがまだ無い等は無視 */ }

  $pdo->exec("CREATE TABLE IF NOT EXISTS auth_tokens (
    id $pk,
    user_id BIGINT NOT NULL,
    token_hash $vc NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )$eng");
  try { $pdo->exec("CREATE UNIQUE INDEX ux_tokens_hash ON auth_tokens (token_hash" . ($mysql ? "(191)" : "") . ")"); } catch (Exception $e) {}

  $pdo->exec("CREATE TABLE IF NOT EXISTS projects (
    id $pk,
    user_id BIGINT NOT NULL,
    project_uid $vc NOT NULL,
    name $vc,
    address $vc,
    survey_date $vc,
    updated_at BIGINT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )$eng");
  try { $pdo->exec("CREATE UNIQUE INDEX ux_projects_uid ON projects (user_id, project_uid" . ($mysql ? "(191)" : "") . ")"); } catch (Exception $e) {}

  /* ゴミ箱：削除日時。deleted=1 かつ この時刻から一定期間で完全削除する */
  try { $pdo->exec("ALTER TABLE projects ADD COLUMN deleted_at BIGINT NULL"); } catch (Exception $e) { /* 既にある */ }

  /* 内部用メタ（最後に自動削除を実行した時刻など） */
  $pdo->exec("CREATE TABLE IF NOT EXISTS app_meta (
    k $vc NOT NULL,
    v $vc
  )$eng");
  try { $pdo->exec("CREATE UNIQUE INDEX ux_app_meta_k ON app_meta (k" . ($mysql ? "(191)" : "") . ")"); } catch (Exception $e) {}

  $pdo->exec("CREATE TABLE IF NOT EXISTS project_docs (
    project_id BIGINT PRIMARY KEY,
    doc $txt
  )$eng");

  $pdo->exec("CREATE TABLE IF NOT EXISTS photos (
    id $pk,
    user_id BIGINT NOT NULL,
    project_uid $vc NOT NULL,
    photo_uid $vc NOT NULL,
    filename $vc NOT NULL,
    url $vc NOT NULL,
    created_at BIGINT NOT NULL
  )$eng");
}

function now_ms() { return (int) round(microtime(true) * 1000); }

/* ---- app_meta の読み書き ---- */
function meta_get($pdo, $k) {
  try {
    $st = $pdo->prepare('SELECT v FROM app_meta WHERE k = ? LIMIT 1');
    $st->execute(array($k));
    $r = $st->fetch();
    return $r ? $r['v'] : null;
  } catch (Exception $e) { return null; }
}
function meta_set($pdo, $k, $v) {
  try {
    $st = $pdo->prepare('SELECT k FROM app_meta WHERE k = ? LIMIT 1');
    $st->execute(array($k));
    if ($st->fetch()) $pdo->prepare('UPDATE app_meta SET v = ? WHERE k = ?')->execute(array($v, $k));
    else $pdo->prepare('INSERT INTO app_meta (k, v) VALUES (?,?)')->execute(array($k, $v));
  } catch (Exception $e) { /* 失敗しても本処理は続行 */ }
}

/* ゴミ箱の保管期間（日）。config.php に trash_retention_days があればそれを使う */
function trash_retention_days($cfg) {
  $d = isset($cfg['trash_retention_days']) ? (int) $cfg['trash_retention_days'] : 30;
  return $d > 0 ? $d : 30;
}

/* 保管期限を過ぎた物件を完全削除（写真ファイルの実体・写真メタ・本体データ・物件行）。
   戻り値：完全削除した物件数 */
function purge_expired($pdo, $cfg) {
  $days = trash_retention_days($cfg);
  $limit = now_ms() - ($days * 86400 * 1000);
  $st = $pdo->prepare('SELECT id, project_uid FROM projects WHERE deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?');
  $st->execute(array($limit));
  $rows = $st->fetchAll();
  $count = 0;
  foreach ($rows as $r) {
    $pid = (int) $r['id'];
    $uid = $r['project_uid'];

    /* 写真の実体ファイルを削除（保存時と同じ規則で組み立て、パス外への操作を防ぐ） */
    try {
      $ps = $pdo->prepare('SELECT user_id, filename FROM photos WHERE project_uid = ?');
      $ps->execute(array($uid));
      $base = rtrim($cfg['upload_dir'], '/');
      $safeUid = preg_replace('/[^A-Za-z0-9_\-]/', '', $uid);
      foreach ($ps->fetchAll() as $ph) {
        $safeFile = basename($ph['filename']);
        $path = $base . '/' . ((int) $ph['user_id']) . '/' . $safeUid . '/' . $safeFile;
        if (is_file($path)) @unlink($path);
      }
      /* 空になった物件フォルダも掃除 */
      foreach (glob($base . '/*/' . $safeUid, GLOB_ONLYDIR) as $dir) { @rmdir($dir); }
    } catch (Exception $e) { /* ファイル削除の失敗はDB削除を止めない */ }

    try { $pdo->prepare('DELETE FROM photos WHERE project_uid = ?')->execute(array($uid)); } catch (Exception $e) {}
    try { $pdo->prepare('DELETE FROM project_docs WHERE project_id = ?')->execute(array($pid)); } catch (Exception $e) {}
    try { $pdo->prepare('DELETE FROM projects WHERE id = ?')->execute(array($pid)); $count++; } catch (Exception $e) {}
  }
  return $count;
}

/* 1時間に1回だけ自動実行（共有サーバーでcronに依存しないための間引き） */
function purge_expired_throttled($pdo, $cfg) {
  $last = (int) meta_get($pdo, 'last_purge_ms');
  if ($last > 0 && (now_ms() - $last) < 3600 * 1000) return null;
  meta_set($pdo, 'last_purge_ms', (string) now_ms());
  return purge_expired($pdo, $cfg);
}
