#!/usr/bin/env node
/**
 * Verifica PROGRAMÁTICAMENTE (no a simple vista -- un visor de PDF
 * cualquiera puede aplanar un color spot a su alternate space en silencio y
 * "verse bien" sin que la separación real esté ahí) que un PDF tiene una
 * colorspace /Separation real con el nombre de tinta esperado.
 *
 * Parte de la Fase 0 del plan de DTF UV (ver
 * /Users/ricardo/.claude/plans/witty-napping-origami.md) -- corre después
 * de spike-spot-pdf.js, y de nuevo en la Fase 5 contra un export real de
 * punta a punta.
 *
 *   node packages/backend/scripts/spike-verificar-spot-pdf.js [ruta.pdf] [nombreTinta...]
 *
 * Sale con código 1 si falta alguna separación esperada.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from "pdf-lib";
import { readFile } from "node:fs/promises";

const RUTA = process.argv[2] ?? "/tmp/spike-spot1.pdf";
const nombresEsperados = process.argv.slice(3);
if (nombresEsperados.length === 0) nombresEsperados.push("Spot1_Blanco");

function nombrePDF(pdfName) {
  // asString() incluye el "/" inicial (ej. "/Spot1_Blanco") -- lo saco para
  // comparar contra el nombre "plano" que se le pasó a context.obj().
  return pdfName.asString().replace(/^\//, "");
}

async function verificarSeparaciones(rutaPdf) {
  const bytes = await readFile(rutaPdf);
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const context = pdfDoc.context;

  const encontradas = [];
  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const colorSpaceDict = resources.lookupMaybe(PDFName.of("ColorSpace"), PDFDict);
    if (!colorSpaceDict) continue;

    for (const [, valorORef] of colorSpaceDict.entries()) {
      const valor = valorORef instanceof PDFRef ? context.lookup(valorORef) : valorORef;
      if (!(valor instanceof PDFArray)) continue;
      const tipo = valor.get(0);
      if (!(tipo instanceof PDFName) || nombrePDF(tipo) !== "Separation") continue;

      const nombreTinta = valor.get(1);
      const alternante = valor.get(2);
      const tintTransformRef = valor.get(3);
      const tintTransform = tintTransformRef instanceof PDFRef ? context.lookup(tintTransformRef) : tintTransformRef;

      encontradas.push({
        nombre: nombreTinta instanceof PDFName ? nombrePDF(nombreTinta) : String(nombreTinta),
        alternante: alternante instanceof PDFName ? nombrePDF(alternante) : String(alternante),
        tieneTintTransform: tintTransform instanceof PDFDict,
      });
    }
  }
  return encontradas;
}

async function main() {
  const encontradas = await verificarSeparaciones(RUTA);
  console.log(`Separaciones /Separation encontradas en ${RUTA}:`);
  for (const s of encontradas) {
    console.log(`  - "${s.nombre}" (alternate: ${s.alternante}, tint transform: ${s.tieneTintTransform ? "sí" : "FALTA"})`);
  }

  const nombresEncontrados = new Set(encontradas.map((s) => s.nombre));
  const faltantes = nombresEsperados.filter((n) => !nombresEncontrados.has(n));
  const sinTintTransform = encontradas.filter((s) => !s.tieneTintTransform);

  if (faltantes.length > 0) {
    console.error(`\nFALLÓ: faltan estas separaciones esperadas: ${faltantes.join(", ")}`);
    process.exit(1);
  }
  if (sinTintTransform.length > 0) {
    console.error(`\nFALLÓ: hay separaciones sin tint transform function: ${sinTintTransform.map((s) => s.nombre).join(", ")}`);
    process.exit(1);
  }
  console.log("\nOK: todas las separaciones esperadas están presentes con su tint transform.");
}

main().catch((err) => {
  console.error("Error verificando el PDF:", err);
  process.exit(1);
});
