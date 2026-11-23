<?php
declare(strict_types=1);

require_once __DIR__ . '/server-access.php';
require_once __DIR__ . '/server-invites.php';
require_once __DIR__ . '/profile-media.php';
require_once __DIR__ . '/profile-appearance.php';
require_once __DIR__ . '/chat-media.php';
require_once __DIR__ . '/channel-voice-limit.php';
require_once __DIR__ . '/role-order.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function invalid(string $message, int $status = 422): never
{
    throw new DomainException($message, $status);
}

function inputId(array $data, string $key): int
{
    $id = filter_var($data[$key] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4294967295]]);
    if ($id === false) invalid('Identificador inválido.');
    return $id;
}

function inputName(array $data): string
{
    $name = is_string($data['name'] ?? null) ? trim($data['name']) : '';
    if (!preg_match('/\A[^\p{Cc}]{1,60}\z/u', $name)) invalid('Digite um nome de até 60 caracteres.');
    return $name;
}

function storeIcon(mixed $value): ?string
{
    if ($value === null) return null;
    if (!is_string($value) || !str_starts_with($value, 'data:image/png;base64,')) invalid('Envie uma imagem válida.');
    $image = base64_decode(substr($value, 22), true);
    $info = $image !== false ? @getimagesizefromstring($image) : false;
    if (!$info || $info[2] !== IMAGETYPE_PNG || $info[0] !== 128 || $info[1] !== 128 || strlen($image) > 90000) {
        invalid('A imagem do servidor é inválida.');
    }
    $directory = iconDirectory();
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de ícones indisponível.');
    }
    $filename = bin2hex(random_bytes(16)) . '.png';
    if (file_put_contents($directory . '/' . $filename, $image) === false) throw new RuntimeException('Falha ao salvar ícone.');
    return $filename;
}

