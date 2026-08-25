import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { cargarProyecto } from "./proyectos.js";
import { calcularAcomodo } from "../lib/packing.js";
import { exportarLienzo } from "../lib/exportarLienzo.js";
import { leer, borrar } from "../lib/storage.js";

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
  const lienzo = await prisma.lienzo.findFirst({
    where: { id, proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } },
    include: { items: true },
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
