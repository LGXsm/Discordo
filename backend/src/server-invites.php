<?php
declare(strict_types=1);

function serverInviteToken(mixed $token): string
{
    if (!is_string($token) || !preg_match('/\A[a-f0-9]{48}\z/', $token)) {
        throw new DomainException('Convite inválido.', 404);
    }
    return $token;
}

function serverInviteRow(PDO $db, string $token, bool $lock = false): array
{
    $row = query($db, 'SELECT c.cvs_id AS id, c.Servidor_srv_id AS server, c.cvs_limite AS maxUses,
        c.cvs_usos AS uses, c.cvs_expira_em <= UTC_TIMESTAMP() AS expired,
        c.cvs_revogado_em IS NOT NULL AS revoked, s.srv_nome AS name, s.srv_imagem_caminho AS image
        FROM ConviteServidor c JOIN Servidor s ON s.srv_id = c.Servidor_srv_id
        WHERE c.cvs_token = ?' . ($lock ? ' FOR UPDATE' : ''), [$token])->fetch();
    if (!$row) throw new DomainException('Convite inválido ou indisponível.', 404);
    return $row;
}

function validateActiveServerInvite(array $invite): void
{
    if ($invite['revoked']) throw new DomainException('Este convite foi revogado.', 410);
    if ($invite['expired']) throw new DomainException('Este convite expirou.', 410);
    if ($invite['maxUses'] !== null && (int) $invite['uses'] >= (int) $invite['maxUses']) {
        throw new DomainException('Este convite atingiu o limite de usos.', 410);
    }
}

function serverInviteMembership(PDO $db, int $server, ?int $user, bool $lock = false): bool
{
    return $user !== null && (bool) query($db, 'SELECT 1 FROM MembroServidor
        WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?' . ($lock ? ' FOR UPDATE' : ''), [$server, $user])->fetchColumn();
}

function serverInvitePreview(PDO $db, string $token, ?int $user): array
{
    $invite = serverInviteRow($db, $token);
    $member = serverInviteMembership($db, (int) $invite['server'], $user);
    if (!$member) validateActiveServerInvite($invite);
    return ['id' => (int) $invite['server'], 'name' => $invite['name'], 'hasIcon' => $invite['image'] !== null, 'member' => $member];
}

function acceptServerInvite(PDO $db, string $token, int $user): int
{
    $server = (int) serverInviteRow($db, $token)['server'];
    if (!query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server])->fetchColumn()) {
        throw new DomainException('Servidor indisponível.', 404);
    }
    $invite = serverInviteRow($db, $token, true);
    if (serverInviteMembership($db, $server, $user, true)) return $server;
    validateActiveServerInvite($invite);
    query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (?, ?)', [$server, $user]);
    query($db, 'UPDATE ConviteServidor SET cvs_usos = cvs_usos + 1 WHERE cvs_id = ?', [$invite['id']]);
    return $server;
}

function createServerInvite(PDO $db, int $server, int $user, mixed $hours, mixed $maxUses): string
{
    if (!in_array($hours, [1, 24, 168], true)) throw new DomainException('Escolha uma validade para o convite.', 422);
    if ($maxUses !== null && (!is_int($maxUses) || $maxUses < 1 || $maxUses > 1000)) {
        throw new DomainException('Informe um limite de 1 a 1000 usos.', 422);
    }
    $token = bin2hex(random_bytes(24));
    query($db, 'INSERT INTO ConviteServidor
        (Servidor_srv_id, Usuario_usr_id, cvs_token, cvs_criado_em, cvs_expira_em, cvs_limite)
        VALUES (?, ?, ?, UTC_TIMESTAMP(), TIMESTAMPADD(HOUR, ?, UTC_TIMESTAMP()), ?)', [$server, $user, $token, $hours, $maxUses]);
    return $token;
}

function shareServerInvite(PDO $db, int $server, int $user, bool $admin = false): string
{
    if (!$admin && !serverInviteMembership($db, $server, $user, true)) {
        throw new DomainException('Entre no servidor para compartilhar um convite.', 403);
    }
    // The caller holds the server lock so simultaneous opens share the same link.
    $active = query($db, 'SELECT cvs_token FROM ConviteServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id = ?
        AND cvs_revogado_em IS NULL AND cvs_expira_em > UTC_TIMESTAMP() AND cvs_limite IS NULL
        AND cvs_expira_em = TIMESTAMPADD(HOUR, 168, cvs_criado_em) ORDER BY cvs_id DESC LIMIT 1 FOR UPDATE',
        [$server, $user])->fetchColumn();
    return $active === false ? createServerInvite($db, $server, $user, 168, null) : $active;
}

function profileInviteServers(PDO $db, int $user, int $other): array
{
    $rows = query($db, 'SELECT s.srv_id AS id, s.srv_nome AS name
        FROM MembroServidor own JOIN Servidor s ON s.srv_id = own.Servidor_srv_id
        LEFT JOIN MembroServidor guest ON guest.Servidor_srv_id = s.srv_id AND guest.Usuario_usr_id = ?
        WHERE own.Usuario_usr_id = ? AND guest.mbs_id IS NULL ORDER BY s.srv_nome, s.srv_id', [$other, $user])->fetchAll();
    return array_map(static fn ($row) => ['id' => (int) $row['id'], 'name' => $row['name']], $rows);
}

function shareProfileInvite(PDO $db, int $server, int $user, int $other): string
{
    if (!query($db, 'SELECT srv_id FROM Servidor WHERE srv_id = ? FOR UPDATE', [$server])->fetchColumn()
        || !serverInviteMembership($db, $server, $user, true)) {
        throw new DomainException('Você precisa participar desse servidor para convidar alguém.', 403);
    }
    if (serverInviteMembership($db, $server, $other, true)) {
        throw new DomainException('Essa pessoa já participa desse servidor.', 409);
    }
    return shareServerInvite($db, $server, $user, true);
}

function listServerInvites(PDO $db, int $server): array
{
    $rows = query($db, 'SELECT cvs_token AS token, cvs_expira_em AS expires, cvs_limite AS maxUses, cvs_usos AS uses,
        cvs_revogado_em IS NOT NULL AS revoked, cvs_expira_em <= UTC_TIMESTAMP() AS expired
        FROM ConviteServidor WHERE Servidor_srv_id = ? ORDER BY cvs_id DESC', [$server])->fetchAll();
    return array_map(static function (array $row): array {
        $row['expires'] = str_replace(' ', 'T', $row['expires']) . 'Z';
        $row['revoked'] = (bool) $row['revoked'];
        $row['expired'] = (bool) $row['expired'];
        return $row;
    }, $rows);
}

function revokeServerInvite(PDO $db, int $server, string $token): void
{
    query($db, 'UPDATE ConviteServidor SET cvs_revogado_em = COALESCE(cvs_revogado_em, UTC_TIMESTAMP())
        WHERE Servidor_srv_id = ? AND cvs_token = ?', [$server, $token]);
}

