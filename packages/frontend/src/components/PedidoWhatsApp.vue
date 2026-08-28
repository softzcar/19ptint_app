<script setup>
import { computed, ref } from "vue";
import { api } from "../lib/api.js";
import { construirMensajeConfirmacion } from "../lib/mensajeWhatsapp.js";
import PedidoEmpresaSelector from "./pedido/PedidoEmpresaSelector.vue";
import PedidoServicioSelector from "./pedido/PedidoServicioSelector.vue";
import PedidoClienteBuscador from "./pedido/PedidoClienteBuscador.vue";

// Uno o varios lienzos ya armados en UN mismo presupuesto: cada lienzo pasa
// a ser una línea de producto separada (propia cantidad, propia tela si es
// sublimación) y Ninesys ve un solo total que las suma todas (ver
// routes/ninesys.js). El caller (LienzoView.vue para uno solo,
// ProyectoDetalleView.vue para varios elegidos con checkbox) es quien
// decide qué lienzos entran acá -- siempre deberían venir sin presupuesto
// previo.
const props = defineProps({ lienzos: { type: Array, required: true } });

// Pasos del wizard: empresa -> servicio -> cliente -> confirmar -> resultado.
// Reemplaza el flujo anterior (wa.me con catálogo hardcodeado) por llamadas
// reales a ninesys-api/msg_ninesys -- ver plan de integración.
const yaEnviado = props.lienzos.find((l) => l.id_presupuesto_ninesys);
const paso = ref(yaEnviado ? "yaEnviado" : "empresa");
const idEmpresa = ref(null);
const servicio = ref(null);
const cliente = ref(null);
const enviando = ref(false);
const resultado = ref(null); // { idPresupuesto, whatsappEnviado, whatsappMotivo? }
const errorGeneral = ref("");

// Metros crudos (sin redondear) por lienzo -- alto_usado_mm ya puede traer
// decimales de sobra (ver el 3% de desperdicio en routes/lienzos.js).
// cantidadFacturada con .toFixed(2) es solo para MOSTRAR, nunca para
// calcular sobre ella: perder el tercer decimal ahí adentro rompía el
// redondeo (3.001m truncaba a "3.00" antes de decidir si pasaba al
// siguiente décimo).
const desglose = computed(() =>
  props.lienzos.map((l) => {
    const metrosCrudos = Number(l.alto_usado_mm) / 1000;
    // Ninesys factura en decímetros -- presupuestos_productos.cantidad es
    // INTEGER, no admite fracciones de metro directo (ver routes/ninesys.js).
    // Mismo redondeo que el backend: al décimo de metro, no al metro entero
    // (eso sobrefacturaba de más: 3.001m pasaba a cobrarse como 4 metros).
    const cantidadFacturada = Math.ceil(metrosCrudos * 10) / 10;
    return { lienzo: l, metrosCrudos, cantidadFacturada };
  })
);
const cantidadFacturadaTotal = computed(() => desglose.value.reduce((suma, d) => suma + d.cantidadFacturada, 0));
const total = computed(() => (servicio.value ? servicio.value.precio * cantidadFacturadaTotal.value : 0));

function elegirEmpresa(id) {
  idEmpresa.value = id;
  servicio.value = null;
  paso.value = "servicio";
}

function elegirServicio(s) {
  servicio.value = s;
  if (s) paso.value = "cliente";
}

function confirmarCliente(c) {
  cliente.value = c;
  paso.value = "confirmar";
}

// Un solo lienzo: al diseño puntual. Varios: al proyecto (no hay una URL de
// "diseño" única cuando son varios archivos distintos).
function urlDestino() {
  if (props.lienzos.length === 1) return `${window.location.origin}/lienzos/${props.lienzos[0].id}`;
  return `${window.location.origin}/proyectos/${props.lienzos[0].proyecto_id}`;
}

