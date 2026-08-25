<script setup>
import { useAuthStore } from "./stores/auth.js";
import { useRouter } from "vue-router";
import BrandLogo from "./components/BrandLogo.vue";

const auth = useAuthStore();
const router = useRouter();

function salir() {
  auth.cerrarSesion();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header v-if="auth.autenticado" class="bg-np-ink px-6 py-3.5 flex items-center justify-between">
      <router-link :to="{ name: 'proyectos' }">
        <BrandLogo variant="dark" size="sm" />
      </router-link>
      <div class="flex items-center gap-4 text-sm text-white/80">
        <router-link v-if="auth.usuario?.rol === 'admin'" :to="{ name: 'admin-usuarios' }" class="hover:text-np-amber transition-colors">
          Usuarios
        </router-link>
        <router-link v-if="auth.usuario?.rol === 'admin'" :to="{ name: 'admin-agentes' }" class="hover:text-np-amber transition-colors">
          Agentes
        </router-link>
        <router-link :to="{ name: 'perfil' }" class="hover:text-np-amber transition-colors">{{ auth.usuario?.nombre }}</router-link>
        <button class="text-white hover:text-np-amber transition-colors" @click="salir">Salir</button>
      </div>
    </header>
    <main class="flex-1">
      <router-view />
    </main>
  </div>
</template>
