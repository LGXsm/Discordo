-- Discordo - esquema consolidado para revisão em 18/11/2026.
-- Origem: estrutura do projeto e as migrações SQL abaixo.
-- Banco de produção informado no projeto: luizg568_discordo.
-- Gerado e validado em uma instância local isolada de MariaDB.
-- Este arquivo descreve a estrutura esperada pelo código atual.
-- A estrutura em produção pode ser comparada com uma exportação do phpMyAdmin.
-- Contém tabelas, índices, relacionamentos e triggers.
-- Destinado a revisão ou criação em um banco vazio previamente selecionado.
--
-- Fontes:
-- database/historico/discordo_multiservidor.sql
-- database/migrations/server-permissions.sql
-- database/migrations/chat-video.sql
-- database/migrations/gameplay.sql
-- database/migrations/server-invites.sql
-- database/migrations/role-colors.sql
-- database/migrations/message-permissions.sql
-- database/migrations/chat-message-actions.sql

--
-- Persistência complementar nos arquivos privados do servidor:
-- appearance: aparência do cartão de cada usuário.
-- sounds: metadados dos áudios personalizados.
-- discordo-role-order: hierarquia de cargos por servidor.
-- discordo-reserved-role-colors: cores de Criador e ADM por servidor.
-- discordo-voice-limits: limite de participantes por canal.
-- .discordo-verification: desafios temporários de verificação por e-mail.
-- Progresso do tutorial: localStorage do navegador, separado por conta.
--

