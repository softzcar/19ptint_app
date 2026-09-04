-- Copia local estructurada de país/estado/ciudad del cliente en el pedido
-- (pendiente de sincronizar con el contrato real de Ninesys para estos 3
-- campos -- ver comentario en crearCliente(), lib/ninesysApi.js).
ALTER TABLE `lienzos`
  ADD COLUMN `cliente_pais` VARCHAR(100) NULL,
  ADD COLUMN `cliente_estado` VARCHAR(100) NULL,
  ADD COLUMN `cliente_ciudad` VARCHAR(100) NULL;
