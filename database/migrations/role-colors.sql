-- Selecione o banco do Discordo antes da importação.
ALTER TABLE Cargo ADD COLUMN crg_cor CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'Cor sólida opcional do cargo no formato #RRGGBB.';
