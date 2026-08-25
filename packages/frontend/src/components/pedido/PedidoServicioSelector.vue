<script setup>
import { ref, computed, watch } from "vue";
import { api } from "../../lib/api.js";

const props = defineProps({ idEmpresa: { type: Number, required: true } });
const emit = defineEmits(["seleccionar"]);

const cargando = ref(false);
const error = ref("");
const productos = ref([]);
const opcionElegida = ref("");

// Un producto puede tener varios tramos de precio (products_prices, sin
// min/max estructurado -- ver plan de integración §A.4) -- cada tramo se
// ofrece como opción separada del select.
const opciones = computed(() =>
  productos.value.flatMap((p) =>
    (p.prices?.length ? p.prices : [{ id: "unico", price: p.regular_price ?? 0, description: "" }]).map((tramo) => ({
      valor: `${p.cod}:${tramo.id}`,
      etiqueta: tramo.description ? `${p.name} — ${tramo.description} ($${tramo.price}/m)` : `${p.name} ($${tramo.price}/m)`,
      cod: p.cod,
      categoria: p.categories?.[0]?.id ?? 0,
      name: p.name,
      precio: Number(tramo.price),
    }))
  )
);

async function cargar() {
  cargando.value = true;
  error.value = "";
  productos.value = [];
  opcionElegida.value = "";
  try {
    const { data } = await api.get(`/ninesys/${props.idEmpresa}/productos-impresion`);
    productos.value = data.productos ?? [];
  } catch (err) {
    error.value = err.response?.data?.error ?? "No se pudo cargar el catálogo de servicios";
  } finally {
    cargando.value = false;
  }
}

watch(() => props.idEmpresa, cargar, { immediate: true });

watch(opcionElegida, (valor) => {
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
      v-model="opcionElegida"
      class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
    >
      <option value="" disabled>Elegí un servicio…</option>
      <option v-for="o in opciones" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
    </select>
  </div>
</template>
