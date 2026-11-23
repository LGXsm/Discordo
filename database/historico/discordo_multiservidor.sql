-- Discordo Brasil | MySQL 5.7+ e MariaDB 12.3
-- Execute em um banco novo. Este script cria apenas a estrutura.
-- O cadastro da primeira conta antecede a atribuição do título Criador.

CREATE DATABASE IF NOT EXISTS `discordo_multiservidor`
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `discordo_multiservidor`;

CREATE TABLE `Usuario` (
    `usr_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `usr_nome_exibicao` VARCHAR(40) NOT NULL,
    `usr_email` VARCHAR(254) COLLATE utf8mb4_bin NOT NULL
        COMMENT 'E-mail normalizado pela aplicação.',
    `usr_senha_hash` VARCHAR(255) NOT NULL,
    `usr_data_nascimento` DATE NOT NULL,
    `usr_avatar_caminho` VARCHAR(255) NULL,
    `usr_banner_caminho` VARCHAR(255) NULL,
    PRIMARY KEY (`usr_id`),
    CONSTRAINT `uq_usuario_email` UNIQUE (`usr_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Conta e perfil de uma pessoa no Discordo. Prefixo usr.';

CREATE TABLE `Sessao` (
    `ses_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Usuario_usr_id` INT UNSIGNED NOT NULL,
    `ses_token_hash` BINARY(32) NOT NULL COMMENT 'Hash SHA-256 binário do token da sessão.',
    PRIMARY KEY (`ses_id`),
    CONSTRAINT `uq_sessao_token` UNIQUE (`ses_token_hash`),
    CONSTRAINT `fk_sessao_usuario` FOREIGN KEY (`Usuario_usr_id`)
        REFERENCES `Usuario` (`usr_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Acesso autenticado de um usuário. Cada navegador pode ter a própria sessão. Prefixo ses.';

CREATE TABLE `CriadorPlataforma` (
    `cpl_id` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `Usuario_usr_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`cpl_id`),
    CONSTRAINT `uq_criador_usuario` UNIQUE (`Usuario_usr_id`),
    CONSTRAINT `fk_criador_usuario` FOREIGN KEY (`Usuario_usr_id`)
        REFERENCES `Usuario` (`usr_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Conta exclusiva com o título Criador e acesso administrativo global. A chave fixa admite um único registro. Prefixo cpl.';

CREATE TABLE `Servidor` (
    `srv_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Usuario_usr_id_Proprietario` INT UNSIGNED NOT NULL,
    `srv_nome` VARCHAR(60) NOT NULL,
    `srv_imagem_caminho` VARCHAR(255) NULL,
    PRIMARY KEY (`srv_id`),
    CONSTRAINT `uq_servidor_proprietario` UNIQUE (`Usuario_usr_id_Proprietario`),
    CONSTRAINT `fk_servidor_proprietario` FOREIGN KEY (`Usuario_usr_id_Proprietario`)
        REFERENCES `Usuario` (`usr_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Servidor do Discordo. O proprietário recebe o título ADM neste servidor e pode ter um único servidor próprio. Prefixo srv.';

CREATE TABLE `MembroServidor` (
    `mbs_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Servidor_srv_id` INT UNSIGNED NOT NULL,
    `Usuario_usr_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`mbs_id`),
    CONSTRAINT `uq_membro_servidor_usuario` UNIQUE (`Servidor_srv_id`, `Usuario_usr_id`),
    CONSTRAINT `fk_membro_servidor` FOREIGN KEY (`Servidor_srv_id`)
        REFERENCES `Servidor` (`srv_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT `fk_membro_usuario` FOREIGN KEY (`Usuario_usr_id`)
        REFERENCES `Usuario` (`usr_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Participação de um usuário em um servidor. A aplicação registra o proprietário como membro ao criar o servidor. Prefixo mbs.';

CREATE TABLE `Canal` (
    `cnl_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Servidor_srv_id` INT UNSIGNED NOT NULL,
    `cnl_nome` VARCHAR(60) NOT NULL,
    `cnl_tipo` ENUM('TEXTO', 'VOZ') NOT NULL,
    `cnl_privado` BOOLEAN NOT NULL DEFAULT FALSE,
    `cnl_topico` VARCHAR(255) NULL,
    PRIMARY KEY (`cnl_id`),
    CONSTRAINT `uq_canal_servidor_tipo_nome` UNIQUE (`Servidor_srv_id`, `cnl_tipo`, `cnl_nome`),
    CONSTRAINT `fk_canal_servidor` FOREIGN KEY (`Servidor_srv_id`)
        REFERENCES `Servidor` (`srv_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Canal de texto ou voz de um servidor. CanalCargo indica quais cargos podem acessar um canal privado. Prefixo cnl.';

CREATE TABLE `Cargo` (
    `crg_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Servidor_srv_id` INT UNSIGNED NOT NULL,
    `crg_nome` VARCHAR(60) NOT NULL,
    PRIMARY KEY (`crg_id`),
    CONSTRAINT `uq_cargo_servidor_nome` UNIQUE (`Servidor_srv_id`, `crg_nome`),
    CONSTRAINT `fk_cargo_servidor` FOREIGN KEY (`Servidor_srv_id`)
        REFERENCES `Servidor` (`srv_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Cargo cadastrado dentro de um servidor. Criador e ADM são títulos de sistema. Prefixo crg.';

CREATE TABLE `MembroCargo` (
    `mbc_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `MembroServidor_mbs_id` INT UNSIGNED NOT NULL,
    `Cargo_crg_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`mbc_id`),
    CONSTRAINT `uq_membro_cargo` UNIQUE (`MembroServidor_mbs_id`, `Cargo_crg_id`),
    CONSTRAINT `fk_membrocargo_membro` FOREIGN KEY (`MembroServidor_mbs_id`)
        REFERENCES `MembroServidor` (`mbs_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT `fk_membrocargo_cargo` FOREIGN KEY (`Cargo_crg_id`)
        REFERENCES `Cargo` (`crg_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Atribuição de um cargo a um membro do mesmo servidor. Prefixo mbc.';

CREATE TABLE `CanalCargo` (
    `cgc_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Canal_cnl_id` INT UNSIGNED NOT NULL,
    `Cargo_crg_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`cgc_id`),
    CONSTRAINT `uq_canal_cargo` UNIQUE (`Canal_cnl_id`, `Cargo_crg_id`),
    CONSTRAINT `fk_canalcargo_canal` FOREIGN KEY (`Canal_cnl_id`)
        REFERENCES `Canal` (`cnl_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT `fk_canalcargo_cargo` FOREIGN KEY (`Cargo_crg_id`)
        REFERENCES `Cargo` (`crg_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Autorização de acesso por cargo. MembroCargo indica quem tem o cargo, e CanalCargo indica quais canais privados esse cargo pode acessar. Prefixo cgc.';

CREATE TABLE `Mensagem` (
    `msg_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `MembroServidor_mbs_id` INT UNSIGNED NOT NULL COMMENT 'Participação do autor no servidor.',
    `Canal_cnl_id` INT UNSIGNED NOT NULL COMMENT 'Canal de texto de destino.',
    `msg_texto` VARCHAR(1000) NOT NULL,
    `msg_enviada_em` DATETIME(3) NOT NULL COMMENT 'Instante em UTC fornecido pela aplicação.',
    PRIMARY KEY (`msg_id`),
    CONSTRAINT `fk_mensagem_membro` FOREIGN KEY (`MembroServidor_mbs_id`)
        REFERENCES `MembroServidor` (`mbs_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT `fk_mensagem_canal` FOREIGN KEY (`Canal_cnl_id`)
        REFERENCES `Canal` (`cnl_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Mensagem em um canal de texto. O membro autor e o canal pertencem ao mesmo servidor. Prefixo msg.';

-- As FKs simples permitem a cascata de IDs. As validações abaixo impedem
-- que gravações diretas cruzem servidores ou mudem o tipo de um canal.
DELIMITER $$

-- O MySQL 5.7 ignora CHECK. Os gatilhos mantêm essas regras na hospedagem.
CREATE TRIGGER `tr_usuario_nome_bi` BEFORE INSERT ON `Usuario`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.usr_nome_exibicao)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome de exibicao.';
    END IF;
END$$

CREATE TRIGGER `tr_usuario_nome_bu` BEFORE UPDATE ON `Usuario`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.usr_nome_exibicao)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome de exibicao.';
    END IF;
END$$

CREATE TRIGGER `tr_criador_id_bi` BEFORE INSERT ON `CriadorPlataforma`
FOR EACH ROW
BEGIN
    IF NEW.cpl_id <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O Criador usa o identificador fixo 1.';
    END IF;
END$$

CREATE TRIGGER `tr_criador_id_bu` BEFORE UPDATE ON `CriadorPlataforma`
FOR EACH ROW
BEGIN
    IF NEW.cpl_id <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O Criador usa o identificador fixo 1.';
    END IF;
END$$

CREATE TRIGGER `tr_servidor_nome_bi` BEFORE INSERT ON `Servidor`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.srv_nome)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome do servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_servidor_nome_bu` BEFORE UPDATE ON `Servidor`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.srv_nome)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome do servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_canal_dados_bi` BEFORE INSERT ON `Canal`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.cnl_nome)) = 0 OR NEW.cnl_privado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome e uma visibilidade validos para o canal.';
    END IF;
END$$

CREATE TRIGGER `tr_cargo_nome_bi` BEFORE INSERT ON `Cargo`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.crg_nome)) = 0 OR UPPER(TRIM(NEW.crg_nome)) IN ('CRIADOR', 'ADM') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome de cargo que nao seja reservado.';
    END IF;
END$$

CREATE TRIGGER `tr_membro_vinculo_bu` BEFORE UPDATE ON `MembroServidor`
FOR EACH ROW
BEGIN
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` OR NEW.`Usuario_usr_id` <> OLD.`Usuario_usr_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A participação não pode mudar de usuário ou servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_canal_vinculo_bu` BEFORE UPDATE ON `Canal`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.cnl_nome)) = 0 OR NEW.cnl_privado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome e uma visibilidade validos para o canal.';
    END IF;
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` OR NEW.`cnl_tipo` <> OLD.`cnl_tipo` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O servidor e o tipo de um canal são definidos na criação.';
    END IF;
END$$

CREATE TRIGGER `tr_cargo_vinculo_bu` BEFORE UPDATE ON `Cargo`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.crg_nome)) = 0 OR UPPER(TRIM(NEW.crg_nome)) IN ('CRIADOR', 'ADM') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome de cargo que nao seja reservado.';
    END IF;
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Um cargo não pode mudar de servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_membrocargo_servidor_bi` BEFORE INSERT ON `MembroCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Cargo` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membro e cargo devem existir no mesmo servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_membrocargo_servidor_bu` BEFORE UPDATE ON `MembroCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Cargo` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membro e cargo devem existir no mesmo servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_canalcargo_servidor_bi` BEFORE INSERT ON `CanalCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `Canal` AS c
        JOIN `Cargo` AS r ON r.`Servidor_srv_id` = c.`Servidor_srv_id`
        WHERE c.`cnl_id` = NEW.`Canal_cnl_id` AND r.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Canal e cargo devem existir no mesmo servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_canalcargo_servidor_bu` BEFORE UPDATE ON `CanalCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `Canal` AS c
        JOIN `Cargo` AS r ON r.`Servidor_srv_id` = c.`Servidor_srv_id`
        WHERE c.`cnl_id` = NEW.`Canal_cnl_id` AND r.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Canal e cargo devem existir no mesmo servidor.';
    END IF;
END$$

CREATE TRIGGER `tr_mensagem_canal_bi` BEFORE INSERT ON `Mensagem`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.msg_texto)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o texto da mensagem.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Canal` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`cnl_id` = NEW.`Canal_cnl_id`
          AND c.`cnl_tipo` = 'TEXTO'
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A mensagem exige um canal de texto no servidor do autor.';
    END IF;
END$$

CREATE TRIGGER `tr_mensagem_canal_bu` BEFORE UPDATE ON `Mensagem`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.msg_texto)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o texto da mensagem.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Canal` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`cnl_id` = NEW.`Canal_cnl_id`
          AND c.`cnl_tipo` = 'TEXTO'
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A mensagem exige um canal de texto no servidor do autor.';
    END IF;
END$$

DELIMITER ;

-- Regras da aplicação: cadastrar o proprietário em MembroServidor na mesma
-- transação de criação do servidor, validar a data de nascimento e aplicar
-- a autorização para listar canais, usar voz e ler ou enviar mensagens.
--
-- Depois que sua conta existir em Usuario, o responsável pela configuração
-- pode atribuir o título Criador. Substitua o e-mail pelo valor cadastrado:
-- INSERT INTO `CriadorPlataforma` (`Usuario_usr_id`)
-- SELECT `usr_id` FROM `Usuario` WHERE `usr_email` = 'seu-email@example.com';
