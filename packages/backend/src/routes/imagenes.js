import { Router } from "express";
import multer from "multer";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { guardar, leer } from "../lib/storage.js";
import { encolarJob } from "../lib/queue.js";
import { cargarProyecto } from "./proyectos.js";
import { buscarImagenes } from "../lib/pexels.js";
import { verificarLimiteDiario } from "../lib/limites.js";

export const imagenesRouter = Router();
imagenesRouter.use(requireAuth);

// Límites de imagen de entrada (CONTEXTO.md §5, §10).
//
// El tope anterior de 4000px era MÁS CHICO que el propio lienzo: a 300dpi un
// DTF de 58cm son 6.850px y una sublimación de 158cm son 18.661px, así que
// era imposible subir una imagen capaz de cubrir esos anchos a calidad plena.
//
// 12.000px cubre el DTF de 58cm con holgura y una sublimación de hasta ~101cm.
// Pero el lado no es lo que consume memoria: un banner de 18.000x500 son solo
// 9MP (inofensivo) y un 12.000x12.000 son 144MP (~580MB en crudo). Por eso el
// guard real es por ÁREA -- 60MP ≈ 240MB en crudo, con margen de sobra sobre
// los ~4GB libres del VPS, que además es compartido con otros sitios (ver el
// incidente de §14, donde un trabajo pesado tumbó el servidor entero).
const MAX_LADO_PX = 12000;
const MAX_MEGAPIXELES = 60;
// Techo absoluto de decodificación: por encima de esto ni siquiera se intenta
// abrir la imagen, porque el decode en sí ya arriesga la memoria del VPS.
const MAX_MEGAPIXELES_DECODE = 200;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Formatos que un navegador puede mostrar tal cual en un <img>. Todo lo que
// no esté acá (TIFF, BMP, HEIC de iPhone...) se convierte a PNG al entrar:
// si no, el archivo se guarda bien pero después no hay forma de previsualizarlo.
export const MIME_POR_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/**
 * Formato de salida servible para el navegador, o null si hay que convertir.
 * sharp reporta AVIF y HEIC ambos como "heif": se distinguen por el códec
 * (av1 = AVIF, que los navegadores modernos sí muestran; hevc = HEIC de
 * iPhone, que no).
 */
function formatoServible(meta) {
  if (meta.format === "png") return { ext: ".png", mime: "image/png" };
  if (meta.format === "jpeg") return { ext: ".jpg", mime: "image/jpeg" };
  if (meta.format === "webp") return { ext: ".webp", mime: "image/webp" };
  if (meta.format === "gif") return { ext: ".gif", mime: "image/gif" };
  if (meta.format === "heif" && meta.compression === "av1") return { ext: ".avif", mime: "image/avif" };
  return null;
}

/**
 * Deja la imagen dentro de límites seguros y en un formato que el navegador
 * pueda mostrar. En vez de rechazar por tamaño (que es lo que hacía antes y
 * bloqueaba trabajos legítimos), la reduce conservando la proporción: por
 * encima de estos tamaños los píxeles sobrantes no aportan nada imprimible
 * -- el acomodo igual capa el ancho al del lienzo.
 *
 * Devuelve también `ext`, que pasa a ser la fuente de verdad del formato
 * real del archivo guardado (antes se usaba la extensión del nombre subido,
 * que puede mentir, y el archivo se servía siempre como image/png).
 */
