<script setup>
import { ref, computed, reactive } from "vue";
import { api } from "../lib/api.js";

const props = defineProps({ proyectoId: { type: [String, Number], required: true } });
const emit = defineEmits(["agregados"]);

const tipo = ref(null);
const archivos = ref([]); // [{ id, file, tela, preview, estado, errorMsg }]
const arrastrando = ref(false);
const subiendo = ref(false);
const error = ref("");

let siguienteId = 0;

function formatoLegible(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// La miniatura es solo para que el usuario confirme el archivo antes de
// subirlo -- si falla o tarda de más (PDF corrupto, formato raro, o uno muy
// pesado vectorialmente -- ver el timeout en pdfPreview.js) no bloquea
// nada, la tarjeta queda sin imagen pero el archivo se puede subir igual.
async function generarPreview(entrada) {
  entrada.previewCargando = true;
  try {
    if (entrada.file.type === "application/pdf") {
      const { miniaturaPrimeraPagina } = await import("../lib/pdfPreview.js");
      entrada.preview = await miniaturaPrimeraPagina(entrada.file);
    } else if (entrada.file.type.startsWith("image/")) {
      entrada.preview = URL.createObjectURL(entrada.file);
    }
  } catch (e) {
    console.warn("No se pudo generar la miniatura:", e);
    entrada.preview = null;
  } finally {
    entrada.previewCargando = false;
  }
}

function agregarArchivos(fileList) {
  for (const file of Array.from(fileList ?? [])) {
    // reactive(), no un objeto plano: generarPreview termina en un microtask
    // posterior (tras el await de la miniatura) y muta esta misma referencia
    // -- si fuera un objeto plano, esa mutación pasaría por fuera del proxy
    // que arma `archivos.value = [...]` y Vue nunca se enteraría del cambio.
    // El resultado: la miniatura se genera bien pero la tarjeta se queda
    // mostrando "Generando..." para siempre porque nada dispara un re-render.
    const entrada = reactive({
      id: siguienteId++,
      file,
      tela: "",
      preview: null,
      previewCargando: false,
      estado: "pendiente",
      errorMsg: "",
    });
    archivos.value = [...archivos.value, entrada];
    generarPreview(entrada);
  }
}

function elegirArchivos(event) {
  agregarArchivos(event.target.files);
  event.target.value = "";
}

function onDrop(event) {
  arrastrando.value = false;
  agregarArchivos(event.dataTransfer?.files);
}

function quitar(id) {
  archivos.value = archivos.value.filter((a) => a.id !== id);
}

// Se puede subir en cuanto hay tipo + al menos un archivo pendiente --
// "pendiente" y no solo "cualquiera" porque tras un error parcial (ver
// subirTodo) los que ya quedaron "listo" no se vuelven a mandar.
const hayPendientes = computed(() => archivos.value.some((a) => a.estado === "pendiente" || a.estado === "error"));
const listoParaSubir = computed(() => Boolean(tipo.value) && hayPendientes.value && !subiendo.value);

async function subirTodo() {
  if (!listoParaSubir.value) return;
  subiendo.value = true;
  error.value = "";
  const creados = [];
  for (const entrada of archivos.value) {
    if (entrada.estado === "listo") continue; // ya subido en un intento anterior
    entrada.estado = "subiendo";
    entrada.errorMsg = "";
    try {
      const form = new FormData();
      form.append("archivo", entrada.file);
      form.append("tipo", tipo.value);
      if (tipo.value === "sublimacion" && entrada.tela.trim()) form.append("tela", entrada.tela.trim());
      const { data } = await api.post(`/proyectos/${props.proyectoId}/lienzos/subir-listo`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      entrada.estado = "listo";
      creados.push(data);
    } catch (e) {
      entrada.estado = "error";
      entrada.errorMsg = e.response?.data?.error ?? "No se pudo subir";
    }
  }
  subiendo.value = false;
  if (creados.length) emit("agregados", creados);
  if (archivos.value.every((a) => a.estado === "listo")) {
    archivos.value = [];
  } else if (!creados.length) {
    error.value = "No se pudo subir ningún archivo -- revise el detalle en cada uno.";
  }
}
</script>

<template>
  <div class="mt-4 space-y-4">
    <p class="text-xs text-np-ink/40">
      Para diseños ya armados afuera de esta app. No pasan por el motor de acomodo ni tienen límite de tamaño de
      imagen -- después de subirlos, marcás cuáles combinar para pedir presupuesto.
    </p>

    <div class="space-y-2">
      <p class="text-sm text-np-ink/60">Tipo (para todo lo que agregues acá)</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="border rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          :class="tipo === 'dtf' ? 'border-np-teal bg-np-teal-light text-np-teal-dark' : 'border-black/10 hover:border-np-teal/40'"
          @click="tipo = 'dtf'"
        >
          DTF
        </button>
        <button
          type="button"
          class="border rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          :class="tipo === 'sublimacion' ? 'border-np-teal bg-np-teal-light text-np-teal-dark' : 'border-black/10 hover:border-np-teal/40'"
          @click="tipo = 'sublimacion'"
        >
          Sublimación
        </button>
      </div>
      <p class="text-xs text-np-ink/40">DTF solo acepta PNG · Sublimación acepta PDF o JPEG.</p>
    </div>

    <div v-if="archivos.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div v-for="a in archivos" :key="a.id" class="border border-black/10 rounded-lg p-2.5 space-y-2">
        <div class="relative">
          <img
            v-if="a.preview"
            :src="a.preview"
            class="w-full h-24 object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-md"
          />
          <div v-else class="w-full h-24 flex items-center justify-center bg-np-paper rounded-md text-xs text-np-ink/40">
            {{ a.previewCargando ? "Generando…" : "Sin vista previa" }}
          </div>
          <button
            v-if="a.estado !== 'subiendo'"
            type="button"
            class="absolute -top-1.5 -right-1.5 bg-white border border-black/10 rounded-full w-5 h-5 text-xs leading-none text-np-ink/50 hover:text-red-600 hover:border-red-300 transition-colors"
            title="Quitar"
            @click="quitar(a.id)"
          >
            ×
          </button>
        </div>
        <p class="text-[11px] text-np-ink/70 truncate" :title="a.file.name">{{ a.file.name }}</p>
        <p class="text-[10px] text-np-ink/40">{{ formatoLegible(a.file.size) }}</p>
        <input
          v-if="tipo === 'sublimacion'"
          v-model="a.tela"
          type="text"
          placeholder="Tela (opcional)"
          class="w-full border border-black/10 rounded-md px-1.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          :disabled="a.estado === 'subiendo' || a.estado === 'listo'"
        />
        <p v-if="a.estado === 'subiendo'" class="text-[11px] text-np-ink/40">Subiendo…</p>
        <p v-else-if="a.estado === 'listo'" class="text-[11px] text-green-700">Subido ✓</p>
        <p v-else-if="a.estado === 'error'" class="text-[11px] text-red-600">{{ a.errorMsg }}</p>
      </div>
    </div>

    <label
      class="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-4 cursor-pointer transition-colors text-sm text-np-ink/60"
      :class="arrastrando ? 'border-np-teal bg-np-teal-light/40' : 'border-np-teal/25 hover:border-np-teal/50'"
      @dragover.prevent="arrastrando = true"
      @dragleave.prevent="arrastrando = false"
      @drop.prevent="onDrop"
    >
      <span>{{ archivos.length ? "Agregar otro archivo" : "Elija archivos o arrástrelos aquí" }} — sin límite de tamaño</span>
      <input type="file" multiple accept="image/png,image/jpeg,application/pdf" class="hidden" @change="elegirArchivos" />
    </label>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <button
      class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
      :disabled="!listoParaSubir"
      @click="subirTodo"
    >
      {{ subiendo ? "Subiendo…" : `Subir ${archivos.filter((a) => a.estado !== "listo").length || ""} lienzo(s)` }}
    </button>
  </div>
</template>
