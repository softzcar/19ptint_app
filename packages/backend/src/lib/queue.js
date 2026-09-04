import { Queue } from "bullmq";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

export const NOMBRE_COLA = "procesamiento-imagenes";

export const colaProcesamiento = new Queue(NOMBRE_COLA, { connection });

export async function encolarJob(imagenId, tipo) {
  await colaProcesamiento.add(
    tipo,
    { imagenId, tipo },
    { removeOnComplete: 100, removeOnFail: 100 }
  );
}

// Jobs que NO están atados a una imagen (exportar_lienzo, y los de DTF UV:
// vectorizar/proponer-capas/exportar) -- no llevan fila en la tabla `jobs`
// (esa tabla está atada a imagen_id): cada uno trackea su propio estado en
// columnas de su propio modelo (Lienzo/EntregaLienzo, DtfUv). Ver el
// registro MANEJADORES_SIN_IMAGEN en packages/worker/src/index.js.
export async function encolarJobSinImagen(tipo, payload) {
  await colaProcesamiento.add(
    tipo,
    { ...payload, tipo },
    { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 10_000 } }
  );
}

export async function encolarExportLienzo(lienzoId) {
  await encolarJobSinImagen("exportar_lienzo", { lienzoId });
}
