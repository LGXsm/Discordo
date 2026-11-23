<?php
declare(strict_types=1);

const VERIFICATION_TTL = 600;
const VERIFICATION_RESEND = 60;
const TRUSTED_DEVICE_TTL = 365 * 86400;

final class VerificationError extends RuntimeException {}

function trustedDeviceCookieName(int $user): string
{
    return 'discordo_trusted_' . $user;
}

function trustedDeviceSignature(string $proof, int $user, string $email, string $passwordHash): string
{
    // A referência à credencial atual invalida a confiança após mudar a senha ou o e-mail.
    return hash_hmac('sha256', "discordo:trusted-device:v1\0" . $user . "\0" . $email . "\0" . $proof, $passwordHash);
}

function isTrustedDevice(int $user, string $email, string $passwordHash): bool
{
    $cookie = $_COOKIE[trustedDeviceCookieName($user)] ?? '';
    if (!is_string($cookie) || !preg_match('/\A(([0-9]{10,12})\.[a-f0-9]{64})\.([a-f0-9]{64})\z/', $cookie, $parts)
        || (int) $parts[2] <= time()) {
        return false;
    }
    return hash_equals(trustedDeviceSignature($parts[1], $user, $email, $passwordHash), $parts[3]);
}

function setTrustedDeviceCookie(int $user, string $email, string $passwordHash, bool $forget = false): void
{
    $expires = $forget ? time() - 3600 : time() + TRUSTED_DEVICE_TTL;
    $proof = $expires . '.' . bin2hex(random_bytes(32));
    $cookie = $forget ? '' : $proof . '.' . trustedDeviceSignature($proof, $user, $email, $passwordHash);
    setcookie(trustedDeviceCookieName($user), $cookie, [
        'expires' => $expires,
        'path' => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/',
        'secure' => PHP_SAPI !== 'cli-server',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function verificationState(callable $change): mixed
{
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    $directory = dirname($config) . '/.discordo-verification';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de verificações indisponível.');
    }
    $lock = fopen($directory . '/lock', 'c');
    if (!$lock) throw new RuntimeException('Bloqueio de verificações indisponível.');
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Não foi possível bloquear verificações.');
        $path = $directory . '/state.json';
        $state = is_file($path) ? json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR)
            : ['challenges' => [], 'limits' => []];
        $now = time();
        $state['challenges'] = array_filter($state['challenges'], fn ($item) => $item['expires'] > $now);
        $state['limits'] = array_filter($state['limits'], fn ($item) => $item['until'] > $now);
        $result = $change($state, $now);
        $temporary = tempnam($directory, 'state-');
        if ($temporary === false) throw new RuntimeException('Não foi possível preparar verificações.');
        try {
            $json = json_encode($state, JSON_THROW_ON_ERROR);
            if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) {
                throw new RuntimeException('Não foi possível salvar verificações.');
            }
        } finally {
            if (is_file($temporary)) @unlink($temporary);
        }
        if ($result instanceof VerificationError) throw $result;
        return $result;
    } finally {
        fclose($lock);
    }
}

function verificationLimit(array &$state, string $key, int $max, int $now, int $seconds): bool
{
    $entry = $state['limits'][$key] ?? ['count' => 0, 'until' => $now + $seconds];
    if ($entry['count'] >= $max) return false;
    $entry['count']++;
    $state['limits'][$key] = $entry;
    return true;
}

function verificationToken(string $token): string
{
    if (!preg_match('/\A[a-f0-9]{64}\z/', $token)) throw new VerificationError('Solicite um novo código.', 410);
    return hash('sha256', $token);
}

