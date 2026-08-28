<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useImagenes, limiteAnchoUtilMm, validarParaAcomodar, erroresPorImagen } from "../composables/useImagenes.js";
import CargaImagenes from "../components/CargaImagenes.vue";
import TarjetaImagen from "../components/TarjetaImagen.vue";
import PedidoWhatsApp from "../components/PedidoWhatsApp.vue";

const props = defineProps({ id: { type: [String, Number], required: true } });
const router = useRouter();

const proyecto = ref(null);
let intervalo = null;

// Varios lienzos "ya listos" (subidos directo, ver CargaLienzoListo.vue) se
// pueden combinar en UN solo presupuesto -- cada uno queda como su propia
// línea de producto (routes/ninesys.js), el total los suma. Solo tiene
// sentido marcar los que todavía no tienen presupuesto: uno ya facturado no
// se puede volver a sumar a otro pedido.
const lienzosMarcados = ref({});
const lienzosPendientes = computed(() => proyecto.value?.lienzos?.filter((l) => !l.id_presupuesto_ninesys) ?? []);
const lienzosParaPresupuesto = computed(() => lienzosPendientes.value.filter((l) => lienzosMarcados.value[l.id]));

const ANCHOS_DTF = [
  { valor: 280, etiqueta: "28 cm" },
  { valor: 580, etiqueta: "58 cm" },
];
const lienzoForm = ref({ tipo: "dtf", ancho_mm: 280, margen_mm: 5, formato_exportacion: "png" });

const imgs = useImagenes(props.id, () => limiteAnchoUtilMm(lienzoForm.value.ancho_mm, lienzoForm.value.margen_mm));

// Las imágenes SIEMPRE se leen de imgs.imagenes (la fuente reactiva), nunca
// de proyecto.imagenes: subir un archivo o tocar un switch actualiza el
// composable por dentro, pero `proyecto` es una copia congelada del último
// GET y se quedaría vieja hasta recargar la página entera.
const imagenesListas = computed(
  () => imgs.imagenes.value?.filter((i) => i.estado_fondo === "listo" && i.ancho_mm && i.alto_mm) ?? []
);
const hayProcesando = computed(() =>
  imgs.imagenes.value?.some((i) => i.estado_fondo === "pendiente" || i.estado_fondo === "procesando" || i.estado_upscale === "procesando")
);
const erroresGeneracion = computed(() =>
  validarParaAcomodar(imgs.imagenes.value ?? [], lienzoForm.value.ancho_mm, lienzoForm.value.margen_mm)
);
const erroresDeImagen = computed(() => erroresPorImagen(erroresGeneracion.value));

async function cargar() {
  // imgs.cargar() ya trae el proyecto completo (imágenes + lienzos) --
  // reusarlo tal cual evita un segundo GET redundante. De acá solo se usan
  // `nombre` y `lienzos`; las imágenes salen de imgs.imagenes.
  proyecto.value = await imgs.cargar();
}

function onTipoChange() {
  if (lienzoForm.value.tipo === "dtf") {
    lienzoForm.value.ancho_mm = 280;
    lienzoForm.value.formato_exportacion = "png";
  } else {
    lienzoForm.value.ancho_mm = 1580;
    lienzoForm.value.formato_exportacion = "pdf";
  }
}

async function generarLienzo() {
  imgs.error.value = "";
  try {
    const { data } = await api.post(`/proyectos/${props.id}/lienzos`, lienzoForm.value);
    router.push({ name: "lienzo", params: { id: data.id } });
  } catch (e) {
    imgs.error.value = e.response?.data?.error ?? "No se pudo generar el lienzo";
  }
}

onMounted(async () => {
  await cargar();
  intervalo = setInterval(() => {
    if (hayProcesando.value) cargar();
  }, 3000);
});
onUnmounted(() => clearInterval(intervalo));
</script>

