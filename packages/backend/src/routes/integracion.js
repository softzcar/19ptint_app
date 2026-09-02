import { Router } from "express";
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { hashPassword } from "../lib/auth.js";
import { normalizarTelefono } from "../lib/telefono.js";
import { empresasDondeEsCliente } from "../lib/clienteNinesys.js";
import { enviarWhatsapp } from "../lib/msgNinesys.js";

export const integracionRouter = Router();

/**
 * Carril de auth propio para llamadas servidor-a-servidor desde ninesys-api
 * (fallback manual de clave cuando el WhatsApp automático falla, ver
 * app_multi "Gestión de Clientes") -- separado del JWT de usuario (lib/auth.js)
 * igual que agenteRouter, porque acá quien llama es otro backend, no una
 * persona logueada.
 */
function requireServiceToken(req, res, next) {
  const esperado = process.env.INTEGRACION_ADMIN_TOKEN;
  const recibido = req.get("X-Service-Token");
  const bufEsperado = Buffer.from(esperado ?? "");
  const bufRecibido = Buffer.from(recibido ?? "");
  const coincide =
    esperado && recibido && bufEsperado.length === bufRecibido.length && timingSafeEqual(bufEsperado, bufRecibido);
  if (!coincide) return res.status(401).json({ error: "Token inválido" });
  next();
}

integracionRouter.use(requireServiceToken);

// Fallback manual de "olvidé mi clave": a diferencia de /auth/solicitar-clave
// (autoservicio, ver routes/auth.js), acá quien pide la clave es el staff
// desde app_multi porque el WhatsApp automático al cliente falló -- por eso
// el PIN SÍ viaja en la respuesta (alguien lo va a leer y comunicar por otra
// vía) y el hash SIEMPRE se guarda, haya funcionado el envío automático o no.
integracionRouter.post("/clientes/generar-clave", async (req, res) => {
  const normalizado = normalizarTelefono(req.body?.telefono);
  if (!normalizado) return res.status(400).json({ error: "Teléfono inválido" });

  const empresas = await empresasDondeEsCliente(normalizado);
  if (empresas.length === 0) {
    return res.status(404).json({ error: "Este teléfono no está registrado como cliente en ninguna empresa" });
  }

  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { idEmpresa, cliente } = empresas[0];
  const nombreCompleto = [cliente.first_name, cliente.last_name].filter(Boolean).join(" ").trim() || "Cliente";
  const mensaje = [
    "Hola, esta es su clave de acceso a Nineteen Print (dtf.ninesys19.com):",
    "",
    pin,
    "",
    "Úsela junto a su número de teléfono para entrar. Si vuelve a pedir una clave, la anterior deja de funcionar.",
  ].join("\n");

  let whatsappEnviado = true;
  let whatsappMotivo;
  try {
    await enviarWhatsapp(idEmpresa, normalizado.e164, cliente.first_name, mensaje);
  } catch (err) {
    whatsappEnviado = false;
    whatsappMotivo = err.message;
  }

  await prisma.usuario.upsert({
    where: { telefono: normalizado.e164 },
    create: { telefono: normalizado.e164, nombre: nombreCompleto, password_hash: await hashPassword(pin) },
    update: { password_hash: await hashPassword(pin) },
  });

  res.json({ pin, nombre: nombreCompleto, whatsappEnviado, whatsappMotivo });
});
