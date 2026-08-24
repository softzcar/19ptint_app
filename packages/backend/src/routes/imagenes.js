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

// Tamaño máximo de imagen de entrada (CONTEXTO.md §5, §10) — controla los
// tiempos de quitado de fondo/upscale en CPU.
const MAX_LADO_PX = 4000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Crea la imagen y encola el quitado de fondo — comparte el mismo camino
// tanto si el archivo viene de una subida manual como de la búsqueda web.
async function crearImagenDesdeBuffer(proyectoId, usuarioId, buffer, nombreOriginal) {
  await verificarLimiteDiario(usuarioId);
  const metadata = await sharp(buffer).metadata();
  if ((metadata.width ?? 0) > MAX_LADO_PX || (metadata.height ?? 0) > MAX_LADO_PX) {
    throw new Error(`${nombreOriginal}: excede el tamaño máximo de entrada (${MAX_LADO_PX}px por lado)`);
  }
  const ext = path.extname(nombreOriginal) || `.${metadata.format ?? "jpg"}`;
  const ruta_original = await guardar("originales", buffer, ext);
  const imagen = await prisma.imagen.create({
    data: {
      proyecto_id: proyectoId,
      nombre_original: nombreOriginal,
      ruta_original,
      ancho_px: metadata.width,
      alto_px: metadata.height,
    },
  });
  await prisma.job.create({ data: { imagen_id: imagen.id, tipo: "quitar_fondo" } });
  await encolarJob(imagen.id, "quitar_fondo");
  return imagen;
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
        creadas.push(await crearImagenDesdeBuffer(req.proyecto.id, req.proyecto.usuario_id, file.buffer, file.originalname));
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
    const metadata = await sharp(req.file.buffer).metadata();
    if ((metadata.width ?? 0) > MAX_LADO_PX || (metadata.height ?? 0) > MAX_LADO_PX) {
      return res.status(400).json({ error: `Excede el tamaño máximo de entrada (${MAX_LADO_PX}px por lado)` });
    }
    const ruta = await guardar("originales", req.file.buffer, ".png");
    const imagen = await prisma.imagen.create({
      data: {
        proyecto_id: req.proyecto.id,
        nombre_original: req.file.originalname || "texto.png",
        ruta_original: ruta,
        ruta_procesada: ruta,
        ancho_px: metadata.width,
        alto_px: metadata.height,
        estado_fondo: "listo",
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
    const imagen = await crearImagenDesdeBuffer(req.proyecto.id, req.proyecto.usuario_id, buffer, nombre || "imagen-web.jpg");
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

imagenesRouter.delete("/imagenes/:id", cargarImagenPropia, async (req, res) => {
  await prisma.imagen.delete({ where: { id: req.imagen.id } });
  res.status(204).end();
});

imagenesRouter.get("/imagenes/:id/archivo", cargarImagenPropia, async (req, res) => {
  const variante = req.query.variante === "original" ? "original" : "procesada";
  const ruta = variante === "original" ? req.imagen.ruta_original : req.imagen.ruta_procesada;
  if (!ruta) return res.status(404).json({ error: "Archivo no disponible todavía" });
  const buffer = await leer(ruta);
  res.set("Content-Type", "image/png").send(buffer);
});
