import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { cargarProyecto } from "./proyectos.js";
import { calcularAcomodo } from "../lib/packing.js";
import { exportarLienzo } from "../lib/exportarLienzo.js";
import { leer, borrar, guardarDesdeArchivo } from "../lib/storage.js";
import { pdfDimensionesMM } from "../lib/pdf.js";

export const lienzosRouter = Router();
lienzosRouter.use(requireAuth);

// CONTEXTO.md §2 y §4: anchos y formatos válidos por tipo de lienzo.
const ANCHOS_VALIDOS = { dtf: [280, 580], sublimacion: [1580] };
const FORMATOS_VALIDOS = { dtf: ["png"], sublimacion: ["pdf", "jpeg"] };

function validarConfigLienzo(tipo, ancho_mm, formato_exportacion) {
  if (!["dtf", "sublimacion"].includes(tipo)) {
    return "tipo debe ser 'dtf' o 'sublimacion'";
  }
  if (!ANCHOS_VALIDOS[tipo].includes(Number(ancho_mm))) {
    return `ancho_mm inválido para ${tipo}. Valores permitidos: ${ANCHOS_VALIDOS[tipo].join(", ")}`;
  }
  if (!FORMATOS_VALIDOS[tipo].includes(formato_exportacion)) {
    return `formato_exportacion inválido para ${tipo}. Valores permitidos: ${FORMATOS_VALIDOS[tipo].join(", ")}`;
  }
  return null;
}

async function acomodarImagenesProyecto(proyectoId, { tipo, ancho_mm, margen_mm, imagenIds }) {
  // Con ids explícitos (siempre el caso al re-acomodar desde LienzoView) no se
  // filtra por estado_fondo todavía: hace falta distinguir "no está listo"
  // (rechazar con error) de "no existe" -- filtrar de una no permite avisar,
  // solo excluye en silencio al que todavía está procesando.
  const idsExplicitos = Array.isArray(imagenIds) && imagenIds.length ? imagenIds.map(Number) : null;
  const imagenes = await prisma.imagen.findMany({
    where: {
      proyecto_id: proyectoId,
      ...(idsExplicitos ? { id: { in: idsExplicitos } } : { estado_fondo: "listo" }),
    },
  });

  if (idsExplicitos) {
    const noListas = imagenes.filter((i) => i.estado_fondo !== "listo");
    if (noListas.length > 0) {
      throw new Error(
        `No se puede acomodar todavía: ${noListas
          .map((i) => `${i.nombre_original ?? `#${i.id}`} (${i.estado_fondo})`)
          .join(", ")}. Esperá a que termine o destildala.`
      );
    }
  }

  const listas = imagenes.filter((i) => i.estado_fondo === "listo");
  if (listas.length === 0) {
    throw new Error("No hay imágenes listas (fondo quitado y con tamaño definido) para acomodar");
  }
  return calcularAcomodo({ canvasAncho: Number(ancho_mm), tipo, margen: Number(margen_mm), imagenes: listas });
}

async function guardarColocaciones(tx, lienzoId, colocaciones) {
  await tx.lienzoItem.createMany({
    data: colocaciones.map((c, i) => ({
      lienzo_id: lienzoId,
      imagen_id: c.id,
      x_mm: c.x,
      y_mm: c.y,
      ancho_mm: c.ancho,
      alto_mm: c.alto,
      rotacion: c.rotacion,
      orden: i,
    })),
  });
}

