import { app, Tray, Menu, Notification, BrowserWindow, shell, ipcMain, dialog, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leerConfig, guardarConfig, configuracionCompleta } from "./config.js";
import { Sincronizador, VERSION_AGENTE } from "./sincronizador.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECURSOS = path.join(__dirname, "..", "recursos");

// Sin esto Windows muestra "electron.app.Electron" como remitente de las
// notificaciones en vez del nombre real de la app.
app.setAppUserModelId("com.nineteencustom.19print.agente");

// Dos instancias bajarían el mismo lienzo dos veces y pelearían por el mismo
// archivo .parte. La segunda se cierra y le avisa a la primera.
if (!app.requestSingleInstanceLock()) app.quit();

let tray = null;
let ventanaConfig = null;
let temporizador = null;
let intervaloSeg = 20;
const sinc = new Sincronizador();

function crearVentanaConfig() {
  if (ventanaConfig) {
    ventanaConfig.show();
    ventanaConfig.focus();
    return;
  }
  ventanaConfig = new BrowserWindow({
    width: 560,
    height: 520,
    resizable: false,
    title: "19print Agente — Configuración",
    icon: path.join(RECURSOS, "icono.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ventanaConfig.loadFile(path.join(__dirname, "ventana", "config.html"));
  ventanaConfig.on("closed", () => {
    ventanaConfig = null;
  });
}

function textoEstado(estado) {
  if (!estado.empresa) return "Sin configurar";
  if (estado.progreso) {
    return `Descargando ${estado.progreso.nombre} — ${estado.progreso.porcentaje}%`;
  }
  if (estado.ultimoError) return `Problema: ${estado.ultimoError}`;
  if (estado.enCola > 0) return `${estado.enCola} lienzo(s) en cola`;
  if (estado.sinDescargar > 0) return `${estado.sinDescargar} lienzo(s) nuevo(s) sin abrir`;
  return "Al día";
}

function refrescarBandeja(estado) {
  if (!tray) return;
  const empresa = estado.empresa ? `19print — ${estado.empresa}` : "19print Agente";
  tray.setToolTip(`${empresa}\n${textoEstado(estado)}`);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: empresa, enabled: false },
      { label: textoEstado(estado), enabled: false },
      { type: "separator" },
      { label: "Abrir carpeta de lienzos", click: abrirCarpeta },
      { label: "Buscar ahora", click: () => sincronizarYa(), enabled: !estado.ocupado },
      { type: "separator" },
      { label: "Configuración", click: crearVentanaConfig },
      { label: `Versión ${VERSION_AGENTE}`, enabled: false },
      { type: "separator" },
      { label: "Salir", click: () => app.quit() },
    ])
  );
}

async function abrirCarpeta() {
  const config = await leerConfig();
  if (config.carpetaDestino) {
    sinc.marcarVisto();
    shell.openPath(config.carpetaDestino);
  }
}

async function sincronizarYa() {
  const config = await leerConfig();
  if (!configuracionCompleta(config)) {
    crearVentanaConfig();
    return;
  }
  sinc.configurar(config);
  await sinc.sincronizar();
}

function arrancarCiclo() {
  clearInterval(temporizador);
  temporizador = setInterval(sincronizarYa, intervaloSeg * 1000);
}

app.whenReady().then(async () => {
  const icono = nativeImage.createFromPath(path.join(RECURSOS, "bandeja.png"));
  tray = new Tray(icono);
  tray.on("click", abrirCarpeta);

  sinc.on("estado", refrescarBandeja);

  sinc.on("descargada", (entrega) => {
    const noti = new Notification({
      title: "Lienzo listo para imprimir",
      body: `${entrega.nombreArchivo}${entrega.idPresupuesto ? ` — presupuesto ${entrega.idPresupuesto}` : ""}`,
      icon: path.join(RECURSOS, "icono.png"),
    });
    // Al hacer clic en la notificación se abre la carpeta con el archivo ya
    // seleccionado, listo para arrastrarlo al software de impresión.
    noti.on("click", () => {
      sinc.marcarVisto();
      shell.showItemInFolder(entrega.destino);
    });
    noti.show();
  });

  sinc.on("error", (err) => console.error("[agente]", err.message));

  const config = await leerConfig();
  sinc.configurar(config);
  refrescarBandeja({ empresa: null, enCola: 0, sinDescargar: 0 });

  if (!configuracionCompleta(config)) {
    crearVentanaConfig();
  } else {
    try {
      const info = await sinc.verificarConexion();
      intervaloSeg = info.intervaloSegundos ?? 20;
      // El servidor puede sugerir una URL nueva (ver GET /api/agente/config)
      // -- así una futura mudanza de dominio se autocorrige sola en el
      // próximo arranque de cada PC, sin tener que reinstalar ni retocar la
      // configuración a mano.
      if (info.servidorUrl && info.servidorUrl !== config.servidorUrl) {
        const actualizado = await guardarConfig({ servidorUrl: info.servidorUrl });
        sinc.configurar(actualizado);
      }
    } catch (err) {
      console.error("[agente] no se pudo verificar la conexión:", err.message);
    }
    sincronizarYa();
  }
  arrancarCiclo();
});

app.on("second-instance", () => crearVentanaConfig());

// Es una app de bandeja: cerrar la ventana de configuración no debe cerrar el
// agente, o dejaría de bajar lienzos sin que nadie se entere. Con solo
// suscribirse a este evento (sin llamar a app.quit()) Electron ya no cierra
// la app por su cuenta.
app.on("window-all-closed", () => {});

// --- Puente con la ventana de configuración ---

ipcMain.handle("config:leer", async () => {
  const config = await leerConfig();
  return { ...config, version: VERSION_AGENTE, arrancaConWindows: app.getLoginItemSettings().openAtLogin };
});

ipcMain.handle("config:elegirCarpeta", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("config:probar", async (_e, parcial) => {
  // Se prueba contra los valores del formulario, sin guardarlos: así el
  // usuario sabe si el token sirve ANTES de pisar una configuración que
  // funcionaba.
  const previo = sinc.config;
  try {
    sinc.configurar({ ...(await leerConfig()), ...parcial });
    const info = await sinc.verificarConexion();
    return { ok: true, empresa: info.empresa };
  } catch (err) {
    sinc.configurar(previo);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("config:guardar", async (_e, parcial) => {
  const config = await guardarConfig(parcial);
  sinc.configurar(config);
  if (parcial.arrancaConWindows !== undefined) {
    app.setLoginItemSettings({ openAtLogin: Boolean(parcial.arrancaConWindows) });
  }
  try {
    const info = await sinc.verificarConexion();
    intervaloSeg = info.intervaloSegundos ?? 20;
    arrancarCiclo();
    sincronizarYa();
    return { ok: true, empresa: info.empresa };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
