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
import { encolarExportLienzo } from "../lib/queue.js";

export const ninesysRouter = Router();
ninesysRouter.use(requireAuth);

/**
 * Deja el lienzo listo para que el agente de escritorio de esa empresa lo
 * baje a su PC de producción.
 *
 * Si el export todavía no existe (el usuario mandó el pedido sin haber
 * tocado "Exportar"), se encola el render en vez de hacerlo acá: un lienzo
 * grande tarda y haría timeoutear el request del presupuesto. La entrega
 * queda creada igual y simplemente no se le ofrece al agente hasta que
 * `ruta_export` exista (ver routes/agente.js).
 */
async function encolarEntrega(lienzo, idEmpresa) {
  const agente = await prisma.empresaAgente.findUnique({
    where: { id_empresa_ninesys: idEmpresa },
  });
  if (!agente) {
    console.warn(`empresa ${idEmpresa} sin agente configurado: el lienzo ${lienzo.id} no se entregará`);
    return;
  }

  // upsert y no create: re-enviar el pedido de un lienzo ya entregado debe
  // volver a ponerlo en cola, no reventar por la unique de lienzo_id.
  await prisma.entregaLienzo.upsert({
    where: { lienzo_id: lienzo.id },
    create: { lienzo_id: lienzo.id, empresa_agente_id: agente.id },
    update: {
      empresa_agente_id: agente.id,
      estado: "pendiente",
      intentos: 0,
      ultimo_error: null,
      entregado_en: null,
      purgado_en: null,
    },
  });

  if (!lienzo.ruta_export) await encolarExportLienzo(lienzo.id);
}

function idEmpresaDeParam(req, res) {
  const idEmpresa = Number(req.params.idEmpresa);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    res.status(400).json({ error: "idEmpresa inválido" });
    return null;
  }
  return idEmpresa;
}

ninesysRouter.get("/:idEmpresa/productos-impresion", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;
  try {
    const productos = await getProductosImpresion(idEmpresa);
    res.json({ productos });
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

// Crea el presupuesto real en Ninesys a partir del servicio elegido en el
// lienzo. El campo `responsable` NO lo elige el cliente: se resuelve acá
// (último vendedor que atendió a ese teléfono, o uno al azar si es nuevo)
// vía los endpoints internos ya expuestos por ninesys-api.
ninesysRouter.post("/:idEmpresa/presupuesto", async (req, res) => {
  const idEmpresa = idEmpresaDeParam(req, res);
  if (idEmpresa === null) return;

  const { lienzoId, cliente, servicio, cantidad, obs } = req.body ?? {};
  if (!lienzoId || !cliente?.phone || !servicio?.cod || !cantidad) {
    return res.status(400).json({ error: "Faltan datos (lienzoId, cliente.phone, servicio, cantidad)" });
  }

  const lienzo = await prisma.lienzo.findFirst({
    where: { id: Number(lienzoId), proyecto: req.rol === "admin" ? {} : { usuario_id: req.usuarioId } },
  });
  if (!lienzo) return res.status(404).json({ error: "Lienzo no encontrado" });

  try {
    const responsable = await getVendedorSugerido(idEmpresa, cliente.phone);

    // presupuestos_productos.cantidad es INTEGER en ninesys-api (Postgres) --
    // se redondea hacia arriba (se factura el metro completo) para que el
    // total coincida exactamente con lo que va a quedar guardado.
    const cantidadFacturada = Math.ceil(Number(cantidad));

    const idPresupuesto = await crearPresupuesto(idEmpresa, {
      nombre: cliente.first_name,
      apellido: cliente.last_name,
      cedula: cliente.cedula,
      telefono: cliente.phone,
      email: cliente.email,
      direccion: cliente.address,
      fechaEntrega: new Date().toISOString().substring(0, 10),
      obs,
      total: Number(servicio.precio) * cantidadFacturada,
      responsable,
      productos: [
        {
          categoria: servicio.categoria ?? 0,
          talla: "Talla única",
          tela: "No aplica",
          corte: "No aplica",
          precio: Number(servicio.precio),
          producto: servicio.name,
          cod: servicio.cod,
          cantidad: cantidadFacturada,
        },
      ],
    });

    await prisma.lienzo.update({
      where: { id: lienzo.id },
      data: { id_presupuesto_ninesys: idPresupuesto, id_empresa_ninesys: idEmpresa },
    });

    // Recién en este punto se sabe a qué empresa le toca imprimir, así que
    // es acá donde se encola la entrega a su PC de producción. Nunca debe
    // tumbar la respuesta: el presupuesto ya se creó de verdad en Ninesys, y
    // un fallo de entrega se resuelve después (igual que la notificación de
    // WhatsApp más abajo).
    try {
      await encolarEntrega(lienzo, idEmpresa);
    } catch (err) {
      console.error(`no se pudo encolar la entrega del lienzo ${lienzo.id}:`, err.message);
    }

    res.status(201).json({ idPresupuesto });
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
