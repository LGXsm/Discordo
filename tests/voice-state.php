<?php
declare(strict_types=1);

// Exercise the production state machine with a controlled clock and no database fixtures.
require_once __DIR__ . '/../backend/src/server-access.php';
require_once __DIR__ . '/../backend/src/profile-sounds.php';
require_once __DIR__ . '/../backend/src/channel-voice-limit.php';
$source = file_get_contents(__DIR__ . '/../backend/src/voice.php');
$constants = strpos($source, 'const DEMO_ROOM');
eval(substr($source, $constants, strpos($source, 'function reply') - $constants));
$start = strpos($source, 'function eventFor');
eval(substr($source, $start, strpos($source, 'if (!is_dir($directory)') - $start));

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function joinTest(array &$room, int $now = 1000, array $extra = [], ?int $limit = null): array {
    return handle($room, ['type' => 'join', 'name' => 'Player', ...$extra], $now, null, '', null, null, $limit)[0];
}

$unlimited = [];
for ($index = 0; $index < 8; $index++) {
    check(joinTest($unlimited)['type'] === 'welcome', 'Unlimited room rejected a participant');
}
$limited = [];
$first = joinTest($limited, limit: 2);
check(joinTest($limited, limit: 2)['type'] === 'welcome', 'Configured capacity rejected the last available slot');
check(joinTest($limited, limit: 2)['reason'] === 'full', 'Configured capacity admitted too many participants');
$limited[$first['self']['id']]['kicked'] = true;
check(joinTest($limited, limit: 2)['type'] === 'welcome', 'A removed participant still occupied a slot');
check(joinTest($limited, 1091, limit: 2)['type'] === 'welcome', 'Expired participants still occupied slots');

$limitDirectory = tempnam(sys_get_temp_dir(), 'discordo-limit-test-');
unlink($limitDirectory);
mkdir($limitDirectory, 0700);
$previousLimitConfig = getenv('DISCORDO_DB_CONFIG');
putenv('DISCORDO_DB_CONFIG=' . $limitDirectory . '/config.php');
try {
    check(channelVoiceLimit(1) === null, 'An existing channel should default to unlimited');
    saveChannelVoiceLimit(1, 12);
    check(channelVoiceLimit(1) === 12 && channelVoiceLimit(2) === null, 'Capacity was not stored per channel');
    saveChannelVoiceLimit(1, null);
    check(channelVoiceLimit(1) === null, 'Disabling the limit did not restore unlimited capacity');
    foreach ([0, -1, '3', 2.5] as $invalid) {
        try {
            validateVoiceLimit($invalid);
            throw new RuntimeException('Invalid capacity was accepted');
        } catch (DomainException) {
            // Expected.
        }
    }
} finally {
    if (is_file(voiceLimitPath(1))) unlink(voiceLimitPath(1));
    if (is_dir(dirname(voiceLimitPath(1)))) rmdir(dirname(voiceLimitPath(1)));
    rmdir($limitDirectory);
    putenv($previousLimitConfig === false ? 'DISCORDO_DB_CONFIG' : 'DISCORDO_DB_CONFIG=' . $previousLimitConfig);
}
function pollTest(array &$room, array $member, int $now = 1000, array $extra = []): array {
    return handle($room, ['type' => 'poll', 'id' => $member['self']['id'], 'token' => $member['token'],
        'messages' => [], ...$extra], $now, null, '', null, null);
}

$room = [];
$a = joinTest($room);
$b = joinTest($room);
[$response, $status] = pollTest($room, $a, 1089);
check($status === 200 && count($response['events']) === 1, 'Delayed heartbeat lost the queued join event');
[$response] = pollTest($room, $a, 1091);
check(isset($room[$a['self']['id']]), 'Active member was pruned after a delayed poll');

$room = [];
$a = joinTest($room);
[$response, $status] = pollTest($room, $a, 1091);
check($status === 403 && $response['code'] === 'not_in_room', 'Expired membership needs a recoverable error code');

$room = [];
$a = joinTest($room);
$b = joinTest($room);
$batch = ['pollId' => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'messages' => [
    ['type' => 'signal', 'to' => $b['self']['id'], 'description' => ['type' => 'offer', 'sdp' => 'test']],
]];
[$first] = pollTest($room, $a, 1001, $batch);
[$retry] = pollTest($room, $a, 1002, $batch);
check($first === $retry && count($first['events']) === 1, 'Lost response could not be replayed');
check(count($room[$b['self']['id']]['events']) === 1, 'Retried batch duplicated its offer');
[$events] = pollTest($room, $b, 1002);
check(count($events['events']) === 1, 'Signaling was lost');

