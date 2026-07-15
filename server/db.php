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
