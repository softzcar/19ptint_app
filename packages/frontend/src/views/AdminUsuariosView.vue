<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";

const router = useRouter();
const auth = useAuthStore();

const usuarios = ref([]);
const error = ref("");
const cargando = ref(true);

const nuevoForm = ref({ nombre: "", email: "", password: "", rol: "cliente", limite_diario: "" });
const creando = ref(false);

async function cargar() {
  cargando.value = true;
  try {
    const { data } = await api.get("/admin/usuarios");
    usuarios.value = data;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo cargar la lista de usuarios";
  } finally {
    cargando.value = false;
  }
}

async function crear() {
  error.value = "";
  creando.value = true;
  try {
    await api.post("/admin/usuarios", nuevoForm.value);
    nuevoForm.value = { nombre: "", email: "", password: "", rol: "cliente", limite_diario: "" };
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo crear el usuario";
  } finally {
    creando.value = false;
  }
}

async function toggleActivo(u) {
  try {
    const { data } = await api.patch(`/admin/usuarios/${u.id}`, { activo: !u.activo });
    u.activo = data.activo;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo actualizar";
    await cargar();
  }
}

async function actualizarLimite(u) {
  try {
    await api.patch(`/admin/usuarios/${u.id}`, {
      limite_diario: u.limite_diario === "" ? null : Number(u.limite_diario),
    });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo actualizar el límite";
  }
}

async function actualizarRol(u) {
  try {
    await api.patch(`/admin/usuarios/${u.id}`, { rol: u.rol });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo actualizar el rol";
    await cargar();
  }
}

async function eliminar(u) {
  if (!confirm(`¿Eliminar a ${u.nombre} (${u.email}) y todos sus proyectos?`)) return;
  try {
    await api.delete(`/admin/usuarios/${u.id}`);
    await cargar();
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo eliminar";
  }
}

onMounted(() => {
  if (auth.usuario?.rol !== "admin") {
    router.replace({ name: "proyectos" });
    return;
  }
  cargar();
});
</script>

<template>
  <div class="max-w-4xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">Usuarios</h1>
      <p class="text-sm text-np-ink/50">Alta, baja y límite diario de procesamientos por usuario.</p>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Nuevo usuario</h2>
      <div class="grid sm:grid-cols-5 gap-3 items-end">
        <label class="text-sm text-np-ink/60">
          Nombre
          <input v-model="nuevoForm.nombre" class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40" />
        </label>
        <label class="text-sm text-np-ink/60">
          Email
          <input v-model="nuevoForm.email" type="email" class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40" />
        </label>
        <label class="text-sm text-np-ink/60">
          Clave
          <input v-model="nuevoForm.password" type="text" class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40" />
        </label>
        <label class="text-sm text-np-ink/60">
          Rol
          <select v-model="nuevoForm.rol" class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40">
            <option value="cliente">Cliente</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label class="text-sm text-np-ink/60">
          Límite diario
          <input v-model="nuevoForm.limite_diario" type="number" min="1" placeholder="Sin límite" class="w-full border border-black/10 rounded-md px-2 py-1.5 mt-1 focus:outline-none focus:ring-2 focus:ring-np-teal/40" />
        </label>
      </div>
      <button
        class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        :disabled="creando || !nuevoForm.nombre || !nuevoForm.email || !nuevoForm.password"
        @click="crear"
      >
        {{ creando ? "Creando..." : "Crear usuario" }}
      </button>
    </section>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Usuarios ({{ usuarios.length }})</h2>
      <p v-if="cargando" class="text-sm text-np-ink/40">Cargando...</p>

      <div v-else class="overflow-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-np-ink/40 uppercase tracking-wide border-b border-black/5">
              <th class="py-2 pr-3">Usuario</th>
              <th class="py-2 pr-3">Rol</th>
              <th class="py-2 pr-3">Activo</th>
              <th class="py-2 pr-3">Uso hoy</th>
              <th class="py-2 pr-3">Límite diario</th>
              <th class="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in usuarios" :key="u.id" class="border-b border-black/5 last:border-0">
              <td class="py-2 pr-3">
                <p class="font-medium text-np-ink">{{ u.nombre }}</p>
                <p class="text-xs text-np-ink/40">{{ u.email }}</p>
              </td>
              <td class="py-2 pr-3">
                <select
                  v-model="u.rol"
                  :disabled="u.id === auth.usuario.id"
                  class="border border-black/10 rounded px-1.5 py-1 text-xs disabled:bg-np-paper"
                  @change="actualizarRol(u)"
                >
                  <option value="cliente">Cliente</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td class="py-2 pr-3">
                <button
                  class="px-2 py-1 rounded-full text-xs font-medium transition-colors"
                  :class="u.activo ? 'bg-np-teal-light text-np-teal-dark' : 'bg-red-100 text-red-700'"
                  :disabled="u.id === auth.usuario.id"
                  @click="toggleActivo(u)"
                >
                  {{ u.activo ? "Activo" : "Inactivo" }}
                </button>
              </td>
              <td class="py-2 pr-3 text-np-ink/70">
                {{ u.usados_hoy }}<span v-if="u.limite_diario"> / {{ u.limite_diario }}</span>
              </td>
              <td class="py-2 pr-3">
                <input
                  v-model="u.limite_diario"
                  type="number"
                  min="1"
                  placeholder="Sin límite"
                  class="w-24 border border-black/10 rounded px-1.5 py-1 text-xs"
                  @change="actualizarLimite(u)"
                />
              </td>
              <td class="py-2 pr-3 text-right">
                <button
                  v-if="u.id !== auth.usuario.id"
                  class="text-red-600/70 hover:text-red-600 text-xs transition-colors"
                  @click="eliminar(u)"
                >
                  Eliminar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
