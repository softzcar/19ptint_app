<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";

const proyectos = ref([]);
const nombreNuevo = ref("");
const router = useRouter();

async function cargar() {
  const { data } = await api.get("/proyectos");
  proyectos.value = data;
}

async function crear() {
  const { data } = await api.post("/proyectos", { nombre: nombreNuevo.value || undefined });
  nombreNuevo.value = "";
  router.push({ name: "proyecto", params: { id: data.id } });
}

async function eliminar(id) {
  if (!confirm("¿Eliminar este proyecto y todas sus imágenes/lienzos?")) return;
  await api.delete(`/proyectos/${id}`);
  await cargar();
}

onMounted(cargar);
</script>

<template>
  <div class="max-w-4xl mx-auto p-6 sm:p-10 space-y-8">
    <div>
      <h1 class="text-xl font-bold text-np-ink">Proyectos</h1>
      <p class="text-sm text-np-ink/50">Armado de lienzos DTF y sublimación</p>
    </div>

    <div class="flex gap-2">
      <input
        v-model="nombreNuevo"
        placeholder="Nombre del proyecto nuevo"
        class="flex-1 border border-black/10 rounded-lg px-3 py-2.5 bg-white outline-none focus:ring-2 focus:ring-np-teal/40 focus:border-np-teal transition"
        @keyup.enter="crear"
      />
      <button
        class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 rounded-lg transition-colors"
        @click="crear"
      >
        Nuevo
      </button>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="p in proyectos"
        :key="p.id"
        class="bg-white rounded-xl border border-black/5 shadow-sm hover:shadow-md hover:border-np-teal/30 transition-all p-5 flex flex-col gap-1.5"
      >
        <router-link :to="{ name: 'proyecto', params: { id: p.id } }" class="font-bold text-np-ink hover:text-np-teal transition-colors">
          {{ p.nombre }}
        </router-link>
        <span class="text-xs text-np-ink/40">Actualizado {{ new Date(p.updated_at).toLocaleString() }}</span>
        <button class="text-xs text-red-600/80 hover:text-red-600 self-start mt-1" @click="eliminar(p.id)">Eliminar</button>
      </div>
      <p v-if="!proyectos.length" class="text-np-ink/40 text-sm">Todavía no hay proyectos.</p>
    </div>
  </div>
</template>
