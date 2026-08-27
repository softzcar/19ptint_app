import { api } from "./api.js";

// Corre el upscale en el navegador del cliente (WebGL) en vez de mandarlo al
// VPS — ver CONTEXTO.md sobre el incidente que motivó esto (upscale sin GPU
// real saturaba el swap del VPS compartido). patchSize/padding son
// obligatorios: sin ellos, cualquier foto real (no un ícono chico) revienta
// el límite de textura de WebGL.
const PATCH_SIZE = 64;
const PADDING = 4;

let upscalerPromise = null;

export function navegadorCompatible() {
  return hayWebGL();
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
    // Antes probaba WebGPU primero y caía a WebGL solo si setBackend()
    // tiraba una excepción. El problema: en WebGPU el backend "funciona" (no
    // tira nada) pero el modelo de super-resolución devuelve una imagen
    // sólida negra -- reproducido con una foto opaca común, sin transparencia
    // de por medio. Confirmado a mano que forzando WebGL el mismo archivo
    // sale bien. WebGL es el backend maduro/probado para este modelo, así
    // que se usa directo sin intentar WebGPU.
    await tf.setBackend("webgl");
    await tf.ready();

    const { default: Upscaler } = await import("upscaler");
    const { default: defaultModel } = await import("@upscalerjs/default-model");
    return new Upscaler({ model: defaultModel });
  })();

  return upscalerPromise;
}

function cargarImagenDesdeSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen para procesarla"));
    img.src = src;
  });
}

function canvasDesde(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

function tieneTransparencia(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

// UpscalerJS compone sobre fondo blanco antes de correr el modelo: evita que
// el RGB que rembg/Photoroom suelen dejar "sucio" bajo los píxeles
// transparentes (no lo limpian, solo ponen alfa=0) sangre como halos oscuros
// en los bordes -- el modelo trabaja en parches y mezcla vecinos.
function componerSobreBlanco(canvasOrigen) {
  const canvas = document.createElement("canvas");
  canvas.width = canvasOrigen.width;
  canvas.height = canvasOrigen.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(canvasOrigen, 0, 0);
  return canvas;
}

function extraerCanvasAlfa(canvasOrigen) {
  const { width, height } = canvasOrigen;
  const origen = canvasOrigen.getContext("2d").getImageData(0, 0, width, height);
  const destino = new ImageData(width, height);
  for (let i = 0; i < origen.data.length; i += 4) {
    const alfa = origen.data[i + 3];
    destino.data[i] = alfa;
    destino.data[i + 1] = alfa;
    destino.data[i + 2] = alfa;
    destino.data[i + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(destino, 0, 0);
  return canvas;
}

function escalarCanvas(canvasOrigen, ancho, alto) {
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext("2d").drawImage(canvasOrigen, 0, 0, ancho, alto);
  return canvas;
}

async function subirResultado(imagenId, blob) {
  const form = new FormData();
  form.append("imagen", blob, "upscale.png");
  const { data } = await api.post(`/imagenes/${imagenId}/upscale-cliente`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// imagenId: para subir el resultado con guardar("procesadas", ...) del lado
// del backend. imagenUrl: de dónde traer los bytes ya sin fondo (variante
// "procesada" de /imagenes/:id/archivo). onProgress: 0..1.
export async function upscalearEnCliente(imagenId, imagenUrl, onProgress) {
  const upscaler = await cargarUpscaler();
  const img = await cargarImagenDesdeSrc(imagenUrl);

  const opciones = { patchSize: PATCH_SIZE, padding: PADDING, progress: (rate) => onProgress?.(rate) };

  const canvasOrigen = canvasDesde(img);

  // El modelo de super-resolución (UpscalerJS/TFJS) solo entiende RGB: al
  // leer la imagen descarta el canal alfa (tf.browser.fromPixels toma 3
  // canales) y el resultado sale SIEMPRE 100% opaco (ver tensorAsClampedArray
  // en node_modules/upscaler, que rellena el alfa de salida con 255 fijo).
  // Con una imagen de fondo transparente, eso hacía que el área transparente
  // quedara pintada sólida con lo que sea que hubiera en el RGB de abajo
  // (típicamente negro) -- "la imagen queda en negro" al hacer upscale.
  //
  // No hay forma de pedirle al modelo que respete la transparencia: el color
  // y la transparencia se procesan por separado y se recombinan al final.
  // El canal alfa no necesita superresolución IA (no tiene "detalle" que
  // alucinar) así que se reescala con el canvas, sin correr el modelo dos
  // veces.
  if (!tieneTransparencia(canvasOrigen)) {
    const resultadoBase64 = await upscaler.upscale(img, opciones);
    const blob = await (await fetch(resultadoBase64)).blob();
    return subirResultado(imagenId, blob);
  }

  const rgbBase64 = await upscaler.upscale(componerSobreBlanco(canvasOrigen), opciones);
  const rgbImg = await cargarImagenDesdeSrc(rgbBase64);
  const { naturalWidth: ancho, naturalHeight: alto } = rgbImg;

  const alfaEscalado = escalarCanvas(extraerCanvasAlfa(canvasOrigen), ancho, alto);
  const alfaData = alfaEscalado.getContext("2d").getImageData(0, 0, ancho, alto).data;

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = ancho;
  finalCanvas.height = alto;
  const finalCtx = finalCanvas.getContext("2d");
  finalCtx.drawImage(rgbImg, 0, 0);
  const finalData = finalCtx.getImageData(0, 0, ancho, alto);
  for (let i = 3; i < finalData.data.length; i += 4) {
    // alfaData es RGBA con R=G=B=alfa real y su propio canal alfa fijo en
    // 255 (extraerCanvasAlfa) -- el valor que hace falta está en el canal R
    // (i - 3), no en el canal alfa de ESE canvas (que siempre da 255 y
    // dejaba todo el resultado opaco pase lo que pase).
    finalData.data[i] = alfaData[i - 3];
  }
  finalCtx.putImageData(finalData, 0, 0);

  const blob = await new Promise((resolve) => finalCanvas.toBlob(resolve, "image/png"));
  return subirResultado(imagenId, blob);
}
