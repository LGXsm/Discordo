-- Execute com o banco do Discordo selecionado. As tabelas existentes são preservadas.
CREATE TABLE IF NOT EXISTS `Gameplay` (
    `gpl_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Mensagem_msg_id` INT UNSIGNED NOT NULL
        COMMENT 'Mensagem da enquete. Seu autor organiza o Gameplay e seu canal recebe a enquete.',
    `gpl_jogo` VARCHAR(80) NOT NULL,
    `gpl_inicio_em` DATETIME NOT NULL
        COMMENT 'Data e horário aproximado da jogatina, armazenados em UTC.',
    PRIMARY KEY (`gpl_id`),
    CONSTRAINT `uq_gameplay_mensagem` UNIQUE (`Mensagem_msg_id`),
    CONSTRAINT `fk_gameplay_mensagem` FOREIGN KEY (`Mensagem_msg_id`)
        REFERENCES `Mensagem` (`msg_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    KEY `ix_gameplay_inicio` (`gpl_inicio_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Convite para jogar publicado como mensagem em um canal de texto. Prefixo gpl.';

CREATE TABLE IF NOT EXISTS `GameplayParticipante` (
    `gpp_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `Gameplay_gpl_id` INT UNSIGNED NOT NULL,
    `MembroServidor_mbs_id` INT UNSIGNED NOT NULL
        COMMENT 'Membro convidado ou interessado, pertencente ao servidor do canal da enquete.',
    `gpp_situacao` ENUM('CONVIDADO', 'CONFIRMADO', 'RECUSADO', 'INTERESSADO') NOT NULL
        COMMENT 'Um interessado aceito pelo organizador passa diretamente a CONFIRMADO.',
    PRIMARY KEY (`gpp_id`),
    CONSTRAINT `uq_gameplay_participante` UNIQUE (`Gameplay_gpl_id`, `MembroServidor_mbs_id`),
    CONSTRAINT `fk_gameplayparticipante_gameplay` FOREIGN KEY (`Gameplay_gpl_id`)
        REFERENCES `Gameplay` (`gpl_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT `fk_gameplayparticipante_membro` FOREIGN KEY (`MembroServidor_mbs_id`)
        REFERENCES `MembroServidor` (`mbs_id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Convite, pedido de interesse ou resposta de um membro a um Gameplay. Prefixo gpp.';
