-- CreateTable
CREATE TABLE `empresa_agentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_empresa_ninesys` INTEGER NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `token_hash` VARCHAR(64) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `ultimo_ping` DATETIME(3) NULL,
    `version_agente` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `empresa_agentes_id_empresa_ninesys_key`(`id_empresa_ninesys`),
    UNIQUE INDEX `empresa_agentes_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entregas_lienzo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lienzo_id` INTEGER NOT NULL,
    `empresa_agente_id` INTEGER NOT NULL,
    `estado` ENUM('pendiente', 'entregado', 'error') NOT NULL DEFAULT 'pendiente',
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `ultimo_error` TEXT NULL,
    `entregado_en` DATETIME(3) NULL,
    `purgado_en` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `entregas_lienzo_lienzo_id_key`(`lienzo_id`),
    INDEX `entregas_lienzo_empresa_agente_id_estado_idx`(`empresa_agente_id`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `entregas_lienzo` ADD CONSTRAINT `entregas_lienzo_lienzo_id_fkey`
    FOREIGN KEY (`lienzo_id`) REFERENCES `lienzos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entregas_lienzo` ADD CONSTRAINT `entregas_lienzo_empresa_agente_id_fkey`
    FOREIGN KEY (`empresa_agente_id`) REFERENCES `empresa_agentes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las dos únicas empresas que usan la app hoy (ver frontend/src/config/empresasNinesys.js).
-- Nacen sin token: se genera desde el panel de admin al instalar cada agente.
INSERT INTO `empresa_agentes` (`id_empresa_ninesys`, `nombre`) VALUES
    (194, 'Nineteen Custom'),
    (208, '19 Print');
