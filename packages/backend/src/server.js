import "dotenv/config";
import { crearApp } from "./app.js";

const PORT = process.env.PORT ?? 4000;
crearApp().listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});
