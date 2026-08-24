import express from "express";
import cors from "cors";
import morgan from "morgan";
import { authRouter } from "./routes/auth.js";
import { proyectosRouter } from "./routes/proyectos.js";
import { imagenesRouter } from "./routes/imagenes.js";
import { lienzosRouter } from "./routes/lienzos.js";
import { adminRouter } from "./routes/admin.js";

export function crearApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json());
  app.use(morgan("dev"));

  app.get("/health", (req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/proyectos", proyectosRouter);
  app.use("/api", imagenesRouter);
  app.use("/api", lienzosRouter);
  app.use("/api/admin", adminRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
