# Contexto del proyecto: App de armado de lienzos DTF/Sublimación

> Este documento se actualiza a medida que el proyecto avanza. Refleja el
> estado real de lo construido, no solo el plan original. Última
> actualización: 2026-08-23.

## 1. Qué es la app

App web independiente (no integrada a Ninesys) para que los clientes de
Nineteen Print/Nineteen Custom suban o generen sus propias imágenes, les
quiten el fondo, aumenten su resolución, y las acomoden automáticamente en
un lienzo de impresión, listo para exportar en el formato correcto según
el tipo de impresión (DTF o sublimación).

**Estado: construida y funcionando en local**, con guía de deploy al VPS
lista (`DEPLOY.md`). Ver `README.md` para cómo correrla.

## 2. Flujo de usuario

1. Login (usuario/clave) — cuentas creadas solo por un admin (ver §9).
2. Por proyecto, conseguir imágenes de tres formas posibles:
   - **Subir archivo** propio.
   - **Buscar en internet**: banco de fotos Pexels (uso comercial libre), se
     descarga y entra al proyecto igual que una subida manual.
   - **Crear texto**: generador con Canvas en el navegador — texto, fuente
     (8 fuentes de Google Fonts), color, contorno y sombra. No pasa por la
     cola de IA (ya nace con transparencia real), aparece al instante.
3. Por cada imagen subida o buscada (no aplica al texto generado, que ya
   sale sin fondo):
   - Quitar fondo (automático vía IA, con recorte al bounding box real).
   - Aumentar resolución (upscale), opcional.
   - Definir **alto en cm**, con el ancho calculado automáticamente
     respetando la proporción real de la imagen (checkbox para desactivar
     y forzar ambas medidas manualmente si hace falta deformar a propósito).
   - Definir cantidad de copias.
4. Elegir tipo de lienzo:
   - **DTF**: 28cm o 58cm de ancho, fondo transparente, imagen en RGB, export **PNG**
   - **Sublimación**: 158cm de ancho, export **PDF o JPEG**
5. Configurar margen entre imágenes
6. Auto-acomodo: el motor arma el lienzo maximizando el uso del espacio (ancho fijo, alto variable/rollo)
7. Para sublimación: la orientación de cada imagen queda **fija** según el eje de estiraje de la tela (nunca rota 90°/270°, solo 0°/180°) — en DTF sí se permite rotación libre para optimizar espacio
8. Ajuste manual opcional sobre el resultado (drag & drop en canvas Konva)
9. **Reeditar un lienzo ya generado**: desde la vista del lienzo se puede
   cambiar tipo/ancho/margen/formato y qué imágenes entran, y volver a
   correr el auto-acomodo sobre el mismo lienzo (mismo link/id) — o
   eliminarlo directamente.
10. Exportar archivo final (PNG/PDF/JPEG, con DPI correcto embebido).
11. **Pedir presupuesto por WhatsApp** (ver §11): con el perfil completo
    (nombre, cédula, dirección), un botón arma el pedido y abre WhatsApp
    con el mensaje ya escrito para el agente de Ninesys — el cliente solo
    aprieta enviar.

## 3. Decisiones de infraestructura (confirmadas)

- App independiente, standalone (no depende de Ninesys)
- Corre en un **VPS privado ya contratado, sin GPU**
- **Todo el procesamiento de IA corre en CPU** en el VPS — en la Mac de
  desarrollo el upscale usa GPU vía Metal (mucho más rápido), pero el
  binario de producción (Linux) corre en CPU pura; en un VPS sin GPU real
  hace falta instalar `mesa-vulkan-drivers` (Vulkan por software) — ver
  `DEPLOY.md` §0.
- Sin Docker: todo nativo (Homebrew en Mac / apt en el VPS), decisión
  tomada para simplificar tanto el dev local como el deploy a un único VPS.
- Prioridad: que funcione, aunque sea lento al inicio.

## 4. Stack técnico (implementado)

