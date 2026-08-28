import "dotenv/config";
import { crearApp } from "./app.js";

// Express 4 no atrapa una promesa rechazada dentro de un handler async (a
// diferencia de Express 5) -- sin este catch, Node (desde v15) termina el
// proceso ENTERO por cualquier unhandledRejection, aunque sea de un solo
// request de un solo usuario. Ya pasó de verdad: un id no numérico en
// GET /lienzos/:id tumbó el server completo (ver el guard agregado en
// cargarLienzoPropio, routes/lienzos.js) -- esto es la red de seguridad para
// cualquier otro caso parecido que todavía no se vio.
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection (no tumbó el proceso, pero hay que arreglar la causa):", err);
});

const PORT = process.env.PORT ?? 4000;
crearApp().listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});
