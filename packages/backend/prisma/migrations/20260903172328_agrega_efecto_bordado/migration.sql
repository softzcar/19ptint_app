-- AlterTable
ALTER TABLE `imagenes` ADD COLUMN `estado_bordado` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    ADD COLUMN `ruta_pre_bordado` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `jobs` MODIFY `tipo` ENUM('quitar_fondo', 'upscale', 'efecto_bordado') NOT NULL;
