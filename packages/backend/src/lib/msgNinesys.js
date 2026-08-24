// Cliente HTTP hacia msg_ninesys (microservicio de WhatsApp de Ninesys).
// POST /send-message-custom/:companyId con un token dedicado (X-19print-Token)
// en vez del login admin de uso general -- msg_ninesys no tenía forma de
// crear cuentas de servicio (login contra una única credencial hardcodeada
// en su código, sin scopes), así que se le agregó a esa ruta puntual un
// segundo mecanismo de auth exclusivo para esta integración (ver
// msg_ninesys/middleware/authenticateSendCustom.js). No afecta al JWT que
// sigue usando app_multi para el resto de rutas de msg_ninesys.
const BASE = process.env.MSG_NINESYS_URL;

export async function enviarWhatsapp(idEmpresa, phone, name, message) {
  const token = process.env.MSG_NINESYS_DTF_TOKEN;
  if (!BASE || !token) {
    throw new Error("Falta configurar MSG_NINESYS_URL/MSG_NINESYS_DTF_TOKEN en el backend (packages/backend/.env)");
  }

  const resp = await fetch(`${BASE}/send-message-custom/${idEmpresa}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-19print-Token": token },
    body: JSON.stringify({ phone, name, message }),
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`msg_ninesys /send-message-custom respondió ${resp.status}: ${texto.slice(0, 200)}`);
  }
  return resp.json().catch(() => ({ success: true }));
}
