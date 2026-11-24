<?php
declare(strict_types=1);

require_once __DIR__ . '/server-access.php';
require_once __DIR__ . '/chat-media.php';
require_once __DIR__ . '/gameplay.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');

function chatResponse(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function supportsChatMessageActions(PDO $db): bool
{
    try {
        $db->query('SELECT msg_resposta_id, msg_encaminhada FROM Mensagem LIMIT 0');
        return true;
    } catch (PDOException $error) {
        if ((string) $error->getCode() !== '42S22') throw $error;
        return false;
    }
}

function supportsChatEditsAndReactions(PDO $db): bool
{
    try {
        $db->query('SELECT msg_editada_em, mre_emoji FROM Mensagem CROSS JOIN MensagemReacao LIMIT 0');
        return true;
    } catch (PDOException $error) {
        if (!in_array((string) $error->getCode(), ['42S02', '42S22'], true)) throw $error;
        return false;
    }
}

function chatMessageChanges(PDO $db, int $channel, int $user, int $first, int $last): array
{
    $edits = query($db, 'SELECT msg_id AS id, msg_texto AS text, msg_editada_em AS editedAt
        FROM Mensagem WHERE Canal_cnl_id = ? AND msg_id BETWEEN ? AND ? AND msg_editada_em IS NOT NULL',
        [$channel, $first, $last])->fetchAll();
    $reactions = [];
    foreach (query($db, 'SELECT r.Mensagem_msg_id AS message, r.mre_emoji AS emoji,
        COUNT(*) AS total, MAX(member.Usuario_usr_id = ?) AS own
        FROM Mensagem msg JOIN MensagemReacao r ON r.Mensagem_msg_id = msg.msg_id
        JOIN MembroServidor member ON member.mbs_id = r.MembroServidor_mbs_id
        WHERE msg.Canal_cnl_id = ? AND msg.msg_id BETWEEN ? AND ?
        GROUP BY r.Mensagem_msg_id, r.mre_emoji ORDER BY r.mre_emoji',
        [$user, $channel, $first, $last])->fetchAll() as $row) {
        $reactions[$row['message']][] = ['emoji' => $row['emoji'], 'count' => (int) $row['total'], 'own' => (bool) $row['own']];
    }
    return ['edits' => $edits, 'reactions' => (object) $reactions];
}

const CHAT_REACTION_EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '😎', '🤔', '😭', '😮', '🙃', '😅', '😴',
    '❤️', '💜', '👍', '👎', '👏', '🙌', '🙏', '🤝', '🔥', '🎉', '✨', '💯', '🎮', '🎧', '🏆',
    '⚡', '👀', '💀', '✅', '🚀'];

