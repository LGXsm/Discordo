<?php
declare(strict_types=1);

function reservedRoleColorPath(int $server): string
{
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    return dirname($config) . '/discordo-reserved-role-colors/' . $server . '.json';
}

function editableReservedRoles(array $server, int $user, bool $creator): array
{
    $titles = $creator ? ['Criador'] : [];
    if ($server['owner'] !== null && ($creator || (int) $server['owner'] === $user)) $titles[] = 'ADM';
    return $titles;
}

function roleColor(mixed $color): ?string
{
    if ($color === null) return null;
    if (!is_string($color) || !preg_match('/\A#[0-9A-Fa-f]{6}\z/', $color)) {
        throw new DomainException('Escolha uma cor sólida válida.', 422);
    }
    return strtoupper($color);
}

function reservedRoleColors(int $server): array
{
    $path = reservedRoleColorPath($server);
    if (!is_file($path)) return [];
    $json = file_get_contents($path);
    if ($json === false) throw new RuntimeException('Cores dos cargos indisponíveis.');
    $colors = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
    if (!is_array($colors)) throw new RuntimeException('Cores dos cargos indisponíveis.');
    return $colors;
}

function saveReservedRoleColor(int $server, string $title, ?string $color): void
{
    // The server row is locked by the caller while reading and replacing this file.
    $colors = reservedRoleColors($server);
    if ($color === null) unset($colors[$title]);
    else $colors[$title] = $color;
    $path = reservedRoleColorPath($server);
    $directory = dirname($path);
    if ($colors === [] && !is_file($path)) return;
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta das cores dos cargos indisponível.');
    }
    $temporary = tempnam($directory, 'role-color-');
    if ($temporary === false) throw new RuntimeException('Não foi possível preparar a cor do cargo.');
    try {
        $json = json_encode($colors, JSON_THROW_ON_ERROR);
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) {
            throw new RuntimeException('Não foi possível salvar a cor do cargo.');
        }
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
}
