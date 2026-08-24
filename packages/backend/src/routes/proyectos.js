import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";

export const proyectosRouter = Router();
proyectosRouter.use(requireAuth);

function scopeUsuario(req) {
  return req.rol === "admin" ? {} : { usuario_id: req.usuarioId };
}

proyectosRouter.get("/", async (req, res) => {
  const proyectos = await prisma.proyecto.findMany({
    where: scopeUsuario(req),
    orderBy: { updated_at: "desc" },
  });
  res.json(proyectos);
});

proyectosRouter.post("/", async (req, res) => {
  const { nombre } = req.body ?? {};
  const proyecto = await prisma.proyecto.create({
    data: { nombre: nombre ?? "Proyecto sin nombre", usuario_id: req.usuarioId },
  });
  res.status(201).json(proyecto);
});

async function cargarProyecto(req, res, next) {
  const id = Number(req.params.id);
  const proyecto = await prisma.proyecto.findFirst({ where: { id, ...scopeUsuario(req) } });
  if (!proyecto) return res.status(404).json({ error: "Proyecto no encontrado" });
  req.proyecto = proyecto;
  next();
}

proyectosRouter.get("/:id", cargarProyecto, async (req, res) => {
  const [imagenes, lienzos] = await Promise.all([
    prisma.imagen.findMany({ where: { proyecto_id: req.proyecto.id }, orderBy: { id: "asc" } }),
    prisma.lienzo.findMany({
      where: { proyecto_id: req.proyecto.id },
      orderBy: { id: "desc" },
      include: { items: true },
    }),
  ]);
  res.json({ ...req.proyecto, imagenes, lienzos });
});

proyectosRouter.patch("/:id", cargarProyecto, async (req, res) => {
  const { nombre } = req.body ?? {};
  const proyecto = await prisma.proyecto.update({
    where: { id: req.proyecto.id },
    data: { nombre },
  });
  res.json(proyecto);
});

proyectosRouter.delete("/:id", cargarProyecto, async (req, res) => {
  await prisma.proyecto.delete({ where: { id: req.proyecto.id } });
  res.status(204).end();
});

export { cargarProyecto };
