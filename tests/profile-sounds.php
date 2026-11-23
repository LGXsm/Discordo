<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/profile-sounds.php';

function checkSound(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$bytes = stream_get_contents(STDIN);
$data = 'data:audio/mpeg;base64,' . base64_encode($bytes);
checkSound(decodeProfileSound($data) === $bytes, 'The browser encoder output was rejected.');
foreach ([
    'data:audio/wav;base64,' . base64_encode($bytes),
    'data:audio/mpeg;base64,' . base64_encode($bytes . $bytes),
    'data:audio/mpeg;base64,' . base64_encode('X' . substr($bytes, 1)),
] as $invalid) {
    try {
        decodeProfileSound($invalid);
        throw new RuntimeException('An invalid format or duration was accepted.');
    } catch (DomainException $error) {
        // Expected.
    }
}

$directory = tempnam(sys_get_temp_dir(), 'discordo-sounds-test-');
unlink($directory);
mkdir($directory, 0700);
$oldConfig = getenv('DISCORDO_DB_CONFIG');
putenv('DISCORDO_DB_CONFIG=' . $directory . '/config.php');
try {
    saveProfileSound(1, 'entrySound', $data);
    saveProfileSound(1, 'exitSound', $data);
    saveProfileSound(1, 'moveEntrySound', $data);
    saveProfileSound(1, 'moveExitSound', $data);
    saveProfileSound(1, 'punishedSound', $data);
    saveProfileSound(1, 'disconnectSound', $data);
    saveProfileSound(1, 'absenceSound', $data);
    $first = profileSoundFiles(1);
    checkSound(count(array_unique($first)) === 7, 'One sound overwrote the other.');
    checkSound(profileSoundUrls(1)['punishedSoundUrl'] === 'account.php?sound=' . $first['punishedSound']
        && profileSoundUrls(1)['disconnectSoundUrl'] === 'account.php?sound=' . $first['disconnectSound'],
        'Personal moderation sounds were not published to the profile.');
    checkSound(profileSoundUrls(1)['absenceSoundUrl'] === 'account.php?sound=' . $first['absenceSound']
        && !array_key_exists('absenceSoundUrl', profileSoundUrls(1, roomOnly: true)), 'Absence sound was not private.');
    checkSound(count(profileSoundUrls(1, roomOnly: true)) === 4, 'Personal moderation sounds leaked into the room.');
    checkSound(profileSoundUrls(1)['moveEntrySoundUrl'] === 'account.php?sound=' . $first['moveEntrySound'], 'Move entry URL was not published.');
    checkSound(profileSoundUrls(2)['entrySoundUrl'] === null, 'Sounds leaked to another profile.');
    checkSound(file_get_contents(profileSoundDirectory() . '/' . $first['entrySound']) === $bytes, 'Stored MP3 differs.');
    saveProfileSound(1, 'entrySound', $data);
    $second = profileSoundFiles(1);
    checkSound($second['entrySound'] !== $first['entrySound'], 'A saved sound reused a cached URL.');
    checkSound(!is_file(profileSoundDirectory() . '/' . $first['entrySound']), 'The replaced sound was left behind.');
    saveProfileSound(1, 'entrySound', null);
    checkSound(profileSoundUrls(1)['entrySoundUrl'] === null && profileSoundFiles(1)['exitSound'] === $first['exitSound'],
        'Removing an entry sound affected the exit sound.');
    checkSound(profileSoundFiles(1)['moveEntrySound'] === $first['moveEntrySound']
        && profileSoundFiles(1)['moveExitSound'] === $first['moveExitSound'], 'Removing a normal sound affected a move sound.');
} finally {
    foreach (glob(profileSoundDirectory() . '/*') as $file) unlink($file);
    rmdir(profileSoundDirectory());
    rmdir(profileMediaDirectory());
    rmdir($directory);
    putenv($oldConfig === false ? 'DISCORDO_DB_CONFIG' : 'DISCORDO_DB_CONFIG=' . $oldConfig);
}
echo "Profile sound format, duration, storage, and replacement checks passed\n";