async function normalizarEntrada(buffer, nombreOriginal) {
  const meta = await sharp(buffer, { limitInputPixels: MAX_MEGAPIXELES_DECODE * 1e6 })
    .metadata()
    .catch(() => {
      throw new Error(
        `${nombreOriginal}: la imagen es demasiado grande para procesarla (máximo ${MAX_MEGAPIXELES_DECODE} megapíxeles)`
      );
    });

  const ancho = meta.width ?? 0;
  const alto = meta.height ?? 0;
  if (!ancho || !alto) throw new Error(`${nombreOriginal}: no se pudo leer el tamaño de la imagen`);

  const megapixeles = (ancho * alto) / 1e6;
  const cabeEnLimites = ancho <= MAX_LADO_PX && alto <= MAX_LADO_PX && megapixeles <= MAX_MEGAPIXELES;
  const servible = formatoServible(meta);

  // Caso feliz: entra tal cual y el navegador sabe mostrarlo -> no se toca ni
  // un byte (re-encodear degradaría la imagen sin ninguna necesidad).
  if (cabeEnLimites && servible) {
    return { buffer, metadata: meta, ext: servible.ext };
  }

  let pipeline = sharp(buffer, { limitInputPixels: MAX_MEGAPIXELES_DECODE * 1e6 });

  if (!cabeEnLimites) {
    // Se aplica el factor más restrictivo entre el del lado y el del área.
    const factor = Math.min(
      MAX_LADO_PX / ancho,
      MAX_LADO_PX / alto,
      Math.sqrt(MAX_MEGAPIXELES / megapixeles),
      1
    );
    const nuevoAncho = Math.max(1, Math.round(ancho * factor));
    const nuevoAlto = Math.max(1, Math.round(alto * factor));
    pipeline = pipeline.resize(nuevoAncho, nuevoAlto, { fit: "inside" });
    console.log(
      `[imagenes] ${nombreOriginal}: ${ancho}x${alto} (${megapixeles.toFixed(1)}MP) reducida a ${nuevoAncho}x${nuevoAlto}`
    );
  }

  // Al re-encodear se elige un formato explícito y no el de entrada: sharp
  // puede LEER formatos que no sabe escribir (ej. AVIF sin encoder), así que
  // dejarlo implícito rompería. JPEG se mantiene para no inflar fotos; todo
  // lo demás sale PNG, que es sin pérdida y lo muestra cualquier navegador.
  const salida = meta.format === "jpeg" ? { ext: ".jpg", aplicar: (p) => p.jpeg({ quality: 95 }) } : { ext: ".png", aplicar: (p) => p.png() };
  if (!servible) {
    console.log(`[imagenes] ${nombreOriginal}: formato ${meta.format} no se puede mostrar en el navegador, se convierte a ${salida.ext}`);
  }

  const procesado = await salida.aplicar(pipeline).toBuffer();
  return { buffer: procesado, metadata: await sharp(procesado).metadata(), ext: salida.ext };
}

// Crea la imagen tal cual se subió (con su fondo original, sin pasar por la
// IA) -- comparte el mismo camino tanto si el archivo viene de una subida
// manual como de la búsqueda web. El quitado de fondo ahora es opcional: se
// dispara solo si el usuario prende el switch (POST /imagenes/:id/quitar-fondo).
async function crearImagenDesdeBuffer(proyectoId, bufferEntrada, nombreOriginal) {
  // La extensión sale del formato REAL detectado, no del nombre que subió el
  // usuario: ese puede mentir, y de esa extensión depende con qué
  // Content-Type se sirve después el archivo.
  const { buffer, metadata, ext } = await normalizarEntrada(bufferEntrada, nombreOriginal);
  const ruta_original = await guardar("originales", buffer, ext);
  return prisma.imagen.create({
    data: {
      proyecto_id: proyectoId,
      nombre_original: nombreOriginal,
      ruta_original,
      ruta_procesada: ruta_original,
      ancho_px: metadata.width,
      alto_px: metadata.height,
      estado_fondo: "listo",
      quitar_fondo: false,
    },
  });
}

imagenesRouter.post(
  "/proyectos/:id/imagenes",
  cargarProyecto,
  upload.array("imagenes", 20),
  async (req, res) => {
    if (!req.files?.length) {
      return res.status(400).json({ error: "No se recibieron archivos" });
    }

    const creadas = [];
    for (const file of req.files) {
      try {
        creadas.push(await crearImagenDesdeBuffer(req.proyecto.id, file.buffer, file.originalname));
      } catch (err) {
        return res.status(err.status ?? 400).json({ error: err.message });
      }
    }

    res.status(201).json(creadas);
  }
);

