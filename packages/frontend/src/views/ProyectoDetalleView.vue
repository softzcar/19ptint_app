<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import GeneradorTexto from "../components/GeneradorTexto.vue";

const props = defineProps({ id: { type: [String, Number], required: true } });
const router = useRouter();

const proyecto = ref(null);
const subiendo = ref(false);
const error = ref("");
const previewUrls = ref({});
const previewCargados = new Set();
const alturasCm = ref({});
const anchosCm = ref({});
const proporcionBloqueada = ref({});
const alturasInicializadas = new Set();
let intervalo = null;

const modoCarga = ref("subir"); // 'subir' | 'buscar' | 'texto'
const busqueda = ref("");
const buscando = ref(false);
const busquedaError = ref("");
const resultadosBusqueda = ref([]);
const agregandoFotoId = ref(null);

// Ancho proporcional a partir del alto que carga el usuario: se calcula
// siempre desde la relación de aspecto real de la imagen (ya recortada a su
// bounding box), así nunca se puede deformar la forma original.
function anchoProporcionalCm(img, altoCm) {
  if (!img.ancho_px || !img.alto_px || !altoCm) return null;
  return (altoCm * (img.ancho_px / img.alto_px)).toFixed(1);
}

const ANCHOS_DTF = [
  { valor: 280, etiqueta: "28 cm" },
  { valor: 580, etiqueta: "58 cm" },
];
const lienzoForm = ref({ tipo: "dtf", ancho_mm: 280, margen_mm: 5, formato_exportacion: "png" });

const imagenesListas = computed(
  () => proyecto.value?.imagenes.filter((i) => i.estado_fondo === "listo" && i.ancho_mm && i.alto_mm) ?? []
);
const hayProcesando = computed(() =>
  proyecto.value?.imagenes.some((i) => i.estado_fondo === "pendiente" || i.estado_fondo === "procesando" || i.estado_upscale === "procesando")
);

async function cargar() {
  const { data } = await api.get(`/proyectos/${props.id}`);
  proyecto.value = data;

  // El endpoint de archivo requiere auth (Bearer): se trae como blob
  // autenticado y se cachea como object URL en vez de usar <img src> directo.
  for (const img of data.imagenes) {
    if (img.estado_fondo !== "listo") continue;
    const clave = `${img.id}:${img.estado_fondo}:${img.estado_upscale}`;
    if (previewCargados.has(clave)) continue;
    previewCargados.add(clave);
    const resp = await api.get(`/imagenes/${img.id}/archivo`, {
      params: { variante: "procesada" },
      responseType: "blob",
    });
    previewUrls.value = { ...previewUrls.value, [img.id]: URL.createObjectURL(resp.data) };
  }

  for (const img of data.imagenes) {
    if (alturasInicializadas.has(img.id)) continue;
    alturasInicializadas.add(img.id);
    if (img.alto_mm) alturasCm.value[img.id] = Number(img.alto_mm) / 10;
    if (img.ancho_mm) anchosCm.value[img.id] = Number(img.ancho_mm) / 10;
    proporcionBloqueada.value[img.id] = true;
  }
}

