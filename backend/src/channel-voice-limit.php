<?php
declare(strict_types=1);

function voiceLimitPath(int $channel): string
{
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    return dirname($config) . '/discordo-voice-limits/' . $channel . '.txt';
}

function validateVoiceLimit(mixed $limit): ?int
{
    if ($limit === null) return null;
    if (!is_int($limit) || $limit < 1 || $limit > 2147483647) {
        throw new DomainException('Informe um número inteiro positivo para o limite de participantes.', 422);
    }
    return $limit;
}

function channelVoiceLimit(int $channel): ?int
{
    $path = voiceLimitPath($channel);
    clearstatcache(true, $path);
    if (!is_file($path)) return null;
    $value = @file_get_contents($path);
    if ($value === false) {
        clearstatcache(true, $path);
        if (!is_file($path)) return null;
    }
    if ($value === false || !preg_match('/\A[1-9][0-9]{0,9}\z/', $value)) {
        throw new RuntimeException('Limite de voz indisponível.');
    }
    return validateVoiceLimit((int) $value);
}

function saveChannelVoiceLimit(int $channel, ?int $limit): void
{
    $path = voiceLimitPath($channel);
    if ($limit === null) {
        if (is_file($path) && !unlink($path)) throw new RuntimeException('Falha ao retirar o limite do canal.');
        return;
    }
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de limites de voz indisponível.');
    }
    $temporary = tempnam($directory, 'voice-limit-');
    if ($temporary === false) throw new RuntimeException('Falha ao preparar o limite do canal.');
    try {
        $value = (string) $limit;
        if (file_put_contents($temporary, $value) !== strlen($value) || !rename($temporary, $path)) {
            throw new RuntimeException('Falha ao salvar o limite do canal.');
        }
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
}
