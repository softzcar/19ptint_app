// Cola de entrega a la PC de producción de una empresa (CONTEXTO.md §11-bis).
// Compartido entre routes/ninesys.js (presupuesto confirmado) y
// routes/lienzos.js (lienzo ya armado subido directo, sin presupuesto de por
// medio) -- ambos casos terminan en el mismo lugar: un lienzo con
// id_empresa_ninesys resuelto que el agente de escritorio de esa empresa
// tiene que bajar.
import { prisma } from "../db.js";
import { encolarExportLienzo } from "./queue.js";

/**
 * Deja el lienzo listo para que el agente de escritorio de esa empresa lo
 * baje a su PC de producción.
 *
 * Si el export todavía no existe (ej. el pedido se mandó sin haber tocado
 * "Exportar"), se encola el render en vez de hacerlo acá: un lienzo grande
 * tarda y haría timeoutear el request. La entrega queda creada igual y
 * simplemente no se le ofrece al agente hasta que `ruta_export` exista (ver
 * routes/agente.js).
 */
export async function encolarEntregaLienzo(lienzo, idEmpresa) {
  const agente = await prisma.empresaAgente.findUnique({
    where: { id_empresa_ninesys: idEmpresa },
  });
  if (!agente) {
    throw new Error(`La empresa ${idEmpresa} no tiene un agente de escritorio configurado (ver /admin/agentes)`);
  }

  // upsert y no create: re-enviar un lienzo ya entregado debe volver a
  // ponerlo en cola, no reventar por la unique de lienzo_id.
  await prisma.entregaLienzo.upsert({
    where: { lienzo_id: lienzo.id },
    create: { lienzo_id: lienzo.id, empresa_agente_id: agente.id },
    update: {
      empresa_agente_id: agente.id,
      estado: "pendiente",
      intentos: 0,
      ultimo_error: null,
      entregado_en: null,
      purgado_en: null,
    },
  });

  if (!lienzo.ruta_export) await encolarExportLienzo(lienzo.id);
}
