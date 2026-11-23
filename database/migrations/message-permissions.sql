ALTER TABLE Cargo
    MODIFY COLUMN crg_permissoes SMALLINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Bits: 1 gerenciar canais, 2 gerenciar cargos, 4 mover, 8 criar cargos, 16 silenciar, 32 desativar áudio, 64 desconectar, 128 castigar, 256 excluir mensagens.';
