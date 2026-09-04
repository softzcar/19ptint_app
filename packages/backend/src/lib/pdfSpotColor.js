// Plomería de bajo nivel de pdf-lib para tintas spot reales (/Separation),
// extraída y generalizada de scripts/spike-spot-pdf.js (Fase 0 del plan de
// DTF UV) -- ese spike probó que el enfoque funciona con UN rectángulo fijo;
// acá se generaliza para cualquier rect/máscara (usado por el export suelto
// de un diseño) y se agrega el trazo de un path en la misma colorspace
// (usado por CutContour, ver hojaDtfUv.js) que el spike nunca necesitó.
import { PDFName, PDFNumber, PDFDict, PDFOperator, PDFOperatorNames } from "pdf-lib";
// svgPathToOperators no está reexportado desde el entrypoint público
// "pdf-lib" -- de ahí que packages/backend/package.json fije la versión
// exacta 1.17.1 en vez de "^1.17.1" (un bump podría mover o quitar este
// archivo interno sin que npm lo marque como breaking).
import { svgPathToOperators } from "pdf-lib/cjs/api/svgPath.js";

export const PT_POR_MM = 72 / 25.4;
export const mmAPt = (mm) => Number(mm) * PT_POR_MM;

// Registra una colorspace /Separation nueva en la página y devuelve la key
// ("CS0", "CS1", ...) para usarla en NonStrokingColorspace/StrokingColorspace.
// tint 0 = sin tinta (blanco/transparente), tint 1 = tinta completa -- según
// C0/C1 de la función de transferencia (Type 2, lineal).
export function registrarSeparacion(pdfDoc, page, nombreTinta, { c0 = [1], c1 = [0] } = {}) {
  const context = pdfDoc.context;
  const tintFnRef = context.register(
    context.obj({ FunctionType: 2, Domain: [0, 1], Range: [0, 1], C0: c0, C1: c1, N: 1 })
  );
  const separationRef = context.register(context.obj(["Separation", nombreTinta, "DeviceGray", tintFnRef]));

  // ColorSpace no se normaliza sola en Resources (a diferencia de Font/
  // XObject/ExtGState) -- newExtGState() de acá abajo (llamado siempre antes
  // de tocar ColorSpace, aunque no haya soft mask) fuerza esa normalización.
  page.node.newExtGState(`GS_${nombreTinta}`, context.register(context.obj({ Type: "ExtGState" })));
  const resources = page.node.Resources();
  let colorSpaceDict = resources.lookupMaybe(PDFName.of("ColorSpace"), PDFDict);
  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({});
    resources.set(PDFName.of("ColorSpace"), colorSpaceDict);
  }
  const csKey = `CS_${nombreTinta}`;
  colorSpaceDict.set(PDFName.of(csKey), separationRef);
  return csKey;
}

// Pinta un rectángulo (en pt) relleno a tinte completo en la colorspace
// `csKey`, modulado por un soft mask de luminosidad construido desde
// `mascaraBuffer` (PNG, blanco=tinta completa, negro=sin tinta -- misma
// convención "gris=intensidad" que ya usa todo el resto de DTF UV).
export async function pintarRectanguloSpotConMascara(pdfDoc, page, csKey, mascaraBuffer, rectPt) {
  const context = pdfDoc.context;
  const { x, y, width, height } = rectPt;
  const mascaraImagen = await pdfDoc.embedPng(mascaraBuffer);

  const operadoresForm = [
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
      PDFNumber.of(width), PDFNumber.of(0), PDFNumber.of(0),
      PDFNumber.of(height), PDFNumber.of(x), PDFNumber.of(y),
    ]),
    PDFOperator.of(PDFOperatorNames.DrawObject, [PDFName.of("MascaraImg")]),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState),
  ];
  // BBox recorta en el espacio propio del form (con Matrix identidad --
  // no se especifica, pdf-lib usa identidad por defecto -- ese espacio ES
  // el espacio de página en pt, porque el form se invoca desde `gs` sin
  // ningún `cm` previo). Tiene que cubrir el rect real (x,y)-(x+width,
  // y+height): un BBox más chico que eso recortaría el contenido, que es
  // justo donde se dibuja (ver ConcatTransformationMatrix de arriba).
  const formDict = {
    Group: context.obj({ Type: "Group", S: "Transparency", CS: "DeviceGray" }),
    Resources: context.obj({ XObject: context.obj({ MascaraImg: mascaraImagen.ref }) }),
    BBox: context.obj([x, y, x + width, y + height]),
  };
  const formRef = context.register(context.formXObject(operadoresForm, formDict));

  const extGStateDict = context.obj({
    Type: "ExtGState",
    SMask: context.obj({ Type: "Mask", S: "Luminosity", G: formRef }),
  });
  const gsKey = page.node.newExtGState(`GSM_${csKey}`, context.register(extGStateDict));

  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [PDFName.of(csKey)]),
    PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [PDFNumber.of(1)]),
    PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams, [gsKey]),
    PDFOperator.of(PDFOperatorNames.AppendRectangle, [
      PDFNumber.of(x), PDFNumber.of(y), PDFNumber.of(width), PDFNumber.of(height),
    ]),
    PDFOperator.of(PDFOperatorNames.FillNonZero),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState)
  );
}

// Traza (stroke, sin relleno) un path SVG "d" en la colorspace `csKey`, a
// tinte completo -- usado por CutContour (el contorno de corte no se
// imprime, es guía vectorial para el plotter, no necesita soft mask).
// (x, y) es dónde cae el origen local del path (0,0 del "d", en px del SVG
// vectorizado) en la página, en pt. `escalaX`/`escalaY` convierten esas
// coordenadas propias a pt -- van con signo distinto (escalaY negativo)
// porque el SVG es Y-hacia-abajo (0,0 arriba-izquierda) y el PDF es
// Y-hacia-arriba (0,0 abajo-izquierda): sin flipear, el contorno queda
// espejado verticalmente respecto al arte ya dibujado con page.drawImage.
// `grosorPt` es el ancho de trazo DESEADO ya en espacio de página -- ancho
// de línea se interpreta en el espacio de usuario vigente al momento del
// stroke (afectado por el `cm` de abajo, sin importar que "w" se emita
// antes en el content stream), así que hay que compensar dividiendo por el
// factor de escala o el trazo real saldría escala veces más fino.
export function pintarPathSpotStroke(pdfDoc, page, csKey, dString, { x, y, escalaX, escalaY, grosorPt }) {
  const grosorCompensado = grosorPt / Math.abs(escalaX);
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of(csKey)]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]),
    PDFOperator.of(PDFOperatorNames.SetLineWidth, [PDFNumber.of(grosorCompensado)]),
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
      PDFNumber.of(escalaX), PDFNumber.of(0), PDFNumber.of(0),
      PDFNumber.of(escalaY), PDFNumber.of(x), PDFNumber.of(y),
    ]),
    ...svgPathToOperators(dString),
    PDFOperator.of(PDFOperatorNames.StrokePath),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState)
  );
}
