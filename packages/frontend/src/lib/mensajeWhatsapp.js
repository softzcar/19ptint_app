// Texto de confirmación enviado por WhatsApp al cliente después de crear el
// presupuesto real en Ninesys (CONTEXTO.md §15/§16). Antes este texto era lo
// que el CLIENTE mandaba a mano por wa.me; ahora lo manda el backend de
// 19print server-to-server, así que es una notificación, no un pedido.
export function construirMensajeConfirmacion({ idPresupuesto, servicioNombre, cantidadMetros, urlLienzo }) {
  return [
    `Hola, tu pedido quedó registrado en Nineteen (presupuesto #${idPresupuesto}).`,
    "",
    `Producto: ${servicioNombre}`,
    `Cantidad: ${cantidadMetros} metros`,
    "",
    `Diseño listo para imprimir: ${urlLienzo}`,
    "",
    "Un asesor se va a comunicar para confirmar el pago y la entrega.",
  ].join("\n");
}
