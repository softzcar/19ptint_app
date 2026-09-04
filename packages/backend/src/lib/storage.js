// Abstracción mínima de almacenamiento. Hoy guarda en disco local; el
// pendiente documentado en CONTEXTO.md §10 es migrar a Backblaze B2/Wasabi
// si el volumen lo justifica — para eso, solo esta función debería cambiar.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, "../../../../storage");

const CATEGORIAS = ["originales", "procesadas", "exports", "dtf_uv"];

export function rutaAbsoluta(rutaRelativa) {
  return path.join(STORAGE_DIR, rutaRelativa);
}

export async function guardar(categoria, buffer, extension) {
  if (!CATEGORIAS.includes(categoria)) {
    throw new Error(`categoría de storage desconocida: ${categoria}`);
  }
  const dir = path.join(STORAGE_DIR, categoria);
  await mkdir(dir, { recursive: true });
  const nombre = `${randomUUID()}${extension}`;
  const rutaRelativa = path.join(categoria, nombre);
  await writeFile(path.join(dir, nombre), buffer);
  return rutaRelativa;
}

// Como guardar(), pero a partir de un archivo ya en disco (ej. lo que
// multer con diskStorage dejó en el tmpdir) en vez de un buffer en memoria
// -- para archivos grandes sin límite de tamaño (lienzos ya armados, ver
// routes/lienzos.js), cargarlos enteros a un Buffer primero arriesga la
// memoria del VPS igual que decodificarlos (ver el incidente de CONTEXTO.md
// §14).
export async function guardarDesdeArchivo(categoria, rutaTemporal, extension) {
  if (!CATEGORIAS.includes(categoria)) {
    throw new Error(`categoría de storage desconocida: ${categoria}`);
  }
  const dir = path.join(STORAGE_DIR, categoria);
  await mkdir(dir, { recursive: true });
  const nombre = `${randomUUID()}${extension}`;
  const rutaRelativa = path.join(categoria, nombre);
  const destino = path.join(dir, nombre);
  try {
    await rename(rutaTemporal, destino);
  } catch (err) {
    // EXDEV: el tmpdir y storage/ están en filesystems/mounts distintos,
    // rename() no puede hacer un mv atómico entre ellos -- hay que copiar y
    // borrar el temporal a mano.
    if (err.code !== "EXDEV") throw err;
    await copyFile(rutaTemporal, destino);
    await unlink(rutaTemporal);
  }
  return rutaRelativa;
}

export async function leer(rutaRelativa) {
  return readFile(rutaAbsoluta(rutaRelativa));
}

export async function tamano(rutaRelativa) {
  const info = await stat(rutaAbsoluta(rutaRelativa));
  return info.size;
}

// Borra un archivo del storage. No falla si ya no existe: se llama desde
// caminos donde el archivo puede haber sido purgado antes (re-acomodar,
// eliminar lienzo, retención), y en todos ellos "no está" es el resultado
// buscado, no un error.
export async function borrar(rutaRelativa) {
  if (!rutaRelativa) return false;
  try {
    await unlink(rutaAbsoluta(rutaRelativa));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

export { STORAGE_DIR };
