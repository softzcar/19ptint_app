import { Router } from "express";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { resolverAgente } from "../lib/agenteToken.js";
import { rutaAbsoluta, leer, tamano } from "../lib/storage.js";

export const agenteRouter = Router();

// Cada cuánto sugerimos que el agente vuelva a preguntar. Se manda desde el
// servidor para poder ajustarlo sin reinstalar los agentes.
const INTERVALO_SUGERIDO_SEG = 20;

/**
 * Carril de autenticación propio de los agentes de escritorio, separado del
 * JWT de usuario (lib/auth.js): el agente es una máquina, no una persona, y
 * su credencial no expira ni se renueva por login.
 *
 * El agente solo conoce su token -- nunca el id de empresa. Acá se resuelve
 * a qué empresa corresponde y de ahí en adelante todo filtra por
 * id_empresa_ninesys, igual que el resto del backend.
 */
async function requireAgente(req, res, next) {
  const token = req.get("X-Agente-Token");
  if (!token) return res.status(401).json({ error: "Falta el token del agente" });

  const agente = await resolverAgente(token);
  if (!agente) return res.status(401).json({ error: "Token inválido o agente desactivado" });

  req.agente = agente;

  // Heartbeat: sirve para mostrar en el panel si la PC de la empresa está en
  // línea. No se espera (no debe frenar la respuesta ni tumbarla si falla).
  prisma.empresaAgente
    .update({
      where: { id: agente.id },
      data: { ultimo_ping: new Date(), version_agente: req.get("X-Agente-Version") ?? undefined },
    })
    .catch((err) => console.error("no se pudo registrar el ping del agente:", err.message));

  next();
}

agenteRouter.use(requireAgente);

agenteRouter.get("/config", (req, res) => {
  res.json({
    empresa: req.agente.nombre,
    intervaloSegundos: INTERVALO_SUGERIDO_SEG,
  });
});

// Nombre con el que el archivo aterriza en la PC. Se prefiere algo legible
// para el operador (y rastreable contra el pedido) al UUID interno.
function nombreArchivo(lienzo) {
  const ext = (lienzo.ruta_export.split(".").pop() ?? "png").toLowerCase();
  const presupuesto = lienzo.id_presupuesto_ninesys ? `-presupuesto-${lienzo.id_presupuesto_ninesys}` : "";
  return `lienzo-${lienzo.id}${presupuesto}.${ext}`;
}

