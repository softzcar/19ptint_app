import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { guardar, leer, borrar } from "../lib/storage.js";
import { encolarJobSinImagen } from "../lib/queue.js";
import { cargarProyecto } from "./proyectos.js";
import { calcularGrillaHoja } from "../lib/hojaDtfUv.js";

// Mismos anchos de rollo que Lienzo usa para tipo:dtf (routes/lienzos.js,
// ANCHOS_VALIDOS.dtf) -- se duplica en vez de importar porque son features
// separadas (ver plan de "armar hoja" DTF UV) que solo comparten el rollo
// físico, no código.
const ANCHOS_HOJA_VALIDOS = [280, 580];

export const dtfUvRouter = Router();
dtfUvRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const ARCHIVOS_POR_VARIANTE = {
  original: "ruta_original",
  vector: "ruta_vector",
  silueta: "ruta_silueta",
  mascara_blanco: "ruta_mascara_blanco",
  mascara_barniz: "ruta_mascara_barniz",
  patron_ia: "ruta_patron_ia",
};

dtfUvRouter.post("/proyectos/:id/dtf-uv", cargarProyecto, upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió la imagen" });

  let normalizado;
  try {
    // .rotate() sin argumentos aplica la orientación EXIF (si la hay) y la
    // graba en los píxeles, dejando el archivo sin esa bandera -- sin esto,
    // un logo subido con orientación EXIF (típico en fotos de celular) se
    // ve bien en el navegador (que sí la respeta al mostrarlo) pero
    // Pillow/vtracer del lado del ai-service la ignoran: el vectorizado
    // termina en otra orientación/proporción que la imagen mostrada, y el
    // resultado se ve "corrido" en el editor. .png() normaliza el formato
    // real del archivo a lo que ya decía la extensión guardada.
    normalizado = await sharp(req.file.buffer).rotate().png().toBuffer();
  } catch {
    return res.status(400).json({ error: "Archivo no es una imagen válida" });
  }

  // ancho_mm/alto_mm nacen vacíos: igual que Imagen, el tamaño de impresión
  // lo define el usuario a mano (PATCH /dtf-uv/:id) -- no se puede derivar
  // de forma confiable del DPI del archivo subido.
  const ruta_original = await guardar("dtf_uv", normalizado, ".png");
  const dtfUv = await prisma.dtfUv.create({
    data: {
      proyecto_id: req.proyecto.id,
      nombre_original: req.file.originalname || "logo.png",
      ruta_original,
      estado_vectorizado: "pendiente",
    },
  });
  // La vectorización arranca sola al subir -- no hay un switch "mantener sin
  // vectorizar" como el de quitar-fondo, porque acá es un paso obligatorio
  // del flujo, no una opción.
  await encolarJobSinImagen("vectorizar_dtf_uv", { dtfUvId: dtfUv.id });
  res.status(201).json(dtfUv);
});

dtfUvRouter.get("/proyectos/:id/dtf-uv", cargarProyecto, async (req, res) => {
  const disenos = await prisma.dtfUv.findMany({
    where: { proyecto_id: req.proyecto.id },
    orderBy: { id: "desc" },
  });
  res.json(disenos);
});

async function cargarDtfUvPropio(req, res, next) {
  const id = Number(req.params.id);
  const dtfUv = await prisma.dtfUv.findFirst({
    where: { id, proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } },
    include: { proyecto: { select: { usuario_id: true } } },
  });
  if (!dtfUv) return res.status(404).json({ error: "Diseño no encontrado" });
  req.dtfUv = dtfUv;
  next();
}

dtfUvRouter.get("/dtf-uv/:id", cargarDtfUvPropio, (req, res) => res.json(req.dtfUv));

