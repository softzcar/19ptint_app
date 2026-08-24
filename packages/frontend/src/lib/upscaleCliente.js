import { api } from "./api.js";

// Corre el upscale en el navegador del cliente (WebGPU si está disponible,
// si no cae a WebGL) en vez de mandarlo al VPS — ver CONTEXTO.md sobre el
// incidente que motivó esto (upscale sin GPU real saturaba el swap del VPS
// compartido). patchSize/padding son obligatorios: sin ellos, cualquier foto
// real (no un ícono chico) revienta el límite de textura de WebGL.
const PATCH_SIZE = 64;
const PADDING = 4;

let upscalerPromise = null;

export function navegadorCompatible() {
  return "gpu" in navigator || hayWebGL();
}

function hayWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function cargarUpscaler() {
  if (upscalerPromise) return upscalerPromise;

  upscalerPromise = (async () => {
    const tf = await import("@tensorflow/tfjs");
    try {
      await import("@tensorflow/tfjs-backend-webgpu");
      await tf.setBackend("webgpu");
    } catch {
      await tf.setBackend("webgl");
    }
    await tf.ready();

    const { default: Upscaler } = await import("upscaler");
    const { default: defaultModel } = await import("@upscalerjs/default-model");
    return new Upscaler({ model: defaultModel });
  })();

  return upscalerPromise;
}

// imagenId: para subir el resultado con guardar("procesadas", ...) del lado
// del backend. imagenUrl: de dónde traer los bytes ya sin fondo (variante
// "procesada" de /imagenes/:id/archivo). onProgress: 0..1.
export async function upscalearEnCliente(imagenId, imagenUrl, onProgress) {
  const upscaler = await cargarUpscaler();

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("No se pudo cargar la imagen para procesarla"));
    img.src = imagenUrl;
  });

  const resultadoBase64 = await upscaler.upscale(img, {
    patchSize: PATCH_SIZE,
    padding: PADDING,
    progress: (rate) => onProgress?.(rate),
  });

  const blob = await (await fetch(resultadoBase64)).blob();
  const form = new FormData();
  form.append("imagen", blob, "upscale.png");

  const { data } = await api.post(`/imagenes/${imagenId}/upscale-cliente`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