/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `canal` (
  `cnl_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Servidor_srv_id` int(10) unsigned NOT NULL,
  `cnl_nome` varchar(60) NOT NULL,
  `cnl_tipo` enum('TEXTO','VOZ') NOT NULL,
  `cnl_privado` tinyint(1) NOT NULL DEFAULT 0,
  `cnl_topico` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`cnl_id`),
  UNIQUE KEY `uq_canal_servidor_tipo_nome` (`Servidor_srv_id`,`cnl_tipo`,`cnl_nome`),
  CONSTRAINT `fk_canal_servidor` FOREIGN KEY (`Servidor_srv_id`) REFERENCES `servidor` (`srv_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Canal de texto ou voz de um servidor. CanalCargo indica quais cargos podem acessar um canal privado. Prefixo cnl.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_canal_dados_bi` BEFORE INSERT ON `Canal`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.cnl_nome)) = 0 OR NEW.cnl_privado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome e uma visibilidade validos para o canal.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_canal_vinculo_bu` BEFORE UPDATE ON `Canal`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.cnl_nome)) = 0 OR NEW.cnl_privado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome e uma visibilidade validos para o canal.';
    END IF;
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` OR NEW.`cnl_tipo` <> OLD.`cnl_tipo` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O servidor e o tipo de um canal são definidos na criação.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `canalcargo` (
  `cgc_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Canal_cnl_id` int(10) unsigned NOT NULL,
  `Cargo_crg_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`cgc_id`),
  UNIQUE KEY `uq_canal_cargo` (`Canal_cnl_id`,`Cargo_crg_id`),
  KEY `fk_canalcargo_cargo` (`Cargo_crg_id`),
  CONSTRAINT `fk_canalcargo_canal` FOREIGN KEY (`Canal_cnl_id`) REFERENCES `canal` (`cnl_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_canalcargo_cargo` FOREIGN KEY (`Cargo_crg_id`) REFERENCES `cargo` (`crg_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Autorização de acesso por cargo. MembroCargo indica quem tem o cargo, e CanalCargo indica quais canais privados esse cargo pode acessar. Prefixo cgc.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_canalcargo_servidor_bi` BEFORE INSERT ON `CanalCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `Canal` AS c
        JOIN `Cargo` AS r ON r.`Servidor_srv_id` = c.`Servidor_srv_id`
        WHERE c.`cnl_id` = NEW.`Canal_cnl_id` AND r.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Canal e cargo devem existir no mesmo servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_canalcargo_servidor_bu` BEFORE UPDATE ON `CanalCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `Canal` AS c
        JOIN `Cargo` AS r ON r.`Servidor_srv_id` = c.`Servidor_srv_id`
        WHERE c.`cnl_id` = NEW.`Canal_cnl_id` AND r.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Canal e cargo devem existir no mesmo servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cargo` (
  `crg_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Servidor_srv_id` int(10) unsigned NOT NULL,
  `crg_nome` varchar(60) NOT NULL,
  `crg_permissoes` smallint unsigned NOT NULL DEFAULT 0 COMMENT 'Bits: 1 gerenciar canais, 2 gerenciar cargos, 4 mover, 8 criar cargos, 16 silenciar, 32 desativar áudio, 64 desconectar, 128 castigar, 256 excluir mensagens.',
  `crg_cor` char(7) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT 'Cor sólida opcional do cargo no formato #RRGGBB.',
  PRIMARY KEY (`crg_id`),
  UNIQUE KEY `uq_cargo_servidor_nome` (`Servidor_srv_id`,`crg_nome`),
  CONSTRAINT `fk_cargo_servidor` FOREIGN KEY (`Servidor_srv_id`) REFERENCES `servidor` (`srv_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Cargo cadastrado dentro de um servidor. Criador e ADM são títulos de sistema. Prefixo crg.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_cargo_nome_bi` BEFORE INSERT ON `Cargo`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.crg_nome)) = 0 OR UPPER(TRIM(NEW.crg_nome)) IN ('CRIADOR', 'ADM') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome de cargo que nao seja reservado.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_cargo_vinculo_bu` BEFORE UPDATE ON `Cargo`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.crg_nome)) = 0 OR UPPER(TRIM(NEW.crg_nome)) IN ('CRIADOR', 'ADM') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe um nome de cargo que nao seja reservado.';
    END IF;
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Um cargo não pode mudar de servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `conviteservidor` (
  `cvs_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Servidor_srv_id` int(10) unsigned NOT NULL,
  `Usuario_usr_id` int(10) unsigned NOT NULL,
  `cvs_token` char(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `cvs_criado_em` datetime NOT NULL,
  `cvs_expira_em` datetime NOT NULL,
  `cvs_limite` int(10) unsigned DEFAULT NULL,
  `cvs_usos` int(10) unsigned NOT NULL DEFAULT 0,
  `cvs_revogado_em` datetime DEFAULT NULL,
  PRIMARY KEY (`cvs_id`),
  UNIQUE KEY `uq_convite_token` (`cvs_token`),
  KEY `ix_convite_servidor` (`Servidor_srv_id`,`cvs_id`),
  KEY `fk_convite_criador` (`Usuario_usr_id`),
  CONSTRAINT `fk_convite_criador` FOREIGN KEY (`Usuario_usr_id`) REFERENCES `usuario` (`usr_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_convite_servidor` FOREIGN KEY (`Servidor_srv_id`) REFERENCES `servidor` (`srv_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `criadorplataforma` (
  `cpl_id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `Usuario_usr_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`cpl_id`),
  UNIQUE KEY `uq_criador_usuario` (`Usuario_usr_id`),
  CONSTRAINT `fk_criador_usuario` FOREIGN KEY (`Usuario_usr_id`) REFERENCES `usuario` (`usr_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Conta exclusiva com o título Criador e acesso administrativo global. A chave fixa admite um único registro. Prefixo cpl.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_criador_id_bi` BEFORE INSERT ON `CriadorPlataforma`
FOR EACH ROW
BEGIN
    IF NEW.cpl_id <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O Criador usa o identificador fixo 1.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_criador_id_bu` BEFORE UPDATE ON `CriadorPlataforma`
FOR EACH ROW
BEGIN
    IF NEW.cpl_id <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O Criador usa o identificador fixo 1.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gameplay` (
  `gpl_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Mensagem_msg_id` int(10) unsigned NOT NULL COMMENT 'Mensagem da enquete. Seu autor organiza o Gameplay e seu canal recebe a enquete.',
  `gpl_jogo` varchar(80) NOT NULL,
  `gpl_inicio_em` datetime NOT NULL COMMENT 'Data e horário aproximado da jogatina, armazenados em UTC.',
  PRIMARY KEY (`gpl_id`),
  UNIQUE KEY `uq_gameplay_mensagem` (`Mensagem_msg_id`),
  KEY `ix_gameplay_inicio` (`gpl_inicio_em`),
  CONSTRAINT `fk_gameplay_mensagem` FOREIGN KEY (`Mensagem_msg_id`) REFERENCES `mensagem` (`msg_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Convite para jogar publicado como mensagem em um canal de texto. Prefixo gpl.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gameplayparticipante` (
  `gpp_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Gameplay_gpl_id` int(10) unsigned NOT NULL,
  `MembroServidor_mbs_id` int(10) unsigned NOT NULL COMMENT 'Membro convidado ou interessado, pertencente ao servidor do canal da enquete.',
  `gpp_situacao` enum('CONVIDADO','CONFIRMADO','RECUSADO','INTERESSADO') NOT NULL COMMENT 'Um interessado aceito pelo organizador passa diretamente a CONFIRMADO.',
  PRIMARY KEY (`gpp_id`),
  UNIQUE KEY `uq_gameplay_participante` (`Gameplay_gpl_id`,`MembroServidor_mbs_id`),
  KEY `fk_gameplayparticipante_membro` (`MembroServidor_mbs_id`),
  CONSTRAINT `fk_gameplayparticipante_gameplay` FOREIGN KEY (`Gameplay_gpl_id`) REFERENCES `gameplay` (`gpl_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_gameplayparticipante_membro` FOREIGN KEY (`MembroServidor_mbs_id`) REFERENCES `membroservidor` (`mbs_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Convite, pedido de interesse ou resposta de um membro a um Gameplay. Prefixo gpp.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `membrocargo` (
  `mbc_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `MembroServidor_mbs_id` int(10) unsigned NOT NULL,
  `Cargo_crg_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`mbc_id`),
  UNIQUE KEY `uq_membro_cargo` (`MembroServidor_mbs_id`,`Cargo_crg_id`),
  KEY `fk_membrocargo_cargo` (`Cargo_crg_id`),
  CONSTRAINT `fk_membrocargo_cargo` FOREIGN KEY (`Cargo_crg_id`) REFERENCES `cargo` (`crg_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_membrocargo_membro` FOREIGN KEY (`MembroServidor_mbs_id`) REFERENCES `membroservidor` (`mbs_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Atribuição de um cargo a um membro do mesmo servidor. Prefixo mbc.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_membrocargo_servidor_bi` BEFORE INSERT ON `MembroCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Cargo` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membro e cargo devem existir no mesmo servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_membrocargo_servidor_bu` BEFORE UPDATE ON `MembroCargo`
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `MembroServidor` AS m
        JOIN `Cargo` AS c ON c.`Servidor_srv_id` = m.`Servidor_srv_id`
        WHERE m.`mbs_id` = NEW.`MembroServidor_mbs_id` AND c.`crg_id` = NEW.`Cargo_crg_id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membro e cargo devem existir no mesmo servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `membroservidor` (
  `mbs_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Servidor_srv_id` int(10) unsigned NOT NULL,
  `Usuario_usr_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`mbs_id`),
  UNIQUE KEY `uq_membro_servidor_usuario` (`Servidor_srv_id`,`Usuario_usr_id`),
  KEY `fk_membro_usuario` (`Usuario_usr_id`),
  CONSTRAINT `fk_membro_servidor` FOREIGN KEY (`Servidor_srv_id`) REFERENCES `servidor` (`srv_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_membro_usuario` FOREIGN KEY (`Usuario_usr_id`) REFERENCES `usuario` (`usr_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Participação de um usuário em um servidor. A aplicação registra o proprietário como membro ao criar o servidor. Prefixo mbs.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_membro_vinculo_bu` BEFORE UPDATE ON `MembroServidor`
FOR EACH ROW
BEGIN
    IF NEW.`Servidor_srv_id` <> OLD.`Servidor_srv_id` OR NEW.`Usuario_usr_id` <> OLD.`Usuario_usr_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A participação não pode mudar de usuário ou servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `mensagem` (
  `msg_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `MembroServidor_mbs_id` int(10) unsigned NOT NULL COMMENT 'Participação do autor no servidor.',
  `Canal_cnl_id` int(10) unsigned NOT NULL COMMENT 'Canal de texto de destino.',
  `msg_texto` varchar(1000) NOT NULL,
  `msg_enviada_em` datetime(3) NOT NULL COMMENT 'Instante em UTC fornecido pela aplicação.',
  `msg_video_caminho` varchar(255) DEFAULT NULL COMMENT 'Nome do vídeo privado associado à mensagem.',
  `msg_resposta_id` int unsigned DEFAULT NULL COMMENT 'Mensagem citada no mesmo canal, mantida como referência se for excluída.',
  `msg_encaminhada` tinyint unsigned NOT NULL DEFAULT 0 COMMENT 'Cópia encaminhada de outra mensagem.',
  PRIMARY KEY (`msg_id`),
  KEY `fk_mensagem_membro` (`MembroServidor_mbs_id`),
  KEY `fk_mensagem_canal` (`Canal_cnl_id`),
  CONSTRAINT `fk_mensagem_canal` FOREIGN KEY (`Canal_cnl_id`) REFERENCES `canal` (`cnl_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_mensagem_membro` FOREIGN KEY (`MembroServidor_mbs_id`) REFERENCES `membroservidor` (`mbs_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Mensagem em um canal de texto. O membro autor e o canal pertencem ao mesmo servidor. Prefixo msg.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_mensagem_canal_bi` BEFORE INSERT ON `Mensagem`
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
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_mensagem_canal_bu` BEFORE UPDATE ON `Mensagem`
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
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `servidor` (
  `srv_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Usuario_usr_id_Proprietario` int(10) unsigned DEFAULT NULL,
  `srv_nome` varchar(60) NOT NULL,
  `srv_imagem_caminho` varchar(255) DEFAULT NULL,
  `srv_entrada` tinyint(3) unsigned DEFAULT NULL,
  PRIMARY KEY (`srv_id`),
  UNIQUE KEY `uq_servidor_proprietario` (`Usuario_usr_id_Proprietario`),
  UNIQUE KEY `uq_servidor_entrada` (`srv_entrada`),
  CONSTRAINT `fk_servidor_proprietario` FOREIGN KEY (`Usuario_usr_id_Proprietario`) REFERENCES `usuario` (`usr_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Servidor do Discordo. O proprietário recebe o título ADM neste servidor e pode ter um único servidor próprio. Prefixo srv.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_servidor_nome_bi` BEFORE INSERT ON `Servidor`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.srv_nome)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome do servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_servidor_nome_bu` BEFORE UPDATE ON `Servidor`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.srv_nome)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome do servidor.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessao` (
  `ses_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Usuario_usr_id` int(10) unsigned NOT NULL,
  `ses_token_hash` binary(32) NOT NULL COMMENT 'Hash SHA-256 binário do token da sessão.',
  PRIMARY KEY (`ses_id`),
  UNIQUE KEY `uq_sessao_token` (`ses_token_hash`),
  KEY `fk_sessao_usuario` (`Usuario_usr_id`),
  CONSTRAINT `fk_sessao_usuario` FOREIGN KEY (`Usuario_usr_id`) REFERENCES `usuario` (`usr_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Acesso autenticado de um usuário. Cada navegador pode ter a própria sessão. Prefixo ses.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario` (
  `usr_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usr_nome_exibicao` varchar(40) NOT NULL,
  `usr_email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'E-mail normalizado pela aplicação.',
  `usr_senha_hash` varchar(255) NOT NULL,
  `usr_data_nascimento` date NOT NULL,
  `usr_avatar_caminho` varchar(255) DEFAULT NULL,
  `usr_banner_caminho` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`usr_id`),
  UNIQUE KEY `uq_usuario_email` (`usr_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Conta e perfil de uma pessoa no Discordo. Prefixo usr.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_usuario_nome_bi` BEFORE INSERT ON `Usuario`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.usr_nome_exibicao)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome de exibicao.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `tr_usuario_nome_bu` BEFORE UPDATE ON `Usuario`
FOR EACH ROW
BEGIN
    IF CHAR_LENGTH(TRIM(NEW.usr_nome_exibicao)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o nome de exibicao.';
    END IF;
END 
*/;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

