// Determina si un teléfono pertenece a un cliente YA registrado en Ninesys,
// sin duplicar sus datos: se consulta en vivo cada vez, nunca se guarda una
// copia sincronizada del nombre/cédula/dirección en la base de esta app.
import { buscarClientes } from "./ninesysApi.js";
import { normalizarTelefono } from "./telefono.js";

// Mismo criterio que ya usa packages/frontend/src/config/empresasNinesys.js
// ("config estática, se agranda a mano"): solo el ID hace falta acá, el
// nombre/teléfono de contacto para mostrar en pantalla ya vive del lado del
// frontend.
export const IDS_EMPRESAS = [194, 208];

/**
 * Busca un cliente por teléfono exacto dentro de una empresa.
 *
 * GET /customers?buscar= de Ninesys (ninesys-api/app/lib/woome.php,
 * getAllCustomesrs) hace un LIKE crudo contra `phone` tal cual está guardado
 * -- sin normalizar del lado de ellos. Por eso se busca por los últimos 10
 * dígitos (aparecen como substring sea cual sea el formato de guardado:
 * con/sin código de país, con/sin guiones) y se confirma la coincidencia acá,
 * normalizando también el teléfono de cada candidato antes de comparar.
 */
export async function buscarClientePorTelefono(idEmpresa, telefonoNormalizado) {
  const candidatos = await buscarClientes(idEmpresa, telefonoNormalizado.ultimosDiez);
  return candidatos.find((c) => normalizarTelefono(c.phone)?.e164 === telefonoNormalizado.e164) ?? null;
}

/**
 * En qué empresas (de las que existen hoy) esta persona ya es cliente.
 * @returns {Promise<Array<{idEmpresa:number, cliente:object}>>}
 */
export async function empresasDondeEsCliente(telefonoNormalizado) {
  const resultados = await Promise.all(
    IDS_EMPRESAS.map(async (idEmpresa) => ({
      idEmpresa,
      cliente: await buscarClientePorTelefono(idEmpresa, telefonoNormalizado),
    }))
  );
  return resultados.filter((r) => r.cliente);
}
