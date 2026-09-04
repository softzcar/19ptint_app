<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { api } from "../lib/api.js";
import EditorMascara from "../components/EditorMascara.vue";

const props = defineProps({ id: { type: [String, Number], required: true } });

const diseno = ref(null);
const error = ref("");
const guardando = ref(false);
const exportando = ref(false);

const previewOriginal = ref(null);
const previewMascaraBlanco = ref(null);
const previewMascaraBarniz = ref(null);
const previewPatronIa = ref(null);
const svgUrl = ref(null);
const ancho = ref(0);
const alto = ref(0);

const capaActiva = ref("blanco"); // 'blanco' | 'barniz'
const editorBlanco = ref(null);
const editorBarniz = ref(null);

// Tamaño de impresión (ancho_mm/alto_mm) -- gobierna tanto el export suelto
// como "armar hoja". proporcionBase se fija una sola vez (del tamaño ya
// guardado, o si no de las dimensiones naturales en px de la imagen subida)
// y no se recalcula en cada edición -- si se derivara en vivo de
// anchoMmInput/altoMmInput mientras el usuario edita uno de los dos, el
// otro campo terminaría persiguiendo un valor que ya cambió.
const anchoMmInput = ref(null);
const altoMmInput = ref(null);
const mantenerProporcion = ref(true);
const proporcionBase = ref(null);
const guardandoTamano = ref(false);
let tamanoInicializado = false;

// Comparar antes de escribir (en vez de una bandera de reentrancia) es lo
// que realmente corta la ida y vuelta: watch() de Vue no corre sincrónico
// (flush "pre", en microtask), así que una bandera puesta y sacada en la
// misma función síncrona ya no está activa cuando el segundo watch se
// dispara -- comparar el valor calculado contra el actual sí funciona
// pase lo que pase con el timing, porque si ya coincide no hay escritura
// (y sin escritura no hay nuevo disparo).
watch(anchoMmInput, (nuevo) => {
  if (!mantenerProporcion.value || !proporcionBase.value || !nuevo) return;
  const calculado = Math.round((nuevo / proporcionBase.value) * 100) / 100;
  if (altoMmInput.value !== calculado) altoMmInput.value = calculado;
});
watch(altoMmInput, (nuevo) => {
  if (!mantenerProporcion.value || !proporcionBase.value || !nuevo) return;
  const calculado = Math.round((nuevo * proporcionBase.value) * 100) / 100;
  if (anchoMmInput.value !== calculado) anchoMmInput.value = calculado;
});

async function guardarTamano() {
  guardandoTamano.value = true;
  error.value = "";
  try {
    const { data } = await api.patch(`/dtf-uv/${props.id}`, { ancho_mm: anchoMmInput.value, alto_mm: altoMmInput.value });
    diseno.value = data;
    // El usuario lo fijó a propósito -- pasa a ser la nueva base para
    // "mantener proporción" en vez de la que traía antes.
    proporcionBase.value = anchoMmInput.value / altoMmInput.value;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo guardar el tamaño";
  } finally {
    guardandoTamano.value = false;
  }
}

const promptPatronIA = ref("");
const generandoPatron = ref(false);

// Mismos anchos de rollo que Lienzo usa para tipo:dtf (ver
// packages/backend/src/routes/lienzos.js, ANCHOS_VALIDOS.dtf) -- se
// duplica en vez de importar porque son features separadas que solo
// comparten el rollo físico, no código (ver plan de "armar hoja" DTF UV).
const ANCHOS_HOJA = [280, 580];
const copiasInput = ref(1);
const anchoHojaInput = ref(ANCHOS_HOJA[0]);
const margenHojaInput = ref(5);
const marcaRegistroInput = ref(10);
const rotarCopiasInput = ref(false);
const armandoHoja = ref(false);
const exportandoHoja = ref(false);
const grillaPreview = ref(null); // { columnas, filas } -- respuesta de "armar-hoja"
let hojaInicializada = false;

let intervalo = null;