// El generador de texto (frontend, Canvas) ya entrega un PNG con fondo
// transparente real, así que se salta la cola de IA por completo: se crea
// la imagen directamente en estado "listo".
imagenesRouter.post(
  "/proyectos/:id/imagenes/generada",
  cargarProyecto,
  upload.single("imagen"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No se recibió la imagen" });
    let buffer, metadata;
    try {
      ({ buffer, metadata } = await normalizarEntrada(req.file.buffer, req.file.originalname || "texto.png"));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const ruta = await guardar("originales", buffer, ".png");
    const imagen = await prisma.imagen.create({
      data: {
        proyecto_id: req.proyecto.id,
        nombre_original: req.file.originalname || "texto.png",
        ruta_original: ruta,
        ruta_procesada: ruta,
        ancho_px: metadata.width,
        alto_px: metadata.height,
        estado_fondo: "listo",
        quitar_fondo: false, // ya nace transparente, no pasó por el quitado de fondo
      },
    });
    res.status(201).json(imagen);
  }
);

// Búsqueda de imágenes de stock (Pexels) para usar como diseño de partida
// sin salir de la app — ver lib/pexels.js sobre por qué se eligió ese banco.
imagenesRouter.get("/imagenes/buscar-web", async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  const pagina = Number(req.query.pagina) || 1;
  if (!q) return res.status(400).json({ error: "Falta el término de búsqueda" });
  try {
    const resultados = await buscarImagenes(q, pagina);
    res.json(resultados);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Solo se permite descargar desde el CDN de Pexels (evita que este endpoint
// se use para traer cualquier URL arbitraria al servidor).
const HOSTS_PERMITIDOS_DESCARGA = new Set(["images.pexels.com"]);

imagenesRouter.post("/proyectos/:id/imagenes/desde-web", cargarProyecto, async (req, res) => {
  const { url, nombre } = req.body ?? {};
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "URL de imagen inválida" });
  }
  if (parsed.protocol !== "https:" || !HOSTS_PERMITIDOS_DESCARGA.has(parsed.hostname)) {
    return res.status(400).json({ error: "Solo se permiten imágenes provenientes del buscador" });
  }

  let buffer;
  try {
    const resp = await fetch(parsed.toString());
    if (!resp.ok) throw new Error(`descarga respondió ${resp.status}`);
    buffer = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    return res.status(502).json({ error: `No se pudo descargar la imagen: ${err.message}` });
  }

  try {
    const imagen = await crearImagenDesdeBuffer(req.proyecto.id, buffer, nombre || "imagen-web.jpg");
    res.status(201).json(imagen);
  } catch (err) {
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

async function cargarImagenPropia(req, res, next) {
  const id = Number(req.params.id);
  const imagen = await prisma.imagen.findFirst({
    where: { id, proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } },
    include: { proyecto: { select: { usuario_id: true } } },
  });
  if (!imagen) return res.status(404).json({ error: "Imagen no encontrada" });
  req.imagen = imagen;
  next();
}

imagenesRouter.get("/imagenes/:id", cargarImagenPropia, (req, res) => res.json(req.imagen));

imagenesRouter.patch("/imagenes/:id", cargarImagenPropia, async (req, res) => {
  const { ancho_mm, alto_mm, copias } = req.body ?? {};
  const data = {};
  if (ancho_mm !== undefined) data.ancho_mm = ancho_mm;
  if (alto_mm !== undefined) data.alto_mm = alto_mm;
  if (copias !== undefined) data.copias = copias;
  const imagen = await prisma.imagen.update({ where: { id: req.imagen.id }, data });
  res.json(imagen);
});

// Revierte a la imagen original (con fondo) sin pasar por la IA: es
// instantáneo, no hay job ni cola de por medio. ancho_px/alto_px se
// recalculan desde el original porque el quitado de fondo los había
// sobrescrito con las dimensiones recortadas al bounding box.
imagenesRouter.post("/imagenes/:id/mantener-fondo", cargarImagenPropia, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.imagen.estado_fondo)) {
    return res.status(409).json({ error: "Esperá a que termine de procesar antes de cambiar esta opción" });
  }
  const buffer = await leer(req.imagen.ruta_original);
  const metadata = await sharp(buffer).metadata();
  const imagen = await prisma.imagen.update({
    where: { id: req.imagen.id },
    data: {
      ruta_procesada: req.imagen.ruta_original,
      ancho_px: metadata.width,
      alto_px: metadata.height,
      estado_fondo: "listo",
      quitar_fondo: false,
    },
  });
  res.json(imagen);
});

