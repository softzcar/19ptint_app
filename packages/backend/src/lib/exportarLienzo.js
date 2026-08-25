import { prisma } from "../db.js";
import { generarExport } from "./export.js";
import { guardar, borrar } from "./storage.js";

/**
 * Renderiza el export de un lienzo, lo guarda y actualiza la fila.
 *
 * Vive acá y no dentro de la ruta porque lo usan dos caminos: el botón
 * "Exportar" del navegador (routes/lienzos.js) y el job `exportar_lienzo` de
 * la cola (packages/worker), que corre cuando se confirma un pedido y el
 * lienzo todavía no tenía export generado.
 *
 * Siempre borra el export anterior: sin esto, cada re-exportación dejaba un
 * archivo huérfano de ~19MB (hasta 32MB) que nadie volvía a referenciar.
 *
 * @returns {Promise<{ruta_export: string, bytes: number}>}
 */
export async function exportarLienzo(lienzoId) {
  const lienzo = await prisma.lienzo.findUnique({
    where: { id: Number(lienzoId) },
    include: { items: true },
  });
  if (!lienzo) throw new Error(`lienzo ${lienzoId} no existe`);
  if (lienzo.items.length === 0) {
    throw new Error(`el lienzo ${lienzoId} no tiene piezas acomodadas para exportar`);
  }

  const imagenes = await prisma.imagen.findMany({
    where: { id: { in: lienzo.items.map((i) => i.imagen_id) } },
  });
  const imagenesPorId = new Map(imagenes.map((i) => [i.id, i]));

  const { buffer, extension } = await generarExport(lienzo, lienzo.items, imagenesPorId);
  const ruta_export = await guardar("exports", buffer, extension);

  const anterior = lienzo.ruta_export;
  await prisma.lienzo.update({ where: { id: lienzo.id }, data: { ruta_export } });

  // Después del update: si el borrado fallara, es preferible un huérfano a
  // una fila apuntando a un archivo que ya no existe.
  if (anterior && anterior !== ruta_export) await borrar(anterior);

  return { ruta_export, bytes: buffer.length };
}
