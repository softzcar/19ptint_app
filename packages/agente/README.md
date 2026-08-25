# 19print Agente

App de bandeja para la PC de producción de cada empresa. Baja sola los lienzos
apenas se confirma un pedido, para que ya estén en el disco cuando llega el
momento de imprimir.

## Por qué un agente y no una carpeta compartida

La PC de la empresa no tiene IP fija, y con CGNAT (varios clientes compartiendo
una misma IP pública, muy común en Venezuela) abrir puertos en el router es
directamente imposible. Además, exponer una carpeta compartida de Windows a
internet es el vector principal de ransomware.

Por eso el tráfico va al revés de lo intuitivo: **es la PC la que llama al
servidor**, nunca el servidor a la PC. Las conexiones salientes siempre
funcionan — sin IP fija, sin abrir puertos, sin tocar el router y sin exponer
nada de la red de la empresa.

## Instalación en la PC de producción

1. En el panel web, entrar como admin a **Agentes** y generar el token de la
   empresa. Se muestra **una sola vez**: copiarlo antes de cerrar.
2. Instalar `19print Agente` con el instalador `.exe`.
3. Al abrirse por primera vez pide la configuración: pegar el token, elegir la
   carpeta donde guardar los lienzos y marcar *Arrancar junto con Windows*.
4. **Probar conexión** debe mostrar el nombre de la empresa. Si lo muestra,
   guardar y cerrar la ventana: el agente queda corriendo junto al reloj.

El token es lo único que hace falta. Con él, el agente ya sabe a qué empresa
pertenece y qué lienzos le tocan — el id de empresa nunca sale del servidor.

## Cómo se comporta

- Consulta al servidor cada 20s (el intervalo lo manda el servidor, se puede
  cambiar sin reinstalar nada).
- Guarda en `<carpeta elegida>/<AAAA-MM-DD>/lienzo-<id>-presupuesto-<n>.png`.
- Notificación de Windows al terminar cada descarga; al hacerle clic abre la
  carpeta con el archivo ya seleccionado.
- El ícono de la bandeja muestra el estado (al día / descargando con % / en
  cola / problema). Clic izquierdo abre la carpeta.
- Si la PC está apagada, la cola se acumula en el servidor y baja todo al
  volver a encenderla.

### Garantías sobre los archivos

- **Nunca aparece un archivo a medias.** Se descarga como `.parte` y solo se
  renombra al nombre final cuando está completo y verificado. El software de
  impresión no puede tomar un archivo incompleto.
- **Se verifica el contenido (sha256) antes de renombrar.** Si llegó corrupto,
  se descarta y se reintenta; el archivo malo nunca llega a existir con su
  nombre real.
- **Reanuda cortes.** Si se corta la conexión a mitad de un lienzo de 50MB,
  retoma desde donde quedó en vez de empezar de cero.

## Desarrollo

```bash
cd packages/agente
npm install
node node_modules/electron/install.js   # baja el binario (los scripts de
                                        # instalación están bloqueados por
                                        # política del repo)
npm run dev                             # corre el agente
npm run build                           # instalador .exe para Windows
```

Este paquete **no** forma parte de los workspaces npm del monorepo, a
propósito: no comparte código con el backend (habla solo por HTTP) y se
instala en PCs con Windows, no en el VPS. Incluirlo haría que cada
`npm install` en el servidor se bajara Electron (~230MB) al pedo.
