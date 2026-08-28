import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import {
  getProductosImpresion,
  buscarClientes,
  crearCliente,
  actualizarCliente,
  getVendedorSugerido,
  crearPresupuesto,
} from "../lib/ninesysApi.js";
import { enviarWhatsapp } from "../lib/msgNinesys.js";
import { encolarEntregaLienzo } from "../lib/entregas.js";

export const ninesysRouter = Router();
ninesysRouter.use(requireAuth);

function idEmpresaDeParam(req, res) {
  const idEmpresa = Number(req.params.idEmpresa);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    res.status(400).json({ error: "idEmpresa inválido" });
    return null;
  }
  return idEmpresa;
}

// El catálogo real de Ninesys (es_servicio_de_impresion) puede traer
// productos que no tienen sentido para armar un lienzo acá, y cada uno
// puede tener varios tramos de precio por cantidad (ver ninesysApi.js) --
// se filtra contra la curaduría del admin (routes/admin.js, tabla
// servicios_ninesys_visibles) y se devuelve UN precio fijo por producto, ya
// elegido de antemano: quien pide el presupuesto solo ve el nombre del
// servicio, nunca tramos ni precios para elegir.
ninesysRouter.get("/:idEmpresa/productos-impresion", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  try {
    const [productos, visibles] = await Promise.all([
      getProductosImpresion(idEmpresa),
      prisma.servicioNinesysVisible.findMany({ where: { id_empresa_ninesys: idEmpresa } }),
    ]);
    const visiblePorCod = new Map(visibles.map((v) => [v.cod, v]));
    const servicios = productos
      .map((p) => {
        const visible = visiblePorCod.get(String(p.cod));
        if (!visible) return null;
        return {
          cod: p.cod,
          name: p.name,
          categoria: p.categories?.[0]?.id ?? 0,
          precio: Number(visible.precio),
        };
      })
      .filter(Boolean);
    res.json({ servicios });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

ninesysRouter.get("/:idEmpresa/clientes", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  const texto = (req.query.buscar ?? "").toString().trim();
  if (texto.length < 2) return res.json({ data: [] });
  try {
    const data = await buscarClientes(idEmpresa, texto);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Auto-completar el cliente al pedir presupuesto -- probado en vivo contra
// Ninesys: /customers?buscar= NO matchea por email (un cliente creado con
// un email conocido no aparece buscando por ese email, aunque el campo
// email sí está guardado y se puede confirmar buscando por nombre/cédula).
// Sí matchea por cédula, así que se usa esa en su lugar -- mismo objetivo
// (autocompletar sin que el usuario tenga que buscar), pero por un campo
// que ninesys-api realmente indexa. Igual se exige coincidencia EXACTA de
// cédula antes de devolver algo (la búsqueda de ninesys-api puede ser
// parcial): mejor no autocompletar que autocompletar con el cliente
// equivocado. Ambiguo (0 o más de 1 coincidencia) también cuenta como "no
// hay match" -- el usuario sigue el flujo manual de siempre.
ninesysRouter.get("/:idEmpresa/clientes/auto", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId } });
    const cedula = (usuario?.cedula ?? "").trim();
    if (!cedula) return res.json({ cliente: null });

    const candidatos = await buscarClientes(idEmpresa, cedula);
    const coincidencias = candidatos.filter((c) => (c.cedula ?? "").trim() === cedula);
    res.json({ cliente: coincidencias.length === 1 ? coincidencias[0] : null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

ninesysRouter.post("/:idEmpresa/clientes", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  try {
    const cliente = await crearCliente(idEmpresa, req.body ?? {});
    res.status(201).json(cliente);
  } catch (err) {
    if (err.code === "phone_duplicate") {
      return res.status(409).json({ error: err.message, code: err.code, customer: err.customer });
    }
    res.status(502).json({ error: err.message });
  }
});

ninesysRouter.put("/:idEmpresa/clientes/:id", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  try {
    const cliente = await actualizarCliente(idEmpresa, req.params.id, req.body ?? {});
    res.json(cliente);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// presupuestos_productos.cantidad es INTEGER en ninesys-api (Postgres, ver
// crearPresupuesto en ninesysApi.js, que además fuerza Math.ceil por las
// dudas) -- no puede facturar fracciones de metro directo. Redondear al
// metro entero sobrefacturaba de más: 3.001m pasaba a cobrarse como 4
// metros completos (+33%), no como los ~3.1m reales. Se factura en
// DECÍMETROS (0.1m) en vez de metros: sigue siendo un entero válido para
// Ninesys, pero 3.001m redondea a 31 decímetros (3.1m), no a 4 metros.
const DECIMETROS_POR_METRO = 10;

function redondearCentavos(n) {
  return Math.round(n * 100) / 100;
}

// Un lienzo -> una línea de producto del presupuesto: cantidad (decímetros)
// y precio unitario (precio/10, para que cantidad*precio siga dando el
// total correcto) salen de ESE lienzo puntual -- cada uno pudo subirse con
// su propia tela (sublimación) y su propio largo.
function lineaProducto(lienzo, servicio) {
  const cantidadDecimetros = Math.ceil((Number(lienzo.alto_usado_mm) / 1000) * DECIMETROS_POR_METRO);
  const precioDecimetro = redondearCentavos(Number(servicio.precio) / DECIMETROS_POR_METRO);
  return {
    categoria: servicio.categoria ?? 0,
    talla: "Talla única",
    tela: lienzo.tela?.trim() || "No aplica",
    corte: "No aplica",
    precio: precioDecimetro,
    producto: servicio.name,
    cod: servicio.cod,
    cantidad: cantidadDecimetros,
    _subtotal: precioDecimetro * cantidadDecimetros,
  };
}

// Crea el presupuesto real en Ninesys a partir del servicio elegido y uno o
// más lienzos ya armados/subidos -- varios lienzos entran como líneas de
// producto separadas de UN mismo presupuesto (cada uno con su propia
// cantidad y tela), y el total que ve Ninesys es la suma de todas. El campo
// `responsable` NO lo elige el cliente: se resuelve acá (último vendedor
// que atendió a ese teléfono, o uno al azar si es nuevo) vía los endpoints
// internos ya expuestos por ninesys-api.
ninesysRouter.post("/:idEmpresa/presupuesto", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;

  const { cliente, servicio, obs } = req.body ?? {};
  const lienzoIds = Array.isArray(req.body?.lienzoIds)
    ? req.body.lienzoIds
    : req.body?.lienzoId
      ? [req.body.lienzoId] // compat: un solo lienzo mandado como antes
      : [];
  if (!lienzoIds.length || !cliente?.phone || !servicio?.cod) {
    return res.status(400).json({ error: "Faltan datos (lienzoIds, cliente.phone, servicio)" });
  }

  const lienzos = await prisma.lienzo.findMany({
    where: {
      id: { in: lienzoIds.map(Number) },
      proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId },
    },
  });
  if (lienzos.length !== lienzoIds.length) {
    return res.status(404).json({ error: "Uno o más lienzos no se encontraron" });
  }
  const sinMedida = lienzos.filter((l) => !l.alto_usado_mm);
  if (sinMedida.length) {
    return res.status(400).json({
      error: `Falta la medida de: ${sinMedida.map((l) => `#${l.id}`).join(", ")} -- no se puede facturar sin largo`,
    });
  }

  try {
    const responsable = await getVendedorSugerido(idEmpresa, cliente.phone);

    const productos = lienzos.map((l) => lineaProducto(l, servicio));
    const total = redondearCentavos(productos.reduce((suma, p) => suma + p._subtotal, 0));
    const productosNinesys = productos.map(({ _subtotal, ...p }) => p);

    const idPresupuesto = await crearPresupuesto(idEmpresa, {
      nombre: cliente.first_name,
      apellido: cliente.last_name,
      cedula: cliente.cedula,
      telefono: cliente.phone,
      email: cliente.email,
      direccion: cliente.address,
      fechaEntrega: new Date().toISOString().substring(0, 10),
      obs,
      total,
      responsable,
      productos: productosNinesys,
    });

    await prisma.lienzo.updateMany({
      where: { id: { in: lienzos.map((l) => l.id) } },
      data: { id_presupuesto_ninesys: idPresupuesto, id_empresa_ninesys: idEmpresa },
    });

    // Recién en este punto se sabe a qué empresa le toca imprimir, así que
    // es acá donde se encola la entrega de CADA lienzo a su PC de
    // producción. Nunca debe tumbar la respuesta: el presupuesto ya se creó
    // de verdad en Ninesys, y un fallo de entrega se resuelve después
    // (igual que la notificación de WhatsApp más abajo).
    for (const lienzo of lienzos) {
      try {
        await encolarEntregaLienzo(lienzo, idEmpresa);
      } catch (err) {
        console.error(`no se pudo encolar la entrega del lienzo ${lienzo.id}:`, err.message);
      }
    }

    res.status(201).json({ idPresupuesto, total, cantidadLienzos: lienzos.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Notificación por WhatsApp, después de que el presupuesto ya existe en
// Ninesys. Nunca debe tirar 500 al frontend: un fallo acá (sesión de
// WhatsApp de la empresa no conectada, login caído, etc.) no debe leerse
// como "no se creó el presupuesto" -- el presupuesto ya es real.
ninesysRouter.post("/:idEmpresa/notificar-whatsapp", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;

  const { phone, name, message } = req.body ?? {};
  if (!phone || !message) {
    return res.status(400).json({ error: "Faltan datos (phone, message)" });
  }

  try {
    await enviarWhatsapp(idEmpresa, phone, name ?? "", message);
    res.json({ enviado: true });
  } catch (err) {
    console.error("notificar-whatsapp falló:", err);
    res.json({ enviado: false, motivo: err.message });
  }
});
