import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink, open } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

export const VERSION_AGENTE = "0.1.0";

/**
 * Sincronizador: pregunta al servidor qué lienzos le faltan a esta empresa y
 * los baja a la carpeta local.
 *
 * Todo el tráfico es SALIENTE (la PC llama al servidor, nunca al revés), que
 * es lo que permite que funcione sin IP fija, sin abrir puertos en el router
 * y detrás de CGNAT.
 *
 * Eventos: 'estado' | 'descargada' | 'error'
 */
export class Sincronizador extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.empresa = null;
    this.ocupado = false;
    this.enCola = 0;
    this.progreso = null; // { nombre, actual, total, porcentaje }
    this.ultimoError = null;
    this.sinDescargar = 0; // descargas nuevas que el usuario todavía no miró
  }

  configurar(config) {
    this.config = config;
  }

  async _pedir(ruta, opts = {}) {
    const resp = await fetch(`${this.config.servidorUrl}/api/agente${ruta}`, {
      ...opts,
      headers: {
        "X-Agente-Token": this.config.token,
        "X-Agente-Version": VERSION_AGENTE,
        ...(opts.headers ?? {}),
      },
    });
    return resp;
  }

  async verificarConexion() {
    const resp = await this._pedir("/config");
    if (resp.status === 401) throw new Error("El token no es válido o el agente fue deshabilitado");
    if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`);
    const data = await resp.json();
    this.empresa = data.empresa;
    return data;
  }

  /** Un ciclo completo: consultar pendientes y bajar lo que falte. */
  async sincronizar() {
    if (this.ocupado) return;
    if (!this.config?.token) return;

    this.ocupado = true;
    try {
      const resp = await this._pedir("/pendientes");
      if (resp.status === 401) throw new Error("El token no es válido o el agente fue deshabilitado");
      if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`);

      const { pendientes } = await resp.json();
      this.enCola = pendientes.length;
      this.ultimoError = null;
      this._avisarEstado();

      for (const entrega of pendientes) {
        try {
          const destino = await this._descargar(entrega);
          this.sinDescargar += 1;
          this.enCola = Math.max(0, this.enCola - 1);
          this.emit("descargada", { ...entrega, destino });
        } catch (err) {
          this.ultimoError = err.message;
          this.emit("error", err);
          // Se le avisa al servidor para que quede registrado en el panel, y
          // se sigue con las demás: que una falle no debe frenar la cola.
          await this._pedir(`/entregas/${entrega.entregaId}/error`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensaje: err.message }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      this.ultimoError = err.message;
      this.emit("error", err);
    } finally {
      this.progreso = null;
      this.ocupado = false;
      this._avisarEstado();
    }
  }

  async _descargar(entrega) {
    // Subcarpeta por fecha: mantiene navegable la carpeta cuando se acumulan
    // muchos lienzos, y agrupa por jornada de producción.
    const dia = new Date().toISOString().slice(0, 10);
    const carpeta = path.join(this.config.carpetaDestino, dia);
    await mkdir(carpeta, { recursive: true });

    const destino = path.join(carpeta, entrega.nombreArchivo);
    // El parcial va en la MISMA carpeta que el destino final: rename solo es
    // atómico dentro del mismo sistema de archivos.
    const parcial = `${destino}.parte`;

    // Si quedó un parcial de un corte anterior, se reanuda desde ahí en vez
    // de volver a bajar los 30-50MB completos.
    let desde = 0;
    try {
      desde = (await stat(parcial)).size;
      if (desde >= entrega.bytes) desde = 0; // parcial inservible, se rehace
    } catch {
      desde = 0;
    }

    const resp = await this._pedir(`/entregas/${entrega.entregaId}/archivo`, {
      headers: desde > 0 ? { Range: `bytes=${desde}-` } : {},
    });

    if (resp.status === 416) {
      // El servidor dice que el rango no aplica (el archivo cambió): se
      // descarta el parcial y se reintenta limpio en el próximo ciclo.
      await unlink(parcial).catch(() => {});
      throw new Error("El archivo cambió en el servidor, se reintentará desde cero");
    }
    if (!resp.ok && resp.status !== 206) {
      throw new Error(`No se pudo descargar (${resp.status})`);
    }
    // Si se pidió reanudar pero el servidor mandó el archivo entero, hay que
    // escribir desde cero o el archivo quedaría con los primeros bytes
    // duplicados.
    const reanuda = resp.status === 206 && desde > 0;
    if (!reanuda) desde = 0;

    this.progreso = { nombre: entrega.nombreArchivo, actual: desde, total: entrega.bytes, porcentaje: 0 };
    this._avisarEstado();

    const salida = createWriteStream(parcial, reanuda ? { flags: "a" } : { flags: "w" });
    let bajados = desde;
    const contador = new TransformStreamContador((n) => {
      bajados += n;
      this.progreso = {
        nombre: entrega.nombreArchivo,
        actual: bajados,
        total: entrega.bytes,
        porcentaje: Math.min(100, Math.round((bajados / entrega.bytes) * 100)),
      };
      this._avisarEstado();
    });

    await pipeline(Readable.fromWeb(resp.body), contador, salida);

    // Se verifica ANTES de renombrar: si el archivo llegó corrupto nunca
    // llega a aparecer con su nombre final, así que la impresora jamás puede
    // tomar un archivo malo.
    const hash = await sha256DeArchivo(parcial);
    if (hash !== entrega.sha256) {
      await unlink(parcial).catch(() => {});
      throw new Error("El archivo llegó corrupto (sha256 no coincide), se reintentará");
    }

    // Renombrado atómico: el archivo aparece completo o no aparece. Nunca se
    // ve un archivo a medias desde el software de impresión.
    await rename(parcial, destino);

    await this._pedir(`/entregas/${entrega.entregaId}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: hash, ruta_local: destino }),
    });

    return destino;
  }

  marcarVisto() {
    this.sinDescargar = 0;
    this._avisarEstado();
  }

  _avisarEstado() {
    this.emit("estado", {
      empresa: this.empresa,
      ocupado: this.ocupado,
      enCola: this.enCola,
      progreso: this.progreso,
      ultimoError: this.ultimoError,
      sinDescargar: this.sinDescargar,
    });
  }
}

async function sha256DeArchivo(ruta) {
  const hash = createHash("sha256");
  const fd = await open(ruta, "r");
  try {
    for await (const trozo of fd.createReadStream()) hash.update(trozo);
  } finally {
    await fd.close();
  }
  return hash.digest("hex");
}

/** Stream de paso que solo cuenta bytes para poder mostrar el progreso. */
class TransformStreamContador extends Transform {
  constructor(alAvanzar) {
    super();
    this.alAvanzar = alAvanzar;
  }
  _transform(trozo, _enc, cb) {
    this.alAvanzar(trozo.length);
    cb(null, trozo);
  }
}
