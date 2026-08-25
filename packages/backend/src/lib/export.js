import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { leer } from "./storage.js";

// DPI único usado para renderizar el lienzo completo (independiente del dpi
// de captura de cada imagen individual, que solo se usa para trazabilidad).
const EXPORT_DPI = 300;
const mmToPx = (mm) => Math.max(1, Math.round((mm / 25.4) * EXPORT_DPI));

async function renderizarCanvas(lienzo, items, imagenesPorId) {
  const widthPx = mmToPx(Number(lienzo.ancho_mm));
  const heightPx = mmToPx(Number(lienzo.alto_usado_mm));

  const composites = [];
  for (const item of items) {
    const imagen = imagenesPorId.get(item.imagen_id);
    const rutaFuente = imagen.ruta_procesada ?? imagen.ruta_original;
    const buffer = await leer(rutaFuente);

    // Se redimensiona a las dimensiones ORIGINALES (sin rotar) de la imagen;
    // la rotación se aplica después, así la huella final coincide con
    // item.ancho_mm/alto_mm (que ya reflejan la rotación elegida por el motor).
    const anchoPx = mmToPx(Number(imagen.ancho_mm));
    const altoPx = mmToPx(Number(imagen.alto_mm));
    let pieza = sharp(buffer).resize(anchoPx, altoPx, { fit: "fill" });
    if (item.rotacion) pieza = pieza.rotate(item.rotacion);

    composites.push({
      input: await pieza.png().toBuffer(),
      left: mmToPx(Number(item.x_mm)),
      top: mmToPx(Number(item.y_mm)),
    });
  }

  const fondoTransparente = lienzo.tipo === "dtf";
  return sharp({
    create: {
      width: widthPx,
      height: heightPx,
      channels: 4,
      background: fondoTransparente
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .toColourspace("srgb")
    // Sin esto el PNG no lleva DPI embebido: varios RIP/editores asumen
    // 1px=1mm en ausencia de esa metadata, y el archivo aparenta un tamaño
    // ~11.8x mayor al real (28cm salían como ~330cm).
    .withMetadata({ density: EXPORT_DPI })
    .png()
    .toBuffer()
    .then((buf) => ({ buffer: buf, widthPx, heightPx }));
}

async function pngABuffer(png, formato) {
  const img = sharp(png.buffer).withMetadata({ density: EXPORT_DPI });
  if (formato === "jpeg") {
    return img.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 95 }).toBuffer();
  }
  return img.toBuffer(); // png ya viene en el formato final
}

async function pngAPdf(png) {
  // TODO (pendiente en CONTEXTO.md §8/§10): embeber perfil ICC de
  // sublimación cuando se defina cuál usa el RIP. Por ahora exporta sin
  // perfil embebido.
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png.buffer);
  const widthPt = (png.widthPx / EXPORT_DPI) * 72;
  const heightPt = (png.heightPx / EXPORT_DPI) * 72;
  const page = doc.addPage([widthPt, heightPt]);
  page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  return Buffer.from(await doc.save());
}

export async function generarExport(lienzo, items, imagenesPorId) {
  const png = await renderizarCanvas(lienzo, items, imagenesPorId);

  if (lienzo.formato_exportacion === "png") {
    return { buffer: png.buffer, extension: ".png" };
  }
  if (lienzo.formato_exportacion === "jpeg") {
    return { buffer: await pngABuffer(png, "jpeg"), extension: ".jpeg" };
  }
  if (lienzo.formato_exportacion === "pdf") {
    return { buffer: await pngAPdf(png), extension: ".pdf" };
  }
  throw new Error(`formato de exportación desconocido: ${lienzo.formato_exportacion}`);
}