lienzosRouter.post("/proyectos/:id/lienzos", cargarProyecto, async (req, res) => {
  const { tipo, ancho_mm, margen_mm = 5, formato_exportacion, imagenIds } = req.body ?? {};

  const errorValidacion = validarConfigLienzo(tipo, ancho_mm, formato_exportacion);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  let resultado;
  try {
    resultado = await acomodarImagenesProyecto(req.proyecto.id, { tipo, ancho_mm, margen_mm, imagenIds });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const lienzo = await prisma.$transaction(async (tx) => {
    const creado = await tx.lienzo.create({
      data: {
        proyecto_id: req.proyecto.id,
        tipo,
        ancho_mm: Number(ancho_mm),
        margen_mm: Number(margen_mm),
        alto_usado_mm: resultado.altoFinalUsado,
        formato_exportacion,
      },
    });
    await guardarColocaciones(tx, creado.id, resultado.colocaciones);
    return tx.lienzo.findUnique({ where: { id: creado.id }, include: { items: true } });
  });

  res.status(201).json(lienzo);
});

async function cargarLienzoPropio(req, res, next) {
  const id = Number(req.params.id);
  // Un id no numérico (ej. una ruta vieja que ya no existe cayendo acá por
  // matchear /lienzos/:id) no es "no encontrado" para Prisma, es un error de
  // tipo que tumba el proceso entero -- se corta acá, antes de la query.
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Lienzo no encontrado" });
  const lienzo = await prisma.lienzo.findFirst({
    where: { id, proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } },
    include: {
      items: true,
      // Estado de la entrega a la PC de producción. Se usa `select` explícito
      // y NO un include del agente completo: esa fila tiene el token_hash y
      // no debe salir nunca hacia el navegador.
      entrega: {
        select: {
          estado: true,
          intentos: true,
          ultimo_error: true,
          entregado_en: true,
          purgado_en: true,
          empresa_agente: { select: { nombre: true, ultimo_ping: true, activo: true } },
        },
      },
    },
  });
  if (!lienzo) return res.status(404).json({ error: "Lienzo no encontrado" });
  req.lienzo = lienzo;
  next();
}

lienzosRouter.get("/lienzos/:id", cargarLienzoPropio, (req, res) => res.json(req.lienzo));

// Reeditar un lienzo ya generado: permite cambiar tipo/ancho/margen/formato
// y/o qué imágenes entran, y vuelve a correr el auto-acomodo sobre el mismo
// lienzo (mismo id, mismo link) en vez de crear uno nuevo. El ajuste manual
// previo se pierde a propósito: es lo esperado al re-acomodar.
lienzosRouter.patch("/lienzos/:id", cargarLienzoPropio, async (req, res) => {
  const {
    tipo = req.lienzo.tipo,
    ancho_mm = req.lienzo.ancho_mm,
    margen_mm = req.lienzo.margen_mm,
    formato_exportacion = req.lienzo.formato_exportacion,
    imagenIds,
  } = req.body ?? {};

  const errorValidacion = validarConfigLienzo(tipo, ancho_mm, formato_exportacion);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  let resultado;
  try {
    resultado = await acomodarImagenesProyecto(req.lienzo.proyecto_id, { tipo, ancho_mm, margen_mm, imagenIds });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const lienzo = await prisma.$transaction(async (tx) => {
    await tx.lienzoItem.deleteMany({ where: { lienzo_id: req.lienzo.id } });
    await tx.lienzo.update({
      where: { id: req.lienzo.id },
      data: {
        tipo,
        ancho_mm: Number(ancho_mm),
        margen_mm: Number(margen_mm),
        alto_usado_mm: resultado.altoFinalUsado,
        formato_exportacion,
        ruta_export: null, // el export anterior quedó obsoleto tras re-acomodar
      },
    });
    await guardarColocaciones(tx, req.lienzo.id, resultado.colocaciones);
    return tx.lienzo.findUnique({ where: { id: req.lienzo.id }, include: { items: true } });
  });

  // Recién acá, con la transacción ya confirmada: el export viejo quedó
  // obsoleto y su fila ya no lo referencia, así que se borra del disco. Antes
  // solo se ponía ruta_export en null y el archivo quedaba huérfano para
  // siempre (son ~19MB promedio, hasta 32MB).
  await borrar(req.lienzo.ruta_export);

  res.json(lienzo);
});

lienzosRouter.delete("/lienzos/:id", cargarLienzoPropio, async (req, res) => {
  await prisma.lienzo.delete({ where: { id: req.lienzo.id } });
  // El ON DELETE CASCADE solo borra filas: el archivo del disco hay que
  // borrarlo explícitamente o queda huérfano.
  await borrar(req.lienzo.ruta_export);
  res.status(204).end();
});

lienzosRouter.patch("/lienzo-items/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.lienzoItem.findFirst({
    where: { id, lienzo: { proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } } },
  });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });

  // Ajuste manual post-acomodo (CONTEXTO.md §7): no se revalida colisión,
  // es responsabilidad del usuario si decide mover algo.
  const { x_mm, y_mm, rotacion } = req.body ?? {};
  const data = {};
  if (x_mm !== undefined) data.x_mm = x_mm;
  if (y_mm !== undefined) data.y_mm = y_mm;
  if (rotacion !== undefined) data.rotacion = rotacion;
  const actualizado = await prisma.lienzoItem.update({ where: { id }, data });
  res.json(actualizado);
});