async function subirArchivos(event) {
  const archivos = event.target.files;
  if (!archivos.length) return;
  subiendo.value = true;
  error.value = "";
  try {
    const form = new FormData();
    for (const f of archivos) form.append("imagenes", f);
    await api.post(`/proyectos/${props.id}/imagenes`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "Error al subir";
  } finally {
    subiendo.value = false;
    event.target.value = "";
  }
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
    await api.post(`/proyectos/${props.id}/imagenes/desde-web`, {
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
  await api.patch(`/imagenes/${img.id}`, { copias: Number(img.copias) || 1 });
}

async function pedirUpscale(img) {
  await api.post(`/imagenes/${img.id}/upscale`);
  await cargar();
}

async function eliminarImagen(img) {
  await api.delete(`/imagenes/${img.id}`);
  await cargar();
}

function onTipoChange() {
  if (lienzoForm.value.tipo === "dtf") {
    lienzoForm.value.ancho_mm = 280;
    lienzoForm.value.formato_exportacion = "png";
  } else {
    lienzoForm.value.ancho_mm = 1580;
    lienzoForm.value.formato_exportacion = "pdf";
  }
}

async function generarLienzo() {
  error.value = "";
  try {
    const { data } = await api.post(`/proyectos/${props.id}/lienzos`, lienzoForm.value);
    router.push({ name: "lienzo", params: { id: data.id } });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo generar el lienzo";
  }
}

onMounted(async () => {
  await cargar();
  intervalo = setInterval(() => {
    if (hayProcesando.value) cargar();
  }, 3000);
});
onUnmounted(() => clearInterval(intervalo));
</script>

<template>
  <div v-if="proyecto" class="max-w-5xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">{{ proyecto.nombre }}</h1>
    </div>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Imágenes</h2>

      <div class="flex gap-4 border-b border-black/5 text-sm font-medium">
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="modoCarga === 'subir' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="modoCarga = 'subir'"
        >
          Subir archivo
        </button>
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="modoCarga === 'buscar' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="modoCarga = 'buscar'"
        >
          Buscar en internet
        </button>
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="modoCarga === 'texto' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="modoCarga = 'texto'"
        >
          Crear texto
        </button>
      </div>

      <label
        v-if="modoCarga === 'subir'"
        class="flex items-center justify-center gap-2 border-2 border-dashed border-np-teal/25 hover:border-np-teal/50 rounded-lg py-4 cursor-pointer transition-colors text-sm text-np-ink/60"
      >
        <span>{{ subiendo ? "Subiendo..." : "Elegir imágenes o arrastrarlas acá" }}</span>
        <input type="file" multiple accept="image/*" class="hidden" @change="subirArchivos" :disabled="subiendo" />
      </label>

      <GeneradorTexto v-else-if="modoCarga === 'texto'" :proyecto-id="props.id" @agregada="cargar" />

      <div v-else class="space-y-3">
        <div class="flex gap-2">
          <input
            v-model="busqueda"
            placeholder="Ej: flores tropicales, geométrico, montañas..."
            class="flex-1 border border-black/10 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
            @keyup.enter="buscarImagenesWeb"
          />
          <button
            class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-4 rounded-lg transition-colors disabled:opacity-50"
            :disabled="buscando"
            @click="buscarImagenesWeb"
          >
            {{ buscando ? "Buscando..." : "Buscar" }}
          </button>
        </div>
        <p class="text-[11px] text-np-ink/40">Fotos de stock (Pexels) de uso comercial libre.</p>
        <p v-if="busquedaError" class="text-sm text-red-600">{{ busquedaError }}</p>

        <div v-if="resultadosBusqueda.length" class="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-96 overflow-auto pr-1">
          <div v-for="foto in resultadosBusqueda" :key="foto.id" class="space-y-1">
            <div class="relative group rounded-lg overflow-hidden">
              <img :src="foto.miniatura" class="w-full h-24 object-cover" />
              <button
                class="absolute inset-0 bg-np-ink/70 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center px-1"
                :disabled="agregandoFotoId === foto.id"
                @click="usarImagenWeb(foto)"
              >
                {{ agregandoFotoId === foto.id ? "Agregando..." : "Usar esta imagen" }}
              </button>
            </div>
            <p class="text-[10px] text-np-ink/40 truncate">{{ foto.autor }}</p>
          </div>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="img in proyecto.imagenes" :key="img.id" class="border border-black/5 rounded-xl p-3 space-y-2.5">
          <img
            v-if="img.estado_fondo === 'listo' && previewUrls[img.id]"
            :src="previewUrls[img.id]"
            class="w-full h-32 object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg"
          />
          <div v-else class="w-full h-32 flex items-center justify-center bg-np-paper rounded-lg text-sm text-np-ink/40">
            {{ img.estado_fondo === "error" ? "Error quitando fondo" : "Quitando fondo…" }}
          </div>
          <p class="text-xs font-medium truncate text-np-ink/70" :title="img.nombre_original">{{ img.nombre_original }}</p>

          <label class="flex items-center gap-1.5 text-xs text-np-ink/60">
            <input type="checkbox" class="accent-np-teal" :checked="proporcionBloqueada[img.id]" @change="toggleProporcion(img)" />
            Mantener proporción
          </label>

          <div class="grid grid-cols-3 gap-1.5 text-xs items-end">
            <label class="text-np-ink/50">
              Alto (cm)
              <input
                v-model="alturasCm[img.id]"
                type="number"
                min="0.1"
                step="0.1"
                :disabled="img.estado_fondo !== 'listo'"
                class="w-full border border-black/10 rounded-md px-1.5 py-1 disabled:bg-np-paper focus:outline-none focus:ring-2 focus:ring-np-teal/40"
                @change="actualizarAltura(img)"
              />
            </label>
            <label class="text-np-ink/50">
              Ancho (cm)
              <input
                v-if="!proporcionBloqueada[img.id]"
                v-model="anchosCm[img.id]"
                type="number"
                min="0.1"
                step="0.1"
                :disabled="img.estado_fondo !== 'listo'"
                class="w-full border border-black/10 rounded-md px-1.5 py-1 disabled:bg-np-paper focus:outline-none focus:ring-2 focus:ring-np-teal/40"
                @change="actualizarAncho(img)"
              />
              <span v-else class="block px-1.5 py-1 text-np-ink/40">
                {{ anchoProporcionalCm(img, alturasCm[img.id]) ?? "—" }}
              </span>
            </label>
            <label class="text-np-ink/50">
              Copias
              <input
                v-model="img.copias"
                type="number"
                min="1"
                class="w-full border border-black/10 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
                @change="actualizarCopias(img)"
              />
            </label>
          </div>
          <p class="text-[11px] text-np-ink/40">
            {{
              proporcionBloqueada[img.id]
                ? "Ancho calculado automáticamente, no se puede deformar."
                : "Proporción desactivada: el ancho es manual y puede deformar la imagen."
            }}
          </p>

          <div class="flex items-center justify-between text-xs pt-1 border-t border-black/5">
            <button
              v-if="img.estado_fondo === 'listo' && img.estado_upscale !== 'procesando'"
              class="text-np-teal font-medium hover:text-np-teal-dark transition-colors"
              @click="pedirUpscale(img)"
            >
              {{ img.estado_upscale === "listo" ? "Upscale ✓ (repetir)" : "Aumentar resolución" }}
            </button>
            <span v-else-if="img.estado_upscale === 'procesando'" class="text-np-ink/40">Upscale en proceso…</span>
            <button class="text-red-600/70 hover:text-red-600 transition-colors" @click="eliminarImagen(img)">Eliminar</button>
          </div>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Generar lienzo</h2>
      <div class="grid sm:grid-cols-4 gap-3 items-end">
        <label class="text-sm text-np-ink/60">
          Tipo
          <select
            v-model="lienzoForm.tipo"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
            @change="onTipoChange"
          >
            <option value="dtf">DTF</option>
            <option value="sublimacion">Sublimación</option>
          </select>
        </label>
        <label v-if="lienzoForm.tipo === 'dtf'" class="text-sm text-np-ink/60">
          Ancho
          <select v-model.number="lienzoForm.ancho_mm" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40">
            <option v-for="a in ANCHOS_DTF" :key="a.valor" :value="a.valor">{{ a.etiqueta }}</option>
          </select>
        </label>
        <label v-else class="text-sm text-np-ink/60">
          Ancho
          <input :value="'158 cm'" disabled class="w-full border border-black/10 rounded-md px-2 py-1.5 bg-np-paper" />
        </label>
        <label class="text-sm text-np-ink/60">
          Margen (mm)
          <input
            v-model.number="lienzoForm.margen_mm"
            type="number"
            min="0"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          />
        </label>
        <label class="text-sm text-np-ink/60">
          Formato de export
          <select
            v-model="lienzoForm.formato_exportacion"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          >
            <option v-if="lienzoForm.tipo === 'dtf'" value="png">PNG</option>
            <template v-else>
              <option value="pdf">PDF</option>
              <option value="jpeg">JPEG</option>
            </template>
          </select>
        </label>
      </div>
      <div class="flex items-center gap-4">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-np-teal"
          :disabled="!imagenesListas.length"
          @click="generarLienzo"
        >
          Auto-acomodar
        </button>
        <p class="text-xs text-np-ink/40">{{ imagenesListas.length }} imagen(es) lista(s) para acomodar.</p>
      </div>
    </section>

    <section v-if="proyecto.lienzos.length" class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Lienzos generados</h2>
      <ul class="space-y-1 text-sm">
        <li v-for="l in proyecto.lienzos" :key="l.id">
          <router-link :to="{ name: 'lienzo', params: { id: l.id } }" class="text-np-ink hover:text-np-teal transition-colors">
            <span class="font-bold">#{{ l.id }}</span> — {{ l.tipo }} — {{ l.ancho_mm }}mm × {{ Math.round(l.alto_usado_mm) }}mm — {{ l.items.length }} piezas
          </router-link>
        </li>
      </ul>
    </section>
  </div>
</template>
