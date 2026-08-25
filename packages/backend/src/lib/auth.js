import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("Falta JWT_SECRET en el entorno");
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function firmarToken(usuario) {
  return jwt.sign({ sub: usuario.id, rol: usuario.rol }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const [, token] = header.split(" ");
  if (!token) {
    return res.status(401).json({ error: "No autenticado" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Se consulta la DB en cada request (no solo al loguear) para que
    // desactivar un usuario corte el acceso al instante, sin esperar a que
    // expire su token de 7 días.
    const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.activo) {
      return res.status(403).json({ error: "Cuenta deshabilitada" });
    }
    req.usuarioId = usuario.id;
    req.rol = usuario.rol;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.rol !== "admin") {
    return res.status(403).json({ error: "Solo un admin puede hacer esto" });
  }
  next();
}
