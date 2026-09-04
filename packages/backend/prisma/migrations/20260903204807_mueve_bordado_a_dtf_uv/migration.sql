-- AlterTable
ALTER TABLE `dtf_uv` ADD COLUMN `estado_bordado` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    ADD COLUMN `mensaje_error_bordado` TEXT NULL,
    ADD COLUMN `ruta_pre_bordado` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `imagenes` DROP COLUMN `estado_bordado`,
    DROP COLUMN `ruta_pre_bordado`;

-- AlterTable
ALTER TABLE `jobs` MODIFY `tipo` ENUM('quitar_fondo', 'upscale') NOT NULL;

