-- Aplique uma vez ao banco multisservidor.
ALTER TABLE Mensagem ADD COLUMN msg_video_caminho VARCHAR(255) NULL
    COMMENT 'Nome do vídeo privado associado à mensagem.';
