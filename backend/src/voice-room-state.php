<?php
declare(strict_types=1);

const ROOM_TTL = 90;

function roomPresence(string $directory, string $room): array
{
    $file = @fopen($directory . '/' . $room . '.json', 'r');
    if (!$file) return [];
    try {
        if (!flock($file, LOCK_SH)) return [];
        $entries = json_decode(stream_get_contents($file), true) ?: [];
        return array_values(array_column(array_filter($entries,
            static fn ($entry) => empty($entry['kicked']) && time() - $entry['seen'] <= ROOM_TTL), 'member'));
    } finally {
        fclose($file);
    }
}
