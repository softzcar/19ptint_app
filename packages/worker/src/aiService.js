// Cliente HTTP compartido hacia el ai-service (FastAPI). Extraído de
// index.js para poder reusarlo también desde dtfUv.js, que necesita mandar
// campos de formulario extra (sliders) además del archivo.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

/**
 * @param {string} endpoint
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {Record<string, string|number>} [camposExtra] campos de formulario
 *   adicionales (ej. grosor_relieve_px, sensibilidad para /proponer-capas).
 * @param {string} [campoArchivo] nombre del campo del archivo -- "file" en
 *   todos los endpoints salvo /rasterizar-silueta, que espera "svg".
 * @returns {Promise<Buffer>}
 */
export async function llamarAiService(endpoint, buffer, filename, camposExtra = {}, campoArchivo = "file") {
  const form = new FormData();
  form.append(campoArchivo, new Blob([buffer]), filename);
  for (const [clave, valor] of Object.entries(camposExtra)) {
    form.append(clave, String(valor));
  }
  return _post(endpoint, form);
}

// Variante sin archivo -- /generar-patron-ia ya no recibe una imagen de
// referencia (ver dtfUv.js): es solo texto.
export async function llamarAiServiceSinArchivo(endpoint, campos = {}) {
  const form = new FormData();
  for (const [clave, valor] of Object.entries(campos)) {
    form.append(clave, String(valor));
  }
  return _post(endpoint, form);
}

// /exportar-tiff-spot recibe DOS archivos (mascara_blanco + mascara_barniz)
// más ancho_mm/alto_mm -- no encaja en llamarAiService (un solo archivo).
export async function llamarAiServiceExportarTiff(mascaraBlanco, mascaraBarniz, anchoMm, altoMm) {
  const form = new FormData();
  form.append("mascara_blanco", new Blob([mascaraBlanco]), "blanco.png");
  form.append("mascara_barniz", new Blob([mascaraBarniz]), "barniz.png");
  form.append("ancho_mm", String(anchoMm));
  form.append("alto_mm", String(altoMm));
  return _post("/exportar-tiff-spot", form);
}

async function _post(endpoint, form) {
  const resp = await fetch(`${AI_SERVICE_URL}${endpoint}`, { method: "POST", body: form });
  if (!resp.ok) {
    const detalle = await resp.text().catch(() => "");
    throw new Error(`ai-service ${endpoint} respondió ${resp.status}: ${detalle}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}
