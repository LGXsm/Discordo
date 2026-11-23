-- Discordo Brasil | MySQL 8.0.16 ou superior
-- Execute em um schema novo. Se o schema já foi criado pela hospedagem,
-- substitua as linhas CREATE DATABASE e USE por USE com o nome atribuído.
-- Nenhuma tabela existente é apagada.

CREATE DATABASE IF NOT EXISTS `discordo`
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `discordo`;

CREATE TABLE `Usuario` (
    `usr_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `usr_nome_exibicao` VARCHAR(40) NOT NULL,
    `usr_email` VARCHAR(254) COLLATE utf8mb4_bin NOT NULL
        COMMENT 'E-mail normalizado pela aplicação antes do cadastro e do login.',
    `usr_senha_hash` VARCHAR(255) NOT NULL
        COMMENT 'Hash da senha no formato produzido pelo algoritmo de autenticação.',
    `usr_data_nascimento` DATE NOT NULL,
    `usr_avatar_caminho` VARCHAR(255) NULL,
    `usr_banner_caminho` VARCHAR(255) NULL,
    PRIMARY KEY (`usr_id`),
    CONSTRAINT `uq_usuario_email` UNIQUE (`usr_email`),
    CONSTRAINT `ck_usuario_nome` CHECK (CHAR_LENGTH(TRIM(`usr_nome_exibicao`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Conta e perfil de uma pessoa no Discordo, representados pelo prefixo usr.';

CREATE TABLE `Canal` (
    `cnl_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cnl_nome` VARCHAR(60) NOT NULL,
    `cnl_tipo` ENUM('TEXTO', 'VOZ') NOT NULL,
    `cnl_topico` VARCHAR(255) NULL,
    PRIMARY KEY (`cnl_id`),
    CONSTRAINT `uq_canal_tipo_nome` UNIQUE (`cnl_tipo`, `cnl_nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canal do servidor Discordo Brasil, representado pelo prefixo cnl. O tipo distingue texto e voz.';

CREATE TABLE `Sessao` (
    `ses_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Usuario_usr_id` INT UNSIGNED NOT NULL,
    `ses_token_hash` BINARY(32) NOT NULL
        COMMENT 'Hash SHA-256 binário do token aleatório entregue ao navegador.',
    PRIMARY KEY (`ses_id`),
    CONSTRAINT `uq_sessao_token` UNIQUE (`ses_token_hash`),
    CONSTRAINT `fk_sessao_usuario` FOREIGN KEY (`Usuario_usr_id`)
        REFERENCES `Usuario` (`usr_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Acesso autenticado de um usuário, representado pelo prefixo ses. Cada navegador pode ter sua própria sessão.';

CREATE TABLE `Mensagem` (
    `msg_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Usuario_usr_id` INT UNSIGNED NOT NULL COMMENT 'Autor da mensagem.',
    `Canal_cnl_id` INT UNSIGNED NOT NULL COMMENT 'Canal de texto em que a mensagem foi publicada.',
    `msg_texto` VARCHAR(1000) NOT NULL,
    `msg_enviada_em` DATETIME(3) NOT NULL COMMENT 'Data e hora do envio em UTC, fornecidas pela aplicação.',
    PRIMARY KEY (`msg_id`),
    CONSTRAINT `ck_mensagem_texto` CHECK (CHAR_LENGTH(TRIM(`msg_texto`)) > 0),
    CONSTRAINT `fk_mensagem_usuario` FOREIGN KEY (`Usuario_usr_id`)
        REFERENCES `Usuario` (`usr_id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_mensagem_canal` FOREIGN KEY (`Canal_cnl_id`)
        REFERENCES `Canal` (`cnl_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Envio em um canal de texto, representado pelo prefixo msg. A FK Usuario aponta para o autor e a FK Canal aponta para o local da publicação.';

-- A aplicação deve recusar datas de nascimento futuras e mensagens em canais VOZ.
-- Canais já usados pelo site.
INSERT INTO `Canal` (`cnl_nome`, `cnl_tipo`, `cnl_topico`) VALUES
    ('geral', 'TEXTO', 'O ponto de encontro da galera'),
    ('jogos', 'TEXTO', 'Combine partidas e compartilhe suas jogadas'),
    ('memes', 'TEXTO', 'O melhor do grupo vai parar aqui'),
    ('Resenha', 'VOZ', NULL),
    ('Lan house', 'VOZ', NULL);
