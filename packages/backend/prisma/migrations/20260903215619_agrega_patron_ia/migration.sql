-- AlterTable
ALTER TABLE `dtf_uv` ADD COLUMN `estado_patron_ia` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    ADD COLUMN `mensaje_error_patron_ia` TEXT NULL;

