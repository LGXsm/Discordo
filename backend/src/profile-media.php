<?php
declare(strict_types=1);

const PROFILE_MEDIA_COLUMNS = 'usr_avatar_caminho AS avatarPath, usr_banner_caminho AS bannerPath';
const PROFILE_MEDIA_MIME = ['png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'jpg' => 'image/jpeg'];

function profileMediaDirectory(): string
{
    return dirname(getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php') . '/discordo-profile-media';
}

function profileMediaPath(mixed $path): bool
{
    return is_string($path) && preg_match('/\A[a-f0-9]{32}(?:-still)?\.(?:webp|png|gif|jpg)\z/', $path);
}

function profileMediaUrls(array $row): array
{
    $result = [];
    foreach (['avatar', 'banner'] as $type) {
        $path = $row[$type . 'Path'] ?? null;
        if ($path === null) continue;
        $result[$type . 'Url'] = profileMediaPath($path) ? 'account.php?media=' . $path : null;
        if ($type === 'avatar' && profileMediaPath($path) && str_ends_with($path, '.gif')) {
            $result['avatarStillUrl'] = 'account.php?media=' . substr($path, 0, -4) . '-still.png';
            $metadata = profileMediaDirectory() . '/' . substr($path, 0, -4) . '-crop.json';
            if (is_file($metadata)) $result['avatarCrop'] = json_decode((string) @file_get_contents($metadata), true);
        }
    }
    return $result;
}

function profileAccount(array $row): array
{
    $media = profileMediaUrls($row);
    unset($row['avatarPath'], $row['bannerPath']);
    return $row + $media;
}

function decodeProfileImage(mixed $value, int $width, int $height, bool $allowGif): array
{
    if (!is_string($value) || !preg_match('~\Adata:(image/(?:png|webp|gif|jpeg));base64,~', $value, $matches)) {
        throw new DomainException('Escolha uma imagem válida para o perfil.');
    }
    $bytes = base64_decode(substr($value, strlen($matches[0])), true);
    if ($bytes === false || strlen($bytes) > 1048608) throw new DomainException('A imagem preparada é muito grande.');
    $info = @getimagesizefromstring($bytes);
    $extension = array_search($matches[1], PROFILE_MEDIA_MIME, true);
    $fits = $extension === 'gif' ? $allowGif && ($info[0] ?? 0) <= 4096 && ($info[1] ?? 0) <= 4096
        : ($info[0] ?? 0) === $width && ($info[1] ?? 0) === $height;
    if (!$info || $info['mime'] !== $matches[1] || !$fits) {
        throw new DomainException('A imagem do perfil tem formato ou dimensões inválidos.');
    }
    return [$bytes, $extension, $info];
}

function writeProfileImage(string $filename, string $bytes, array &$created): void
{
    $directory = profileMediaDirectory();
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de imagens indisponível.');
    }
    $path = $directory . '/' . $filename;
    $created[] = $path;
    if (file_put_contents($path, $bytes) !== strlen($bytes)) throw new RuntimeException('Falha ao salvar imagem.');
}

function validateAvatarCrop(mixed $crop, int $width, int $height): array
{
    if (!is_array($crop) || !is_int($crop['turns'] ?? null) || $crop['turns'] < 0 || $crop['turns'] > 3) {
        throw new DomainException('O recorte da foto é inválido.');
    }
    $result = ['width' => $width, 'height' => $height, 'turns' => $crop['turns']];
    foreach (['zoom' => [1, 3], 'x' => [-1, 1], 'y' => [-1, 1]] as $key => [$min, $max]) {
        $value = $crop[$key] ?? null;
        if ((!is_float($value) && !is_int($value)) || !is_finite((float) $value) || $value < $min || $value > $max) {
            throw new DomainException('O recorte da foto é inválido.');
        }
        $result[$key] = $value;
    }
    return $result;
}

function saveProfileMedia(string $type, mixed $value, mixed $still, array &$created, mixed $crop = null): string
{
    if ($value === null) return '';
    $avatar = $type === 'avatar';
    [$bytes, $extension, $info] = decodeProfileImage($value, $avatar ? 192 : 640, $avatar ? 192 : 224, true);
    $key = bin2hex(random_bytes(16));
    $filename = $key . '.' . $extension;
    if ($avatar && $extension === 'gif') {
        if ($crop !== null) {
            $metadata = validateAvatarCrop($crop, $info[0], $info[1]);
            writeProfileImage($key . '-crop.json', json_encode($metadata, JSON_THROW_ON_ERROR), $created);
        }
        [$frame, $frameExtension] = decodeProfileImage($still, 192, 192, false);
        if ($frameExtension !== 'png') throw new DomainException('Não foi possível preparar a miniatura do GIF.');
        writeProfileImage($key . '-still.png', $frame, $created);
    }
    writeProfileImage($filename, $bytes, $created);
    return $filename;
}

function removeProfileMedia(?string $path, bool $avatar): void
{
    if (!profileMediaPath($path)) return;
    $directory = profileMediaDirectory();
    @unlink($directory . '/' . $path);
    if ($avatar && str_ends_with($path, '.gif')) {
        @unlink($directory . '/' . substr($path, 0, -4) . '-still.png');
        @unlink($directory . '/' . substr($path, 0, -4) . '-crop.json');
    }
}
