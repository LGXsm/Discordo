<?php
declare(strict_types=1);

function gameplayId(mixed $id): int
{
    if (!is_int($id) || $id < 1 || $id > 4294967295) throw new DomainException('Identificador inválido.', 422);
    return $id;
}

function validateGameplayStart(string $date, mixed $timezone, ?DateTimeImmutable $now = null): DateTimeImmutable
{
    $utc = new DateTimeZone('UTC');
    $start = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $date, $utc);
    $now ??= new DateTimeImmutable('now', $utc);
    if (!$start || $start->format('Y-m-d\TH:i:s\Z') !== $date || $start <= $now) {
        throw new DomainException('Escolha uma data e um horário futuros.', 422);
    }
    if (!is_string($timezone) || !in_array($timezone, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true)) {
        throw new DomainException('Fuso horário inválido.', 422);
    }
    $zone = new DateTimeZone($timezone);
    $end = $now->setTimezone($zone)->modify('+3 days')->setTime(23, 59, 59);
    if ($start > $end) {
        throw new DomainException('Marque o Gameplay até ' . $end->format('d/m/Y') . '.', 422);
    }
    return $start;
}

function gameplayInvitationBody(string $organizer, string $game, DateTimeImmutable $start, int $server, int $channel, string $comment): string
{
    $when = $start->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('d/m/Y às H:i');
    $link = "https://discordo.lgmartinez.com/?servidor=$server&canal=$channel";
    $note = $comment === '' ? '' : "Comentário de $organizer:\r\n" . str_replace("\n", "\r\n", $comment) . "\r\n\r\n";
    return "$organizer está te chamando para jogar $game em $when (horário de Brasília).\r\n\r\n"
        . $note
        . "Responda à enquete no canal do Discordo:\r\n$link\r\n";
}

function sendGameplayInvitations(array $recipients, string $organizer, string $game, DateTimeImmutable $start, int $server, int $channel, string $comment): int
{
    $from = getenv('DISCORDO_MAIL_FROM') ?: 'discordo@lgmartinez.com';
    $body = gameplayInvitationBody($organizer, $game, $start, $server, $channel, $comment);
    $failed = 0;
    foreach ($recipients as $recipient) {
        $email = $recipient['email'];
        if (!function_exists('mail') || !filter_var($from, FILTER_VALIDATE_EMAIL)
            || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\s",<>]/', $email)
            || !@mail($email, 'Convite para jogar no Discordo', quoted_printable_encode($body), [
                'From' => "Discordo <$from>", 'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8',
                'Content-Transfer-Encoding' => 'quoted-printable',
            ])) $failed++;
    }
    return $failed;
}

