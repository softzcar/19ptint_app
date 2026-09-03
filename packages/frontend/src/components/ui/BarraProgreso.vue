<script setup>
// Barra de progreso única para todos los controles que suben, descargan o
// procesan imágenes -- misma apariencia en todos lados a propósito (pedido
// explícito: nada de una barra distinta por componente).
//
// Modo determinado (progreso 0-100, con %): cuando hay bytes reales que
// medir (onUploadProgress/onDownloadProgress de axios).
// Modo indeterminado (animada, sin %): para procesamiento opaco del lado del
// servidor sin ninguna señal de avance real (ej. quitar fondo por IA,
// renderizar el export de un lienzo) -- mostrar un % inventado ahí sería
// peor que no mostrar ninguno.
defineProps({
  etiqueta: { type: String, default: "" },
  progreso: { type: Number, default: 0 },
  indeterminado: { type: Boolean, default: false },
});
</script>

<template>
  <div class="space-y-1">
    <p v-if="etiqueta" class="text-[11px] text-np-ink/50">
      {{ etiqueta }}<span v-if="!indeterminado">… {{ Math.round(progreso) }}%</span>
      <span v-else>…</span>
    </p>
    <div class="h-1.5 w-full bg-np-ink/10 rounded-full overflow-hidden">
      <div
        v-if="indeterminado"
        class="h-full w-1/3 bg-np-teal rounded-full barra-progreso-indeterminada"
      />
      <div
        v-else
        class="h-full bg-np-teal rounded-full transition-[width] duration-150"
        :style="{ width: `${Math.min(100, Math.max(0, progreso))}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes barra-progreso-desplazar {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
.barra-progreso-indeterminada {
  animation: barra-progreso-desplazar 1.2s ease-in-out infinite;
}
</style>
