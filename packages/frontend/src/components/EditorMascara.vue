<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { sombrearRelieve, alturaDesdeCanalR } from "../lib/relieve3d.js";

// Editor de UNA capa spot (blanco o barniz), reconstruido a partir del
// feedback real: pintar a mano con pincel no era práctico. En vez de eso:
// (1) clic sobre las regiones REALES del vector (el SVG que ya generó
// vtracer) para activarlas/desactivarlas, y (2) formas predeterminadas
// (rectángulo, círculo, franja) que se colocan con un clic y se suman o
// restan de la selección. El resultado se "hornea" (bake) a un PNG plano
// de un canal (gris = intensidad, opaco) -- la misma convención que ya
// produce proponer_capas() en el ai-service, para que el export (Fase 5)
// no tenga que distinguir entre una máscara nunca tocada y una editada acá.
const props = defineProps({
  imagenFondoUrl: { type: String, default: null },
  // Máscara ya guardada en el servidor para esta capa (generada por Gemini,
  // por el contorno de bordado, o un guardado manual anterior) -- se
  // muestra como guía sobre el lienzo, no se puede editar directo: para
  // modificarla hay que rearmarla con regiones/formas y "Guardar capa".
  mascaraGuiaUrl: { type: String, default: null },
  svgUrl: { type: String, default: null },
  // Última textura generada con Gemini (PNG con transparencia real) -- ver
  // usarTextura/patronImg más abajo: se aplica como relleno (canvas
  // pattern) en vez de blanco sólido cuando el usuario la activa.
  texturaUrl: { type: String, default: null },
  ancho: { type: Number, required: true },
  alto: { type: Number, required: true },
  tipo: { type: String, default: "blanco" }, // 'blanco' -> relieve mate | 'barniz' -> brillo especular
});

const rutas = ref([]); // [{ d: string }] -- paths del SVG vectorizado
// Regiones del vector activas para esta capa: { [índice de ruta]: { x, y,
// escala, cx, cy } } -- x/y es un desplazamiento (mover), escala agranda/
// achica desde su propio centro (cx,cy, el bounding box real del path,
// tomado de getBBox() al seleccionarla). Antes era un Set binario
// (activa/no); ahora cada una es un objeto que se puede mover, redimensionar
// y quitar, no solo prender/apagar en su posición original.
const instancias = ref({});
const rutaActiva = ref(null); // última región tocada, para el panel de ajuste
// [{ id, tipo: 'rect'|'circulo'|'franja', x, y, area, distancia, ancho,
// modo: 'sumar'|'restar' }] -- cada "forma" colocada NO es una única figura
// sólida: es un parche de área×área relleno con una grilla de puntos (el
// tipo define la FORMA de cada punto -- círculo/cuadrado/franja chica), tal
// como un relleno sólido no varía (no genera relieve real); los huecos
// entre puntos son justo lo que hace falta, mismo criterio que la textura
// IA. "distancia" = separación entre puntos, "ancho" = tamaño de cada uno.
const formas = ref([]);
let siguienteFormaId = 0;

const formaActiva = ref(null); // null = solo seleccionar regiones | 'rect' | 'circulo' | 'franja'
const modoForma = ref("sumar"); // 'sumar' | 'restar'
const tamanoForma = ref(Math.round(Math.min(props.ancho, props.alto) * 0.12) || 40); // área del parche
const distanciaPuntos = ref(Math.max(4, Math.round(tamanoForma.value / 6)));
const anchoPunto = ref(Math.max(2, Math.round(distanciaPuntos.value * 0.6)));
// Engrosa hacia afuera todo lo sumado (regiones del vector + formas
// "sumar") -- útil cuando el trazo real queda demasiado fino para verse
// como relieve una vez impreso.
const grosorExtra = ref(0);

// Rojo claro para todo lo "sumado" (regiones del vector activas + formas en
// modo sumar) -- antes era verde/celeste, que sobre el fondo blanco típico
// de un logo casi no se distinguía ("como es blanco no se entiende").
const COLOR_SUMA = "rgba(255,90,90,0.6)";
const COLOR_RESTA = "rgba(70,120,220,0.55)";

