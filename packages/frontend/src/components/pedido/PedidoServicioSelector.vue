<script setup>
import { ref, computed, watch } from "vue";
import { api } from "../../lib/api.js";

const props = defineProps({ idEmpresa: { type: Number, required: true } });
const emit = defineEmits(["seleccionar"]);

const cargando = ref(false);
const error = ref("");
const servicios = ref([]);
const codElegido = ref("");

// Un producto en Ninesys puede traer varios tramos de precio (por
// cantidad); el admin ya eligió cuál usar para cada uno (ver
// AdminServiciosView.vue) y acá solo se ofrece el nombre -- quien pide el
// presupuesto nunca ve precios ni tiene que elegir un tramo.
const opciones = computed(() =>
  servicios.value.map((s) => ({
    valor: s.cod,
    etiqueta: s.name,
    cod: s.cod,
    categoria: s.categoria,
    name: s.name,
    precio: s.precio,
  }))
);

async function cargar() {
  cargando.value = true;
  error.value = "";
  servicios.value = [];
  codElegido.value = "";
  try {
    const { data } = await api.get(`/ninesys/${props.idEmpresa}/productos-impresion`);
    servicios.value = data.servicios ?? [];
  } catch (err) {
    error.value = err.response?.data?.error ?? "No se pudo cargar el catálogo de servicios";
  } finally {
    cargando.value = false;
  }
}

watch(() => props.idEmpresa, cargar, { immediate: true });

watch(codElegido, (valor) => {
  const opcion = opciones.value.find((o) => o.valor === valor);
  emit("seleccionar", opcion ?? null);
});
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-np-ink/60">Servicio</p>
    <p v-if="cargando" class="text-sm text-np-ink/40">Cargando catálogo…</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-else-if="!opciones.length" class="text-sm text-np-ink/40">
      Esta empresa todavía no tiene servicios de impresión marcados en su catálogo.
    </p>
    <select
      v-else
      v-model="codElegido"
      class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
    >
      <option value="" disabled>Elegí un servicio…</option>
      <option v-for="o in opciones" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
    </select>
  </div>
</template>
