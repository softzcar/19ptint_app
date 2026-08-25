<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";

const router = useRouter();
const auth = useAuthStore();

const agentes = ref([]);
const error = ref("");
const cargando = ref(true);
const generando = ref({});

// Token recién generado. Se muestra una sola vez (en la base solo queda el
// sha256), así que se mantiene en pantalla hasta que el usuario lo cierre a
// mano -- nunca se descarta solo ni se pierde por recargar la tabla.
const tokenNuevo = ref(null);
const copiado = ref(false);

// El agente hace ping en cada consulta (~20s, ver /api/agente/config). Con 3
// intervalos de margen se tolera un sondeo perdido sin cantar "desconectado"
// por un hipo de red.
const MARGEN_EN_LINEA_MS = 60_000;
const ahora = ref(Date.now());
let reloj = null;

function enLinea(agente) {
  if (!agente.ultimo_ping) return false;
  return ahora.value - new Date(agente.ultimo_ping).getTime() < MARGEN_EN_LINEA_MS;
}

function haceCuanto(fecha) {
  if (!fecha) return "nunca";
  const seg = Math.max(0, Math.round((ahora.value - new Date(fecha).getTime()) / 1000));
  if (seg < 60) return `hace ${seg}s`;
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

async function cargar() {
  cargando.value = true;
  try {
    const { data } = await api.get("/admin/agentes");
    agentes.value = data;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo cargar la lista de agentes";
  } finally {
    cargando.value = false;
  }
}

async function generarToken(agente) {
  if (agente.tiene_token) {
    const ok = confirm(
      `${agente.nombre} ya tiene un token configurado.\n\n` +
        `Generar uno nuevo DESCONECTA al instante la PC que está usando el actual, ` +
        `y hay que volver a configurarla con el token nuevo.\n\n¿Continuar?`
    );
    if (!ok) return;
  }

  error.value = "";
  generando.value = { ...generando.value, [agente.id]: true };
  try {
    const { data } = await api.post(`/admin/agentes/${agente.id}/token`);
    tokenNuevo.value = data;
    copiado.value = false;
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo generar el token";
  } finally {
    const { [agente.id]: _quitado, ...resto } = generando.value;
    generando.value = resto;
  }
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(tokenNuevo.value.token);
    copiado.value = true;
  } catch {
    // Sin permiso de portapapeles (o contexto no seguro): el token igual está
    // visible y se puede seleccionar a mano, así que no es un error fatal.
    copiado.value = false;
    error.value = "No se pudo copiar automáticamente: seleccionalo y copialo a mano.";
  }
}

async function toggleActivo(agente) {
  try {
    const { data } = await api.patch(`/admin/agentes/${agente.id}`, { activo: !agente.activo });
    agente.activo = data.activo;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo actualizar";
    await cargar();
  }
}

onMounted(() => {
  if (auth.usuario?.rol !== "admin") {
    router.replace({ name: "proyectos" });
    return;
  }
  cargar();
  // Refresca el "hace cuánto" y el estado en línea sin recargar la página.
  reloj = setInterval(() => {
    ahora.value = Date.now();
    if (!tokenNuevo.value) cargar();
  }, 15_000);
});
onUnmounted(() => clearInterval(reloj));
</script>

<template>
  <div class="max-w-4xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">Agentes de escritorio</h1>
      <p class="text-sm text-np-ink/50">
        La PC de producción de cada empresa baja sola los lienzos apenas se confirma el pedido.
      </p>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <section v-if="tokenNuevo" class="bg-np-teal-light/40 rounded-xl border-2 border-np-teal p-5 sm:p-6 space-y-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-sm font-bold text-np-teal-dark">Token de {{ tokenNuevo.empresa }}</h2>
          <p class="text-xs text-np-ink/60 mt-0.5">{{ tokenNuevo.aviso }}</p>
        </div>
        <button class="text-np-ink/40 hover:text-np-ink text-sm" @click="tokenNuevo = null">Cerrar</button>
      </div>

      <div class="flex gap-2">
        <code class="flex-1 bg-white rounded-lg px-3 py-2.5 text-xs font-mono break-all select-all border border-np-teal/30">
          {{ tokenNuevo.token }}
        </code>
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-xs uppercase tracking-wide px-4 rounded-lg transition-colors whitespace-nowrap"
          @click="copiar"
        >
          {{ copiado ? "Copiado ✓" : "Copiar" }}
        </button>
      </div>

      <p class="text-xs text-np-ink/50">
        Pegalo en la configuración del agente instalado en la PC de esa empresa. Es lo único que necesita: con el
        token ya sabe a qué empresa pertenece y qué lienzos le tocan.
      </p>
    </section>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Empresas ({{ agentes.length }})</h2>
      <p v-if="cargando" class="text-sm text-np-ink/40">Cargando...</p>

      <div v-else class="overflow-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-np-ink/40 uppercase tracking-wide border-b border-black/5">
              <th class="py-2 pr-3">Empresa</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">En cola</th>
              <th class="py-2 pr-3">Token</th>
              <th class="py-2 pr-3">Habilitado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in agentes" :key="a.id" class="border-b border-black/5 last:border-0">
              <td class="py-2.5 pr-3">
                <p class="font-medium text-np-ink">{{ a.nombre }}</p>
                <p class="text-xs text-np-ink/40">Empresa {{ a.id_empresa_ninesys }}</p>
              </td>

              <td class="py-2.5 pr-3">
                <span
                  class="inline-block px-2 py-1 rounded-full text-xs font-medium"
                  :class="enLinea(a) ? 'bg-np-teal-light text-np-teal-dark' : 'bg-np-paper text-np-ink/50'"
                >
                  {{ enLinea(a) ? "En línea" : a.ultimo_ping ? "Desconectado" : "Nunca conectado" }}
                </span>
                <p v-if="a.ultimo_ping" class="text-xs text-np-ink/40 mt-0.5">
                  {{ haceCuanto(a.ultimo_ping) }}<span v-if="a.version_agente"> · v{{ a.version_agente }}</span>
                </p>
              </td>

              <td class="py-2.5 pr-3">
                <span :class="a.pendientes ? 'text-np-ink font-medium' : 'text-np-ink/40'">
                  {{ a.pendientes }} lienzo(s)
                </span>
              </td>

              <td class="py-2.5 pr-3">
                <div class="flex items-center gap-2">
                  <span class="text-xs" :class="a.tiene_token ? 'text-np-ink/60' : 'text-np-ink/40'">
                    {{ a.tiene_token ? "Configurado" : "Sin generar" }}
                  </span>
                  <button
                    class="text-np-teal hover:text-np-teal-dark text-xs font-medium transition-colors disabled:opacity-40"
                    :disabled="generando[a.id]"
                    @click="generarToken(a)"
                  >
                    {{ generando[a.id] ? "Generando..." : a.tiene_token ? "Regenerar" : "Generar" }}
                  </button>
                </div>
              </td>

              <td class="py-2.5 pr-3">
                <button
                  class="px-2 py-1 rounded-full text-xs font-medium transition-colors"
                  :class="a.activo ? 'bg-np-teal-light text-np-teal-dark' : 'bg-red-100 text-red-700'"
                  @click="toggleActivo(a)"
                >
                  {{ a.activo ? "Sí" : "No" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-np-ink/40 pt-1">
        Deshabilitar una empresa corta el acceso de su PC al instante, sin borrar el token.
      </p>
    </section>
  </div>
</template>
