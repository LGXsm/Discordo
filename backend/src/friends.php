<?php
declare(strict_types=1);

require_once __DIR__ . '/server-access.php';
require_once __DIR__ . '/server-invites.php';
require_once __DIR__ . '/profile-media.php';
require_once __DIR__ . '/voice-room-state.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');

function friendsResponse(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function friendNumber(mixed $value, int $minimum = 1): int
{
    $number = is_int($value) || is_string($value)
        ? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => $minimum, 'max_range' => 4294967295]]) : false;
    if ($number === false) throw new DomainException('Identificador inválido.', 400);
    return $number;
}

function friendship(PDO $db, int $user, int $other, bool $lock = false): array|false
{
    return query($db, 'SELECT ami_id, ami_solicitante, ami_aceita_em FROM Amizade
        WHERE ami_usuario_menor = ? AND ami_usuario_maior = ?' . ($lock ? ' FOR UPDATE' : ''),
        [min($user, $other), max($user, $other)])->fetch();
}

function friendshipStatus(array|false $row, int $user): ?string
{
    return !$row ? null : ($row['ami_aceita_em'] !== null ? 'friend'
        : ((int) $row['ami_solicitante'] === $user ? 'sent' : 'received'));
}

function friendView(array $row, int $user): array
{
    if ($row['accepted'] === null) unset($row['bannerPath']);
    $person = ['id' => (int) $row['id'], 'name' => $row['name']] + profileMediaUrls($row);
    if ($row['requester'] === null) return $person + ['status' => null];
    if ($row['accepted'] === null) return $person + ['status' => (int) $row['requester'] === $user ? 'sent' : 'received'];
    $room = 'friend-' . (int) $row['friendship'];
    $waiting = in_array($person['id'], array_column(roomPresence(voiceStateDirectory(), $room), 'userId'), true);
    return $person + ['status' => 'friend', 'room' => $room, 'waiting' => $waiting,
        'availableUntil' => friendAvailability($person['id'])];
}

function friendAvailability(int $user): ?int
{
    $until = (int) @file_get_contents(voiceStateDirectory() . "/available-$user");
    return $until > time() ? $until : null;
}

