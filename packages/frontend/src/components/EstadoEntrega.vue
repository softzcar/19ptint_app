<script setup>
import { computed } from "vue";

/**
 * Estado de la entrega del lienzo a la PC de producción de la empresa.
 *
 * Solo se muestra si el pedido ya fue confirmado: antes de eso no se sabe a
 * qué empresa le toca imprimir, así que no hay entrega que reportar (ver
 * routes/ninesys.js, donde se crea).
 */
const props = defineProps({
  entrega: { type: Object, default: null },
  ahora: { type: Number, required: true },
});

// Mismo margen que usa el panel de admin: 3 sondeos del agente (20s) antes de
// darlo por desconectado, para no alarmar por un hipo de red.
const MARGEN_EN_LINEA_MS = 60_000;

const agenteEnLinea = computed(() => {
  const ping = props.entrega?.empresa_agente?.ultimo_ping;
  return ping ? props.ahora - new Date(ping).getTime() < MARGEN_EN_LINEA_MS : false;
});

function haceCuanto(fecha) {
  if (!fecha) return "";
  const seg = Math.max(0, Math.round((props.ahora - new Date(fecha).getTime()) / 1000));
  if (seg < 60) return `hace ${seg}s`;
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

const empresa = computed(() => props.entrega?.empresa_agente?.nombre ?? "la empresa");

const vista = computed(() => {
  const e = props.entrega;
  if (!e) return null;

  if (e.estado === "entregado") {
    return {
      tono: "ok",
      icono: "✓",
      titulo: `Descargado en la PC de ${empresa.value}`,
      detalle: e.purgado_en
        ? `${haceCuanto(e.entregado_en)}. El archivo ya se liberó del servidor: si hace falta de nuevo, se regenera desde el diseño.`
        : `${haceCuanto(e.entregado_en)}. Ya está en el disco, listo para imprimir.`,
    };
  }

  if (e.estado === "error") {
    return {
      tono: "mal",
      icono: "!",
      titulo: "Hubo un problema al bajarlo",
      detalle: `${e.ultimo_error ?? "sin detalle"} (${e.intentos} intento/s). Se reintenta solo en el próximo ciclo.`,
    };
  }

  // pendiente
  if (!e.empresa_agente?.activo) {
    return {
      tono: "aviso",
      icono: "…",
      titulo: `En cola para ${empresa.value}`,
      detalle: "El agente de esa empresa está deshabilitado. Habilitalo en Agentes para que empiece a bajarlo.",
    };
  }
  if (!e.empresa_agente?.ultimo_ping) {
    return {
      tono: "aviso",
      icono: "…",
      titulo: `En cola para ${empresa.value}`,
      detalle: "Todavía no se instaló el agente en esa PC. Queda guardado y se baja apenas se conecte.",
    };
  }
  if (!agenteEnLinea.value) {
    return {
      tono: "aviso",
      icono: "…",
      titulo: `En cola para ${empresa.value}`,
      detalle: `La PC está desconectada (última señal ${haceCuanto(e.empresa_agente.ultimo_ping)}). Se baja sola cuando vuelva a encenderse.`,
    };
  }
  return {
    tono: "neutro",
    icono: "↓",
    titulo: `Enviándose a la PC de ${empresa.value}`,
    detalle: "El agente está conectado y lo baja en unos segundos.",
  };
});

const ESTILOS = {
  ok: "bg-np-teal-light/50 border-np-teal/30 text-np-teal-dark",
  aviso: "bg-amber-50 border-amber-200 text-amber-800",
  mal: "bg-red-50 border-red-200 text-red-800",
  neutro: "bg-np-paper border-black/10 text-np-ink/70",
};
</script>

<template>
  <div v-if="vista" class="rounded-lg border px-3.5 py-2.5 flex gap-2.5 items-start" :class="ESTILOS[vista.tono]">
    <span class="font-bold leading-5">{{ vista.icono }}</span>
    <div class="text-sm">
      <p class="font-semibold">{{ vista.titulo }}</p>
      <p class="text-xs opacity-80 mt-0.5">{{ vista.detalle }}</p>
    </div>
  </div>
</template>
