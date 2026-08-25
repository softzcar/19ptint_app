<script setup>
import GeneradorTexto from "./GeneradorTexto.vue";

const props = defineProps({
  proyectoId: { type: [String, Number], required: true },
  store: { type: Object, required: true },
});
</script>

<template>
  <div>
    <div class="flex gap-4 border-b border-black/5 text-sm font-medium">
      <button
        class="pb-2 -mb-px border-b-2 transition-colors"
        :class="store.modoCarga.value === 'subir' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
        @click="store.modoCarga.value = 'subir'"
      >
        Subir archivo
      </button>
      <button
        class="pb-2 -mb-px border-b-2 transition-colors"
        :class="store.modoCarga.value === 'buscar' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
        @click="store.modoCarga.value = 'buscar'"
      >
        Buscar en internet
      </button>
      <button
        class="pb-2 -mb-px border-b-2 transition-colors"
        :class="store.modoCarga.value === 'texto' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
        @click="store.modoCarga.value = 'texto'"
      >
        Crear texto
      </button>
    </div>

    <label
      v-if="store.modoCarga.value === 'subir'"
      class="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-4 cursor-pointer transition-colors text-sm text-np-ink/60 mt-4"
      :class="store.arrastrandoArchivo.value ? 'border-np-teal bg-np-teal-light/40' : 'border-np-teal/25 hover:border-np-teal/50'"
      @dragover.prevent="store.arrastrandoArchivo.value = true"
      @dragleave.prevent="store.arrastrandoArchivo.value = false"
      @drop.prevent="store.onDropArchivos"
    >
      <span>{{ store.subiendo.value ? "Subiendo..." : "Elegir imágenes o arrastrarlas acá" }}</span>
      <input type="file" multiple accept="image/*" class="hidden" @change="store.subirArchivos" :disabled="store.subiendo.value" />
    </label>

    <GeneradorTexto v-else-if="store.modoCarga.value === 'texto'" :proyecto-id="props.proyectoId" @agregada="store.cargar" class="mt-4" />

    <div v-else class="space-y-3 mt-4">
      <div class="flex gap-2">
        <input
          v-model="store.busqueda.value"
          placeholder="Ej: flores tropicales, geométrico, montañas..."
          class="flex-1 border border-black/10 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
          @keyup.enter="store.buscarImagenesWeb"
        />
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-4 rounded-lg transition-colors disabled:opacity-50"
          :disabled="store.buscando.value"
          @click="store.buscarImagenesWeb"
        >
          {{ store.buscando.value ? "Buscando..." : "Buscar" }}
        </button>
      </div>
      <p class="text-[11px] text-np-ink/40">Fotos de stock (Pexels) de uso comercial libre.</p>
      <p v-if="store.busquedaError.value" class="text-sm text-red-600">{{ store.busquedaError.value }}</p>

      <div v-if="store.resultadosBusqueda.value.length" class="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-96 overflow-auto pr-1">
        <div v-for="foto in store.resultadosBusqueda.value" :key="foto.id" class="space-y-1">
          <div class="relative group rounded-lg overflow-hidden">
            <img :src="foto.miniatura" class="w-full h-24 object-cover" />
            <button
              class="absolute inset-0 bg-np-ink/70 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center px-1"
              :disabled="store.agregandoFotoId.value === foto.id"
              @click="store.usarImagenWeb(foto)"
            >
              {{ store.agregandoFotoId.value === foto.id ? "Agregando..." : "Usar esta imagen" }}
            </button>
          </div>
          <p class="text-[10px] text-np-ink/40 truncate">{{ foto.autor }}</p>
        </div>
      </div>
    </div>

    <p v-if="store.error.value" class="text-sm text-red-600 mt-3">{{ store.error.value }}</p>
  </div>
</template>
