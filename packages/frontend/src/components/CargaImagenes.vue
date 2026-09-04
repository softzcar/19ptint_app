<script setup>
import GeneradorTexto from "./GeneradorTexto.vue";
import CargaLienzoListo from "./CargaLienzoListo.vue";
import BarraProgreso from "./ui/BarraProgreso.vue";
import CargaDtfUv from "./CargaDtfUv.vue";

const props = defineProps({
  proyectoId: { type: [String, Number], required: true },
  store: { type: Object, required: true },
  // Volver desde el editor de relieve (ver ProyectoDetalleView.vue) -- qué
  // diseño DTF UV recargar automáticamente en vez de arrancar en blanco.
  dtfUvIdInicial: { type: [String, Number], default: null },
});
// Un lienzo nuevo (a diferencia de una imagen) no vive en `store` (el
// composable useImagenes) sino en `proyecto.lienzos`/`lienzo.items` de cada
// vista -- store.cargar() por sí solo no alcanza para refrescar eso. Se
// reemite hacia arriba para que cada vista (ProyectoDetalleView, LienzoView)
// lo conecte a su propio cargar().
const emit = defineEmits(["agregados"]);

async function onTextoAgregado() {
  // Sin esto la pestaña se queda en "Crear texto" tras agregar: el nuevo
  // diseño entra a la grilla de arriba sin ningún cambio visible acá abajo,
  // y da la sensación de que el botón no hizo nada.
  props.store.modoCarga.value = "subir";
  await props.store.cargar();
}
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
      <button
        class="pb-2 -mb-px border-b-2 transition-colors"
        :class="store.modoCarga.value === 'listo' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
        @click="store.modoCarga.value = 'listo'"
      >
        Subir lienzo listo
      </button>
      <button
        class="pb-2 -mb-px border-b-2 transition-colors"
        :class="store.modoCarga.value === 'dtfUv' ? 'border-np-teal text-np-teal' : 'border-transparent text-np-ink/40 hover:text-np-ink/70'"
        @click="store.modoCarga.value = 'dtfUv'"
      >
        DTF UV
      </button>
    </div>

    <div v-if="store.modoCarga.value === 'subir'" class="mt-4 space-y-2">
      <label
        class="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-4 cursor-pointer transition-colors text-sm text-np-ink/60"
        :class="store.arrastrandoArchivo.value ? 'border-np-teal bg-np-teal-light/40' : 'border-np-teal/25 hover:border-np-teal/50'"
        @dragover.prevent="store.arrastrandoArchivo.value = true"
        @dragleave.prevent="store.arrastrandoArchivo.value = false"
        @drop.prevent="store.onDropArchivos"
      >
        <span>{{ store.subiendo.value ? "Subiendo..." : "Elegir imágenes o PDF, o arrastrarlos acá" }}</span>
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          class="hidden"
          @change="store.subirArchivos"
          :disabled="store.subiendo.value"
        />
      </label>
      <BarraProgreso v-if="store.subiendo.value" etiqueta="Subiendo" :progreso="store.progresoSubida.value" />
    </div>

    <GeneradorTexto v-else-if="store.modoCarga.value === 'texto'" :proyecto-id="props.proyectoId" @agregada="onTextoAgregado" class="mt-4" />

    <CargaLienzoListo
      v-else-if="store.modoCarga.value === 'listo'"
      :proyecto-id="props.proyectoId"
      @agregados="emit('agregados', $event)"
    />

    <CargaDtfUv
      v-else-if="store.modoCarga.value === 'dtfUv'"
      :proyecto-id="props.proyectoId"
      :dtf-uv-id-inicial="dtfUvIdInicial"
    />

    <div v-else-if="store.modoCarga.value === 'buscar'" class="space-y-3 mt-4">
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
              class="absolute inset-0 bg-np-ink/70 text-white text-xs font-medium transition flex items-center justify-center text-center px-2"
              :class="store.agregandoFotoId.value === foto.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
              :disabled="store.agregandoFotoId.value === foto.id"
              @click="store.usarImagenWeb(foto)"
            >
              <span v-if="store.agregandoFotoId.value === foto.id" class="w-full space-y-1">
                <span class="block">Agregando…</span>
                <BarraProgreso indeterminado class="w-full" />
              </span>
              <span v-else>Usar esta imagen</span>
            </button>
          </div>
          <p class="text-[10px] text-np-ink/40 truncate">{{ foto.autor }}</p>
        </div>
      </div>
    </div>

    <p v-if="store.error.value" class="text-sm text-red-600 mt-3">{{ store.error.value }}</p>
  </div>
</template>
