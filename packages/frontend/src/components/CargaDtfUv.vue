<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";

// Estado local propio, sin pasar por el store de useImagenes -- un diseño
// DTF UV no es una Imagen (mismo criterio que CargaLienzoListo.vue).
const props = defineProps({
  proyectoId: { type: [String, Number], required: true },
  dtfUvIdInicial: { type: [String, Number], default: null },
});

const router = useRouter();

const diseno = ref(null);
const disenos = ref([]); // lista de diseños ya subidos en este proyecto -- para poder elegir uno, o borrarlo, sin perder los demás
const subiendo = ref(false);
const aplicandoBordado = ref(false);
const generandoContorno = ref(false);
const eliminando = ref(false);
const error = ref("");

const previewMascaraBlanco = ref(null);

const seccion = ref("bordado"); // 'bordado' | 'relieve' -- dos flujos separados sobre el mismo diseño, combinables

const previewOriginal = ref(null);
const previewPreBordado = ref(null);

let intervalo = null;

function detenerPoll() {
  clearInterval(intervalo);
  intervalo = null;
}

async function refrescar() {
  const anterior = diseno.value;
  const { data } = await api.get(`/dtf-uv/${diseno.value.id}`);
  diseno.value = data;
  // El efecto bordado reemplaza ruta_original en el servidor -- una vez
  // listo, la preview local (que hasta ahora era el archivo tal cual se
  // subió) queda vieja y hay que traer la nueva versión.
  if (anterior?.estado_bordado !== "listo" && data.estado_bordado === "listo") {
    // Se guarda solo la PRIMERA vez: si ya había un "antes" (de una
    // aplicación previa), no se pisa -- si no, aplicar el efecto una
    // segunda vez perdía la comparación contra el original real y solo
    // mostraba "antes" = la versión anterior, no la subida.
    if (!previewPreBordado.value) previewPreBordado.value = previewOriginal.value;
    previewOriginal.value = await cargarBlob("original");
  }
  if (anterior?.estado_contorno_bordado !== "listo" && data.estado_contorno_bordado === "listo") {
    previewMascaraBlanco.value = await cargarBlob("mascara_blanco");
  }
  const hayAlgoEnCurso =
    ["pendiente", "procesando"].includes(data.estado_vectorizado) ||
    ["pendiente", "procesando"].includes(data.estado_bordado) ||
    ["pendiente", "procesando"].includes(data.estado_contorno_bordado);
  if (!hayAlgoEnCurso) detenerPoll();
}

function iniciarPoll() {
  detenerPoll();
  intervalo = setInterval(refrescar, 2000);
}

async function cargarBlob(variante) {
  const resp = await api.get(`/dtf-uv/${diseno.value.id}/archivo`, { params: { variante }, responseType: "blob" });
  return URL.createObjectURL(resp.data);
}

async function cargarLista() {
  const { data } = await api.get(`/proyectos/${props.proyectoId}/dtf-uv`);
  disenos.value = data;
}

