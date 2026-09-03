<script setup>
import { ref, watch, onMounted, computed } from "vue";
import { api } from "../../lib/api.js";
import { useAuthStore } from "../../stores/auth.js";
import { PAISES, ESTADOS_POR_PAIS, CIUDADES_POR_ESTADO } from "../../lib/venezuelaGeo.js";

const props = defineProps({ idEmpresa: { type: Number, required: true } });
const emit = defineEmits(["confirmado"]);
const auth = useAuthStore();

const texto = ref("");
const resultados = ref([]);
const buscando = ref(false);
let debounceTimer = null;

// Antes de mostrar la búsqueda manual, se intenta enlazar directo con el
// cliente de Ninesys de esta cuenta (ver ninesys.js /clientes/auto -- se
// matchea por cédula, no por email: Ninesys no indexa email en su búsqueda)
// -- si hay exactamente uno, se salta el paso de buscar y el usuario solo
// confirma los datos. Si no hay match (o el backend lo descarta por
// ambiguo), sigue el flujo de siempre sin que se note que se intentó.
const verificandoAuto = ref(true);
onMounted(async () => {
  try {
    const { data } = await api.get(`/ninesys/${props.idEmpresa}/clientes/auto`);
    if (data.cliente) {
      elegirExistente(data.cliente);
      return;
    }
  } catch {
    // silencioso -- si falla, el usuario busca a mano como siempre
  } finally {
    verificandoAuto.value = false;
  }
});

const form = ref(vacio());
const editando = ref(false);
const guardando = ref(false);
const error = ref("");
const errorDuplicado = ref(null); // { message, customer }

// pais/estado/ciudad: PENDIENTE DE SINCRONIZAR con el contrato real de
// Ninesys (POST /customers no los soporta todavía, ver CONTEXTO.md) --
// mientras tanto viajan igual en el payload y el backend los guarda como
// copia congelada en Lienzo.cliente_pais/estado/ciudad, más los pliega al
// texto de "address" que sí llega a Ninesys, para no perder el dato.
function vacio() {
  const [first_name, ...resto] = (auth.usuario?.nombre ?? "").split(" ");
  return {
    id: null,
    first_name: first_name ?? "",
    last_name: resto.join(" "),
    cedula: auth.usuario?.cedula ?? "",
    phone: "",
    email: auth.usuario?.email ?? "",
    address: auth.usuario?.direccion ?? "",
    pais: "Venezuela",
    estado: "",
    ciudad: "",
  };
}

const estadosDisponibles = computed(() => ESTADOS_POR_PAIS[form.value.pais] ?? []);
const ciudadesDisponibles = computed(() => CIUDADES_POR_ESTADO[form.value.estado] ?? []);

// Cambiar de estado invalida la ciudad ya elegida (es de OTRO estado) --
// mismo comportamiento cascada que el formulario real de Ninesys (ver
// captura en CONTEXTO.md).
watch(
  () => form.value.estado,
  (nuevoEstado, anterior) => {
    if (anterior !== undefined && form.value.ciudad && !CIUDADES_POR_ESTADO[nuevoEstado]?.includes(form.value.ciudad)) {
      form.value.ciudad = "";
    }
  }
);

watch(texto, (valor) => {
  clearTimeout(debounceTimer);
  errorDuplicado.value = null;
  if (valor.trim().length < 2) {
    resultados.value = [];
    return;
  }
  debounceTimer = setTimeout(async () => {
    buscando.value = true;
    try {
      const { data } = await api.get(`/ninesys/${props.idEmpresa}/clientes`, { params: { buscar: valor.trim() } });
      resultados.value = data.data ?? [];
    } finally {
      buscando.value = false;
    }
  }, 300);
});

function elegirExistente(cliente) {
  form.value = {
    id: cliente.id ?? cliente._id,
    first_name: cliente.first_name ?? "",
    last_name: cliente.last_name ?? "",
    cedula: cliente.cedula ?? "",
    phone: cliente.phone ?? "",
    email: cliente.email ?? "",
    address: cliente.address ?? "",
    // Ninesys no devuelve estos 3 todavía (ver nota de vacio() arriba) --
    // un cliente ya existente en Ninesys arranca sin país/estado/ciudad
    // hasta que el staff los complete acá.
    pais: cliente.pais ?? "Venezuela",
    estado: cliente.estado ?? "",
    ciudad: cliente.ciudad ?? "",
  };
  resultados.value = [];
  texto.value = "";
  editando.value = true;
}

