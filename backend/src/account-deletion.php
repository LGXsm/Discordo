<?php
declare(strict_types=1);

require_once __DIR__ . '/account-settings.php';

require_once __DIR__ . '/server-access.php';
require_once __DIR__ . '/chat-media.php';
require_once __DIR__ . '/channel-voice-limit.php';
require_once __DIR__ . '/role-order.php';

function deleteAccountRecords(PDO $db, int $user): array
{
    // Locks also serialize channel writes and server membership changes.
    $servers = query($db, 'SELECT srv_id AS id, Usuario_usr_id_Proprietario AS owner, srv_entrada AS lobby,
        srv_imagem_caminho AS image FROM Servidor WHERE Usuario_usr_id_Proprietario = ? OR srv_id IN
        (SELECT Servidor_srv_id FROM MembroServidor WHERE Usuario_usr_id = ?) ORDER BY srv_id FOR UPDATE',
        [$user, $user])->fetchAll();
    $deletedServers = [];
    foreach ($servers as $server) {
        if ((int) $server['owner'] !== $user) continue;
        $id = (int) $server['id'];
        $shared = query($db, 'SELECT 1 FROM MembroServidor WHERE Servidor_srv_id = ? AND Usuario_usr_id <> ? LIMIT 1',
            [$id, $user])->fetchColumn();
        if ($shared || $server['lobby']) {
            query($db, 'UPDATE Servidor SET Usuario_usr_id_Proprietario = NULL WHERE srv_id = ?', [$id]);
        } else {
            $deletedServers[] = deleteServerRecords($db, $id, $server['image']);
        }
    }

    $media = query($db, 'SELECT msg.msg_video_caminho FROM Mensagem msg JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
        WHERE m.Usuario_usr_id = ? AND msg.msg_video_caminho IS NOT NULL', [$user])->fetchAll(PDO::FETCH_COLUMN);
    query($db, 'DELETE p FROM GameplayParticipante p JOIN Gameplay g ON g.gpl_id = p.Gameplay_gpl_id
        JOIN Mensagem msg ON msg.msg_id = g.Mensagem_msg_id JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
        WHERE m.Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE p FROM GameplayParticipante p JOIN MembroServidor m ON m.mbs_id = p.MembroServidor_mbs_id
        WHERE m.Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE g FROM Gameplay g JOIN Mensagem msg ON msg.msg_id = g.Mensagem_msg_id
        JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id WHERE m.Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE msg FROM Mensagem msg JOIN MembroServidor m ON m.mbs_id = msg.MembroServidor_mbs_id
        WHERE m.Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE mc FROM MembroCargo mc JOIN MembroServidor m ON m.mbs_id = mc.MembroServidor_mbs_id
        WHERE m.Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE FROM MembroServidor WHERE Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE FROM CriadorPlataforma WHERE Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE FROM Sessao WHERE Usuario_usr_id = ?', [$user]);
    query($db, 'DELETE FROM Usuario WHERE usr_id = ?', [$user]);
    return ['media' => $media, 'servers' => $deletedServers];
}

function confirmAccountDeletion(PDO $db, ?string $session, string $email, string $password): array
{
    if ($session === null) throw new VerificationError('Entre novamente para excluir a conta.', 401);
    if (!preg_match('/\A.{8,128}\z/us', $password)) throw new VerificationError('Digite a senha da sua conta.', 422);
    $db->beginTransaction();
    $account = query($db, 'SELECT usr_id, usr_email, usr_senha_hash, ' . PROFILE_MEDIA_COLUMNS . '
        FROM Sessao JOIN Usuario ON usr_id = Usuario_usr_id WHERE ses_token_hash = ? FOR UPDATE', [$session])->fetch();
    if (!$account || $account['usr_email'] !== $email) {
        throw new VerificationError('A sessão mudou. Abra as configurações novamente.', 401);
    }
    $user = (int) $account['usr_id'];
    verificationState(static function (array &$state, int $now) use ($user) {
        if (!verificationLimit($state, 'delete-account:' . $user, 5, $now, 300)) {
            return new VerificationError('Muitas tentativas. Aguarde alguns minutos.', 429);
        }
    });
    if (!password_verify(hash('sha256', $password), $account['usr_senha_hash'])) {
        throw new VerificationError('A senha não confere.', 422);
    }
    $files = deleteAccountRecords($db, $user);
    $db->commit();
    return [$account, $files];
}

function purgeAccountVerification(int $user, string $email): void
{
    verificationState(static function (array &$state) use ($user, $email) {
        foreach ($state['challenges'] as $key => $challenge) {
            if (($challenge['details']['email'] ?? null) === $email || ($challenge['details']['userId'] ?? null) === $user) {
                unset($state['challenges'][$key]);
            }
        }
        $recipient = 'email:' . hash('sha256', $email);
        unset($state['limits'][$recipient], $state['limits']['recent:' . $recipient], $state['limits']['delete-account:' . $user], $state['limits']['account-settings:' . $user]);
    });
}

function purgeDeletedRoomParticipant(array $room, int $user): array
{
    $removed = [];
    foreach ($room as $id => $entry) {
        if (($entry['user'] ?? null) === $user) {
            unset($room[$id]);
            if (empty($entry['kicked'])) $removed[$id] = true;
        }
    }
    $keep = static fn ($event) => ($event['member']['userId'] ?? null) !== $user
        && !isset($removed[$event['from'] ?? ''])
        && ($event['senderUser'] ?? null) !== $user;
    foreach ($room as &$entry) {
        $entry['events'] = array_values(array_filter($entry['events'] ?? [], $keep));
        if (isset($entry['lastPoll']['response']['events'])) {
            $entry['lastPoll']['response']['events'] = array_values(array_filter($entry['lastPoll']['response']['events'], $keep));
        }
        if (!empty($entry['kicked'])) continue;
        foreach (array_keys($removed) as $id) $entry['events'][] = ['type' => 'left', 'id' => $id];
        $entry['events'] = array_slice($entry['events'], -96);
    }
    unset($entry);
    return $room;
}

function purgeAccountVoice(int $user): void
{
    foreach (glob(voiceStateDirectory() . '/*.json') ?: [] as $path) {
        $basename = basename($path);
        if (!preg_match('/\A(?:(?:channel|video-demo|friend)-[1-9][0-9]*|local-video-demo|mod-[1-9][0-9]*-[1-9][0-9]*)\.json\z/', $basename)) continue;
        if (str_starts_with($basename, 'mod-') && str_ends_with($basename, "-$user.json")) {
            @unlink($path);
            continue;
        }
        $file = @fopen($path, 'r+');
        if (!$file) continue;
        try {
            if (!flock($file, LOCK_EX)) continue;
            $original = json_decode(stream_get_contents($file), true);
            if (!is_array($original)) continue;
            if (str_starts_with($basename, 'mod-')) {
                $state = $original;
                foreach (['serverMutedBy', 'serverDeafenedBy', 'punishedUntilBy', 'demoUntilBy'] as $field) {
                    if (($state[$field] ?? null) === $user) unset($state[$field]);
                }
            } else {
                $state = purgeDeletedRoomParticipant($original, $user);
            }
            if ($state === $original) continue;
            $contents = json_encode($state, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
            rewind($file);
            if (fwrite($file, $contents) !== strlen($contents) || !ftruncate($file, strlen($contents))) {
                error_log('Discordo: falha ao limpar estado de voz na exclusão de conta.');
            }
        } finally {
            fclose($file);
        }
    }
}

function removeDeletedAccountFiles(array $account, array $files): void
{
    $user = (int) $account['usr_id'];
    removeProfileMedia($account['avatarPath'], true);
    removeProfileMedia($account['bannerPath'], false);
    foreach (profileSoundFiles($user) as $path) {
        if (profileSoundPath($path)) @unlink(profileSoundDirectory() . '/' . $path);
    }
    @unlink(profileSoundDirectory() . "/$user.json");
    @unlink(profileSoundDirectory() . "/$user.lock");
    @unlink(profileAppearanceDirectory() . "/$user.json");
    @unlink(accountPhonePath($user));
    @unlink(voiceStateDirectory() . "/available-$user");
    foreach ($files['media'] as $name) {
        if ($file = chatMediaPath($name)) @unlink($file);
    }
    foreach ($files['servers'] as $server) removeDeletedServerFiles($server);
    purgeAccountVerification($user, $account['usr_email']);
    purgeAccountVoice($user);
}

