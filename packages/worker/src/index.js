import "dotenv/config";
import { Worker } from "bullmq";
import sharp from "sharp";
import { prisma } from "../../backend/src/db.js";
import { guardar, leer } from "../../backend/src/lib/storage.js";
import { exportarLienzo } from "../../backend/src/lib/exportarLienzo.js";

// Debe coincidir con NOMBRE_COLA en packages/backend/src/lib/queue.js
const NOMBRE_COLA = "procesamiento-imagenes";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

async function llamarAiService(endpoint, buffer, filename) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  const resp = await fetch(`${AI_SERVICE_URL}${endpoint}`, { method: "POST", body: form });
  if (!resp.ok) {
    const detalle = await resp.text().catch(() => "");
    throw new Error(`ai-service ${endpoint} respondió ${resp.status}: ${detalle}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function procesarQuitarFondo(imagen) {
  const original = await leer(imagen.ruta_original);
  const resultado = await llamarAiService("/quitar-fondo", original, imagen.nombre_original ?? "imagen.png");
  const meta = await sharp(resultado).metadata();
  const ruta_procesada = await guardar("procesadas", resultado, ".png");
  await prisma.imagen.update({
    where: { id: imagen.id },
    data: {
      ruta_procesada,
      ancho_px: meta.width,
      alto_px: meta.height,
      estado_fondo: "listo",
    },
  });
}

async function procesarUpscale(imagen) {
  const fuente = await leer(imagen.ruta_procesada ?? imagen.ruta_original);
  const resultado = await llamarAiService("/upscale", fuente, imagen.nombre_original ?? "imagen.png");
  const meta = await sharp(resultado).metadata();
  const ruta_procesada = await guardar("procesadas", resultado, ".png");
  await prisma.imagen.update({
    where: { id: imagen.id },
    data: {
      ruta_procesada,
      ancho_px: meta.width,
      alto_px: meta.height,
      estado_upscale: "listo",
    },
  });
}

const PROCESADORES = { quitar_fondo: procesarQuitarFondo, upscale: procesarUpscale };
const CAMPO_ESTADO = { quitar_fondo: "estado_fondo", upscale: "estado_upscale" };

const worker = new Worker(
  NOMBRE_COLA,
  async (job) => {
    const { imagenId, tipo } = job.data;

    // El render del export no es un job de imagen: no tiene imagen_id ni fila
    // en la tabla `jobs` (su seguimiento vive en entregas_lienzo), así que se
    // atiende antes de la lógica común de más abajo.
    if (tipo === "exportar_lienzo") {
      const { ruta_export, bytes } = await exportarLienzo(job.data.lienzoId);
      console.log(`[worker] lienzo ${job.data.lienzoId} exportado (${(bytes / 1e6).toFixed(1)}MB) -> ${ruta_export}`);
      return;
    }

    const imagen = await prisma.imagen.findUnique({ where: { id: imagenId } });
    if (!imagen) throw new Error(`imagen ${imagenId} no existe`);

    const registroJob = await prisma.job.findFirst({
      where: { imagen_id: imagenId, tipo, estado: "en_cola" },
      orderBy: { id: "desc" },
    });
    if (registroJob) {
      await prisma.job.update({ where: { id: registroJob.id }, data: { estado: "procesando", iniciado_en: new Date() } });
    }

    try {
      await prisma.imagen.update({ where: { id: imagenId }, data: { [CAMPO_ESTADO[tipo]]: "procesando" } });
      await PROCESADORES[tipo](imagen);
      if (registroJob) {
        await prisma.job.update({ where: { id: registroJob.id }, data: { estado: "listo", terminado_en: new Date() } });
      }
    } catch (err) {
      await prisma.imagen.update({ where: { id: imagenId }, data: { [CAMPO_ESTADO[tipo]]: "error" } });
      if (registroJob) {
        await prisma.job.update({
          where: { id: registroJob.id },
          data: { estado: "error", mensaje_error: String(err.message ?? err), terminado_en: new Date() },
        });
      }
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1) }
);

worker.on("completed", (job) => console.log(`[worker] job ${job.id} (${job.name}) listo`));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} (${job?.name}) falló:`, err.message));

console.log(`[worker] escuchando cola "${NOMBRE_COLA}" con concurrencia ${worker.opts.concurrency}`);
