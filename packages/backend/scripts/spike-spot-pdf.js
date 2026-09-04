#!/usr/bin/env node
/**
 * Spike aislado (Fase 0 del plan de DTF UV, ver
 * /Users/ricardo/.claude/plans/witty-napping-origami.md): prueba, antes de
 * construir nada más, que se puede armar a mano con la API de bajo nivel de
 * pdf-lib un PDF con una tinta spot REAL (/Separation, no un color plano)
 * con un borde suave de relieve (soft mask de luminosidad), y que el
 * resultado abre correctamente en un RIP de verdad.
 *
 *   node packages/backend/scripts/spike-spot-pdf.js [ruta-salida.pdf]
 *
 * No toca la app (sin DB, sin servidor) -- es un experimento desechable.
 * Verificar el resultado con spike-verificar-spot-pdf.js, y (obligatorio
 * antes de seguir con el resto del plan) hacer que el usuario abra/pruebe
 * este PDF en su RIP real.
 */
import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFOperator, PDFOperatorNames } from "pdf-lib";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const SALIDA = process.argv[2] ?? "/tmp/spike-spot1.pdf";
const LADO_PT = 300; // tamaño de página en puntos (72pt/in), simple para el spike

// Máscara de prueba: círculo blanco con borde difuminado sobre negro, en RGB
// (evita depender de que el decodificador PNG interno de pdf-lib soporte
// escala de grises de 1 canal -- 3 canales idénticos rinde la misma
// luminosidad y es la ruta más compatible).
async function generarMascaraDePrueba() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stop-color="white" />
          <stop offset="100%" stop-color="black" />
        </radialGradient>
      </defs>
      <rect width="600" height="600" fill="black" />
      <circle cx="300" cy="300" r="280" fill="url(#g)" />
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const mascaraPng = await generarMascaraDePrueba();

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([LADO_PT, LADO_PT]);
  const context = pdfDoc.context;

  const mascaraImagen = await pdfDoc.embedPng(mascaraPng);

  // Form XObject (grupo de transparencia en DeviceGray) que pinta la
  // máscara -- es lo que actúa como soft mask de luminosidad.
  const operadoresForm = [
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
      PDFNumber.of(LADO_PT), PDFNumber.of(0), PDFNumber.of(0),
      PDFNumber.of(LADO_PT), PDFNumber.of(0), PDFNumber.of(0),
    ]),
    PDFOperator.of(PDFOperatorNames.DrawObject, [PDFName.of("MascaraImg")]),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState),
  ];
  const formDict = {
    Group: context.obj({ Type: "Group", S: "Transparency", CS: "DeviceGray" }),
    Resources: context.obj({ XObject: context.obj({ MascaraImg: mascaraImagen.ref }) }),
    BBox: context.obj([0, 0, LADO_PT, LADO_PT]),
  };
  const formRef = context.register(context.formXObject(operadoresForm, formDict));

  // ExtGState con el soft mask de luminosidad apuntando al form de arriba.
  const extGStateDict = context.obj({
    Type: "ExtGState",
    SMask: context.obj({ Type: "Mask", S: "Luminosity", G: formRef }),
  });
  const extGStateRef = context.register(extGStateDict);
  // Dispara la normalización de Resources en la página (crea Font/XObject/
  // ExtGState si no existían) -- necesario antes de tocar ColorSpace a mano.
  const gsKey = page.node.newExtGState("GS", extGStateRef);

  // Función de transformación de tinte (Type 2, lineal): tint 0 -> gris 1
  // (blanco, "sin tinta"), tint 1 -> gris 0.5 (gris medio, para que la
  // vista previa en DeviceGray sea visible sobre una página blanca -- la
  // tinta real es blanca/opaca, pero eso no se puede "ver" en pantalla
  // contra un fondo también blanco).
  const tintFnRef = context.register(
    context.obj({ FunctionType: 2, Domain: [0, 1], Range: [0, 1], C0: [1], C1: [0.5], N: 1 })
  );
  const nombreTinta = "Spot1_Blanco";
  const separationRef = context.register(context.obj(["Separation", nombreTinta, "DeviceGray", tintFnRef]));

  // ColorSpace no es una entrada que pdf-lib normalice por sí solo (a
  // diferencia de Font/XObject/ExtGState) -- se agrega a mano al Resources
  // ya normalizado por newExtGState() arriba.
  const resources = page.node.Resources();
  let colorSpaceDict = resources.lookupMaybe(PDFName.of("ColorSpace"), PDFDict);
  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({});
    resources.set(PDFName.of("ColorSpace"), colorSpaceDict);
  }
  const csKey = "CS0";
  colorSpaceDict.set(PDFName.of(csKey), separationRef);

  // Pinta un rectángulo del tamaño de la página en la colorspace spot, a
  // tinte completo (1), modulado por el soft mask -- el resultado visible
  // debería ser el círculo con borde difuminado, en gris medio.
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [PDFName.of(csKey)]),
    PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [PDFNumber.of(1)]),
    // gsKey ya es un PDFName (newExtGState() lo devuelve así), a diferencia
    // de csKey (string propio) -- envolverlo de nuevo con PDFName.of()
    // rompe porque PDFName.of() espera un string, no un PDFName.
    PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams, [gsKey]),
    PDFOperator.of(PDFOperatorNames.AppendRectangle, [
      PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(LADO_PT), PDFNumber.of(LADO_PT),
    ]),
    PDFOperator.of(PDFOperatorNames.FillNonZero),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState)
  );

  const bytes = await pdfDoc.save();
  await writeFile(SALIDA, bytes);
  console.log(`OK: ${SALIDA} (${bytes.length} bytes), tinta spot "${nombreTinta}"`);
}

main().catch((err) => {
  console.error("FALLÓ el spike:", err);
  process.exit(1);
});
