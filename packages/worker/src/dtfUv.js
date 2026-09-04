// Procesadores de los jobs DTF UV, no ligados a una imagen (ver
// MANEJADORES_SIN_IMAGEN en index.js). Mismo rol que
// backend/src/lib/exportarLienzo.js: cada función carga su fila, hace el
// trabajo, y actualiza su propio estado_* -- no hay fila en la tabla `jobs`.
import sharp from "sharp";
import { prisma } from "../../backend/src/db.js";
import { guardar, leer, borrar } from "../../backend/src/lib/storage.js";
import { llamarAiService, llamarAiServiceSinArchivo, llamarAiServiceExportarTiff } from "./aiService.js";
import { exportarDtfUv } from "../../backend/src/lib/exportarDtfUv.js";
import { exportarHojaDtfUv } from "../../backend/src/lib/hojaDtfUv.js";

export async function procesarVectorizarDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_vectorizado: "procesando" } });

    const original = await leer(dtfUv.ruta_original);
    const svgBuffer = await llamarAiService("/vectorizar", original, dtfUv.nombre_original ?? "logo.png");
    const ruta_vector = await guardar("dtf_uv", svgBuffer, ".svg");

    const meta = await sharp(original).metadata();
    const siluetaBuffer = await llamarAiService(
      "/rasterizar-silueta",
      svgBuffer,
      "vector.svg",
      { ancho_px: meta.width, alto_px: meta.height },
      "svg"
    );
    const ruta_silueta = await guardar("dtf_uv", siluetaBuffer, ".png");

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { ruta_vector, ruta_silueta, estado_vectorizado: "listo", mensaje_error_vector: null },
    });
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_vectorizado: "error", mensaje_error_vector: String(err.message ?? err) },
    });
    throw err;
  }
}

export async function procesarProponerCapasDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);
  if (!dtfUv.ruta_silueta) throw new Error(`dtf_uv ${dtfUvId} no tiene silueta vectorizada todavía`);

  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_capas: "procesando" } });

    const silueta = await leer(dtfUv.ruta_silueta);
    const mascara = await llamarAiService("/proponer-capas", silueta, "silueta.png", {
      grosor_relieve_px: dtfUv.grosor_relieve_px,
      sensibilidad: dtfUv.sensibilidad,
    });

    // La misma propuesta se guarda dos veces como archivos independientes:
    // a partir de acá blanco y barniz se editan por separado (ver
    // ruta_mascara_blanco/ruta_mascara_barniz en el schema).
    const ruta_mascara_blanco = await guardar("dtf_uv", mascara, ".png");
    const ruta_mascara_barniz = await guardar("dtf_uv", mascara, ".png");

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { ruta_mascara_blanco, ruta_mascara_barniz, estado_capas: "listo", mensaje_error_capas: null },
    });
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_capas: "error", mensaje_error_capas: String(err.message ?? err) },
    });
    throw err;
  }
}

// Efecto visual tipo bordado sobre el original subido -- movido acá desde
// el flujo genérico de Imagen porque conceptualmente es parte de DTF UV.
// Mismo patrón que procesarUpscale de Imagen: reemplaza ruta_original y
// guarda el archivo de antes en ruta_pre_bordado para poder deshacerlo.
export async function procesarEfectoBordadoDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_bordado: "procesando" } });

    const original = await leer(dtfUv.ruta_original);
    const resultado = await llamarAiService("/efecto-bordado", original, dtfUv.nombre_original ?? "logo.png", {
      paso_px: dtfUv.bordado_paso_px,
      largo_px: dtfUv.bordado_largo_px,
    });
    const ruta_original = await guardar("dtf_uv", resultado, ".png");

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: {
        ruta_pre_bordado: dtfUv.ruta_original,
        ruta_original,
        estado_bordado: "listo",
        mensaje_error_bordado: null,
      },
    });
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_bordado: "error", mensaje_error_bordado: String(err.message ?? err) },
    });
    throw err;
  }
}

