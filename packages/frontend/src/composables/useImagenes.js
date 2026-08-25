import { ref, unref } from "vue";
import { api } from "../lib/api.js";
import { navegadorCompatible, upscalearEnCliente } from "../lib/upscaleCliente.js";

/**
 * Estado y acciones para administrar las imágenes de un proyecto: subida de
 * archivos, búsqueda web (Pexels), preview autenticado, controles de
 * alto/ancho/copias por imagen, upscale en cliente y eliminación.
 *
 * Extraído de ProyectoDetalleView.vue para poder reusar exactamente el mismo
 * comportamiento (mismos controles, misma forma de cargar/agregar imágenes)
 * en la vista de un lienzo ya generado ("Editar / re-acomodar"), que antes
 * solo mostraba una lista de checkboxes sin preview ni forma de agregar
 * imágenes nuevas.
 *
 * @param {string|number|import('vue').Ref} proyectoId - id del proyecto,
 *   plano o reactivo (útil cuando el id se conoce recién después de una
 *   carga async, ej. al editar un lienzo ya generado).
 * @param {() => number} obtenerAnchoLimiteMm - ancho disponible actual
 *   (ancho del lienzo - margen a cada lado, ver limiteAnchoUtilMm) usado solo
 *   para precargar el alto inicial de una imagen recién subida que nunca tuvo
 *   alto_mm guardado (capa el alto inicial para que el ancho proporcional no
 *   exceda el lienzo objetivo).
 */
