-- AlterTable: login de clientes por teléfono. email pasa a opcional (sigue
-- siendo obligatorio en la práctica para las cuentas admin/staff, la
-- aplicación lo exige ahí; acá solo se relaja la restricción de la base
-- para permitir cuentas de cliente que no tienen email en absoluto).
ALTER TABLE `usuarios`
  MODIFY COLUMN `email` VARCHAR(150) NULL,
  ADD COLUMN `telefono` VARCHAR(20) NULL,
  ADD UNIQUE INDEX `usuarios_telefono_key` (`telefono`);
