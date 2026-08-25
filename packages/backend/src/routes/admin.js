import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin, hashPassword } from "../lib/auth.js";
import { procesosHoy } from "../lib/limites.js";
import { generarToken, hashToken } from "../lib/agenteToken.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

function sinHash(usuario) {
  const { password_hash, ...resto } = usuario;
  return resto;
}

adminRouter.get("/usuarios", async (req, res) => {
  const usuarios = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
  const conUso = await Promise.all(
    usuarios.map(async (u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      limite_diario: u.limite_diario,
      created_at: u.created_at,
      usados_hoy: await procesosHoy(u.id),
    }))
  );
  res.json(conUso);
});

adminRouter.post("/usuarios", async (req, res) => {
  const { nombre, email, password, rol = "cliente", limite_diario } = req.body ?? {};
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: "nombre, email y password son requeridos" });
  }
  if (!["admin", "cliente"].includes(rol)) {
    return res.status(400).json({ error: "rol debe ser 'admin' o 'cliente'" });
  }
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe un usuario con ese email" });
  }
  const usuario = await prisma.usuario.create({
    data: {
      nombre,
      email,
      password_hash: await hashPassword(password),
      rol,
      limite_diario: limite_diario === undefined || limite_diario === "" ? null : Number(limite_diario),
    },
  });
  res.status(201).json(sinHash(usuario));
});

adminRouter.patch("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuarioId && req.body?.activo === false) {
    return res.status(400).json({ error: "No podés desactivar tu propia cuenta" });
  }
  const { nombre, rol, activo, limite_diario, password } = req.body ?? {};
  const data = {};
  if (nombre !== undefined) data.nombre = nombre;
  if (rol !== undefined) data.rol = rol;
  if (activo !== undefined) data.activo = activo;
  if (limite_diario !== undefined) data.limite_diario = limite_diario === "" || limite_diario === null ? null : Number(limite_diario);
  if (password) data.password_hash = await hashPassword(password);

  const usuario = await prisma.usuario.update({ where: { id }, data }).catch(() => null);
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(sinHash(usuario));
});

adminRouter.delete("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuarioId) {
    return res.status(400).json({ error: "No podés eliminar tu propia cuenta" });
  }
  await prisma.usuario.delete({ where: { id } }).catch(() => null);
  res.status(204).end();
});

// --- Agentes de escritorio (la PC de producción de cada empresa) ---

adminRouter.get("/agentes", async (req, res) => {
  const agentes = await prisma.empresaAgente.findMany({ orderBy: { id_empresa_ninesys: "asc" } });
  const conEstado = await Promise.all(
    agentes.map(async ({ token_hash, ...a }) => ({
      ...a,
      // Nunca se devuelve el token (ni su hash): solo si ya tiene uno puesto.
      tiene_token: Boolean(token_hash),
      pendientes: await prisma.entregaLienzo.count({
        where: { empresa_agente_id: a.id, estado: { in: ["pendiente", "error"] } },
      }),
    }))
  );
  res.json(conEstado);
});

// Genera (o rota) el token de un agente. Se devuelve en claro UNA sola vez:
// de acá en más solo queda el sha256 guardado, así que si se pierde hay que
// generar uno nuevo. Rotar invalida al instante la PC que tenía el anterior.
adminRouter.post("/agentes/:id/token", async (req, res) => {
  const id = Number(req.params.id);
  const agente = await prisma.empresaAgente.findUnique({ where: { id } });
  if (!agente) return res.status(404).json({ error: "Agente no encontrado" });

  const token = generarToken();
  await prisma.empresaAgente.update({
    where: { id },
    data: { token_hash: hashToken(token), activo: true },
  });

  res.json({
    token,
    empresa: agente.nombre,
    aviso: "Guardalo ahora: no se vuelve a mostrar. Si se pierde, generá uno nuevo.",
  });
});

adminRouter.patch("/agentes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body ?? {};
  const data = {};
  if (activo !== undefined) data.activo = Boolean(activo);

  const agente = await prisma.empresaAgente.update({ where: { id }, data }).catch(() => null);
  if (!agente) return res.status(404).json({ error: "Agente no encontrado" });
  const { token_hash, ...resto } = agente;
  res.json({ ...resto, tiene_token: Boolean(token_hash) });
});