function issueVerification(?array $details, string $previous, string $ip, callable $send): array
{
    if ($details === null && $previous === '') throw new VerificationError('Solicite um novo código.', 410);
    $previousKey = $previous === '' ? null : verificationToken($previous);
    $token = $previousKey === null ? bin2hex(random_bytes(32)) : $previous;
    $key = verificationToken($token);
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $digest = hash_hmac('sha256', $code, $token);
    [$email, $old, $resendAt] = verificationState(function (array &$state, int $now) use ($details, $previousKey, $key, $digest, $ip) {
        $old = null;
        if ($previousKey !== null) {
            $old = $state['challenges'][$previousKey] ?? null;
            if ($old === null) return new VerificationError('O código expirou. Volte e solicite um novo.', 410);
            if ($old['resend'] > $now) return new VerificationError('Aguarde um minuto entre os envios.', 429);
            $details = $old['details'];
        }
        $email = $details['email'];
        $recipient = 'email:' . hash('sha256', $email);
        $client = 'ip:' . hash('sha256', $ip);
        if (isset($state['limits']['recent:' . $recipient])) {
            return new VerificationError('Aguarde um minuto entre os envios.', 429);
        }
        $limits = ['limits' => $state['limits']];
        if (!verificationLimit($limits, $client, 15, $now, 3600)
            || !verificationLimit($limits, $recipient, 5, $now, 3600)
            || !verificationLimit($limits, 'global', 100, $now, 3600)) {
            return new VerificationError('Limite de envios atingido. Tente novamente mais tarde.', 429);
        }
        $state['limits'] = $limits['limits'];
        verificationLimit($state, 'recent:' . $recipient, 1, $now, VERIFICATION_RESEND);
        $state['challenges'][$key] = [
            'details' => $details, 'digest' => $digest, 'expires' => $now + VERIFICATION_TTL,
            'resend' => $now + VERIFICATION_RESEND, 'attempts' => 0,
        ];
        return [$email, $old, $now + VERIFICATION_RESEND];
    });
    if (!$send($email, $code)) {
        verificationState(function (array &$state, int $now) use ($key, $digest, $old, $resendAt) {
            $current = $state['challenges'][$key] ?? null;
            if ($current === null || $current['digest'] !== $digest || $current['resend'] !== $resendAt) return;
            if ($old !== null && $old['expires'] > $now) {
                $old['resend'] = $resendAt;
                $state['challenges'][$key] = $old;
            } else {
                unset($state['challenges'][$key]);
            }
        });
        throw new VerificationError('Não foi possível enviar o código. Tente novamente em instantes.', 503);
    }
    return ['token' => $token, 'resendAfter' => VERIFICATION_RESEND];
}

function consumeVerification(string $token, string $code, ?callable $accept = null): array
{
    $key = verificationToken($token);
    if (!preg_match('/\A[0-9]{6}\z/', $code)) throw new VerificationError('Digite os seis números do código.', 422);
    return verificationState(function (array &$state) use ($key, $token, $code, $accept) {
        $item = $state['challenges'][$key] ?? null;
        if ($item === null || ($accept !== null && !$accept($item['details']))) {
            return new VerificationError('O código expirou. Volte e solicite um novo.', 410);
        }
        if ($item['attempts'] >= 5) return new VerificationError('Muitas tentativas. Reenvie o código.', 429);
        if (!hash_equals($item['digest'], hash_hmac('sha256', $code, $token))) {
            $state['challenges'][$key]['attempts']++;
            return new VerificationError($item['attempts'] === 4 ? 'Muitas tentativas. Reenvie o código.' : 'O código não confere.', 422);
        }
        unset($state['challenges'][$key]);
        return $item['details'];
    });
}

function sendVerificationEmail(string $email, string $code): bool
{
    $from = getenv('DISCORDO_MAIL_FROM') ?: 'discordo@lgmartinez.com';
    if (!filter_var($from, FILTER_VALIDATE_EMAIL) || !function_exists('mail')
        || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\s",<>]/', $email)) return false;
    $message = "Seu código do Discordo é: $code\r\n\r\n"
        . "Ele expira em 10 minutos. Use-o somente na tela do Discordo.\r\n"
        . "Se você não solicitou este código, pode ignorar esta mensagem.\r\n";
    return @mail($email, 'Seu codigo do Discordo', $message, [
        'From' => "Discordo <$from>",
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => '8bit',
    ]);
}