// Vuelve a encolar el quitado de fondo real (ej. tras haber elegido
// "mantener fondo" antes) -- mismo camino que al subir el archivo.
imagenesRouter.post("/imagenes/:id/quitar-fondo", cargarImagenPropia, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.imagen.estado_fondo)) {
    return res.status(409).json({ error: "Ya se está procesando" });
  }
  try {
    await verificarLimiteDiario(req.imagen.proyecto.usuario_id);
  } catch (err) {
    return res.status(err.status ?? 400).json({ error: err.message });
  }
  await prisma.imagen.update({
    where: { id: req.imagen.id },
    data: { estado_fondo: "pendiente", quitar_fondo: true },
  });
  await prisma.job.create({ data: { imagen_id: req.imagen.id, tipo: "quitar_fondo" } });
  await encolarJob(req.imagen.id, "quitar_fondo");
  res.status(202).json({ ok: true });
});

imagenesRouter.post("/imagenes/:id/upscale", cargarImagenPropia, async (req, res) => {
  if (req.imagen.estado_fondo !== "listo") {
    return res.status(409).json({ error: "El quitado de fondo debe estar listo antes de hacer upscale" });
  }
  try {
    await verificarLimiteDiario(req.imagen.proyecto.usuario_id);
  } catch (err) {
    return res.status(err.status ?? 400).json({ error: err.message });
  }
  await prisma.imagen.update({ where: { id: req.imagen.id }, data: { estado_upscale: "pendiente" } });
  await prisma.job.create({ data: { imagen_id: req.imagen.id, tipo: "upscale" } });
  await encolarJob(req.imagen.id, "upscale");
  res.status(202).json({ ok: true });
});

// El upscale corre en el navegador del cliente (UpscalerJS, ver
// lib/upscaleCliente.js del frontend) — acá solo se guarda el resultado ya
// calculado, sin Job ni cola de IA de por medio (a diferencia de
// /imagenes/:id/upscale, que sí delega al worker/ai-service). Ver CONTEXTO.md
// sobre por qué se movió del VPS al cliente.
imagenesRouter.post(
  "/imagenes/:id/upscale-cliente",
  cargarImagenPropia,
  upload.single("imagen"),
  async (req, res) => {
    if (req.imagen.estado_fondo !== "listo") {
      return res.status(409).json({ error: "El quitado de fondo debe estar listo antes de hacer upscale" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió la imagen" });
    const metadata = await sharp(req.file.buffer).metadata();
    const ruta_procesada = await guardar("procesadas", req.file.buffer, ".png");
    const imagen = await prisma.imagen.update({
      where: { id: req.imagen.id },
      data: {
        ruta_procesada,
        estado_upscale: "listo",
        ancho_px: metadata.width,
        alto_px: metadata.height,
      },
    });
    res.json(imagen);
  }
);

imagenesRouter.delete("/imagenes/:id", cargarImagenPropia, async (req, res) => {
  await prisma.imagen.delete({ where: { id: req.imagen.id } });
  res.status(204).end();
});

imagenesRouter.get("/imagenes/:id/archivo", cargarImagenPropia, async (req, res) => {
  const variante = req.query.variante === "original" ? "original" : "procesada";
  const ruta = variante === "original" ? req.imagen.ruta_original : req.imagen.ruta_procesada;
  if (!ruta) return res.status(404).json({ error: "Archivo no disponible todavía" });
  const buffer = await leer(ruta);
  // El Content-Type sale del formato REAL del archivo, no fijo en image/png.
  // Estaba hardcodeado y el original se guarda en su formato de origen: al
  // subir un AVIF/WebP se servían esos bytes declarados como PNG, y el
  // navegador no los podía mostrar (con blob: confía en el tipo declarado, no
  // lo deduce de los bytes) -- la imagen quedaba en negro.
  const mime = MIME_POR_EXT[path.extname(ruta).toLowerCase()] ?? "image/png";
  // La URL no cambia aunque ruta_procesada sí (revertir/quitar fondo,
  // upscale): sin esto, el caché de LiteSpeed (module cache del vhost, por
  // tipo MIME) y el del propio navegador sirven la versión vieja por días
  // aunque el archivo real ya haya cambiado.
  res.set("Content-Type", mime).set("Cache-Control", "no-store").send(buffer);
});
