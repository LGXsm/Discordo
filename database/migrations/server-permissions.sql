-- Aplique uma vez ao banco multisservidor existente.
ALTER TABLE Servidor
    MODIFY Usuario_usr_id_Proprietario INT UNSIGNED NULL,
    ADD COLUMN srv_entrada TINYINT UNSIGNED NULL,
    ADD UNIQUE KEY uq_servidor_entrada (srv_entrada);

ALTER TABLE Cargo
    ADD COLUMN crg_permissoes TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Bits: 1 gerenciar canais, 2 gerenciar cargos, 4 mover, 8 criar cargos, 16 silenciar, 32 desativar áudio, 64 desconectar.';

START TRANSACTION;
INSERT INTO Servidor (srv_nome, srv_entrada) VALUES ('Discordo Brasil', 1);
INSERT INTO Canal (Servidor_srv_id, cnl_nome, cnl_tipo, cnl_topico)
SELECT srv_id, 'geral', 'TEXTO', 'O ponto de encontro da galera' FROM Servidor WHERE srv_entrada = 1
UNION ALL SELECT srv_id, 'jogos', 'TEXTO', 'Combine partidas e compartilhe suas jogadas' FROM Servidor WHERE srv_entrada = 1
UNION ALL SELECT srv_id, 'memes', 'TEXTO', 'O melhor do grupo vai parar aqui' FROM Servidor WHERE srv_entrada = 1
UNION ALL SELECT srv_id, 'Resenha', 'VOZ', NULL FROM Servidor WHERE srv_entrada = 1
UNION ALL SELECT srv_id, 'Lan house', 'VOZ', NULL FROM Servidor WHERE srv_entrada = 1;
INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id)
SELECT s.srv_id, u.usr_id FROM Servidor s CROSS JOIN Usuario u WHERE s.srv_entrada = 1;
COMMIT;
