// Export vectorial de UN diseño DTF UV (Fase 5 del plan original, nunca
// terminada): un PDF con 4 separaciones spot reales (/Separation, no color
// plano) -- Spot1_Blanco/Spot2_Blanco desde ruta_mascara_blanco,
// Spot3_Barniz/Spot4_Barniz desde ruta_mascara_barniz (la MISMA máscara
// duplicada dos veces por tinta -- confirmado contra un archivo de
// producción real del usuario, spot/3080.tif, inspeccionado en la Fase 0).
// Mismo rol que exportarLienzo.js: cargar fila, construir, guardar,
// actualizar, borrar el archivo anterior.
//
// construirPdfDiseno() también la usa hojaDtfUv.js (armar-hoja): ahí se
// arma UNA copia con esta función y se repite N veces con
// pdfDoc.embedPage()/drawPage(), en vez de reconstruir todo el contenido
// vectorial por copia.
import { PDFDocument } from "pdf-lib";
import { prisma } from "../db.js";
import { guardar, borrar, leer } from "./storage.js";
import { mmAPt, registrarSeparacion, pintarRectanguloSpotConMascara } from "./pdfSpotColor.js";

export async function construirPdfDiseno(dtfUv) {
  if (!dtfUv.ruta_original) throw new Error("Falta la imagen original");
  if (!dtfUv.ruta_mascara_blanco || !dtfUv.ruta_mascara_barniz) {
    throw new Error("Faltan editar las máscaras (blanco/barniz) antes de exportar");
  }
  if (!dtfUv.ancho_mm || !dtfUv.alto_mm) {
    throw new Error("Falta definir el tamaño de impresión (ancho_mm/alto_mm)");
  }

  const anchoPt = mmAPt(dtfUv.ancho_mm);
  const altoPt = mmAPt(dtfUv.alto_mm);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([anchoPt, altoPt]);

  // Arte base (CMYK del diseño). embedPng lo mete como RGB, no DeviceCMYK
  // real -- a confirmar contra el RIP real en el gate duro (ver plan) si
  // hace falta convertir a CMYK antes con sharp.
  const original = await leer(dtfUv.ruta_original);
  const imagenOriginal = await pdfDoc.embedPng(original);
  page.drawImage(imagenOriginal, { x: 0, y: 0, width: anchoPt, height: altoPt });

  const rectCompleto = { x: 0, y: 0, width: anchoPt, height: altoPt };
  const mascaraBlanco = await leer(dtfUv.ruta_mascara_blanco);
  const mascaraBarniz = await leer(dtfUv.ruta_mascara_barniz);

  for (const nombreTinta of ["Spot1_Blanco", "Spot2_Blanco"]) {
    const cs = registrarSeparacion(pdfDoc, page, nombreTinta);
    await pintarRectanguloSpotConMascara(pdfDoc, page, cs, mascaraBlanco, rectCompleto);
  }
  for (const nombreTinta of ["Spot3_Barniz", "Spot4_Barniz"]) {
    const cs = registrarSeparacion(pdfDoc, page, nombreTinta);
    await pintarRectanguloSpotConMascara(pdfDoc, page, cs, mascaraBarniz, rectCompleto);
  }

  return { pdfDoc, page, anchoPt, altoPt };
}

export async function exportarDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: Number(dtfUvId) } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  const { pdfDoc } = await construirPdfDiseno(dtfUv);
  const bytes = await pdfDoc.save();
  const ruta_export_pdf = await guardar("dtf_uv", Buffer.from(bytes), ".pdf");

  const anterior = dtfUv.ruta_export_pdf;
  await prisma.dtfUv.update({ where: { id: dtfUv.id }, data: { ruta_export_pdf } });
  if (anterior && anterior !== ruta_export_pdf) await borrar(anterior);

  return { ruta_export_pdf, bytes: bytes.length };
}
