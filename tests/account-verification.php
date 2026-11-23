<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/account-verification.php';
require_once __DIR__ . '/../backend/src/database.php';

function checkVerification(bool $condition): void
{
    if (!$condition) throw new RuntimeException('Falha na verificação em ' . debug_backtrace()[0]['line']);
}

function expectVerificationError(int $status, callable $run): void
{
    try {
        $run();
    } catch (VerificationError $error) {
        checkVerification($error->getCode() === $status);
        return;
    }
    throw new RuntimeException('Esperava erro ' . $status);
}

$folder = sys_get_temp_dir() . '/discordo-verification-test-' . bin2hex(random_bytes(8));
mkdir($folder, 0700);
putenv('DISCORDO_DB_CONFIG=' . $folder . '/db.php');
try {
    $sessionToken = bin2hex(random_bytes(32));
    $_COOKIE[SESSION_COOKIE] = $sessionToken;
    checkVerification(sessionHash() === verifiedSessionTokenHash($sessionToken));
    checkVerification(sessionHash() !== hash('sha256', $sessionToken, true) && strlen(sessionHash()) === 32);
    unset($_COOKIE[SESSION_COOKIE]);
    checkVerification(sessionHash() === null);
    $email = 'person@example.test';
    $passwordHash = password_hash(hash('sha256', 'password-for-test'), PASSWORD_BCRYPT);
    $cookieName = trustedDeviceCookieName(10);
    $proof = (time() + 1800) . '.' . bin2hex(random_bytes(32));
    $cookie = $proof . '.' . trustedDeviceSignature($proof, 10, $email, $passwordHash);
    checkVerification(!isTrustedDevice(10, $email, $passwordHash));
    $_COOKIE[$cookieName] = $cookie;
    checkVerification(isTrustedDevice(10, $email, $passwordHash));
    $_COOKIE[trustedDeviceCookieName(11)] = $cookie;
    checkVerification(!isTrustedDevice(11, $email, $passwordHash));
    checkVerification(!isTrustedDevice(10, 'updated@example.test', $passwordHash));
    checkVerification(!isTrustedDevice(10, $email, password_hash(hash('sha256', 'updated-password'), PASSWORD_BCRYPT)));
    $_COOKIE[$cookieName] = $proof . '.' . str_repeat('a', 64);
    checkVerification(!isTrustedDevice(10, $email, $passwordHash));
    $expiredProof = (time() - 60) . '.' . bin2hex(random_bytes(32));
    $_COOKIE[$cookieName] = $expiredProof . '.' . trustedDeviceSignature($expiredProof, 10, $email, $passwordHash);
    checkVerification(!isTrustedDevice(10, $email, $passwordHash));
    unset($_COOKIE[$cookieName], $_COOKIE[trustedDeviceCookieName(11)]);
    $details = ['action' => 'register', 'email' => 'person@example.test', 'name' => 'Pessoa'];
    $code = '';
    $send = static function (string $email, string $sent) use (&$code, $details): bool {
        checkVerification($email === $details['email'] && preg_match('/^[0-9]{6}$/', $sent) === 1);
        $code = $sent;
        return true;
    };
    $challenge = issueVerification($details, '', '127.0.0.1', $send);
    $token = $challenge['token'];
    checkVerification(!isset($challenge['code']) && $challenge['resendAfter'] === 60);
    expectVerificationError(410, fn () => consumeVerification(str_repeat('a', 64), $code));
    expectVerificationError(429, fn () => issueVerification(null, $token, '127.0.0.1', $send));
    expectVerificationError(429, fn () => issueVerification($details, '', '127.0.0.2', $send));
    $retryDetails = ['action' => 'login', 'email' => 'resend@example.test', 'userId' => 12];
    $originalCode = '';
    $retryToken = issueVerification($retryDetails, '', '127.0.0.1', static function ($email, $sent) use (&$originalCode): bool {
        $originalCode = $sent;
        return true;
    })['token'];
    verificationState(static function (array &$state) use ($retryToken, $retryDetails): void {
        $state['challenges'][verificationToken($retryToken)]['resend'] = 0;
        unset($state['limits']['recent:email:' . hash('sha256', $retryDetails['email'])]);
    });
    expectVerificationError(503, fn () => issueVerification(null, $retryToken, '127.0.0.1', fn () => false));
    expectVerificationError(429, fn () => issueVerification(null, $retryToken, '127.0.0.1', fn () => true));
    expectVerificationError(410, fn () => consumeVerification($retryToken, $originalCode, fn ($details) => $details['action'] === 'changeEmail'));
    checkVerification(consumeVerification($retryToken, $originalCode) === $retryDetails);
    $wrong = $code === '000000' ? '000001' : '000000';
    for ($i = 0; $i < 5; $i++) expectVerificationError(422, fn () => consumeVerification($token, $wrong));
    expectVerificationError(429, fn () => consumeVerification($token, $code));
    verificationState(static function (array &$state) use ($token): void {
        $state['challenges'][verificationToken($token)]['resend'] = 0;
        unset($state['limits']['recent:email:' . hash('sha256', 'person@example.test')]);
    });
    checkVerification(issueVerification(null, $token, '127.0.0.1', $send)['token'] === $token);
    checkVerification(consumeVerification($token, $code) === $details);
    expectVerificationError(410, fn () => consumeVerification($token, $code));
    expectVerificationError(410, fn () => issueVerification(null, '', '', $send));
    $login = ['action' => 'login', 'email' => 'second@example.test', 'userId' => 11];
    expectVerificationError(503, fn () => issueVerification($login, '', '127.0.0.1', fn () => false));
    verificationState(static function (array &$state): void {
        checkVerification($state['challenges'] === []);
        unset($state['limits']['recent:email:' . hash('sha256', 'second@example.test')]);
    });
    $expired = issueVerification($login, '', '127.0.0.1', fn () => true)['token'];
    verificationState(static function (array &$state) use ($expired): void {
        $state['challenges'][verificationToken($expired)]['expires'] = 0;
    });
    expectVerificationError(410, fn () => consumeVerification($expired, '000000'));
    echo "Account verification checks passed.\n";
} finally {
    foreach (glob($folder . '/.discordo-verification/*') as $file) unlink($file);
    rmdir($folder . '/.discordo-verification');
    rmdir($folder);
}
