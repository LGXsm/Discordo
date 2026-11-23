<?php
declare(strict_types=1);

// HostGator shared hosting adapter. Only signaling is stored, and room state expires.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/server-access.php';
require_once __DIR__ . '/profile-sounds.php';
require_once __DIR__ . '/channel-voice-limit.php';
require_once __DIR__ . '/voice-room-state.php';

$directory = voiceStateDirectory();
const DEMO_ROOM = 'local-video-demo';
const DEMO_NAME = 'Teste de vídeo';

function isDemoRoom(mixed $room): bool
{
    return is_string($room) && ($room === DEMO_ROOM || preg_match('/\Avideo-demo-[1-9][0-9]{0,9}\z/', $room) === 1);
}

function demoRoomForServer(PDO $db, int $server): ?string
{
    $lobby = query($db, 'SELECT COALESCE(srv_entrada, 0) FROM Servidor WHERE srv_id = ?', [$server])->fetchColumn();
    return $lobby === false ? null : ((int) $lobby === 1 ? DEMO_ROOM : 'video-demo-' . $server);
}

function demoServer(PDO $db, string $room): int
{
    if ($room === DEMO_ROOM) {
        return (int) query($db, 'SELECT srv_id FROM Servidor WHERE srv_entrada = 1 LIMIT 1')->fetchColumn();
    }
    $server = (int) substr($room, strlen('video-demo-'));
    return demoRoomForServer($db, $server) === $room ? $server : 0;
}

const KICK_TTL = 86400;
const HEARTBEAT_WRITE_INTERVAL = 5;
const ABSENCE_CHECK_COOLDOWN = 20;
const PUNISHMENT_DURATIONS = [10, 30, 60];

