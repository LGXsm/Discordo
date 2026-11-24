ALTER TABLE Mensagem
    MODIFY COLUMN msg_texto VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    ADD COLUMN msg_editada_em DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS MensagemReacao (
    Mensagem_msg_id INT UNSIGNED NOT NULL,
    MembroServidor_mbs_id INT UNSIGNED NOT NULL,
    mre_emoji VARBINARY(32) NOT NULL,
    PRIMARY KEY (Mensagem_msg_id, MembroServidor_mbs_id, mre_emoji),
    KEY ix_mre_membro (MembroServidor_mbs_id),
    CONSTRAINT fk_mre_mensagem FOREIGN KEY (Mensagem_msg_id) REFERENCES Mensagem (msg_id) ON DELETE CASCADE,
    CONSTRAINT fk_mre_membro FOREIGN KEY (MembroServidor_mbs_id) REFERENCES MembroServidor (mbs_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
