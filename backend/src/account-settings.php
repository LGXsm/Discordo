<?php
declare(strict_types=1);

function accountPhonePath(int $user): string
{
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    return dirname($config) . '/discordo-account-contact/' . $user . '.json';
}

function saveAccountPhone(int $user, string $value): void
{
    if (!preg_match('/\A[+0-9 ().-]*\z/', $value)) fail(422, 'Informe um número de telefone válido.');
    $digits = preg_replace('/\D/', '', $value);
    if ($value !== '' && !preg_match('/\A[0-9]{8,15}\z/', $digits)) fail(422, 'Informe um telefone com 8 a 15 dígitos.');
    $phone = $value === '' ? null : (str_starts_with($value, '+') ? '+' : '') . $digits;
    $path = accountPhonePath($user);
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Pasta de contato indisponível.');
    $temp = tempnam($directory, 'contact-');
    if ($temp === false) throw new RuntimeException('Não foi possível preparar o contato.');
    try {
        $encoded = json_encode($phone, JSON_THROW_ON_ERROR);
        if (file_put_contents($temp, $encoded) !== strlen($encoded) || !rename($temp, $path)) {
            throw new RuntimeException('Não foi possível salvar o contato.');
        }
    } finally { if (is_file($temp)) @unlink($temp); }
}

function handleAccountSettings(PDO $db, ?string $session, string $action, array $data): never
{
    if ($session === null) fail(401, 'Entre novamente para acessar sua conta.');
    $db->beginTransaction();
    $account = query($db, 'SELECT usr_id, usr_email, usr_senha_hash FROM Sessao
        JOIN Usuario ON usr_id = Usuario_usr_id WHERE ses_token_hash = ? FOR UPDATE', [$session])->fetch();
    if (!$account) fail(401, 'Entre novamente para acessar sua conta.');
    $id = (int) $account['usr_id'];
    $result = ['saved' => true];
    if ($action === 'accountDetails') {
        $path = accountPhonePath($id);
        $phone = is_file($path) ? json_decode((string) file_get_contents($path), true, 4, JSON_THROW_ON_ERROR) : null;
        $rows = query($db, 'SELECT ses_id AS id, ses_token_hash = ? AS currentSession FROM Sessao
            WHERE Usuario_usr_id = ? ORDER BY currentSession DESC, ses_id DESC', [$session, $id])->fetchAll();
        $result = ['phone' => $phone, 'sessions' => array_map(static fn ($row) =>
            ['id' => (int) $row['id'], 'current' => (bool) $row['currentSession']], $rows)];
    } elseif ($action === 'revokeAccountSession') {
        $target = $data['sessionId'] ?? null;
        if (!is_int($target) || $target <= 0) fail(422, 'Sessão inválida.');
        query($db, 'DELETE FROM Sessao WHERE Usuario_usr_id = ? AND ses_id = ? AND ses_token_hash <> ?', [$id, $target, $session]);
    } elseif ($action === 'confirmAccountEmail') {
        $verified = consumeVerification(field($data, 'token'), field($data, 'code'), static fn (array $details) =>
            ($details['action'] ?? '') === 'changeEmail' && ($details['userId'] ?? null) === $id
            && ($details['session'] ?? null) === bin2hex($session)
            && ($details['previousEmail'] ?? null) === $account['usr_email']
            && ($details['passwordHash'] ?? null) === $account['usr_senha_hash']);
        try {
            query($db, 'UPDATE Usuario SET usr_email = ? WHERE usr_id = ?', [$verified['email'], $id]);
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) === 1062) fail(409, 'Já existe uma conta com esse e-mail.');
            throw $error;
        }
        query($db, 'DELETE FROM Sessao WHERE Usuario_usr_id = ? AND ses_token_hash <> ?', [$id, $session]);
        $result['email'] = $verified['email'];
    } else {
        $password = field($data, 'password');
        verificationState(static function (array &$state, int $now) use ($id) {
            if (!verificationLimit($state, 'account-settings:' . $id, 12, $now, 300)) {
                return new VerificationError('Muitas tentativas. Aguarde alguns minutos.', 429);
            }
        });
        if (!password_verify(hash('sha256', $password), $account['usr_senha_hash'])) fail(403, 'A senha atual não confere.');
        if ($action === 'changeAccountPassword') {
            $next = field($data, 'newPassword');
            if (!preg_match('/\A.{8,128}\z/us', $next)) fail(422, 'Use de 8 a 128 caracteres na nova senha.');
            query($db, 'UPDATE Usuario SET usr_senha_hash = ? WHERE usr_id = ?', [password_hash(hash('sha256', $next), PASSWORD_BCRYPT), $id]);
            query($db, 'DELETE FROM Sessao WHERE Usuario_usr_id = ? AND ses_token_hash <> ?', [$id, $session]);
        } elseif ($action === 'changeAccountPhone') {
            saveAccountPhone($id, trim(field($data, 'phone')));
        } elseif ($action === 'requestAccountEmail') {
            $email = strtolower(trim(field($data, 'email')));
            if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\s",<>]/', $email)) fail(422, 'Informe um e-mail válido.');
            if ($email === $account['usr_email']) fail(422, 'Informe um e-mail diferente do atual.');
            if (query($db, 'SELECT usr_id FROM Usuario WHERE usr_email = ?', [$email])->fetchColumn() !== false) fail(409, 'Já existe uma conta com esse e-mail.');
            $db->commit();
            reply(200, ['verification' => issueVerification(['action' => 'changeEmail', 'email' => $email, 'userId' => $id,
                'session' => bin2hex($session), 'previousEmail' => $account['usr_email'], 'passwordHash' => $account['usr_senha_hash']],
                '', $_SERVER['REMOTE_ADDR'] ?? '', 'sendVerificationEmail')]);
        }
    }
    $db->commit();
    reply(200, $result);
}
