import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin, hashPassword } from "../lib/auth.js";
import { procesosHoy } from "../lib/limites.js";
import { generarToken, hashToken } from "../lib/agenteToken.js";
import { getProductosImpresion } from "../lib/ninesysApi.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

function sinHash(usuario) {
  const { password_hash, ...resto } = usuario;
  return resto;
}

adminRouter.get("/usuarios", async (req, res) => {
  const usuarios = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
  const conUso = await Promise.all(
    usuarios.map(async (u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      limite_diario: u.limite_diario,
      created_at: u.created_at,
      usados_hoy: await procesosHoy(u.id),
    }))
  );
  res.json(conUso);
});

adminRouter.post("/usuarios", async (req, res) => {
  const { nombre, email, password, rol = "cliente", limite_diario } = req.body ?? {};
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: "nombre, email y password son requeridos" });
  }
  if (!["admin", "cliente"].includes(rol)) {
    return res.status(400).json({ error: "rol debe ser 'admin' o 'cliente'" });
  }
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe un usuario con ese email" });
  }
  const usuario = await prisma.usuario.create({
    data: {
      nombre,
      email,
      password_hash: await hashPassword(password),
      rol,
      limite_diario: limite_diario === undefined || limite_diario === "" ? null : Number(limite_diario),
    },
  });
  res.status(201).json(sinHash(usuario));
});

adminRouter.patch("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuarioId && req.body?.activo === false) {
    return res.status(400).json({ error: "No podés desactivar tu propia cuenta" });
  }
  const { nombre, rol, activo, limite_diario, password } = req.body ?? {};
  const data = {};
  if (nombre !== undefined) data.nombre = nombre;
  if (rol !== undefined) data.rol = rol;
  if (activo !== undefined) data.activo = activo;
  if (limite_diario !== undefined) data.limite_diario = limite_diario === "" || limite_diario === null ? null : Number(limite_diario);
  if (password) data.password_hash = await hashPassword(password);

  const usuario = await prisma.usuario.update({ where: { id }, data }).catch(() => null);
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(sinHash(usuario));
});

adminRouter.delete("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuarioId) {
    return res.status(400).json({ error: "No podés eliminar tu propia cuenta" });
  }
  await prisma.usuario.delete({ where: { id } }).catch(() => null);
  res.status(204).end();
});

// --- Agentes de escritorio (la PC de producción de cada empresa) ---

adminRouter.get("/agentes", async (req, res) => {
  const agentes = await prisma.empresaAgente.findMany({ orderBy: { id_empresa_ninesys: "asc" } });
  const conEstado = await Promise.all(
    agentes.map(async ({ token_hash, ...a }) => ({
      ...a,
      // Nunca se devuelve el token (ni su hash): solo si ya tiene uno puesto.
      tiene_token: Boolean(token_hash),
      pendientes: await prisma.entregaLienzo.count({
        where: { empresa_agente_id: a.id, estado: { in: ["pendiente", "error"] } },
      }),
    }))
  );
  res.json(conEstado);
});

// Genera (o rota) el token de un agente. Se devuelve en claro UNA sola vez:
// de acá en más solo queda el sha256 guardado, así que si se pierde hay que
// generar uno nuevo. Rotar invalida al instante la PC que tenía el anterior.
adminRouter.post("/agentes/:id/token", async (req, res) => {
  const id = Number(req.params.id);
  const agente = await prisma.empresaAgente.findUnique({ where: { id } });
  if (!agente) return res.status(404).json({ error: "Agente no encontrado" });

  const token = generarToken();
  await prisma.empresaAgente.update({
    where: { id },
    data: { token_hash: hashToken(token), activo: true },
  });

  res.json({
    token,
    empresa: agente.nombre,
    aviso: "Guardalo ahora: no se vuelve a mostrar. Si se pierde, generá uno nuevo.",
  });
});

adminRouter.patch("/agentes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body ?? {};
  const data = {};
  if (activo !== undefined) data.activo = Boolean(activo);

  const agente = await prisma.empresaAgente.update({ where: { id }, data }).catch(() => null);
  if (!agente) return res.status(404).json({ error: "Agente no encontrado" });
  const { token_hash, ...resto } = agente;
  res.json({ ...resto, tiene_token: Boolean(token_hash) });
});

// --- Curaduría del catálogo de servicios de Ninesys (por empresa) ---
//
// GET /products de Ninesys ya viene filtrado por es_servicio_de_impresion,
// pero esa marca la controla cada empresa desde SU panel, no esta app --
// puede traer productos que no tienen sentido para un lienzo. Acá se cruza
// el catálogo en vivo con la tabla de visibilidad (ver schema.prisma) para
// que el admin decida cuáles llegan al selector de servicio del pedido.

adminRouter.get("/servicios/:idEmpresa", async (req, res) => {
  const idEmpresa = Number(req.params.idEmpresa);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    return res.status(400).json({ error: "idEmpresa inválido" });
  }
  try {
    const [productos, visibles] = await Promise.all([
      getProductosImpresion(idEmpresa),
      prisma.servicioNinesysVisible.findMany({ where: { id_empresa_ninesys: idEmpresa } }),
    ]);
    const visiblePorCod = new Map(visibles.map((v) => [v.cod, v]));
    res.json({
      servicios: productos.map((p) => {
        const cod = String(p.cod);
        const actual = visiblePorCod.get(cod);
        // regular_price viene siempre en 0 en este catálogo -- el precio
        // real vive en products_prices, sin min/max estructurado (varios
        // tramos por cantidad, ej. "x1"/"X6"/"x 12" o "entre 1 y 9"). El
        // admin elige acá UNA vez cuál tramo usar; el pedido nunca se lo
        // muestra a quien pide el presupuesto, solo el nombre.
        const tramos = (p.prices?.length ? p.prices : [{ id: "unico", price: p.regular_price ?? 0, description: "" }]).map(
          (t) => ({ id: t.id, precio: Number(t.price), descripcion: t.description || null })
        );
        return {
          cod,
          name: p.name,
          categoria: p.categories?.[0]?.id ?? 0,
          visible: Boolean(actual),
          precio: actual ? Number(actual.precio) : null,
          tramos,
        };
      }),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Marca un producto visible en el selector del pedido con un precio fijo
// (elegido por el admin entre los tramos de Ninesys), o lo oculta.
adminRouter.put("/servicios/:idEmpresa/:cod", async (req, res) => {
  const idEmpresa = Number(req.params.idEmpresa);
  const cod = String(req.params.cod);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    return res.status(400).json({ error: "idEmpresa inválido" });
  }
  const visible = Boolean(req.body?.visible);
  if (visible) {
    const precio = Number(req.body?.precio);
    if (!Number.isFinite(precio) || precio <= 0) {
      return res.status(400).json({ error: "Falta un precio válido para mostrar este servicio" });
    }
    await prisma.servicioNinesysVisible.upsert({
      where: { id_empresa_ninesys_cod: { id_empresa_ninesys: idEmpresa, cod } },
      create: { id_empresa_ninesys: idEmpresa, cod, precio },
      update: { precio },
    });
    return res.json({ cod, visible, precio });
  }
  await prisma.servicioNinesysVisible
    .delete({ where: { id_empresa_ninesys_cod: { id_empresa_ninesys: idEmpresa, cod } } })
    .catch(() => null); // ya no estaba visible: no es un error
  res.json({ cod, visible, precio: null });
});
