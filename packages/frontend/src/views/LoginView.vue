<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";
import BrandLogo from "../components/BrandLogo.vue";

const email = ref("");
const password = ref("");
const error = ref("");
const cargando = ref(false);
const router = useRouter();
const auth = useAuthStore();

async function enviar() {
  error.value = "";
  cargando.value = true;
  try {
    const { data } = await api.post("/auth/login", { email: email.value, password: password.value });
    auth.iniciarSesion(data.token, data.usuario);
    router.push({ name: "proyectos" });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo iniciar sesión";
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-np-paper px-4">
    <div class="w-full max-w-sm space-y-8">
      <div class="flex justify-center">
        <BrandLogo size="lg" />
      </div>

      <form class="bg-white rounded-2xl shadow-sm border border-black/5 p-8 space-y-5" @submit.prevent="enviar">
        <div class="text-center space-y-1">
          <h1 class="text-lg font-bold text-np-ink">Armado de lienzos</h1>
          <p class="text-sm text-np-ink/50">DTF · Sublimación</p>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-bold uppercase tracking-wide text-np-ink/60">Usuario (email)</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full border border-black/10 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
          />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-bold uppercase tracking-wide text-np-ink/60">Clave</label>
          <input
            v-model="password"
            type="password"
            required
            class="w-full border border-black/10 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
          />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button
          type="submit"
          :disabled="cargando"
          class="w-full bg-np-teal hover:bg-np-teal-dark text-white font-bold uppercase tracking-wide text-sm rounded-lg py-3 transition-colors disabled:opacity-50"
        >
          {{ cargando ? "Ingresando..." : "Ingresar" }}
        </button>
      </form>
    </div>
  </div>
</template>
