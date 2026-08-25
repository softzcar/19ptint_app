const { contextBridge, ipcRenderer } = require("electron");

// Puente mínimo y explícito: la ventana de configuración no tiene acceso a
// Node ni al sistema de archivos, solo a estas cuatro operaciones concretas
// (contextIsolation activo, nodeIntegration desactivado en main.js).
contextBridge.exposeInMainWorld("agente", {
  leer: () => ipcRenderer.invoke("config:leer"),
  elegirCarpeta: () => ipcRenderer.invoke("config:elegirCarpeta"),
  probar: (parcial) => ipcRenderer.invoke("config:probar", parcial),
  guardar: (parcial) => ipcRenderer.invoke("config:guardar", parcial),
});
