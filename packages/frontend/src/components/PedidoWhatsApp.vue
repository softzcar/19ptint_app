<script setup>
import { ref, computed } from "vue";
import { api } from "../lib/api.js";
import { construirMensajeConfirmacion } from "../lib/mensajeWhatsapp.js";
import PedidoEmpresaSelector from "./pedido/PedidoEmpresaSelector.vue";
import PedidoServicioSelector from "./pedido/PedidoServicioSelector.vue";
import PedidoClienteBuscador from "./pedido/PedidoClienteBuscador.vue";

const props = defineProps({ lienzo: { type: Object, required: true } });

// Pasos del wizard: empresa -> servicio -> cliente -> confirmar -> resultado.
// Reemplaza el flujo anterior (wa.me con catálogo hardcodeado) por llamadas
// reales a ninesys-api/msg_ninesys -- ver plan de integración.
const paso = ref(props.lienzo.id_presupuesto_ninesys ? "yaEnviado" : "empresa");
const idEmpresa = ref(null);
const servicio = ref(null);
const cliente = ref(null);
const enviando = ref(false);
const resultado = ref(null); // { idPresupuesto, whatsappEnviado, whatsappMotivo? }
const errorGeneral = ref("");

const cantidadMetros = computed(() => (Number(props.lienzo.alto_usado_mm) / 1000).toFixed(2));
// Ninesys factura el metro completo (presupuestos_productos.cantidad es
// entero) -- se muestra el mismo total que va a quedar creado.
const cantidadFacturada = computed(() => Math.ceil(Number(cantidadMetros.value)));
const total = computed(() => (servicio.value ? servicio.value.precio * cantidadFacturada.value : 0));

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

async function enviarPedido() {
  enviando.value = true;
  errorGeneral.value = "";
  try {
    const { data: presupuestoResp } = await api.post(`/ninesys/${idEmpresa.value}/presupuesto`, {
      lienzoId: props.lienzo.id,
      cliente: cliente.value,
      servicio: servicio.value,
      cantidad: Number(cantidadMetros.value),
      obs: `Diseño ya armado en la plataforma Nineteen Print, listo para imprimir: ${urlLienzo()}`,
    });

    const mensaje = construirMensajeConfirmacion({
      idPresupuesto: presupuestoResp.idPresupuesto,
      servicioNombre: servicio.value.name,
      cantidadMetros: cantidadMetros.value,
      urlLienzo: urlLienzo(),
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

function urlLienzo() {
  return `${window.location.origin}/lienzos/${props.lienzo.id}`;
}
</script>

<template>
  <section class="bg-white rounded-xl border border-black/5 shadow-sm p-5 sm:p-6 space-y-4">
    <h2 class="text-xs font-bold uppercase tracking-wide text-np-ink/50">Pedir presupuesto</h2>

    <p v-if="paso === 'yaEnviado'" class="text-sm text-np-ink/60">
      Este lienzo ya generó el presupuesto <strong>#{{ lienzo.id_presupuesto_ninesys }}</strong> en Ninesys.
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
          <div class="flex justify-between">
            <dt class="text-np-ink/50">Cantidad</dt>
            <dd>{{ cantidadFacturada }} metros <span class="text-np-ink/40">(rollo usado: {{ cantidadMetros }}m, se factura el metro completo)</span></dd>
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
