<script setup>
import { ref, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";
import { EMPRESAS_NINESYS } from "../config/empresasNinesys.js";

const router = useRouter();
const auth = useAuthStore();

const idEmpresa = ref(EMPRESAS_NINESYS[0]?.id ?? null);
const servicios = ref([]);
const cargando = ref(false);
const error = ref("");
const guardando = ref({});
// Tramo elegido en el <select> de cada fila -- separado de lo que ya está
// guardado (servicio.precio) para poder cambiarlo antes de confirmar.
const tramoElegido = ref({});

function tramoInicial(s) {
  if (s.visible && s.precio != null) {
    const actual = s.tramos.find((t) => Number(t.precio) === Number(s.precio));
    if (actual) return String(actual.id);
  }
  // Sin elección previa: el tramo más barato como punto de partida, el
  // admin lo cambia si corresponde antes de mostrarlo.
  const masBarato = [...s.tramos].sort((a, b) => a.precio - b.precio)[0];
  return masBarato ? String(masBarato.id) : "";
}

async function cargar() {
  if (!idEmpresa.value) return;
  cargando.value = true;
  error.value = "";
  try {
    const { data } = await api.get(`/admin/servicios/${idEmpresa.value}`);
    servicios.value = data.servicios ?? [];
    tramoElegido.value = Object.fromEntries(servicios.value.map((s) => [s.cod, tramoInicial(s)]));
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo cargar el catálogo de esa empresa";
    servicios.value = [];
  } finally {
    cargando.value = false;
  }
}

function precioDelTramo(servicio, idTramo) {
  const tramo = servicio.tramos.find((t) => String(t.id) === String(idTramo));
  return tramo ? tramo.precio : null;
}

function precioCambio(servicio) {
  if (!servicio.visible) return false;
  const precioElegido = precioDelTramo(servicio, tramoElegido.value[servicio.cod]);
  return precioElegido != null && Number(precioElegido) !== Number(servicio.precio);
}

async function guardar(servicio, visible) {
  const precio = precioDelTramo(servicio, tramoElegido.value[servicio.cod]);
  if (visible && precio == null) {
    error.value = "Elegí un tramo de precio antes de mostrarlo";
    return;
  }
  error.value = "";
  guardando.value = { ...guardando.value, [servicio.cod]: true };
  try {
    await api.put(`/admin/servicios/${idEmpresa.value}/${encodeURIComponent(servicio.cod)}`, { visible, precio });
    servicio.visible = visible;
    servicio.precio = visible ? precio : null;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo guardar el cambio";
  } finally {
    const { [servicio.cod]: _quitado, ...resto } = guardando.value;
    guardando.value = resto;
  }
}

watch(idEmpresa, cargar);

onMounted(() => {
  if (auth.usuario?.rol !== "admin") {
    router.replace({ name: "proyectos" });
    return;
  }
  cargar();
});
</script>

<template>
  <div class="max-w-5xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">Servicios de Ninesys</h1>
      <p class="text-sm text-np-ink/50">
        Elegí qué productos del catálogo de cada empresa aparecen para elegir al pedir presupuesto, y a qué precio.
        Quien pide el presupuesto solo ve el nombre del servicio, nunca los tramos de precio de acá.
      </p>
    </div>

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
        @click="idEmpresa = empresa.id"
      >
        {{ empresa.nombre }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">
        Catálogo ({{ servicios.length }})
      </h2>
      <p v-if="cargando" class="text-sm text-np-ink/40">Cargando...</p>
      <p v-else-if="!servicios.length" class="text-sm text-np-ink/40">
        Esta empresa no tiene productos marcados como servicio de impresión en Ninesys.
      </p>

      <div v-else class="overflow-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-np-ink/40 uppercase tracking-wide border-b border-black/5">
              <th class="py-2 pr-3">Producto</th>
              <th class="py-2 pr-3">Código</th>
              <th class="py-2 pr-3">Precio a usar</th>
              <th class="py-2 pr-3">En el pedido</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in servicios" :key="s.cod" class="border-b border-black/5 last:border-0">
              <td class="py-2.5 pr-3 font-medium text-np-ink">{{ s.name }}</td>
              <td class="py-2.5 pr-3 text-np-ink/50 font-mono text-xs">{{ s.cod }}</td>
              <td class="py-2.5 pr-3">
                <select
                  v-model="tramoElegido[s.cod]"
                  class="border border-black/10 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-np-teal/40"
                >
                  <option v-for="t in s.tramos" :key="t.id" :value="String(t.id)">
                    {{ t.descripcion ? `${t.descripcion} — $${t.precio}` : `$${t.precio}` }}
                  </option>
                </select>
              </td>
              <td class="py-2.5 pr-3">
                <div class="flex items-center gap-2">
                  <button
                    class="px-2 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-40"
                    :class="s.visible ? 'bg-np-teal-light text-np-teal-dark' : 'bg-np-paper text-np-ink/50'"
                    :disabled="guardando[s.cod]"
                    @click="guardar(s, !s.visible)"
                  >
                    {{ s.visible ? "Sí" : "No" }}
                  </button>
                  <button
                    v-if="precioCambio(s)"
                    class="text-np-teal hover:text-np-teal-dark text-xs font-medium transition-colors disabled:opacity-40"
                    :disabled="guardando[s.cod]"
                    @click="guardar(s, true)"
                  >
                    Actualizar precio
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-np-ink/40 pt-1">
        Esta lista sale en vivo del catálogo de Ninesys de cada empresa (solo lo marcado ahí como servicio de
        impresión). Marcar/desmarcar acá solo cambia qué se ofrece en el selector del pedido de esta app -- no toca
        nada en Ninesys.
      </p>
    </section>
  </div>
</template>