dtfUvRouter.patch("/dtf-uv/:id", cargarDtfUvPropio, async (req, res) => {
  const {
    grosor_relieve_px,
    sensibilidad,
    ancho_mm,
    alto_mm,
    copias,
    ancho_hoja_mm,
    margen_hoja_mm,
    marca_registro_mm,
    rotar_copias,
  } = req.body ?? {};
  const data = {};
  if (grosor_relieve_px !== undefined) data.grosor_relieve_px = Number(grosor_relieve_px);
  if (sensibilidad !== undefined) data.sensibilidad = Number(sensibilidad);
  if (ancho_mm !== undefined) data.ancho_mm = ancho_mm;
  if (alto_mm !== undefined) data.alto_mm = alto_mm;
  if (copias !== undefined) data.copias = Number(copias);
  if (ancho_hoja_mm !== undefined) data.ancho_hoja_mm = ancho_hoja_mm;
  if (margen_hoja_mm !== undefined) data.margen_hoja_mm = margen_hoja_mm;
  if (marca_registro_mm !== undefined) data.marca_registro_mm = marca_registro_mm;
  if (rotar_copias !== undefined) data.rotar_copias = Boolean(rotar_copias);
  const dtfUv = await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data });
  res.json(dtfUv);
});

// Efecto visual tipo bordado sobre el original -- movido acá desde el flujo
// genérico de Imagen porque conceptualmente es parte de DTF UV. No requiere
// que el vectorizado esté listo: opera directo sobre ruta_original.
dtfUvRouter.post("/dtf-uv/:id/efecto-bordado", cargarDtfUvPropio, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_bordado)) {
    return res.status(409).json({ error: "Ya se está procesando" });
  }
  const { paso_px, largo_px } = req.body ?? {};
  const data = { estado_bordado: "pendiente" };
  if (paso_px !== undefined) data.bordado_paso_px = Number(paso_px);
  if (largo_px !== undefined) data.bordado_largo_px = Number(largo_px);
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data });
  await encolarJobSinImagen("efecto_bordado_dtf_uv", { dtfUvId: req.dtfUv.id });
  res.status(202).json({ ok: true });
});

// Segunda capa de bordado: solo el contorno, escribe directo a
// ruta_mascara_blanco (punto de partida para Spot1/Spot2, editable después
// en el editor de relieve).
dtfUvRouter.post("/dtf-uv/:id/bordar-contorno", cargarDtfUvPropio, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_contorno_bordado)) {
    return res.status(409).json({ error: "Ya se está procesando" });
  }
  const { paso_px, largo_px, grosor_contorno_px } = req.body ?? {};
  const data = { estado_contorno_bordado: "pendiente" };
  if (paso_px !== undefined) data.bordado_paso_px = Number(paso_px);
  if (largo_px !== undefined) data.bordado_largo_px = Number(largo_px);
  if (grosor_contorno_px !== undefined) data.contorno_grosor_px = Number(grosor_contorno_px);
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data });
  await encolarJobSinImagen("bordado_contorno_dtf_uv", { dtfUvId: req.dtfUv.id });
  res.status(202).json({ ok: true });
});

// Genera una TEXTURA con Gemini a partir de una instrucción de texto (ver
// generar_patron_ia() en el ai-service) -- guarda en ruta_patron_ia, no
// toca ninguna máscara: el editor de relieve la aplica como relleno sobre
// las regiones del vector que el usuario ya activó, en cualquiera de las 2
// capas. No requiere que el vectorizado esté listo.
dtfUvRouter.post("/dtf-uv/:id/generar-patron-ia", cargarDtfUvPropio, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_patron_ia)) {
    return res.status(409).json({ error: "Ya se está procesando" });
  }
  const { prompt } = req.body ?? {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: "Falta describir la textura a generar" });
  }
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data: { estado_patron_ia: "pendiente" } });
  await encolarJobSinImagen("generar_patron_ia_dtf_uv", { dtfUvId: req.dtfUv.id, prompt: String(prompt).trim() });
  res.status(202).json({ ok: true });
});

dtfUvRouter.post("/dtf-uv/:id/revertir-bordado", cargarDtfUvPropio, async (req, res) => {
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_bordado)) {
    return res.status(409).json({ error: "Espere a que termine de procesar antes de deshacerlo" });
  }
  if (!req.dtfUv.ruta_pre_bordado) {
    return res.status(400).json({ error: "No hay una versión anterior a la que volver" });
  }
  const dtfUv = await prisma.dtfUv.update({
    where: { id: req.dtfUv.id },
    data: { ruta_original: req.dtfUv.ruta_pre_bordado, ruta_pre_bordado: null, estado_bordado: "omitido" },
  });
  res.json(dtfUv);
});