// Textura IA (ver props.texturaUrl): se decodifica a un HTMLImageElement
// real -- createPattern() (usado en hornear()) necesita la imagen ya
// cargada, no solo una URL.
const texturaImg = ref(null);
const usarTextura = ref(false);
// Tamaño del mosaico de textura (px del lienzo, no de la imagen de Gemini)
// -- Gemini siempre devuelve 1024x1024, pero el diseño puede ser de
// cualquier tamaño; sin esto, createPattern() repite el mosaico a su
// resolución nativa (1024px) sin importar qué tan grande sea el diseño, así
// que en un diseño chico solo se llega a ver un pedacito de una esquina del
// mosaico (a veces la parte transparente) -- eso era lo que se reportaba
// como "el relleno de Gemini no se aplica bien / solo en una parte".
// Arranca en el lado más chico del lienzo (un mosaico completo entra una
// vez) -- probado a mano contra una textura real de Gemini: un default más
// chico (ej. 25%) repite tanto que se pierde el detalle y se ve "sucio"
// para texturas con motivos grandes. El usuario ajusta desde acá con el
// slider según cómo se vea cada textura en particular.
const tamanoTextura = ref(Math.round(Math.min(props.ancho, props.alto)) || 150);
watch(
  () => props.texturaUrl,
  async (url) => {
    if (!url) {
      texturaImg.value = null;
      usarTextura.value = false;
      return;
    }
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
      texturaImg.value = img;
    } catch {
      texturaImg.value = null;
    }
  },
  { immediate: true }
);
watch(usarTextura, pedirActualizarVista);
watch(tamanoTextura, pedirActualizarVista);

// Redibuja la textura ya cargada a un mosaico de tamanoTextura×tamanoTextura
// antes de usarla como canvas pattern -- createPattern() repite la imagen a
// su resolución nativa, así que hay que reescalarla nosotros para controlar
// qué tan grande se ve cada repetición en el lienzo.
function crearPatronTextura(ctx) {
  if (!texturaImg.value) return null;
  const tam = Math.max(4, Math.round(tamanoTextura.value));
  const mosaico = document.createElement("canvas");
  mosaico.width = tam;
  mosaico.height = tam;
  mosaico.getContext("2d").drawImage(texturaImg.value, 0, 0, tam, tam);
  return ctx.createPattern(mosaico, "repeat");
}

// vtracer agrupa los paths por color y cada uno trae su propio
// transform="translate(x,y)" (el origen de ese grupo de color dentro del
// lienzo) -- si se descarta ese atributo (como pasaba antes acá, solo se
// leía "d") cada path se dibuja en su sistema de coordenadas LOCAL en vez
// de en su posición real, y el resultado visual es un amontonamiento de
// formas cerca del origen (0,0) del SVG, es decir la esquina superior
// izquierda, sin relación con el diseño real.
let _matrizSvg, _matrizPath;
function matrizDeTransform(transformStr) {
  if (!transformStr) return new DOMMatrix();
  if (!_matrizSvg) {
    _matrizSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    _matrizPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    _matrizSvg.appendChild(_matrizPath);
  }
  _matrizPath.setAttribute("transform", transformStr);
  const consolidado = _matrizPath.transform.baseVal.consolidate();
  if (!consolidado) return new DOMMatrix();
  const m = consolidado.matrix;
  return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}

async function cargarSvg() {
  rutas.value = [];
  instancias.value = {};
  rutaActiva.value = null;
  if (!props.svgUrl) return;
  const texto = await fetch(props.svgUrl).then((r) => r.text());
  const doc = new DOMParser().parseFromString(texto, "image/svg+xml");
  rutas.value = Array.from(doc.querySelectorAll("path")).map((p) => {
    const transform = p.getAttribute("transform") || "";
    return { d: p.getAttribute("d"), transform, matriz: matrizDeTransform(transform) };
  });
  // Por defecto arrancan TODAS las regiones activas (rojo) -- antes
  // arrancaba en blanco y había que ir clickeando una por una; con la
  // posición ya corregida (ver matrizDeTransform), es más práctico empezar
  // con todo prendido y sacar/ajustar lo que sobre que al revés.
  await nextTick();
  const elementos = contenedorRef.value?.querySelectorAll("svg > path") ?? [];
  const nuevo = {};
  elementos.forEach((el, i) => {
    const bbox = el.getBBox();
    nuevo[i] = { x: 0, y: 0, escala: 1, cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2 };
  });
  instancias.value = nuevo;
}

