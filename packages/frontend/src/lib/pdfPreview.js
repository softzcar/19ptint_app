// Miniatura de la primera página de un PDF, 100% en el navegador (sin subir
// nada al servidor todavía) -- solo para que el usuario confirme que eligió
// el archivo correcto antes de subirlo. La conversión real para impresión
// sigue pasando por pdftoppm en el backend (ver lib/pdf.js).
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// El primer PDF de la sesión tarda en levantar el worker de pdf.js (fetch +
// arranque del script) -- ese arranque, no el render, es lo que más se
// cuelga en la práctica (worker bloqueado por un extension/red lenta, pestaña
// en segundo plano, etc). Por eso el timeout envuelve TODO el trabajo
// (getDocument + getPage + render), no solo el render -- envolver nada más
// el render dejaba el "Generando..." colgado para siempre si el cuelgue
// pasaba antes, en el arranque del worker.
const TIMEOUT_MS = 8000;

export async function miniaturaPrimeraPagina(file, anchoMaximoPx = 200) {
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  let pdf;
  let renderTask;

  const trabajo = (async () => {
    pdf = await loadingTask.promise;
    const pagina = await pdf.getPage(1);
    const viewportBase = pagina.getViewport({ scale: 1 });
    const escala = anchoMaximoPx / viewportBase.width;
    const viewport = pagina.getViewport({ scale: escala });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    // intent: "print" evita el loop interno de pdf.js que avanza el render
    // vía requestAnimationFrame -- si la pestaña está en segundo plano (p.ej.
    // el usuario cambió de tab mientras subía archivos) Chrome pausa el rAF
    // y el render se queda colgado para siempre, sin error ni resolución.
    renderTask = pagina.render({ canvasContext: ctx, viewport, canvas, intent: "print" });
    await renderTask.promise;
    return canvas.toDataURL("image/png");
  })();

  try {
    return await Promise.race([
      trabajo,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout generando la miniatura")), TIMEOUT_MS)),
    ]);
  } finally {
    // Si el timeout ganó la carrera, `trabajo` sigue corriendo de fondo --
    // nadie más la espera, así que un rechazo tardío se volvería un
    // unhandledrejection global si no se atrapa acá.
    trabajo.catch(() => {});
    // Si el timeout ganó antes de que render() arrancara, no hay renderTask
    // que cancelar; si ganó durante el render, sí.
    renderTask?.cancel();
    // `pdf` (PDFDocumentProxy) solo existe si getDocument ya resolvió -- solo
    // tiene cleanup(), no destroy() (eso es de loadingTask). Si el timeout
    // ganó ANTES de que resolviera, hay que abortar el loadingTask en su
    // lugar; llamar destroy() en el proxy nunca fue el problema real, pero
    // llamarlo cuando no corresponde sí tira TypeError.
    if (pdf) await pdf.cleanup();
    else loadingTask.destroy();
  }
}