function serverRow(PDO $db, int $server, bool $lock = false): array
{
    $row = query($db, 'SELECT srv_id AS id, srv_nome AS name, srv_imagem_caminho AS image,
        Usuario_usr_id_Proprietario AS owner, srv_entrada AS lobby FROM Servidor WHERE srv_id = ?' . ($lock ? ' FOR UPDATE' : ''), [$server])->fetch();
    if (!$row) invalid('Servidor indisponível.', 404);
    return $row;
}

function membership(PDO $db, int $server, int $user): bool
{
    return (bool) query($db, 'SELECT 1 FROM MembroServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?', [$server, $user])->fetchColumn();
}

function serverList(PDO $db, int $user, bool $creator): array
{
    $rows = query($db, 'SELECT s.srv_id AS id, s.srv_nome AS name, s.srv_imagem_caminho IS NOT NULL AS hasIcon,
        s.Usuario_usr_id_Proprietario AS owner, s.srv_entrada AS lobby FROM Servidor s
        LEFT JOIN MembroServidor m ON m.Servidor_srv_id = s.srv_id AND m.Usuario_usr_id = ?
        WHERE ? = 1 OR m.mbs_id IS NOT NULL OR s.Usuario_usr_id_Proprietario = ?
        ORDER BY s.srv_entrada DESC, s.srv_id', [$user, (int) $creator, $user])->fetchAll();
    return ['servers' => array_map(static fn ($row) => [
        'id' => (int) $row['id'], 'name' => $row['name'], 'hasIcon' => (bool) $row['hasIcon'],
        'owner' => (int) $row['owner'] === $user, 'lobby' => (bool) $row['lobby'],
    ], $rows)];
}

function serverRoles(PDO $db, int $server): array
{
    $rows = query($db, 'SELECT crg_id AS id, crg_nome AS name, crg_permissoes AS permissions, crg_cor AS color
        FROM Cargo WHERE Servidor_srv_id = ? ORDER BY crg_nome, crg_id', [$server])->fetchAll();
    $byId = array_column($rows, null, 'id');
    $order = orderedRoleIds(array_map('intval', array_keys($byId)), serverRoleOrder($server));
    return array_map(static fn ($id, $position) => [
        'id' => $id, 'name' => $byId[$id]['name'], 'permissions' => (int) $byId[$id]['permissions'], 'position' => $position, 'color' => $byId[$id]['color'],
    ], $order, array_keys($order));
}

function serverMembers(PDO $db, array $server, int $user, bool $creator, ?array $roles = null, ?array $titleColors = null): array
{
    $id = (int) $server['id'];
    $admin = $creator || (int) $server['owner'] === $user;
    if (!$admin && !membership($db, $id, $user)) invalid('Servidor indisponível.', 404);
    $members = [];
    $roster = query($db, 'SELECT m.mbs_id AS id, u.usr_nome_exibicao AS name, u.usr_id AS user,
        cp.cpl_id IS NOT NULL AS creator, ' . PROFILE_MEDIA_COLUMNS . ' FROM MembroServidor m JOIN Usuario u ON u.usr_id = m.Usuario_usr_id
        LEFT JOIN CriadorPlataforma cp ON cp.Usuario_usr_id = u.usr_id WHERE m.Servidor_srv_id = ?
        ORDER BY u.usr_nome_exibicao, m.mbs_id', [$id])->fetchAll();
    if ($creator && !in_array($user, array_map('intval', array_column($roster, 'user')), true)) {
        $roster[] = query($db, 'SELECT 0 AS id, usr_nome_exibicao AS name, usr_id AS user, 1 AS creator, '
            . PROFILE_MEDIA_COLUMNS . ' FROM Usuario WHERE usr_id = ?', [$user])->fetch();
    }
    $titleColors ??= reservedRoleColors($id);
    foreach ($roster as $row) {
        $title = $row['creator'] ? 'Criador' : ((int) $server['owner'] === (int) $row['user'] ? 'ADM' : null);
        $members[(int) $row['id']] = [
            'id' => (int) $row['id'], 'userId' => (int) $row['user'], 'name' => $row['name'], 'self' => (int) $row['user'] === $user,
            'title' => $title, 'titleColor' => $title === null ? null : ($titleColors[$title] ?? null),
            'roles' => [], 'appearance' => profileAppearance((int) $row['user']),
        ] + profileMediaUrls($row);
    }
    $byId = array_column($roles ?? serverRoles($db, $id), null, 'id');
    $assignments = query($db, 'SELECT mc.MembroServidor_mbs_id AS member, c.crg_id AS id
        FROM MembroCargo mc JOIN Cargo c ON c.crg_id = mc.Cargo_crg_id WHERE c.Servidor_srv_id = ?
        ORDER BY c.crg_nome, c.crg_id', [$id])->fetchAll();
    foreach ($assignments as $row) {
        if (isset($members[$row['member']], $byId[$row['id']])) {
            $members[$row['member']]['roles'][] = $byId[$row['id']];
        }
    }
    foreach ($members as &$member) {
        usort($member['roles'], static fn ($a, $b) => $a['position'] <=> $b['position']);
    }
    unset($member);
    return array_values($members);
}

function lobbyMembers(PDO $db, int $user): array
{
    $rows = query($db, 'SELECT u.usr_id AS id, u.usr_nome_exibicao AS name, cp.cpl_id IS NOT NULL AS creator, ' . PROFILE_MEDIA_COLUMNS . '
        FROM Usuario u LEFT JOIN CriadorPlataforma cp ON cp.Usuario_usr_id = u.usr_id
        ORDER BY u.usr_nome_exibicao, u.usr_id')->fetchAll();
    return array_map(static fn ($row) => [
        'id' => (int) $row['id'], 'userId' => (int) $row['id'], 'name' => $row['name'], 'self' => (int) $row['id'] === $user,
        'title' => $row['creator'] ? 'Criador' : null, 'roles' => [], 'appearance' => profileAppearance((int) $row['id']),
    ] + profileMediaUrls($row), $rows);
}

function serverDetail(PDO $db, array $server, int $user, bool $creator): array
{
    $id = (int) $server['id'];
    $admin = $creator || (int) $server['owner'] === $user;
    $permissions = $admin ? ALL_PERMISSIONS : serverPermissions($db, $id, $user);
    $hierarchy = serverRoles($db, $id);
    $titleColors = reservedRoleColors($id);
    $members = serverMembers($db, $server, $user, $creator, $hierarchy, $titleColors);
    $reservedRoles = array_map(static fn ($title) => ['title' => $title, 'color' => $titleColors[$title] ?? null],
        editableReservedRoles($server, $user, $creator));
    $channels = array_map(static fn ($row) => [
        'id' => (int) $row['id'], 'name' => $row['name'], 'type' => $row['type'], 'private' => (bool) $row['private'], 'topic' => $row['topic'],
        'userLimit' => $row['type'] === 'VOZ' ? channelVoiceLimit((int) $row['id']) : null,
    ], visibleChannels($db, $user, $id));
    $layout = channelLayout($id, channelLayoutRows($db, $id));
    $channelPositions = [];
    foreach ($layout['uncategorized'] as $position => $channel) $channelPositions[$channel] = [null, $position];
    foreach ($layout['categories'] as $category) {
        foreach ($category['channels'] as $position => $channel) $channelPositions[$channel] = [$category['id'], $position];
    }
    foreach ($channels as &$channel) {
        [$channel['categoryId'], $channel['position']] = $channelPositions[$channel['id']];
    }
    unset($channel);
    $roles = [];
    if ($permissions & MANAGE_CHANNELS) {
        $rules = query($db, 'SELECT cc.Canal_cnl_id AS channel, cc.Cargo_crg_id AS role
            FROM CanalCargo cc JOIN Canal c ON c.cnl_id = cc.Canal_cnl_id WHERE c.Servidor_srv_id = ?', [$id])->fetchAll();
        $byChannel = [];
        foreach ($rules as $rule) $byChannel[$rule['channel']][] = (int) $rule['role'];
        foreach ($channels as &$channel) $channel['roles'] = $byChannel[$channel['id']] ?? [];
        unset($channel);
    }
    if ($permissions & (MANAGE_CHANNELS | MANAGE_ROLES | CREATE_ROLES)) {
        $roles = $hierarchy;
    }
    return ['id' => $id, 'name' => $server['name'], 'hasIcon' => $server['image'] !== null, 'admin' => $admin,
        'lobby' => (bool) $server['lobby'], 'permissions' => $permissions,
        'members' => $members, 'channels' => $channels, 'categories' => array_map(static fn ($c) => ['id' => $c['id'], 'name' => $c['name']], $layout['categories']), 'roles' => $roles, 'reservedRoles' => $reservedRoles];
}

function localRoles(PDO $db, int $server, array $data, bool $basicOnly = false): array
{
    $ids = $data['roles'] ?? [];
    if (!is_array($ids)) invalid('Selecione cargos válidos.');
    $known = array_map('intval', query($db, 'SELECT crg_id FROM Cargo WHERE Servidor_srv_id = ?'
        . ($basicOnly ? ' AND crg_permissoes = 0' : ''), [$server])->fetchAll(PDO::FETCH_COLUMN));
    if (array_filter($ids, static fn ($id) => !is_int($id) || !in_array($id, $known, true))) {
        invalid('Escolha cargos que você pode gerenciar neste servidor.');
    }
    return array_unique($ids);
}

$image = $oldImage = null;
$deletedServer = $deletedChannel = null;
try {
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method !== 'GET' && $method !== 'POST') invalid('Método inválido.', 405);
    $db = database();
    $user = signedInUser($db);
    if ($method === 'GET' && isset($_GET['invite'])) {
        respond(serverInvitePreview($db, serverInviteToken($_GET['invite']), $user));
    }
    if ($method === 'GET' && isset($_GET['inviteIcon'])) {
        $invite = serverInviteRow($db, serverInviteToken($_GET['inviteIcon']));
        if (!serverInviteMembership($db, (int) $invite['server'], $user)) validateActiveServerInvite($invite);
        $image = $invite['image'];
        if (!is_string($image) || !preg_match('/\A[a-f0-9]{32}\.png\z/', $image)) invalid('Imagem indisponível.', 404);
        $file = iconDirectory() . '/' . $image;
        if (!is_file($file)) invalid('Imagem indisponível.', 404);
        header('Content-Type: image/png');
        readfile($file);
        exit;
    }
    if ($user === null) invalid('Entre novamente para acessar os servidores.', 401);
    $creator = isCreator($db, $user);

    if ($method === 'GET') {
        if (isset($_GET['invites'])) {
            $id = inputId($_GET, 'invites');
            if (!serverAdministrator($db, $id, $user)) invalid('Você não pode gerenciar convites neste servidor.', 403);
            serverRow($db, $id);
            respond(['invites' => listServerInvites($db, $id)]);
        }
        if (isset($_GET['entrance'])) {
            $id = query($db, 'SELECT srv_id FROM Servidor WHERE srv_entrada = 1')->fetchColumn();
            if ($id === false) invalid('Servidor de entrada indisponível.', 503);
            if (!membership($db, (int) $id, $user)) joinEntrance($db, $user);
            respond(serverDetail($db, serverRow($db, (int) $id), $user, $creator));
        }
        if (isset($_GET['members'])) {
            $members = $_GET['members'] === 'lobby'
                ? lobbyMembers($db, $user)
                : serverMembers($db, serverRow($db, inputId($_GET, 'members')), $user, $creator);
            respond(['members' => $members]);
        }
        if (isset($_GET['icon'])) {
            $row = serverRow($db, inputId($_GET, 'icon'));
            if ((!$creator && (int) $row['owner'] !== $user && !membership($db, (int) $row['id'], $user))
                || !$row['image'] || !preg_match('/\A[a-f0-9]{32}\.png\z/', $row['image'])) invalid('Imagem indisponível.', 404);
            $file = iconDirectory() . '/' . $row['image'];
            if (!is_file($file)) invalid('Imagem indisponível.', 404);
            header('Content-Type: image/png');
            readfile($file);
            exit;
        }
        if (!isset($_GET['server'])) respond(serverList($db, $user, $creator));
        respond(serverDetail($db, serverRow($db, inputId($_GET, 'server')), $user, $creator));
    }

    if (($_SERVER['HTTP_X_DISCORDO_REQUEST'] ?? '') !== 'servers'
        || strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
        invalid('Solicitação inválida.', 403);
    }
    $body = file_get_contents('php://input', false, null, 0, 131073);
    if ($body === false || strlen($body) > 131072) invalid('Solicitação muito grande.', 413);
    $data = json_decode($body, true);
    if (!is_array($data)) invalid('Solicitação inválida.', 400);
    $action = $data['action'] ?? '';
    $db->beginTransaction();
    if ($action === 'create') {
        $name = inputName($data);
        $image = storeIcon($data['image'] ?? null);
        try {
            query($db, 'INSERT INTO Servidor (Usuario_usr_id_Proprietario, srv_nome, srv_imagem_caminho) VALUES (?, ?, ?)', [$user, $name, $image]);
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) !== 1062) throw $error;
            invalid('Cada conta pode criar apenas um servidor.', 409);
        }
        $id = (int) $db->lastInsertId();
        query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (?, ?)', [$id, $user]);
        query($db, "INSERT INTO Canal (Servidor_srv_id, cnl_nome, cnl_tipo) VALUES (?, 'geral', 'TEXTO'), (?, 'Resenha', 'VOZ')", [$id, $id]);
    } elseif ($action === 'join') {
        $id = acceptServerInvite($db, serverInviteToken($data['code'] ?? null), $user);
    } else {
        $id = inputId($data, 'server');
        $server = serverRow($db, $id, true);
        $admin = $creator || (int) $server['owner'] === $user;
        $permissions = $admin ? ALL_PERMISSIONS : serverPermissions($db, $id, $user);
        switch ($action) {
            case 'shareInvite':
                $inviteToken = shareServerInvite($db, $id, $user, $admin);
                break;
            case 'createInvite':
            case 'revokeInvite':
                if (!$admin) invalid('Você não pode gerenciar convites neste servidor.', 403);
                if ($action === 'createInvite') {
                    $inviteToken = createServerInvite($db, $id, $user, $data['hours'] ?? 168, $data['maxUses'] ?? null);
                } else {
                    revokeServerInvite($db, $id, serverInviteToken($data['token'] ?? null));
                }
                break;
            case 'deleteServer':
                if (!$admin) invalid('Você não pode excluir este servidor.', 403);
                if ($server['lobby']) invalid('O servidor de entrada é protegido.', 403);
                if (($data['name'] ?? null) !== $server['name']) {
                    invalid('O nome do servidor mudou. Abra o servidor novamente para confirmar.', 409);
                }
                $deletedServer = deleteServerRecords($db, $id, $server['image']);
                break;
            case 'server':
                if (!$admin) invalid('Somente a administração pode editar o servidor.', 403);
                $name = inputName($data);
                if (array_key_exists('image', $data)) {
                    $image = storeIcon($data['image']);
                    $oldImage = $server['image'];
                    query($db, 'UPDATE Servidor SET srv_nome = ?, srv_imagem_caminho = ? WHERE srv_id = ?', [$name, $image, $id]);
                } else query($db, 'UPDATE Servidor SET srv_nome = ? WHERE srv_id = ?', [$name, $id]);
                break;
            case 'deleteChannel':
                if (!($permissions & MANAGE_CHANNELS)) invalid('Você não pode gerenciar canais.', 403);
                $channel = inputId($data, 'channel');
                $existing = query($db, 'SELECT cnl_tipo AS type, cnl_nome AS name
                    FROM Canal WHERE cnl_id = ? AND Servidor_srv_id = ? FOR UPDATE', [$channel, $id])->fetch();
                if (!$existing || (!$admin && visibleChannels($db, $user, $id, '', $channel) === [])) {
                    invalid('Canal indisponível.', 404);
                }
                if (($data['name'] ?? null) !== $existing['name']) {
                    invalid('O nome do canal mudou. Abra o canal novamente para confirmar.', 409);
                }
                $media = $existing['type'] === 'TEXTO' ? deleteChannelMessages($db, $channel) : [];
                query($db, 'DELETE FROM CanalCargo WHERE Canal_cnl_id = ?', [$channel]);
                query($db, 'DELETE FROM Canal WHERE cnl_id = ? AND Servidor_srv_id = ?', [$channel, $id]);
                $deletedChannel = ['media' => $media, 'voice' => $existing['type'] === 'VOZ' ? [$channel] : []];
                break;
            case 'category':
            case 'deleteCategory':
            case 'moveCategory':
            case 'moveChannel':
                requireChannelManagement($permissions);
                $layout = channelLayout($id, channelLayoutRows($db, $id));
                $visible = array_map('intval', array_column(visibleChannels($db, $user, $id), 'id'));
                $nextLayout = changeChannelLayout($layout, $action, $data, $visible);
                $previousLayout = [$id, $layout];
                saveChannelLayout($id, $nextLayout);
                break;
            case 'channel':
                if (!($permissions & MANAGE_CHANNELS)) invalid('Você não pode gerenciar canais.', 403);
                $name = inputName($data);
                $private = ($data['private'] ?? false) === true;
                $roles = $private ? localRoles($db, $id, $data) : [];
                if (isset($data['channel'])) {
                    $channel = inputId($data, 'channel');
                    $type = query($db, 'SELECT cnl_tipo FROM Canal WHERE cnl_id = ? AND Servidor_srv_id = ?', [$channel, $id])->fetchColumn();
                    if ($type === false) {
                        invalid('Canal indisponível.', 404);
                    }
                    if (!$admin && visibleChannels($db, $user, $id, '', $channel) === []) invalid('Canal indisponível.', 404);
                    query($db, 'UPDATE Canal SET cnl_nome = ?, cnl_privado = ? WHERE cnl_id = ?', [$name, (int) $private, $channel]);
                } else {
                    $type = $data['type'] ?? '';
                    if (!in_array($type, ['TEXTO', 'VOZ'], true)) invalid('Escolha texto ou voz.');
                    query($db, 'INSERT INTO Canal (Servidor_srv_id, cnl_nome, cnl_tipo, cnl_privado) VALUES (?, ?, ?, ?)',
                        [$id, $name, $type, (int) $private]);
                    $channel = (int) $db->lastInsertId();
                }
                query($db, 'DELETE FROM CanalCargo WHERE Canal_cnl_id = ?', [$channel]);
                foreach ($roles as $role) query($db, 'INSERT INTO CanalCargo (Canal_cnl_id, Cargo_crg_id) VALUES (?, ?)', [$channel, $role]);
                if ($type === 'VOZ' && array_key_exists('userLimit', $data)) {
                    $limit = validateVoiceLimit($data['userLimit']);
                    $previousLimit = channelVoiceLimit($channel);
                    if ($limit !== $previousLimit) {
                        saveChannelVoiceLimit($channel, $limit);
                        $changedVoiceLimit = [$channel, $previousLimit];
                    }
                }
                if (array_key_exists('category', $data)) {
                    $layout = channelLayout($id, channelLayoutRows($db, $id));
                    channelCategoryIndex($layout, $data['category']);
                    $currentCategory = null;
                    foreach ($layout['categories'] as $category) if (in_array($channel, $category['channels'], true)) $currentCategory = $category['id'];
                    if ($currentCategory !== $data['category']) {
                        $nextLayout = changeChannelLayout($layout, 'moveChannel', [
                            'channel' => $channel, 'category' => $data['category'],
                        ], [$channel]);
                        $previousLayout = [$id, $layout];
                        saveChannelLayout($id, $nextLayout);
                    }
                }
                break;
            case 'reservedRoleColor':
                $title = $data['title'] ?? null;
                if (!in_array($title, ['Criador', 'ADM'], true)) invalid('Cargo reservado inválido.');
                if (!in_array($title, editableReservedRoles($server, $user, $creator), true)) {
                    invalid('Você não pode alterar a cor deste cargo.', 403);
                }
                saveReservedRoleColor($id, $title, roleColor($data['color'] ?? null));
                break;
            case 'role':
            case 'deleteRole':
                $creating = $action === 'role' && !array_key_exists('role', $data);
                $required = $creating ? (CREATE_ROLES | MANAGE_ROLES) : MANAGE_ROLES;
                if (!($permissions & $required)) invalid($creating ? 'Você não pode criar cargos.' : 'Você não pode gerenciar cargos.', 403);
                $rolePermissions = $data['permissions'] ?? 0;
                if (!is_int($rolePermissions) || $rolePermissions < 0 || $rolePermissions > ALL_PERMISSIONS) invalid('Permissões inválidas.');
                if (!$admin && $rolePermissions !== 0) invalid('Somente a administração pode conceder permissões.', 403);
                $color = $data['color'] ?? null;
                if ($action === 'role') {
                    $color = roleColor($color);
                    $name = inputName($data);
                    if (in_array(strtoupper($name), ['ADM', 'CRIADOR'], true)) invalid('Esse título é reservado.');
                }
                if ($creating) {
                    $order = array_column(serverRoles($db, $id), 'id');
                    query($db, 'INSERT INTO Cargo (Servidor_srv_id, crg_nome, crg_permissoes, crg_cor) VALUES (?, ?, ?, ?)', [$id, $name, $rolePermissions, $color]);
                    $order[] = (int) $db->lastInsertId();
                    saveServerRoleOrder($id, $order);
                    break;
                }
                $role = inputId($data, 'role');
                localRoles($db, $id, ['roles' => [$role]], !$admin);
                if ($action === 'role') {
                    if (array_key_exists('color', $data)) {
                        query($db, 'UPDATE Cargo SET crg_nome = ?, crg_permissoes = ?, crg_cor = ? WHERE crg_id = ?', [$name, $rolePermissions, $color, $role]);
                    } else {
                        query($db, 'UPDATE Cargo SET crg_nome = ?, crg_permissoes = ? WHERE crg_id = ?', [$name, $rolePermissions, $role]);
                    }
                } else {
                    query($db, 'DELETE FROM CanalCargo WHERE Cargo_crg_id = ?', [$role]);
                    query($db, 'DELETE FROM MembroCargo WHERE Cargo_crg_id = ?', [$role]);
                    query($db, 'DELETE FROM Cargo WHERE crg_id = ?', [$role]);
                }
                break;
            case 'roleOrder':
                if (!$admin) invalid('Somente a administração pode ordenar os cargos.', 403);
                $current = array_column(serverRoles($db, $id), 'id');
                if (($data['previous'] ?? null) !== $current) invalid('A ordem mudou. Reabra os cargos e tente novamente.', 409);
                $order = $data['order'] ?? null;
                if (!validRoleOrder($current, $order)) invalid('Envie a lista completa de cargos do servidor.');
                if ($order !== $current) saveServerRoleOrder($id, $order);
                break;
            case 'memberRoles':
                if (!($permissions & MANAGE_ROLES)) invalid('Você não pode gerenciar cargos.', 403);
                $member = inputId($data, 'member');
                if (!query($db, 'SELECT 1 FROM MembroServidor WHERE mbs_id = ? AND Servidor_srv_id = ?', [$member, $id])->fetchColumn()) {
                    invalid('Membro indisponível.', 404);
                }
                $roles = localRoles($db, $id, $data, !$admin);
                query($db, 'DELETE mc FROM MembroCargo mc JOIN Cargo c ON c.crg_id = mc.Cargo_crg_id
                    WHERE mc.MembroServidor_mbs_id = ?' . ($admin ? '' : ' AND c.crg_permissoes = 0'), [$member]);
                foreach ($roles as $role) query($db, 'INSERT INTO MembroCargo (MembroServidor_mbs_id, Cargo_crg_id) VALUES (?, ?)', [$member, $role]);
                break;
            default:
                invalid('Ação inválida.', 400);
        }
    }
    $db->commit();
    unset($changedVoiceLimit, $previousLayout);
    $image = null;
    removeIcon($oldImage);
    if ($deletedServer !== null) removeDeletedServerFiles($deletedServer);
    if ($deletedChannel !== null) removeDeletedChannelFiles($deletedChannel['media'], $deletedChannel['voice']);
    respond(isset($inviteToken) ? ['id' => $id, 'token' => $inviteToken] : ['id' => $id]);
} catch (Throwable $error) {
    if (isset($previousLayout)) {
        try { saveChannelLayout(...$previousLayout); } catch (Throwable $restoreError) { error_log('Discordo: falha ao restaurar categorias.'); }
    }
    if (isset($changedVoiceLimit)) {
        try {
            saveChannelVoiceLimit(...$changedVoiceLimit);
        } catch (Throwable $restoreError) {
            error_log('Discordo: falha ao restaurar o limite de voz.');
        }
    }
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    removeIcon($image);
    if ($error instanceof DomainException) respond(['error' => $error->getMessage()], $error->getCode());
    if ($error instanceof PDOException && (int) ($error->errorInfo[1] ?? 0) === 1062) {
        respond(['error' => 'Já existe um canal desse tipo ou um cargo com esse nome.'], 409);
    }
    if ($error instanceof PDOException && (int) ($error->errorInfo[1] ?? 0) === 1644) {
        respond(['error' => 'O nome ou o vínculo informado é inválido.'], 422);
    }
    error_log('Discordo servers: ' . get_class($error) . ' (' . $error->getCode() . ')');
    respond(['error' => 'Não foi possível acessar os servidores agora.'], 503);
}
