<?php
declare(strict_types=1);
require_once __DIR__ . '/../backend/src/channel-layout.php';
function expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function rejects(callable $action, int $status): void {
    try { $action(); } catch (DomainException $error) { expect($error->getCode() === $status, 'Wrong status'); return; }
    throw new RuntimeException('Invalid organization was accepted');
}
$directory = sys_get_temp_dir() . '/discordo-categories-' . bin2hex(random_bytes(8));
mkdir($directory);
$previous = getenv('DISCORDO_DB_CONFIG');
putenv('DISCORDO_DB_CONFIG=' . $directory . '/config.php');
try {
    rejects(fn () => requireChannelManagement(0), 403);
    rejects(fn () => requireChannelManagement(2 | 4 | 8), 403);
    requireChannelManagement(1);
    requireChannelManagement(255);
    $lobbyChannels = [['id' => 11, 'type' => 'TEXTO'], ['id' => 12, 'type' => 'VOZ']];
    $guildChannels = [['id' => 291, 'type' => 'TEXTO'], ['id' => 292, 'type' => 'VOZ'], ['id' => 293, 'type' => 'TEXTO']];
    $lobby = channelLayout(1, $lobbyChannels);
    $guild = channelLayout(29, $guildChannels);
    expect($guild['categories'][0]['channels'] === [291,293], 'Existing text channels were lost');
    $guild = changeChannelLayout($guild, 'category', ['name' => 'Jogos'], [291,292,293]);
    $id = $guild['categories'][2]['id'];
    foreach ([291,292] as $channel) $guild = changeChannelLayout($guild, 'moveChannel', ['channel' => $channel, 'category' => $id], [291,292,293]);
    expect($guild['categories'][2]['channels'] === [291,292], 'Text and voice cannot share a category');
    $guild = changeChannelLayout($guild, 'moveChannel', ['channel' => 292, 'category' => $id, 'before' => 291], [291,292,293]);
    expect($guild['categories'][2]['channels'] === [292,291], 'Channel order was not saved');
    $guild = changeChannelLayout($guild, 'moveCategory', ['category' => $id, 'before' => 'default-text'], [291,292,293]);
    expect($guild['categories'][0]['id'] === $id, 'Category order did not change');
    $guild = changeChannelLayout($guild, 'category', ['category' => $id, 'name' => 'Partidas'], [291,292,293]);
    saveChannelLayout(29, $guild);
    expect(channelLayout(29, $guildChannels) === $guild, 'Guild layout did not survive reload');
    expect(channelLayout(1, $lobbyChannels) === $lobby && !is_file(channelLayoutPath(1)), 'Guild organization leaked into Discordo Brasil');
    rejects(fn () => changeChannelLayout($guild, 'moveChannel', ['channel' => 11, 'category' => $id], [291,292,293]), 404);
    rejects(fn () => changeChannelLayout($guild, 'moveChannel', ['channel' => 293, 'category' => $id], [291,292]), 404);
    rejects(fn () => changeChannelLayout($guild, 'moveChannel', ['channel' => 291, 'category' => $id, 'before' => 12], [291,292,293]), 409);
    rejects(fn () => changeChannelLayout($guild, 'moveChannel', ['channel' => 291, 'category' => 'other-server'], [291,292,293]), 409);
    rejects(fn () => changeChannelLayout($guild, 'category', ['name' => "\n"], [291,292,293]), 422);
    $without = changeChannelLayout($guild, 'deleteCategory', ['category' => $id], [291,292,293]);
    expect($without['uncategorized'] === [292,291], 'Deleting a category deleted or reordered its channels');
    saveChannelLayout(29, $without);
    $after = channelLayout(29, [['id' => 291, 'type' => 'TEXTO'], ['id' => 294, 'type' => 'VOZ']]);
    expect($after['uncategorized'] === [291,294], 'Deleted channels stayed in the layout or new channels disappeared');
    expect(channelLayout(1, $lobbyChannels) === $lobby, 'Deleting a category changed another server');
    echo "Category storage, ordering, mixed channels, deletion and server isolation passed.\n";
} finally {
    foreach (glob($directory . '/discordo-channel-layout/*') ?: [] as $file) unlink($file);
    if (is_dir($directory . '/discordo-channel-layout')) rmdir($directory . '/discordo-channel-layout');
    rmdir($directory);
    putenv($previous === false ? 'DISCORDO_DB_CONFIG' : 'DISCORDO_DB_CONFIG=' . $previous);
}