<template>
  <div v-if="proyecto" class="max-w-5xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">{{ proyecto.nombre }}</h1>
    </div>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Imágenes</h2>

      <CargaImagenes :proyecto-id="props.id" :store="imgs" @agregados="cargar" />

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TarjetaImagen
          v-for="img in imgs.imagenes.value"
          :key="img.id"
          :img="img"
          :store="imgs"
          :errores="erroresDeImagen[img.id] ?? []"
          :reservar-espacio-error="erroresGeneracion.length > 0"
        />
      </div>
    </section>

    <section
      v-if="imgs.modoCarga.value !== 'listo'"
      class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4"
    >
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Generar lienzo</h2>
      <div class="grid sm:grid-cols-4 gap-3 items-end">
        <label class="text-sm text-np-ink/60">
          Tipo
          <select
            v-model="lienzoForm.tipo"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
            @change="onTipoChange"
          >
            <option value="dtf">DTF</option>
            <option value="sublimacion">Sublimación</option>
          </select>
        </label>
        <label v-if="lienzoForm.tipo === 'dtf'" class="text-sm text-np-ink/60">
          Ancho
          <select v-model.number="lienzoForm.ancho_mm" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40">
            <option v-for="a in ANCHOS_DTF" :key="a.valor" :value="a.valor">{{ a.etiqueta }}</option>
          </select>
        </label>
        <label v-else class="text-sm text-np-ink/60">
          Ancho
          <input :value="'158 cm'" disabled class="w-full border border-black/10 rounded-md px-2 py-1.5 bg-np-paper" />
        </label>
        <label class="text-sm text-np-ink/60">
          Margen (mm)
          <input
            v-model.number="lienzoForm.margen_mm"
            type="number"
            min="0"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          />
        </label>
        <label class="text-sm text-np-ink/60">
          Formato de export
          <select
            v-model="lienzoForm.formato_exportacion"
            class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
          >
            <option v-if="lienzoForm.tipo === 'dtf'" value="png">PNG</option>
            <template v-else>
              <option value="pdf">PDF</option>
              <option value="jpeg">JPEG</option>
            </template>
          </select>
        </label>
      </div>
      <div class="flex items-center gap-4">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-np-teal"
          :disabled="!imagenesListas.length || erroresGeneracion.length > 0"
          @click="generarLienzo"
        >
          Auto-acomodar
        </button>
        <p class="text-xs text-np-ink/40">{{ imagenesListas.length }} imagen(es) lista(s) para acomodar.</p>
      </div>
      <!-- El motivo va ANTES del nombre: los nombres de archivo suelen ser
           larguísimos e ilegibles, y si el error va al final hay que leer
           toda la línea para enterarse de qué falta. -->
      <ul v-if="erroresGeneracion.length" class="text-xs text-red-600 space-y-1">
        <li v-for="(e, i) in erroresGeneracion" :key="i" class="flex gap-1.5">
          <span class="font-semibold whitespace-nowrap">{{ e.breve }}:</span>
          <span class="text-red-600/75 truncate" :title="`${e.nombre} — ${e.detalle}`">{{ e.nombre }}</span>
        </li>
      </ul>
    </section>

    <section v-if="proyecto.lienzos.length" class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Lienzos generados</h2>
      <p v-if="lienzosPendientes.length > 1" class="text-xs text-np-ink/40">
        Marcá varios para pedir un solo presupuesto combinado (cada uno queda como su propia línea, el total los suma).
      </p>
      <ul class="space-y-1.5 text-sm">
        <li v-for="l in proyecto.lienzos" :key="l.id" class="flex items-center gap-2">
          <input
            v-if="!l.id_presupuesto_ninesys"
            type="checkbox"
            class="accent-np-teal"
            :checked="lienzosMarcados[l.id]"
            @change="lienzosMarcados = { ...lienzosMarcados, [l.id]: !lienzosMarcados[l.id] }"
          />
          <router-link :to="{ name: 'lienzo', params: { id: l.id } }" class="text-np-ink hover:text-np-teal transition-colors">
            <span class="font-bold">#{{ l.id }}</span> — {{ l.tipo }} — {{ l.ancho_mm }}mm × {{ Math.round(l.alto_usado_mm) }}mm
            — {{ l.items.length ? `${l.items.length} piezas` : "diseño subido" }}
            <span v-if="l.tela" class="text-np-ink/40">(tela: {{ l.tela }})</span>
          </router-link>
          <span v-if="l.id_presupuesto_ninesys" class="text-xs text-np-ink/40">presupuesto #{{ l.id_presupuesto_ninesys }}</span>
        </li>
      </ul>
    </section>

    <PedidoWhatsApp
      v-if="lienzosParaPresupuesto.length"
      :key="lienzosParaPresupuesto.map((l) => l.id).join('-')"
      :lienzos="lienzosParaPresupuesto"
    />
  </div>
</template>