function reply(array $data, int $status = 200): never
{
    if (isset($data['error']) && !isset($data['code'])) {
        $data['code'] = match ($data['error']) {
            'session' => 'expired',
            'forbidden', 'origin', 'moderated_by_other' => 'forbidden',
            'unavailable', 'storage' => 'unavailable',
            'full' => 'full',
            'member_access' => 'not_in_room',
            default => 'bad_request',
        };
    }
    http_response_code($status);
    echo json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['presence'])) {
        $rooms = [];
        $server = filter_var($_GET['server'] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if (!$server) reply(['error' => 'server'], 400);
        try {
            $db = database();
            $user = signedInUser($db);
            if ($user === null) reply(['error' => 'session'], 401);
            $allowed = array_map(static fn ($row) => 'channel-' . $row['id'], visibleChannels($db, $user, $server, 'VOZ'));
            if (isCreator($db, $user) && ($demoRoom = demoRoomForServer($db, $server)) !== null) $allowed[] = $demoRoom;
        } catch (Throwable $error) {
            reply(['error' => 'unavailable'], 503);
        }
        foreach ($allowed as $roomId) {
            $rooms[$roomId] = roomPresence($directory, $roomId);
        }
        reply(['rooms' => $rooms]);
    }
    reply(['ok' => true, 'transport' => 'http']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(['error' => 'method'], 405);
}
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = strtolower($_SERVER['HTTP_HOST'] ?? '');
if (!in_array(strtolower($origin), ["https://$host", "http://$host"], true)) {
    reply(['error' => 'origin'], 403);
}
$raw = file_get_contents('php://input', false, null, 0, 262145);
if (!is_string($raw) || strlen($raw) > 262144) {
    reply(['error' => 'size'], 413);
}
$request = json_decode($raw, true);
if (!is_array($request)) reply(['error' => 'request'], 400);
$roomId = $request['room'] ?? null;
$server = $user = null;
$type = $request['type'] ?? '';
$demo = isDemoRoom($roomId);
$direct = is_string($roomId) && preg_match('/\Afriend-([1-9][0-9]{0,9})\z/', $roomId, $friendMatch);
$demoHost = false;
unset($request['demoDestination'], $request['destinationId']);
if (!$demo && !$direct && (!is_string($roomId) || !preg_match('/\Achannel-([1-9][0-9]{0,9})\z/', $roomId, $match))) {
    reply(['type' => 'rejected', 'reason' => 'invalid', 'code' => 'bad_request']);
}
if ($type !== 'leave') {
    try {
        $db = database();
        $user = signedInUser($db);
        if ($user === null) reply(['error' => 'session', 'code' => 'unauthenticated'], 401);
        if ($demo) {
            $server = demoServer($db, $roomId);
            if (!$server) reply(['error' => 'forbidden'], 403);
            $demoHost = isCreator($db, $user);
            if (!$demoHost && !in_array($type, ['join', 'poll'], true)) reply(['error' => 'forbidden'], 403);
        } elseif ($direct) {
            if (!in_array($type, ['join', 'poll'], true) || !query($db, 'SELECT 1 FROM Amizade
                WHERE ami_id = ? AND ami_aceita_em IS NOT NULL AND (ami_usuario_menor = ? OR ami_usuario_maior = ?)',
                [(int) $friendMatch[1], $user, $user])->fetchColumn()) reply(['error' => 'forbidden'], 403);
        } else {
            $access = visibleChannels($db, $user, null, 'VOZ', (int) $match[1]);
            if (!$access) reply(['error' => 'forbidden'], 403);
            $server = (int) $access[0]['server'];
        }
        if ($type === 'join') {
            $request['name'] = query($db, 'SELECT usr_nome_exibicao FROM Usuario WHERE usr_id = ?', [$user])->fetchColumn();
        } elseif ($type === 'move') {
            $destination = $request['destination'] ?? '';
            if (isDemoRoom($destination) && !$demo) {
                if (!isCreator($db, $user) || $destination !== demoRoomForServer($db, $server)) reply(['error' => 'forbidden'], 403);
                $request['demoDestination'] = $destination;
            } else {
                if (!is_string($destination) || $destination === $roomId
                    || !preg_match('/\Achannel-([1-9][0-9]{0,9})\z/', $destination, $target)) reply(['error' => 'destination'], 400);
                $destinations = visibleChannels($db, $user, $server, 'VOZ', (int) $target[1]);
                if ((!serverAdministrator($db, $server, $user) && !(serverPermissions($db, $server, $user) & MOVE_VOICE))
                    || $destinations === []) reply(['error' => 'forbidden'], 403);
                $limit = channelVoiceLimit((int) $target[1]);
                if ($limit !== null && count(roomPresence($directory, $destination)) >= $limit) reply(['error' => 'full'], 409);
                $request['destinationId'] = (int) $target[1];
                $request['destinationName'] = $destinations[0]['name'];
            }
        } elseif ($type === 'moderate') {
            $required = match ($request['action'] ?? null) {
                'serverMuted' => MUTE_VOICE,
                'serverDeafened' => DEAFEN_VOICE,
                'disconnect' => DISCONNECT_VOICE,
                'punish' => PUNISH_VOICE,
                default => 0,
            };
            $valid = $required === PUNISH_VOICE
                ? in_array($request['duration'] ?? null, PUNISHMENT_DURATIONS, true)
                : is_bool($request['enabled'] ?? null);
            if (!$required || !$valid) reply(['error' => 'request'], 400);
            if (!serverAdministrator($db, $server, $user) && !(serverPermissions($db, $server, $user) & $required)) {
                reply(['error' => 'forbidden'], 403);
            }
        }
    } catch (Throwable $error) {
        reply(['error' => 'unavailable'], 503);
    }
}

function eventFor(array &$room, string $id, array $event): void
{
    $room[$id]['events'][] = $event;
    if (count($room[$id]['events']) > 96) {
        array_shift($room[$id]['events']);
    }
}

function broadcast(array &$room, string $exclude, array $event): void
{
    foreach (array_keys($room) as $id) {
        if ($id !== $exclude && empty($room[$id]['kicked'])) {
            eventFor($room, $id, $event);
        }
    }
}

function voiceIceServers(?int $user, int $now): array
{
    $servers = [['urls' => 'stun:stun.l.google.com:19302']];
    if ($user === null) return $servers;
    $path = getenv('DISCORDO_VOICE_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-voice.php';
    if (!is_file($path)) return $servers;
    $config = require $path;
    $urls = $config['turn_urls'] ?? [];
    $secret = $config['turn_secret'] ?? '';
    if (!is_array($urls) || !$urls || !is_string($secret) || strlen($secret) < 24) {
        throw new RuntimeException('Invalid TURN configuration');
    }
    foreach ($urls as $url) {
        if (!is_string($url) || !preg_match('/\Aturns?:[^\s]+\z/', $url)) throw new RuntimeException('Invalid TURN URL');
    }
    $username = ($now + 86400) . ':' . $user;
    $servers[] = ['urls' => array_values($urls), 'username' => $username,
        'credential' => base64_encode(hash_hmac('sha1', $username, $secret, true))];
    return $servers;
}

function removeMember(array &$room, string $id, bool $transferred = false): void
{
    $wasKicked = !empty($room[$id]['kicked']);
    unset($room[$id]);
    if (!$wasKicked) broadcast($room, $id, ['type' => 'left', 'id' => $id, 'transferred' => $transferred]);
}

function moderationState(string $directory, int $server, int $user, ?string $field = null, bool|int $value = false,
    ?int $actor = null, bool $overrideSelf = false): array
{
    $path = "$directory/mod-$server-$user.json";
    if ($field === null && !is_file($path)) return [];
    $file = fopen($path, $field === null ? 'r' : 'c+');
    if (!$file) throw new RuntimeException('Could not open moderation state');
    try {
        if (!flock($file, $field === null ? LOCK_SH : LOCK_EX)) throw new RuntimeException('Could not lock moderation state');
        $state = json_decode(stream_get_contents($file), true) ?: [];
        if ($field !== null) {
            if ($actor === $user && !$overrideSelf && !empty($state[$field]) && ($state[$field . 'By'] ?? null) !== $actor) {
                throw new DomainException('Moderação aplicada por outra pessoa.');
            }
            $state[$field] = $value;
            $state[$field . 'By'] = $value ? $actor : null;
            $contents = json_encode($state, JSON_THROW_ON_ERROR);
            rewind($file);
            if (!ftruncate($file, 0) || fwrite($file, $contents) !== strlen($contents)) {
                throw new RuntimeException('Could not write moderation state');
            }
            fflush($file);
        }
        return $state;
    } finally {
        fclose($file);
    }
}

function updateModeration(array &$room, string $id, array $state): void
{
    $member = $room[$id]['member'];
    $member['serverMuted'] = !empty($state['serverMuted']);
    $member['serverDeafened'] = !empty($state['serverDeafened']);
    if ($member === $room[$id]['member']) return;
    $room[$id]['member'] = $member;
    $event = ['type' => 'state', 'member' => $member];
    broadcast($room, $id, $event);
    eventFor($room, $id, $event);
}

function punishmentEvent(int $until, int $now): array
{
    return ['type' => 'punished', 'seconds' => max(0, $until - $now)];
}

function markModerated(array &$room, string $id, string $reason, ?int $until = null): void
{
    if (empty($room[$id]['kicked'])) {
        $user = $room[$id]['user'] ?? null;
        $key = $reason === 'punished' ? 'punishedSoundUrl' : 'disconnectSoundUrl';
        $sound = $user === null ? null : (profileSoundUrls($user)[$key] ?? null);
        broadcast($room, $id, ['type' => 'left', 'id' => $id, 'moderation' => $reason, 'sound' => $sound]);
    }
    $room[$id]['kicked'] = true;
    if ($until !== null) $room[$id]['punishedUntil'] = $until;
}

function validDemoBots(mixed $bots): ?array
{
    if (!is_array($bots) || !array_is_list($bots)) return null;
    $validated = [];
    foreach ($bots as $bot) {
        $id = $bot['id'] ?? null;
        if (!is_string($id) || !preg_match('/\Ademo-bot-([1-9][0-9]{0,5})\z/', $id, $matches)
            || isset($validated[$id]) || !is_bool($bot['screen'] ?? null) || !is_bool($bot['camera'] ?? null)) return null;
        $validated[$id] = ['id' => $id, 'name' => 'Bot ' . $matches[1], 'screen' => $bot['screen'], 'camera' => $bot['camera']];
    }
    return array_values($validated);
}

function setDemoBots(array &$room, string $id, array $bots): void
{
    foreach ($room as &$entry) {
        if (isset($entry['demoBots'])) $entry['demoBots'] = $bots;
    }
    unset($entry);
    $room[$id]['demoBots'] = $bots;
    broadcast($room, $id, ['type' => 'demo', 'bots' => $bots]);
}

function demoWelcome(array $room, bool $demo, bool $demoHost): array
{
    if (!$demo) return [];
    foreach ($room as $entry) {
        if (empty($entry['kicked']) && isset($entry['demoBots'])) {
            return ['demoHost' => $demoHost, 'demoBots' => $entry['demoBots']];
        }
    }
    return ['demoHost' => $demoHost, 'demoBots' => []];
}

function applyMessage(array &$room, string $id, array $message, bool $audioOnly = false): void
{
    if (($message['type'] ?? null) === 'state' &&
        is_bool($message['muted'] ?? null) && is_bool($message['sharing'] ?? null)) {
        $room[$id]['member']['muted'] = $message['muted'];
        $room[$id]['member']['sharing'] = !$audioOnly && $message['sharing'];
        $room[$id]['member']['sharingAudio'] = !$audioOnly && $message['sharing'] && ($message['sharingAudio'] ?? false) === true;
        $room[$id]['member']['cameraOn'] = !empty($room[$id]['member']['cameraCapable']) && ($message['cameraOn'] ?? false) === true;
        $room[$id]['member']['deafened'] = ($message['deafened'] ?? false) === true;
        broadcast($room, $id, ['type' => 'state', 'member' => $room[$id]['member']]);
    }
    $to = $message['to'] ?? null;
    if (!is_string($to) || $to === $id || !isset($room[$to]) || !empty($room[$to]['kicked'])) return;
    $type = $message['type'] ?? null;
    if (!$audioOnly && $type === 'screen-subscription' && is_bool($message['watching'] ?? null)) {
        eventFor($room, $to, ['type' => 'screen-subscription', 'from' => $id, 'watching' => $message['watching']]);
        return;
    }
    if ($type !== 'signal') return;
    $description = $message['description'] ?? null;
    $candidate = $message['candidate'] ?? null;
    if (is_array($description) && in_array($description['type'] ?? null, ['offer', 'answer'], true) &&
        is_string($description['sdp'] ?? null) && strlen($description['sdp']) <= 32768) {
        if ($audioOnly && preg_match_all('/^m=(\S+)/m', $description['sdp'], $media) !== 1) return;
        if ($audioOnly && $media[1][0] !== 'audio') return;
        eventFor($room, $to, ['type' => 'signal', 'from' => $id, 'description' => $description]);
    } elseif (is_array($candidate) && is_string($candidate['candidate'] ?? null) &&
        strlen($candidate['candidate']) <= 2048 && strlen(json_encode($candidate)) <= 4096) {
        eventFor($room, $to, ['type' => 'signal', 'from' => $id, 'candidate' => $candidate]);
    }
}

function handle(array &$room, array $request, int $now, ?PDO $db, string $directory, ?int $server, ?int $user,
    ?int $userLimit = null, bool $demo = false, bool $demoHost = false): array
{
    foreach ($room as $id => $entry) {
        if ($now - $entry['seen'] > (!empty($entry['kicked']) ? KICK_TTL : ROOM_TTL)) {
            removeMember($room, $id);
        }
    }
    $type = $request['type'] ?? null;
    if ($type === 'join') {
        $state = $server !== null && $user !== null ? moderationState($directory, $server, $user) : [];
        $until = (int) ($state['punishedUntil'] ?? 0);
        if ($until > $now) return [punishmentEvent($until, $now), 200];
        $recovering = false;
        $previousId = $request['previousId'] ?? null;
        $previousToken = $request['previousToken'] ?? null;
        if (is_string($previousId) && is_string($previousToken) && isset($room[$previousId])
            && hash_equals($room[$previousId]['token'], hash('sha256', $previousToken))) {
            if (!empty($room[$previousId]['kicked']) && empty($room[$previousId]['punishedUntil'])) {
                return [['type' => 'disconnect'], 200];
            }
            $recovering = ($room[$previousId]['user'] ?? null) === $user && empty($room[$previousId]['kicked']);
            if (!$demo && ($room[$previousId]['user'] ?? null) === $user) removeMember($room, $previousId);
        }
        $joinId = $request['joinId'] ?? null;
        $joinToken = $request['joinToken'] ?? null;
        if ($joinId !== null && (!is_string($joinId) || !preg_match('/\A[a-f0-9-]{16,64}\z/', $joinId)
            || !is_string($joinToken) || !preg_match('/\A[a-f0-9]{48}\z/', $joinToken))) {
            return [['error' => 'request', 'code' => 'bad_request'], 400];
        }
        if ($joinId !== null) {
            foreach ($room as $id => $entry) {
                if (($entry['joinId'] ?? null) !== $joinId || ($entry['user'] ?? null) !== $user
                    || !hash_equals($entry['token'], hash('sha256', $joinToken))) continue;
                if (!empty($entry['punishedUntil'])) {
                    removeMember($room, $id);
                    break;
                }
                if (!empty($entry['kicked'])) return [['type' => 'disconnect'], 200];
                $room[$id]['seen'] = $now;
                $others = array_filter($room, static fn ($otherId) => $otherId !== $id && empty($room[$otherId]['kicked']), ARRAY_FILTER_USE_KEY);
                return [['type' => 'welcome', 'token' => $joinToken, 'self' => $entry['member'],
                    'members' => array_values(array_column($others, 'member')),
                    'iceServers' => voiceIceServers($user, $now)] + demoWelcome($room, $demo, $demoHost), 200];
            }
        }
        $name = is_string($request['name'] ?? null) ? trim($request['name']) : '';
        $direct = str_starts_with($request['room'], 'friend-');
        if ($direct) {
            foreach ($room as $entry) {
                if ($entry['user'] === $user) return [['type' => 'rejected', 'reason' => 'full', 'code' => 'full'], 200];
            }
        }
        $others = array_values(array_column(array_filter($room, static fn ($entry) => empty($entry['kicked'])), 'member'));
        $full = $userLimit !== null && count($others) >= $userLimit;
        if ($name === '' || strlen($name) > 160 || $full) {
            return [['type' => 'rejected', 'reason' => $full ? 'full' : 'invalid', 'code' => $full ? 'full' : 'bad_request'], 200];
        }
        if ($demo && !$demoHost && !$recovering) {
            if ($server === null || $user === null || ($state['demoUntil'] ?? 0) <= $now) {
                return [['error' => 'forbidden'], 403];
            }
            moderationState($directory, $server, $user, 'demoUntil', 0);
        }
        if ($demo && $recovering) {
            removeMember($room, $previousId);
            $others = array_values(array_filter($others, static fn ($member) => $member['id'] !== $previousId));
        }
        if ($demo) {
            $request['sharing'] = $request['screenAudioCapable'] = $request['cameraCapable'] = false;
        }
        $id = bin2hex(random_bytes(12));
        $token = $joinId !== null ? $joinToken : bin2hex(random_bytes(24));
        $member = ['id' => $id, 'name' => $name, 'muted' => ($request['muted'] ?? true) === true,
            'sharing' => ($request['sharing'] ?? false) === true, 'deafened' => ($request['deafened'] ?? false) === true,
            'sharingAudio' => ($request['sharing'] ?? false) === true && ($request['sharingAudio'] ?? false) === true,
            'screenAudioCapable' => ($request['screenAudioCapable'] ?? false) === true,
            'cameraCapable' => ($request['cameraCapable'] ?? false) === true,
            'cameraOn' => ($request['cameraCapable'] ?? false) === true && ($request['cameraOn'] ?? false) === true];
        if ($server !== null && $user !== null) {
            $member['userId'] = $user;
            $member += profileSoundUrls($user, roomOnly: true);
            $member['serverMuted'] = !empty($state['serverMuted']);
            $member['serverDeafened'] = !empty($state['serverDeafened']);
        }
        if ($direct) $member['userId'] = $user;
        broadcast($room, $id, ['type' => 'joined', 'member' => $member,
            'transferred' => $user !== null && ($request['transferred'] ?? false) === true]);
        $room[$id] = ['member' => $member, 'user' => $user,
            'token' => hash('sha256', $token), 'joinId' => $joinId, 'seen' => $now, 'events' => []];
        if ($demo && $demoHost && ($bots = validDemoBots($request['demoBots'] ?? null)) !== null) {
            setDemoBots($room, $id, $bots);
        }
        return [[
            'type' => 'welcome', 'token' => $token, 'self' => $member, 'members' => $others,
            'iceServers' => voiceIceServers($user, $now),
        ] + demoWelcome($room, $demo, $demoHost), 200];
    }
    $id = $request['id'] ?? null;
    if ($type === 'check-absence' && !$demo && $server !== null && $user !== null) {
        $sender = $request['sender'] ?? null;
        if (!is_string($sender) || ($room[$sender]['user'] ?? null) !== $user || !empty($room[$sender]['kicked'])) {
            return [['error' => 'member_access'], 409];
        }
        $target = is_string($id) && empty($room[$id]['kicked']) ? ($room[$id]['user'] ?? null) : null;
        if (!$target || $target === $user) return [['error' => 'member_access'], 409];
        $member = $room[$id]['member'];
        if (empty($member['muted']) && empty($member['deafened']) && empty($member['serverMuted']) && empty($member['serverDeafened'])) {
            return [['error' => 'not_muted'], 409];
        }
        $lastCheck = $room[$id]['lastAbsenceCheck'] ?? null;
        if ($lastCheck !== null && $now - $lastCheck < ABSENCE_CHECK_COOLDOWN) {
            return [['error' => 'absence_cooldown'], 429];
        }
        $room[$id]['lastAbsenceCheck'] = $now;
        eventFor($room, $id, ['type' => 'check-absence', 'senderName' => $room[$sender]['member']['name'], 'senderUser' => $user,
            'sound' => profileSoundUrls($user)['absenceSoundUrl']]);
        return [['ok' => true], 200];
    }
    if ($type === 'moderate' && $server !== null && $user !== null && $db !== null) {
        $target = is_string($id) && empty($room[$id]['kicked']) ? ($room[$id]['user'] ?? null) : null;
        if (!$target) return [['error' => 'member_access'], 409];
        $creator = isCreator($db, $user);
        if ($target !== $user && serverAdministrator($db, $server, $target) && !$creator) {
            return [['error' => 'forbidden'], 403];
        }
        if ($request['action'] === 'punish') {
            if ($target === $user) return [['error' => 'forbidden'], 403];
            $state = moderationState($directory, $server, $target, 'punishedUntil', $now + $request['duration'], $user);
            foreach ($room as $memberId => $entry) {
                if (($entry['user'] ?? null) === $target && empty($entry['kicked'])) {
                    markModerated($room, $memberId, 'punished', $state['punishedUntil']);
                }
            }
        } elseif ($request['action'] === 'disconnect') {
            markModerated($room, $id, 'disconnect');
        } else {
            try {
                $state = moderationState($directory, $server, $target, $request['action'], $request['enabled'], $user, $creator);
            } catch (DomainException $error) {
                return [['error' => 'moderated_by_other'], 403];
            }
            updateModeration($room, $id, $state);
        }
        return [['ok' => true], 200];
    }
    if ($type === 'move' && isset($request['demoDestination']) && $server !== null && $user !== null) {
        $targetUser = is_string($id) ? ($room[$id]['user'] ?? null) : null;
        if (!$targetUser || !empty($room[$id]['kicked'])) return [['error' => 'member_access'], 409];
        moderationState($directory, $server, $targetUser, 'demoUntil', $now + ROOM_TTL, $user, true);
        eventFor($room, $id, ['type' => 'move', 'room' => $request['demoDestination'], 'name' => DEMO_NAME]);
        return [['ok' => true], 200];
    }
    if ($type === 'move' && isset($request['destinationId']) && $db !== null) {
        $targetUser = is_string($id) ? ($room[$id]['user'] ?? null) : null;
        if (!$targetUser || !empty($room[$id]['kicked']) || !canUseVoice($db, (int) $targetUser, $request['destinationId'])) {
            return [['error' => 'member_access'], 409];
        }
        eventFor($room, $id, ['type' => 'move', 'room' => $request['destination'], 'name' => $request['destinationName']]);
        return [['ok' => true], 200];
    }
    $token = $request['token'] ?? null;
    if (!is_string($id) || !is_string($token)) return [['error' => 'request', 'code' => 'bad_request'], 400];
    if (!isset($room[$id])) return [['error' => 'session', 'code' => 'not_in_room'], 403];
    if (!hash_equals($room[$id]['token'], hash('sha256', $token))) return [['error' => 'session', 'code' => 'expired'], 403];
    if ($type === 'leave') {
        $transferred = ($request['transferred'] ?? false) === true;
        removeMember($room, $id, $transferred);
        return [['ok' => true], 200];
    }
    if ($type !== 'poll' || !is_array($request['messages'] ?? null)) {
        return [['error' => 'request'], 400];
    }
    if (str_starts_with($request['room'], 'friend-') && ($room[$id]['user'] ?? null) !== $user) {
        return [['error' => 'session'], 403];
    }
    if (!empty($room[$id]['kicked'])) {
        $event = isset($room[$id]['punishedUntil']) ? punishmentEvent($room[$id]['punishedUntil'], $now) : ['type' => 'disconnect'];
        return [['events' => [$event]], 200];
    }
    $state = [];
    if ($server !== null && $user !== null) {
        if (($room[$id]['user'] ?? null) !== $user) return [['error' => 'session'], 403];
        $state = moderationState($directory, $server, $user);
        $until = (int) ($state['punishedUntil'] ?? 0);
        if ($until > $now) {
            markModerated($room, $id, 'punished', $until);
            return [['events' => [punishmentEvent($until, $now)]], 200];
        }
    }
    $pollId = $request['pollId'] ?? null;
    if ($pollId !== null && (!is_string($pollId) || !preg_match('/\A[a-f0-9-]{16,64}\z/', $pollId))) {
        return [['error' => 'request', 'code' => 'bad_request'], 400];
    }
    if ($pollId !== null && ($room[$id]['lastPoll']['id'] ?? null) === $pollId) {
        if ($now - $room[$id]['seen'] >= HEARTBEAT_WRITE_INTERVAL) $room[$id]['seen'] = $now;
        return [$room[$id]['lastPoll']['response'], 200];
    }
    if ($server !== null && $user !== null) {
        $room[$id]['member']['userId'] = $user;
        updateModeration($room, $id, $state);
    }
    if ($now - $room[$id]['seen'] >= HEARTBEAT_WRITE_INTERVAL) {
        $room[$id]['seen'] = $now;
        if ($user !== null) {
            $member = array_replace($room[$id]['member'], profileSoundUrls($user, roomOnly: true));
            if ($member !== $room[$id]['member']) {
                $room[$id]['member'] = $member;
                broadcast($room, $id, ['type' => 'state', 'member' => $member]);
            }
        }
    }
    foreach (array_slice($request['messages'], 0, 12) as $message) {
        if (!is_array($message)) continue;
        if ($demo && ($message['type'] ?? null) === 'demo') {
            if ($demoHost && ($bots = validDemoBots($message['bots'] ?? null)) !== null) setDemoBots($room, $id, $bots);
            continue;
        }
        applyMessage($room, $id, $message, $demo);
    }
    $events = $room[$id]['events'];
    $room[$id]['events'] = [];
    $response = ['events' => $events];
    if ($pollId !== null) {
        $response['pollId'] = $pollId;
        if ($events !== [] || $request['messages'] !== []) {
            $room[$id]['lastPoll'] = ['id' => $pollId, 'response' => $response];
        } else {
            unset($room[$id]['lastPoll']);
        }
    }
    return [$response, 200];
}

if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) {
    reply(['error' => 'storage'], 503);
}
$file = @fopen($directory . '/' . $roomId . '.json', 'c+');
if (!$file || !flock($file, LOCK_EX)) {
    reply(['error' => 'storage'], 503);
}
try {
    if ($type === 'join' && signedInUser($db) !== $user) {
        reply(['error' => 'session', 'code' => 'unauthenticated'], 401);
    }
    $stored = stream_get_contents($file);
    $room = $stored === '' ? [] : json_decode($stored, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($room)) throw new RuntimeException('Invalid room state');
    $previous = $room;
    $userLimit = $direct ? 2 : (!$demo && $type === 'join' ? channelVoiceLimit((int) $match[1]) : null);
    [$data, $status] = handle($room, $request, time(), $db ?? null, $directory, $server, $user, $userLimit, $demo, $demoHost);
    if ($room !== $previous) {
        $contents = json_encode($room, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        rewind($file);
        if (!ftruncate($file, 0) || fwrite($file, $contents) !== strlen($contents)) {
            throw new RuntimeException('Could not write room state');
        }
        fflush($file);
    }
} catch (Throwable $error) {
    $data = ['error' => 'storage'];
    $status = 503;
} finally {
    flock($file, LOCK_UN);
    fclose($file);
}
reply($data, $status);