$savedMedia = null;
try {
    $method = $_SERVER['REQUEST_METHOD'];
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) throw new DomainException('Método inválido.', 405);
    $db = database();
    $user = signedInUser($db);
    if ($user === null) throw new DomainException('Entre novamente para acessar o canal.', 401);
    $channel = filter_var($_GET['channel'] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$channel) throw new DomainException('Canal inválido.', 400);
    $allowed = visibleChannels($db, $user, null, 'TEXTO', $channel);
    if (!$allowed) throw new DomainException('Você não tem acesso a este canal.', 403);
    $server = (int) $allowed[0]['server'];
    if ($method !== 'POST') {
        if (isset($_GET['media']) || isset($_GET['video'])) {
            $message = filter_var($_GET['media'] ?? $_GET['video'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $name = $message ? query($db, 'SELECT msg_video_caminho FROM Mensagem WHERE msg_id = ? AND Canal_cnl_id = ?',
                [$message, $channel])->fetchColumn() : false;
            if (!is_string($name) || !($file = chatMediaPath($name))) throw new DomainException('Anexo indisponível.', 404);
            sendChatMedia($file, $method);
        }
        $after = filter_var($_GET['after'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($after === false) throw new DomainException('Cursor inválido.', 400);
        $messageActions = supportsChatMessageActions($db);
        $replyFields = $messageActions
            ? 'msg.msg_resposta_id AS replyId, reply.msg_texto AS replyText, ru.usr_nome_exibicao AS replyAuthor, msg.msg_encaminhada AS forwarded'
            : 'NULL AS replyId, NULL AS replyText, NULL AS replyAuthor, 0 AS forwarded';
        $replyJoin = $messageActions ? '
            LEFT JOIN Mensagem reply ON reply.msg_id = msg.msg_resposta_id AND reply.Canal_cnl_id = msg.Canal_cnl_id
            LEFT JOIN MembroServidor rm ON rm.mbs_id = reply.MembroServidor_mbs_id
            LEFT JOIN Usuario ru ON ru.usr_id = rm.Usuario_usr_id' : '';
        $rows = query($db, 'SELECT msg.msg_id AS id, msg.msg_texto AS text, msg.msg_enviada_em AS sent,
            msg.msg_video_caminho AS mediaName, u.usr_nome_exibicao AS author, u.usr_id AS userId,
            ' . $replyFields . '
            FROM Mensagem msg JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
            JOIN Usuario u ON u.usr_id = m.Usuario_usr_id' . $replyJoin . '
            WHERE msg.Canal_cnl_id = ? AND msg.msg_id > ?
            ORDER BY msg.msg_id ' . ($after ? 'ASC' : 'DESC') . ' LIMIT 100', [$channel, $after])->fetchAll();
        if (!$after) $rows = array_reverse($rows);
        $firstPoll = filter_var($_GET['pollsFrom'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($firstPoll === false) throw new DomainException('Cursor inválido.', 400);
        $firstMessage = (int) ($rows[0]['id'] ?? 0);
        $first = $firstPoll && $firstMessage ? min($firstPoll, $firstMessage) : max($firstPoll, $firstMessage);
        $last = (int) ($rows[array_key_last($rows)]['id'] ?? $after);
        $existing = $firstPoll && $after >= $firstPoll ? array_map('intval', query($db,
            'SELECT msg_id FROM Mensagem WHERE Canal_cnl_id = ? AND msg_id BETWEEN ? AND ? ORDER BY msg_id DESC LIMIT 150',
            [$channel, $firstPoll, $after])->fetchAll(PDO::FETCH_COLUMN)) : null;
        $changesEnabled = supportsChatEditsAndReactions($db);
        $changes = $changesEnabled && $first && $last >= $first ? chatMessageChanges($db, $channel, $user, $first, $last) : [];
        chatResponse(['messageActions' => $messageActions, 'changesEnabled' => $changesEnabled, 'existing' => $existing, 'polls' => $first && $last >= $first ? gameplayPolls($db, $channel, $user, $first, $last) : [], 'messages' => array_map(static fn ($row) => [
            'id' => (int) $row['id'], 'text' => $row['text'], 'time' => str_replace(' ', 'T', $row['sent']) . 'Z',
            'media' => chatMediaKind($row['mediaName']), 'video' => chatMediaKind($row['mediaName']) === 'video',
            'author' => $row['author'], 'userId' => (int) $row['userId'], 'own' => (int) $row['userId'] === $user,
            'reply' => $row['replyId'] === null ? null : [
                'id' => (int) $row['replyId'], 'author' => $row['replyAuthor'], 'text' => $row['replyText'],
            ],
            'forwarded' => (bool) $row['forwarded'],
        ], $rows)] + $changes);
    }
    if (($_SERVER['HTTP_X_DISCORDO_REQUEST'] ?? '') !== 'chat') throw new DomainException('Solicitação inválida.', 403);
    $upload = null;
    $data = [];
    $forward = false;
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) === 'application/json') {
        $body = file_get_contents('php://input', false, null, 0, 32769);
        $data = $body !== false && strlen($body) <= 32768 ? json_decode($body, true, 16) : null;
        if (!is_array($data)) throw new DomainException('Solicitação inválida.', 400);
        $action = $data['action'] ?? null;
        if ($action === 'editMessage' || $action === 'setReaction') {
            $id = $data['id'] ?? null;
            if (!is_int($id) || $id < 1) throw new DomainException('Mensagem inválida.', 400);
            if (!supportsChatEditsAndReactions($db)) throw new DomainException('Edição e reações estão indisponíveis.', 503);
            $db->beginTransaction();
            query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server]);
            if (!visibleChannels($db, $user, $server, 'TEXTO', $channel)) throw new DomainException('Você não tem acesso a este canal.', 403);
            $target = query($db, 'SELECT m.Usuario_usr_id AS author, g.gpl_id AS poll
                FROM Mensagem msg JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
                LEFT JOIN Gameplay g ON g.Mensagem_msg_id = msg.msg_id
                WHERE msg.msg_id = ? AND msg.Canal_cnl_id = ? AND m.Servidor_srv_id = ? FOR UPDATE',
                [$id, $channel, $server])->fetch();
            if (!$target) throw new DomainException('Mensagem indisponível.', 404);
            if ($action === 'editMessage') {
                if ((int) $target['author'] !== $user || $target['poll'] !== null) {
                    throw new DomainException('Você não pode editar esta mensagem.', 403);
                }
                $text = $data['text'] ?? null;
                if (!is_string($text) || !preg_match('/\A.{1,1000}\z/us', $text = trim($text))) {
                    throw new DomainException('Digite uma mensagem de até 1000 caracteres.', 422);
                }
                query($db, 'UPDATE Mensagem SET msg_texto = ?, msg_editada_em = UTC_TIMESTAMP(3)
                    WHERE msg_id = ? AND Canal_cnl_id = ? AND BINARY msg_texto <> BINARY ?',
                    [$text, $id, $channel, $text]);
            } else {
                $emoji = $data['emoji'] ?? null;
                $active = $data['active'] ?? null;
                if (!in_array($emoji, CHAT_REACTION_EMOJIS, true) || !is_bool($active)) {
                    throw new DomainException('Reação inválida.', 422);
                }
                $member = query($db, 'SELECT mbs_id FROM MembroServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?',
                    [$server, $user])->fetchColumn();
                if (!$member) throw new DomainException('Você precisa fazer parte deste servidor.', 403);
                if ($active) {
                    query($db, 'INSERT INTO MensagemReacao (Mensagem_msg_id, MembroServidor_mbs_id, mre_emoji)
                        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mre_emoji = VALUES(mre_emoji)', [$id, $member, $emoji]);
                } else {
                    query($db, 'DELETE FROM MensagemReacao WHERE Mensagem_msg_id = ? AND MembroServidor_mbs_id = ? AND mre_emoji = ?',
                        [$id, $member, $emoji]);
                }
            }
            $db->commit();
            chatResponse(['ok' => true]);
        }
        if ($action === 'deleteMessage') {
            $id = $data['id'] ?? null;
            if (!is_int($id) || $id < 1) throw new DomainException('Mensagem inválida.', 400);
            $db->beginTransaction();
            query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server]);
            if (!visibleChannels($db, $user, $server, 'TEXTO', $channel)) throw new DomainException('Você não tem acesso a este canal.', 403);
            $author = query($db, 'SELECT m.Usuario_usr_id FROM Mensagem msg
                JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
                WHERE msg.msg_id = ? AND msg.Canal_cnl_id = ? AND m.Servidor_srv_id = ? FOR UPDATE', [$id, $channel, $server])->fetchColumn();
            if ($author === false) throw new DomainException('Mensagem indisponível.', 404);
            if ((int) $author !== $user && !serverAdministrator($db, $server, $user)
                && !(serverPermissions($db, $server, $user) & DELETE_MESSAGES)) {
                throw new DomainException('Você não pode excluir esta mensagem.', 403);
            }
            $deletedMedia = deleteChannelMessages($db, $channel, message: $id);
            $db->commit();
            removeDeletedChannelFiles($deletedMedia, []);
            chatResponse(['ok' => true]);
        }
        $forward = $action === 'forwardMessage';
        if ($action !== 'sendMessage' && !$forward) {
            chatResponse(gameplayChanges($db, $user, $server, $channel, $data), 200);
        }
        $text = $forward ? '' : ($data['text'] ?? null);
    } else {
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > CHAT_VIDEO_LIMIT + 65536) throw new DomainException('O anexo deve ter até 20 MB.', 413);
        if (array_key_exists('message', $_POST)) {
            $metadata = $_POST['message'];
            $data = is_string($metadata) && strlen($metadata) <= 32768 ? json_decode($metadata, true, 16) : null;
            if (!is_array($data)) throw new DomainException('Solicitação inválida.', 400);
            $text = $data['text'] ?? null;
        } else {
            $text = $_POST['text'] ?? '';
        }
        $upload = $_FILES['media'] ?? $_FILES['video'] ?? null;
    }
    if (!is_string($text) || !preg_match('/\A.{0,1000}\z/us', $text = trim($text))) {
        throw new DomainException('Digite uma mensagem de até 1000 caracteres.', 422);
    }
    if ($upload !== null) $savedMedia = saveChatMedia($upload);
    if (!$forward && $text === '' && !$savedMedia) throw new DomainException('Escreva uma mensagem ou escolha um anexo.', 422);
    $db->beginTransaction();
    query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server]);
    if (!visibleChannels($db, $user, $server, 'TEXTO', $channel)) throw new DomainException('Você não tem acesso a este canal.', 403);
    $member = query($db, 'SELECT mbs_id FROM MembroServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?', [$server, $user])->fetchColumn();
    if (!$member && isCreator($db, $user)) {
        query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (?, ?)', [$server, $user]);
        $member = $db->lastInsertId();
    }
    if (!$member) throw new DomainException('Você precisa fazer parte deste servidor.', 403);
    $reply = $data['replyTo'] ?? null;
    if (($forward || $reply !== null) && !supportsChatMessageActions($db)) {
        throw new DomainException('Respostas e encaminhamentos estão indisponíveis neste momento.', 503);
    }
    if ($reply !== null) {
        if ($forward || !is_int($reply) || $reply < 1) throw new DomainException('Resposta inválida.', 400);
        if (!query($db, 'SELECT msg_id FROM Mensagem WHERE msg_id = ? AND Canal_cnl_id = ? FOR UPDATE',
            [$reply, $channel])->fetchColumn()) throw new DomainException('A mensagem original não está disponível neste canal.', 404);
    }
    if ($forward) {
        $origin = $data['sourceChannel'] ?? null;
        $id = $data['id'] ?? null;
        if (!is_int($origin) || $origin < 1 || !is_int($id) || $id < 1) {
            throw new DomainException('Encaminhamento inválido.', 400);
        }
        $source = visibleChannels($db, $user, $server, 'TEXTO', $origin)[0] ?? null;
        if (!$source || ($source['private'] && $origin !== $channel)) {
            throw new DomainException('Este canal não permite encaminhamento para o destino selecionado.', 403);
        }
        $original = query($db, 'SELECT m.msg_texto AS text, m.msg_video_caminho AS media, g.gpl_jogo AS game
            FROM Mensagem m LEFT JOIN Gameplay g ON g.Mensagem_msg_id = m.msg_id
            WHERE m.msg_id = ? AND m.Canal_cnl_id = ? FOR UPDATE', [$id, $origin])->fetch();
        if (!$original) throw new DomainException('A mensagem original não está disponível.', 404);
        $text = $original['text'];
        if ($original['game'] !== null && $text === '') $text = 'Gameplay · ' . $original['game'];
        if ($original['media'] !== null) {
            $file = chatMediaPath($original['media']);
            if (!$file || !is_file($file)) throw new DomainException('O anexo original não está disponível.', 404);
            $savedMedia = bin2hex(random_bytes(16)) . '.' . pathinfo($file, PATHINFO_EXTENSION);
            if (!copy($file, chatMediaPath($savedMedia))) throw new RuntimeException('Falha ao encaminhar anexo.');
        }
    }
    $payload = $text !== '' ? $text : (chatMediaKind($savedMedia) === 'image' ? 'Imagem' : 'Vídeo');
    if ($forward || $reply !== null) {
        query($db, 'INSERT INTO Mensagem (MembroServidor_mbs_id, Canal_cnl_id, msg_texto, msg_enviada_em, msg_video_caminho, msg_resposta_id, msg_encaminhada)
            VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, ?, ?)', [$member, $channel, $payload, $savedMedia, $reply, (int) $forward]);
    } else {
        query($db, 'INSERT INTO Mensagem (MembroServidor_mbs_id, Canal_cnl_id, msg_texto, msg_enviada_em, msg_video_caminho)
            VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?)', [$member, $channel, $payload, $savedMedia]);
    }
    $db->commit();
    $savedMedia = null;
    chatResponse(['ok' => true], 201);
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    if ($savedMedia && ($file = chatMediaPath($savedMedia))) @unlink($file);
    if ($error instanceof DomainException) chatResponse(['error' => $error->getMessage()], $error->getCode());
    error_log('Discordo chat: ' . get_class($error) . ' (' . $error->getCode() . ')');
    chatResponse(['error' => 'Não foi possível acessar as mensagens agora.'], 503);
}
