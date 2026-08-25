import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";

/**
 * Tokens de los agentes de escritorio (la PC de producción de cada empresa).
 *
 * Toda la resolución token -> empresa está encapsulada acá a propósito: si
 * en la fase de seguridad se decide mover los tokens a un almacén central
 * (api_empresas u otro), solo cambia este archivo -- el resto del backend ya
 * trabaja con `id_empresa_ninesys`, igual que siempre.
 *
 * Se guarda el sha256, nunca el token en claro: permite buscarlo en O(1) (a
 * diferencia de bcrypt) y que una filtración de la DB no entregue
 * credenciales usables. sha256 pelado alcanza porque el token es aleatorio
 * de 256 bits -- no es una contraseña humana, no hay nada que "adivinar" por
 * fuerza bruta ni diccionario.
 */

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generarToken() {
  // 32 bytes -> 64 caracteres hex. El prefijo hace obvio qué es si aparece
  // suelto en un log o en un archivo de configuración.
  return `19p_${randomBytes(32).toString("hex")}`;
}

/**
 * Resuelve un token al agente/empresa que le corresponde, o null.
 * Devuelve la fila completa de EmpresaAgente (incluye id_empresa_ninesys).
 */
export async function resolverAgente(token) {
  if (typeof token !== "string" || token.length < 16) return null;

  const agente = await prisma.empresaAgente.findUnique({
    where: { token_hash: hashToken(token) },
  });
  if (!agente || !agente.activo) return null;
  return agente;
}

/**
 * Compara dos hashes en tiempo constante. La búsqueda por índice ya resuelve
 * el caso normal, pero se usa donde haga falta comparar explícitamente para
 * no filtrar información por diferencias de tiempo.
 */
export function hashesIguales(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
