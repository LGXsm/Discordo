<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/role-order.php';

function checkOrder(bool $condition): void
{
    if (!$condition) throw new RuntimeException('A hierarquia de cargos não corresponde ao esperado.');
}

$directory = sys_get_temp_dir() . '/discordo-role-order-test-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
putenv('DISCORDO_DB_CONFIG=' . $directory . '/db.php');
try {
    checkOrder(serverRoleOrder(1) === []);
    saveServerRoleOrder(1, [9, 4, 2]);
    checkOrder(serverRoleOrder(1) === [9, 4, 2] && serverRoleOrder(2) === []);
    saveServerRoleOrder(29, [12, 11]);
    checkOrder(serverRoleOrder(29) === [12, 11] && serverRoleOrder(1) === [9, 4, 2]);
    checkOrder(orderedRoleIds([2, 4, 7], serverRoleOrder(1)) === [4, 2, 7]);
    saveServerRoleOrder(1, [7, 4, 2]);
    checkOrder(serverRoleOrder(1) === [7, 4, 2]);
    checkOrder(validRoleOrder([4, 2, 7], [7, 4, 2]));
    foreach ([[7, 7, 2], [4, 2, 8], [4, 2], ['4', 2, 7], [1 => 4, 2 => 2, 3 => 7], null] as $invalid) {
        checkOrder(!validRoleOrder([4, 2, 7], $invalid));
    }
    echo "Role order checks passed.\n";
} finally {
    foreach ([1, 29] as $server) {
        if (is_file(roleOrderPath($server))) unlink(roleOrderPath($server));
    }
    if (is_dir(dirname(roleOrderPath(1)))) rmdir(dirname(roleOrderPath(1)));
    rmdir($directory);
}
