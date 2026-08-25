<script setup>
const props = defineProps({
  img: { type: Object, required: true },
  store: { type: Object, required: true },
  // Slot opcional para un control extra (ej. checkbox "incluir en este
  // lienzo") que se muestra antes del nombre del archivo, sin duplicar el
  // resto de la tarjeta -- usado desde LienzoView.vue.
});
</script>

<template>
  <div class="border border-black/5 rounded-xl p-3 space-y-2.5">
    <img
      v-if="img.estado_fondo === 'listo' && store.previewUrls.value[img.id]"
      :src="store.previewUrls.value[img.id]"
      class="w-full h-32 object-contain bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] rounded-lg"
    />
    <div v-else class="w-full h-32 flex items-center justify-center bg-np-paper rounded-lg text-sm text-np-ink/40">
      {{ img.estado_fondo === "error" ? "Error quitando fondo" : "Quitando fondo…" }}
    </div>

    <slot name="antes-nombre" :img="img" />

    <p class="text-xs font-medium truncate text-np-ink/70" :title="img.nombre_original">{{ img.nombre_original }}</p>

    <label class="flex items-center gap-1.5 text-xs text-np-ink/60">
      <input type="checkbox" class="accent-np-teal" :checked="store.proporcionBloqueada.value[img.id]" @change="store.toggleProporcion(img)" />
      Mantener proporción
    </label>

    <div class="grid grid-cols-3 gap-1.5 text-xs items-end">
      <label class="text-np-ink/50">
        Alto (cm)
        <input
          v-model="store.alturasCm.value[img.id]"
          type="number"
          min="0.1"
          step="0.1"
          :disabled="img.estado_fondo !== 'listo'"
          class="w-full border border-black/10 rounded-md px-1.5 py-1 disabled:bg-np-paper focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          @change="store.actualizarAltura(img)"
        />
      </label>
      <label class="text-np-ink/50">
        Ancho (cm)
        <input
          v-if="!store.proporcionBloqueada.value[img.id]"
          v-model="store.anchosCm.value[img.id]"
          type="number"
          min="0.1"
          step="0.1"
          :disabled="img.estado_fondo !== 'listo'"
          class="w-full border border-black/10 rounded-md px-1.5 py-1 disabled:bg-np-paper focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          @change="store.actualizarAncho(img)"
        />
        <span v-else class="block px-1.5 py-1 text-np-ink/40">
          {{ store.anchoProporcionalCm(img, store.alturasCm.value[img.id]) ?? "—" }}
        </span>
      </label>
      <label class="text-np-ink/50">
        Copias
        <input
          v-model="img.copias"
          type="number"
          min="0"
          class="w-full border border-black/10 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          @change="store.actualizarCopias(img)"
        />
      </label>
    </div>
    <p class="text-[11px] text-np-ink/40">
      {{
        store.proporcionBloqueada.value[img.id]
          ? "Ancho calculado automáticamente, no se puede deformar."
          : "Proporción desactivada: el ancho es manual y puede deformar la imagen."
      }}
    </p>

    <div class="flex items-center justify-between text-xs pt-1 border-t border-black/5">
      <span v-if="store.progresoUpscale.value[img.id] !== undefined" class="text-np-ink/40">
        Aumentando resolución… {{ store.progresoUpscale.value[img.id] }}%
      </span>
      <button
        v-else-if="img.estado_fondo === 'listo' && store.dispositivoCompatible"
        class="text-np-teal font-medium hover:text-np-teal-dark transition-colors"
        @click="store.pedirUpscale(img)"
      >
        {{ img.estado_upscale === "listo" ? "Upscale ✓ (repetir)" : "Aumentar resolución" }}
      </button>
      <span v-else-if="img.estado_fondo === 'listo'" class="text-np-ink/40">
        Su dispositivo no es compatible con esta aplicación
      </span>
      <button class="text-red-600/70 hover:text-red-600 transition-colors" @click="store.eliminarImagen(img)">Eliminar</button>
    </div>

    <label class="flex items-center justify-between gap-2 text-xs text-np-ink/60 pt-1.5 border-t border-black/5">
      <span>
        {{ store.cambiandoFondo.value[img.id] ? "Actualizando…" : "Quitar fondo" }}
      </span>
      <input
        type="checkbox"
        class="accent-np-teal"
        :checked="img.quitar_fondo"
        :disabled="['pendiente', 'procesando'].includes(img.estado_fondo) || store.cambiandoFondo.value[img.id]"
        @change="img.quitar_fondo ? store.mantenerFondo(img) : store.quitarFondo(img)"
      />
    </label>
  </div>
</template>