/**
 * Vuelve a poner en cola la entrega a la PC de producción.
 *
 * Hace falta porque una entrega ya confirmada no se le vuelve a ofrecer al
 * agente (ver routes/agente.js, que solo lista pendiente/error). Si el
 * archivo se pierde DESPUÉS de bajado -- disco que falla, carpeta borrada
 * por error, PC reinstalada -- no había forma de pedirlo de nuevo sin tocar
 * la base a mano.
 *
 * Si el export ya fue purgado por retención se regenera acá mismo: el lienzo
 * siempre se puede reconstruir desde su diseño.
 */
lienzosRouter.post("/lienzos/:id/reenviar", cargarLienzoPropio, async (req, res) => {
  const entrega = await prisma.entregaLienzo.findUnique({
    where: { lienzo_id: req.lienzo.id },
  });
  if (!entrega) {
    return res.status(409).json({
      error: "Este lienzo todavía no se envió a producción: primero hay que confirmar el pedido.",
    });
  }

  if (!req.lienzo.ruta_export) {
    try {
      await exportarLienzo(req.lienzo.id);
    } catch (err) {
      return res.status(400).json({ error: `No se pudo regenerar el archivo: ${err.message}` });
    }
  }

  const actualizada = await prisma.entregaLienzo.update({
    where: { id: entrega.id },
    data: { estado: "pendiente", intentos: 0, ultimo_error: null, entregado_en: null, purgado_en: null },
  });
  res.json(actualizada);
});

