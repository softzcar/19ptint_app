// Motor de acomodo: 2D strip packing (ancho fijo, alto variable/rollo).
// Ver CONTEXTO.md §7 para la especificación completa.

const SENTINEL_HEIGHT = 1_000_000; // "alto infinito" del rollo, en mm

const ROTACIONES_PERMITIDAS = {
  dtf: [0, 90],
  // 180 no cambia el footprint (mismo ancho/alto que 0), así que no aporta
  // nada a la optimización de espacio; queda disponible solo como ajuste
  // manual/visual, nunca lo elige el auto-acomodo.
  sublimacion: [0],
};

function expandirPorCopias(items) {
  const piezas = [];
  for (const item of items) {
    const copias = item.copias ?? 1;
    for (let c = 0; c < copias; c++) {
      piezas.push({
        id: item.id,
        anchoOriginal: item.anchoMM,
        altoOriginal: item.altoMM,
      });
    }
  }
  return piezas;
}

function ordenarFFD(piezas) {
  // First-Fit Decreasing: mayor a menor por área (desempata por alto).
  return [...piezas].sort((a, b) => {
    const areaA = a.anchoOriginal * a.altoOriginal;
    const areaB = b.anchoOriginal * b.altoOriginal;
    if (areaB !== areaA) return areaB - areaA;
    return b.altoOriginal - a.altoOriginal;
  });
}

function dimensionesConMargen(pieza, rotacion, margen) {
  const base =
    rotacion === 90
      ? { ancho: pieza.altoOriginal, alto: pieza.anchoOriginal }
      : { ancho: pieza.anchoOriginal, alto: pieza.altoOriginal };
  return { ancho: base.ancho + margen, alto: base.alto + margen };
}

function buscarMejorEspacio(espaciosLibres, pieza, rotacionesPermitidas, margen) {
  let mejor = null;
  for (const rotacion of rotacionesPermitidas) {
    const { ancho, alto } = dimensionesConMargen(pieza, rotacion, margen);
    for (let i = 0; i < espaciosLibres.length; i++) {
      const espacio = espaciosLibres[i];
      if (ancho > espacio.width || alto > espacio.height) continue;
      const desperdicio = espacio.width * espacio.height - ancho * alto;
      if (!mejor || desperdicio < mejor.desperdicio) {
        mejor = { indiceEspacio: i, rotacion, ancho, alto, desperdicio };
      }
    }
  }
  return mejor;
}

function dividirEspacio(espacio, x, y, ancho, alto) {
  const nuevos = [];
  const derecha = {
    x: x + ancho,
    y,
    width: espacio.width - (x + ancho - espacio.x),
    height: alto,
  };
  const abajo = {
    x: espacio.x,
    y: y + alto,
    width: espacio.width,
    height: espacio.height - (y + alto - espacio.y),
  };
  if (derecha.width > 0 && derecha.height > 0) nuevos.push(derecha);
  if (abajo.width > 0 && abajo.height > 0) nuevos.push(abajo);
  return nuevos;
}

/**
 * @param {{canvasAncho:number, tipo:'dtf'|'sublimacion', margen:number, items:Array<{id:number|string, anchoMM:number, altoMM:number, copias?:number}>}} input
 * @returns {{altoFinalUsado:number, colocaciones:Array<{id:number|string, x:number, y:number, ancho:number, alto:number, rotacion:number}>}}
 */
export function empacar(input) {
  const { canvasAncho, tipo, margen = 0, items } = input;
  const rotacionesPermitidas = ROTACIONES_PERMITIDAS[tipo];
  if (!rotacionesPermitidas) {
    throw new Error(`tipo de lienzo desconocido: ${tipo}`);
  }

  const piezas = ordenarFFD(expandirPorCopias(items));
  let espaciosLibres = [{ x: 0, y: 0, width: canvasAncho, height: SENTINEL_HEIGHT }];
  const colocaciones = [];
  let altoFinalUsado = 0;

  for (const pieza of piezas) {
    const mejor = buscarMejorEspacio(espaciosLibres, pieza, rotacionesPermitidas, margen);
    if (!mejor) {
      throw new Error(
        `la pieza id=${pieza.id} (${pieza.anchoOriginal}x${pieza.altoOriginal}mm) no entra en un lienzo de ${canvasAncho}mm de ancho`
      );
    }

    const espacio = espaciosLibres[mejor.indiceEspacio];
    const { x, y } = espacio;
    espaciosLibres.splice(mejor.indiceEspacio, 1);
    espaciosLibres.push(...dividirEspacio(espacio, x, y, mejor.ancho, mejor.alto));

    // Deflactar: la pieza real (sin el padding de margen) queda centrada
    // dentro del rectángulo empacado.
    const medioMargen = margen / 2;
    colocaciones.push({
      id: pieza.id,
      x: x + medioMargen,
      y: y + medioMargen,
      ancho: mejor.ancho - margen,
      alto: mejor.alto - margen,
      rotacion: mejor.rotacion,
    });

    altoFinalUsado = Math.max(altoFinalUsado, y + mejor.alto);
  }

  return { altoFinalUsado, colocaciones };
}