// Un nivel de deshacer para ruta_mascara_blanco/barniz, sin importar cuál
// de las 3 formas de generarla la escribió por última vez (contorno de
// bordado, patrón IA, o guardado manual del editor) -- ver
// ruta_pre_mascara_blanco/barniz en el schema.
function revertirMascara(campo) {
  const campoPre = campo === "ruta_mascara_barniz" ? "ruta_pre_mascara_barniz" : "ruta_pre_mascara_blanco";
  return async (req, res) => {
    if (!req.dtfUv[campoPre]) {
      return res.status(400).json({ error: "No hay una versión anterior a la que volver" });
    }
    const dtfUv = await prisma.dtfUv.update({
      where: { id: req.dtfUv.id },
      data: { [campo]: req.dtfUv[campoPre], [campoPre]: null },
    });
    res.json(dtfUv);
  };
}
dtfUvRouter.post("/dtf-uv/:id/revertir-mascara-blanco", cargarDtfUvPropio, revertirMascara("ruta_mascara_blanco"));
dtfUvRouter.post("/dtf-uv/:id/revertir-mascara-barniz", cargarDtfUvPropio, revertirMascara("ruta_mascara_barniz"));

dtfUvRouter.post("/dtf-uv/:id/proponer-capas", cargarDtfUvPropio, async (req, res) => {
  if (req.dtfUv.estado_vectorizado !== "listo") {
    return res.status(409).json({ error: "La vectorización debe estar lista antes de proponer las capas" });
  }
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_capas)) {
    return res.status(409).json({ error: "Ya se está procesando" });
  }
  const { grosor_relieve_px, sensibilidad } = req.body ?? {};
  const data = { estado_capas: "pendiente" };
  if (grosor_relieve_px !== undefined) data.grosor_relieve_px = Number(grosor_relieve_px);
  if (sensibilidad !== undefined) data.sensibilidad = Number(sensibilidad);
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data });
  await encolarJobSinImagen("proponer_capas_dtf_uv", { dtfUvId: req.dtfUv.id });
  res.status(202).json({ ok: true });
});

// Guarda las máscaras editadas a mano en el editor de pintura/borrado
// (Fase 4). Síncrono, sin cola de por medio -- mismo patrón que
// POST /imagenes/:id/upscale-cliente (el cliente ya calculó el resultado,
// acá solo se persiste). Acepta una o ambas a la vez.
dtfUvRouter.patch(
  "/dtf-uv/:id/mascaras",
  cargarDtfUvPropio,
  upload.fields([
    { name: "mascara_blanco", maxCount: 1 },
    { name: "mascara_barniz", maxCount: 1 },
  ]),
  async (req, res) => {
    const archivoBlanco = req.files?.mascara_blanco?.[0];
    const archivoBarniz = req.files?.mascara_barniz?.[0];
    if (!archivoBlanco && !archivoBarniz) {
      return res.status(400).json({ error: "No se recibió ninguna máscara" });
    }

    const data = {};
    // El "pre" anterior queda pisado (y se borra) porque ya no hay forma de
    // volver más atrás que un nivel -- mismo criterio que ruta_pre_upscale.
    const preAnteriores = [];
    if (archivoBlanco) {
      data.ruta_mascara_blanco = await guardar("dtf_uv", archivoBlanco.buffer, ".png");
      data.ruta_pre_mascara_blanco = req.dtfUv.ruta_mascara_blanco;
      preAnteriores.push(req.dtfUv.ruta_pre_mascara_blanco);
    }
    if (archivoBarniz) {
      data.ruta_mascara_barniz = await guardar("dtf_uv", archivoBarniz.buffer, ".png");
      data.ruta_pre_mascara_barniz = req.dtfUv.ruta_mascara_barniz;
      preAnteriores.push(req.dtfUv.ruta_pre_mascara_barniz);
    }

    const dtfUv = await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data });
    // Después del update, mismo criterio que exportarLienzo.js: si el
    // borrado fallara, mejor un huérfano que una fila apuntando a nada.
    await Promise.all(preAnteriores.filter(Boolean).map((ruta) => borrar(ruta).catch(() => {})));
    res.json(dtfUv);
  }
);

