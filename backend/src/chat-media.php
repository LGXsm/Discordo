<?php
declare(strict_types=1);

const CHAT_VIDEO_LIMIT = 20 * 1024 * 1024;
const CHAT_VIDEO_MIME = ['mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime'];
const CHAT_IMAGE_MIME = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];
const CHAT_MEDIA_MIME = CHAT_VIDEO_MIME + CHAT_IMAGE_MIME;

function chatVideoDirectory(): string
{
    return dirname(getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php') . '/discordo-chat-videos';
}

function chatMediaKind(?string $name): ?string
{
    if (!$name || !preg_match('/\A[a-f0-9]{32}\.([a-z0-9]+)\z/', $name, $parts)) return null;
    return isset(CHAT_IMAGE_MIME[$parts[1]]) ? 'image' : (isset(CHAT_VIDEO_MIME[$parts[1]]) ? 'video' : null);
}

function chatMediaPath(?string $name): ?string
{
    return chatMediaKind($name) ? chatVideoDirectory() . '/' . $name : null;
}

function saveChatMedia(array $file): string
{
    if (($file['error'] ?? null) !== UPLOAD_ERR_OK || !is_int($file['size'] ?? null)
        || $file['size'] < 1 || $file['size'] > CHAT_VIDEO_LIMIT || !is_uploaded_file($file['tmp_name'] ?? '')) {
        throw new DomainException('Escolha uma imagem ou vídeo de até 20 MB.', 422);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $extension = array_search($mime, CHAT_MEDIA_MIME, true);
    if (!$extension) throw new DomainException('Escolha uma imagem JPG, PNG, WebP ou GIF, ou um vídeo MP4, WebM ou MOV.', 422);
    if (isset(CHAT_IMAGE_MIME[$extension])) {
        $image = @getimagesize($file['tmp_name']);
        if (!$image || $image['mime'] !== $mime || min($image[0], $image[1]) < 1 || $image[0] * $image[1] > 40000000) {
            throw new DomainException('Escolha uma imagem válida de até 40 megapixels.', 422);
        }
    }
    $directory = chatVideoDirectory();
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de anexos indisponível.');
    }
    $name = bin2hex(random_bytes(16)) . '.' . $extension;
    if (!move_uploaded_file($file['tmp_name'], $directory . '/' . $name)) throw new RuntimeException('Falha ao salvar anexo.');
    return $name;
}

function sendChatMedia(string $file, string $method): never
{
    $stream = @fopen($file, 'rb');
    if (!$stream) throw new DomainException('Anexo indisponível.', 404);
    $size = fstat($stream)['size'];
    $start = 0;
    $end = $size - 1;
    header('Accept-Ranges: bytes');
    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = $_SERVER['HTTP_RANGE'];
        if (!preg_match('/\Abytes=([0-9]*)-([0-9]*)\z/', $range, $parts)
            || ($parts[1] === '' && (int) $parts[2] < 1)) {
            header("Content-Range: bytes */$size");
            throw new DomainException('Intervalo de anexo inválido.', 416);
        }
        if ($parts[1] === '') $start = max(0, $size - (int) $parts[2]);
        else {
            $start = (int) $parts[1];
            if ($parts[2] !== '') $end = min($end, (int) $parts[2]);
        }
        if ($start > $end) {
            header("Content-Range: bytes */$size");
            throw new DomainException('Intervalo de anexo inválido.', 416);
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    $length = $end - $start + 1;
    header('Content-Type: ' . CHAT_MEDIA_MIME[pathinfo($file, PATHINFO_EXTENSION)]);
    header('Content-Length: ' . $length);
    if ($method !== 'HEAD') {
        fseek($stream, $start);
        fpassthruRange($stream, $length);
    }
    fclose($stream);
    exit;
}

function fpassthruRange($stream, int $length): void
{
    while ($length > 0 && !feof($stream) && !connection_aborted()) {
        $data = fread($stream, min(65536, $length));
        if ($data === false || $data === '') break;
        echo $data;
        $length -= strlen($data);
    }
}