function clienteNuevo() {
  form.value = vacio();
  resultados.value = [];
  texto.value = "";
  editando.value = true;
}

async function guardar() {
  guardando.value = true;
  error.value = "";
  errorDuplicado.value = null;
  try {
    const payload = { ...form.value };
    delete payload.id;
    const { data } = form.value.id
      ? await api.put(`/ninesys/${props.idEmpresa}/clientes/${form.value.id}`, payload)
      : await api.post(`/ninesys/${props.idEmpresa}/clientes`, payload);

    const clienteFinal = { ...form.value, id: form.value.id ?? data?.id };
    emit("confirmado", clienteFinal);
  } catch (err) {
    if (err.response?.status === 409 && err.response.data?.code === "phone_duplicate") {
      errorDuplicado.value = err.response.data;
    } else {
      error.value = err.response?.data?.error ?? "No se pudo guardar el cliente";
    }
  } finally {
    guardando.value = false;
  }
}

function usarClienteDuplicado() {
  elegirExistente(errorDuplicado.value.customer);
  errorDuplicado.value = null;
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-np-ink/60">Cliente</p>

    <p v-if="verificandoAuto" class="text-sm text-np-ink/40">Verificando cliente…</p>

    <template v-else-if="!editando">
      <input
        v-model="texto"
        type="text"
        placeholder="Buscar por nombre, cédula o teléfono…"
        class="w-full border border-black/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-np-teal/40"
      />
      <p v-if="buscando" class="text-xs text-np-ink/40">Buscando…</p>
      <ul v-if="resultados.length" class="border border-black/10 rounded-md divide-y divide-black/5 max-h-48 overflow-y-auto">
        <li
          v-for="c in resultados"
          :key="c.id"
          class="px-3 py-2 text-sm hover:bg-np-teal-light cursor-pointer"
          @click="elegirExistente(c)"
        >
          {{ c.first_name }} {{ c.last_name }} — {{ c.phone }}
          <span v-if="c.cedula" class="text-np-ink/40">(CI {{ c.cedula }})</span>
        </li>
      </ul>
      <button type="button" class="text-sm text-np-teal underline" @click="clienteNuevo">
        No lo encuentro / cliente nuevo
      </button>
    </template>

    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input v-model="form.first_name" placeholder="Nombre" class="border border-black/10 rounded-md px-2 py-1.5" />
        <input v-model="form.last_name" placeholder="Apellido" class="border border-black/10 rounded-md px-2 py-1.5" />
        <input v-model="form.cedula" placeholder="Cédula" class="border border-black/10 rounded-md px-2 py-1.5" />
        <input v-model="form.phone" placeholder="Teléfono (WhatsApp)" required class="border border-black/10 rounded-md px-2 py-1.5" />
        <input v-model="form.email" placeholder="Email" class="border border-black/10 rounded-md px-2 py-1.5" />
        <input v-model="form.address" placeholder="Dirección" class="border border-black/10 rounded-md px-2 py-1.5 sm:col-span-2" />

        <select v-model="form.pais" class="border border-black/10 rounded-md px-2 py-1.5 bg-white">
          <option v-for="p in PAISES" :key="p" :value="p">{{ p }}</option>
        </select>
        <select v-model="form.estado" class="border border-black/10 rounded-md px-2 py-1.5 bg-white">
          <option value="" disabled>Seleccione un estado</option>
          <option v-for="e in estadosDisponibles" :key="e" :value="e">{{ e }}</option>
        </select>
        <select v-model="form.ciudad" class="border border-black/10 rounded-md px-2 py-1.5 bg-white sm:col-span-2" :disabled="!form.estado">
          <option value="" disabled>Seleccione una ciudad</option>
          <option v-for="c in ciudadesDisponibles" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>

      <p v-if="errorDuplicado" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
        Ya existe un cliente con ese teléfono ({{ errorDuplicado.customer?.first_name }}
        {{ errorDuplicado.customer?.last_name }}).
        <button type="button" class="underline font-bold" @click="usarClienteDuplicado">Usar ese cliente</button>
      </p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <div class="flex gap-2">
        <button
          type="button"
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-4 py-2 rounded-lg disabled:opacity-50"
          :disabled="guardando || !form.first_name || !form.phone"
          @click="guardar"
        >
          {{ guardando ? "Guardando…" : "Confirmar cliente" }}
        </button>
        <button type="button" class="text-sm text-np-ink/50 underline" @click="editando = false">Volver a buscar</button>
      </div>
    </template>
  </div>
</template>
