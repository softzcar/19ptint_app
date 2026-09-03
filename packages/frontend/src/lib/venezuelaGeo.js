// Catálogo local de país/estado/ciudad para el formulario de alta de
// cliente (ver PedidoClienteBuscador.vue). PENDIENTE DE SINCRONIZAR: la API
// real de Ninesys (POST /customers) todavía no tiene confirmado su
// contrato exacto para estos 3 campos (nombres de parámetro, IDs vs
// nombres) -- ver CONTEXTO.md. Mientras tanto, esta lista es la fuente de
// verdad LOCAL (capitales + ciudades principales por estado, no un
// catastro exhaustivo de municipios) y el dato se guarda tal cual en
// Lienzo.cliente_pais/estado/ciudad -- una vez confirmado el contrato real
// de Ninesys, esto se reemplaza por su catálogo (probablemente con IDs
// propios) sin tocar el resto del flujo.
export const PAISES = ["Venezuela"];

export const ESTADOS_POR_PAIS = {
  Venezuela: [
    "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar",
    "Carabobo", "Cojedes", "Delta Amacuro", "Distrito Capital", "Falcón",
    "Guárico", "Lara", "Mérida", "Miranda", "Monagas", "Nueva Esparta",
    "Portuguesa", "Sucre", "Táchira", "Trujillo", "Vargas", "Yaracuy", "Zulia",
  ],
};

export const CIUDADES_POR_ESTADO = {
  "Amazonas": ["Puerto Ayacucho"],
  "Anzoátegui": ["Barcelona", "Puerto La Cruz", "Lechería", "El Tigre", "Anaco"],
  "Apure": ["San Fernando de Apure", "Guasdualito"],
  "Aragua": ["Maracay", "Turmero", "La Victoria", "Cagua"],
  "Barinas": ["Barinas", "Barinitas"],
  "Bolívar": ["Ciudad Bolívar", "Ciudad Guayana", "Upata"],
  "Carabobo": ["Valencia", "Puerto Cabello", "Guacara", "Naguanagua"],
  "Cojedes": ["San Carlos", "Tinaquillo"],
  "Delta Amacuro": ["Tucupita"],
  "Distrito Capital": ["Caracas"],
  "Falcón": ["Coro", "Punto Fijo", "Tucacas", "Chichiriviche"],
  "Guárico": ["San Juan de los Morros", "Calabozo", "Valle de la Pascua"],
  "Lara": ["Barquisimeto", "Carora", "Quíbor", "El Tocuyo"],
  "Mérida": ["Mérida", "El Vigía", "Tovar", "Ejido"],
  "Miranda": ["Los Teques", "Guarenas", "Guatire", "Petare", "Charallave"],
  "Monagas": ["Maturín", "Caripito"],
  "Nueva Esparta": ["Porlamar", "La Asunción", "Pampatar"],
  "Portuguesa": ["Guanare", "Acarigua", "Araure"],
  "Sucre": ["Cumaná", "Carúpano", "Güiria"],
  "Táchira": ["San Cristóbal", "Táriba", "La Fría", "Rubio"],
  "Trujillo": ["Trujillo", "Valera", "Boconó"],
  "Vargas": ["La Guaira", "Catia La Mar", "Maiquetía"],
  "Yaracuy": ["San Felipe", "Yaritagua"],
  "Zulia": ["Maracaibo", "Cabimas", "Ciudad Ojeda", "Machiques"],
};
