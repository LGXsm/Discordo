<?php
declare(strict_types=1);

const CHANNEL_LAYOUT_MANAGE_PERMISSION = 1;

function requireChannelManagement(int $permissions): void {
    if (!($permissions & CHANNEL_LAYOUT_MANAGE_PERMISSION)) throw new DomainException('Você não pode gerenciar canais e categorias.', 403);
}

function channelLayoutPath(int $server): string {
    $config = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    return dirname($config) . '/discordo-channel-layout/' . $server . '.json';
}

function channelLayoutRows(PDO $db, int $server): array {
    return query($db, 'SELECT cnl_id AS id, cnl_tipo AS type FROM Canal WHERE Servidor_srv_id = ? ORDER BY cnl_id', [$server])->fetchAll();
}

function channelLayout(int $server, array $channels): array {
    $path = channelLayoutPath($server);
    if (is_file($path)) {
        $layout = json_decode((string) file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($layout) || !isset($layout['categories'], $layout['uncategorized'])
            || !is_array($layout['categories']) || !array_is_list($layout['categories']) || !is_array($layout['uncategorized'])) {
            throw new RuntimeException('Organização dos canais indisponível.');
        }
    } else {
        $layout = ['categories' => [
            ['id' => 'default-text', 'name' => 'Canais de texto', 'channels' => array_map('intval', array_column(array_filter($channels, static fn ($c) => $c['type'] === 'TEXTO'), 'id'))],
            ['id' => 'default-voice', 'name' => 'Canais de voz', 'channels' => array_map('intval', array_column(array_filter($channels, static fn ($c) => $c['type'] === 'VOZ'), 'id'))],
        ], 'uncategorized' => []];
    }
    $available = array_map('intval', array_column($channels, 'id'));
    $seen = [];
    $clean = static function (array $ids) use ($available, &$seen): array {
        $result = [];
        foreach ($ids as $id) if (is_int($id) && in_array($id, $available, true) && !isset($seen[$id])) {
            $seen[$id] = true;
            $result[] = $id;
        }
        return $result;
    };
    $layout['uncategorized'] = $clean($layout['uncategorized']);
    foreach ($layout['categories'] as &$category) {
        if (!is_string($category['id'] ?? null) || !preg_match('/\A[a-z0-9-]{1,40}\z/', $category['id'])
            || !is_string($category['name'] ?? null) || !is_array($category['channels'] ?? null)) {
            throw new RuntimeException('Categoria inválida no armazenamento.');
        }
        $category['channels'] = $clean($category['channels']);
    }
    unset($category);
    foreach ($available as $id) if (!isset($seen[$id])) $layout['uncategorized'][] = $id;
    return $layout;
}

function channelCategoryIndex(array $layout, mixed $id): ?int {
    if ($id === null) return null;
    foreach ($layout['categories'] as $index => $category) if ($category['id'] === $id) return $index;
    throw new DomainException('Categoria indisponível neste servidor. Atualize a lista.', 409);
}

function changeChannelLayout(array $layout, string $action, array $data, array $visible): array {
    if ($action === 'category') {
        $name = is_string($data['name'] ?? null) ? trim($data['name']) : '';
        if (!preg_match('/\A[^\p{Cc}]{1,60}\z/u', $name)) throw new DomainException('Digite um nome de até 60 caracteres.', 422);
        if (isset($data['category'])) {
            $index = channelCategoryIndex($layout, $data['category']);
            $layout['categories'][$index]['name'] = $name;
        } else {
            if (count($layout['categories']) >= 100) throw new DomainException('O servidor pode ter até 100 categorias.', 422);
            $layout['categories'][] = ['id' => bin2hex(random_bytes(12)), 'name' => $name, 'channels' => []];
        }
    } elseif ($action === 'deleteCategory') {
        $index = channelCategoryIndex($layout, $data['category'] ?? '');
        array_push($layout['uncategorized'], ...$layout['categories'][$index]['channels']);
        array_splice($layout['categories'], $index, 1);
    } elseif ($action === 'moveCategory') {
        $index = channelCategoryIndex($layout, $data['category'] ?? '');
        $before = $data['before'] ?? null;
        channelCategoryIndex($layout, $before);
        if ($before === $data['category']) return $layout;
        $category = $layout['categories'][$index];
        array_splice($layout['categories'], $index, 1);
        $target = channelCategoryIndex($layout, $before) ?? count($layout['categories']);
        array_splice($layout['categories'], $target, 0, [$category]);
    } elseif ($action === 'moveChannel') {
        $channel = $data['channel'] ?? null;
        if (!is_int($channel) || !in_array($channel, $visible, true)) throw new DomainException('Canal indisponível neste servidor.', 404);
        $index = channelCategoryIndex($layout, $data['category'] ?? null);
        $before = $data['before'] ?? null;
        $destination = $index === null ? $layout['uncategorized'] : $layout['categories'][$index]['channels'];
        if ($before !== null && (!is_int($before) || !in_array($before, $visible, true) || !in_array($before, $destination, true))) {
            throw new DomainException('O canal de destino mudou. Atualize a lista.', 409);
        }
        if ($before === $channel) return $layout;
        $layout['uncategorized'] = array_values(array_diff($layout['uncategorized'], [$channel]));
        foreach ($layout['categories'] as &$category) $category['channels'] = array_values(array_diff($category['channels'], [$channel]));
        unset($category);
        if ($index === null) $list =& $layout['uncategorized'];
        else $list =& $layout['categories'][$index]['channels'];
        $position = $before === null ? count($list) : array_search($before, $list, true);
        array_splice($list, $position, 0, [$channel]);
        unset($list);
    } else throw new DomainException('Organização inválida.', 422);
    return $layout;
}

function saveChannelLayout(int $server, array $layout): void {
    $path = channelLayoutPath($server);
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Pasta de categorias indisponível.');
    $temporary = tempnam($directory, 'layout-');
    if ($temporary === false) throw new RuntimeException('Não foi possível preparar a organização.');
    try {
        $json = json_encode($layout, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) throw new RuntimeException('Não foi possível salvar as categorias.');
    } finally { if (is_file($temporary)) @unlink($temporary); }
}