async function cargarBlob(variante) {
  const resp = await api.get(`/dtf-uv/${props.id}/archivo`, { params: { variante }, responseType: "blob" });
  return URL.createObjectURL(resp.data);
}

function medirImagen(url) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
    img.src = url;
  });
}

async function cargar() {
  const { data } = await api.get(`/dtf-uv/${props.id}`);
  diseno.value = data;

  if (!previewOriginal.value && data.ruta_original) {
    previewOriginal.value = await cargarBlob("original");
    const medida = await medirImagen(previewOriginal.value);
    ancho.value = medida.ancho;
    alto.value = medida.alto;
  }
  if (!svgUrl.value && data.ruta_vector) {
    svgUrl.value = await cargarBlob("vector");
  }
  // ruta_mascara_blanco/barniz pueden venir del contorno de bordado, de
  // Gemini, o de un guardado manual del editor -- estado_capas (la
  // propuesta automática vieja) ya no es el único que las puebla.
  if (data.ruta_mascara_blanco) previewMascaraBlanco.value = await cargarBlob("mascara_blanco");
  if (data.ruta_mascara_barniz) previewMascaraBarniz.value = await cargarBlob("mascara_barniz");
  // La textura IA es única por diseño (no por capa): cada generación pisa
  // la anterior, se refresca acá para que ambos editores (blanco/barniz)
  // vean siempre la última.
  if (data.ruta_patron_ia) previewPatronIa.value = await cargarBlob("patron_ia");

  // Solo la primera carga: si ya había un tamaño guardado arranca de ahí;
  // si no, la proporción base sale de las dimensiones naturales (px) de la
  // imagen subida, ya conocidas acá arriba (ancho.value/alto.value).
  if (!tamanoInicializado) {
    tamanoInicializado = true;
    if (data.ancho_mm && data.alto_mm) {
      anchoMmInput.value = Number(data.ancho_mm);
      altoMmInput.value = Number(data.alto_mm);
      proporcionBase.value = anchoMmInput.value / altoMmInput.value;
    } else if (ancho.value && alto.value) {
      proporcionBase.value = ancho.value / alto.value;
    }
  }

  // Solo la primera carga: si el usuario ya había armado una hoja antes,
  // los inputs arrancan con esos valores en vez de los defaults.
  if (!hojaInicializada) {
    hojaInicializada = true;
    if (data.copias) copiasInput.value = data.copias;
    if (data.ancho_hoja_mm) anchoHojaInput.value = Number(data.ancho_hoja_mm);
    if (data.margen_hoja_mm) margenHojaInput.value = Number(data.margen_hoja_mm);
    if (data.marca_registro_mm) marcaRegistroInput.value = Number(data.marca_registro_mm);
    rotarCopiasInput.value = Boolean(data.rotar_copias);
  }

  const enCurso =
    ["pendiente", "procesando"].includes(data.estado_export) ||
    ["pendiente", "procesando"].includes(data.estado_patron_ia) ||
    ["pendiente", "procesando"].includes(data.estado_hoja);
  if (!enCurso) {
    clearInterval(intervalo);
    intervalo = null;
  }
}

async function generarPatronIA() {
  if (!promptPatronIA.value.trim()) return;
  generandoPatron.value = true;
  error.value = "";
  try {
    await api.post(`/dtf-uv/${props.id}/generar-patron-ia`, { prompt: promptPatronIA.value.trim() });
    await cargar();
    intervalo = intervalo ?? setInterval(cargar, 2000);
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo generar la textura";
  } finally {
    generandoPatron.value = false;
  }
}

async function revertirMascaraActiva() {
  error.value = "";
  try {
    await api.post(`/dtf-uv/${props.id}/revertir-mascara-${capaActiva.value}`);
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo deshacer";
  }
}

const hayTexturaGenerando = computed(() => ["pendiente", "procesando"].includes(diseno.value?.estado_patron_ia));

onMounted(async () => {
  await cargar();
});
onUnmounted(() => clearInterval(intervalo));

