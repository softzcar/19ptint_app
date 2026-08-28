<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";
import { EMPRESAS_NINESYS } from "../config/empresasNinesys.js";
import BrandLogo from "../components/BrandLogo.vue";

const router = useRouter();
const auth = useAuthStore();

// "telefono" -> verificar-telefono decide el siguiente paso:
//   "clave" (ya tiene acceso) | "sin_clave" (es cliente, falta pedirla) |
//   "no_registrado" (no es cliente de ninguna empresa todavía)
// "admin" es una puerta aparte, sin relación con el flujo de teléfono (ver
// CONTEXTO.md: dos logins que coexisten, no un reemplazo).
const paso = ref("telefono");

const telefono = ref("");
const password = ref("");
const error = ref("");
const cargando = ref(false);
const claveReenviada = ref(false);

async function verificarTelefono() {
  error.value = "";
  cargando.value = true;
  try {
    const { data } = await api.post("/auth/verificar-telefono", { telefono: telefono.value });
    paso.value = data.estado === "tiene_clave" ? "clave" : data.estado;
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo verificar el teléfono";
  } finally {
    cargando.value = false;
  }
}

async function loginCliente() {
  error.value = "";
  cargando.value = true;
  try {
    const { data } = await api.post("/auth/login-cliente", { telefono: telefono.value, password: password.value });
    auth.iniciarSesion(data.token, data.usuario);
    router.push({ name: "proyectos" });
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo iniciar sesión";
  } finally {
    cargando.value = false;
  }
}

async function solicitarClave() {
  error.value = "";
  cargando.value = true;
  try {
    await api.post("/auth/solicitar-clave", { telefono: telefono.value });
    claveReenviada.value = true;
    paso.value = "clave";
  } catch (e) {
    error.value = e.response?.data?.error ?? "No se pudo enviar la clave";
  } finally {
    cargando.value = false;
  }
}

function volverAEmpezar() {
  paso.value = "telefono";
  password.value = "";
  error.value = "";
  claveReenviada.value = false;
}

function linkWhatsapp(telefonoEmpresa) {
  return `https://wa.me/${telefonoEmpresa}`;
}

// --- Login de administración (email+clave) -- sin cambios de comportamiento,
// solo movido a un paso aparte del formulario. ---
const email = ref("");
async function loginAdmin() {
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

      <div class="bg-white rounded-2xl shadow-sm border border-black/5 p-8 space-y-5">
        <div class="text-center space-y-1">
          <h1 class="text-lg font-bold text-np-ink">Armado de lienzos</h1>
          <p class="text-sm text-np-ink/50">DTF · Sublimación</p>
        </div>

        <!-- Paso 1: teléfono -->
        <form v-if="paso === 'telefono'" class="space-y-5" @submit.prevent="verificarTelefono">
          <div class="space-y-1.5">
            <label class="block text-xs font-bold uppercase tracking-wide text-np-ink/60">Tu teléfono</label>
            <input
              v-model="telefono"
              type="tel"
              placeholder="0414-1234567"
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
            {{ cargando ? "Verificando..." : "Continuar" }}
          </button>
          <button type="button" class="w-full text-xs text-np-ink/40 hover:text-np-ink/70 underline" @click="paso = 'admin'">
            ¿Sos administrador? Entrá con tu email
          </button>
        </form>

        <!-- Paso 2a: ya tiene clave -->
        <form v-else-if="paso === 'clave'" class="space-y-5" @submit.prevent="loginCliente">
          <p v-if="claveReenviada" class="text-sm text-np-teal-dark bg-np-teal-light/40 border border-np-teal/30 rounded-md px-3 py-2">
            Te mandamos la clave por WhatsApp al {{ telefono }}. Puede tardar unos segundos en llegar.
          </p>
          <div class="space-y-1.5">
            <label class="block text-xs font-bold uppercase tracking-wide text-np-ink/60">Clave</label>
            <input
              v-model="password"
              type="password"
              required
              autofocus
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
          <div class="flex justify-between text-xs">
            <button type="button" class="text-np-ink/40 hover:text-np-ink/70 underline" @click="volverAEmpezar">
              No es mi teléfono
            </button>
            <button type="button" class="text-np-teal hover:text-np-teal-dark underline font-medium" @click="solicitarClave" :disabled="cargando">
              Olvidé mi clave
            </button>
          </div>
        </form>

        <!-- Paso 2b: es cliente pero nunca pidió acceso -->
        <div v-else-if="paso === 'sin_clave'" class="space-y-5">
          <p class="text-sm text-np-ink/70">
            Ya sos cliente, pero todavía no tenés una clave para entrar acá. Te la mandamos por WhatsApp al
            <strong>{{ telefono }}</strong>.
          </p>
          <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
          <button
            type="button"
            :disabled="cargando"
            class="w-full bg-np-teal hover:bg-np-teal-dark text-white font-bold uppercase tracking-wide text-sm rounded-lg py-3 transition-colors disabled:opacity-50"
            @click="solicitarClave"
          >
            {{ cargando ? "Enviando..." : "Enviar clave por WhatsApp" }}
          </button>
          <button type="button" class="w-full text-xs text-np-ink/40 hover:text-np-ink/70 underline" @click="volverAEmpezar">
            Volver
          </button>
        </div>

        <!-- Paso 2c: no es cliente de ninguna empresa todavía -->
        <div v-else-if="paso === 'no_registrado'" class="space-y-4">
          <p class="text-sm text-np-ink/70">
            No encontramos ese teléfono como cliente. Escribile a la empresa que te convenga para que te den de alta:
          </p>
          <div class="space-y-2">
            <a
              v-for="e in EMPRESAS_NINESYS"
              :key="e.id"
              :href="linkWhatsapp(e.telefono)"
              target="_blank"
              rel="noopener"
              class="flex items-center justify-between border border-black/10 rounded-lg px-3 py-2.5 hover:border-np-teal/40 hover:bg-np-teal-light/20 transition-colors"
            >
              <span class="text-sm font-medium text-np-ink">{{ e.nombre }}</span>
              <span class="text-xs text-np-teal-dark">WhatsApp →</span>
            </a>
          </div>
          <button type="button" class="w-full text-xs text-np-ink/40 hover:text-np-ink/70 underline" @click="volverAEmpezar">
            Volver
          </button>
        </div>

        <!-- Puerta de administración: email+clave, comportamiento sin cambios -->
        <form v-else-if="paso === 'admin'" class="space-y-5" @submit.prevent="loginAdmin">
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
          <button type="button" class="w-full text-xs text-np-ink/40 hover:text-np-ink/70 underline" @click="paso = 'telefono'; error = ''">
            Volver
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