async function subir(file) {
  if (!file) return;
  subiendo.value = true;
  error.value = "";
  try {
    const form = new FormData();
    form.append("archivo", file);
    const { data } = await api.post(`/proyectos/${props.proyectoId}/dtf-uv`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    diseno.value = data;
    previewOriginal.value = URL.createObjectURL(file);
    iniciarPoll();
    cargarLista();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo subir el archivo";
  } finally {
    subiendo.value = false;
  }
}

async function cargarDiseno(id, seccionInicial = "bordado") {
  detenerPoll();
  const { data } = await api.get(`/dtf-uv/${id}`);
  diseno.value = data;
  seccion.value = seccionInicial;
  previewOriginal.value = await cargarBlob("original");
  previewPreBordado.value = null;
  previewMascaraBlanco.value = data.ruta_mascara_blanco ? await cargarBlob("mascara_blanco") : null;
  const enCurso =
    ["pendiente", "procesando"].includes(data.estado_vectorizado) ||
    ["pendiente", "procesando"].includes(data.estado_bordado) ||
    ["pendiente", "procesando"].includes(data.estado_contorno_bordado);
  if (enCurso) iniciarPoll();
}

async function eliminarDiseno(id) {
  eliminando.value = true;
  error.value = "";
  try {
    await api.delete(`/dtf-uv/${id}`);
    if (diseno.value?.id === id) empezarDeNuevo();
    await cargarLista();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo eliminar el diseño";
  } finally {
    eliminando.value = false;
  }
}

function elegirArchivo(event) {
  subir(event.target.files?.[0]);
  event.target.value = "";
}

const arrastrando = ref(false);
function onDrop(event) {
  arrastrando.value = false;
  subir(event.dataTransfer?.files?.[0]);
}

async function aplicarBordado() {
  aplicandoBordado.value = true;
  error.value = "";
  try {
    await api.post(`/dtf-uv/${diseno.value.id}/efecto-bordado`, {
      paso_px: diseno.value.bordado_paso_px,
      largo_px: diseno.value.bordado_largo_px,
    });
    await refrescar();
    iniciarPoll();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo aplicar el efecto bordado";
  } finally {
    aplicandoBordado.value = false;
  }
}

async function revertirBordado() {
  error.value = "";
  try {
    await api.post(`/dtf-uv/${diseno.value.id}/revertir-bordado`);
    diseno.value = { ...diseno.value, estado_bordado: "omitido", ruta_pre_bordado: null };
    previewOriginal.value = await cargarBlob("original");
    previewPreBordado.value = null;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo deshacer el efecto bordado";
  }
}

// Un nivel de deshacer para la capa blanco/barniz, sin importar si la
// generó el contorno de bordado, el patrón IA, o quedó guardada del editor.
// Solo se usa para 'blanco' acá (la capa de contorno de bordado escribe
// siempre ahí) -- 'barniz' se maneja en el editor de relieve, junto al
// generador de patrones con IA.
async function revertirMascara(capa) {
  error.value = "";
  try {
    const { data } = await api.post(`/dtf-uv/${diseno.value.id}/revertir-mascara-${capa}`);
    diseno.value = data;
    previewMascaraBlanco.value = await cargarBlob("mascara_blanco");
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo deshacer";
  }
}

async function generarContorno() {
  generandoContorno.value = true;
  error.value = "";
  try {
    await api.post(`/dtf-uv/${diseno.value.id}/bordar-contorno`, {
      grosor_contorno_px: diseno.value.contorno_grosor_px,
    });
    await refrescar();
    iniciarPoll();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo generar la capa de contorno";
  } finally {
    generandoContorno.value = false;
  }
}

function irAlEditor() {
  router.push({ name: "dtf-uv-editor", params: { id: diseno.value.id } });
}

function empezarDeNuevo() {
  detenerPoll();
  diseno.value = null;
  previewOriginal.value = null;
  previewPreBordado.value = null;
  previewMascaraBlanco.value = null;
  error.value = "";
}

onMounted(async () => {
  await cargarLista();
  if (props.dtfUvIdInicial) await cargarDiseno(props.dtfUvIdInicial, "relieve");
});

onUnmounted(detenerPoll);
</script>

<template>
  <div class="mt-4 space-y-4">
    <p class="text-xs text-np-ink/40">
      Subí un logo o imagen. Dos secciones separadas y combinables: "Bordado" (filtro visual de puntadas) y "Relieve"
      (capas spot blanco/barniz para tu impresora DTF UV -- Spot1/Spot2 blanco, Spot3/Spot4 barniz).
    </p>

    <template v-if="!diseno">
      <ul v-if="disenos.length" class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <li
          v-for="d in disenos"
          :key="d.id"
          class="border border-black/10 rounded-lg p-2 flex items-center justify-between gap-2 text-xs"
        >
          <button type="button" class="text-left text-np-ink/70 hover:text-np-teal transition-colors truncate flex-1" @click="cargarDiseno(d.id)">
            {{ d.nombre_original || `Diseño #${d.id}` }}
          </button>
          <button
            type="button"
            class="text-red-600/70 hover:text-red-600 transition-colors flex-shrink-0"
            :disabled="eliminando"
            title="Eliminar diseño"
            @click="eliminarDiseno(d.id)"
          >
            ×
          </button>
        </li>
      </ul>

      <label
        class="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-4 cursor-pointer transition-colors text-sm text-np-ink/60"
        :class="arrastrando ? 'border-np-teal bg-np-teal-light/40' : 'border-np-teal/25 hover:border-np-teal/50'"
        @dragover.prevent="arrastrando = true"
        @dragleave.prevent="arrastrando = false"
        @drop.prevent="onDrop"
      >
        <span>{{ subiendo ? "Subiendo…" : disenos.length ? "Agregar otro logo o imagen, o arrastralo acá" : "Elegí un logo o imagen, o arrastralo acá" }}</span>
        <input type="file" accept="image/*" class="hidden" :disabled="subiendo" @change="elegirArchivo" />
      </label>
    </template>

    <div v-else class="space-y-4">
      <p class="text-sm font-medium text-np-ink/70">{{ diseno.nombre_original }}</p>

      <div class="flex gap-4 border-b border-black/5 text-sm font-medium">
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="seccion === 'bordado' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="seccion = 'bordado'"
        >
          Bordado
        </button>
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="seccion === 'relieve' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="seccion = 'relieve'"
        >
          Relieve (capas spot)
        </button>
      </div>

      <!-- ===== Bordado ===== -->
      <div v-if="seccion === 'bordado'" class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4" :class="!previewPreBordado ? 'sm:grid-cols-1' : ''">
          <div v-if="previewPreBordado" class="space-y-1">
            <p class="text-xs text-np-ink/40">Antes</p>
            <img
              :src="previewPreBordado"
              class="w-full max-w-lg mx-auto object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg"
            />
          </div>
          <div class="space-y-1">
            <p v-if="previewPreBordado" class="text-xs text-np-ink/40">Después</p>
            <img
              v-if="previewOriginal"
              :src="previewOriginal"
              class="w-full max-w-lg mx-auto object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg"
            />
          </div>
        </div>

        <div class="max-w-sm space-y-3">
          <label class="block text-sm text-np-ink/60">
            Separación entre puntadas ({{ diseno.bordado_paso_px }}px, más chico = más tupido)
            <input v-model.number="diseno.bordado_paso_px" type="range" min="2" max="20" class="w-full accent-np-teal" />
          </label>
          <label class="block text-sm text-np-ink/60">
            Largo de puntada ({{ diseno.bordado_largo_px }}px)
            <input v-model.number="diseno.bordado_largo_px" type="range" min="2" max="20" class="w-full accent-np-teal" />
          </label>
          <div class="flex items-center gap-3">
            <button
              class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
              :disabled="aplicandoBordado || ['pendiente', 'procesando'].includes(diseno.estado_bordado)"
              @click="aplicarBordado"
            >
              {{
                ["pendiente", "procesando"].includes(diseno.estado_bordado) || aplicandoBordado
                  ? "Aplicando…"
                  : diseno.estado_bordado === "listo"
                  ? "Volver a aplicar"
                  : "Aplicar efecto bordado"
              }}
            </button>
            <button v-if="diseno.ruta_pre_bordado" class="text-np-ink/50 hover:text-np-ink underline transition-colors text-sm" @click="revertirBordado">
              Deshacer
            </button>
          </div>
        </div>

        <div class="border-t border-black/5 pt-4 space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Capa de contorno para blanco (Spot1/Spot2)</h3>
          <p class="text-xs text-np-ink/40 max-w-md">
            Segunda capa, distinta a la de arriba: el relieve de puntada SOLO en el contorno del dibujo (letras, logo,
            imágenes), sin rellenar el interior ni el fondo -- pensada como punto de partida para la capa blanco, que
            después seguís editando en "Relieve".
          </p>
          <div class="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div class="max-w-sm space-y-3">
              <label class="block text-sm text-np-ink/60">
                Grosor del contorno ({{ diseno.contorno_grosor_px }}px)
                <input v-model.number="diseno.contorno_grosor_px" type="range" min="2" max="60" class="w-full accent-np-teal" />
              </label>
              <div class="flex items-center gap-3">
                <button
                  class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                  :disabled="generandoContorno || ['pendiente', 'procesando'].includes(diseno.estado_contorno_bordado)"
                  @click="generarContorno"
                >
                  {{
                    ["pendiente", "procesando"].includes(diseno.estado_contorno_bordado) || generandoContorno
                      ? "Generando…"
                      : diseno.estado_contorno_bordado === "listo"
                      ? "Volver a generar"
                      : "Generar capa de contorno"
                  }}
                </button>
                <button v-if="diseno.ruta_pre_mascara_blanco" class="text-np-ink/50 hover:text-np-ink underline transition-colors text-sm" @click="revertirMascara('blanco')">
                  Deshacer
                </button>
              </div>
            </div>
            <!-- Superpuesto sobre el diseño original semi-transparente, no
                 aislado -- para entender DÓNDE cae el relieve respecto al
                 dibujo real, no solo qué forma tiene. -->
            <div v-if="previewMascaraBlanco" class="space-y-1">
              <p class="text-xs text-np-ink/40">Resultado sobre el diseño (capa blanco)</p>
              <div class="relative bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg overflow-hidden">
                <img v-if="previewOriginal" :src="previewOriginal" class="w-full max-w-xs object-contain opacity-35" />
                <img :src="previewMascaraBlanco" class="absolute inset-0 w-full max-w-xs h-full object-contain mix-blend-screen" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Relieve ===== -->
      <div v-else class="space-y-4">
        <div class="flex flex-col sm:flex-row items-start gap-6">
          <img
            v-if="previewOriginal"
            :src="previewOriginal"
            class="w-full sm:w-96 max-w-md object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg flex-shrink-0"
          />
          <div class="text-sm space-y-2">
            <p class="text-np-ink/40">
              <span v-if="diseno.estado_vectorizado === 'pendiente' || diseno.estado_vectorizado === 'procesando'">Vectorizando…</span>
              <span v-else-if="diseno.estado_vectorizado === 'error'" class="text-red-600">{{ diseno.mensaje_error_vector ?? "Error al vectorizar" }}</span>
              <span v-else-if="diseno.estado_vectorizado === 'listo'" class="text-green-700">Vectorizado ✓</span>
            </p>
            <p class="text-xs text-np-ink/40 max-w-sm">
              En el editor elegís qué partes del dibujo (o formas que agregues) llevan blanco y barniz, con vista 3D en
              vivo del relieve/brillo.
            </p>
            <button
              class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-40"
              :disabled="diseno.estado_vectorizado !== 'listo'"
              @click="irAlEditor"
            >
              {{ diseno.estado_vectorizado === "listo" ? "Abrir editor de relieve" : "Esperando vectorizado…" }}
            </button>
          </div>
        </div>

      </div>

      <div class="flex items-center gap-4">
        <button class="text-xs text-np-ink/40 hover:text-np-ink underline" @click="empezarDeNuevo">Subir otro diseño</button>
        <button class="text-xs text-red-600/70 hover:text-red-600 underline" :disabled="eliminando" @click="eliminarDiseno(diseno.id)">
          {{ eliminando ? "Eliminando…" : "Eliminar este diseño" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
  </div>
</template>
