<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useImagenes, limiteAnchoUtilMm, validarParaAcomodar, erroresPorImagen } from "../composables/useImagenes.js";
import PedidoWhatsApp from "../components/PedidoWhatsApp.vue";
import EstadoEntrega from "../components/EstadoEntrega.vue";
import CargaImagenes from "../components/CargaImagenes.vue";
import TarjetaImagen from "../components/TarjetaImagen.vue";
import BarraProgreso from "../components/ui/BarraProgreso.vue";

const props = defineProps({ id: { type: [String, Number], required: true } });
const router = useRouter();

const lienzo = ref(null);
const imagenesPorId = ref({});
const imagenesCargadas = ref({});
const exportando = ref(false);
const exportFase = ref("renderizando"); // 'renderizando' (POST /exportar, opaco) | 'descargando' (GET /descargar, con % real)
const exportProgreso = ref(0);
const error = ref("");

const ANCHOS_DTF = [
  { valor: 280, etiqueta: "28 cm" },
  { valor: 580, etiqueta: "58 cm" },
];
const editando = ref(false);
const regenerando = ref(false);
const editForm = ref({ tipo: "dtf", ancho_mm: 280, margen_mm: 5, formato_exportacion: "png" });
const imagenesSeleccionadas = ref({});

// proyectoId se conoce recién tras el primer GET /lienzos/:id -- se le pasa
// al composable como ref (unref-eado adentro) para no bloquear su creación.
const proyectoIdRef = ref(null);
const imgs = useImagenes(proyectoIdRef, () => limiteAnchoUtilMm(editForm.value.ancho_mm, editForm.value.margen_mm));

const imagenesElegibles = computed(
  () => imgs.imagenes.value?.filter((i) => i.estado_fondo === "listo" && i.ancho_mm && i.alto_mm) ?? []
);
const imagenesParaAcomodar = computed(() =>
  (imgs.imagenes.value ?? []).filter((i) => imagenesSeleccionadas.value[i.id])
);
const erroresGeneracion = computed(() =>
  validarParaAcomodar(imagenesParaAcomodar.value, editForm.value.ancho_mm, editForm.value.margen_mm)
);
const erroresDeImagen = computed(() => erroresPorImagen(erroresGeneracion.value));

function abrirEdicion() {
  editForm.value = {
    tipo: lienzo.value.tipo,
    ancho_mm: Number(lienzo.value.ancho_mm),
    margen_mm: Number(lienzo.value.margen_mm),
    formato_exportacion: lienzo.value.formato_exportacion,
  };
  const idsActuales = new Set(lienzo.value.items.map((i) => i.imagen_id));
  imagenesSeleccionadas.value = Object.fromEntries(
    imagenesElegibles.value.map((img) => [img.id, idsActuales.has(img.id)])
  );
  editando.value = true;
}

function onTipoChangeEdit() {
  if (editForm.value.tipo === "dtf") {
    editForm.value.ancho_mm = 280;
    editForm.value.formato_exportacion = "png";
  } else {
    editForm.value.ancho_mm = 1580;
    editForm.value.formato_exportacion = "pdf";
  }
}

async function regenerar() {
  regenerando.value = true;
  error.value = "";
  try {
    const imagenIds = Object.entries(imagenesSeleccionadas.value)
      .filter(([, marcada]) => marcada)
      .map(([id]) => Number(id));
    await api.patch(`/lienzos/${props.id}`, { ...editForm.value, imagenIds });
    editando.value = false;
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo re-acomodar";
  } finally {
    regenerando.value = false;
  }
}

async function eliminarLienzo() {
  if (!confirm("¿Eliminar este lienzo? Esta acción no se puede deshacer.")) return;
  await api.delete(`/lienzos/${props.id}`);
  router.push({ name: "proyecto", params: { id: lienzo.value.proyecto_id } });
}

const MAX_ANCHO_PANTALLA = 900;
const escala = computed(() => {
  if (!lienzo.value) return 1;
  return Math.min(1, MAX_ANCHO_PANTALLA / Number(lienzo.value.ancho_mm));
});
const anchoPx = computed(() => Number(lienzo.value.ancho_mm) * escala.value);
const altoPx = computed(() => Number(lienzo.value.alto_usado_mm) * escala.value);

