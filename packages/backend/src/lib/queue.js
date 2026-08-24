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
