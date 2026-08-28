// Convierte la primera página de un PDF a PNG usando pdftoppm (poppler-utils
// -- ya viene con el sistema en el VPS via `apt install poppler-utils`, en
// Mac vía `brew install poppler`). sharp no sirve para esto: los binarios de
// libvips que trae npm no incluyen soporte PDF (necesita poppler/pdfium
// compilado adentro, que el build oficial no trae).
//
// Solo la primera página: el uso real es un diseño DTF/sublimación de una
// página, no un documento -- si el PDF tiene más, el resto se ignora en
// silencio a propósito (no es un error, es la página que importa).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const DPI_RASTERIZADO = 300; // mismo DPI que el resto de la app asume (§5/§10).

export async function pdfAPng(buffer) {
  const dir = await mkdtemp(path.join(tmpdir(), "19print-pdf-"));
  const entrada = path.join(dir, "in.pdf");
  const salidaBase = path.join(dir, "out");
  try {
    await writeFile(entrada, buffer);
    await execFileAsync("pdftoppm", ["-png", "-r", String(DPI_RASTERIZADO), "-f", "1", "-l", "1", "-singlefile", entrada, salidaBase]);
    return await readFile(`${salidaBase}.png`);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "Falta pdftoppm en el servidor para poder leer PDFs (instalar poppler-utils / poppler, ver DEPLOY.md)."
      );
    }
    throw new Error(`No se pudo convertir el PDF a imagen: ${err.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PT_A_MM = 25.4 / 72; // un punto PDF/PostScript son 1/72 de pulgada.

// Tamaño real de la primera página de un PDF, en mm -- para "Subir lienzo
// listo" (routes/lienzos.js): un lienzo de sublimación se sube tal cual en
// PDF (es un formato de exportación válido, no se rasteriza como al subir
// una imagen de proyecto), así que sharp nunca lo ve. `pdfinfo` lee el
// tamaño de página del PDF directamente (sin rasterizar nada, mucho más
// liviano que pdftoppm) -- necesario porque si no, un lienzo subido en PDF
// queda sin ancho/alto y la cantidad a facturar en el presupuesto sale mal
// (o ni se puede calcular).
export async function pdfDimensionesMM(rutaArchivo) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("pdfinfo", [rutaArchivo]));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("Falta pdfinfo en el servidor (poppler-utils / poppler, ver DEPLOY.md).");
    }
    throw new Error(`No se pudo leer el tamaño del PDF: ${err.message}`);
  }
  const match = stdout.match(/^Page size:\s*([\d.]+)\s*x\s*([\d.]+)\s*pts/m);
  if (!match) throw new Error("pdfinfo no devolvió el tamaño de página");
  return {
    anchoMM: Number(match[1]) * PT_A_MM,
    altoMM: Number(match[2]) * PT_A_MM,
  };
}
