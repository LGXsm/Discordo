-- Selecione o banco do Discordo antes de importar.
CREATE TABLE IF NOT EXISTS Amizade (
    ami_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ami_usuario_menor INT UNSIGNED NOT NULL,
    ami_usuario_maior INT UNSIGNED NOT NULL,
    ami_solicitante INT UNSIGNED NOT NULL,
    ami_aceita_em DATETIME(3) DEFAULT NULL,
    UNIQUE KEY uq_amizade_par (ami_usuario_menor, ami_usuario_maior),
    KEY idx_amizade_usuario_maior (ami_usuario_maior),
    CONSTRAINT chk_amizade_par CHECK (ami_usuario_menor < ami_usuario_maior),
    CONSTRAINT chk_amizade_solicitante CHECK (ami_solicitante IN (ami_usuario_menor, ami_usuario_maior)),
    CONSTRAINT fk_amizade_usuario_menor FOREIGN KEY (ami_usuario_menor) REFERENCES Usuario (usr_id) ON DELETE CASCADE,
    CONSTRAINT fk_amizade_usuario_maior FOREIGN KEY (ami_usuario_maior) REFERENCES Usuario (usr_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MensagemDireta (
    mdt_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Amizade_ami_id INT UNSIGNED NOT NULL,
    mdt_autor INT UNSIGNED NOT NULL,
    mdt_texto VARCHAR(2000) NOT NULL,
    mdt_enviada_em DATETIME(3) NOT NULL,
    KEY idx_mensagem_direta_conversa (Amizade_ami_id, mdt_id),
    CONSTRAINT fk_mensagem_direta_amizade FOREIGN KEY (Amizade_ami_id) REFERENCES Amizade (ami_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
