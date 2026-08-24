<script setup>
import { EMPRESAS_NINESYS } from "../../config/empresasNinesys.js";

defineProps({ idEmpresa: { type: Number, default: null } });
const emit = defineEmits(["seleccionar"]);
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-np-ink/60">¿A qué empresa se envía este pedido?</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button
        v-for="empresa in EMPRESAS_NINESYS"
        :key="empresa.id"
        type="button"
        class="border rounded-lg px-4 py-3 text-left transition-colors"
        :class="
          idEmpresa === empresa.id
            ? 'border-np-teal bg-np-teal-light text-np-teal-dark font-bold'
            : 'border-black/10 hover:border-np-teal/40'
        "
        @click="emit('seleccionar', empresa.id)"
      >
        {{ empresa.nombre }}
      </button>
    </div>
  </div>
</template>
