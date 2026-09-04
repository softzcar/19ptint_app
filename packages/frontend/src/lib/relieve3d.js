// Sombreado 3D compartido: interpreta un mapa de alturas (0-1 por píxel,
// típicamente el canal alfa de una máscara spot) como relieve y lo sombrea
// bajo una luz fija -- blanco = relieve mate, barniz = laca translúcida con
// brillo especular. Usado tanto por CargaDtfUv.vue (vista previa en vivo
// desde los sliders, antes de generar nada) como por EditorMascara.vue
// (vista previa mientras se pinta) para no duplicar la física del shading.
const FUERZA_NORMAL = 3.2;
// Luz fija arriba-a-la-izquierda, un poco hacia la cámara -- da la
// sensación de "inclinado bajo una luz de mesa", igual para las dos capas.
const LUZ = normalizar([-0.4, -0.6, 0.7]);

function normalizar([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
function producto(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function escalar(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function restar(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * @param {(x: number, y: number) => number} altura función que devuelve la
 *   altura (0-1) en (x,y), ya clampeada a los bordes por el llamador.
 * @param {number} ancho
 * @param {number} alto
 * @param {'blanco'|'barniz'} tipo
 * @returns {ImageData}
 */
export function sombrearRelieve(altura, ancho, alto, tipo) {
  const salida = new ImageData(ancho, alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const h = altura(x, y);
      const dx = (altura(x + 1, y) - altura(x - 1, y)) * FUERZA_NORMAL;
      const dy = (altura(x, y + 1) - altura(x, y - 1)) * FUERZA_NORMAL;
      const normal = normalizar([-dx, -dy, 1]);
      const difuso = Math.max(0, producto(normal, LUZ));

      let r, g, b, a;
      if (tipo === "barniz") {
        const reflejo = restar(escalar(normal, 2 * producto(normal, LUZ)), LUZ);
        const especular = Math.pow(Math.max(0, reflejo[2]), 24);
        const brillo = 0.3 + difuso * 0.45;
        r = Math.min(255, 190 * brillo + 255 * especular);
        g = Math.min(255, 210 * brillo + 255 * especular);
        b = Math.min(255, 225 * brillo + 255 * especular);
        a = Math.min(255, h * 150 + especular * 200);
      } else {
        const brillo = 0.35 + difuso * 0.65;
        r = g = 248 * brillo;
        b = 240 * brillo;
        a = h * 255;
      }
      const i = (y * ancho + x) * 4;
      salida.data[i] = r;
      salida.data[i + 1] = g;
      salida.data[i + 2] = b;
      salida.data[i + 3] = a;
    }
  }
  return salida;
}

/** Envuelve un ImageData de alfa (canal 3) en un accesor `altura(x,y)` con clamp a los bordes -- forma más común de invocar sombrearRelieve(). */
export function alturaDesdeAlfa(imageData, ancho, alto) {
  return alturaDesdeCanal(imageData, ancho, alto, 3);
}

/** Igual que alturaDesdeAlfa pero leyendo el canal R (índice 0) -- para
 * imágenes opacas donde gris = intensidad (la convención de las máscaras
 * "horneadas" en EditorMascara.vue), en vez de imágenes con alfa real. */
export function alturaDesdeCanalR(imageData, ancho, alto) {
  return alturaDesdeCanal(imageData, ancho, alto, 0);
}

function alturaDesdeCanal(imageData, ancho, alto, canal) {
  return (x, y) => {
    const cx = Math.min(ancho - 1, Math.max(0, x));
    const cy = Math.min(alto - 1, Math.max(0, y));
    return imageData.data[(cy * ancho + cx) * 4 + canal] / 255;
  };
}
