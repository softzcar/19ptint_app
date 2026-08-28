// Empresas de Ninesys que usan esta app hoy (CONTEXTO.md §15/§16) — ambas en
// el servidor de Desarrollo. Config estática a propósito: no viene de
// ninguna API, se agranda a mano si algún día se suma una empresa más.
// telefono = WhatsApp de ventas (E.164 sin '+', tal cual lo pide
// enviarWhatsapp/msg_ninesys). Tomado de api_empresas.empresas.telefono el
// 28/08 -- dato público de contacto, no de un cliente, así que duplicarlo
// acá no choca con la política de "no duplicar datos de clientes" del login
// por teléfono.
export const EMPRESAS_NINESYS = [
  { id: 194, nombre: "Nineteen Custom", telefono: "584140326592" },
  { id: 208, nombre: "19 Print", telefono: "584246321576" },
];
