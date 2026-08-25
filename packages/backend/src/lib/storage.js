// Abstracción mínima de almacenamiento. Hoy guarda en disco local; el
// pendiente documentado en CONTEXTO.md §10 es migrar a Backblaze B2/Wasabi
// si el volumen lo justifica — para eso, solo esta función debería cambiar.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, "../../../../storage");

const CATEGORIAS = ["originales", "procesadas", "exports"];

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

export async function leer(rutaRelativa) {
  return readFile(rutaAbsoluta(rutaRelativa));
}

export { STORAGE_DIR };
