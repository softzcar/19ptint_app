-- AlterTable
ALTER TABLE `dtf_uv` MODIFY `estado_capas` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    MODIFY `estado_export` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido';
