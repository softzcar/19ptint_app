// "Armar hoja": N copias idénticas de un diseño DTF UV en una grilla simple
// (filas × columnas) sobre un rollo de ancho fijo -- deliberadamente MÁS
// SIMPLE que el bin-packer de packages/packing-engine (empacar()), que
// existe para acomodar muchas imágenes DISTINTAS de tamaños distintos; acá
// todas las piezas son la misma copia repetida, así que una grilla alcanza
// y hace que la posición de las marcas de registro sea predecible (fija
// por hoja, no por pieza).
//
// Convención de coordenadas de `posiciones`: x_mm/y_mm es la esquina
// INFERIOR-izquierda de cada copia, medida desde la esquina inferior-
// izquierda de la hoja -- la misma convención Y-hacia-arriba que usa PDF
// nativamente (evita tener que re-flipear en construirHojaPdf).
import { PDFDocument, rgb, degrees } from "pdf-lib";
import { prisma } from "../db.js";
import { guardar, borrar, leer } from "./storage.js";
import { mmAPt, registrarSeparacion, pintarPathSpotStroke } from "./pdfSpotColor.js";
import { construirPdfDiseno } from "./exportarDtfUv.js";
import { parsearSvgVector } from "./svgVector.js";

// Ancho de trazo del contorno de corte, ya en espacio de página -- no es un
// parámetro de usuario (a diferencia de marca_registro_mm), es un detalle
// de implementación: un hairline es lo esperado para una guía de corte.
const GROSOR_CORTE_PT = 0.75;

export function calcularGrillaHoja({ anchoRolloMm, anchoDisenoMm, altoDisenoMm, copias, margenMm, marcaRegistroMm, rotar }) {
  const anchoRollo = Number(anchoRolloMm);
  const margen = Number(margenMm);
  const marca = Number(marcaRegistroMm);
  const copiasN = Number(copias);
  // Rotada 90°, la copia ocupa en la grilla el alto del diseño como ancho y
  // viceversa -- afecta cuántas entran por fila y el alto final de la hoja.
  // La rotación real del contenido (rotate: degrees(90) en pdf-lib) va en
  // construirHojaPdf(), acá solo importa para el cálculo de espacio.
  const anchoDiseno = Number(rotar ? altoDisenoMm : anchoDisenoMm);
  const altoDiseno = Number(rotar ? anchoDisenoMm : altoDisenoMm);

  if (!Number.isFinite(copiasN) || copiasN < 1) {
    throw new Error("copias debe ser al menos 1");
  }

  // Zona muerta en los 4 bordes de la hoja, para que las marcas de
  // registro (y su margen) no se solapen con ninguna copia.
  const borde = margen + marca;
  const anchoUtilMm = anchoRollo - 2 * borde;
  if (anchoDiseno > anchoUtilMm) {
    throw new Error(
      `El diseño (${anchoDiseno}mm de ancho${rotar ? ", rotado" : ""}) no entra en el ancho útil de este rollo ` +
        `(${anchoUtilMm.toFixed(1)}mm, descontando margen y marcas de registro de los bordes)`
    );
  }

  const columnas = Math.max(1, Math.floor((anchoUtilMm + margen) / (anchoDiseno + margen)));
  const filas = Math.ceil(copiasN / columnas);
  const altoHojaMm = filas * altoDiseno + (filas - 1) * margen + 2 * borde;

  const posiciones = [];
  for (let i = 0; i < copiasN; i++) {
    const fila = Math.floor(i / columnas); // 0 = fila de más arriba
    const col = i % columnas;
    const xMm = borde + col * (anchoDiseno + margen);
    const yDesdeArribaMm = borde + fila * (altoDiseno + margen);
    const yMm = altoHojaMm - yDesdeArribaMm - altoDiseno; // "desde abajo", convención PDF
    posiciones.push({ x_mm: xMm, y_mm: yMm });
  }

  return { columnas, filas, altoHojaMm, posiciones };
}

// Dibuja el contorno de corte (silueta vectorizada real, ver
// packages/frontend/.../EditorMascara.vue para el mismo parseo del lado
// del browser) sobre `page` (ya con el arte + máscaras spot pintadas por
// construirPdfDiseno), en la separación "CutContour" -- tinta informativa,
// no se imprime físicamente (a diferencia de las marcas de registro).
async function pintarContornoDeCorte(pdfDoc, page, dtfUv, anchoPt, altoPt) {
  if (!dtfUv.ruta_vector) throw new Error("Falta la silueta vectorizada (ruta_vector) para el contorno de corte");
  const svgTexto = (await leer(dtfUv.ruta_vector)).toString("utf8");
  const { anchoPx, paths } = parsearSvgVector(svgTexto);
  if (paths.length === 0) throw new Error("El SVG vectorizado no tiene ningún path");

  // Escala uniforme px->pt: asume que ancho_mm/alto_mm conservan la
  // proporción del diseño subido (lo normal, ya que ambos se derivan de la
  // misma imagen) -- si no la conservan, el contorno queda levemente
  // distorsionado respecto al arte, algo que la verificación visual (ver
  // plan) debería notar.
  const escala = anchoPt / anchoPx;
  const csCorte = registrarSeparacion(pdfDoc, page, "CutContour", { c0: [0], c1: [1] });

  for (const p of paths) {
    pintarPathSpotStroke(pdfDoc, page, csCorte, p.d, {
      x: p.tx * escala,
      y: altoPt - p.ty * escala,
      escalaX: escala,
      escalaY: -escala, // SVG es Y-hacia-abajo, PDF es Y-hacia-arriba
      grosorPt: GROSOR_CORTE_PT,
    });
  }
}

