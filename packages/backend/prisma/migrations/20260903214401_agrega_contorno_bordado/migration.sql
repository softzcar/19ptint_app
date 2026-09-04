-- AlterTable
ALTER TABLE `dtf_uv` ADD COLUMN `contorno_grosor_px` INTEGER NOT NULL DEFAULT 12,
    ADD COLUMN `estado_contorno_bordado` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    ADD COLUMN `mensaje_error_contorno_bordado` TEXT NULL;

