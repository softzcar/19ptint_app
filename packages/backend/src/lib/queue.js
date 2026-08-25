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

// Render del export de un lienzo, fuera del request. A diferencia de los
// jobs de imagen no lleva fila en la tabla `jobs`: esa tabla está atada a
// imagen_id, y el seguimiento de este trabajo ya lo hace la propia entrega
// (estado/intentos/ultimo_error en entregas_lienzo).
export async function encolarExportLienzo(lienzoId) {
  await colaProcesamiento.add(
    "exportar_lienzo",
    { lienzoId, tipo: "exportar_lienzo" },
    { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 10_000 } }
  );
}