// Arma la hoja completa: UNA copia (arte + máscaras spot + contorno de
// corte, vía construirPdfDiseno + pintarContornoDeCorte) embebida como
// XObject reusable (pdfDoc.embedPage) y repetida N veces en una grilla,
// más las marcas de registro ARMS en las 4 esquinas de la hoja.
export async function construirHojaPdf(dtfUv) {
  if (!dtfUv.copias || !dtfUv.ancho_hoja_mm || !dtfUv.alto_hoja_mm) {
    throw new Error("Falta armar la hoja (copias/ancho_hoja_mm/alto_hoja_mm) antes de exportarla");
  }

  const { pdfDoc, page: paginaMaestra, anchoPt, altoPt } = await construirPdfDiseno(dtfUv);
  await pintarContornoDeCorte(pdfDoc, paginaMaestra, dtfUv, anchoPt, altoPt);

  const embebida = await pdfDoc.embedPage(paginaMaestra);

  const rotar = Boolean(dtfUv.rotar_copias);
  const { posiciones } = calcularGrillaHoja({
    anchoRolloMm: dtfUv.ancho_hoja_mm,
    anchoDisenoMm: dtfUv.ancho_mm,
    altoDisenoMm: dtfUv.alto_mm,
    copias: dtfUv.copias,
    margenMm: dtfUv.margen_hoja_mm,
    marcaRegistroMm: dtfUv.marca_registro_mm,
    rotar,
  });

  const anchoHojaPt = mmAPt(dtfUv.ancho_hoja_mm);
  const altoHojaPt = mmAPt(dtfUv.alto_hoja_mm);
  const hojaPage = pdfDoc.addPage([anchoHojaPt, altoHojaPt]);

  for (const pos of posiciones) {
    const xPt = mmAPt(pos.x_mm);
    const yPt = mmAPt(pos.y_mm);
    if (rotar) {
      // drawPage con rotate: degrees(90) ancla el punto (x,y) en la esquina
      // INFERIOR-DERECHA del recuadro ya rotado (probado directo contra
      // pdf-lib, no asumido) -- para que el recuadro rotado ocupe
      // exactamente [pos.x_mm, pos.x_mm+altoPt] x [pos.y_mm, pos.y_mm+anchoPt]
      // (el footprint "efectivo" que ya calculó calcularGrillaHoja), el
      // ancla va en x = xPt + altoPt (borde derecho), y = yPt.
      hojaPage.drawPage(embebida, { x: xPt + altoPt, y: yPt, rotate: degrees(90) });
    } else {
      hojaPage.drawPage(embebida, { x: xPt, y: yPt });
    }
  }

  // Marcas de registro ARMS: cuadrados negros sólidos, SÍ se imprimen
  // físicamente (a diferencia de CutContour) para que la cámara óptica del
  // plotter las vea. Borde exterior de cada marca a margen_hoja_mm del
  // borde físico de la hoja -- este offset puntual es justo lo que hay que
  // confirmar contra el software/plotter Graphtec real (ver plan).
  const marcaPt = mmAPt(dtfUv.marca_registro_mm);
  const margenPt = mmAPt(dtfUv.margen_hoja_mm);
  const esquinas = [
    { x: margenPt, y: margenPt }, // abajo-izquierda
    { x: anchoHojaPt - margenPt - marcaPt, y: margenPt }, // abajo-derecha
    { x: margenPt, y: altoHojaPt - margenPt - marcaPt }, // arriba-izquierda
    { x: anchoHojaPt - margenPt - marcaPt, y: altoHojaPt - margenPt - marcaPt }, // arriba-derecha
  ];
  for (const esquina of esquinas) {
    hojaPage.drawRectangle({ x: esquina.x, y: esquina.y, width: marcaPt, height: marcaPt, color: rgb(0, 0, 0) });
  }

  // Saca la página maestra (ya embebida como XObject, no hace falta como
  // página propia) -- deja solo la hoja final en el PDF guardado.
  pdfDoc.removePage(0);

  return await pdfDoc.save();
}

export async function exportarHojaDtfUv(dtfUvId) {
  const dtfUv = await prisma.dtfUv.findUnique({ where: { id: Number(dtfUvId) } });
  if (!dtfUv) throw new Error(`dtf_uv ${dtfUvId} no existe`);

  const bytes = await construirHojaPdf(dtfUv);
  const ruta_hoja_pdf = await guardar("dtf_uv", Buffer.from(bytes), ".pdf");

  const anterior = dtfUv.ruta_hoja_pdf;
  await prisma.dtfUv.update({ where: { id: dtfUv.id }, data: { ruta_hoja_pdf } });
  if (anterior && anterior !== ruta_hoja_pdf) await borrar(anterior);

  return { ruta_hoja_pdf, bytes: bytes.length };
}
