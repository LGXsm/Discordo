ALTER TABLE Mensagem
    ADD COLUMN msg_resposta_id INT UNSIGNED NULL COMMENT 'Mensagem citada no mesmo canal, mantida como referência se for excluída.',
    ADD COLUMN msg_encaminhada TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Cópia encaminhada de outra mensagem.';