// Bounding box tras rotar alrededor del centro: para 0/180 no cambia
// (ancho,alto); para 90/270 el ancho/alto ya vienen intercambiados en
// item.ancho_mm/alto_mm (así los guarda el motor de acomodo).
function piezas() {
  if (!lienzo.value) return [];
  return lienzo.value.items.map((item) => {
    const swapped = item.rotacion % 180 !== 0;
    const anchoOriginalMM = swapped ? Number(item.alto_mm) : Number(item.ancho_mm);
    const altoOriginalMM = swapped ? Number(item.ancho_mm) : Number(item.alto_mm);
    const centroXmm = Number(item.x_mm) + Number(item.ancho_mm) / 2;
    const centroYmm = Number(item.y_mm) + Number(item.alto_mm) / 2;
    return {
      item,
      imagen: imagenesPorId.value[item.imagen_id],
      imgElement: imagenesCargadas.value[item.imagen_id],
      x: centroXmm * escala.value,
      y: centroYmm * escala.value,
      width: anchoOriginalMM * escala.value,
      height: altoOriginalMM * escala.value,
      offsetX: (anchoOriginalMM * escala.value) / 2,
      offsetY: (altoOriginalMM * escala.value) / 2,
      rotation: item.rotacion,
    };
  });
}
const piezasRender = ref([]);

// Lienzo sin items (subido directo ya armado, ver routes/lienzos.js POST
// /lienzos/subir-listo): no hay piezas que dibujar en el canvas de Konva
// (no vino de acomodar imágenes), así que se muestra el archivo final tal
// cual en vez del canvas vacío.
const previewUrlDirecto = ref(null);

async function cargar() {
  const { data } = await api.get(`/lienzos/${props.id}`);
  lienzo.value = data;
  proyectoIdRef.value = data.proyecto_id;

  if (!data.items.length) {
    if (["png", "jpeg"].includes(data.formato_exportacion)) {
      const resp = await api.get(`/lienzos/${props.id}/descargar`, { responseType: "blob" });
      previewUrlDirecto.value = URL.createObjectURL(resp.data);
    }
    return;
  }

  // imgs.cargar() trae el proyecto completo (todas sus imágenes, con
  // preview autenticado y controles de alto/ancho/copias ya inicializados)
  // -- lo mismo que usa ProyectoDetalleView.vue, así el panel "Editar /
  // re-acomodar" muestra exactamente lo mismo que al cargar por primera vez.
  await imgs.cargar();

  const idsUnicos = [...new Set(data.items.map((i) => i.imagen_id))];
  const entradas = await Promise.all(
    idsUnicos.map(async (id) => {
      const r = await api.get(`/imagenes/${id}`);
      return [id, r.data];
    })
  );
  imagenesPorId.value = Object.fromEntries(entradas);
  piezasRender.value = piezas();

  // El endpoint de archivo requiere auth (Bearer), así que se trae como
  // blob autenticado y se convierte a object URL en vez de usar <img src>.
  for (const id of idsUnicos) {
    const resp = await api.get(`/imagenes/${id}/archivo`, {
      params: { variante: "procesada" },
      responseType: "blob",
    });
    const url = URL.createObjectURL(resp.data);
    const img = new window.Image();
    img.onload = () => {
      imagenesCargadas.value = { ...imagenesCargadas.value, [id]: img };
      piezasRender.value = piezas();
    };
    img.src = url;
  }
}

async function onDragEnd(pieza, konvaEvent) {
  const node = konvaEvent.target;
  const centroXmm = node.x() / escala.value;
  const centroYmm = node.y() / escala.value;
  const nuevoX = centroXmm - Number(pieza.item.ancho_mm) / 2;
  const nuevoY = centroYmm - Number(pieza.item.alto_mm) / 2;
  pieza.item.x_mm = nuevoX;
  pieza.item.y_mm = nuevoY;
  await api.patch(`/lienzo-items/${pieza.item.id}`, { x_mm: nuevoX, y_mm: nuevoY });
}

