-- AlterTable
ALTER TABLE `dtf_uv` ADD COLUMN `ruta_pre_mascara_barniz` VARCHAR(500) NULL,
    ADD COLUMN `ruta_pre_mascara_blanco` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `lienzos` ADD COLUMN `cliente_ciudad` VARCHAR(100) NULL,
    ADD COLUMN `cliente_estado` VARCHAR(100) NULL,
    ADD COLUMN `cliente_pais` VARCHAR(100) NULL;

