<?php
declare(strict_types=1);

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/channel-layout.php';
require_once __DIR__ . '/reserved-role-colors.php';

const MANAGE_CHANNELS = CHANNEL_LAYOUT_MANAGE_PERMISSION;
const MANAGE_ROLES = 2;
const MOVE_VOICE = 4;
const CREATE_ROLES = 8;
const MUTE_VOICE = 16;
const DEAFEN_VOICE = 32;
const DISCONNECT_VOICE = 64;
const PUNISH_VOICE = 128;
const DELETE_MESSAGES = 256;
const ALL_PERMISSIONS = MANAGE_CHANNELS | MANAGE_ROLES | MOVE_VOICE | CREATE_ROLES
    | MUTE_VOICE | DEAFEN_VOICE | DISCONNECT_VOICE | PUNISH_VOICE | DELETE_MESSAGES;

function serverPermissions(PDO $db, int $server, int $user): int
{
    return (int) query($db, 'SELECT COALESCE(BIT_OR(c.crg_permissoes), 0)
        FROM MembroServidor m JOIN MembroCargo mc ON mc.MembroServidor_mbs_id = m.mbs_id
        JOIN Cargo c ON c.crg_id = mc.Cargo_crg_id AND c.Servidor_srv_id = m.Servidor_srv_id
        WHERE m.Servidor_srv_id = ? AND m.Usuario_usr_id = ?', [$server, $user])->fetchColumn();
}

function serverAdministrator(PDO $db, int $server, int $user): bool
{
    return isCreator($db, $user) || (bool) query($db,
        'SELECT 1 FROM Servidor WHERE srv_id = ? AND Usuario_usr_id_Proprietario = ?', [$server, $user])->fetchColumn();
}

function isCreator(PDO $db, int $user): bool
{
    return (bool) query($db, 'SELECT 1 FROM CriadorPlataforma WHERE Usuario_usr_id = ?', [$user])->fetchColumn();
}

function visibleChannels(PDO $db, int $user, ?int $server, string $type = '', ?int $channel = null): array
{
    $filter = $server === null ? '' : ' AND s.srv_id = ?';
    $parameters = [$user, $user, $user, $user];
    if ($server !== null) $parameters[] = $server;
    if ($type !== '') {
        $filter .= ' AND c.cnl_tipo = ?';
        $parameters[] = $type;
    }
    if ($channel !== null) {
        $filter .= ' AND c.cnl_id = ?';
        $parameters[] = $channel;
    }
    return query($db, 'SELECT c.cnl_id AS id, c.cnl_nome AS name, c.cnl_tipo AS type, c.cnl_privado AS private, c.cnl_topico AS topic, s.srv_id AS server
        FROM Canal c JOIN Servidor s ON s.srv_id = c.Servidor_srv_id
        LEFT JOIN MembroServidor m ON m.Servidor_srv_id = s.srv_id AND m.Usuario_usr_id = ?
        WHERE (s.Usuario_usr_id_Proprietario = ? OR EXISTS (SELECT 1 FROM CriadorPlataforma WHERE Usuario_usr_id = ?)
          OR (m.Usuario_usr_id = ? AND (c.cnl_privado = 0 OR EXISTS (
              SELECT 1 FROM CanalCargo cc JOIN MembroCargo mc ON mc.Cargo_crg_id = cc.Cargo_crg_id
              WHERE cc.Canal_cnl_id = c.cnl_id AND mc.MembroServidor_mbs_id = m.mbs_id
          ))))' . $filter . ' ORDER BY c.cnl_id', $parameters)->fetchAll();
}

function canUseVoice(PDO $db, int $user, int $channel): bool
{
    return visibleChannels($db, $user, null, 'VOZ', $channel) !== [];
}

function iconDirectory(): string
{
    return dirname(getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php') . '/discordo-server-icons';
}

function removeIcon(?string $filename): void
{
    if ($filename && preg_match('/\A[a-f0-9]{32}\.png\z/', $filename)) @unlink(iconDirectory() . '/' . $filename);
}

function deleteChannelMessages(PDO $db, int $id, bool $wholeServer = false, ?int $message = null): array
{
    $scope = ($wholeServer ? 'c.Servidor_srv_id' : 'c.cnl_id') . ' = ?';
    $parameters = [$id];
    if ($message !== null) {
        $scope .= ' AND msg.msg_id = ?';
        $parameters[] = $message;
    }
    $oldMedia = query($db, 'SELECT msg_video_caminho FROM Mensagem msg JOIN Canal c ON c.cnl_id = msg.Canal_cnl_id
        WHERE ' . $scope . ' AND msg_video_caminho IS NOT NULL', $parameters)->fetchAll(PDO::FETCH_COLUMN);
    query($db, 'DELETE p FROM GameplayParticipante p JOIN Gameplay g ON g.gpl_id = p.Gameplay_gpl_id
        JOIN Mensagem msg ON msg.msg_id = g.Mensagem_msg_id JOIN Canal c ON c.cnl_id = msg.Canal_cnl_id
        WHERE ' . $scope, $parameters);
    query($db, 'DELETE g FROM Gameplay g JOIN Mensagem msg ON msg.msg_id = g.Mensagem_msg_id
        JOIN Canal c ON c.cnl_id = msg.Canal_cnl_id WHERE ' . $scope, $parameters);
    query($db, 'DELETE msg FROM Mensagem msg JOIN Canal c ON c.cnl_id = msg.Canal_cnl_id
        WHERE ' . $scope, $parameters);
    return $oldMedia;
}

function deleteServerRecords(PDO $db, int $id, ?string $image): array
{
    $oldMedia = deleteChannelMessages($db, $id, true);
    query($db, 'DELETE cc FROM CanalCargo cc JOIN Canal c ON c.cnl_id = cc.Canal_cnl_id
        WHERE c.Servidor_srv_id = ?', [$id]);
    query($db, 'DELETE mc FROM MembroCargo mc JOIN MembroServidor m ON m.mbs_id = mc.MembroServidor_mbs_id
        WHERE m.Servidor_srv_id = ?', [$id]);
    $deletedVoiceChannels = query($db, "SELECT cnl_id FROM Canal WHERE Servidor_srv_id = ? AND cnl_tipo = 'VOZ'", [$id])->fetchAll(PDO::FETCH_COLUMN);
    query($db, 'DELETE FROM Canal WHERE Servidor_srv_id = ?', [$id]);
    query($db, 'DELETE FROM Cargo WHERE Servidor_srv_id = ?', [$id]);
    query($db, 'DELETE FROM MembroServidor WHERE Servidor_srv_id = ?', [$id]);
    query($db, 'DELETE FROM Servidor WHERE srv_id = ?', [$id]);
    return ['id' => $id, 'image' => $image, 'media' => $oldMedia, 'voiceChannels' => $deletedVoiceChannels];
}

function removeDeletedServerFiles(array $server): void
{
    @unlink(roleOrderPath($server['id']));
    @unlink(channelLayoutPath($server['id']));
    @unlink(reservedRoleColorPath($server['id']));
    removeIcon($server['image']);
    removeDeletedChannelFiles($server['media'], $server['voiceChannels']);
}

function removeDeletedChannelFiles(array $media, array $voiceChannels): void
{
    foreach ($voiceChannels as $channel) @unlink(voiceLimitPath((int) $channel));
    foreach ($media as $name) {
        if ($file = chatMediaPath($name)) @unlink($file);
    }
}

function voiceStateDirectory(): string
{
    return sys_get_temp_dir() . '/discordo-' . hash('sha256', __DIR__);
}
