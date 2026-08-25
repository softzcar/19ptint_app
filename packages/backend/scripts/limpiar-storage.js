#!/usr/bin/env node
/**
 * Retención y limpieza del storage. Pensado para correr por cron una vez al
 * día en el VPS.
 *
 *   node packages/backend/scripts/limpiar-storage.js [--dias=7] [--dry-run]
 *
 * Hace dos cosas:
 *
 *  1. Purga los exports ya entregados a la PC de la empresa hace más de N
 *     días. Borrar no pierde nada: el lienzo se puede volver a generar en
 *     segundos desde el diseño, que sigue en la base.
 *
 *  2. Barre huérfanos: archivos en storage/exports que ya no referencia
 *     ninguna fila. Se venían acumulando porque hasta ahora nada los borraba
 *     (cada re-exportación y cada re-acomodo dejaba uno de ~19MB atrás).
 *
 * Solo toca `exports`. Los originales y las procesadas son la fuente de
 * verdad de un proyecto vivo -- esas se borran únicamente vía el ON DELETE
 * CASCADE de la imagen, no por tiempo.
 */
import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/db.js";
import { borrar, tamano, STORAGE_DIR } from "../src/lib/storage.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dias = Number(args.find((a) => a.startsWith("--dias="))?.split("=")[1] ?? 7);

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)}MB`;
let liberado = 0;

async function purgarEntregados() {
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const entregas = await prisma.entregaLienzo.findMany({
    where: {
      estado: "entregado",
      entregado_en: { lt: corte },
      purgado_en: null,
      lienzo: { ruta_export: { not: null } },
    },
    include: { lienzo: true },
  });

  console.log(`\n[retención] ${entregas.length} entrega(s) confirmadas hace más de ${dias} día(s)`);
  for (const entrega of entregas) {
    const ruta = entrega.lienzo.ruta_export;
    let bytes = 0;
    try {
      bytes = await tamano(ruta);
    } catch {
      // ya no está en disco: igual se marca purgada para no reintentarla
    }

    if (dryRun) {
      console.log(`  [dry-run] borraría ${ruta} (${mb(bytes)}) — lienzo ${entrega.lienzo_id}`);
      liberado += bytes;
      continue;
    }

    await borrar(ruta);
    await prisma.$transaction([
      prisma.lienzo.update({ where: { id: entrega.lienzo_id }, data: { ruta_export: null } }),
      prisma.entregaLienzo.update({ where: { id: entrega.id }, data: { purgado_en: new Date() } }),
    ]);
    liberado += bytes;
    console.log(`  purgado ${ruta} (${mb(bytes)}) — lienzo ${entrega.lienzo_id}`);
  }
}

async function barrerHuerfanos() {
  const dir = path.join(STORAGE_DIR, "exports");
  let archivos;
  try {
    archivos = await readdir(dir);
  } catch (err) {
    console.log(`\n[huérfanos] no se pudo leer ${dir}: ${err.message}`);
    return;
  }

  const referenciadas = new Set(
    (await prisma.lienzo.findMany({ where: { ruta_export: { not: null } }, select: { ruta_export: true } })).map(
      (l) => path.basename(l.ruta_export)
    )
  );

  const huerfanos = archivos.filter((f) => !referenciadas.has(f));
  console.log(`\n[huérfanos] ${archivos.length} archivo(s) en exports, ${huerfanos.length} sin referencia`);

  for (const nombre of huerfanos) {
    const rel = path.join("exports", nombre);
    let bytes = 0;
    try {
      bytes = await tamano(rel);
    } catch {
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] borraría huérfano ${nombre} (${mb(bytes)})`);
      liberado += bytes;
      continue;
    }
    await borrar(rel);
    liberado += bytes;
    console.log(`  borrado huérfano ${nombre} (${mb(bytes)})`);
  }
}

async function main() {
  console.log(`limpiar-storage — retención ${dias} día(s)${dryRun ? " [DRY RUN, no borra nada]" : ""}`);
  console.log(`storage: ${STORAGE_DIR}`);
  await purgarEntregados();
  await barrerHuerfanos();
  console.log(`\n${dryRun ? "Se liberarían" : "Liberado"}: ${mb(liberado)}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("limpiar-storage falló:", err);
  await prisma.$disconnect();
  process.exit(1);
});