const contenedorRef = ref(null);

function puntoDesdeEvento(event) {
  const rect = contenedorRef.value.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * props.ancho,
    y: ((event.clientY - rect.top) / rect.height) * props.alto,
  };
}

// Estado del arrastre en curso (mover una región ya seleccionada). Un click
// simple (sin moverse) sobre una región togglea su selección; un arrastre
// real la mueve en vez de destogglearla.
let arrastre = null; // { i, x0, y0, offX, offY, movido }

function onPointerDownRuta(i, event) {
  // Con una forma elegida arriba, un click sobre el vector tiene que
  // colocarla ahí igual que sobre espacio vacío -- si no, como ahora TODAS
  // las regiones arrancan activas (rojo) y cubren casi todo el diseño,
  // cualquier click para poner un círculo/rectángulo/franja terminaba
  // toggléandolas sin querer en vez de colocar la forma (bug reportado:
  // "las herramientas no hacen nada sobre el diseño").
  if (formaActiva.value) return;
  event.stopPropagation();
  const p = puntoDesdeEvento(event);
  const inst = instancias.value[i];
  arrastre = { i, x0: p.x, y0: p.y, offX: inst?.x ?? 0, offY: inst?.y ?? 0, movido: false };
}

function onPointerMoveContenedor(event) {
  if (!arrastre || !instancias.value[arrastre.i]) return;
  const p = puntoDesdeEvento(event);
  const dx = p.x - arrastre.x0;
  const dy = p.y - arrastre.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) arrastre.movido = true;
  if (!arrastre.movido) return;
  instancias.value[arrastre.i].x = arrastre.offX + dx;
  instancias.value[arrastre.i].y = arrastre.offY + dy;
  pedirActualizarVista();
}

function onPointerUpRuta(i, event) {
  if (!arrastre || arrastre.i !== i) {
    arrastre = null;
    return;
  }
  if (!arrastre.movido) {
    // Fue un click simple, no un arrastre -> togglear selección.
    const nuevo = { ...instancias.value };
    if (nuevo[i]) {
      delete nuevo[i];
      rutaActiva.value = null;
    } else {
      const bbox = event.target.getBBox();
      nuevo[i] = { x: 0, y: 0, escala: 1, cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2 };
      rutaActiva.value = i;
    }
    instancias.value = nuevo;
    pedirActualizarVista();
  } else {
    rutaActiva.value = i;
  }
  arrastre = null;
}

// Mismo motivo que en onPointerDownRuta: con una forma elegida, el click
// tiene que burbujear hasta onClickFondo (que la coloca), no consumirse acá.
function onClickRuta(event) {
  if (formaActiva.value) return;
  event.stopPropagation();
}

function transformDeInstancia(inst) {
  return `translate(${inst.x} ${inst.y}) translate(${inst.cx} ${inst.cy}) scale(${inst.escala}) translate(${-inst.cx} ${-inst.cy})`;
}

function quitarRutaActiva() {
  if (rutaActiva.value === null) return;
  const nuevo = { ...instancias.value };
  delete nuevo[rutaActiva.value];
  instancias.value = nuevo;
  rutaActiva.value = null;
  pedirActualizarVista();
}

// Slider de tamaño (%) de la región actualmente seleccionada -- redimensiona
// desde su propio centro (cx,cy), no desde la esquina del lienzo.
const escalaActivaPct = computed({
  get: () => Math.round((instancias.value[rutaActiva.value]?.escala ?? 1) * 100),
  set: (pct) => {
    if (rutaActiva.value === null || !instancias.value[rutaActiva.value]) return;
    instancias.value[rutaActiva.value].escala = pct / 100;
    pedirActualizarVista();
  },
});

function onClickFondo(event) {
  // Click en espacio vacío (ni una región ni una forma): con una forma
  // elegida arriba, la coloca; si no, deselecciona el panel de ajuste.
  if (!formaActiva.value) {
    rutaActiva.value = null;
    return;
  }
  const { x, y } = puntoDesdeEvento(event);
  formas.value = [
    ...formas.value,
    {
      id: siguienteFormaId++,
      tipo: formaActiva.value,
      x,
      y,
      area: tamanoForma.value,
      distancia: distanciaPuntos.value,
      ancho: anchoPunto.value,
      modo: modoForma.value,
    },
  ];
  pedirActualizarVista();
}

