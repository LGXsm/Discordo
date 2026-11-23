<?php
declare(strict_types=1);

require_once __DIR__ . '/profile-media.php';

const VOICE_ROOM_SOUND_TYPES = ['entrySound', 'exitSound', 'moveEntrySound', 'moveExitSound'];
const PROFILE_SOUND_TYPES = [...VOICE_ROOM_SOUND_TYPES, 'punishedSound', 'disconnectSound', 'absenceSound'];

function profileSoundDirectory(): string
{
    return profileMediaDirectory() . '/sounds';
}

function profileSoundPath(mixed $path): bool
{
    return is_string($path) && preg_match('/\A[a-f0-9]{32}\.mp3\z/', $path) === 1;
}

function profileSoundFiles(int $user): array
{
    $path = profileSoundDirectory() . '/' . $user . '.json';
    if (!is_file($path)) return [];
    $files = json_decode((string) @file_get_contents($path), true);
    return is_array($files) ? $files : [];
}

function profileSoundUrls(int $user, bool $roomOnly = false): array
{
    $files = profileSoundFiles($user);
    $result = [];
    foreach ($roomOnly ? VOICE_ROOM_SOUND_TYPES : PROFILE_SOUND_TYPES as $type) {
        $path = $files[$type] ?? null;
        $result[$type . 'Url'] = profileSoundPath($path) ? 'account.php?sound=' . $path : null;
    }
    return $result;
}

function decodeProfileSound(mixed $value): string
{
    $prefix = 'data:audio/mpeg;base64,';
    if (!is_string($value) || !str_starts_with($value, $prefix) || strlen($value) > 274000) {
        throw new DomainException('Escolha um áudio válido de até 200 KB.');
    }
    $bytes = base64_decode(substr($value, strlen($prefix)), true);
    if ($bytes === false || strlen($bytes) > 200 * 1024) throw new DomainException('O áudio deve ter até 200 KB.');
    $length = strlen($bytes);
    // Prepared clips are raw mono MPEG-2 Layer III, 24 kHz, 64 kbps. Each frame contains 576 samples.
    $frameSize = 192;
    if ($length === 0 || $length % $frameSize !== 0 || intdiv($length, $frameSize) * 576 > 48000) {
        throw new DomainException('O som precisa ser um MP3 de até 2 segundos.');
    }
    for ($offset = 0; $offset < $length; $offset += $frameSize) {
        if (substr($bytes, $offset, 2) !== "\xFF\xF3" || (ord($bytes[$offset + 2]) & 0xFE) !== 0x84
            || (ord($bytes[$offset + 3]) & 0xC0) !== 0xC0) {
            throw new DomainException('O áudio enviado tem um formato inválido.');
        }
    }
    return $bytes;
}

function saveProfileSound(int $user, string $type, mixed $value): void
{
    if (!in_array($type, PROFILE_SOUND_TYPES, true)) throw new DomainException('Tipo de som inválido.');
    $bytes = $value === null ? null : decodeProfileSound($value);
    $directory = profileSoundDirectory();
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de sons indisponível.');
    }
    $lock = fopen("$directory/$user.lock", 'c');
    if (!$lock) throw new RuntimeException('Falha ao abrir a trava dos sons.');
    $created = null;
    $temporary = null;
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Falha ao travar os sons.');
        $files = profileSoundFiles($user);
        $old = $files[$type] ?? null;
        unset($files[$type]);
        if ($bytes !== null) {
            $name = bin2hex(random_bytes(16)) . '.mp3';
            $created = "$directory/$name";
            if (file_put_contents($created, $bytes) !== strlen($bytes)) throw new RuntimeException('Falha ao salvar áudio.');
            $files[$type] = $name;
        }
        $temporary = tempnam($directory, 'sounds-');
        $manifest = json_encode($files, JSON_THROW_ON_ERROR);
        if ($temporary === false || file_put_contents($temporary, $manifest) !== strlen($manifest)
            || !rename($temporary, "$directory/$user.json")) {
            throw new RuntimeException('Falha ao atualizar os sons do perfil.');
        }
        $created = null;
        if (profileSoundPath($old)) @unlink("$directory/$old");
    } finally {
        if ($created !== null) @unlink($created);
        if (is_string($temporary)) @unlink($temporary);
        fclose($lock);
    }
}
