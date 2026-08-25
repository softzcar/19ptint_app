import { empacar } from "@19print/packing-engine";

const N = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

export function calcularAcomodo({ canvasAncho, tipo, margen, imagenes }) {
  const items = imagenes.map((img) => ({
    id: img.id,
    nombre: img.nombre_original ?? `#${img.id}`,
    anchoMM: N(img.ancho_mm),
    altoMM: N(img.alto_mm),
    // A diferencia del resto de la app, acá NO se cae a 1 por defecto: nace
    // en 0 a propósito (schema.prisma) para obligar al usuario a confirmar
    // la cantidad antes de generar -- se valida explícito más abajo.
    copias: img.copias ?? 0,
  }));

  const faltantes = items.filter((i) => !i.anchoMM || !i.altoMM);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan dimensiones (ancho/alto en mm) para las imágenes: ${faltantes
        .map((i) => i.nombre)
        .join(", ")}`
    );
  }

  const sinCopias = items.filter((i) => !i.copias);
  if (sinCopias.length > 0) {
    throw new Error(
      `Falta indicar la cantidad de copias (no puede quedar en 0) para las imágenes: ${sinCopias
        .map((i) => i.nombre)
        .join(", ")}`
    );
  }

  // El margen se aplica a cada lado del lienzo (5mm de margen = 5mm a la
  // izquierda + 5mm a la derecha).
  const anchoUtil = Number(canvasAncho) - Number(margen) * 2;
  const demasiadoAnchas = items.filter((i) => i.anchoMM > anchoUtil);
  if (demasiadoAnchas.length > 0) {
    throw new Error(
      `El ancho supera lo disponible en el lienzo (${anchoUtil}mm, con ${margen}mm de margen a cada lado) para las imágenes: ${demasiadoAnchas
        .map((i) => i.nombre)
        .join(", ")}`
    );
  }

  return empacar({ canvasAncho, tipo, margen, items });
}