function nextFriendGameplay(PDO $db, int $user): ?array
{
    $games = query($db, "SELECT g.gpl_jogo AS game, g.gpl_inicio_em AS starts, m.Canal_cnl_id AS channel
        FROM Gameplay g JOIN Mensagem m ON m.msg_id = g.Mensagem_msg_id
        JOIN MembroServidor author ON author.mbs_id = m.MembroServidor_mbs_id
        WHERE g.gpl_inicio_em > UTC_TIMESTAMP() AND (author.Usuario_usr_id = ? OR EXISTS (
            SELECT 1 FROM GameplayParticipante p JOIN MembroServidor member ON member.mbs_id = p.MembroServidor_mbs_id
            WHERE p.Gameplay_gpl_id = g.gpl_id AND member.Usuario_usr_id = ? AND p.gpp_situacao = 'CONFIRMADO'
        )) ORDER BY g.gpl_inicio_em, g.gpl_id", [$user, $user])->fetchAll();
    foreach ($games as $game) {
        if (visibleChannels($db, $user, null, 'TEXTO', (int) $game['channel'])) {
            return ['game' => $game['game'], 'time' => str_replace(' ', 'T', $game['starts']) . 'Z'];
        }
    }
    return null;
}

try {
    $method = $_SERVER['REQUEST_METHOD'];
    if (!in_array($method, ['GET', 'POST'], true)) throw new DomainException('Método inválido.', 405);
    $db = database();
    $user = signedInUser($db);
    if ($user === null) throw new DomainException('Entre novamente para acessar suas amizades.', 401);

    if ($method === 'GET' && isset($_GET['relationship'])) {
        $other = friendNumber($_GET['relationship']);
        friendsResponse(['status' => friendshipStatus(friendship($db, $user, $other), $user)]);
    }

    if ($method === 'GET' && isset($_GET['inviteServers'])) {
        $other = friendNumber($_GET['inviteServers']);
        if ($other === $user) throw new DomainException('Escolha outra pessoa.', 422);
        friendsResponse(['servers' => profileInviteServers($db, $user, $other)]);
    }

    if ($method === 'GET' && isset($_GET['with'])) {
        $other = friendNumber($_GET['with']);
        $after = friendNumber($_GET['after'] ?? 0, 0);
        $before = friendNumber($_GET['before'] ?? 0, 0);
        if ($before && $after) throw new DomainException('Cursores inválidos.', 400);
        // Check membership and read messages in the same statement.
        $rows = query($db, 'SELECT m.mdt_id AS id, m.mdt_texto AS text, m.mdt_enviada_em AS sent, m.mdt_autor AS author
            FROM Amizade a LEFT JOIN MensagemDireta m ON m.Amizade_ami_id = a.ami_id AND m.mdt_id > ?
            AND (? = 0 OR m.mdt_id < ?) WHERE a.ami_usuario_menor = ? AND a.ami_usuario_maior = ?
            AND a.ami_aceita_em IS NOT NULL ORDER BY m.mdt_id ' . ($after ? 'ASC' : 'DESC') . ' LIMIT 51',
            [$after, $before, $before, min($user, $other), max($user, $other)])->fetchAll();
        if (!$rows) throw new DomainException('Esta conversa está indisponível.', 403);
        if ($rows[0]['id'] === null) $rows = [];
        $more = count($rows) > 50;
        if ($more) array_pop($rows);
        if (!$after) $rows = array_reverse($rows);
        friendsResponse(['more' => $more, 'messages' => array_map(static fn ($row) => [
            'id' => (int) $row['id'], 'text' => $row['text'], 'own' => (int) $row['author'] === $user,
            'time' => str_replace(' ', 'T', $row['sent']) . 'Z',
        ], $rows)]);
    }

    if ($method === 'GET') {
        if (isset($_GET['search'])) {
            $term = is_string($_GET['search']) ? trim($_GET['search']) : '';
            if (!preg_match('/\A.{2,40}\z/u', $term)) throw new DomainException('Digite de 2 a 40 caracteres para buscar.', 422);
            $prefix = strtr($term, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
            $rows = query($db, 'SELECT u.usr_id AS id, u.usr_nome_exibicao AS name, u.usr_avatar_caminho AS avatarPath, u.usr_banner_caminho AS bannerPath,
                a.ami_id AS friendship, a.ami_solicitante AS requester, a.ami_aceita_em AS accepted FROM Usuario u
                LEFT JOIN Amizade a ON a.ami_usuario_menor = LEAST(?, u.usr_id) AND a.ami_usuario_maior = GREATEST(?, u.usr_id)
                WHERE u.usr_id <> ? AND u.usr_nome_exibicao LIKE ? ESCAPE \'!\'
                ORDER BY u.usr_nome_exibicao, u.usr_id LIMIT 20', [$user, $user, $user, $prefix])->fetchAll();
        } else {
            $rows = query($db, 'SELECT u.usr_id AS id, u.usr_nome_exibicao AS name, u.usr_avatar_caminho AS avatarPath, u.usr_banner_caminho AS bannerPath,
                a.ami_id AS friendship, a.ami_solicitante AS requester, a.ami_aceita_em AS accepted FROM Amizade a
                JOIN Usuario u ON u.usr_id = IF(a.ami_usuario_menor = ?, a.ami_usuario_maior, a.ami_usuario_menor)
                WHERE a.ami_usuario_menor = ? OR a.ami_usuario_maior = ? ORDER BY u.usr_nome_exibicao, u.usr_id',
                [$user, $user, $user])->fetchAll();
        }
        $metadata = isset($_GET['overview']) ? ['availableUntil' => friendAvailability($user),
            'nextGame' => nextFriendGameplay($db, $user)] : [];
        friendsResponse(['people' => array_map(static fn ($row) => friendView($row, $user), $rows)] + $metadata);
    }

    if (($_SERVER['HTTP_X_DISCORDO_REQUEST'] ?? '') !== 'friends'
        || strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
        throw new DomainException('Solicitação inválida.', 403);
    }
    $body = file_get_contents('php://input', false, null, 0, 16385);
    $data = $body !== false && strlen($body) <= 16384 ? json_decode($body, true, 16) : null;
    if (!is_array($data)) throw new DomainException('Solicitação inválida.', 400);
    if (($data['action'] ?? '') === 'availability') {
        if (!is_bool($data['available'] ?? null)) throw new DomainException('Disponibilidade inválida.', 422);
        $directory = voiceStateDirectory();
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Storage unavailable');
        }
        $path = $directory . "/available-$user";
        if (file_put_contents($path, $data['available'] ? (string) (time() + 3600) : '0', LOCK_EX) === false) {
            throw new RuntimeException('Storage unavailable');
        }
        friendsResponse(['saved' => true]);
    }
    $other = friendNumber($data['user'] ?? null);
    if ($other === $user) throw new DomainException('Escolha outra pessoa.', 422);
    $action = $data['action'] ?? '';
    if ($action === 'request') {
        query($db, 'INSERT INTO Amizade (ami_usuario_menor, ami_usuario_maior, ami_solicitante)
            SELECT ?, ?, ? FROM Usuario WHERE usr_id = ?
            ON DUPLICATE KEY UPDATE ami_id = ami_id', [min($user, $other), max($user, $other), $user, $other]);
        $status = friendshipStatus(friendship($db, $user, $other), $user);
        if ($status === null) throw new DomainException('Usuário indisponível.', 404);
        friendsResponse(['saved' => true, 'status' => $status]);
    }

    $db->beginTransaction();
    $row = friendship($db, $user, $other, true);
    if ($action === 'invite') {
        $server = friendNumber($data['server'] ?? null);
        $token = shareProfileInvite($db, $server, $user, $other);
        $sent = $row && $row['ami_aceita_em'] !== null;
        if ($sent) {
            query($db, 'INSERT INTO MensagemDireta (Amizade_ami_id, mdt_autor, mdt_texto, mdt_enviada_em)
                VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [(int) $row['ami_id'], $user, '?convite=' . $token]);
        }
        $db->commit();
        friendsResponse(['sent' => $sent, 'token' => $token]);
    }
    if (!$row) throw new DomainException('Pedido ou conversa indisponível.', 403);
    $id = (int) $row['ami_id'];
    $ownRequest = (int) $row['ami_solicitante'] === $user;
    $accepted = $row['ami_aceita_em'] !== null;
    if ($action === 'send' && $accepted) {
        $message = is_string($data['text'] ?? null) ? trim($data['text']) : '';
        if (!preg_match('/\A.{1,2000}\z/us', $message)) throw new DomainException('Digite uma mensagem de até 2.000 caracteres.', 422);
        query($db, 'INSERT INTO MensagemDireta (Amizade_ami_id, mdt_autor, mdt_texto, mdt_enviada_em)
            VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [$id, $user, $message]);
    } elseif ($action === 'accept' && !$accepted && !$ownRequest) {
        query($db, 'UPDATE Amizade SET ami_aceita_em = UTC_TIMESTAMP(3) WHERE ami_id = ?', [$id]);
    } elseif (($action === 'decline' && !$accepted && !$ownRequest)
        || ($action === 'cancel' && !$accepted && $ownRequest) || ($action === 'remove' && $accepted)) {
        query($db, 'DELETE FROM Amizade WHERE ami_id = ?', [$id]);
    } else {
        throw new DomainException('Esta ação não está disponível para a amizade.', 403);
    }
    $db->commit();
    friendsResponse(['saved' => true]);
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    if ($error instanceof DomainException) friendsResponse(['error' => $error->getMessage()], $error->getCode());
    error_log('Discordo friends: ' . get_class($error) . ' (' . $error->getCode() . ')');
    friendsResponse(['error' => 'Não foi possível acessar as amizades agora.'], 503);
}