lienzosRouter.post("/lienzos/:id/exportar", cargarLienzoPropio, async (req, res) => {
  try {
    await exportarLienzo(req.lienzo.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const lienzo = await prisma.lienzo.findUnique({ where: { id: req.lienzo.id } });
  res.json(lienzo);
});

lienzosRouter.get("/lienzos/:id/descargar", cargarLienzoPropio, async (req, res) => {
  if (!req.lienzo.ruta_export) {
    return res.status(404).json({ error: "Este lienzo todavía no fue exportado" });
  }
  const buffer = await leer(req.lienzo.ruta_export);
  const mimes = { ".png": "image/png", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };
  const ext = "." + req.lienzo.ruta_export.split(".").pop();
  res.set("Content-Type", mimes[ext] ?? "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="lienzo-${req.lienzo.id}${ext}"`);
  // Misma URL después de re-exportar (ruta_export cambia, la URL no) --
  // evita que el caché de LiteSpeed/navegador entregue una exportación vieja.
  res.set("Cache-Control", "no-store");
  res.send(buffer);
});

// --- Lienzo ya armado, subido directo ---
//
// Cuarta pestaña de carga del proyecto (junto a Subir archivo/Buscar en
// internet/Crear texto, ver CargaImagenes.vue): para un diseño ya maquetado
// afuera de esta app -- el archivo subido ES el diseño final, no pasa por
// imágenes ni por el motor de acomodo. Se cuelga del proyecto actual, no de
// uno nuevo: qué empresa y qué servicio (y por lo tanto la entrega a la PC
// de producción) se deciden después, en el mismo "Pedir presupuesto" que ya
// usa cualquier otro lienzo (ver PedidoWhatsApp.vue / routes/ninesys.js) --
// acá solo hace falta el archivo y el tipo.
//
// diskStorage (no memoryStorage) a propósito: estos archivos no tienen tope
// de tamaño ("cualquier tamaño sin restricciones" -- se van a descargar tal
// cual en la PC de producción, nunca se decodifican ni se procesan acá).
// Cargar uno grande entero a un Buffer en memoria arriesgaría el VPS igual
// que decodificarlo (ver el incidente de CONTEXTO.md §14).
const uploadLienzoListo = multer({
  storage: multer.diskStorage({}), // sin `destination`: cae al os.tmpdir() del sistema
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB: backstop técnico, no un límite de negocio
});

lienzosRouter.post(
  "/proyectos/:id/lienzos/subir-listo",
  cargarProyecto,
  uploadLienzoListo.single("archivo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

    const limpiarTemporal = () => unlink(req.file.path).catch(() => {});

    const { tipo, tela } = req.body ?? {};

    if (!["dtf", "sublimacion"].includes(tipo)) {
      await limpiarTemporal();
      return res.status(400).json({ error: "tipo debe ser 'dtf' o 'sublimacion'" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const formato_exportacion = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".pdf": "pdf" }[ext];
    if (!formato_exportacion) {
      await limpiarTemporal();
      return res.status(400).json({ error: "Formato no soportado: subí un PNG, JPEG o PDF." });
    }
    // Mismo emparejamiento tipo/formato que el resto de la app (CONTEXTO.md
    // §2/§4): el software de la impresora de cada tipo espera un formato
    // puntual, no cualquiera de los tres.
    if (!FORMATOS_VALIDOS[tipo].includes(formato_exportacion)) {
      await limpiarTemporal();
      return res.status(400).json({
        error: `Para ${tipo} el archivo debe ser ${FORMATOS_VALIDOS[tipo].join(" o ").toUpperCase()}.`,
      });
    }

    // Best-effort, nunca bloquea la subida: alto_usado_mm es lo que
    // PedidoWhatsApp.vue usa para calcular los metros de largo a facturar
    // (cantidadMetros = alto_usado_mm / 1000), así que vale la pena, pero
    // sin esto igual se puede pedir presupuesto -- el campo queda null.
    //
    // Solo para este camino (lienzo ya armado, subido tal cual): a diferencia
    // del motor de acomodo, que calcula el largo exacto de lo que él mismo
    // empaquetó, acá el archivo viene de afuera y no hay margen de maniobra
    // -- se suma un 3% al largo para cubrir la pérdida de material habitual
    // al trabajarlo (alineación, recorte) en vez de cobrar el metraje exacto
    // del archivo y quedarse corto.
    const MARGEN_DESPERDICIO = 1.03;
    let ancho_mm = 0;
    let alto_usado_mm = null;
    try {
      // PDF (sublimación) no pasa por sharp -- los binarios de libvips que
      // trae npm no incluyen soporte PDF -- se lee el tamaño de página con
      // pdfinfo (poppler), sin rasterizar nada. Ambos leen desde el archivo
      // en disco (no lo cargan entero a memoria), así que es seguro aunque
      // el archivo sea enorme.
      if (formato_exportacion === "pdf") {
        const { anchoMM, altoMM } = await pdfDimensionesMM(req.file.path);
        ancho_mm = Math.round(anchoMM);
        alto_usado_mm = Math.round(altoMM * MARGEN_DESPERDICIO);
      } else {
        const meta = await sharp(req.file.path).metadata();
        if (meta.width) ancho_mm = Math.round((meta.width / 300) * 25.4);
        if (meta.height) alto_usado_mm = Math.round((meta.height / 300) * 25.4 * MARGEN_DESPERDICIO);
      }
    } catch (err) {
      // Archivo fuera de lo común (ej. un PDF sin página, o corrupto): se
      // guarda igual, sin dimensiones de referencia -- nunca bloquea la
      // subida, pero queda logueado para poder investigar si pasa seguido.
      console.warn(`[lienzos] no se pudo calcular el tamaño de ${req.file.originalname}:`, err.message);
    }

    try {
      const ruta_export = await guardarDesdeArchivo("exports", req.file.path, ext);
      const lienzo = await prisma.lienzo.create({
        data: {
          proyecto_id: req.proyecto.id,
          tipo,
          ancho_mm,
          alto_usado_mm,
          formato_exportacion,
          ruta_export,
          // Solo aplica a sublimación (DTF no lleva este detalle) -- se
          // ignora en silencio si viene en un lienzo DTF en vez de rechazar,
          // total no se usa para nada del lado de DTF.
          tela: tipo === "sublimacion" && tela?.trim() ? tela.trim() : null,
        },
      });
      res.status(201).json(lienzo);
    } catch (err) {
      await limpiarTemporal();
      res.status(500).json({ error: err.message });
    }
  }
);
