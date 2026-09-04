<script setup>
import { useAuthStore } from "./stores/auth.js";
import { useRouter } from "vue-router";
import BrandLogo from "./components/BrandLogo.vue";

const auth = useAuthStore();
const router = useRouter();

async function salir() {
  await auth.cerrarSesion();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Marca unificada (ver plan "unificar la forma grafica") -- mismo
    degradado que ya usaba el header de system-nesting (0F6E56 -> 08402F);
    clasificador-disenos ahora también lo usa (ver _nav.html) -- las 3 apps
    comparten exactamente este mismo fondo de header. -->
    <header
      v-if="auth.autenticado"
      class="px-6 py-3.5 flex items-center justify-between"
      style="background: linear-gradient(135deg, #0F6E56 0%, #08402F 100%)"
    >
      <router-link :to="{ name: 'proyectos' }">
        <BrandLogo variant="dark" size="sm" />
      </router-link>
      <div class="flex items-center gap-4 text-sm text-white/80">
        <!-- Unificación (ver plan) -- pedido real: "solo veo la app de dtf, no
        veo clasificacion de disenos, y sistem nesting no estan en ningun
        lugar". Links externos a propósito (<a>, no router-link) -- son
        apps aparte, en otro dominio, comparten sesión vía la cookie
        compartida (ninesys_session) pero no el router de esta SPA. -->
        <a href="https://sublima.nineteengreen.com/disenar" class="hover:text-np-amber transition-colors">Diseñar</a>
        <a href="https://sublima.nineteengreen.com/catalogo" class="hover:text-np-amber transition-colors">Catálogo</a>
        <a href="https://sublima.nineteengreen.com/nesting-app/" class="hover:text-np-amber transition-colors">Nesting</a>
        <span class="border-l border-white/20 h-4"></span>
        <router-link v-if="auth.usuario?.rol === 'admin'" :to="{ name: 'admin-usuarios' }" class="hover:text-np-amber transition-colors">
          Usuarios
        </router-link>
        <router-link v-if="auth.usuario?.rol === 'admin'" :to="{ name: 'admin-agentes' }" class="hover:text-np-amber transition-colors">
          Agentes
        </router-link>
        <router-link v-if="auth.usuario?.rol === 'admin'" :to="{ name: 'admin-servicios' }" class="hover:text-np-amber transition-colors">
          Servicios
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
