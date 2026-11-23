<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/gameplay.php';

$now = new DateTimeImmutable('2026-11-18T01:30:00Z'); // 17/11, 22:30 em São Paulo.
$zone = 'America/Sao_Paulo';
$lastAllowed = '2026-11-21T02:59:59Z'; // 20/11, 23:59:59 em São Paulo.
if (validateGameplayStart($lastAllowed, $zone, $now)->format('Y-m-d\TH:i:s\Z') !== $lastAllowed) {
    throw new RuntimeException('O terceiro dia deve ser aceito até o fim.');
}
foreach ([
    ['2026-11-21T03:00:00Z', $zone],
    ['2026-11-22T00:00:00Z', 'UTC'],
    ['2026-11-18T01:30:00Z', $zone],
    ['2026-11-30T23:59:00Z', $zone],
    ['2026-11-19T00:00:00Z', '+15:00'],
] as [$date, $timezone]) {
    try {
        validateGameplayStart($date, $timezone, $now);
        throw new RuntimeException('O servidor aceitou uma data ou um fuso inválido.');
    } catch (DomainException $error) {
        if ($error->getCode() !== 422) throw $error;
    }
}
echo "Gameplay calendar deadline checked.\n";
