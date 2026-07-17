<?php
/* 共通処理：CORS・JSON応答・認証。 */

function send_cors($cfg) {
  $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
  if ($origin && in_array($origin, $cfg['allowed_origins'], true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, X-Auth-Token, Content-Type');
    header('Access-Control-Max-Age: 86400');
  }
  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
  }
}

function json_out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function fail($msg, $code = 400) { json_out(array('ok' => false, 'error' => $msg), $code); }

function read_json_body() {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return array();
  $d = json_decode($raw, true);
  return is_array($d) ? $d : array();
}

function bearer_token() {
  $h = '';
  if (isset($_SERVER['HTTP_AUTHORIZATION'])) $h = $_SERVER['HTTP_AUTHORIZATION'];
  elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = $_SERVER['REDIRECT_HTTP_AUTHORIZATION']; // SetEnvIf+rewrite経由
  elseif (function_exists('apache_request_headers')) {
    $hs = apache_request_headers();
    foreach ($hs as $k => $v) { if (strtolower($k) === 'authorization') $h = $v; }
  }
  if (stripos($h, 'Bearer ') === 0) return trim(substr($h, 7));
  /* Xserver等のFastCGI環境ではAuthorizationヘッダが剥がされることがあるため、
     カスタムヘッダ X-Auth-Token を代替経路として受け付ける（フロントは両方送る） */
  if (isset($_SERVER['HTTP_X_AUTH_TOKEN']) && $_SERVER['HTTP_X_AUTH_TOKEN'] !== '') {
    return trim($_SERVER['HTTP_X_AUTH_TOKEN']);
  }
  return '';
}

function token_hash($token) { return hash('sha256', $token); }

/* 認証済みユーザーを返す（失敗は401） */
function require_auth($pdo) {
  $token = bearer_token();
  if ($token === '') fail('未ログインです', 401);
  $st = $pdo->prepare('SELECT * FROM auth_tokens WHERE token_hash = ? LIMIT 1');
  $st->execute(array(token_hash($token)));
  $row = $st->fetch();
  if (!$row) fail('セッションが無効です（再ログインしてください）', 401);
  if ((int)$row['expires_at'] < now_ms()) fail('セッションの有効期限が切れています（再ログインしてください）', 401);
  $us = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
  $us->execute(array($row['user_id']));
  $user = $us->fetch();
  if (!$user) fail('ユーザーが見つかりません', 401);
  return $user;
}

function random_token() { return bin2hex(random_bytes(32)); }