async function sha256De(rutaRelativa) {
  const buffer = await leer(rutaRelativa);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Lo que le falta bajar a esta empresa. Solo aparecen entregas cuyo lienzo YA
 * tiene el export generado: si todavía se está renderizando (job
 * `exportar_lienzo` en la cola), simplemente no se lista y aparecerá en el
 * siguiente sondeo. Así no hacen falta estados intermedios.
 */
agenteRouter.get("/pendientes", async (req, res) => {
  const entregas = await prisma.entregaLienzo.findMany({
    where: {
      empresa_agente_id: req.agente.id,
      estado: { in: ["pendiente", "error"] },
      lienzo: { ruta_export: { not: null } },
    },
    include: { lienzo: true },
    orderBy: { id: "asc" },
    take: 50,
  });

  const pendientes = [];
  for (const entrega of entregas) {
    try {
      pendientes.push({
        entregaId: entrega.id,
        lienzoId: entrega.lienzo.id,
        nombreArchivo: nombreArchivo(entrega.lienzo),
        bytes: await tamano(entrega.lienzo.ruta_export),
        sha256: await sha256De(entrega.lienzo.ruta_export),
        idPresupuesto: entrega.lienzo.id_presupuesto_ninesys,
        intentos: entrega.intentos,
        creadoEn: entrega.created_at,
      });
    } catch (err) {
      // El archivo desapareció del disco (purga manual, restore incompleto):
      // se marca para que se regenere en vez de dejar al agente reintentando
      // contra algo que ya no existe.
      console.error(`entrega ${entrega.id}: no se pudo leer el export:`, err.message);
      await prisma.entregaLienzo.update({
        where: { id: entrega.id },
        data: { estado: "error", ultimo_error: `Export no disponible en el servidor: ${err.message}` },
      });
    }
  }

  res.json({ pendientes });
});

async function cargarEntregaPropia(req, res) {
  const entrega = await prisma.entregaLienzo.findFirst({
    where: { id: Number(req.params.id), empresa_agente_id: req.agente.id },
    include: { lienzo: true },
  });
  if (!entrega) {
    res.status(404).json({ error: "Entrega no encontrada" });
    return null;
  }
  return entrega;
}

/**
 * Descarga del binario. Soporta `Range` porque son archivos grandes (~19MB
 * promedio, hasta 32MB medidos, y un DTF largo puede ser mucho más) sobre
 * conexiones que se cortan: sin esto, un corte obliga a empezar de cero.
 */
agenteRouter.get("/entregas/:id/archivo", async (req, res) => {
  const entrega = await cargarEntregaPropia(req, res);
  if (!entrega) return;
  if (!entrega.lienzo.ruta_export) {
    return res.status(409).json({ error: "El export todavía no está generado" });
  }

  const ruta = rutaAbsoluta(entrega.lienzo.ruta_export);
  let total;
  try {
    total = await tamano(entrega.lienzo.ruta_export);
  } catch {
    return res.status(410).json({ error: "El export ya no está disponible en el servidor" });
  }

  res.set("Content-Type", "application/octet-stream");
  res.set("Cache-Control", "no-store");
  res.set("Accept-Ranges", "bytes");

  const rango = req.get("Range");
  if (rango) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rango.trim());
    if (!match) {
      return res.status(416).set("Content-Range", `bytes */${total}`).end();
    }
    const inicio = Number(match[1]);
    const fin = match[2] ? Number(match[2]) : total - 1;
    if (inicio >= total || fin >= total || inicio > fin) {
      return res.status(416).set("Content-Range", `bytes */${total}`).end();
    }
    res.status(206);
    res.set("Content-Range", `bytes ${inicio}-${fin}/${total}`);
    res.set("Content-Length", String(fin - inicio + 1));
    return createReadStream(ruta, { start: inicio, end: fin }).pipe(res);
  }

  res.set("Content-Length", String(total));
  createReadStream(ruta).pipe(res);
});

agenteRouter.post("/entregas/:id/confirmar", async (req, res) => {
  const entrega = await cargarEntregaPropia(req, res);
  if (!entrega) return;

  const { sha256 } = req.body ?? {};

  // Se revalida el hash del lado del servidor: si el archivo llegó cortado o
  // corrupto, marcarlo como entregado lo haría elegible para la purga a los
  // 7 días y se perdería la única copia buena.
  if (entrega.lienzo.ruta_export && sha256) {
    let esperado;
    try {
      esperado = await sha256De(entrega.lienzo.ruta_export);
    } catch {
      esperado = null;
    }
    if (esperado && esperado !== sha256) {
      await prisma.entregaLienzo.update({
        where: { id: entrega.id },
        data: {
          estado: "error",
          intentos: { increment: 1 },
          ultimo_error: "El archivo descargado no coincide con el del servidor (sha256 distinto)",
        },
      });
      return res.status(409).json({ error: "sha256 no coincide, hay que volver a descargar" });
    }
  }

  const actualizada = await prisma.entregaLienzo.update({
    where: { id: entrega.id },
    data: { estado: "entregado", entregado_en: new Date(), ultimo_error: null },
  });
  res.json({ ok: true, entrega: actualizada });
});

agenteRouter.post("/entregas/:id/error", async (req, res) => {
  const entrega = await cargarEntregaPropia(req, res);
  if (!entrega) return;

  const mensaje = String(req.body?.mensaje ?? "error sin detalle").slice(0, 1000);
  await prisma.entregaLienzo.update({
    where: { id: entrega.id },
    data: { estado: "error", intentos: { increment: 1 }, ultimo_error: mensaje },
  });
  res.json({ ok: true });
});
