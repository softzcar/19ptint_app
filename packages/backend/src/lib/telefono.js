// Normalización de teléfonos venezolanos, mismo enfoque que ya usa y prueba
// app_multi/mixins/phoneValidation.js (misma librería): no importa si el
// cliente escribe 0414..., 58414... o +58414-123-4567, siempre se resuelve
// al mismo E.164.
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * @param {string} input
 * @returns {{e164: string, ultimosDiez: string} | null} null si no es un
 *   teléfono válido. `e164` es el formato completo sin '+' (ej.
 *   "584141234567"); `ultimosDiez` es el número de abonado sin código de
 *   país, útil para buscar en Ninesys (ver clienteNinesys.js: su búsqueda no
 *   normaliza del lado de ellos, así que hace falta un substring que
 *   aparezca sea cual sea el formato en que quedó guardado).
 */
export function normalizarTelefono(input) {
  const texto = String(input ?? "").trim();
  if (!texto) return null;

  let parseado = parsePhoneNumberFromString(texto, "VE");
  if (!parseado?.isValid() && !texto.startsWith("+")) {
    // Mismo fallback que app_multi: si vino con código de país pero sin '+'
    // (ej. "584141234567"), parsePhoneNumberFromString con country="VE" lo
    // interpreta mal -- se reintenta agregando el '+' explícito.
    parseado = parsePhoneNumberFromString(`+${texto}`);
  }
  if (!parseado?.isValid()) return null;

  const e164 = parseado.format("E.164").replace("+", "");
  return { e164, ultimosDiez: e164.slice(-10) };
}