- **Backend**: Node.js + Express + Prisma (ORM)
- **Frontend**: Vue 3 + Vite + Konva.js (canvas interactivo) + Pinia + Tailwind
- **Base de datos**: MySQL
- **Microservicio de IA**: Python + FastAPI, separado del backend Node
- **Cola de trabajos**: Redis + BullMQ, concurrencia 1 (ajustable, ver `WORKER_CONCURRENCY`)
- **Storage**: disco local del VPS por ahora, detrás de una interfaz mínima
  (`packages/backend/src/lib/storage.js`) para poder migrar a Backblaze
  B2/Wasabi sin tocar el resto del código — sigue siendo el pendiente
  original si el volumen lo justifica.
- **Reverse proxy**: Nginx + SSL (Let's Encrypt) — documentado en `DEPLOY.md`
- **Identidad visual**: paleta y tipografía de `logos e identidad visual/`
  aplicadas en todo el frontend (ver §8).

Estructura del monorepo:
```
packages/
  packing-engine/   motor de acomodo (guillotine + reglas de rotación), con 7 tests
  backend/          API Express + Prisma/MySQL + BullMQ + export
  worker/           consumer BullMQ, llama al ai-service
  ai-service/       FastAPI (Python): quitar fondo (rembg) + upscale (realesrgan)
  frontend/         Vue 3 + Vite + Konva.js
```

## 5. Modelos de IA (implementados y validados)

- **Quitado de fondo**: `rembg` con modelo `u2netp` — validado end-to-end,
  incluye recorte automático al bounding box real por canal alfa.
- **Upscale**: `realesrgan-ncnn-vulkan` (modelo `realesrgan-x4plus`,
  reescalado a 2x configurable vía `UPSCALE_SCALE`) — validado, ~2.5s por
  imagen en Mac (GPU vía Metal), más lento en CPU pura en el VPS.
- Tamaño máximo de imagen de entrada: **4000px por lado** (`MAX_LADO_PX`),
  aplicado tanto al subir archivo como al traer imágenes del buscador (se
  eligió el tamaño `large2x` de Pexels, ~1880px, para no chocar con este
  límite — el `original` de Pexels a veces lo supera).

## 6. Esquema de base de datos (MySQL, vía Prisma)

```sql
CREATE TABLE usuarios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('admin','cliente') DEFAULT 'cliente',
  activo BOOLEAN DEFAULT TRUE,
  limite_diario INT NULL,           -- NULL = sin límite; ver §9
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE proyectos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  nombre VARCHAR(150),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE imagenes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  proyecto_id INT NOT NULL,
  nombre_original VARCHAR(255),
  ruta_original VARCHAR(500),
  ruta_procesada VARCHAR(500),
  ancho_px INT, alto_px INT, dpi INT DEFAULT 300,
  ancho_mm DECIMAL(8,2), alto_mm DECIMAL(8,2),
  copias INT DEFAULT 1,
  estado_fondo ENUM('pendiente','procesando','listo','error','omitido') DEFAULT 'pendiente',
  estado_upscale ENUM('pendiente','procesando','listo','error','omitido') DEFAULT 'omitido',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  imagen_id INT NOT NULL,
  tipo ENUM('quitar_fondo','upscale') NOT NULL,
  estado ENUM('en_cola','procesando','listo','error') DEFAULT 'en_cola',
  mensaje_error TEXT,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- usado para el límite diario
  iniciado_en TIMESTAMP NULL,
  terminado_en TIMESTAMP NULL,
  FOREIGN KEY (imagen_id) REFERENCES imagenes(id) ON DELETE CASCADE
);

CREATE TABLE lienzos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  proyecto_id INT NOT NULL,
  tipo ENUM('dtf','sublimacion') NOT NULL,
  ancho_mm DECIMAL(8,2) NOT NULL,
  margen_mm DECIMAL(6,2) DEFAULT 5,
  alto_usado_mm DECIMAL(10,2),
  formato_exportacion ENUM('png','pdf','jpeg') NOT NULL,
  ruta_export VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE TABLE lienzo_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  lienzo_id INT NOT NULL,
  imagen_id INT NOT NULL,
  x_mm DECIMAL(10,2), y_mm DECIMAL(10,2),
  ancho_mm DECIMAL(8,2), alto_mm DECIMAL(8,2),
  rotacion SMALLINT DEFAULT 0,
  orden INT,
  FOREIGN KEY (lienzo_id) REFERENCES lienzos(id) ON DELETE CASCADE,
  FOREIGN KEY (imagen_id) REFERENCES imagenes(id) ON DELETE CASCADE
);
```

Notas:
- `estado_fondo`/`estado_upscale` en `imagenes` reflejan el estado actual (consulta rápida de UI); `jobs` es la cola/historial real que procesa el worker.
- `lienzo_items` es la salida directa del motor de acomodo — cada fila es una colocación calculada por el algoritmo. Al reeditar un lienzo, se borran y se vuelven a generar (mismo `lienzo_id`).
- Un proyecto puede tener varios lienzos.
- Todas las FK tienen `ON DELETE CASCADE`: borrar un usuario borra sus proyectos, imágenes, lienzos, jobs e items.

## 7. Motor de acomodo (implementado y testeado)

Paquete aislado `packages/packing-engine`, sin dependencias de red/DB, 7
tests en verde (`npm test`). Problema: **2D strip packing** — ancho fijo
(280/580/1580mm), alto variable (rollo).

### Preprocesamiento antes de empacar
1. Recortar cada imagen (después de quitar el fondo) a su bounding box real usando el canal alfa — elimina espacio transparente desperdiciado. (Implementado en el ai-service, con PIL, justo después de `rembg.remove`.)
2. Expandir por copias: N copias de una imagen = N rectángulos independientes con las mismas dimensiones.
3. Aplicar margen como padding: inflar cada rectángulo por `margen/2` en cada lado antes de empacar. Al renderizar, la imagen real se dibuja centrada dentro del rectángulo inflado.
4. Ordenar los rectángulos de mayor a menor área/altura antes de empacar (heurística First-Fit Decreasing).

### Algoritmo: Guillotine con heurística Best-Area-Fit
- Implementación propia (no `maxrects-packer` de npm), porque la rotación es una regla de negocio crítica por tipo de lienzo, no solo una optimización.
- Al colocar una pieza, divide el espacio libre usado en dos nuevos espacios (derecha y abajo) — de ahí "guillotina".
- Al final, recorta el lienzo a la altura Y máxima realmente alcanzada.

### Regla de rotación (específica del negocio)
```js
canvas.tipo = "dtf" | "sublimacion"
canvas.rotacionesPermitidas =
    tipo === "dtf" ? [0, 90] : [0]
```
(180°/270° no aportan nada al empacado — mismo footprint que 0°/90°
respectivamente — así que el motor nunca las elige; 180° queda disponible
solo como ajuste visual manual si hiciera falta en el futuro.)

- DTF: prueba orientación original y rotada 90° en cada espacio libre, eligiendo la que menos desperdicie.
- Sublimación: nunca prueba 90°/270° — el eje de la tela queda respetado por diseño.

### Estructura de entrada/salida del motor
Entrada: `{ canvasAncho, tipo, margen, items: [{ id, anchoMM, altoMM, copias }] }`
Salida: `{ altoFinalUsado, colocaciones: [{ id, x, y, ancho, alto, rotacion }] }`

El motor corre en el backend Node.js (cálculo geométrico puro).

### Ajuste manual post-acomodo
El frontend (Konva.js) permite mover imágenes manualmente por drag & drop.
No se re-valida colisión en tiempo real — es responsabilidad del usuario.

## 8. Identidad visual

Tomada de `logos e identidad visual/` (logos SVG, ícono de perfil,
`nineteen_print_brand_identity.html`) y aplicada en todo el frontend:

- **Colores**: teal `#0F6E56` (primario), teal-dark `#08402F`, teal-light
  `#E1F5EE`, amber `#E8A020` (acento, sin usar como color dominante), ink
  `#0A2419` (texto/header oscuro), paper `#F5F5F2` (fondo). Definidos en
  `packages/frontend/tailwind.config.js` con prefijo `np-` para no chocar
  con los `teal`/`amber` por default de Tailwind.
- **Tipografía**: Montserrat (300/400/700/900) para toda la UI.
- **Logo**: componente `BrandLogo.vue` (marca "19" + wordmark "nineteen
  print"), construido en HTML/CSS (no como imagen) para que herede bien la
  fuente ya cargada — variante clara (fondo blanco) y oscura (header ink,
  mark en amber).
- **Favicon**: mismo mark, en `public/favicon.svg`.

## 9. Autenticación, usuarios y límites

- Login usuario/clave, JWT (7 días).
- **El alta de usuarios es solo de un admin** — no existe registro público
  (se cerró a propósito: antes cualquiera con la URL podía crearse una
  cuenta y consumir CPU del VPS sin control).
- Panel de admin en `/admin/usuarios` (solo visible con `rol=admin`):
  crear usuarios, cambiar rol, **activar/desactivar** cuentas, y fijar un
  **límite diario de procesamientos IA** (quitar fondo + upscale
  combinados) por usuario, ajustable, `null` = sin límite.
- Desactivar una cuenta corta el acceso al instante (se valida `activo`
  en cada request autenticado, no solo al loguear), aunque el usuario ya
  tenga un token JWT vigente.
- El generador de texto (Canvas) **no** cuenta contra el límite diario,
  porque no usa el microservicio de IA.
- Lógica de conteo/verificación en `packages/backend/src/lib/limites.js`.

## 10. Búsqueda de imágenes y generador de texto

- **Búsqueda web** (`packages/backend/src/lib/pexels.js`): banco de fotos
  Pexels, elegido por sobre una búsqueda tipo Google Imágenes porque las
  fotos tienen licencia de uso comercial clara — relevante porque esto se
  imprime para clientes. Requiere `PEXELS_API_KEY` (gratis en
  pexels.com/api) en `packages/backend/.env`; sin la key, el buscador
  muestra un error explicando cómo configurarla.
- **Generador de texto** (`GeneradorTexto.vue`): 100% client-side con
  Canvas, sin costo ni dependencia externa. Texto, 8 fuentes de Google
  Fonts, color, contorno, sombra. Recorta al bounding box real antes de
  subir. Entra al proyecto ya en estado "listo" (sin pasar por la cola IA).

## 11. Pedido por WhatsApp a Ninesys (implementado)

Ninesys tiene un agente de IA en WhatsApp que cotiza y registra pedidos
conversando paso a paso con el cliente, y que llama a una función
`submit_presupuesto` cuando el cliente confirma. Ese agente está construido
para prendas por talla/corte (camisas S/M/L/XL, Damas/Caballeros/Niños),
pero también reconoce explícitamente cuando el cliente ya dio varios datos
en un solo mensaje y salta las preguntas ya respondidas — por eso, en vez
de integrarnos por API (no expone ninguna), la app arma **un solo mensaje
de WhatsApp con todo el pedido**, listo para que el agente lo lea completo
y vaya directo al resumen de confirmación.

- Botón **"Enviar pedido por WhatsApp"** en la vista del lienzo
  (`PedidoWhatsApp.vue`), visible una vez que el lienzo está generado.
- Requiere que el cliente haya completado su perfil (`/perfil`): nombre y
  apellido (reutiliza el campo `nombre` que ya existía), cédula, dirección
  (opcional). El teléfono no se pide — Ninesys lo reconoce solo porque el
  cliente escribe desde su propio WhatsApp.
- Catálogo de servicios que salen de esta app — el nombre tiene que ser
  **texto idéntico** al de Ninesys, porque su agente matchea el producto
  por nombre (probado: con nombres aproximados respondió "producto no
  encontrado en el catálogo"). Precios dados por el usuario el 2026-08-23,
  el asesor puede ajustarlos después en Ninesys:
  - DTF → **Impresión DTF** (ID 4, $5/metro o unidad) o **DTF UV RIGIDO** (ID 8, $15/metro)
  - Sublimación → **Impresión sublimación** (ID 5, $4/metro, ancho 158cm,
    tela del cliente) o **Sublimación con tela** (ID 6, $5/metro)
  - Todos con `corte="No aplica"`, `tela="No aplica"`, `talla="Talla única"`
    — son productos por metraje, no prendas.
- **Cantidad**: se calcula sola, `lienzo.alto_usado_mm / 1000` (metros de
  rollo usados).
- **Link del archivo**: no hay campo URL en `submit_presupuesto` — va
  dentro del campo de texto libre "detalles de diseño" (`obs`), como una
  frase con el link a `/lienzos/:id` de esta app (requiere login: el
  archivo en alta resolución sigue sin ser público, solo lo ve quien tenga
  cuenta acá — coincide con la decisión de entrega tomada en el roadmap).
- Número de WhatsApp destino: `VITE_WHATSAPP_NUMERO` en
  `packages/frontend/.env` (hoy `584246321576`).
- Mecanismo: `wa.me/<numero>?text=<mensaje-codificado>` — sin API de
  WhatsApp Business, sin nada pago; el cliente solo aprieta enviar.

Con esto, **Ninesys es quien crea y hace aprobar el presupuesto** — ya no
hace falta construir esa lógica de aprobación dentro de esta app (se
elimina ese punto del roadmap anterior).

## 12. Consideraciones de color

- DTF: RGB (consistente con cómo trabaja el RIP de la impresora DTF)
- El export PNG/JPEG embebe el DPI (300) correctamente — hubo un bug real
  detectado en producción: sin esa metadata, algunos programas/RIP asumen
  1px=1mm y un lienzo de 28cm aparecía como ~330cm. Corregido con
  `sharp(...).withMetadata({ density: EXPORT_DPI })`.
- Sublimación: **pendiente** verificar si el RIP espera un perfil de color
  ICC específico embebido en el PDF/JPEG exportado (ya se usa i1 Pro para
  perfiles de color en la operación actual) — el export hoy sale sin
  perfil embebido, con un TODO marcado en `lib/export.js`.

## 13. Cómo correrlo

Ver `README.md` (setup local) y `DEPLOY.md` (migración al VPS, con nota
importante sobre Vulkan por software para el upscale sin GPU).

```bash
bash scripts/dev.sh   # levanta mysql/redis, backend, worker, ai-service, frontend
npm test               # motor de acomodo (vitest)
```

## 14. Pendientes por definir

- Storage: disco local del VPS vs. Backblaze B2/Wasabi (si el volumen lo justifica).
- Perfil de color ICC a embeber en el PDF de sublimación.
- Concurrencia exacta de la cola de jobs (`WORKER_CONCURRENCY`, ajustar según núcleos reales del VPS).

## 15. Roadmap futuro (no implementado aún)

Conversado con el usuario el 2026-08-23. El pedido por WhatsApp (§11) ya
cubre la parte más importante de esto — Ninesys es quien crea y aprueba el
presupuesto, así que ya no hace falta construir esa lógica acá. Lo que
queda realmente abierto:

- **Entrega del archivo final en baja resolución para el cliente**: hoy el
  cliente que exporta desde `/lienzos/:id` se lleva el archivo en la
  resolución real (300 DPI). La decisión tomada es que solo debería poder
  descargar una vista previa en **baja resolución** — el archivo real
  queda disponible solo para quien tenga login (que es, de hecho, lo que
  ya pasa: el link que se manda por WhatsApp apunta a la página del
  lienzo, protegida por auth, no a un archivo público). Falta decidir si
  además conviene bloquear el botón "Exportar" actual para roles
  `cliente` y dejarlo solo para `admin`/staff, o generar dos variantes de
  export (preview liviana vs. archivo real).
- **Integración con Ninesys por API**: sigue bloqueada hasta tener
  información concreta de qué expone Ninesys más allá del bot de WhatsApp
  (¿hay alguna API para, por ejemplo, consultar el estado de un
  presupuesto ya creado? ¿nada?) — sin eso no se puede scopear en serio.
  No es urgente: el flujo de WhatsApp ya cierra el círculo cliente →
  presupuesto → aprobación sin necesitarla.
