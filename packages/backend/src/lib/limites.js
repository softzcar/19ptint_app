import { prisma } from "../db.js";

// Cuenta quitar_fondo + upscale disparados hoy (UTC) por el dueño del
// proyecto — es la operación que consume CPU real, así que es la métrica
// de límite diario que pidió el usuario (ajustable por persona).
export async function procesosHoy(usuarioId) {
  const inicioDia = new Date();
  inicioDia.setUTCHours(0, 0, 0, 0);
  return prisma.job.count({
    where: {
      tipo: { in: ["quitar_fondo", "upscale"] },
      creado_en: { gte: inicioDia },
      imagen: { proyecto: { usuario_id: usuarioId } },
    },
  });
}

export async function verificarLimiteDiario(usuarioId) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario?.limite_diario) return; // sin límite configurado
  const usados = await procesosHoy(usuarioId);
  if (usados >= usuario.limite_diario) {
    const err = new Error(
      `Alcanzaste el límite diario de ${usuario.limite_diario} procesamientos (quitar fondo + upscale). Se reinicia mañana.`
    );
    err.status = 429;
    throw err;
  }
}
