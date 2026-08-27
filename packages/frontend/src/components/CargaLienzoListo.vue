<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";

const props = defineProps({ proyectoId: { type: [String, Number], required: true } });
const router = useRouter();

const tipo = ref(null);
const archivo = ref(null);
const arrastrando = ref(false);
const subiendo = ref(false);
const progreso = ref(0);
const error = ref("");

const listoParaSubir = computed(() => Boolean(tipo.value && archivo.value) && !subiendo.value);

function elegirArchivo(event) {
  archivo.value = event.target.files?.[0] ?? null;
  event.target.value = "";
}

function onDrop(event) {
  arrastrando.value = false;
  archivo.value = event.dataTransfer?.files?.[0] ?? null;
}

function formatoLegible(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function subir() {
  if (!listoParaSubir.value) return;
  subiendo.value = true;
  progreso.value = 0;
  error.value = "";
  try {
    const form = new FormData();
    form.append("archivo", archivo.value);
    form.append("tipo", tipo.value);
    const { data } = await api.post(`/proyectos/${props.proyectoId}/lienzos/subir-listo`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (e.total) progreso.value = Math.round((e.loaded / e.total) * 100);
      },
    });
    // El resto (elegir empresa/servicio y pedir presupuesto) es lo mismo que
    // para cualquier lienzo generado por acomodo -- se reusa esa vista tal
    // cual (LienzoView.vue ya sabe mostrar un lienzo sin items, ver
    // routes/lienzos.js).
    router.push({ name: "lienzo", params: { id: data.id } });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo subir el lienzo";
  } finally {
    subiendo.value = false;
  }
}
</script>

<template>
  <div class="mt-4 space-y-4">
    <p class="text-xs text-np-ink/40">
      Para un diseño ya armado afuera de esta app. No pasa por el motor de acomodo ni tiene límite de tamaño de
      imagen -- después de subirlo, elegís empresa y servicio para pedir presupuesto.
    </p>

    <div class="space-y-2">
      <p class="text-sm text-np-ink/60">Tipo</p>
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

    <label
      class="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-6 cursor-pointer transition-colors text-sm text-np-ink/60"
      :class="arrastrando ? 'border-np-teal bg-np-teal-light/40' : 'border-np-teal/25 hover:border-np-teal/50'"
      @dragover.prevent="arrastrando = true"
      @dragleave.prevent="arrastrando = false"
      @drop.prevent="onDrop"
    >
      <span v-if="archivo">{{ archivo.name }} ({{ formatoLegible(archivo.size) }})</span>
      <span v-else>Elegí el archivo o arrastralo acá — sin límite de tamaño</span>
      <input type="file" accept="image/png,image/jpeg,application/pdf" class="hidden" @change="elegirArchivo" />
    </label>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <div v-if="subiendo" class="space-y-1">
      <div class="h-1.5 bg-np-paper rounded-full overflow-hidden">
        <div class="h-full bg-np-teal transition-all" :style="{ width: `${progreso}%` }" />
      </div>
      <p class="text-xs text-np-ink/40">Subiendo… {{ progreso }}%</p>
    </div>

    <button
      class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
      :disabled="!listoParaSubir"
      @click="subir"
    >
      {{ subiendo ? "Subiendo…" : "Subir lienzo" }}
    </button>
  </div>
</template>
