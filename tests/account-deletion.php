<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/database.php';
require_once __DIR__ . '/../backend/src/profile-sounds.php';
require_once __DIR__ . '/../backend/src/profile-appearance.php';
require_once __DIR__ . '/../backend/src/account-verification.php';
require_once __DIR__ . '/../backend/src/account-deletion.php';

function checkDeletion(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$config = databaseConfig();
checkDeletion($config['host'] === '127.0.0.1' && $config['database'] === 'discordo_multiservidor'
    && str_starts_with(basename(dirname(getenv('DISCORDO_DB_CONFIG'))), 'discordo-delete-'), 'Use the isolated account deletion test database.');
$db = database();
checkDeletion((int) query($db, 'SELECT COUNT(*) FROM Usuario')->fetchColumn() === 0, 'The deletion fixture requires an empty database.');

$password = 'senha-de-teste';
$hash = password_hash(hash('sha256', $password), PASSWORD_BCRYPT, ['cost' => 4]);
$scenario = [
    20 => ['Owner', 'owner@example.test', str_repeat('a', 32) . '.gif', str_repeat('b', 32) . '.png'],
    21 => ['Guest', 'guest@example.test', null, null],
    22 => ['Solo', 'solo@example.test', null, null],
];
foreach ($scenario as $id => [$name, $email, $avatar, $banner]) {
    query($db, 'INSERT INTO Usuario (usr_id, usr_nome_exibicao, usr_email, usr_senha_hash, usr_data_nascimento, usr_avatar_caminho, usr_banner_caminho)
        VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, $name, $email, $hash, '2000-01-01', $avatar, $banner]);
    joinEntrance($db, $id);
}
query($db, 'INSERT INTO CriadorPlataforma (Usuario_usr_id) VALUES (20)');
query($db, 'INSERT INTO Servidor (srv_id, Usuario_usr_id_Proprietario, srv_nome) VALUES (29, 20, "Shared"), (30, 22, "Solo")');
query($db, 'INSERT INTO Canal (cnl_id, Servidor_srv_id, cnl_nome, cnl_tipo) VALUES
    (292, 29, "Chat", "TEXTO"), (302, 30, "Chat", "TEXTO"), (303, 30, "Voice", "VOZ")');
query($db, 'INSERT INTO MembroServidor (mbs_id, Servidor_srv_id, Usuario_usr_id) VALUES (2901, 29, 20), (2902, 29, 21), (3001, 30, 22)');
query($db, 'INSERT INTO Cargo (crg_id, Servidor_srv_id, crg_nome) VALUES (291, 29, "Player"), (301, 30, "Role")');
query($db, 'INSERT INTO MembroCargo (MembroServidor_mbs_id, Cargo_crg_id) VALUES (2901, 291), (2902, 291), (3001, 301)');
query($db, 'INSERT INTO CanalCargo (Canal_cnl_id, Cargo_crg_id) VALUES (302, 301)');

$sound = str_repeat('c', 32) . '.mp3';
$personalAttachment = str_repeat('d', 32) . '.gif';
$guestAttachment = str_repeat('e', 32) . '.gif';
$soloAttachment = str_repeat('f', 32) . '.gif';
query($db, 'INSERT INTO Mensagem (msg_id, MembroServidor_mbs_id, Canal_cnl_id, msg_texto, msg_enviada_em, msg_video_caminho) VALUES
    (1, 2901, 292, "Owner message", UTC_TIMESTAMP(3), ?), (2, 2902, 292, "Guest message", UTC_TIMESTAMP(3), ?),
    (3, 3001, 302, "Solo message", UTC_TIMESTAMP(3), ?)', [$personalAttachment, $guestAttachment, $soloAttachment]);
query($db, 'INSERT INTO Gameplay (gpl_id, Mensagem_msg_id, gpl_jogo, gpl_inicio_em) VALUES
    (1, 1, "Owner poll", UTC_TIMESTAMP(3)), (2, 2, "Guest poll", UTC_TIMESTAMP(3))');
query($db, 'INSERT INTO GameplayParticipante (Gameplay_gpl_id, MembroServidor_mbs_id, gpp_situacao) VALUES
    (1, 2902, "CONVIDADO"), (2, 2901, "INTERESSADO")');

$session = hash('sha256', 'owner-session', true);
$secondSession = hash('sha256', 'owner-session-2', true);
$guestSession = hash('sha256', 'guest-session', true);
$soloSession = hash('sha256', 'solo-session', true);
foreach ([[$session, 20], [$secondSession, 20], [$guestSession, 21], [$soloSession, 22]] as [$token, $user]) {
    query($db, 'INSERT INTO Sessao (Usuario_usr_id, ses_token_hash) VALUES (?, ?)', [$user, $token]);
}

foreach ([profileMediaDirectory(), profileSoundDirectory(), profileAppearanceDirectory(), chatVideoDirectory()] as $directory) mkdir($directory, 0700, true);
$avatarPrefix = profileMediaDirectory() . '/' . str_repeat('a', 32);
$files = [ $avatarPrefix . '.gif', $avatarPrefix . '-still.png', $avatarPrefix . '-crop.json',
    profileMediaDirectory() . '/' . $scenario[20][3], profileSoundDirectory() . '/' . $sound,
    profileSoundDirectory() . '/20.json', profileSoundDirectory() . '/20.lock', profileAppearanceDirectory() . '/20.json',
    chatMediaPath($personalAttachment)];
foreach ([...$files, chatMediaPath($guestAttachment), chatMediaPath($soloAttachment)] as $file) file_put_contents($file, 'fixture');
file_put_contents(profileSoundDirectory() . '/20.json', json_encode(['absenceSound' => $sound]));
saveServerRoleOrder(30, [301]);
saveChannelVoiceLimit(303, 4);

verificationState(static function (array &$state, int $now) {
    $state['challenges']['owner'] = ['details' => ['email' => 'owner@example.test'], 'expires' => $now + 300];
    $state['challenges']['guest'] = ['details' => ['email' => 'guest@example.test'], 'expires' => $now + 300];
});

foreach ([[null, 'owner@example.test', $password, 401], [$session, 'guest@example.test', $password, 401],
    [$session, 'owner@example.test', 'senha-errada', 422]] as [$token, $email, $attempt, $status]) {
    try {
        confirmAccountDeletion($db, $token, $email, $attempt);
        throw new RuntimeException('Invalid credentials deleted an account.');
    } catch (VerificationError $error) {
        if ($db->inTransaction()) $db->rollBack();
        checkDeletion($error->getCode() === $status, 'Invalid credentials returned the wrong status.');
    }
}
checkDeletion(query($db, 'SELECT COUNT(*) FROM Usuario')->fetchColumn() === 3 && is_file($files[0]), 'An invalid attempt removed data.');

[$owner, $cleanup] = confirmAccountDeletion($db, $session, 'owner@example.test', $password);
removeDeletedAccountFiles($owner, $cleanup);
checkDeletion(!query($db, 'SELECT 1 FROM Usuario WHERE usr_id = 20')->fetchColumn(), 'User row survived deletion.');
checkDeletion(!query($db, 'SELECT 1 FROM Sessao WHERE Usuario_usr_id = 20')->fetchColumn()
    && (int) query($db, 'SELECT Usuario_usr_id FROM Sessao WHERE ses_token_hash = ?', [$guestSession])->fetchColumn() === 21,
    'Other sessions were not revoked or the wrong account was signed out.');
checkDeletion(query($db, 'SELECT Usuario_usr_id_Proprietario FROM Servidor WHERE srv_id = 29')->fetchColumn() === null,
    'A shared server lost its data or retained the deleted owner.');
checkDeletion(query($db, 'SELECT msg_id FROM Mensagem WHERE Canal_cnl_id = 292')->fetchAll(PDO::FETCH_COLUMN) === [2]
    && query($db, 'SELECT gpl_id FROM Gameplay')->fetchAll(PDO::FETCH_COLUMN) === [2]
    && query($db, 'SELECT COUNT(*) FROM GameplayParticipante')->fetchColumn() === 0, 'Messages, polls and responses were not scoped to the account.');
checkDeletion(query($db, 'SELECT MembroServidor_mbs_id FROM MembroCargo WHERE Cargo_crg_id = 291')->fetchAll(PDO::FETCH_COLUMN) === [2902]
    && !query($db, 'SELECT 1 FROM CriadorPlataforma WHERE Usuario_usr_id = 20')->fetchColumn(), 'Role links survived deletion.');
foreach ($files as $file) checkDeletion(!is_file($file), 'An account file survived deletion.');
checkDeletion(is_file(chatMediaPath($guestAttachment)), 'Another member lost an attachment.');
checkDeletion(verificationState(static fn (array &$state) => array_keys($state['challenges'])) === ['guest'],
    'A pending account verification survived or another was removed.');

[$solo, $cleanup] = confirmAccountDeletion($db, $soloSession, 'solo@example.test', $password);
removeDeletedAccountFiles($solo, $cleanup);
checkDeletion(!query($db, 'SELECT 1 FROM Servidor WHERE srv_id = 30')->fetchColumn()
    && !is_file(chatMediaPath($soloAttachment)) && !is_file(voiceLimitPath(303)) && !is_file(roleOrderPath(30)), 'The unshared server or its files survived deletion.');

$room = [
    'owner' => ['user' => 20, 'events' => []],
    'guest' => ['user' => 21, 'events' => [
        ['type' => 'check-absence', 'senderName' => 'Owner', 'senderUser' => 20],
        ['type' => 'joined', 'member' => ['userId' => 20]],
        ['type' => 'joined', 'member' => ['userId' => 22]],
    ]],
];
$purged = purgeDeletedRoomParticipant($room, 20);
checkDeletion(!isset($purged['owner']) && $purged['guest']['events'] === [
    ['type' => 'joined', 'member' => ['userId' => 22]], ['type' => 'left', 'id' => 'owner'],
], 'Voice cleanup removed another member’s events or kept deleted data.');
echo "Account deletion passed with the production schema, foreign keys, two servers, and stored files.\n";