export function useImagenes(proyectoId, obtenerAnchoLimiteMm) {
  const imagenes = ref([]);
  const subiendo = ref(false);
  const error = ref("");
  const previewUrls = ref({});
  const previewCargados = new Set();
  const alturasCm = ref({});
  const anchosCm = ref({});
  const proporcionBloqueada = ref({});
  const alturasInicializadas = new Set();

  const modoCarga = ref("subir"); // 'subir' | 'buscar' | 'texto'
  const busqueda = ref("");
  const buscando = ref(false);
  const busquedaError = ref("");
  const resultadosBusqueda = ref([]);
  const agregandoFotoId = ref(null);
  const arrastrandoArchivo = ref(false);

  const dispositivoCompatible = navegadorCompatible();
  const progresoUpscale = ref({});

  // Ancho proporcional a partir del alto que carga el usuario: se calcula
  // siempre desde la relación de aspecto real de la imagen (ya recortada a su
  // bounding box), así nunca se puede deformar la forma original.
  function anchoProporcionalCm(img, altoCm) {
    if (!img.ancho_px || !img.alto_px || !altoCm) return null;
    return (altoCm * (img.ancho_px / img.alto_px)).toFixed(1);
  }

  // Alto inicial para precargar una imagen recién lista (nunca ajustada a
  // mano todavía): el tamaño real del archivo a 300dpi, o si su ancho real
  // supera lo que entra en el lienzo objetivo, el alto que corresponde a
  // capar el ancho EXACTO a esa resta -- nunca se deforma, se reusa la misma
  // proporción real del archivo.
  function altoInicialCm(img) {
    if (!img.ancho_px || !img.alto_px) return null;
    const dpi = img.dpi || 300;
    const anchoOriginalCm = (img.ancho_px / dpi) * 2.54;
    const limiteAnchoCm = (obtenerAnchoLimiteMm?.() ?? 0) / 10;
    if (limiteAnchoCm > 0 && anchoOriginalCm > limiteAnchoCm) {
      return limiteAnchoCm * (img.alto_px / img.ancho_px);
    }
    return (img.alto_px / dpi) * 2.54;
  }

  async function cargar() {
    const { data } = await api.get(`/proyectos/${unref(proyectoId)}`);
    imagenes.value = data.imagenes;

    // El endpoint de archivo requiere auth (Bearer): se trae como blob
    // autenticado y se cachea como object URL en vez de usar <img src> directo.
    for (const img of data.imagenes) {
      if (img.estado_fondo !== "listo") continue;
      // quitar_fondo entra en la clave porque mantener-fondo/quitar-fondo
      // pueden cambiar qué archivo apunta ruta_procesada sin tocar
      // estado_fondo (se queda en "listo" en los dos casos).
      const clave = `${img.id}:${img.estado_fondo}:${img.estado_upscale}:${img.quitar_fondo}`;
      if (previewCargados.has(clave)) continue;
      previewCargados.add(clave);
      const resp = await api.get(`/imagenes/${img.id}/archivo`, {
        params: { variante: "procesada" },
        responseType: "blob",
      });
      previewUrls.value = { ...previewUrls.value, [img.id]: URL.createObjectURL(resp.data) };
    }

    for (const img of data.imagenes) {
      // Esperar a "listo": recién ahí ancho_px/alto_px reflejan el recorte
      // final al bounding box (antes son los del archivo subido, sin quitar
      // fondo) -- inicializar antes daría una precarga con el tamaño viejo.
      if (img.estado_fondo !== "listo" || alturasInicializadas.has(img.id)) continue;
      alturasInicializadas.add(img.id);
      proporcionBloqueada.value[img.id] = true;

      if (img.alto_mm) {
        // Ya tiene tamaño guardado (precarga previa o ajuste manual del
        // usuario en una carga anterior) -- respetar tal cual.
        alturasCm.value[img.id] = Number(img.alto_mm) / 10;
        anchosCm.value[img.id] = Number(img.ancho_mm) / 10;
      } else {
        // Primera vez: precargar con el tamaño real del archivo (capado al
        // ancho límite si hace falta) y persistirlo.
        const altoCm = altoInicialCm(img);
        if (altoCm) {
          alturasCm.value[img.id] = Number(altoCm.toFixed(1));
          await actualizarAltura(img);
        }
      }
    }
    return data;
  }

  async function subirArchivosDesde(fileList) {
    if (!fileList?.length) return;
    subiendo.value = true;
    error.value = "";
    try {
      const form = new FormData();
      for (const f of fileList) form.append("imagenes", f);
      await api.post(`/proyectos/${unref(proyectoId)}/imagenes`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await cargar();
    } catch (e) {
      error.value = e.response?.data?.error ?? "Error al subir";
    } finally {
      subiendo.value = false;
    }
  }

  function subirArchivos(event) {
    subirArchivosDesde(event.target.files);
    event.target.value = "";
  }

  // Sin preventDefault() en dragover/drop, el navegador ejecuta su acción por
  // defecto al soltar un archivo (navegar a él, se abre en pestaña nueva) en
  // vez de dispararle el evento a la app -- por eso hacía falta este handler.
  function onDropArchivos(event) {
    arrastrandoArchivo.value = false;
    const archivos = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    subirArchivosDesde(archivos);
  }

  async function buscarImagenesWeb() {
    if (!busqueda.value.trim()) return;
    buscando.value = true;
    busquedaError.value = "";
    try {
      const { data } = await api.get("/imagenes/buscar-web", { params: { q: busqueda.value, pagina: 1 } });
      resultadosBusqueda.value = data.resultados;
    } catch (e) {
      busquedaError.value = e.response?.data?.error ?? "No se pudo buscar";
    } finally {
      buscando.value = false;
    }
  }

  async function usarImagenWeb(foto) {
    agregandoFotoId.value = foto.id;
    busquedaError.value = "";
    try {
      await api.post(`/proyectos/${unref(proyectoId)}/imagenes/desde-web`, {
        url: foto.descarga,
        nombre: `pexels-${foto.id}.jpg`,
      });
      await cargar();
    } catch (e) {
      busquedaError.value = e.response?.data?.error ?? "No se pudo agregar la imagen";
    } finally {
      agregandoFotoId.value = null;
    }
  }

  async function actualizarAltura(img) {
    const altoCm = Number(alturasCm.value[img.id]) || null;
    const payload = { alto_mm: altoCm ? altoCm * 10 : null };
    if (proporcionBloqueada.value[img.id]) {
      const anchoCm = altoCm ? Number(anchoProporcionalCm(img, altoCm)) : null;
      anchosCm.value[img.id] = anchoCm;
      payload.ancho_mm = anchoCm ? anchoCm * 10 : null;
    }
    const { data } = await api.patch(`/imagenes/${img.id}`, payload);
    img.ancho_mm = data.ancho_mm;
    img.alto_mm = data.alto_mm;
  }

  async function actualizarAncho(img) {
    const anchoCm = Number(anchosCm.value[img.id]) || null;
    const { data } = await api.patch(`/imagenes/${img.id}`, { ancho_mm: anchoCm ? anchoCm * 10 : null });
    img.ancho_mm = data.ancho_mm;
  }

  function toggleProporcion(img) {
    proporcionBloqueada.value[img.id] = !proporcionBloqueada.value[img.id];
    if (proporcionBloqueada.value[img.id]) {
      // Al reactivar, se ajusta el ancho actual para que vuelva a respetar
      // la proporción real de la imagen (sin perder el alto que ya tenía).
      actualizarAltura(img);
    }
  }

  async function actualizarCopias(img) {
    // 0 es un valor legítimo (imagen todavía sin confirmar) -- "|| 1" lo
    // pisaría porque 0 es falsy en JS.
    await api.patch(`/imagenes/${img.id}`, { copias: Math.max(0, Number(img.copias) || 0) });
  }

  async function pedirUpscale(img) {
    const url = previewUrls.value[img.id];
    if (!url) return;
    progresoUpscale.value = { ...progresoUpscale.value, [img.id]: 0 };
    try {
      await upscalearEnCliente(img.id, url, (rate) => {
        progresoUpscale.value = { ...progresoUpscale.value, [img.id]: Math.round(rate * 100) };
      });
    } catch (e) {
      error.value = "No se pudo aumentar la resolución: " + (e.message ?? e);
    } finally {
      const { [img.id]: _quitado, ...resto } = progresoUpscale.value;
      progresoUpscale.value = resto;
    }
    await cargar();
  }

  async function eliminarImagen(img) {
    await api.delete(`/imagenes/${img.id}`);
    await cargar();
  }

  // Switch "Quitar fondo" (reversible): mantenerFondo es instantáneo (no hay
  // IA de por medio, solo vuelve a apuntar a la imagen original); quitarFondo
  // vuelve a encolar el mismo job que corre automáticamente al subir.
  const cambiandoFondo = ref({});

  async function mantenerFondo(img) {
    cambiandoFondo.value = { ...cambiandoFondo.value, [img.id]: true };
    try {
      await api.post(`/imagenes/${img.id}/mantener-fondo`);
      await cargar();
    } catch (e) {
      error.value = e.response?.data?.error ?? "No se pudo mantener el fondo original";
    } finally {
      const { [img.id]: _quitado, ...resto } = cambiandoFondo.value;
      cambiandoFondo.value = resto;
    }
  }

  async function quitarFondo(img) {
    cambiandoFondo.value = { ...cambiandoFondo.value, [img.id]: true };
    try {
      await api.post(`/imagenes/${img.id}/quitar-fondo`);
      await cargar();
    } catch (e) {
      error.value = e.response?.data?.error ?? "No se pudo quitar el fondo";
    } finally {
      const { [img.id]: _quitado, ...resto } = cambiandoFondo.value;
      cambiandoFondo.value = resto;
    }
  }

  return {
    imagenes,
    subiendo,
    error,
    previewUrls,
    alturasCm,
    anchosCm,
    proporcionBloqueada,
    modoCarga,
    busqueda,
    buscando,
    busquedaError,
    resultadosBusqueda,
    agregandoFotoId,
    arrastrandoArchivo,
    dispositivoCompatible,
    progresoUpscale,
    cambiandoFondo,
    anchoProporcionalCm,
    cargar,
    subirArchivosDesde,
    subirArchivos,
    onDropArchivos,
    buscarImagenesWeb,
    usarImagenWeb,
    actualizarAltura,
    actualizarAncho,
    toggleProporcion,
    actualizarCopias,
    pedirUpscale,
    eliminarImagen,
    mantenerFondo,
    quitarFondo,
  };
}

// El margen del lienzo se aplica a cada lado (ej. 5mm de margen = 5mm a la
// izquierda + 5mm a la derecha), por eso se resta *2 y no una sola vez.
export function limiteAnchoUtilMm(anchoLienzoMm, margenMm) {
  return Number(anchoLienzoMm) - Number(margenMm) * 2;
}

/**
 * Chequeo previo a "Auto-acomodar"/"Volver a acomodar": una imagen con fondo
 * listo pero sin ancho/alto, sin copias (nace en 0 a propósito, ver
 * schema.prisma) o más ancha que lo que entra en el lienzo quedaría
 * silenciosamente afuera del acomodo (o el backend la rechazaría con un
 * error genérico) -- mejor avisar antes, imagen por imagen.
 */
export function validarParaAcomodar(imagenes, anchoLienzoMm, margenMm) {
  const limite = limiteAnchoUtilMm(anchoLienzoMm, margenMm);
  const errores = [];
  for (const img of imagenes) {
    const nombre = img.nombre_original ?? `#${img.id}`;

    // Una imagen puede quedar seleccionada (checkbox marcado en
    // LienzoView) y recién después el usuario prende el switch "Quitar
    // fondo" sobre ella -- la selección sigue en true aunque el checkbox ya
    // no se vea, así que sin este chequeo el acomodo la ignoraría en
    // silencio (el backend solo empaqueta estado_fondo=listo).
    if (img.estado_fondo === "pendiente" || img.estado_fondo === "procesando") {
      errores.push(`${nombre}: se está quitando el fondo, esperá a que termine antes de acomodar.`);
      continue;
    }
    if (img.estado_fondo !== "listo") continue; // error u otro estado: se excluye en silencio, sin cambios
    if (!img.ancho_mm || !img.alto_mm) {
      errores.push(`${nombre}: falta definir el ancho y el alto.`);
      continue;
    }
    if (!Number(img.copias)) {
      errores.push(`${nombre}: indicá la cantidad de copias (no puede quedar en 0).`);
    }
    if (Number(img.ancho_mm) > limite) {
      errores.push(
        `${nombre}: el ancho (${(Number(img.ancho_mm) / 10).toFixed(1)}cm) supera el ancho disponible del lienzo (${(limite / 10).toFixed(1)}cm, con ${margenMm}mm de margen a cada lado).`
      );
    }
  }
  return errores;
}
