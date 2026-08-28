<script setup>
import { ref } from "vue";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const form = ref({
  nombre: auth.usuario?.nombre ?? "",
  cedula: auth.usuario?.cedula ?? "",
  direccion: auth.usuario?.direccion ?? "",
});
const guardando = ref(false);
const guardado = ref(false);
const error = ref("");

async function guardar() {
  guardando.value = true;
  guardado.value = false;
  error.value = "";
  try {
    const { data } = await api.patch("/auth/perfil", form.value);
    auth.actualizarUsuario(data);
    guardado.value = true;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo guardar";
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto p-6 sm:p-10 space-y-6">
    <div>
      <router-link :to="{ name: 'proyectos' }" class="text-sm text-np-ink/40 hover:text-np-teal transition-colors">
        &larr; Proyectos
      </router-link>
      <h1 class="text-2xl font-bold text-np-ink mt-1">Mi perfil</h1>
      <p class="text-sm text-np-ink/50">
        Estos datos se usan para generar el pedido por WhatsApp — complételos antes de enviar su primer pedido.
      </p>
    </div>

    <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
      <label class="block text-sm text-np-ink/60">
        Nombre y apellido
        <input v-model="form.nombre" class="w-full border border-black/10 rounded-lg px-3 py-2 mt-1 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition" />
      </label>
      <label class="block text-sm text-np-ink/60">
        Cédula
        <input v-model="form.cedula" placeholder="V-12345678" class="w-full border border-black/10 rounded-lg px-3 py-2 mt-1 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition" />
      </label>
      <label class="block text-sm text-np-ink/60">
        Dirección <span class="text-np-ink/30">(opcional)</span>
        <input v-model="form.direccion" class="w-full border border-black/10 rounded-lg px-3 py-2 mt-1 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition" />
      </label>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <p v-if="guardado" class="text-sm text-np-teal">Guardado.</p>
      <button
        class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        :disabled="guardando"
        @click="guardar"
      >
        {{ guardando ? "Guardando..." : "Guardar" }}
      </button>
    </section>
  </div>
</template>
