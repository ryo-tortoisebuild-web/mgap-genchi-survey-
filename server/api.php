<?php
/* 現地調査アプリ 同期API（PHP/PDO）
   ルーティング：api.php?action=xxx （共有ホスティングでも動く query 方式）
   認証：ログインで発行したトークンを Authorization: Bearer で送信 */

error_reporting(E_ALL);
ini_set('display_errors', '0'); // エラー詳細は返さない（本番）

$cfgPath = __DIR__ . '/config.php';
if (!file_exists($cfgPath)) {
  header('Content-Type: application/json; charset=utf-8');
  http_response_code(500);
  echo json_encode(array('ok' => false, 'error' => 'config.php がありません。config.sample.php を config.php にコピーして設定してください。'));
  exit;
}
$cfg = require $cfgPath;

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

send_cors($cfg);

try {
  $pdo = db_connect($cfg);
} catch (Exception $e) {
  fail('データベースに接続できません（config.php の設定を確認してください）', 500);
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'];

function user_count($pdo) {
  return (int) $pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
}

switch ($action) {

  case 'status': // 初回登録が必要か等
    json_out(array('ok' => true, 'hasUser' => user_count($pdo) > 0, 'server' => 'genchi-api'));
    break;

  case 'register': { // 最初の1ユーザーのみ作成可（初期設定キー必須・以降は無効）
    if ($method !== 'POST') fail('POSTで送信してください', 405);
    // 1) サーバーのconfig.phpに setup_key が設定されていなければ登録は完全に無効
    $setupKey = isset($cfg['setup_key']) ? (string) $cfg['setup_key'] : '';
    if ($setupKey === '') fail('新規登録は無効です（サーバー側で初期設定キーが未設定）', 403);
    $b = read_json_body();
    // 2) 初期設定キーが一致しなければ拒否（定数時間比較。ユーザー有無より先に判定し情報を漏らさない）
    $provided = isset($b['setupKey']) ? (string) $b['setupKey'] : '';
    if (!hash_equals($setupKey, $provided)) fail('初期設定キーが違います', 403);
    // 3) 既に管理者がいれば登録不可
    if (user_count($pdo) > 0) fail('登録は既に完了しています（管理者は1人のみ）', 403);
    $u = trim(isset($b['username']) ? $b['username'] : '');
    $p = isset($b['password']) ? $b['password'] : '';
    if ($u === '' || strlen($p) < 6) fail('IDと6文字以上のパスワードを入力してください');
    $hash = password_hash($p, PASSWORD_DEFAULT);
    $st = $pdo->prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)');
    $st->execute(array($u, $hash, now_ms()));
    $uid = (int) $pdo->lastInsertId();
    $token = issue_token($pdo, $uid, $cfg);
    json_out(array('ok' => true, 'token' => $token, 'username' => $u));
    break;
  }

  case 'login': {
    if ($method !== 'POST') fail('POSTで送信してください', 405);
    $b = read_json_body();
    $u = trim(isset($b['username']) ? $b['username'] : '');
    $p = isset($b['password']) ? $b['password'] : '';
    $st = $pdo->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $st->execute(array($u));
    $user = $st->fetch();
    if (!$user || !password_verify($p, $user['password_hash'])) {
      // タイミング差を減らすためのダミー検証は省略（単一ユーザー運用）
      fail('IDまたはパスワードが違います', 401);
    }
    $token = issue_token($pdo, (int)$user['id'], $cfg);
    json_out(array('ok' => true, 'token' => $token, 'username' => $user['username']));
    break;
  }

  case 'logout': {
    $user = require_auth($pdo);
    $token = bearer_token();
    $st = $pdo->prepare('DELETE FROM auth_tokens WHERE token_hash = ?');
    $st->execute(array(token_hash($token)));
    json_out(array('ok' => true));
    break;
  }

  case 'me': {
    $user = require_auth($pdo);
    json_out(array('ok' => true, 'username' => $user['username']));
    break;
  }

  case 'projects': { // 一覧（メタのみ。ポーリング用に updatedAt を返す）
    $user = require_auth($pdo);
    $st = $pdo->prepare('SELECT project_uid, name, address, survey_date, updated_at, deleted FROM projects WHERE user_id = ? ORDER BY updated_at DESC');
    $st->execute(array($user['id']));
    $rows = $st->fetchAll();
    $list = array();
    foreach ($rows as $r) {
      $list[] = array(
        'projectUid' => $r['project_uid'], 'name' => $r['name'], 'address' => $r['address'],
        'surveyDate' => $r['survey_date'], 'updatedAt' => (int)$r['updated_at'], 'deleted' => (int)$r['deleted'],
      );
    }
    json_out(array('ok' => true, 'projects' => $list));
    break;
  }

  case 'project': { // 1物件の全ドキュメント取得
    $user = require_auth($pdo);
    $uid = isset($_GET['uid']) ? $_GET['uid'] : '';
    $st = $pdo->prepare('SELECT p.*, d.doc FROM projects p LEFT JOIN project_docs d ON d.project_id = p.id WHERE p.user_id = ? AND p.project_uid = ? LIMIT 1');
    $st->execute(array($user['id'], $uid));
    $r = $st->fetch();
    if (!$r) fail('物件が見つかりません', 404);
    json_out(array('ok' => true, 'projectUid' => $r['project_uid'], 'updatedAt' => (int)$r['updated_at'],
      'deleted' => (int)$r['deleted'], 'doc' => $r['doc'] ? json_decode($r['doc'], true) : null));
    break;
  }

  case 'project_save': { // 物件のupsert（保存）。doc全体を受け取る
    $user = require_auth($pdo);
    if ($method !== 'POST' && $method !== 'PUT') fail('POST/PUTで送信してください', 405);
    $b = read_json_body();
    $uid = trim(isset($b['projectUid']) ? $b['projectUid'] : '');
    if ($uid === '') fail('projectUidが必要です');
    $doc = isset($b['doc']) ? $b['doc'] : null;
    $name = isset($b['name']) ? $b['name'] : '';
    $address = isset($b['address']) ? $b['address'] : '';
    $surveyDate = isset($b['surveyDate']) ? $b['surveyDate'] : '';
    $ts = now_ms();

    $st = $pdo->prepare('SELECT id FROM projects WHERE user_id = ? AND project_uid = ? LIMIT 1');
    $st->execute(array($user['id'], $uid));
    $existing = $st->fetch();
    if ($existing) {
      $pid = (int)$existing['id'];
      $up = $pdo->prepare('UPDATE projects SET name=?, address=?, survey_date=?, updated_at=?, deleted=0 WHERE id=?');
      $up->execute(array($name, $address, $surveyDate, $ts, $pid));
    } else {
      $ins = $pdo->prepare('INSERT INTO projects (user_id, project_uid, name, address, survey_date, updated_at, deleted) VALUES (?,?,?,?,?,?,0)');
      $ins->execute(array($user['id'], $uid, $name, $address, $surveyDate, $ts));
      $pid = (int)$pdo->lastInsertId();
    }
    $docJson = $doc === null ? null : json_encode($doc, JSON_UNESCAPED_UNICODE);
    // upsert doc
    $d = $pdo->prepare('SELECT project_id FROM project_docs WHERE project_id = ?');
    $d->execute(array($pid));
    if ($d->fetch()) {
      $pdo->prepare('UPDATE project_docs SET doc=? WHERE project_id=?')->execute(array($docJson, $pid));
    } else {
      $pdo->prepare('INSERT INTO project_docs (project_id, doc) VALUES (?,?)')->execute(array($pid, $docJson));
    }
    json_out(array('ok' => true, 'projectUid' => $uid, 'updatedAt' => $ts));
    break;
  }

  case 'project_delete': { // 論理削除（他端末に削除を同期）
    $user = require_auth($pdo);
    if ($method !== 'POST') fail('POSTで送信してください', 405);
    $b = read_json_body();
    $uid = trim(isset($b['projectUid']) ? $b['projectUid'] : '');
    $ts = now_ms();
    $up = $pdo->prepare('UPDATE projects SET deleted=1, updated_at=? WHERE user_id=? AND project_uid=?');
    $up->execute(array($ts, $user['id'], $uid));
    json_out(array('ok' => true, 'updatedAt' => $ts));
    break;
  }

  case 'photo': { // 写真アップロード（multipart）
    $user = require_auth($pdo);
    if ($method !== 'POST') fail('POSTで送信してください', 405);
    if (!isset($_FILES['file'])) fail('ファイルがありません');
    $projectUid = isset($_POST['projectUid']) ? preg_replace('/[^A-Za-z0-9_\-]/', '', $_POST['projectUid']) : '';
    $photoUid   = isset($_POST['photoUid']) ? preg_replace('/[^A-Za-z0-9_\-]/', '', $_POST['photoUid']) : '';
    if ($projectUid === '' || $photoUid === '') fail('projectUid/photoUidが必要です');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) fail('アップロードに失敗しました');
    if ($f['size'] > $cfg['max_upload_bytes']) fail('画像サイズが大きすぎます');
    $info = @getimagesize($f['tmp_name']);
    if ($info === false) fail('画像ファイルではありません');

    $dir = rtrim($cfg['upload_dir'], '/') . '/' . $user['id'] . '/' . $projectUid;
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $filename = $photoUid . '.jpg';
    $dest = $dir . '/' . $filename;
    if (!move_uploaded_file($f['tmp_name'], $dest)) fail('保存に失敗しました', 500);
    $url = rtrim($cfg['upload_base_url'], '/') . '/' . $user['id'] . '/' . $projectUid . '/' . $filename;

    // photos メタ upsert
    $ex = $pdo->prepare('SELECT id FROM photos WHERE user_id=? AND project_uid=? AND photo_uid=? LIMIT 1');
    $ex->execute(array($user['id'], $projectUid, $photoUid));
    if (!$ex->fetch()) {
      $pdo->prepare('INSERT INTO photos (user_id, project_uid, photo_uid, filename, url, created_at) VALUES (?,?,?,?,?,?)')
          ->execute(array($user['id'], $projectUid, $photoUid, $filename, $url, now_ms()));
    }
    json_out(array('ok' => true, 'url' => $url));
    break;
  }

  case 'diag': { // 診断用：実際にどのDB・どのファイルで動いているかを特定する（setup_key必須）
    $setupKey = isset($cfg['setup_key']) ? (string) $cfg['setup_key'] : '';
    $provided = isset($_GET['key']) ? (string) $_GET['key'] : '';
    if ($setupKey === '' || !hash_equals($setupKey, $provided)) {
      fail('診断は無効です（config.php の setup_key を設定し、?key= に同じ値を付けてください）', 403);
    }
    $d = $cfg['db'];
    $out = array(
      'ok' => true,
      'running_file'  => __FILE__,                       // 実行中の api.php の実パス（どのコピーかを判別）
      'config_mtime'  => date('Y-m-d H:i:s', @filemtime(__DIR__ . '/config.php')), // 読み込んだconfigの更新時刻
      'config_driver' => $d['driver'],
      'config_db_name'     => isset($d['name']) ? $d['name'] : null,
      'config_db_name_hex' => isset($d['name']) ? bin2hex($d['name']) : null,   // 全角・不可視文字の検出用
      'config_db_host'     => isset($d['host']) ? $d['host'] : null,
    );
    if ($d['driver'] === 'sqlite') {
      $out['sqlite_path']   = $d['sqlite_path'];
      $out['sqlite_exists'] = file_exists($d['sqlite_path']);
      try {
        $tables = array();
        foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type='table'") as $r) { $tables[] = $r['name']; }
        $out['tables'] = $tables;
      } catch (Exception $e) { $out['tables'] = 'エラー: ' . $e->getMessage(); }
    } else {
      try { $out['connected_database'] = $pdo->query('SELECT DATABASE()')->fetchColumn(); } catch (Exception $e) { $out['connected_database'] = 'エラー'; }
      try { $out['connected_database_hex'] = bin2hex($out['connected_database']); } catch (Exception $e) {}
      try { $out['mysql_version'] = $pdo->query('SELECT VERSION()')->fetchColumn(); } catch (Exception $e) {}
      try {
        $tables = array();
        foreach ($pdo->query('SHOW TABLES') as $r) { $vals = array_values($r); $tables[] = $vals[0]; }
        $out['tables'] = $tables;
      } catch (Exception $e) { $out['tables'] = 'エラー: ' . $e->getMessage(); }
    }
    // users の中身（パスワードハッシュは返さない）
    try {
      $rows = $pdo->query('SELECT id, username, created_at FROM users')->fetchAll();
      foreach ($rows as $i => $r) {
        $rows[$i]['created_at_readable'] = date('Y-m-d H:i:s', (int) ($r['created_at'] / 1000)) . '（サーバー時刻）';
      }
      $out['users'] = $rows;
    } catch (Exception $e) { $out['users'] = 'users表なし'; }
    json_out($out);
    break;
  }

  default:
    fail('不明なアクションです: ' . $action, 404);
}

function issue_token($pdo, $userId, $cfg) {
  $token = random_token();
  $exp = now_ms() + ($cfg['token_ttl_days'] * 86400 * 1000);
  $pdo->prepare('INSERT INTO auth_tokens (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)')
      ->execute(array($userId, token_hash($token), $exp, now_ms()));
  return $token;
}
