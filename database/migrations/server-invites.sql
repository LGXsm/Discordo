CREATE TABLE IF NOT EXISTS ConviteServidor (
    cvs_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Servidor_srv_id INT UNSIGNED NOT NULL,
    Usuario_usr_id INT UNSIGNED NOT NULL,
    cvs_token CHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cvs_criado_em DATETIME NOT NULL,
    cvs_expira_em DATETIME NOT NULL,
    cvs_limite INT UNSIGNED NULL,
    cvs_usos INT UNSIGNED NOT NULL DEFAULT 0,
    cvs_revogado_em DATETIME NULL,
    UNIQUE KEY uq_convite_token (cvs_token),
    KEY ix_convite_servidor (Servidor_srv_id, cvs_id),
    CONSTRAINT fk_convite_servidor FOREIGN KEY (Servidor_srv_id) REFERENCES Servidor (srv_id) ON DELETE CASCADE,
    CONSTRAINT fk_convite_criador FOREIGN KEY (Usuario_usr_id) REFERENCES Usuario (usr_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

