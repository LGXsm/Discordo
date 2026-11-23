<?php
declare(strict_types=1);

// Run against a scratch database with the Discordo schema and Gameplay migration applied.
require_once __DIR__ . '/../backend/src/database.php';
require_once __DIR__ . '/../backend/src/gameplay.php';

$db = database();
$db->beginTransaction();
try {
    query($db, "INSERT INTO Usuario (usr_email, usr_senha_hash, usr_nome_exibicao, usr_data_nascimento)
        VALUES ('gameplay-history@example.test', 'fixture', 'Fixture', '2000-01-01')");
    $user = (int) $db->lastInsertId();
    query($db, "INSERT INTO Servidor (Usuario_usr_id_Proprietario, srv_nome) VALUES (?, 'Fixture')", [$user]);
    $server = (int) $db->lastInsertId();
    query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id) VALUES (?, ?)', [$server, $user]);
    $member = (int) $db->lastInsertId();
    query($db, "INSERT INTO Canal (Servidor_srv_id, cnl_nome, cnl_tipo) VALUES (?, 'geral', 'TEXTO')", [$server]);
    $channel = (int) $db->lastInsertId();
    $messages = [];
    for ($index = 0; $index < 153; $index++) {
        query($db, "INSERT INTO Mensagem (MembroServidor_mbs_id, Canal_cnl_id, msg_texto, msg_enviada_em)
            VALUES (?, ?, 'Gameplay: Fixture', UTC_TIMESTAMP())", [$member, $channel]);
        $message = (int) $db->lastInsertId();
        $messages[] = $message;
        if (in_array($index, [0, 1, 151, 152], true)) {
            query($db, "INSERT INTO Gameplay (Mensagem_msg_id, gpl_jogo, gpl_inicio_em)
                VALUES (?, 'Fixture', UTC_TIMESTAMP())", [$message]);
        }
    }
    $rows = gameplayPolls($db, $channel, $user, $messages[0], $messages[151]);
    if (array_column($rows, 'message') !== [$messages[151]]) {
        throw new RuntimeException('Gameplay included polls outside the visible 150-message window.');
    }
    echo "Gameplay history window checked.\n";
} finally {
    $db->rollBack();
}
