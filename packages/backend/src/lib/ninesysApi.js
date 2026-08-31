// Cliente HTTP hacia ninesys-api (backend PHP/Slim de Ninesys). Reutiliza
// endpoints ya existentes y probados por app_multi -- no se agrega ninguna
// lógica de negocio nueva acá, solo se llama tal cual al contrato real.
// Auth: header Authorization = id_empresa crudo (mismo mecanismo que usa
// hoy toda la API de Ninesys -- no es JWT, es el modelo de confianza
// existente, pendiente de una fase de seguridad ya diferida del lado de
// Ninesys, no algo a resolver acá).
const BASE = process.env.NINESYS_API_URL;

async function ninesysFetch(idEmpresa, path, opts = {}) {
  if (!BASE) {
    throw new Error("Falta configurar NINESYS_API_URL en el backend (packages/backend/.env)");
  }
  const resp = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: String(idEmpresa) },
  });
  const texto = await resp.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`ninesys-api respondió ${resp.status} con un cuerpo no-JSON: ${texto.slice(0, 200)}`);
  }
  return { status: resp.status, ok: resp.ok, data };
}

// Catálogo de servicios de impresión de una empresa (CONTEXTO.md §14/§15):
// filtra client-side por el flag es_servicio_de_impresion -- GET /products
// no acepta ese filtro server-side, trae el catálogo completo.
export async function getProductosImpresion(idEmpresa) {
  const { ok, data, status } = await ninesysFetch(idEmpresa, "/products");
  if (!ok) throw new Error(`GET /products respondió ${status}`);
  return (data ?? []).filter((p) => Boolean(p.es_servicio_de_impresion));
}

export async function buscarClientes(idEmpresa, texto) {
  const { ok, data, status } = await ninesysFetch(idEmpresa, `/customers?buscar=${encodeURIComponent(texto)}`);
  if (!ok) throw new Error(`GET /customers respondió ${status}`);
  return data?.data ?? [];
}

function encodeParam(v) {
  return encodeURIComponent(v ?? "");
}

// POST /customers/{first_name}/{last_name}/{cedula}/{phone}/{email}/{address}
// (params en la URL, no body JSON -- contrato real de ninesys-api). La
// respuesta cruda tiene forma distinta según el camino interno que tomó
// createCustomer() en ninesys-api (alta nueva vs. reactivación de uno
// eliminado con el mismo teléfono) -- se normaliza acá a un shape único.
export async function crearCliente(idEmpresa, { first_name, last_name, cedula, phone, email, address }) {
  const path =
    `/customers/${encodeParam(first_name)}/${encodeParam(last_name)}/${encodeParam(cedula)}` +
    `/${encodeParam(phone)}/${encodeParam(email)}/${encodeParam(address)}`;
  const { status, data } = await ninesysFetch(idEmpresa, path, { method: "POST" });
  if (status === 400 && data?.error === "phone_duplicate") {
    const err = new Error("Ya existe un cliente con ese teléfono");
    err.code = "phone_duplicate";
    err.customer = data.customer;
    throw err;
  }
  if (status >= 300) throw new Error(`POST /customers respondió ${status}`);

  const id = data?.customer?.id ?? data?.resp_insert?.insert_id ?? null;
  return { id, first_name, last_name, cedula, phone, email, address };
}

export async function actualizarCliente(idEmpresa, id, { first_name, last_name, cedula, phone, email, address }) {
  const path =
    `/customers/${id}/${encodeParam(first_name)}/${encodeParam(last_name)}/${encodeParam(cedula)}` +
    `/${encodeParam(phone)}/${encodeParam(email)}/${encodeParam(address)}`;
  const { status, data } = await ninesysFetch(idEmpresa, path, { method: "PUT" });
  if (status >= 300) throw new Error(`PUT /customers respondió ${status}`);
  return data;
}

// Resuelve el vendedor (responsable) a asignar en el presupuesto: último
// vendedor que atendió al cliente si tiene historial, si no, uno elegible
// al azar (departamento ventas/comercialización). Encadena los dos
// endpoints internos ya expuestos por ninesys-api para este propósito.
export async function getVendedorSugerido(idEmpresa, phone) {
  const porTelefono = await ninesysFetch(idEmpresa, `/internal/cliente/${idEmpresa}/by-phone?phone=${encodeURIComponent(phone)}`);
  const lastVendedorId = porTelefono.ok ? porTelefono.data?.last_vendedor_id : null;
  if (lastVendedorId) return lastVendedorId;

  const aleatorio = await ninesysFetch(idEmpresa, `/internal/vendedor-aleatorio/${idEmpresa}`);
  return aleatorio.ok ? aleatorio.data?.vendedor_id ?? null : null;
}

// POST /presupuesto/nuevo -- form-urlencoded. OJO: pese a que el endpoint
// hace json_decode() sobre casi todos los campos, el uso real dentro del
// handler es inconsistente -- `cliente_nombre` (nombre+apellido),
// `observaciones` (obs), `fecha_entrega` (fechaEntrega) y `cliente_direccion`
// (direccion) se insertan con el valor CRUDO del form, no con el resultado de
// json_decode() (confirmado end-to-end contra Dev: si se mandan entre
// comillas JSON, las comillas literales terminan en la fila; si se mandan
// sin comillas -- como direccion hasta el 2026-08-31 -- json_decode() falla
// en silencio y el campo queda vacío, bug real ya corregido del lado de
// ninesys-api). `cedula` sí pasa por json_decode() y necesita ir citada.
// `cantidad` de cada producto ya viene en metros reales (al décimo, ver
// lineaProducto() en routes/ninesys.js) -- presupuestos_productos.cantidad
// pasó a ser DECIMAL(6,1) en ninesys-api (2026-08-31), ya no hace falta
// forzar un entero acá.
export async function crearPresupuesto(idEmpresa, payload) {
  const form = new URLSearchParams();
  form.set("id", "null");
  form.set("nombre", payload.nombre ?? "");
  form.set("apellido", payload.apellido ?? "");
  form.set("cedula", JSON.stringify(payload.cedula ?? ""));
  form.set("telefono", payload.telefono ?? "");
  form.set("email", payload.email ?? "");
  form.set("direccion", payload.direccion ?? "");
  form.set("fechaEntrega", payload.fechaEntrega);
  form.set("productos", JSON.stringify(payload.productos));
  form.set("obs", payload.obs ?? "");
  form.set("total", String(payload.total));
  form.set("abono", "0");
  form.set("descuento", "0");
  form.set("responsable", payload.responsable != null ? String(payload.responsable) : "null");
  form.set("diseno_grafico", "false");
  form.set("diseno_modas", "false");
  form.set("sales_commission", "true");

  const { ok, data, status } = await ninesysFetch(idEmpresa, "/presupuesto/nuevo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!ok) throw new Error(`POST /presupuesto/nuevo respondió ${status}`);
  const idPresupuesto = data?.response?.id_presupuesto;
  if (!idPresupuesto) throw new Error("ninesys-api no devolvió id_presupuesto");
  return idPresupuesto;
}
