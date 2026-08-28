/*
  Warnings:

  - Made the column `precio` on table `servicios_ninesys_visibles` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `servicios_ninesys_visibles` MODIFY `precio` DECIMAL(10, 2) NOT NULL;
