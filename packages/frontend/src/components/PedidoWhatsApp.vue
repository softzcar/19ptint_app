<script setup>
import { ref, computed } from "vue";
import { useAuthStore } from "../stores/auth.js";

const props = defineProps({ lienzo: { type: Object, required: true } });
const auth = useAuthStore();

// Catálogo de Ninesys para lo que sale de esta app (CONTEXTO.md §15). El
// agente de WhatsApp matchea por el NOMBRE exacto del catálogo — tiene que
// ser texto idéntico al de Ninesys o responde "producto no encontrado".
// Todos van con corte="No aplica", tela="No aplica", talla="Talla única"
// — son productos por metraje, no prendas por talla/corte.
const SERVICIOS = {
  dtf: [
    { id: "dtf", nombre: "Impresión DTF", precio: 5, detalle: "ID 4 · $5 por metro o unidad" },
    { id: "dtf_uv", nombre: "DTF UV RIGIDO", precio: 15, detalle: "ID 8 · $15 por metro" },
  ],
  sublimacion: [
    {
      id: "sub_tela_cliente",
      nombre: "Impresión sublimación",
      precio: 4,
      detalle: "ID 5 · $4 por metro, ancho 158cm, tela del cliente",
    },
    { id: "sub_con_tela", nombre: "Sublimación con tela", precio: 5, detalle: "ID 6 · $5 por metro" },
  ],
};

const opciones = computed(() => SERVICIOS[props.lienzo.tipo] ?? []);
const servicioId = ref(opciones.value[0]?.id);
const servicio = computed(() => opciones.value.find((o) => o.id === servicioId.value));

const cantidadMetros = computed(() => (Number(props.lienzo.alto_usado_mm) / 1000).toFixed(2));

const perfilCompleto = computed(() => !!auth.usuario?.nombre && !!auth.usuario?.cedula);

const numeroNinesys = import.meta.env.VITE_WHATSAPP_NUMERO;

function construirMensaje() {
  const urlLienzo = `${window.location.origin}/lienzos/${props.lienzo.id}`;
  const u = auth.usuario;
  return [
    "Hola, quiero cotizar un pedido:",
    "",
    `Producto: ${servicio.value.nombre}`,
    `Cantidad: ${cantidadMetros.value} metros`,
    "Talla: Talla única",
    "Corte: No aplica",
    "Tela: No aplica",
    "",
    `Detalles de diseño: Diseño ya armado en la plataforma Nineteen Print, listo para imprimir: ${urlLienzo}`,
    "",
    `Nombre y apellido: ${u.nombre}`,
    `Cédula: ${u.cedula}`,
    `Dirección: ${u.direccion || "No indicada"}`,
  ].join("\n");
}

function enviarPorWhatsapp() {
  const mensaje = construirMensaje();
  const url = `https://wa.me/${numeroNinesys}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");
}
</script>

<template>
  <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
    <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Pedir presupuesto por WhatsApp</h2>

    <p v-if="!perfilCompleto" class="text-sm text-np-ink/60">
      Completá tu
      <router-link :to="{ name: 'perfil' }" class="text-np-teal underline">nombre y cédula en tu perfil</router-link>
      antes de enviar el pedido.
    </p>

    <template v-else>
      <label class="block text-sm text-np-ink/60">
        Servicio
        <select
          v-model="servicioId"
          class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
        >
          <option v-for="o in opciones" :key="o.id" :value="o.id">{{ o.nombre }} — {{ o.detalle }}</option>
        </select>
      </label>

      <p class="text-xs text-np-ink/50">
        Cantidad estimada: <strong>{{ cantidadMetros }} metros</strong> (largo de rollo usado por el lienzo).
      </p>

      <button
        class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors"
        @click="enviarPorWhatsapp"
      >
        Enviar pedido por WhatsApp
      </button>
      <p class="text-[11px] text-np-ink/40">
        Se abre WhatsApp con el mensaje ya armado — solo hay que apretar enviar.
      </p>
    </template>
  </section>
</template>
