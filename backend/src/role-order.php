<?php
declare(strict_types=1);

function roleOrderPath(int $server): string
{
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    return dirname($config) . '/discordo-role-order/' . $server . '.json';
}

function orderedRoleIds(array $available, array $saved): array
{
    return array_values(array_unique([...array_intersect($saved, $available), ...$available]));
}

function validRoleOrder(array $current, mixed $proposed): bool
{
    if (!is_array($proposed) || !array_is_list($proposed)) return false;
    sort($current, SORT_NUMERIC);
    sort($proposed, SORT_NUMERIC);
    return $current === $proposed;
}

function serverRoleOrder(int $server): array
{
    $path = roleOrderPath($server);
    if (!is_file($path)) return [];
    $data = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !array_is_list($data)) throw new RuntimeException('Ordem dos cargos indisponível.');
    return $data;
}

function saveServerRoleOrder(int $server, array $ids): void
{
    $path = roleOrderPath($server);
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de hierarquia indisponível.');
    }
    $temporary = tempnam($directory, 'order-');
    if ($temporary === false) throw new RuntimeException('Não foi possível preparar a hierarquia.');
    try {
        $json = json_encode($ids, JSON_THROW_ON_ERROR);
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) {
            throw new RuntimeException('Não foi possível salvar a hierarquia dos cargos.');
        }
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
}
