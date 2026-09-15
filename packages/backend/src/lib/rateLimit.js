// Auditoría de seguridad 2026-09-15: ningún endpoint de login de este
// backend tenía límite de intentos. El caso más grave es /auth/login-cliente
// -- la clave es un PIN de 6 dígitos (randomInt(0, 1_000_000), ver auth.js)
// que queda válido indefinidamente hasta el próximo reset, así que sin esto
// el espacio completo (1.000.000 combinaciones) es fuerza-brutéable contra
// un teléfono conocido.
//
// Deliberadamente sin dependencia externa (express-rate-limit): el backend
// corre en una sola instancia PM2 (sin cluster, ver DEPLOY.md), así que un
// Map en memoria del proceso alcanza -- no hace falta Redis ni coordinar
// estado entre procesos.
const intentos = new Map(); // key -> { count, primerIntentoEn }

const VENTANA_MS = 15 * 60 * 1000; // 15 minutos
const MAX_INTENTOS = 8;

function limpiarVencidos() {
  const ahora = Date.now();
  for (const [key, v] of intentos) {
    if (ahora - v.primerIntentoEn > VENTANA_MS) intentos.delete(key);
  }
}

/**
 * Middleware de lockout por IP + identificador. `identificador` puede ser
 * el nombre de un campo del body (string) o una función req => string --
 * esta última hace falta para /login-cliente, donde el identificador es un
 * teléfono que hay que normalizar primero (si no, "0414...", "58414..." y
 * "+58414..." cuentan como cuentas distintas y el lockout no protege
 * realmente el mismo número). Cuenta únicamente respuestas 401
 * (credenciales inválidas) -- un 400 (falta el campo) no cuenta como
 * intento fallido real.
 */
export function limitarIntentosLogin(prefijo, identificador) {
  return (req, res, next) => {
    const ip = req.ip ?? "desconocida";
    const valor = typeof identificador === "function"
      ? identificador(req)
      : String(req.body?.[identificador] ?? "").trim().toLowerCase();
    const key = `${prefijo}:${ip}:${valor}`;
    const ahora = Date.now();
    const actual = intentos.get(key);

    if (actual && ahora - actual.primerIntentoEn < VENTANA_MS && actual.count >= MAX_INTENTOS) {
      const restanteMin = Math.ceil((VENTANA_MS - (ahora - actual.primerIntentoEn)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intente de nuevo en ${restanteMin} minuto(s).` });
    }

    res.on("finish", () => {
      if (res.statusCode === 401) {
        if (!actual || ahora - actual.primerIntentoEn > VENTANA_MS) {
          intentos.set(key, { count: 1, primerIntentoEn: ahora });
        } else {
          actual.count += 1;
        }
      } else if (res.statusCode < 300) {
        intentos.delete(key); // login exitoso limpia el contador de este identificador
      }
    });

    if (Math.random() < 0.01) limpiarVencidos(); // limpieza oportunista, evita crecimiento sin límite del Map
    next();
  };
}
