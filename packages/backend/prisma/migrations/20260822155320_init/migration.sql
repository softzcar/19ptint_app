-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `rol` ENUM('admin', 'cliente') NOT NULL DEFAULT 'cliente',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usuarios_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proyectos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuario_id` INTEGER NOT NULL,
    `nombre` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `imagenes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proyecto_id` INTEGER NOT NULL,
    `nombre_original` VARCHAR(255) NULL,
    `ruta_original` VARCHAR(500) NULL,
    `ruta_procesada` VARCHAR(500) NULL,
    `ancho_px` INTEGER NULL,
    `alto_px` INTEGER NULL,
    `dpi` INTEGER NOT NULL DEFAULT 300,
    `ancho_mm` DECIMAL(8, 2) NULL,
    `alto_mm` DECIMAL(8, 2) NULL,
    `copias` INTEGER NOT NULL DEFAULT 1,
    `estado_fondo` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'pendiente',
    `estado_upscale` ENUM('pendiente', 'procesando', 'listo', 'error', 'omitido') NOT NULL DEFAULT 'omitido',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `imagen_id` INTEGER NOT NULL,
    `tipo` ENUM('quitar_fondo', 'upscale') NOT NULL,
    `estado` ENUM('en_cola', 'procesando', 'listo', 'error') NOT NULL DEFAULT 'en_cola',
    `mensaje_error` TEXT NULL,
    `iniciado_en` DATETIME(3) NULL,
    `terminado_en` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lienzos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proyecto_id` INTEGER NOT NULL,
    `tipo` ENUM('dtf', 'sublimacion') NOT NULL,
    `ancho_mm` DECIMAL(8, 2) NOT NULL,
    `margen_mm` DECIMAL(6, 2) NOT NULL DEFAULT 5,
    `alto_usado_mm` DECIMAL(10, 2) NULL,
    `formato_exportacion` ENUM('png', 'pdf', 'jpeg') NOT NULL,
    `ruta_export` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lienzo_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lienzo_id` INTEGER NOT NULL,
    `imagen_id` INTEGER NOT NULL,
    `x_mm` DECIMAL(10, 2) NULL,
    `y_mm` DECIMAL(10, 2) NULL,
    `ancho_mm` DECIMAL(8, 2) NULL,
    `alto_mm` DECIMAL(8, 2) NULL,
    `rotacion` SMALLINT NOT NULL DEFAULT 0,
    `orden` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `proyectos` ADD CONSTRAINT `proyectos_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `imagenes` ADD CONSTRAINT `imagenes_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_imagen_id_fkey` FOREIGN KEY (`imagen_id`) REFERENCES `imagenes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lienzos` ADD CONSTRAINT `lienzos_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lienzo_items` ADD CONSTRAINT `lienzo_items_lienzo_id_fkey` FOREIGN KEY (`lienzo_id`) REFERENCES `lienzos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lienzo_items` ADD CONSTRAINT `lienzo_items_imagen_id_fkey` FOREIGN KEY (`imagen_id`) REFERENCES `imagenes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
