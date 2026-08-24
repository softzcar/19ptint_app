import { empacar } from "@19print/packing-engine";

const N = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

export function calcularAcomodo({ canvasAncho, tipo, margen, imagenes }) {
  const items = imagenes.map((img) => ({
    id: img.id,
    anchoMM: N(img.ancho_mm),
    altoMM: N(img.alto_mm),
    copias: img.copias ?? 1,
  }));

  const faltantes = items.filter((i) => !i.anchoMM || !i.altoMM);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan dimensiones (ancho/alto en mm) para las imágenes: ${faltantes
        .map((i) => i.id)
        .join(", ")}`
    );
  }

  return empacar({ canvasAncho, tipo, margen, items });
}
