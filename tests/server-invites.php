<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/database.php';
require_once __DIR__ . '/../backend/src/server-invites.php';

function checkInvite(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

function expectInviteError(callable $action, int $status): void {
    try {
        $action();
        throw new RuntimeException("Expected invite error $status");
    } catch (DomainException $error) {
        checkInvite($error->getCode() === $status, 'Unexpected invite error: ' . $error->getMessage());
    }
}

$config = databaseConfig();
checkInvite($config['host'] === '127.0.0.1' && $config['database'] === 'discordo_multiservidor'
    && str_starts_with(basename(dirname(getenv('DISCORDO_DB_CONFIG'))), 'discordo-invites-'),
    'Use an isolated invites test database.');
$db = database();
checkInvite((int) query($db, 'SELECT COUNT(*) FROM Usuario')->fetchColumn() === 0, 'Use an empty test database.');
try {
    $db->beginTransaction();
    foreach ([20, 21, 22] as $user) {
        query($db, 'INSERT INTO Usuario (usr_id, usr_nome_exibicao, usr_email, usr_senha_hash, usr_data_nascimento)
            VALUES (?, ?, ?, ?, ?)', [$user, "Player $user", "player$user@example.test", 'fixture', '2000-01-01']);
    }
    query($db, 'INSERT INTO Servidor (srv_id, Usuario_usr_id_Proprietario, srv_nome) VALUES (29, 20, ?)', ['Guilda']);
    query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (29, 20)');
    query($db, 'INSERT INTO Servidor (srv_id, Usuario_usr_id_Proprietario, srv_nome) VALUES (31, 21, ?)', ['Outra guilda']);
    query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (31, 21), (31, 22)');
    checkInvite(profileInviteServers($db, 20, 21) === [['id' => 29, 'name' => 'Guilda']],
        'Profile invites must only list servers the sender belongs to and the recipient does not.');
    expectInviteError(fn () => shareProfileInvite($db, 31, 20, 21), 403);
    expectInviteError(fn () => shareProfileInvite($db, 31, 21, 22), 409);
    $profileLink = shareProfileInvite($db, 29, 20, 21);
    checkInvite(serverInvitePreview($db, $profileLink, 21)['id'] === 29 && listServerInvites($db, 31) === [],
        'The profile invite wrote to the wrong server.');
    query($db, 'DELETE FROM MembroServidor WHERE Servidor_srv_id = 31 AND Usuario_usr_id = 22');
    $limited = createServerInvite($db, 29, 20, 168, 1);
    $unlimited = createServerInvite($db, 29, 20, 24, null);
    $shared = shareServerInvite($db, 29, 20);
    checkInvite($shared === shareServerInvite($db, 29, 20) && $shared !== $unlimited,
        'Reopening did not reuse the same seven-day link.');
    $settings = query($db, 'SELECT cvs_limite AS limit_count, TIMESTAMPDIFF(HOUR, cvs_criado_em, cvs_expira_em) AS hours
        FROM ConviteServidor WHERE cvs_token = ?', [$shared])->fetch();
    checkInvite($settings['limit_count'] === null && (int) $settings['hours'] === 168, 'The default invite was limited or had the wrong duration.');
    revokeServerInvite($db, 29, $shared);
    checkInvite($shared !== shareServerInvite($db, 29, 20), 'The default link reused a revoked invite.');
    checkInvite($limited !== $unlimited && strlen($limited) === 48, 'Invalid random token.');
    expectInviteError(fn () => createServerInvite($db, 29, 20, 168, 0), 422);
    checkInvite(serverInvitePreview($db, $limited, null) === ['id' => 29, 'name' => 'Guilda', 'hasIcon' => false, 'member' => false],
        'The public preview leaked private fields or loaded the wrong server.');
    checkInvite(acceptServerInvite($db, $limited, 21) === 29 && acceptServerInvite($db, $limited, 21) === 29,
        'Retrying a successful join was not idempotent.');
    expectInviteError(fn () => acceptServerInvite($db, $limited, 22), 410);
    expectInviteError(fn () => shareServerInvite($db, 29, 22), 403);
    expectInviteError(fn () => shareServerInvite($db, 1, 21), 403);
    $memberLink = shareServerInvite($db, 29, 21);
    checkInvite($memberLink === shareServerInvite($db, 29, 21) && $memberLink !== $shared
        && serverInvitePreview($db, $memberLink, null)['id'] === 29,
        'A regular member could not share a reusable link for their own server.');
    checkInvite(serverInvitePreview($db, $limited, 21)['member'], 'An existing member cannot open an exhausted link.');
    checkInvite((int) serverInviteRow($db, $limited)['uses'] === 1 && listServerInvites($db, 1) === [],
        'Use count or scope is wrong.');
    revokeServerInvite($db, 1, $unlimited);
    checkInvite(!serverInviteRow($db, $unlimited)['revoked'], 'A different server could revoke the guild link.');
    revokeServerInvite($db, 29, $unlimited);
    expectInviteError(fn () => serverInvitePreview($db, $unlimited, null), 410);
    expectInviteError(fn () => acceptServerInvite($db, $unlimited, 22), 410);
    $expired = createServerInvite($db, 29, 20, 1, null);
    query($db, 'UPDATE ConviteServidor SET cvs_expira_em = UTC_TIMESTAMP() WHERE cvs_token = ?', [$expired]);
    expectInviteError(fn () => serverInvitePreview($db, $expired, null), 410);
    expectInviteError(fn () => acceptServerInvite($db, $expired, 22), 410);
    checkInvite(!serverInviteMembership($db, 29, 22), 'A rejected invite created a membership.');
    $creatorInvite = createServerInvite($db, 1, 22, 1, null);
    query($db, 'DELETE FROM Usuario WHERE usr_id = 22');
    expectInviteError(fn () => serverInviteRow($db, $creatorInvite), 404);
    echo "Server invitations passed against MariaDB.\n";
} finally {
    $db->rollBack();
}