async function guardarCapaActiva() {
  const editor = capaActiva.value === "blanco" ? editorBlanco.value : editorBarniz.value;
  if (!editor) return;
  guardando.value = true;
  error.value = "";
  try {
    const blob = await editor.exportarBlob();
    const form = new FormData();
    form.append(capaActiva.value === "blanco" ? "mascara_blanco" : "mascara_barniz", blob, "mascara.png");
    const { data } = await api.patch(`/dtf-uv/${props.id}/mascaras`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    diseno.value = data;
    // La preview de la capa que se acaba de guardar queda vieja (URL del
    // archivo anterior) -- se refresca para que un cambio de capa y vuelta
    // muestre lo recién guardado, no lo que había al entrar al editor.
    if (capaActiva.value === "blanco") previewMascaraBlanco.value = await cargarBlob("mascara_blanco");
    else previewMascaraBarniz.value = await cargarBlob("mascara_barniz");
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo guardar la máscara";
  } finally {
    guardando.value = false;
  }
}

const listoParaExportar = computed(() => diseno.value?.ruta_mascara_blanco && diseno.value?.ruta_mascara_barniz);
const hayPreParaDeshacer = computed(() =>
  capaActiva.value === "barniz" ? diseno.value?.ruta_pre_mascara_barniz : diseno.value?.ruta_pre_mascara_blanco
);

async function exportar() {
  exportando.value = true;
  error.value = "";
  try {
    await api.post(`/dtf-uv/${props.id}/exportar`);
    clearInterval(intervalo);
    intervalo = setInterval(cargar, 2000);
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo exportar";
  } finally {
    exportando.value = false;
  }
}

// /descargar requiere auth (Bearer): no se puede linkear directo, hay que
// traerlo como blob autenticado y disparar la descarga a mano -- mismo
// patrón que exportar() en LienzoView.vue.
async function descargar(formato) {
  const resp = await api.get(`/dtf-uv/${props.id}/descargar`, { params: { formato }, responseType: "blob" });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dtf-uv-${props.id}.${formato}`;
  a.click();
  URL.revokeObjectURL(url);
}

async function armarHoja() {
  armandoHoja.value = true;
  error.value = "";
  try {
    const { data } = await api.post(`/dtf-uv/${props.id}/armar-hoja`, {
      copias: copiasInput.value,
      ancho_hoja_mm: anchoHojaInput.value,
      margen_hoja_mm: margenHojaInput.value,
      marca_registro_mm: marcaRegistroInput.value,
      rotar_copias: rotarCopiasInput.value,
    });
    diseno.value = data;
    grillaPreview.value = { columnas: data.columnas, filas: data.filas };
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo armar la hoja";
  } finally {
    armandoHoja.value = false;
  }
}

async function exportarHoja() {
  exportandoHoja.value = true;
  error.value = "";
  try {
    await api.post(`/dtf-uv/${props.id}/exportar-hoja`);
    intervalo = intervalo ?? setInterval(cargar, 2000);
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo exportar la hoja";
  } finally {
    exportandoHoja.value = false;
  }
}

async function descargarHoja() {
  const resp = await api.get(`/dtf-uv/${props.id}/descargar-hoja`, { responseType: "blob" });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dtf-uv-${props.id}-hoja.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div v-if="diseno" class="max-w-6xl mx-auto p-6 sm:p-10 space-y-6">
    <div>
      <router-link
        :to="{ name: 'proyecto', params: { id: diseno.proyecto_id }, query: { tab: 'dtfUv', dtfUvId: diseno.id } }"
        class="text-sm text-np-ink/40 hover:text-np-teal transition-colors"
      >
        &larr; Volver a DTF UV
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">{{ diseno.nombre_original }} — capas spot</h1>
    </div>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Tamaño de impresión</h2>
      <p class="text-xs text-np-ink/40">Define el tamaño real del diseño -- lo usan tanto el export suelto como "armar hoja" (más abajo).</p>
      <div class="flex flex-wrap items-end gap-3 text-sm">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Ancho (mm)</span>
          <input v-model.number="anchoMmInput" type="number" min="1" step="0.1" class="border border-black/10 rounded-lg px-2 py-1.5 w-28" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Alto (mm)</span>
          <input v-model.number="altoMmInput" type="number" min="1" step="0.1" class="border border-black/10 rounded-lg px-2 py-1.5 w-28" />
        </label>
        <label class="flex items-center gap-1.5 pb-1.5">
          <input v-model="mantenerProporcion" type="checkbox" class="accent-np-teal" />
          Mantener proporción
        </label>
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          :disabled="guardandoTamano || !anchoMmInput || !altoMmInput"
          @click="guardarTamano"
        >
          {{ guardandoTamano ? "Guardando…" : "Guardar tamaño" }}
        </button>
      </div>
    </section>

    <section v-if="diseno.estado_vectorizado !== 'listo' || !svgUrl" class="bg-white rounded-xl border border-black/5 shadow-sm p-6 text-sm text-np-ink/60">
      Todavía se está vectorizando este diseño. Volvé a la pestaña "DTF UV" del proyecto en un momento.
    </section>

    <section v-else class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <div class="flex gap-4 border-b border-black/5 text-sm font-medium">
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="capaActiva === 'blanco' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="capaActiva = 'blanco'"
        >
          Blanco (Spot1/Spot2)
        </button>
        <button
          class="pb-2 -mb-px border-b-2 transition-colors"
          :class="capaActiva === 'barniz' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
          @click="capaActiva = 'barniz'"
        >
          Barniz (Spot3/Spot4)
        </button>
      </div>

      <div class="bg-np-paper rounded-lg p-4 space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Generar textura con IA (Gemini)</h3>
        <div class="flex flex-col sm:flex-row gap-3">
          <textarea
            v-model="promptPatronIA"
            rows="2"
            placeholder="Ej: relieve tipo bordado satinado con hojas y enredaderas, estilo art nouveau"
            class="flex-1 border border-black/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition resize-none"
          />
          <button
            class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            :disabled="generandoPatron || !promptPatronIA.trim() || hayTexturaGenerando"
            @click="generarPatronIA"
          >
            {{ hayTexturaGenerando || generandoPatron ? "Generando…" : "Generar textura" }}
          </button>
        </div>
        <p v-if="diseno.estado_patron_ia === 'error'" class="text-xs text-red-600">{{ diseno.mensaje_error_patron_ia }}</p>
        <p class="text-[11px] text-np-ink/40">
          Genera una textura con fondo transparente (una sola, se reusa en las 2 capas) -- después, en el lienzo de
          abajo, activá "Rellenar con textura" y "Guardar capa" para aplicarla sobre las regiones que ya activaste.
        </p>
      </div>

      <EditorMascara
        v-show="capaActiva === 'blanco'"
        ref="editorBlanco"
        tipo="blanco"
        :imagen-fondo-url="previewOriginal"
        :mascara-guia-url="previewMascaraBlanco"
        :svg-url="svgUrl"
        :textura-url="previewPatronIa"
        :ancho="ancho"
        :alto="alto"
      />
      <EditorMascara
        v-show="capaActiva === 'barniz'"
        ref="editorBarniz"
        tipo="barniz"
        :imagen-fondo-url="previewOriginal"
        :mascara-guia-url="previewMascaraBarniz"
        :svg-url="svgUrl"
        :textura-url="previewPatronIa"
        :ancho="ancho"
        :alto="alto"
      />

      <div class="flex items-center gap-3 pt-2 border-t border-black/5">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          :disabled="guardando"
          @click="guardarCapaActiva"
        >
          {{ guardando ? "Guardando…" : `Guardar capa ${capaActiva}` }}
        </button>
        <button v-if="hayPreParaDeshacer" class="text-np-ink/50 hover:text-np-ink underline transition-colors text-sm" @click="revertirMascaraActiva">
          Deshacer capa {{ capaActiva }}
        </button>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Exportar</h2>
      <p class="text-xs text-np-ink/40">
        Genera un PDF con separaciones spot reales y un TIFF multicanal (CMYK + 4 canales spot nombrados), fondo
        transparente. Guardá las dos capas antes de exportar.
      </p>
      <div class="flex items-center gap-3">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-40"
          :disabled="!listoParaExportar || exportando || ['pendiente', 'procesando'].includes(diseno.estado_export)"
          @click="exportar"
        >
          {{ ["pendiente", "procesando"].includes(diseno.estado_export) || exportando ? "Exportando…" : "Exportar" }}
        </button>
        <template v-if="diseno.estado_export === 'listo'">
          <button class="text-np-teal font-medium hover:text-np-teal-dark transition-colors" @click="descargar('pdf')">Descargar PDF</button>
          <button class="text-np-teal font-medium hover:text-np-teal-dark transition-colors" @click="descargar('tiff')">Descargar TIFF</button>
        </template>
        <span v-if="diseno.estado_export === 'error'" class="text-sm text-red-600">{{ diseno.mensaje_error_export }}</span>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Armar hoja (copias + corte)</h2>
      <p class="text-xs text-np-ink/40">
        Arma una hoja con el diseño repetido en el rollo elegido, con marcas de registro (ARMS, plotter Graphtec) y
        el contorno de corte real (la silueta vectorizada) para cortar cada copia después. Guardá las dos capas antes
        de exportar la hoja.
      </p>
      <div class="grid sm:grid-cols-4 gap-3 text-sm">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Ancho de rollo</span>
          <select v-model.number="anchoHojaInput" class="border border-black/10 rounded-lg px-2 py-1.5">
            <option v-for="a in ANCHOS_HOJA" :key="a" :value="a">{{ a }}mm</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Copias</span>
          <input v-model.number="copiasInput" type="number" min="1" class="border border-black/10 rounded-lg px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Margen entre copias (mm)</span>
          <input v-model.number="margenHojaInput" type="number" min="0" class="border border-black/10 rounded-lg px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-np-ink/50">Tamaño de marca (mm)</span>
          <input v-model.number="marcaRegistroInput" type="number" min="1" class="border border-black/10 rounded-lg px-2 py-1.5" />
        </label>
      </div>
      <label class="flex items-center gap-1.5 text-sm">
        <input v-model="rotarCopiasInput" type="checkbox" class="accent-np-teal" />
        Rotar copias 90° (por si entran más así en el ancho de rollo elegido)
      </label>

      <div class="flex items-center gap-3">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          :disabled="armandoHoja || !copiasInput"
          @click="armarHoja"
        >
          {{ armandoHoja ? "Armando…" : "Armar hoja" }}
        </button>
        <span v-if="diseno.alto_hoja_mm" class="text-xs text-np-ink/50">
          {{ grillaPreview ? `${grillaPreview.columnas}×${grillaPreview.filas} copias, ` : "" }}
          hoja de {{ anchoHojaInput }}×{{ Number(diseno.alto_hoja_mm).toFixed(0) }}mm
        </span>
      </div>

      <div v-if="diseno.alto_hoja_mm" class="flex items-center gap-3 pt-2 border-t border-black/5">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-40"
          :disabled="exportandoHoja || ['pendiente', 'procesando'].includes(diseno.estado_hoja)"
          @click="exportarHoja"
        >
          {{ ["pendiente", "procesando"].includes(diseno.estado_hoja) || exportandoHoja ? "Exportando…" : "Exportar hoja" }}
        </button>
        <button v-if="diseno.estado_hoja === 'listo'" class="text-np-teal font-medium hover:text-np-teal-dark transition-colors" @click="descargarHoja">
          Descargar hoja (PDF)
        </button>
        <span v-if="diseno.estado_hoja === 'error'" class="text-sm text-red-600">{{ diseno.mensaje_error_hoja }}</span>
      </div>
    </section>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
  </div>
</template>
