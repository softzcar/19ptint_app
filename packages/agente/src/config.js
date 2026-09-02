import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Configuración local del agente. Vive en la carpeta de datos del usuario
 * (AppData en Windows), NO junto al ejecutable: así sobrevive a las
 * actualizaciones de la app y no necesita permisos de administrador.
 *
 * El token es lo único que identifica a la empresa. El agente nunca conoce
 * el id de empresa -- lo resuelve el servidor a partir del token.
 */
const RUTA = () => path.join(app.getPath("userData"), "config.json");

const POR_DEFECTO = {
  servidorUrl: "https://dtf.ninesys19.com",
  token: "",
  carpetaDestino: "",
};

// Dominios viejos conocidos: un config.json ya guardado en una PC le gana al
// valor por defecto de arriba, así que cambiar POR_DEFECTO no migra nada por
// sí solo. Si lo que hay guardado es uno de estos, se corrige y se persiste
// en el primer arranque -- así una futura mudanza de dominio no vuelve a
// requerir tocar cada PC a mano (ver también GET /api/agente/config, que
// manda servidorUrl para poder ajustarlo sin reinstalar).
const DOMINIOS_VIEJOS_CONOCIDOS = new Set([
  "https://dtf.nineteencustom.com",
]);

let cache = null;

export async function leerConfig() {
  if (cache) return cache;
  try {
    const crudo = await readFile(RUTA(), "utf8");
    cache = { ...POR_DEFECTO, ...JSON.parse(crudo) };
    if (DOMINIOS_VIEJOS_CONOCIDOS.has(cache.servidorUrl)) {
      cache.servidorUrl = POR_DEFECTO.servidorUrl;
      await mkdir(path.dirname(RUTA()), { recursive: true });
      await writeFile(RUTA(), JSON.stringify(cache, null, 2), "utf8");
    }
  } catch {
    // Primera ejecución (o archivo corrupto): se arranca con los valores por
    // defecto y la ventana de configuración se abre sola por falta de token.
    cache = {
      ...POR_DEFECTO,
      carpetaDestino: path.join(app.getPath("documents"), "Lienzos 19print"),
    };
  }
  return cache;
}

export async function guardarConfig(parcial) {
  const actual = await leerConfig();
  cache = { ...actual, ...parcial };
  await mkdir(path.dirname(RUTA()), { recursive: true });
  await writeFile(RUTA(), JSON.stringify(cache, null, 2), "utf8");
  return cache;
}

export function configuracionCompleta(config) {
  return Boolean(config?.token && config?.servidorUrl && config?.carpetaDestino);
}
