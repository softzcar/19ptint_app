import { Router } from "express";
import { prisma } from "../db.js";
import { verificarPassword, firmarToken, requireAuth } from "../lib/auth.js";

export const authRouter = Router();

function datosPublicos(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    cedula: usuario.cedula,
    direccion: usuario.direccion,
  };
}

// El alta de usuarios es solo del admin (ver routes/admin.js) — antes había
// un /registro público, cerrado a propósito: cualquiera con la URL podía
// crearse una cuenta y consumir CPU del VPS sin que el dueño se enterara.
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario || !(await verificarPassword(password, usuario.password_hash))) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  if (!usuario.activo) {
    return res.status(403).json({ error: "Esta cuenta está deshabilitada" });
  }
  res.json({ token: firmarToken(usuario), usuario: datosPublicos(usuario) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(datosPublicos(usuario));
});

// Autoservicio: el cliente completa sus propios datos (necesarios para el
// pedido por WhatsApp a Ninesys, ver CONTEXTO.md §15) — no toca email/rol/
// activo/límite, eso sigue siendo exclusivo del panel de admin.
authRouter.patch("/perfil", requireAuth, async (req, res) => {
  const { nombre, cedula, direccion } = req.body ?? {};
  const data = {};
  if (nombre !== undefined) data.nombre = nombre;
  if (cedula !== undefined) data.cedula = cedula;
  if (direccion !== undefined) data.direccion = direccion;
  const usuario = await prisma.usuario.update({ where: { id: req.usuarioId }, data });
  res.json(datosPublicos(usuario));
});
