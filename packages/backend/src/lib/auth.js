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

// Login unificado (fase 2 de la unificación con clasificador-disenos/
// system-nesting, ver plan): además del token de siempre en el body (así el
// frontend Vue de esta app sigue funcionando exactamente igual), se pone
// esta MISMA firma como cookie de dominio compartido. `sublima.
// nineteengreen.com` (Flask + el frontend de nesting, mismo origen ahí) la
// recibe automática en cada request -- sin CORS de por medio, es solo una
// cookie normal del navegador. `COOKIE_DOMAIN` es configurable porque en
// local (localhost) un dominio con punto inicial no aplica -- undefined ahí
// deja que el navegador use el host exacto, como siempre.
const COOKIE_NOMBRE = "ninesys_session";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, igual que expiresIn del JWT

export function ponerCookieSesion(res, token) {
  res.cookie(COOKIE_NOMBRE, token, {
    domain: COOKIE_DOMAIN,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function borrarCookieSesion(res) {
  res.clearCookie(COOKIE_NOMBRE, { domain: COOKIE_DOMAIN, path: "/" });
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
