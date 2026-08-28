import { Router } from "express";
import { randomInt } from "node:crypto";
import { prisma } from "../db.js";
import { hashPassword, verificarPassword, firmarToken, requireAuth } from "../lib/auth.js";
import { normalizarTelefono } from "../lib/telefono.js";
import { empresasDondeEsCliente } from "../lib/clienteNinesys.js";
import { enviarWhatsapp } from "../lib/msgNinesys.js";

export const authRouter = Router();

function datosPublicos(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    telefono: usuario.telefono,
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

// --- Login de clientes por teléfono ---
//
// Ninesys no tiene ningún mecanismo de login de clientes en ningún lado, así
// que no hay una clave que reutilizar: la de acá es nueva y vive solo en
// esta app. Nada de nombre/cédula/dirección se copia de forma sincronizada
// -- se consulta a Ninesys en vivo cada vez (ver lib/clienteNinesys.js).

// Paso 1: identificar la situación de un teléfono antes de pedir la clave.
authRouter.post("/verificar-telefono", async (req, res) => {
  const normalizado = normalizarTelefono(req.body?.telefono);
  if (!normalizado) return res.status(400).json({ error: "Ingresá un teléfono válido" });

  const existente = await prisma.usuario.findUnique({ where: { telefono: normalizado.e164 } });
  if (existente) {
    if (!existente.activo) return res.status(403).json({ error: "Esta cuenta está deshabilitada" });
    return res.json({ estado: "tiene_clave" });
  }

  const empresas = await empresasDondeEsCliente(normalizado);
  if (empresas.length === 0) return res.json({ estado: "no_registrado" });
  res.json({ estado: "sin_clave" });
});

authRouter.post("/login-cliente", async (req, res) => {
  const normalizado = normalizarTelefono(req.body?.telefono);
  const { password } = req.body ?? {};
  if (!normalizado || !password) {
    return res.status(400).json({ error: "teléfono y clave son requeridos" });
  }
  const usuario = await prisma.usuario.findUnique({ where: { telefono: normalizado.e164 } });
  if (!usuario || !(await verificarPassword(password, usuario.password_hash))) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  if (!usuario.activo) {
    return res.status(403).json({ error: "Esta cuenta está deshabilitada" });
  }
  res.json({ token: firmarToken(usuario), usuario: datosPublicos(usuario) });
});

// Autoservicio: genera una clave nueva y la manda por WhatsApp. Sirve tanto
// para el primer acceso como para "olvidé mi clave" (mismo endpoint).
authRouter.post("/solicitar-clave", async (req, res) => {
  const normalizado = normalizarTelefono(req.body?.telefono);
  if (!normalizado) return res.status(400).json({ error: "Ingresá un teléfono válido" });

  // Se vuelve a verificar en vivo -- no alcanza con confiar en lo que ya vio
  // el frontend en /verificar-telefono, alguien podría llamar este endpoint
  // directo con cualquier teléfono.
  const empresas = await empresasDondeEsCliente(normalizado);
  if (empresas.length === 0) {
    return res.status(404).json({ error: "Este teléfono no está registrado como cliente en ninguna empresa" });
  }

  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const mensaje = [
    "Hola, esta es tu clave de acceso a Nineteen Print (dtf.nineteencustom.com):",
    "",
    pin,
    "",
    "Usala junto a tu número de teléfono para entrar. Si volvés a pedir una clave, la anterior deja de funcionar.",
  ].join("\n");

  // El envío va ANTES de tocar la base a propósito: si esta persona ya tenía
  // una clave funcionando (está reintentando porque se le olvidó) y el envío
  // falla, no debe perder el acceso que ya tenía por una clave nueva que
  // nunca le llegó. Ver CONTEXTO.md sobre las caídas reales de msg_ninesys.
  const { idEmpresa, cliente } = empresas[0];
  try {
    await enviarWhatsapp(idEmpresa, normalizado.e164, cliente.first_name, mensaje);
  } catch (err) {
    return res.status(502).json({
      error: "No se pudo enviar la clave por WhatsApp en este momento. Volvé a intentar en unos minutos o comunicate con ventas.",
    });
  }

  // Recién acá, con el envío confirmado, se crea o actualiza la cuenta local.
  // `nombre` es una copia congelada del momento del alta (mismo criterio que
  // ya se usa en Lienzo.cliente_nombre) -- no se vuelve a sincronizar después.
  const nombreCompleto = [cliente.first_name, cliente.last_name].filter(Boolean).join(" ").trim() || "Cliente";
  await prisma.usuario.upsert({
    where: { telefono: normalizado.e164 },
    create: { telefono: normalizado.e164, nombre: nombreCompleto, password_hash: await hashPassword(pin) },
    update: { password_hash: await hashPassword(pin) },
  });

  res.json({ ok: true });
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
