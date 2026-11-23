<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/profile-media.php';
require_once __DIR__ . '/profile-sounds.php';
require_once __DIR__ . '/profile-appearance.php';
require_once __DIR__ . '/account-verification.php';
require_once __DIR__ . '/account-settings.php';
require_once __DIR__ . '/account-deletion.php';
const PROFILE_COLUMNS = 'usr_nome_exibicao AS name, usr_email AS email, usr_data_nascimento AS birthDate, ' . PROFILE_MEDIA_COLUMNS;

function accountWithSounds(array $row): array
{
    $user = (int) $row['usr_id'];
    unset($row['usr_id']);
    return profileAccount($row) + profileSoundUrls($user) + ['appearance' => profileAppearance($user)];
}

function reply(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function fail(int $status, string $error): void
{
    reply($status, ['error' => $error]);
}

function sessionCookie(string $token): void
{
    $path = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/';
    setcookie(SESSION_COOKIE, $token, [
        'expires' => $token === '' ? time() - 3600 : time() + 365 * 86400,
        'path' => $path,
        'secure' => PHP_SAPI !== 'cli-server',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function createSession(PDO $db, int $userId, ?string $previousHash): string
{
    $token = bin2hex(random_bytes(32));
    if ($previousHash !== null) {
        query($db, 'DELETE FROM Sessao WHERE ses_token_hash = ?', [$previousHash]);
    }
    query($db, 'INSERT INTO Sessao (Usuario_usr_id, ses_token_hash) VALUES (?, ?)',
        [$userId, verifiedSessionTokenHash($token)]);
    return $token;
}

function field(array $data, string $key): string
{
    return is_string($data[$key] ?? null) ? $data[$key] : '';
}

function displayName(array $data): string
{
    $name = trim(field($data, 'name'));
    if (!preg_match('/\A.{1,40}\z/us', $name)) {
        fail(422, 'Digite um nome de exibição com até 40 caracteres.');
    }
    return $name;
}

$method = $_SERVER['REQUEST_METHOD'];
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    fail(405, 'Método inválido.');
}

$data = [];
if ($method === 'POST') {
    // Navegadores exigem preflight para que outro site envie este cabeçalho.
    if (($_SERVER['HTTP_X_DISCORDO_REQUEST'] ?? '') !== 'account'
        || strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
        fail(403, 'Solicitação inválida.');
    }
    $limit = 4 * 1024 * 1024;
    $body = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($body === false || strlen($body) > $limit) {
        fail(413, 'Solicitação muito grande.');
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        fail(400, 'Solicitação inválida.');
    }
    $actionLimit = match ($data['action'] ?? '') { 'profile' => $limit, 'profileSound' => 280000, default => 4096 };
    if (strlen($body) > $actionLimit) fail(413, 'Solicitação muito grande.');
}

$action = $method === 'GET' ? 'current' : field($data, 'action');
$session = sessionHash();
$created = [];
if ($action === 'current' && $method === 'GET' && $session === null) {
    if (isset($_GET['media'])) fail(401, 'Entre para ver a imagem.');
    if (isset($_GET['sound'])) fail(401, 'Entre para ouvir o som.');
    reply(200, ['account' => null]);
}

try {
    $db = database();

    if ($action === 'current' && $method === 'GET') {
        if (isset($_GET['sound'])) {
            if (signedInUser($db) === null) fail(401, 'Entre para ouvir o som.');
            $path = $_GET['sound'];
            $audio = profileSoundPath($path) ? @fopen(profileSoundDirectory() . '/' . $path, 'rb') : false;
            if (!$audio) fail(404, 'Som indisponível.');
            header('Content-Type: audio/mpeg');
            header('Content-Length: ' . fstat($audio)['size']);
            header('Cache-Control: private, max-age=86400, immutable');
            fpassthru($audio);
            fclose($audio);
            exit;
        }
        if (isset($_GET['media'])) {
            $path = $_GET['media'];
            if (!profileMediaPath($path) || !is_file($file = profileMediaDirectory() . '/' . $path)) fail(404, 'Imagem indisponível.');
            if (signedInUser($db) === null) fail(401, 'Entre para ver a imagem.');
            header('Content-Type: ' . PROFILE_MEDIA_MIME[pathinfo($path, PATHINFO_EXTENSION)]);
            header('Cache-Control: private, max-age=86400, immutable');
            readfile($file);
            exit;
        }
        $account = query($db, 'SELECT usr_id, usr_senha_hash, ' . PROFILE_COLUMNS . ' FROM Sessao JOIN Usuario ON usr_id = Usuario_usr_id
            WHERE ses_token_hash = ?', [$session])->fetch();
        if ($account) {
            $userId = (int) $account['usr_id'];
            if (!isTrustedDevice($userId, $account['email'], $account['usr_senha_hash'])) {
                setTrustedDeviceCookie($userId, $account['email'], $account['usr_senha_hash']);
            }
            unset($account['usr_senha_hash']);
        }
        reply(200, ['account' => $account ? accountWithSounds($account) : null]);
    }

    if (in_array($action, ['accountDetails', 'revokeAccountSession', 'changeAccountPassword', 'changeAccountPhone', 'requestAccountEmail', 'confirmAccountEmail'], true)) {
        handleAccountSettings($db, $session, $action, $data);
    }
    if ($action === 'deleteAccount') {
        [$account, $files] = confirmAccountDeletion($db, $session, field($data, 'email'), field($data, 'password'));
        removeDeletedAccountFiles($account, $files);
        setTrustedDeviceCookie((int) $account['usr_id'], $account['usr_email'], $account['usr_senha_hash'], true);
        sessionCookie('');
        reply(200, ['account' => null, 'deleted' => true]);
    }

    if ($action === 'profileSound' || $action === 'profileAppearance') {
        $db->beginTransaction();
        $account = query($db, 'SELECT usr_id, ' . PROFILE_COLUMNS . ' FROM Sessao
            JOIN Usuario ON usr_id = Usuario_usr_id WHERE ses_token_hash = ? FOR UPDATE', [$session])->fetch();
        if (!$account || $account['email'] !== field($data, 'email')) {
            $db->rollBack();
            fail(401, 'A sessão mudou. Abra as configurações novamente.');
        }
        if ($action === 'profileAppearance') {
            saveProfileAppearance((int) $account['usr_id'], $data);
        } else {
            if (!array_key_exists('sound', $data)) fail(422, 'Escolha um áudio para salvar.');
            saveProfileSound((int) $account['usr_id'], field($data, 'kind'), $data['sound']);
        }
        $db->commit();
        reply(200, ['account' => accountWithSounds($account)]);
    }

    if ($action === 'logout') {
        if ($session !== null) {
            query($db, 'DELETE FROM Sessao WHERE ses_token_hash = ?', [$session]);
        }
        sessionCookie('');
        reply(200, ['account' => null]);
    }

    if ($action === 'profile') {
        $migrating = ($data['onlyMissing'] ?? false) === true;
        $name = !$migrating && array_key_exists('name', $data) ? displayName($data) : null;
        $db->beginTransaction();
        $account = query($db, 'SELECT usr_id, ' . PROFILE_COLUMNS . ' FROM Sessao
            JOIN Usuario ON usr_id = Usuario_usr_id WHERE ses_token_hash = ? FOR UPDATE', [$session])->fetch();
        if (!$account || $account['email'] !== field($data, 'email')) {
            $db->rollBack();
            fail(401, 'A sessão mudou. Abra as configurações novamente.');
        }
        $old = [];
        foreach (['avatar', 'banner'] as $type) {
            $key = $type . 'Path';
            if (!array_key_exists($type, $data) || ($migrating && $account[$key] !== null)) continue;
            $old[$type] = $account[$key];
            $account[$key] = saveProfileMedia($type, $data[$type], $data['avatarStill'] ?? null, $created, $data['avatarCrop'] ?? null);
        }
        $account['name'] = $name ?? $account['name'];
        query($db, 'UPDATE Usuario SET usr_nome_exibicao = ?, usr_avatar_caminho = ?, usr_banner_caminho = ? WHERE usr_id = ?',
            [$account['name'], $account['avatarPath'], $account['bannerPath'], $account['usr_id']]);
        $db->commit();
        $created = [];
        foreach ($old as $type => $path) removeProfileMedia($path, $type === 'avatar');
        reply(200, ['account' => accountWithSounds($account)]);
    }

    if ($action === 'resendCode') {
        reply(200, ['verification' => issueVerification(null, field($data, 'token'),
            $_SERVER['REMOTE_ADDR'] ?? '', 'sendVerificationEmail')]);
    }

    if ($action !== 'register' && $action !== 'login' && $action !== 'verifyCode') {
        fail(400, 'Ação inválida.');
    }
    if ($action === 'verifyCode') {
        $verified = consumeVerification(field($data, 'token'), field($data, 'code'),
            static fn (array $details) => in_array($details['action'] ?? '', ['login', 'register'], true));
    } else {
        $email = strtolower(trim(field($data, 'email')));
        $password = field($data, 'password');
        if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\s",<>]/', $email)
            || !preg_match('/\A.{8,128}\z/us', $password)) {
            fail(422, 'Informe um e-mail válido e uma senha de 8 a 128 caracteres.');
        }
        // O pré-hash preserva a senha completa mesmo com o limite de 72 bytes do bcrypt.
        $passwordInput = hash('sha256', $password);
        $details = ['action' => $action, 'email' => $email];
        if ($action === 'register') {
            $name = displayName($data);
            $birthDate = field($data, 'birthDate');
            if (!preg_match('/\A([1-9][0-9]{3})-([0-9]{2})-([0-9]{2})\z/', $birthDate, $parts)
                || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
                || $birthDate > (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d')) {
                fail(422, 'Informe uma data de nascimento válida.');
            }
            if (query($db, 'SELECT usr_id FROM Usuario WHERE usr_email = ?', [$email])->fetchColumn() !== false) {
                fail(409, 'Já existe uma conta com esse e-mail.');
            }
            $details += ['name' => $name, 'birthDate' => $birthDate,
                'passwordHash' => password_hash($passwordInput, PASSWORD_BCRYPT)];
        } else {
            $user = query($db, 'SELECT usr_id, usr_senha_hash FROM Usuario WHERE usr_email = ?', [$email])->fetch();
            $hash = $user['usr_senha_hash'] ?? '$2y$12$eImiTXuWVxfM37uY4JANjQwwhGEpG7oWS8wkDSowmFwSeWh6NNpYy';
            if (!password_verify($passwordInput, $hash) || !$user) {
                fail(401, 'O e-mail ou a senha não confere.');
            }
            $details += ['userId' => (int) $user['usr_id'], 'passwordHash' => $hash];
        }
        if ($action !== 'login' || ($data['acceptTrustedDevice'] ?? false) !== true
            || !isTrustedDevice($details['userId'], $email, $details['passwordHash'])) {
            reply(200, ['verification' => issueVerification($details, '', $_SERVER['REMOTE_ADDR'] ?? '', 'sendVerificationEmail')]);
        }
        $verified = $details;
    }

    $email = $verified['email'];
    $registering = $verified['action'] === 'register';
    if ($registering) {
        $name = $verified['name'];
        $birthDate = $verified['birthDate'];
        $db->beginTransaction();
        try {
            query($db, 'INSERT INTO Usuario (usr_nome_exibicao, usr_email, usr_senha_hash, usr_data_nascimento)
                VALUES (?, ?, ?, ?)', [$name, $email, $verified['passwordHash'], $birthDate]);
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) !== 1062) {
                throw $error;
            }
            $db->rollBack();
            fail(409, 'Já existe uma conta com esse e-mail.');
        }
        $userId = (int) $db->lastInsertId();
        joinEntrance($db, $userId);
        $account = ['name' => $name, 'email' => $email, 'birthDate' => $birthDate];
    } else {
        $db->beginTransaction();
        $account = query($db, 'SELECT usr_id, ' . PROFILE_COLUMNS . '
            FROM Usuario WHERE usr_id = ? AND usr_email = ? AND usr_senha_hash = ? FOR UPDATE',
            [$verified['userId'], $email, $verified['passwordHash']])->fetch();
        if (!$account) {
            $db->rollBack();
            fail(401, 'A conta mudou. Volte e entre novamente.');
        }
        $userId = (int) $account['usr_id'];
    }

    $token = createSession($db, $userId, $session);
    $db->commit();
    sessionCookie($token);
    setTrustedDeviceCookie($userId, $email, $verified['passwordHash']);
    $account['usr_id'] = $userId;
    reply($registering ? 201 : 200, ['account' => accountWithSounds($account)]);
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    foreach ($created as $file) @unlink($file);
    if ($error instanceof VerificationError) fail($error->getCode(), $error->getMessage());
    if ($error instanceof DomainException) fail(422, $error->getMessage());
    error_log('Discordo account: ' . get_class($error) . ' (' . $error->getCode() . ')');
    fail(503, 'Não foi possível acessar o banco do Discordo. Tente novamente em instantes.');
}