// Implementación real del job en la Fase 5 del plan -- por ahora
// procesarExportarDtfUv (worker/src/dtfUv.js) es un stub que marca error,
// así que este botón ya queda cableado y solo falta la Fase 5 para que
// funcione de verdad.
dtfUvRouter.post("/dtf-uv/:id/exportar", cargarDtfUvPropio, async (req, res) => {
  if (!req.dtfUv.ruta_mascara_blanco || !req.dtfUv.ruta_mascara_barniz) {
    return res.status(400).json({ error: "Faltan editar las máscaras antes de exportar" });
  }
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_export)) {
    return res.status(409).json({ error: "Ya se está exportando" });
  }
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data: { estado_export: "pendiente" } });
  await encolarJobSinImagen("exportar_dtf_uv", { dtfUvId: req.dtfUv.id });
  res.status(202).json({ ok: true });
});

// "Armar hoja": calcula la grilla de copias (síncrono, mismo criterio que
// POST /proyectos/:id/lienzos -- el cálculo es barato, no hace falta cola)
// y persiste alto_hoja_mm. No genera ningún archivo todavía -- eso lo hace
// POST /dtf-uv/:id/exportar-hoja.
dtfUvRouter.post("/dtf-uv/:id/armar-hoja", cargarDtfUvPropio, async (req, res) => {
  const { copias, ancho_hoja_mm, margen_hoja_mm, marca_registro_mm, rotar_copias } = req.body ?? {};
  const dtfUv = { ...req.dtfUv };
  if (copias !== undefined) dtfUv.copias = Number(copias);
  if (ancho_hoja_mm !== undefined) dtfUv.ancho_hoja_mm = ancho_hoja_mm;
  if (margen_hoja_mm !== undefined) dtfUv.margen_hoja_mm = margen_hoja_mm;
  if (marca_registro_mm !== undefined) dtfUv.marca_registro_mm = marca_registro_mm;
  if (rotar_copias !== undefined) dtfUv.rotar_copias = Boolean(rotar_copias);

  if (!dtfUv.ancho_mm || !dtfUv.alto_mm) {
    return res.status(400).json({ error: "Definí el tamaño de impresión (ancho_mm/alto_mm) antes de armar la hoja" });
  }
  if (!ANCHOS_HOJA_VALIDOS.includes(Number(dtfUv.ancho_hoja_mm))) {
    return res.status(400).json({ error: `ancho_hoja_mm inválido. Valores permitidos: ${ANCHOS_HOJA_VALIDOS.join(", ")}` });
  }
  if (!dtfUv.copias || dtfUv.copias < 1) {
    return res.status(400).json({ error: "copias debe ser al menos 1" });
  }

  let grilla;
  try {
    grilla = calcularGrillaHoja({
      anchoRolloMm: dtfUv.ancho_hoja_mm,
      anchoDisenoMm: dtfUv.ancho_mm,
      altoDisenoMm: dtfUv.alto_mm,
      copias: dtfUv.copias,
      margenMm: dtfUv.margen_hoja_mm,
      marcaRegistroMm: dtfUv.marca_registro_mm,
      rotar: dtfUv.rotar_copias,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // La hoja queda desactualizada (nueva grilla, viejo PDF) -- se resetea el
  // export de hoja, no el suelto (ruta_export_pdf), que sigue siendo válido.
  const anteriorHoja = req.dtfUv.ruta_hoja_pdf;
  const actualizado = await prisma.dtfUv.update({
    where: { id: req.dtfUv.id },
    data: {
      copias: dtfUv.copias,
      ancho_hoja_mm: dtfUv.ancho_hoja_mm,
      margen_hoja_mm: dtfUv.margen_hoja_mm,
      marca_registro_mm: dtfUv.marca_registro_mm,
      rotar_copias: dtfUv.rotar_copias,
      alto_hoja_mm: grilla.altoHojaMm,
      estado_hoja: "omitido",
      mensaje_error_hoja: null,
      ruta_hoja_pdf: null,
    },
  });
  if (anteriorHoja) await borrar(anteriorHoja).catch(() => {});
  res.json({ ...actualizado, columnas: grilla.columnas, filas: grilla.filas });
});

dtfUvRouter.post("/dtf-uv/:id/exportar-hoja", cargarDtfUvPropio, async (req, res) => {
  if (!req.dtfUv.ruta_mascara_blanco || !req.dtfUv.ruta_mascara_barniz) {
    return res.status(400).json({ error: "Faltan editar las máscaras antes de exportar" });
  }
  if (!req.dtfUv.ruta_vector) {
    return res.status(400).json({ error: "Falta la silueta vectorizada para el contorno de corte" });
  }
  if (!req.dtfUv.alto_hoja_mm) {
    return res.status(400).json({ error: "Armá la hoja (medida + copias) antes de exportarla" });
  }
  if (["pendiente", "procesando"].includes(req.dtfUv.estado_hoja)) {
    return res.status(409).json({ error: "Ya se está exportando la hoja" });
  }
  await prisma.dtfUv.update({ where: { id: req.dtfUv.id }, data: { estado_hoja: "pendiente" } });
  await encolarJobSinImagen("exportar_hoja_dtf_uv", { dtfUvId: req.dtfUv.id });
  res.status(202).json({ ok: true });
});

dtfUvRouter.get("/dtf-uv/:id/descargar-hoja", cargarDtfUvPropio, async (req, res) => {
  if (!req.dtfUv.ruta_hoja_pdf) return res.status(404).json({ error: "Todavía no se exportó la hoja" });
  const buffer = await leer(req.dtfUv.ruta_hoja_pdf);
  res
    .set("Content-Type", "application/pdf")
    .set("Cache-Control", "no-store")
    .set("Content-Disposition", `attachment; filename="dtf-uv-${req.dtfUv.id}-hoja.pdf"`)
    .send(buffer);
});

dtfUvRouter.get("/dtf-uv/:id/descargar", cargarDtfUvPropio, async (req, res) => {
  const formato = req.query.formato === "tiff" ? "tiff" : "pdf";
  const ruta = formato === "tiff" ? req.dtfUv.ruta_export_tiff : req.dtfUv.ruta_export_pdf;
  if (!ruta) return res.status(404).json({ error: "Todavía no se exportó este formato" });
  const buffer = await leer(ruta);
  const mime = formato === "tiff" ? "image/tiff" : "application/pdf";
  res
    .set("Content-Type", mime)
    .set("Cache-Control", "no-store")
    .set("Content-Disposition", `attachment; filename="dtf-uv-${req.dtfUv.id}.${formato}"`)
    .send(buffer);
});

dtfUvRouter.get("/dtf-uv/:id/archivo", cargarDtfUvPropio, async (req, res) => {
  const campo = ARCHIVOS_POR_VARIANTE[req.query.variante];
  if (!campo) return res.status(400).json({ error: "variante inválida" });
  const ruta = req.dtfUv[campo];
  if (!ruta) return res.status(404).json({ error: "Archivo no disponible todavía" });
  const buffer = await leer(ruta);
  const mime = ruta.endsWith(".svg") ? "image/svg+xml" : "image/png";
  res.set("Content-Type", mime).set("Cache-Control", "no-store").send(buffer);
});

dtfUvRouter.delete("/dtf-uv/:id", cargarDtfUvPropio, async (req, res) => {
  await prisma.dtfUv.delete({ where: { id: req.dtfUv.id } });
  // Mejor esfuerzo: si alguno falla (ya no existe, permisos), no bloquea el
  // borrado de la fila -- mismo criterio que borrar() en storage.js. Incluye
  // los exports (pdf suelto, tiff, hoja) además de las variantes de
  // /archivo -- quedaban huérfanos, nunca se limpiaban al borrar la fila.
  const campos = [...Object.values(ARCHIVOS_POR_VARIANTE), "ruta_export_pdf", "ruta_export_tiff", "ruta_hoja_pdf"];
  await Promise.all(
    campos
      .map((campo) => req.dtfUv[campo])
      .filter(Boolean)
      .map((ruta) => borrar(ruta).catch(() => {}))
  );
  res.status(204).end();
});
