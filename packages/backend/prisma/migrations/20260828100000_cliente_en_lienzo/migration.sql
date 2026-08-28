-- AlterTable: datos del cliente y fecha del pedido, para poder nombrar el
-- archivo que baja a la PC de producción sin depender de consultar Ninesys.
ALTER TABLE `lienzos`
  ADD COLUMN `cliente_nombre` VARCHAR(100) NULL,
  ADD COLUMN `cliente_apellido` VARCHAR(100) NULL,
  ADD COLUMN `pedido_en` DATETIME(3) NULL;

-- Los lienzos que ya se habían pedido antes de este cambio no tienen la
-- fecha registrada: se usa la de creación como mejor aproximación, así no
-- quedan con nombre de archivo sin fecha.
UPDATE `lienzos` SET `pedido_en` = `created_at` WHERE `id_presupuesto_ninesys` IS NOT NULL;
