-- AlterTable
ALTER TABLE `dtf_uv` ADD COLUMN `alto_hoja_mm` DECIMAL(10, 2) NULL,
    ADD COLUMN `ancho_hoja_mm` DECIMAL(8, 2) NULL,
    ADD COLUMN `copias` INTEGER NULL,
    ADD COLUMN `estado_hoja` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    ADD COLUMN `marca_registro_mm` DECIMAL(6, 2) NOT NULL DEFAULT 10,
    ADD COLUMN `margen_hoja_mm` DECIMAL(6, 2) NOT NULL DEFAULT 5,
    ADD COLUMN `mensaje_error_hoja` TEXT NULL,
    ADD COLUMN `ruta_hoja_pdf` VARCHAR(500) NULL;

