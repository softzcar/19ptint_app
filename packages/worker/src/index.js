import "dotenv/config";
import { Worker } from "bullmq";
import sharp from "sharp";
import { prisma } from "../../backend/src/db.js";
import { guardar, leer } from "../../backend/src/lib/storage.js";
import { exportarLienzo } from "../../backend/src/lib/exportarLienzo.js";
import { llamarAiService } from "./aiService.js";
import {
  procesarVectorizarDtfUv,
  procesarProponerCapasDtfUv,
  procesarExportarDtfUv,
  procesarExportarHojaDtfUv,
  procesarEfectoBordadoDtfUv,
  procesarBordadoContornoDtfUv,
  procesarGenerarPatronIaDtfUv,
} from "./dtfUv.js";

// Debe coincidir con NOMBRE_COLA en packages/backend/src/lib/queue.js
const NOMBRE_COLA = "procesamiento-imagenes";
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

async function procesarQuitarFondo(imagen) {
  const original = await leer(imagen.ruta_original);
  const resultado = await llamarAiService("/quitar-fondo", original, imagen.nombre_original ?? "imagen.png");
  const meta = await sharp(resultado).metadata();
  const ruta_procesada = await guardar("procesadas", resultado, ".png");
  await prisma.imagen.update({
    where: { id: imagen.id },
    data: {
      ruta_procesada,
      // El resultado nuevo nunca viene upscaleado: cualquier upscale previo
      // corría sobre una imagen distinta (el fondo de antes), invalidarlo
      // acá evita que la tarjeta siga ofreciendo "deshacer" sobre un archivo
      // que ya no tiene relación con la imagen actual.
      ruta_pre_upscale: null,
      estado_upscale: "omitido",
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
      // Guarda el archivo de ANTES del upscale para poder deshacerlo (ver
      // POST /imagenes/:id/revertir-upscale) si el resultado sale mal.
      ruta_pre_upscale: imagen.ruta_procesada ?? imagen.ruta_original,
      ruta_procesada,
      ancho_px: meta.width,
      alto_px: meta.height,
      estado_upscale: "listo",
    },
  });
}

const PROCESADORES = { quitar_fondo: procesarQuitarFondo, upscale: procesarUpscale };
const CAMPO_ESTADO = { quitar_fondo: "estado_fondo", upscale: "estado_upscale" };

// Jobs que NO están atados a una imagen: no tienen imagen_id ni fila en la
// tabla `jobs` (su seguimiento vive en columnas de su propio modelo -- ver
// encolarJobSinImagen en lib/queue.js), así que se atienden antes de la
// lógica común de más abajo.
const MANEJADORES_SIN_IMAGEN = {
  exportar_lienzo: async ({ lienzoId }) => {
    const { ruta_export, bytes } = await exportarLienzo(lienzoId);
    console.log(`[worker] lienzo ${lienzoId} exportado (${(bytes / 1e6).toFixed(1)}MB) -> ${ruta_export}`);
  },
  vectorizar_dtf_uv: async ({ dtfUvId }) => procesarVectorizarDtfUv(dtfUvId),
  proponer_capas_dtf_uv: async ({ dtfUvId }) => procesarProponerCapasDtfUv(dtfUvId),
  exportar_dtf_uv: async ({ dtfUvId }) => procesarExportarDtfUv(dtfUvId),
  exportar_hoja_dtf_uv: async ({ dtfUvId }) => procesarExportarHojaDtfUv(dtfUvId),
  efecto_bordado_dtf_uv: async ({ dtfUvId }) => procesarEfectoBordadoDtfUv(dtfUvId),
  bordado_contorno_dtf_uv: async ({ dtfUvId }) => procesarBordadoContornoDtfUv(dtfUvId),
  generar_patron_ia_dtf_uv: async ({ dtfUvId, prompt }) => procesarGenerarPatronIaDtfUv(dtfUvId, prompt),
};

const worker = new Worker(
  NOMBRE_COLA,
  async (job) => {
    const { imagenId, tipo } = job.data;

    if (MANEJADORES_SIN_IMAGEN[tipo]) {
      await MANEJADORES_SIN_IMAGEN[tipo](job.data);
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