function gameplayChanges(PDO $db, int $user, int $server, int $channel, array $data,
    ?callable $send = null): array
{
    $db->beginTransaction();
    query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server]);
    if (!visibleChannels($db, $user, $server, 'TEXTO', $channel)) throw new DomainException('Canal indisponível.', 403);
    $member = (int) query($db, 'SELECT mbs_id FROM MembroServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?',
        [$server, $user])->fetchColumn();
    if (!$member) throw new DomainException('Você precisa fazer parte do servidor.', 403);
    $action = $data['action'] ?? null;
    if ($action === 'createGameplay') {
        $game = is_string($data['game'] ?? null) ? trim($data['game']) : '';
        $comment = $data['comment'] ?? '';
        if (!is_string($comment) || !preg_match('/\A.{0,500}\z/us', $comment)) {
            throw new DomainException('O comentário pode ter até 500 caracteres.', 422);
        }
        $comment = trim(str_replace(["\r\n", "\r"], "\n", $comment));
        $date = is_string($data['start'] ?? null) ? $data['start'] : '';
        $start = validateGameplayStart($date, $data['timezone'] ?? 'America/Sao_Paulo');
        if (!preg_match('/\A[^\r\n]{1,80}\z/u', $game)) throw new DomainException('Digite o nome do jogo, com até 80 caracteres.', 422);
        $invited = $data['members'] ?? null;
        if (!is_array($invited) || !array_is_list($invited) || !$invited || count($invited) > 20) {
            throw new DomainException('Escolha de 1 a 20 convidados.', 422);
        }
        $invited = array_unique(array_map('gameplayId', $invited));
        $actor = query($db, 'SELECT usr_nome_exibicao FROM Usuario WHERE usr_id = ? FOR UPDATE', [$user])->fetchColumn();
        if (query($db, 'SELECT 1 FROM Gameplay g JOIN Mensagem m ON m.msg_id = g.Mensagem_msg_id
            JOIN MembroServidor ms ON ms.mbs_id = m.MembroServidor_mbs_id
            WHERE ms.Usuario_usr_id = ? AND m.msg_enviada_em > UTC_TIMESTAMP() - INTERVAL 1 MINUTE LIMIT 1',
            [$user])->fetchColumn()) throw new DomainException('Aguarde um minuto para publicar outro Gameplay.', 429);
        $recipients = query($db, 'SELECT mbs_id, Usuario_usr_id, usr_email AS email FROM MembroServidor
            JOIN Usuario ON usr_id = Usuario_usr_id WHERE Servidor_srv_id = ?
            AND mbs_id IN (' . implode(',', array_fill(0, count($invited), '?')) . ')', [$server, ...$invited])->fetchAll();
        if (count($recipients) !== count($invited)) throw new DomainException('Um convidado não faz mais parte do servidor.', 422);
        foreach ($recipients as $recipient) {
            if ((int) $recipient['mbs_id'] === $member || !visibleChannels($db, (int) $recipient['Usuario_usr_id'], $server, 'TEXTO', $channel)) {
                throw new DomainException('Escolha convidados com acesso ao canal selecionado.', 422);
            }
        }
        query($db, 'INSERT INTO Mensagem (MembroServidor_mbs_id, Canal_cnl_id, msg_texto, msg_enviada_em)
            VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [$member, $channel, 'Gameplay: ' . $game . ($comment === '' ? '' : "\n" . $comment)]);
        $message = (int) $db->lastInsertId();
        query($db, 'INSERT INTO Gameplay (Mensagem_msg_id, gpl_jogo, gpl_inicio_em) VALUES (?, ?, ?)',
            [$message, $game, $start->format('Y-m-d H:i:s')]);
        $id = (int) $db->lastInsertId();
        foreach ($invited as $recipient) {
            query($db, "INSERT INTO GameplayParticipante (Gameplay_gpl_id, MembroServidor_mbs_id, gpp_situacao)
                VALUES (?, ?, 'CONVIDADO')", [$id, $recipient]);
        }
        $db->commit();
        $send ??= sendGameplayInvitations(...);
        return ['id' => $id, 'message' => $message,
            'emailFailures' => $send($recipients, (string) $actor, $game, $start, $server, $channel, $comment)];
    }
    $id = gameplayId($data['id'] ?? null);
    $poll = query($db, 'SELECT m.MembroServidor_mbs_id AS organizer, g.gpl_inicio_em > UTC_TIMESTAMP() AS active
        FROM Gameplay g JOIN Mensagem m ON m.msg_id = g.Mensagem_msg_id WHERE g.gpl_id = ? AND m.Canal_cnl_id = ?',
        [$id, $channel])->fetch();
    if (!$poll) throw new DomainException('Gameplay indisponível.', 404);
    if (!$poll['active']) throw new DomainException('O horário deste Gameplay já passou.', 409);
    $organizer = (int) $poll['organizer'] === $member;
    if ($action === 'approveGameplay') {
        if (!$organizer) throw new DomainException('Somente o organizador pode aceitar pedidos.', 403);
        $target = gameplayId($data['member'] ?? null);
        $targetUser = query($db, 'SELECT Usuario_usr_id FROM MembroServidor WHERE mbs_id = ? AND Servidor_srv_id = ?',
            [$target, $server])->fetchColumn();
        if (!$targetUser || !visibleChannels($db, (int) $targetUser, $server, 'TEXTO', $channel)) {
            throw new DomainException('Este membro não tem acesso ao canal.', 403);
        }
        query($db, "UPDATE GameplayParticipante SET gpp_situacao = 'CONFIRMADO'
            WHERE Gameplay_gpl_id = ? AND MembroServidor_mbs_id = ? AND gpp_situacao = 'INTERESSADO'", [$id, $target]);
    } elseif ($action === 'respondGameplay' && !$organizer) {
        $status = query($db, 'SELECT gpp_situacao FROM GameplayParticipante WHERE Gameplay_gpl_id = ? AND MembroServidor_mbs_id = ?',
            [$id, $member])->fetchColumn();
        $choice = $data['choice'] ?? null;
        if ($choice === 'INTERESSADO' && ($status === false || $status === 'INTERESSADO')) {
            if (!$status) query($db, "INSERT INTO GameplayParticipante (Gameplay_gpl_id, MembroServidor_mbs_id, gpp_situacao)
                VALUES (?, ?, 'INTERESSADO')", [$id, $member]);
        } elseif ($status && $status !== 'INTERESSADO' && in_array($choice, ['CONFIRMADO', 'RECUSADO'], true)) {
            query($db, 'UPDATE GameplayParticipante SET gpp_situacao = ? WHERE Gameplay_gpl_id = ? AND MembroServidor_mbs_id = ?',
                [$choice, $id, $member]);
        } else throw new DomainException('Essa resposta não está disponível para você.', 403);
    } else throw new DomainException('Ação indisponível.', 403);
    $db->commit();
    return ['id' => $id];
}

function gameplayPolls(PDO $db, int $channel, int $user, int $first, int $last): array
{
    $rows = query($db, 'SELECT g.gpl_id AS id, g.Mensagem_msg_id AS message, g.gpl_jogo AS game,
        g.gpl_inicio_em AS start, m.msg_texto AS comment, author.Usuario_usr_id AS organizer, p.gpp_situacao AS status,
        p.MembroServidor_mbs_id AS member, voter.Usuario_usr_id AS voter, u.usr_nome_exibicao AS name
        FROM (SELECT msg_id FROM Mensagem WHERE Canal_cnl_id = ? AND msg_id BETWEEN ? AND ?
            ORDER BY msg_id DESC LIMIT 150) recent
        JOIN Gameplay g ON g.Mensagem_msg_id = recent.msg_id
        JOIN Mensagem m ON m.msg_id = recent.msg_id
        JOIN MembroServidor author ON author.mbs_id = m.MembroServidor_mbs_id
        LEFT JOIN GameplayParticipante p ON p.Gameplay_gpl_id = g.gpl_id
        LEFT JOIN MembroServidor voter ON voter.mbs_id = p.MembroServidor_mbs_id
        LEFT JOIN Usuario u ON u.usr_id = voter.Usuario_usr_id
        ORDER BY g.gpl_id, p.gpp_id', [$channel, $first, $last])->fetchAll();
    $polls = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $owner = (int) $row['organizer'] === $user;
        $prefix = 'Gameplay: ' . $row['game'] . "\n";
        $polls[$id] ??= ['id' => $id, 'message' => (int) $row['message'], 'game' => $row['game'],
            'comment' => str_starts_with($row['comment'], $prefix) ? substr($row['comment'], strlen($prefix)) : '',
            'start' => str_replace(' ', 'T', $row['start']) . 'Z', 'owner' => $owner, 'status' => null,
            'confirmed' => [], 'declined' => 0, 'interested' => 0, 'requests' => [], 'participants' => []];
        if ((int) $row['voter'] === $user) $polls[$id]['status'] = $row['status'];
        if (in_array($row['status'], ['CONFIRMADO', 'RECUSADO', 'INTERESSADO'], true)) {
            $polls[$id]['participants'][] = ['name' => $row['name'], 'status' => $row['status'],
                'member' => (int) $row['member']];
        }
        if ($row['status'] === 'CONFIRMADO') $polls[$id]['confirmed'][] = $row['name'];
        if ($row['status'] === 'RECUSADO') $polls[$id]['declined']++;
        if ($row['status'] === 'INTERESSADO') {
            $polls[$id]['interested']++;
            if ($owner) $polls[$id]['requests'][] = ['member' => (int) $row['member'], 'name' => $row['name']];
        }
    }
    return array_values($polls);
}
