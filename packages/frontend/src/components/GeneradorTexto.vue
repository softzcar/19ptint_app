<script setup>
import { ref, onMounted, watch } from "vue";
import { api } from "../lib/api.js";

const props = defineProps({ proyectoId: { type: [String, Number], required: true } });
const emit = defineEmits(["agregada"]);

const FUENTES = [
  "Montserrat",
  "Anton",
  "Bebas Neue",
  "Oswald",
  "Pacifico",
  "Permanent Marker",
  "Playfair Display",
  "Poppins",
];

const texto = ref("TU TEXTO");
const fuente = ref("Montserrat");
const tamano = ref(120);
const colorTexto = ref("#0F6E56");
const contornoActivo = ref(true);
const colorContorno = ref("#0A2419");
const grosorContorno = ref(6);
const sombraActiva = ref(false);
const colorSombra = ref("#0A2419");
const blurSombra = ref(10);
const offsetXSombra = ref(6);
const offsetYSombra = ref(6);

const canvasRef = ref(null);
const agregando = ref(false);
const error = ref("");
let debounceId = null;

async function redibujar() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const cuerpo = texto.value || " ";

  const specMedida = `900 ${tamano.value}px "${fuente.value}"`;
  await document.fonts.load(specMedida);

  const medidor = canvas.getContext("2d");
  medidor.font = specMedida;
  const anchoTexto = medidor.measureText(cuerpo).width;

  const margenSombra = sombraActiva.value
    ? blurSombra.value + Math.max(Math.abs(offsetXSombra.value), Math.abs(offsetYSombra.value))
    : 0;
  const margenContorno = contornoActivo.value ? grosorContorno.value : 0;
  const padding = margenContorno + margenSombra + tamano.value * 0.15;

  canvas.width = Math.ceil(anchoTexto + padding * 2);
  canvas.height = Math.ceil(tamano.value * 1.3 + padding * 2);

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = specMedida;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  function aplicarSombra() {
    if (sombraActiva.value) {
      ctx.shadowColor = colorSombra.value;
      ctx.shadowBlur = blurSombra.value;
      ctx.shadowOffsetX = offsetXSombra.value;
      ctx.shadowOffsetY = offsetYSombra.value;
    } else {
      ctx.shadowColor = "transparent";
    }
  }

  if (contornoActivo.value) {
    aplicarSombra();
    ctx.lineWidth = grosorContorno.value;
    ctx.strokeStyle = colorContorno.value;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeText(cuerpo, cx, cy);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = colorTexto.value;
    ctx.fillText(cuerpo, cx, cy);
  } else {
    aplicarSombra();
    ctx.fillStyle = colorTexto.value;
    ctx.fillText(cuerpo, cx, cy);
    ctx.shadowColor = "transparent";
  }
}

function programarRedibujo() {
  clearTimeout(debounceId);
  debounceId = setTimeout(redibujar, 120);
}

watch(
  [texto, fuente, tamano, colorTexto, contornoActivo, colorContorno, grosorContorno, sombraActiva, colorSombra, blurSombra, offsetXSombra, offsetYSombra],
  programarRedibujo
);
onMounted(redibujar);

// Recorta el canvas al bounding box real del contenido (misma idea que el
// recorte por alfa del quitado de fondo, CONTEXTO.md §7) para no exportar
// relleno transparente de sobra alrededor del texto.
function recortar(canvas) {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return canvas;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const salida = document.createElement("canvas");
  salida.width = w;
  salida.height = h;
  salida.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return salida;
}

async function agregarAlProyecto() {
  if (!texto.value.trim()) return;
  agregando.value = true;
  error.value = "";
  try {
    await redibujar();
    const recortado = recortar(canvasRef.value);
    const blob = await new Promise((resolve) => recortado.toBlob(resolve, "image/png"));
    const form = new FormData();
    form.append("imagen", blob, `texto-${Date.now()}.png`);
    await api.post(`/proyectos/${props.proyectoId}/imagenes/generada`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    emit("agregada");
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo agregar el texto";
  } finally {
    agregando.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="space-y-3">
        <label class="block text-sm text-np-ink/60">
          Texto
          <input
            v-model="texto"
            maxlength="40"
            class="w-full border border-black/10 rounded-lg px-3 py-2 mt-1 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
          />
        </label>

        <label class="block text-sm text-np-ink/60">
          Fuente
          <select
            v-model="fuente"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          >
            <option v-for="f in FUENTES" :key="f" :value="f" :style="{ fontFamily: f }">{{ f }}</option>
          </select>
        </label>

        <label class="block text-sm text-np-ink/60">
          Tamaño ({{ tamano }}px)
          <input v-model.number="tamano" type="range" min="40" max="300" step="5" class="w-full accent-np-teal" />
        </label>

        <label class="flex items-center gap-2 text-sm text-np-ink/60">
          Color
          <input v-model="colorTexto" type="color" class="w-9 h-7 border border-black/10 rounded cursor-pointer" />
        </label>

        <div class="border-t border-black/5 pt-3 space-y-2">
          <label class="flex items-center gap-2 text-sm text-np-ink/70 font-medium">
            <input type="checkbox" class="accent-np-teal" v-model="contornoActivo" />
            Contorno
          </label>
          <div v-if="contornoActivo" class="flex items-center gap-4 pl-6">
            <label class="flex items-center gap-2 text-xs text-np-ink/50">
              Color
              <input v-model="colorContorno" type="color" class="w-8 h-6 border border-black/10 rounded cursor-pointer" />
            </label>
            <label class="flex items-center gap-2 text-xs text-np-ink/50 flex-1">
              Grosor
              <input v-model.number="grosorContorno" type="range" min="1" max="25" class="flex-1 accent-np-teal" />
            </label>
          </div>
        </div>

        <div class="border-t border-black/5 pt-3 space-y-2">
          <label class="flex items-center gap-2 text-sm text-np-ink/70 font-medium">
            <input type="checkbox" class="accent-np-teal" v-model="sombraActiva" />
            Sombra
          </label>
          <div v-if="sombraActiva" class="grid grid-cols-2 gap-x-4 gap-y-2 pl-6 text-xs text-np-ink/50">
            <label class="flex items-center gap-2">
              Color
              <input v-model="colorSombra" type="color" class="w-8 h-6 border border-black/10 rounded cursor-pointer" />
            </label>
            <label class="flex items-center gap-2">
              Difuminado
              <input v-model.number="blurSombra" type="range" min="0" max="30" class="flex-1 accent-np-teal" />
            </label>
            <label class="flex items-center gap-2">
              Desplaz. X
              <input v-model.number="offsetXSombra" type="range" min="-30" max="30" class="flex-1 accent-np-teal" />
            </label>
            <label class="flex items-center gap-2">
              Desplaz. Y
              <input v-model.number="offsetYSombra" type="range" min="-30" max="30" class="flex-1 accent-np-teal" />
            </label>
          </div>
        </div>
      </div>

      <div class="flex flex-col items-center justify-center gap-3 bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-xl border border-black/5 p-4 min-h-[220px]">
        <canvas ref="canvasRef" class="max-w-full max-h-64" />
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <button
      class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
      :disabled="agregando || !texto.trim()"
      @click="agregarAlProyecto"
    >
      {{ agregando ? "Agregando..." : "Agregar al proyecto" }}
    </button>
  </div>
</template>