function quitarForma(id) {
  formas.value = formas.value.filter((f) => f.id !== id);
  pedirActualizarVista();
}

// Mismo motivo que onClickRuta: clic sobre una forma YA puesta la quitaba
// siempre, incluso con otra forma elegida arriba -- eso hacía imposible
// apilar un "restar" justo encima de un "sumar" (clickear ahí borraba el
// "sumar" en vez de sumar el nuevo "restar" encima), y era la causa real
// de que "sumar y restar parecieran hacer lo mismo": nunca llegabas a ver
// el resultado de restar sobre algo, solo veías cosas desapareciendo.
function onClickForma(id, event) {
  if (formaActiva.value) return;
  event.stopPropagation();
  quitarForma(id);
}

function limpiar() {
  instancias.value = {};
  rutaActiva.value = null;
  formas.value = [];
  pedirActualizarVista();
}

// Construye el Path2D de una forma colocada -- NO una única figura sólida:
// un mosaico de puntos chicos (uno por celda de una grilla, filas alternadas
// medio paso para empaquetar mejor tipo panal) cubriendo el área×área del
// parche, centrado en (f.x, f.y). El tipo elegido define la FORMA de cada
// punto individual, no la del área total (que siempre es cuadrada):
// círculo -> puntos redondos, rectángulo -> puntos cuadrados, franja ->
// puntos alargados (una rayita corta, no una franja larga como antes).
// Mismo sistema de coordenadas que el SVG (px de la imagen) -- usado tanto
// para dibujar el overlay como para "hornear" la máscara final.
function pathDeForma(f) {
  const p = new Path2D();
  const paso = Math.max(2, f.distancia);
  const radio = Math.max(0.5, f.ancho / 2);
  const x0 = f.x - f.area / 2;
  const y0 = f.y - f.area / 2;
  let fila = 0;
  for (let yy = y0; yy <= y0 + f.area; yy += paso, fila++) {
    const offsetX = fila % 2 === 0 ? 0 : paso / 2;
    for (let xx = x0 + offsetX; xx <= x0 + f.area; xx += paso) {
      if (f.tipo === "franja") {
        const w = radio * 2.6;
        const h = radio * 0.8;
        p.rect(xx - w / 2, yy - h / 2, w, h);
      } else if (f.tipo === "rect") {
        p.rect(xx - radio, yy - radio, radio * 2, radio * 2);
      } else {
        p.moveTo(xx + radio, yy);
        p.arc(xx, yy, radio, 0, Math.PI * 2);
      }
    }
  }
  return p;
}

// Hornea la selección actual (rutas + formas) a un canvas opaco blanco/negro
// (blanco = 255 = con tinta, negro = 0 = sin tinta) -- la MISMA convención
// que ya usa proponer_capas() en el ai-service. Si hay una textura IA
// activada, el relleno "sumar" (regiones + formas) usa esa textura como
// canvas pattern en vez de blanco sólido: donde la textura es transparente
// queda el negro de fondo (sin tinta) y ahí es donde nace la variación de
// relieve -- exactamente lo que pidió el usuario.
function hornear() {
  const canvas = document.createElement("canvas");
  canvas.width = props.ancho;
  canvas.height = props.alto;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, props.ancho, props.alto);
  ctx.lineJoin = "round";
  const relleno = usarTextura.value ? (crearPatronTextura(ctx) ?? "white") : "white";
  ctx.fillStyle = relleno;
  for (const [i, inst] of Object.entries(instancias.value)) {
    const ruta = rutas.value[i];
    if (!ruta) continue;
    const p = new Path2D(ruta.d);
    ctx.save();
    // Mismo transform que el overlay visible: primero el transform nativo
    // de vtracer (ubica el path en su posición real dentro del lienzo),
    // después mover/escalar desde el centro real del path -- lo que se ve
    // en el editor es exactamente lo que se hornea.
    const m = ruta.matriz;
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.translate(inst.x + inst.cx, inst.y + inst.cy);
    ctx.scale(inst.escala, inst.escala);
    ctx.translate(-inst.cx, -inst.cy);
    ctx.fill(p);
    // "Engrosar": un stroke del ancho del grosor pedido sobre el mismo path
    // agranda el borde hacia afuera de forma pareja -- más simple y exacto
    // que un dilate por píxel, y nativo del canvas.
    if (grosorExtra.value > 0) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = grosorExtra.value * 2;
      ctx.stroke(p);
    }
    ctx.restore();
  }
  for (const f of formas.value) {
    const p = pathDeForma(f);
    ctx.fillStyle = f.modo === "sumar" ? relleno : "black";
    ctx.fill(p);
    if (f.modo === "sumar" && grosorExtra.value > 0) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = grosorExtra.value * 2;
      ctx.stroke(p);
    }
  }
  return canvas;
}