$subscription = ['type' => 'screen-subscription', 'to' => $b['self']['id'], 'watching' => false];
applyMessage($room, $a['self']['id'], $subscription, true);
applyMessage($room, $a['self']['id'], array_replace($subscription, ['watching' => 'false']));
check($room[$b['self']['id']]['events'] === [], 'Invalid subscriptions leaked through signaling');
applyMessage($room, $a['self']['id'], $subscription + ['from' => 'forged']);
check($room[$b['self']['id']]['events'] === [['type' => 'screen-subscription', 'from' => $a['self']['id'], 'watching' => false]]
    && $room[$a['self']['id']]['events'] === [], 'Screen subscription was not confined to the requested peer');

$room[$a['self']['id']]['kicked'] = true;
[$first] = pollTest($room, $a, 1003);
[$retry] = pollTest($room, $a, 1004);
check($first['events'][0]['type'] === 'disconnect' && $first === $retry, 'A lost kick response must remain a kick');

$room = [];
$a = joinTest($room);
$before = $room;
pollTest($room, $a, 1001, ['pollId' => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
check($before === $room, 'Idle polls should not rewrite unchanged room state');

$room = [];
$identity = ['joinId' => 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'joinToken' => str_repeat('a', 48),
    'muted' => false, 'deafened' => true];
$a = joinTest($room, 1000, $identity);
$retry = joinTest($room, 1001, $identity);
check(count($room) === 1 && $a['self']['id'] === $retry['self']['id'], 'Lost join response duplicated membership');
check(!$retry['self']['muted'] && $retry['self']['deafened'], 'Join lost the microphone/headphone state');
$room[$a['self']['id']]['kicked'] = true;
$recovery = joinTest($room, 1002, ['previousId' => $a['self']['id'], 'previousToken' => $a['token']]);
check($recovery['type'] === 'disconnect', 'Rejoining bypassed administrative disconnect');

$directory = tempnam(sys_get_temp_dir(), 'discordo-punishment-test-');
unlink($directory);
mkdir($directory, 0700);
$previousDbConfig = getenv('DISCORDO_DB_CONFIG');
putenv('DISCORDO_DB_CONFIG=' . $directory . '/db.php');
try {
    mkdir(profileMediaDirectory(), 0700);
    mkdir(profileSoundDirectory(), 0700);
    $punishmentClip = str_repeat('a', 32) . '.mp3';
    $disconnectClip = str_repeat('b', 32) . '.mp3';
    $recipientAbsenceClip = str_repeat('c', 32) . '.mp3';
    $callerAbsenceClip = str_repeat('d', 32) . '.mp3';
    file_put_contents(profileSoundDirectory() . '/20.json', json_encode([
        'punishedSound' => $punishmentClip, 'disconnectSound' => $disconnectClip, 'absenceSound' => $recipientAbsenceClip,
    ], JSON_THROW_ON_ERROR));
    $room = [];
    $otherRoom = [];
    $target = handle($room, ['type' => 'join', 'name' => 'Target'], 1000, null, $directory, 4, 20)[0];
    $observer = joinTest($room);
    $other = handle($otherRoom, ['type' => 'join', 'name' => 'Target'], 1000, null, $directory, 4, 20)[0];
    $unrelated = joinTest($otherRoom);
    check(!isset($target['self']['punishedSoundUrl']), 'Personal audio appeared in room membership');
    $db = new class extends PDO {
        public function __construct() {}
        public function prepare(string $query, array $options = []): PDOStatement|false {
            return new class extends PDOStatement {
                public function execute(?array $params = null): bool { return true; }
                public function fetchColumn(int $column = 0): mixed { return false; }
            };
        }
    };
    $punish = ['type' => 'moderate', 'action' => 'punish', 'id' => $target['self']['id'], 'duration' => 30];
    [, $status] = handle($room, $punish, 1001, $db, $directory, 4, 20);
    check($status === 403, 'A participant could punish themself');
    [, $status] = handle($room, $punish, 1001, $db, $directory, 4, 21);
    check($status === 200, 'Punishment was not applied');
    [$response] = pollTest($room, $observer, 1002);
    check($response['events'] === [['type' => 'left', 'id' => $target['self']['id'], 'moderation' => 'punished',
        'sound' => 'account.php?sound=' . $punishmentClip]], 'The room did not receive the punishment sound');
    check(pollTest($otherRoom, $unrelated, 1002)[0]['events'] === [], 'The punishment leaked into another room');
    $late = joinTest($room, 1002);
    check(pollTest($room, $late, 1003)[0]['events'] === [], 'The punishment played to a late arrival');
    [$response] = pollTest($room, $target, 1002);
    check($response['events'] === [['type' => 'punished', 'seconds' => 29]], 'Punished peer did not receive remaining time');
    [$response] = handle($otherRoom, ['type' => 'poll', 'id' => $other['self']['id'], 'token' => $other['token'],
        'messages' => []], 1002, null, $directory, 4, 20);
    check($response['events'][0]['type'] === 'punished', 'Punished peer stayed connected in another channel');
    $join = ['type' => 'join', 'name' => 'Target'];
    check(handle($otherRoom, $join, 1030, null, $directory, 4, 20)[0] === ['type' => 'punished', 'seconds' => 1],
        'Another channel bypassed the punishment');
    check(handle($otherRoom, $join, 1030, null, $directory, 5, 20)[0]['type'] === 'welcome', 'Punishment affected another server');
    $returned = handle($otherRoom, $join, 1031, null, $directory, 4, 20)[0];
    check($returned['type'] === 'welcome', 'Punishment did not expire');
    pollTest($otherRoom, $unrelated, 1031);
    handle($otherRoom, ['type' => 'moderate', 'action' => 'disconnect', 'id' => $returned['self']['id']],
        1032, $db, $directory, 4, 21);
    check(pollTest($otherRoom, $unrelated, 1033)[0]['events'] === [['type' => 'left', 'id' => $returned['self']['id'],
        'moderation' => 'disconnect', 'sound' => 'account.php?sound=' . $disconnectClip]], 'The room did not receive the disconnect sound');
    check(pollTest($otherRoom, $returned, 1033)[0]['events'] === [['type' => 'disconnect']], 'The disconnected member received the room sound');

    $sourceRoom = [];
    $moved = joinTest($sourceRoom);
    $listener = joinTest($sourceRoom);
    handle($sourceRoom, ['type' => 'leave', 'id' => $moved['self']['id'], 'token' => $moved['token'],
        'transferred' => true], 1001, null, $directory, null, null);
    check(pollTest($sourceRoom, $listener, 1002)[0]['events'][0]['transferred'], 'Move exit lost its transfer flag');
    $destinationRoom = [];
    $listener = joinTest($destinationRoom);
    handle($destinationRoom, ['type' => 'join', 'name' => 'Target', 'transferred' => true], 1001, null, $directory, 4, 22);
    check(pollTest($destinationRoom, $listener, 1002)[0]['events'][0]['transferred'], 'Move entry lost its transfer flag');


    file_put_contents(profileSoundDirectory() . '/30.json', json_encode([
        'absenceSound' => $callerAbsenceClip,
    ], JSON_THROW_ON_ERROR));
    $absenceRoom = [];
    $caller = handle($absenceRoom, ['type' => 'join', 'name' => 'Caller'], 1000, null, $directory, 6, 30)[0];
    $recipient = handle($absenceRoom, ['type' => 'join', 'name' => 'Recipient', 'muted' => false], 1000,
        null, $directory, 6, 20)[0];
    $bystander = joinTest($absenceRoom);
    $callerId = $caller['self']['id'];
    $recipientId = $recipient['self']['id'];
    $absenceRoom[$callerId]['events'] = $absenceRoom[$recipientId]['events'] = [];
    $check = ['type' => 'check-absence', 'sender' => $callerId, 'id' => $recipientId];
    check(handle($absenceRoom, $check, 1040, null, $directory, 6, 31)[1] === 409,
        'A caller outside the room could send an alert');
    check(handle($absenceRoom, $check, 1040, null, $directory, 6, 30)[0]['error'] === 'not_muted',
        'An active microphone could receive an alert');
    $state = moderationState($directory, 6, 20, 'serverMuted', true, 30);
    updateModeration($absenceRoom, $recipientId, $state);
    foreach ($absenceRoom as &$entry) $entry['events'] = [];
    unset($entry);
    check(handle($absenceRoom, array_replace($check, ['id' => $callerId]), 1040, null, $directory, 6, 30)[1] === 409,
        'The caller could alert their own account');
    check(handle($absenceRoom, $check, 1040, null, $directory, 6, 30)[1] === 200, 'Alert was not sent');
    check($absenceRoom[$recipientId]['events'] === [['type' => 'check-absence', 'senderName' => 'Caller', 'senderUser' => 30,
        'sound' => 'account.php?sound=' . $callerAbsenceClip]], 'Recipient did not receive the caller’s recording privately');
    check($absenceRoom[$callerId]['events'] === [] && $absenceRoom[$bystander['self']['id']]['events'] === [],
        'An absence alert leaked to the sender or a bystander');
    check(handle($absenceRoom, $check, 1041, null, $directory, 6, 30)[1] === 429, 'Repeated alerts were not throttled');
    moderationState($directory, 6, 20, 'serverMuted', false, 30);
    $state = moderationState($directory, 6, 20, 'serverDeafened', true, 30);
    updateModeration($absenceRoom, $recipientId, $state);
    $absenceRoom[$recipientId]['events'] = [];
    check(handle($absenceRoom, $check, 1060, null, $directory, 6, 30)[1] === 200, 'Alert did not reach a server-deafened user after cooldown');
    [$recipientPoll] = handle($absenceRoom, ['type' => 'poll', 'id' => $recipientId, 'token' => $recipient['token'],
        'messages' => []], 1060, null, $directory, 6, 20);
    check(array_column($recipientPoll['events'], 'type') === ['check-absence'], 'Server-deafened recipient did not receive the alert');
    $state = moderationState($directory, 6, 20, 'serverDeafened', false, 30);
    updateModeration($absenceRoom, $recipientId, $state);
    applyMessage($absenceRoom, $recipientId, ['type' => 'state', 'muted' => false, 'deafened' => true, 'sharing' => false]);
    $absenceRoom[$recipientId]['events'] = [];
    unlink(profileSoundDirectory() . '/30.json');
    check(handle($absenceRoom, $check, 1080, null, $directory, 6, 30)[1] === 200, 'Alert was rejected when the recipient silenced their own headphones');
    [$recipientPoll] = handle($absenceRoom, ['type' => 'poll', 'id' => $recipientId, 'token' => $recipient['token'],
        'messages' => []], 1080, null, $directory, 6, 20);
    check($recipientPoll['events'] === [['type' => 'check-absence', 'senderName' => 'Caller', 'senderUser' => 30, 'sound' => null]]
        && $absenceRoom[$recipientId]['member']['deafened'],
        'Without a caller recording, the alert must use the default sound and preserve the recipient headphone state');
    $lobbyRoom = [];
    [$lobbyCaller] = handle($lobbyRoom, ['type' => 'join', 'name' => 'Recipient'], 1080, null, $directory, 1, 20);
    [$lobbyTarget] = handle($lobbyRoom, ['type' => 'join', 'name' => 'Caller'], 1080, null, $directory, 1, 30);
    $lobbyTargetId = $lobbyTarget['self']['id'];
    handle($lobbyRoom, ['type' => 'check-absence', 'sender' => $lobbyCaller['self']['id'], 'id' => $lobbyTargetId],
        1081, null, $directory, 1, 20);
    check($lobbyRoom[$lobbyTargetId]['events'] === [['type' => 'check-absence', 'senderName' => 'Recipient', 'senderUser' => 20,
        'sound' => 'account.php?sound=' . $recipientAbsenceClip]] && $absenceRoom[$recipientId]['events'] === [],
        'When the participants swap roles, the opposite recording must play and stay in the correct room');

    $videoRoom = [];
    $viewer = joinTest($videoRoom);
    $publisher = joinTest($videoRoom, extra: ['cameraCapable' => true, 'screenAudioCapable' => true]);
    check($publisher['self']['cameraCapable'] && !$publisher['self']['cameraOn'], 'Camera defaults were lost at join');
    pollTest($videoRoom, $viewer, 1001);
    applyMessage($videoRoom, $publisher['self']['id'], ['type' => 'state', 'muted' => false, 'sharing' => true,
        'sharingAudio' => true, 'cameraOn' => true]);
    $videoState = pollTest($videoRoom, $viewer, 1002)[0]['events'][0]['member'];
    check($videoState['sharing'] && $videoState['sharingAudio'] && $videoState['cameraOn'], 'Camera and screen did not coexist in broadcast state');
    applyMessage($videoRoom, $publisher['self']['id'], ['type' => 'state', 'muted' => false, 'sharing' => true,
        'sharingAudio' => true, 'cameraOn' => false]);
    $videoState = pollTest($videoRoom, $viewer, 1003)[0]['events'][0]['member'];
    check($videoState['sharing'] && $videoState['sharingAudio'] && !$videoState['cameraOn'], 'Disabling camera changed screen state');
} finally {
    foreach (glob(profileSoundDirectory() . '/*.json') as $file) unlink($file);
    rmdir(profileSoundDirectory());
    rmdir(profileMediaDirectory());
    putenv($previousDbConfig === false ? 'DISCORDO_DB_CONFIG' : 'DISCORDO_DB_CONFIG=' . $previousDbConfig);
    foreach (glob($directory . '/*') as $file) unlink($file);
    rmdir($directory);
}

$config = tempnam(sys_get_temp_dir(), 'discordo-turn-test-');
$oldConfig = getenv('DISCORDO_VOICE_CONFIG');
$secret = bin2hex(random_bytes(24));
file_put_contents($config, '<?php return ' . var_export(['turn_urls' => ['turn:relay.example.test:3478'], 'turn_secret' => $secret], true) . ';');
putenv('DISCORDO_VOICE_CONFIG=' . $config);
try {
    check(count(voiceIceServers(null, 1000)) === 1, 'TURN credentials must not be given to anonymous rooms');
    $turn = voiceIceServers(123, 1000)[1];
    check($turn['username'] === '87400:123', 'TURN credential is missing its expiry');
    check($turn['credential'] === base64_encode(hash_hmac('sha1', $turn['username'], $secret, true)), 'TURN signature is invalid');
} finally {
    putenv($oldConfig === false ? 'DISCORDO_VOICE_CONFIG' : 'DISCORDO_VOICE_CONFIG=' . $oldConfig);
    unlink($config);
}

$demoDirectory = tempnam(sys_get_temp_dir(), 'discordo-demo-test-');
unlink($demoDirectory);
mkdir($demoDirectory, 0700);
try {
    $demo = $sourceRoom = [];
    $bot = ['id' => 'demo-bot-1', 'name' => 'Bot 1', 'screen' => true, 'camera' => true];
    $joinDemo = ['type' => 'join', 'name' => 'Guest', 'cameraCapable' => true, 'cameraOn' => true,
        'screenAudioCapable' => true, 'sharing' => true, 'sharingAudio' => true,
        'joinId' => str_repeat('a', 16), 'joinToken' => str_repeat('b', 48)];
    [$host] = handle($demo, ['type' => 'join', 'name' => 'Creator', 'demoBots' => [$bot]], 1000,
        null, $demoDirectory, 1, 1, demo: true, demoHost: true);
    check($host['demoHost'] && $host['demoBots'] === [$bot], 'Creator did not start the test room with bots');
    [, $status] = handle($demo, $joinDemo, 1000, null, $demoDirectory, 1, 2, demo: true);
    check($status === 403, 'A guest entered without being moved');
    [$sourceGuest] = handle($sourceRoom, $joinDemo, 1000, null, $demoDirectory, 1, 2);
    $transfer = ['type' => 'move', 'id' => $sourceGuest['self']['id'], 'demoDestination' => DEMO_ROOM];
    [, $status] = handle($sourceRoom, $transfer, 1001, null, $demoDirectory, 1, 1);
    check($status === 200 && $sourceRoom[$transfer['id']]['events'][0]['room'] === DEMO_ROOM, 'Moving a guest did not invite them');
    [, $status] = handle($demo, $joinDemo, 1001, null, $demoDirectory, 1, 3, demo: true);
    check($status === 403, 'The invitation was available to the wrong account');
    [$guest] = handle($demo, $joinDemo, 1002, null, $demoDirectory, 1, 2, demo: true);
    check($guest['type'] === 'welcome' && !$guest['demoHost'] && $guest['demoBots'] === [$bot], 'Guest did not receive the current simulation');
    check(!$guest['self']['cameraOn'] && !$guest['self']['sharing'] && !$guest['self']['sharingAudio'], 'Guest could publish their own video');
    [$retry] = handle($demo, $joinDemo, 1003, null, $demoDirectory, 1, 2, demo: true);
    check($retry['self']['id'] === $guest['self']['id'], 'An invitation could not recover a lost join response');

    $sendDemo = static function (array $identity, int $user, array $messages = []) use (&$demo, $demoDirectory): array {
        return handle($demo, ['type' => 'poll', 'id' => $identity['self']['id'], 'token' => $identity['token'],
            'messages' => $messages], 1004, null, $demoDirectory, 1, $user, demo: true, demoHost: $user === 1)[0]['events'];
    };
    $changed = array_replace($bot, ['camera' => false]);
    $audioOffer = ['type' => 'signal', 'to' => $host['self']['id'],
        'description' => ['type' => 'offer', 'sdp' => "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"]];
    $videoOffer = $audioOffer;
    $videoOffer['description']['sdp'] .= "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
    $sendDemo($guest, 2, [
        ['type' => 'demo', 'bots' => []], $videoOffer, $audioOffer,
        ['type' => 'state', 'muted' => false, 'sharing' => true, 'cameraOn' => true, 'sharingAudio' => true],
    ]);
    $events = $sendDemo($host, 1, [['type' => 'demo', 'bots' => [$changed]]]);
    check(array_column($events, 'type') === ['joined', 'signal', 'state'] && $events[1]['description'] === $audioOffer['description'],
        'A guest could edit bots or send video signaling, or audio signaling was lost');
    check(!$events[2]['member']['muted'] && !$events[2]['member']['sharing'], 'Guest mute state did not stay audio-only');
    check($sendDemo($guest, 2) === [['type' => 'demo', 'bots' => [$changed]]], 'Guest did not receive an edit');
    handle($demo, ['type' => 'leave', 'id' => $guest['self']['id'], 'token' => $guest['token']],
        1005, null, $demoDirectory, null, null, demo: true);
    [, $status] = handle($demo, $joinDemo, 1006, null, $demoDirectory, 1, 2, demo: true);
    check($status === 403, 'The guest could reuse an invitation after leaving');

    $catalog = new class extends PDO {
        public function __construct() {}
        public function prepare(string $query, array $options = []): PDOStatement|false {
            return new class($query) extends PDOStatement {
                private array $parameters;
                public function __construct(private string $query) {}
                public function execute(?array $params = null): bool { $this->parameters = $params ?? []; return true; }
                public function fetchColumn(int $column = 0): mixed {
                    return match ($this->parameters[0] ?? null) {
                        null => str_contains($this->query, 'srv_entrada = 1') ? 1 : false,
                        1 => 1,
                        29 => 0,
                        default => false,
                    };
                }
            };
        }
    };
    $guildRoom = demoRoomForServer($catalog, 29);
    check($guildRoom === 'video-demo-29' && demoServer($catalog, $guildRoom) === 29,
        'A user-created server did not get its own demo room');
    check(demoRoomForServer($catalog, 1) === DEMO_ROOM && demoServer($catalog, DEMO_ROOM) === 1
        && demoServer($catalog, 'video-demo-1') === 0 && demoServer($catalog, 'video-demo-99') === 0,
        'Lobby alias, duplicate rooms, or nonexistent room mappings were wrong');
    check(!isDemoRoom('video-demo-29/../local-video-demo'), 'Invalid demo room identifier was accepted');

    $guildSource = $guildDemo = [];
    [$guildGuest] = handle($guildSource, $joinDemo, 1010, null, $demoDirectory, 29, 2);
    $guildTransfer = ['type' => 'move', 'id' => $guildGuest['self']['id'], 'demoDestination' => $guildRoom];
    handle($guildSource, $guildTransfer, 1011, null, $demoDirectory, 29, 1);
    check($guildSource[$guildTransfer['id']]['events'][0]['room'] === $guildRoom, 'The guild guest was directed to the lobby');
    [, $status] = handle($demo, $joinDemo, 1012, null, $demoDirectory, 1, 2, demo: true);
    check($status === 403, 'The guild invitation granted access to the lobby demo');
    [$guest] = handle($guildDemo, $joinDemo, 1012, null, $demoDirectory, 29, 2, demo: true);
    check($guest['type'] === 'welcome' && $guest['demoBots'] === [], 'The guild demo copied the lobby bots or could not admit a guest');
} finally {
    foreach (glob($demoDirectory . '/*') as $file) unlink($file);
    rmdir($demoDirectory);
}
echo "Voice state regression checks passed\n";
