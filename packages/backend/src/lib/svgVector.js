// Parseo del SVG vectorizado (ruta_vector, generado por vtracer) del lado
// del servidor -- distinto del parseo en el browser de EditorMascara.vue,
// que usa DOMParser/DOMMatrix reales, no disponibles en Node. Confirmado
// esta sesión (al arreglar el bug de "el vector no está sobre la imagen" en
// EditorMascara.vue): vtracer agrupa los paths por color y cada uno trae su
// propio transform="translate(x,y)" -- si se descarta ese atributo, cada
// path se dibuja en su propio sistema de coordenadas local en vez de su
// posición real dentro del lienzo.
const RE_SVG_SIZE = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/;
const RE_PATH = /<path\b[^>]*>/g;
const RE_D = /\sd="([^"]*)"/;
const RE_TRANSFORM = /\stransform="([^"]*)"/;
const RE_TRANSLATE = /^translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)$/;

// { anchoPx, altoPx, paths: [{ d, tx, ty }] }
export function parsearSvgVector(svgText) {
  const tamano = svgText.match(RE_SVG_SIZE);
  if (!tamano) throw new Error("No se pudo leer el ancho/alto del SVG vectorizado");
  const anchoPx = Number(tamano[1]);
  const altoPx = Number(tamano[2]);

  const paths = [];
  for (const etiqueta of svgText.match(RE_PATH) ?? []) {
    const dMatch = etiqueta.match(RE_D);
    if (!dMatch) continue;
    const transformMatch = etiqueta.match(RE_TRANSFORM);
    let tx = 0;
    let ty = 0;
    if (transformMatch) {
      const t = transformMatch[1].trim();
      const traslacion = t.match(RE_TRANSLATE);
      // Solo translate(x,y) está soportado -- es la única forma que vtracer
      // genera (confirmado esta sesión). Si algún día aparece otra forma
      // (matrix/scale/rotate), mejor un error explícito acá que dibujar mal
      // en silencio en el PDF de corte.
      if (!traslacion) {
        throw new Error(`transform de path SVG no soportado (solo translate): "${t}"`);
      }
      tx = Number(traslacion[1]);
      ty = Number(traslacion[2]);
    }
    paths.push({ d: dMatch[1], tx, ty });
  }
  return { anchoPx, altoPx, paths };
}