function exportarBlob() {
  const canvas = hornear();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

defineExpose({ exportarBlob });

// --- Vista 3D en vivo (mismo módulo compartido que usa CargaDtfUv.vue) ---
const canvasRelieve = ref(null);
const TAMANO_VISTA = 200;
let vistaPendiente = false;

function pedirActualizarVista() {
  if (vistaPendiente) return;
  vistaPendiente = true;
  requestAnimationFrame(() => {
    vistaPendiente = false;
    actualizarVistaRelieve();
  });
}

function actualizarVistaRelieve() {
  if (!canvasRelieve.value) return;
  const horneado = hornear();
  const escala = Math.min(TAMANO_VISTA / props.ancho, TAMANO_VISTA / props.alto);
  const w = Math.max(1, Math.round(props.ancho * escala));
  const h = Math.max(1, Math.round(props.alto * escala));
  const chico = document.createElement("canvas");
  chico.width = w;
  chico.height = h;
  const ctxChico = chico.getContext("2d");
  ctxChico.drawImage(horneado, 0, 0, w, h);
  const origen = ctxChico.getImageData(0, 0, w, h);
  const salida = sombrearRelieve(alturaDesdeCanalR(origen, w, h), w, h, props.tipo);
  ctxChico.putImageData(salida, 0, 0);
  const destino = canvasRelieve.value.getContext("2d");
  destino.clearRect(0, 0, canvasRelieve.value.width, canvasRelieve.value.height);
  destino.drawImage(chico, 0, 0);
}

onMounted(async () => {
  await cargarSvg();
  pedirActualizarVista();
});

watch(
  () => props.svgUrl,
  async () => {
    await cargarSvg();
    pedirActualizarVista();
  }
);
watch(grosorExtra, pedirActualizarVista);
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3 text-xs text-np-ink/60">
      <span class="text-np-ink/40">Forma a colocar:</span>
      <div class="flex gap-1.5">
        <button
          type="button"
          class="px-2.5 py-1 rounded-md border transition-colors"
          :class="!formaActiva ? 'border-np-teal bg-np-teal-light text-np-teal-dark' : 'border-black/10 hover:border-np-teal/40'"
          @click="formaActiva = null"
        >
          Ninguna (solo click)
        </button>
        <button
          v-for="f in ['rect', 'circulo', 'franja']"
          :key="f"
          type="button"
          class="px-2.5 py-1 rounded-md border capitalize transition-colors"
          :class="formaActiva === f ? 'border-np-teal bg-np-teal-light text-np-teal-dark' : 'border-black/10 hover:border-np-teal/40'"
          @click="formaActiva = f"
        >
          {{ { rect: "Rectángulo", circulo: "Círculo", franja: "Franja" }[f] }}
        </button>
      </div>
      <template v-if="formaActiva">
        <div class="flex gap-1.5">
          <button
            type="button"
            class="px-2.5 py-1 rounded-md border transition-colors"
            :class="modoForma === 'sumar' ? 'border-np-teal bg-np-teal-light text-np-teal-dark' : 'border-black/10'"
            @click="modoForma = 'sumar'"
          >
            Sumar
          </button>
          <button
            type="button"
            class="px-2.5 py-1 rounded-md border transition-colors"
            :class="modoForma === 'restar' ? 'border-red-400 bg-red-50 text-red-700' : 'border-black/10'"
            @click="modoForma = 'restar'"
          >
            Restar
          </button>
        </div>
        <label class="flex items-center gap-2">
          Tamaño del área ({{ tamanoForma }}px)
          <input v-model.number="tamanoForma" type="range" min="8" :max="Math.max(ancho, alto)" class="accent-np-teal" />
        </label>
        <label class="flex items-center gap-2">
          Distancia entre puntos ({{ distanciaPuntos }}px)
          <input v-model.number="distanciaPuntos" type="range" min="2" max="80" class="accent-np-teal" />
        </label>
        <label class="flex items-center gap-2">
          Ancho de cada punto ({{ anchoPunto }}px)
          <input v-model.number="anchoPunto" type="range" min="1" max="60" class="accent-np-teal" />
        </label>
      </template>
      <label class="flex items-center gap-2">
        Engrosar ({{ grosorExtra }}px)
        <input v-model.number="grosorExtra" type="range" min="0" max="60" class="accent-np-teal" />
      </label>
      <label v-if="texturaImg" class="flex items-center gap-1.5">
        <input v-model="usarTextura" type="checkbox" class="accent-np-teal" />
        Rellenar con textura IA
      </label>
      <label v-if="texturaImg && usarTextura" class="flex items-center gap-2">
        Tamaño del mosaico ({{ tamanoTextura }}px)
        <input v-model.number="tamanoTextura" type="range" min="10" :max="Math.max(ancho, alto)" class="accent-np-teal" />
      </label>
      <button type="button" class="ml-auto text-np-ink/50 hover:text-red-600 underline" @click="limpiar">Vaciar capa</button>
    </div>
    <p class="text-[11px] text-np-ink/40">
      Sin ninguna forma elegida arriba: clic sobre una parte del dibujo (en rojo) la activa/desactiva para esta capa;
      arrastrala para moverla, o usá el panel de abajo para cambiar su tamaño o quitarla. Con una forma elegida
      arriba, clic en cualquier lado del lienzo (incluso sobre el vector) coloca un parche ahí (lo suma o resta); clic
      sobre un parche ya puesto lo quita. Cada parche NO es una figura sólida: es un mosaico de puntitos (círculo,
      cuadrado o franja chica según la forma elegida) -- "Tamaño del área" es cuánto mide el parche completo,
      "Distancia entre puntos" qué tan separados están, y "Ancho de cada punto" qué tan grandes -- los huecos entre
      puntos son los que generan relieve real, un parche sólido no varía. "Engrosar" agranda hacia afuera todo lo
      sumado (regiones + puntos). Con "Rellenar con textura IA" activo, lo sumado se rellena con la textura generada
      arriba en vez del mosaico de puntos (ajustá "Tamaño del mosaico" si se ve muy chica/grande).
    </p>

    <div class="grid lg:grid-cols-[1fr_auto] gap-4 items-start">
      <div class="space-y-2">
        <div
          ref="contenedorRef"
          class="relative rounded-lg overflow-hidden border border-black/10 bg-[conic-gradient(#e5e7eb_25%,white_0_50%,#e5e7eb_0_75%,white_0)] bg-[length:16px_16px] mx-auto lg:mx-0 w-full"
          :style="{ aspectRatio: `${ancho} / ${alto}`, maxWidth: '900px' }"
          @click="onClickFondo"
          @pointermove="onPointerMoveContenedor"
        >
          <img
            v-if="imagenFondoUrl"
            :src="imagenFondoUrl"
            class="absolute inset-0 w-full h-full object-contain opacity-35 pointer-events-none"
          />
          <!-- Guía de lo que YA está guardado para esta capa (Gemini, contorno
               de bordado, o guardado anterior) -- se ve, no se toca; "Guardar
               capa" la reemplaza por lo que arme el editor. -->
          <img
            v-if="mascaraGuiaUrl"
            :src="mascaraGuiaUrl"
            class="absolute inset-0 w-full h-full object-contain opacity-70 pointer-events-none mix-blend-screen"
          />
          <svg :viewBox="`0 0 ${ancho} ${alto}`" class="absolute inset-0 w-full h-full" :class="formaActiva ? 'cursor-copy' : ''">
            <path
              v-for="(r, i) in rutas"
              :key="i"
              :d="r.d"
              :transform="instancias[i] ? `${r.transform} ${transformDeInstancia(instancias[i])}` : r.transform"
              :fill="instancias[i] ? COLOR_SUMA : 'transparent'"
              :stroke="instancias[i] ? COLOR_SUMA : 'rgba(0,0,0,0.18)'"
              :stroke-width="instancias[i] ? Math.max(1, grosorExtra * 2) : 1"
              :class="instancias[i] ? 'cursor-move' : 'cursor-pointer'"
              @pointerdown="onPointerDownRuta(i, $event)"
              @pointerup.stop="onPointerUpRuta(i, $event)"
              @click="onClickRuta"
            />
            <!-- El mosaico real se ve ACÁ, no solo en la vista 3D o en lo
                 exportado: un <pattern> SVG (una sola definición por parche,
                 el navegador la repite solo) en vez de dibujar cada puntito
                 como elemento aparte -- eso sí sería carísimo para un
                 mosaico tupido, un <pattern> no. -->
            <defs>
              <pattern
                v-for="f in formas"
                :key="'patron-' + f.id"
                :id="'mosaico-' + f.id"
                patternUnits="userSpaceOnUse"
                :x="f.x - f.area / 2"
                :y="f.y - f.area / 2"
                :width="Math.max(2, f.distancia)"
                :height="Math.max(2, f.distancia)"
              >
                <circle
                  v-if="f.tipo === 'circulo'"
                  :cx="Math.max(2, f.distancia) / 2"
                  :cy="Math.max(2, f.distancia) / 2"
                  :r="f.ancho / 2"
                  :fill="f.modo === 'sumar' ? COLOR_SUMA : COLOR_RESTA"
                />
                <rect
                  v-else-if="f.tipo === 'rect'"
                  :x="(Math.max(2, f.distancia) - f.ancho) / 2"
                  :y="(Math.max(2, f.distancia) - f.ancho) / 2"
                  :width="f.ancho"
                  :height="f.ancho"
                  :fill="f.modo === 'sumar' ? COLOR_SUMA : COLOR_RESTA"
                />
                <rect
                  v-else
                  :x="(Math.max(2, f.distancia) - f.ancho * 1.3) / 2"
                  :y="(Math.max(2, f.distancia) - f.ancho * 0.4) / 2"
                  :width="f.ancho * 1.3"
                  :height="f.ancho * 0.4"
                  :fill="f.modo === 'sumar' ? COLOR_SUMA : COLOR_RESTA"
                />
              </pattern>
            </defs>
            <g v-for="f in formas" :key="f.id" @click="onClickForma(f.id, $event)" class="cursor-pointer">
              <rect
                :x="f.x - f.area / 2"
                :y="f.y - f.area / 2"
                :width="f.area"
                :height="f.area"
                :fill="`url(#mosaico-${f.id})`"
                :stroke="f.modo === 'sumar' ? '#e11d1d' : '#2952b3'"
                stroke-dasharray="4 3"
              />
            </g>
          </svg>
        </div>

        <!-- Panel de ajuste de la región del vector recién tocada: mover ya
             se hace arrastrando en el lienzo, esto cubre tamaño y quitar. -->
        <div v-if="rutaActiva !== null && instancias[rutaActiva]" class="flex flex-wrap items-center gap-3 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 mx-auto lg:mx-0" style="max-width: 900px">
          <span class="text-red-700 font-medium">Región seleccionada</span>
          <label class="flex items-center gap-2">
            Tamaño ({{ escalaActivaPct }}%)
            <input v-model.number="escalaActivaPct" type="range" min="20" max="300" class="accent-np-teal" />
          </label>
          <span class="text-np-ink/40">Arrastrala en el lienzo para moverla.</span>
          <button type="button" class="ml-auto text-red-600 hover:text-red-700 underline" @click="quitarRutaActiva">Quitar</button>
        </div>
      </div>

      <!-- Vista 3D en vivo: cómo se "leería" impreso, inclinado bajo una
           luz fija -- blanco = relieve mate, barniz = brillo tipo laca. -->
      <div class="flex flex-col items-center gap-1.5 w-full lg:w-56">
        <p class="text-[11px] text-np-ink/40 text-center">
          Vista 3D ({{ tipo === "barniz" ? "brillo" : "relieve" }})
        </p>
        <div class="[perspective:900px] w-52 h-52 flex items-center justify-center bg-np-ink/5 rounded-lg">
          <canvas
            ref="canvasRelieve"
            :width="TAMANO_VISTA"
            :height="TAMANO_VISTA"
            class="max-w-[85%] max-h-[85%] [transform:rotateX(50deg)_rotateZ(-3deg)] shadow-[0_20px_22px_-10px_rgba(0,0,0,0.45)]"
          />
        </div>
      </div>
    </div>
  </div>
</template>
