-- CreateTable
CREATE TABLE `dtf_uv` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proyecto_id` INTEGER NOT NULL,
    `nombre_original` VARCHAR(255) NULL,
    `ruta_original` VARCHAR(500) NULL,
    `ruta_vector` VARCHAR(500) NULL,
    `ruta_silueta` VARCHAR(500) NULL,
    `estado_vectorizado` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'pendiente',
    `mensaje_error_vector` TEXT NULL,
    `grosor_relieve_px` INTEGER NOT NULL DEFAULT 6,
    `sensibilidad` INTEGER NOT NULL DEFAULT 50,
    `estado_capas` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'pendiente',
    `mensaje_error_capas` TEXT NULL,
    `ruta_mascara_blanco` VARCHAR(500) NULL,
    `ruta_mascara_barniz` VARCHAR(500) NULL,
    `ancho_mm` DECIMAL(8, 2) NULL,
    `alto_mm` DECIMAL(8, 2) NULL,
    `estado_export` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'pendiente',
    `mensaje_error_export` TEXT NULL,
    `ruta_export_pdf` VARCHAR(500) NULL,
    `ruta_export_tiff` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dtf_uv` ADD CONSTRAINT `dtf_uv_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