async function exportar() {
  exportando.value = true;
  exportProgreso.value = 0;
  error.value = "";
  try {
    // Un lienzo subido ya armado (sin items) no tiene nada para
    // re-renderizar -- el archivo subido YA es el export, así que este botón
    // solo lo descarga (ver exportarLienzo.js, que rechaza re-exportar algo
    // sin piezas acomodadas).
    if (lienzo.value.items.length) {
      exportFase.value = "renderizando"; // llamada opaca y síncrona del lado del servidor, sin señal de avance real
      await api.post(`/lienzos/${props.id}/exportar`);
    }
    exportFase.value = "descargando";
    const resp = await api.get(`/lienzos/${props.id}/descargar`, {
      responseType: "blob",
      onDownloadProgress: (e) => {
        exportProgreso.value = e.total ? Math.round((e.loaded / e.total) * 100) : exportProgreso.value;
      },
    });
    const ext = lienzo.value.formato_exportacion === "pdf" ? "pdf" : lienzo.value.formato_exportacion === "jpeg" ? "jpeg" : "png";
    const url = URL.createObjectURL(resp.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lienzo-${props.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo exportar";
  } finally {
    exportando.value = false;
  }
}

// Sin esto, una tarjeta se queda mostrando "Quitando fondo…" para siempre
// una vez que termina el job -- nada vuelve a pedir el estado actual (a
// diferencia de ProyectoDetalleView.vue, que sí refresca solo mientras algo
// está procesando). Alcanza con refrescar imgs.cargar() (las tarjetas), no
// hace falta repetir la carga pesada del canvas de Konva.
const hayProcesandoFondo = computed(() =>
  imgs.imagenes.value?.some((i) => i.estado_fondo === "pendiente" || i.estado_fondo === "procesando")
);

// La entrega a la PC de producción tarda de segundos a minutos (o más, si esa
// PC está apagada), así que el estado se refresca solo mientras siga en curso.
const entregaEnCurso = computed(
  () => lienzo.value?.entrega && lienzo.value.entrega.estado !== "entregado"
);

// Solo vuelve a pedir la fila del lienzo: repetir cargar() rearmaría todo el
// canvas de Konva (descarga cada imagen de nuevo) para actualizar un cartel.
async function refrescarEntrega() {
  try {
    const { data } = await api.get(`/lienzos/${props.id}`);
    lienzo.value.entrega = data.entrega;
  } catch {
    // Un fallo puntual de red no debe romper la vista: se reintenta al toque.
  }
}

// Alimenta los "hace cuánto" de EstadoEntrega sin que dependa de un reloj propio.
const ahora = ref(Date.now());

let intervaloFondo = null;
onMounted(() => {
  cargar();
  intervaloFondo = setInterval(() => {
    ahora.value = Date.now();
    if (hayProcesandoFondo.value) imgs.cargar();
    if (entregaEnCurso.value) refrescarEntrega();
  }, 3000);
});
onUnmounted(() => clearInterval(intervaloFondo));
</script>

<template>
  <div v-if="lienzo" class="max-w-5xl mx-auto p-6 sm:p-10 space-y-4">
    <router-link :to="{ name: 'proyecto', params: { id: lienzo.proyecto_id } }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
      &larr; Proyecto
    </router-link>
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-xl font-bold text-np-ink">
        Lienzo #{{ lienzo.id }} — {{ lienzo.tipo }} — {{ lienzo.ancho_mm }}mm × {{ Math.round(lienzo.alto_usado_mm) }}mm
      </h1>
      <div class="flex items-center gap-2">
        <button
          v-if="lienzo.items.length"
          class="border border-black/10 hover:border-np-teal/40 text-np-ink/70 hover:text-np-teal text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          @click="abrirEdicion"
        >
          Editar / re-acomodar
        </button>
        <div v-if="exportando" class="w-40">
          <BarraProgreso
            :indeterminado="exportFase === 'renderizando'"
            :progreso="exportProgreso"
            :etiqueta="exportFase === 'renderizando' ? 'Renderizando' : 'Descargando'"
          />
        </div>
        <button
          v-else
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          @click="exportar"
        >
          {{ `${lienzo.items.length ? "Exportar" : "Descargar"} ${lienzo.formato_exportacion.toUpperCase()}` }}
        </button>
        <button class="text-red-600/70 hover:text-red-600 text-sm transition-colors" @click="eliminarLienzo">Eliminar lienzo</button>
      </div>
    </div>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="lienzo.items.length" class="text-xs text-np-ink/40">Arrastre las piezas para ajustar manualmente el acomodo.</p>
    <p v-else class="text-xs text-np-ink/40">Lienzo subido ya armado -- sin piezas para reacomodar.</p>

    <section v-if="editando" class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Re-acomodar</h2>
      <div class="grid sm:grid-cols-4 gap-3 items-end">
        <label class="text-sm text-np-ink/60">
          Tipo
          <select v-model="editForm.tipo" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40" @change="onTipoChangeEdit">
            <option value="dtf">DTF</option>
            <option value="sublimacion">Sublimación</option>
          </select>
        </label>
        <label v-if="editForm.tipo === 'dtf'" class="text-sm text-np-ink/60">
          Ancho
          <select v-model.number="editForm.ancho_mm" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40">
            <option v-for="a in ANCHOS_DTF" :key="a.valor" :value="a.valor">{{ a.etiqueta }}</option>
          </select>
        </label>
        <label v-else class="text-sm text-np-ink/60">
          Ancho
          <input :value="'158 cm'" disabled class="w-full border border-black/10 rounded-md px-2 py-1.5 bg-np-paper" />
        </label>
        <label class="text-sm text-np-ink/60">
          Margen (mm)
          <input v-model.number="editForm.margen_mm" type="number" min="0" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40" />
        </label>
        <label class="text-sm text-np-ink/60">
          Formato de export
          <select v-model="editForm.formato_exportacion" class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40">
            <option v-if="editForm.tipo === 'dtf'" value="png">PNG</option>
            <template v-else>
              <option value="pdf">PDF</option>
              <option value="jpeg">JPEG</option>
            </template>
          </select>
        </label>
      </div>

      <div>
        <p class="text-sm font-medium text-np-ink/70 mb-1.5">Agregar imágenes nuevas</p>
        <CargaImagenes :proyecto-id="proyectoIdRef" :store="imgs" @agregados="cargar" />
      </div>

      <div>
        <p class="text-sm font-medium text-np-ink/70 mb-1.5">
          Imágenes del proyecto — marque cuáles incluir en este lienzo
        </p>
        <div class="grid sm:grid-cols-3 gap-3">
          <TarjetaImagen
            v-for="img in imgs.imagenes.value"
            :key="img.id"
            :img="img"
            :store="imgs"
            :errores="erroresDeImagen[img.id] ?? []"
            :reservar-espacio-error="erroresGeneracion.length > 0"
          >
            <template #antes-nombre="{ img: imgSlot }">
              <label
                v-if="imgSlot.estado_fondo === 'listo' && imgSlot.ancho_mm && imgSlot.alto_mm"
                class="flex items-center gap-1.5 text-xs font-semibold text-np-teal"
              >
                <input type="checkbox" class="accent-np-teal" v-model="imagenesSeleccionadas[imgSlot.id]" />
                Incluir en este lienzo
              </label>
              <p v-else class="text-xs text-np-ink/40">Aún no está lista para incluirse.</p>
            </template>
          </TarjetaImagen>
        </div>
        <p v-if="!imgs.imagenes.value?.length" class="text-xs text-np-ink/40">No hay imágenes en este proyecto.</p>
      </div>

      <div class="flex gap-2">
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          :disabled="regenerando || erroresGeneracion.length > 0"
          @click="regenerar"
        >
          {{ regenerando ? "Re-acomodando..." : "Volver a acomodar" }}
        </button>
        <button class="border border-black/10 text-np-ink/70 px-4 py-2 rounded-lg hover:border-np-teal/40 transition-colors" @click="editando = false">
          Cancelar
        </button>
      </div>
      <!-- El motivo va ANTES del nombre: con nombres de archivo largos, el
           error al final obliga a leer toda la línea para entender qué falta. -->
      <ul v-if="erroresGeneracion.length" class="text-xs text-red-600 space-y-1">
        <li v-for="(e, i) in erroresGeneracion" :key="i" class="flex gap-1.5">
          <span class="font-semibold whitespace-nowrap">{{ e.breve }}:</span>
          <span class="text-red-600/75 truncate" :title="`${e.nombre} — ${e.detalle}`">{{ e.nombre }}</span>
        </li>
      </ul>
    </section>

    <div v-if="lienzo.items.length" class="bg-white rounded-xl border border-black/5 shadow-sm p-2 overflow-auto">
      <v-stage :config="{ width: anchoPx, height: altoPx }">
        <v-layer>
          <v-rect :config="{ x: 0, y: 0, width: anchoPx, height: altoPx, fill: '#F5F5F2', stroke: '#E1F5EE' }" />
          <template v-for="pieza in piezasRender" :key="pieza.item.id">
            <v-image
              v-if="pieza.imgElement"
              :config="{
                image: pieza.imgElement,
                x: pieza.x,
                y: pieza.y,
                width: pieza.width,
                height: pieza.height,
                offsetX: pieza.offsetX,
                offsetY: pieza.offsetY,
                rotation: pieza.rotation,
                draggable: true,
              }"
              @dragend="(e) => onDragEnd(pieza, e)"
            />
          </template>
        </v-layer>
      </v-stage>
    </div>
    <div v-else class="bg-white rounded-xl border border-black/5 shadow-sm p-4">
      <img v-if="previewUrlDirecto" :src="previewUrlDirecto" class="max-w-full max-h-[70vh] mx-auto" />
      <p v-else class="text-sm text-np-ink/50 text-center py-8">
        Sin vista previa para PDF -- use "Exportar {{ lienzo.formato_exportacion.toUpperCase() }}" para verlo.
      </p>
    </div>

    <EstadoEntrega :entrega="lienzo.entrega" :ahora="ahora" :lienzo-id="props.id" @reenviado="refrescarEntrega" />

    <PedidoWhatsApp :lienzos="[lienzo]" />
  </div>
</template>