async function enviarPedido() {
  enviando.value = true;
  errorGeneral.value = "";
  try {
    const { data: presupuestoResp } = await api.post(`/ninesys/${idEmpresa.value}/presupuesto`, {
      lienzoIds: props.lienzos.map((l) => l.id),
      cliente: cliente.value,
      servicio: servicio.value,
      obs: `${props.lienzos.length > 1 ? "Diseños" : "Diseño"} ya armado en la plataforma Nineteen Print, listo para imprimir: ${urlDestino()}`,
    });

    const mensaje = construirMensajeConfirmacion({
      idPresupuesto: presupuestoResp.idPresupuesto,
      servicioNombre: servicio.value.name,
      cantidadMetros: cantidadFacturadaTotal.value.toFixed(1),
      urlLienzo: urlDestino(),
    });

    const { data: waResp } = await api.post(`/ninesys/${idEmpresa.value}/notificar-whatsapp`, {
      phone: cliente.value.phone,
      name: cliente.value.first_name,
      message: mensaje,
    });

    resultado.value = {
      idPresupuesto: presupuestoResp.idPresupuesto,
      whatsappEnviado: waResp.enviado,
      whatsappMotivo: waResp.motivo,
    };
    paso.value = "resultado";
  } catch (err) {
    errorGeneral.value = err.response?.data?.error ?? "No se pudo crear el presupuesto en Ninesys, intentá de nuevo";
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
    <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">
      Pedir presupuesto{{ lienzos.length > 1 ? ` (${lienzos.length} lienzos)` : "" }}
    </h2>

    <p v-if="paso === 'yaEnviado'" class="text-sm text-np-ink/60">
      Este lienzo ya generó el presupuesto <strong>#{{ yaEnviado.id_presupuesto_ninesys }}</strong> en Ninesys.
    </p>

    <template v-else-if="paso === 'resultado'">
      <p class="text-sm text-np-ink">
        Presupuesto <strong>#{{ resultado.idPresupuesto }}</strong> creado con éxito en Ninesys.
      </p>
      <p v-if="resultado.whatsappEnviado" class="text-sm text-green-700">
        Se envió la confirmación por WhatsApp al cliente.
      </p>
      <p v-else class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
        No se pudo enviar la notificación automática por WhatsApp{{ resultado.whatsappMotivo ? `: ${resultado.whatsappMotivo}` : "" }}.
        El presupuesto ya está creado — comunicate directo con el cliente o pedile a soporte que reenvíe la confirmación.
      </p>
    </template>

    <template v-else>
      <PedidoEmpresaSelector :id-empresa="idEmpresa" @seleccionar="elegirEmpresa" />

      <PedidoServicioSelector v-if="idEmpresa && paso !== 'empresa'" :id-empresa="idEmpresa" @seleccionar="elegirServicio" />

      <PedidoClienteBuscador
        v-if="servicio && (paso === 'cliente' || paso === 'confirmar')"
        :id-empresa="idEmpresa"
        @confirmado="confirmarCliente"
      />

      <div v-if="paso === 'confirmar'" class="border-t border-black/5 pt-4 space-y-3">
        <dl class="text-sm space-y-1">
          <div class="flex justify-between"><dt class="text-np-ink/50">Servicio</dt><dd>{{ servicio.name }}</dd></div>
          <div v-if="lienzos.length > 1" class="space-y-0.5">
            <div v-for="d in desglose" :key="d.lienzo.id" class="flex justify-between text-np-ink/60">
              <dt>Lienzo #{{ d.lienzo.id }}{{ d.lienzo.tela ? ` (tela: ${d.lienzo.tela})` : "" }}</dt>
              <dd>{{ d.cantidadFacturada.toFixed(1) }}m</dd>
            </div>
          </div>
          <div class="flex justify-between">
            <dt class="text-np-ink/50">Cantidad{{ lienzos.length > 1 ? " total" : "" }}</dt>
            <dd>{{ cantidadFacturadaTotal.toFixed(1) }} metros <span class="text-np-ink/40">(se factura al décimo de metro)</span></dd>
          </div>
          <div class="flex justify-between"><dt class="text-np-ink/50">Cliente</dt><dd>{{ cliente.first_name }} {{ cliente.last_name }}</dd></div>
          <div class="flex justify-between font-bold"><dt>Total estimado</dt><dd>${{ total.toFixed(2) }}</dd></div>
        </dl>
        <p v-if="errorGeneral" class="text-sm text-red-600">{{ errorGeneral }}</p>
        <button
          class="bg-np-teal hover:bg-np-teal-dark text-white font-bold text-sm uppercase tracking-wide px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          :disabled="enviando"
          @click="enviarPedido"
        >
          {{ enviando ? "Enviando…" : "Enviar pedido por WhatsApp" }}
        </button>
      </div>
    </template>
  </section>
</template>
