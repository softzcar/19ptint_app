-- CreateTable
CREATE TABLE `servicios_ninesys_visibles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_empresa_ninesys` INTEGER NOT NULL,
    `cod` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `servicios_ninesys_visibles_id_empresa_ninesys_cod_key`(`id_empresa_ninesys`, `cod`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