// Segunda capa de bordado: solo el contorno (letras/logo/imágenes), sin
// rellenar el interior -- escribe directo a ruta_mascara_blanco (Spot1/
// Spot2), como punto de partida editable después en el editor de relieve.
export async function procesarBordadoContornoDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_contorno_bordado: "procesando" } });

    const original = await leer(dtfUv.ruta_original);
    const resultado = await llamarAiService("/bordar-contorno", original, dtfUv.nombre_original ?? "logo.png", {
      paso_px: dtfUv.bordado_paso_px,
      largo_px: dtfUv.bordado_largo_px,
      grosor_contorno_px: dtfUv.contorno_grosor_px,
    });
    const ruta_mascara_blanco = await guardar("dtf_uv", resultado, ".png");
    const anteriorPre = dtfUv.ruta_pre_mascara_blanco;

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: {
        ruta_mascara_blanco,
        // Guarda el valor de ANTES para poder deshacer (POST
        // /dtf-uv/:id/revertir-mascara-blanco), sin importar si lo generó
        // esto, el patrón IA, o quedó del editor.
        ruta_pre_mascara_blanco: dtfUv.ruta_mascara_blanco,
        estado_contorno_bordado: "listo",
        mensaje_error_contorno_bordado: null,
      },
    });
    if (anteriorPre && anteriorPre !== dtfUv.ruta_mascara_blanco) await borrar(anteriorPre);
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_contorno_bordado: "error", mensaje_error_contorno_bordado: String(err.message ?? err) },
    });
    throw err;
  }
}

// Genera una TEXTURA con Gemini a partir de una instrucción de texto (ver
// generar_patron_ia() en ai-service/app/procesamiento.py) -- guarda un PNG
// aparte (ruta_patron_ia) con transparencia real, NO reemplaza ninguna
// máscara directo: el editor de relieve la aplica como relleno (canvas
// pattern) sobre las regiones del vector ya activas, no es capa-específica.
export async function procesarGenerarPatronIaDtfUv(dtfUvId, prompt) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_patron_ia: "procesando" } });

    const resultado = await llamarAiServiceSinArchivo("/generar-patron-ia", { prompt });
    const rutaNueva = await guardar("dtf_uv", resultado, ".png");
    const anterior = dtfUv.ruta_patron_ia;

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { ruta_patron_ia: rutaNueva, estado_patron_ia: "listo", mensaje_error_patron_ia: null },
    });
    if (anterior) await borrar(anterior);
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_patron_ia: "error", mensaje_error_patron_ia: String(err.message ?? err) },
    });
    throw err;
  }
}

// Export vectorial del diseño suelto (Fase 5 del plan original): PDF con
// las 4 separaciones spot reales (ver exportarDtfUv() en el backend), sin
// marcas de registro ni copias, + TIFF multicanal (CMYK en blanco + 4
// canales spot nombrados "W1"/"W1 copy"/"V"/"V copy", ver
// exportar_tiff_spot() en el ai-service) -- mismo par de formatos desde el
// principio del plan, ambos de la misma fuente (las máscaras editadas).
export async function procesarExportarDtfUv(dtfUvId) {
  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_export: "procesando" } });
    await exportarDtfUv(dtfUvId);

    const dtfUv = await prisma.dtfUv.findUnique({ where: { id: dtfUvId } });
    const mascaraBlanco = await leer(dtfUv.ruta_mascara_blanco);
    const mascaraBarniz = await leer(dtfUv.ruta_mascara_barniz);
    const tiffBuffer = await llamarAiServiceExportarTiff(mascaraBlanco, mascaraBarniz, dtfUv.ancho_mm, dtfUv.alto_mm);
    const ruta_export_tiff = await guardar("dtf_uv", tiffBuffer, ".tiff");
    const anteriorTiff = dtfUv.ruta_export_tiff;

    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { ruta_export_tiff, estado_export: "listo", mensaje_error_export: null },
    });
    if (anteriorTiff && anteriorTiff !== ruta_export_tiff) await borrar(anteriorTiff);
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_export: "error", mensaje_error_export: String(err.message ?? err) },
    });
    throw err;
  }
}

// "Armar hoja": PDF con N copias del mismo diseño + marcas de registro
// ARMS + contorno de corte real (silueta vectorizada) -- ver
// exportarHojaDtfUv()/construirHojaPdf() en el backend
// (packages/backend/src/lib/hojaDtfUv.js).
export async function procesarExportarHojaDtfUv(dtfUvId) {
  try {
    await prisma.dtfUv.update({ where: { id: dtfUvId }, data: { estado_hoja: "procesando" } });
    await exportarHojaDtfUv(dtfUvId);
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_hoja: "listo", mensaje_error_hoja: null },
    });
  } catch (err) {
    await prisma.dtfUv.update({
      where: { id: dtfUvId },
      data: { estado_hoja: "error", mensaje_error_hoja: String(err.message ?? err) },
    });
    throw err;
  }
}
