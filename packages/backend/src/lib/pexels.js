// Búsqueda de imágenes en Pexels (banco de fotos libre, uso comercial sin
// atribución obligatoria — ver https://www.pexels.com/license/). Se eligió
// por encima de una búsqueda tipo Google Imágenes para evitar imprimir para
// clientes imágenes con copyright de terceros.
const BASE = "https://api.pexels.com/v1";

export async function buscarImagenes(query, pagina = 1) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error("Falta configurar PEXELS_API_KEY en el backend (packages/backend/.env)");
  }
  const url = `${BASE}/search?query=${encodeURIComponent(query)}&per_page=24&page=${pagina}`;
  const resp = await fetch(url, { headers: { Authorization: apiKey } });
  if (!resp.ok) {
    throw new Error(`Pexels respondió ${resp.status}`);
  }
  const data = await resp.json();
  return {
    pagina,
    totalResultados: data.total_results ?? 0,
    resultados: (data.photos ?? []).map((p) => ({
      id: p.id,
      autor: p.photographer,
      autorUrl: p.photographer_url,
      ancho: p.width,
      alto: p.height,
      miniatura: p.src.medium,
      previa: p.src.large,
      // "original" de Pexels a veces supera el MAX_LADO_PX de la app (fotos
      // de hasta 6000px+) y el import fallaba con 400. large2x (~1880px de
      // lado largo) entra siempre dentro del límite; si hace falta más
      // resolución después, está el botón de upscale.
      descarga: p.src.large2x,
    })),
  };
}
