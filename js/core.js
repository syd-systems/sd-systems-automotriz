// ─── S&D Systems — Módulo: CORE ───

const SYD_VERSION = '20260831197';
// Re-trigger de build (por si el anterior quedó atascado/desactualizado en Cloudflare)
// Re-trigger de build (timeout de infraestructura en el build anterior, no relacionado al código)
console.log('%c S&D Systems %c v' + SYD_VERSION + ' ', 
  'background:#ff6b00;color:#fff;font-weight:700;padding:4px 8px;border-radius:4px 0 0 4px',
  'background:#1a1a1a;color:#ff6b00;font-weight:700;padding:4px 8px;border-radius:0 4px 4px 0');

// ─── FORMATO MONETARIO GLOBAL ───
function fmtBs(valor) {
  // Formato venezolano: punto miles, coma decimales → 408.394,34
  var n = parseFloat(valor || 0).toFixed(2);
  var partes = n.split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return partes[0] + ',' + partes[1];
}
function fmtUSD(valor) {
  // Formato venezolano: punto miles, coma decimales → 999.999,99
  return fmtBs(valor);
}
function fmtVES(valor) {
  // Alias de fmtBs — mismo formato venezolano
  return fmtBs(valor);
}
function fmtPrecioCat(precio, moneda) {
  // Formato precio catálogo: si moneda=VES muestra Bs, si USD muestra $
  var val = parseFloat(precio || 0);
  return moneda === 'VES' ? fmtBs(val) + ' Bs' : '$ ' + fmtUSD(val);
}


// ─── CONFIGURACIÓN SUPABASE ───
const SUPABASE_URL = 'https://fpqvgefclvrhfehtvkbd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwcXZnZWZjbHZyaGZlaHR2a2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1OTc5NDEsImV4cCI6MjA5MzE3Mzk0MX0.sa4GjyT-RoA_Regzjwqehfsso88bIGHTq73DqW0_1Jo';

// ─── ESTADO GLOBAL ───
let sesionActual = null;  // Usuario logueado
let _empParamCache    = {};
let modulosAcceso = [];   // Módulos a los que tiene acceso
window._tasaIVAGlobal  = null; // Alícuota de IVA vigente (decimal, ej. 0.16) -- cacheada desde param_tributos
window._tasaIGTFGlobal = null; // Alícuota de IGTF vigente (decimal, ej. 0.03) -- cacheada desde param_tributos

// Alícuota de IVA vigente, en decimal (0.16 = 16%). Devuelve el valor
// cacheado; si aún no se ha cargado, cae a 0.16 solo como último recurso.
function tasaIVAActual() {
  return (window._tasaIVAGlobal != null) ? window._tasaIVAGlobal : 0.16;
}
// Alícuota de IGTF vigente, en decimal (0.03 = 3%). Mismo criterio que IVA.
function tasaIGTFActual() {
  return (window._tasaIGTFGlobal != null) ? window._tasaIGTFGlobal : 0.03;
}

async function cargarTasaIVAGlobal() {
  try {
    const [ivaRows, igtfRows] = await Promise.all([
      api('param_tributos', 'GET', null, '?codigo=eq.IVA&estado=eq.ACTIVO&order=fecha_registro.desc&limit=1&select=alicuota'),
      api('param_tributos', 'GET', null, '?codigo=eq.IGTF&estado=eq.ACTIVO&order=fecha_registro.desc&limit=1&select=alicuota')
    ]);
    window._tasaIVAGlobal = (ivaRows && ivaRows[0] && ivaRows[0].alicuota != null)
      ? parseFloat(ivaRows[0].alicuota) / 100
      : 0.16;
    window._tasaIGTFGlobal = (igtfRows && igtfRows[0] && igtfRows[0].alicuota != null)
      ? parseFloat(igtfRows[0].alicuota) / 100
      : 0.03;
  } catch(eIVA) {
    console.warn('Error cargando tasas de IVA/IGTF vigentes, se usan valores por defecto:', eIVA);
    window._tasaIVAGlobal  = 0.16;
    window._tasaIGTFGlobal = 0.03;
  }
}

// Alícuota de un tributo (IVA/IGTF) VIGENTE EN UNA FECHA ESPECÍFICA —
// mismo patrón que la búsqueda de Tasa BCV por fecha (fecha_valor.lte).
// No filtra por estado=ACTIVO: un registro ya INACTIVO hoy (porque cambió
// la alícuota después) sigue siendo el vigente correcto para una fecha
// pasada anterior al cambio, gracias al versionado de guardarTributo().
// Devuelve el decimal (ej. 0.16) o null si no hay ningún registro <= fecha.
async function tributoVigenteEnFecha(codigo, fecha) {
  try {
    // fecha_registro es timestamp CON hora, pero 'fecha' llega como solo
    // YYYY-MM-DD -- sin esto, Postgres lo interpreta como medianoche, y un
    // tributo registrado HOY después de medianoche (ej. 11:06 AM) queda
    // excluido por el <=, cayendo erróneamente al registro más viejo.
    const finDelDia = fecha + 'T23:59:59.999';
    const rows = await api('param_tributos','GET',null,
      '?codigo=eq.'+codigo+'&fecha_registro=lte.'+finDelDia+'&order=fecha_registro.desc&limit=1&select=alicuota,fecha_registro');
    return (rows && rows[0] && rows[0].alicuota != null) ? parseFloat(rows[0].alicuota) / 100 : null;
  } catch(e) {
    console.warn('Error buscando tributo '+codigo+' vigente en fecha '+fecha+':', e);
    return null;
  }
}

// ─── ESTATUS EMPLEADO ───
const ESTATUS_EMP = {
  ACTIVO:     { clase: 'badge-verde',   label: 'Activo' },
  INACTIVO:   { clase: 'badge-rojo',    label: 'Inactivo' },
  SUSPENDIDO: { clase: 'badge-naranja', label: 'Suspendido' },
  VACACIONES: { clase: 'badge-azul',    label: 'Vacaciones' },
  REPOSO:     { clase: 'badge-gris',    label: 'Reposo' },
};

// ─── MÓDULOS DEL SISTEMA ───
const TODOS_LOS_MODULOS = [
  { sigla: 'VEHICULOS',    nombre: 'Vehículos',          icono: '🚗' },
  { sigla: 'PROPIETARIOS', nombre: 'Propietarios',       icono: '👤' },
  { sigla: 'SERVICIOS',    nombre: 'Órdenes de Servicio',icono: '🔧' },
  { sigla: 'CATALOGO',     nombre: 'Catálogo Servicios', icono: '🗂️' },
  { sigla: 'INVENTARIO',   nombre: 'Inventario',         icono: '📦' },
  { sigla: 'CONTABILIDAD', nombre: 'Contabilidad',       icono: '📒' },
  { sigla: 'FACTURAS',     nombre: 'Cuentas por Cobrar', icono: '🧾' },
  { sigla: 'PAGOS',        nombre: 'Cuentas por Pagar',  icono: '💳' },
  { sigla: 'TASAS',        nombre: 'Tipo de Cambio',     icono: '💱' },
  { sigla: 'EMISORES',     nombre: 'Datos de Empresas',  icono: '🏢' },
  { sigla: 'EMPLEADOS',    nombre: 'Empleados',          icono: '👷' },
  { sigla: 'PROVEEDORES',  nombre: 'Proveedores',        icono: '🏭' },
  { sigla: 'CLIENTES',     nombre: 'Clientes',           icono: '🧑‍🤝‍🧑' },
  { sigla: 'VENTAS',       nombre: 'Ventas',             icono: '🛒' },
  { sigla: 'TRIBUTOS',     nombre: 'Tributos',           icono: '📋' },
  { sigla: 'USUARIOS',     nombre: 'Usuarios',           icono: '🔐' },
  { sigla: 'PARAMETROS',   nombre: 'Parámetros',         icono: '⚙️' },
];

// ─── PERMISOS GRANULARES POR MÓDULO ───
const PERMISOS_POR_MODULO = {
  VEHICULOS:    [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Registrar nuevo vehículo' },
    { accion: 'EDITAR',   label: 'Editar vehículo' },
    { accion: 'ELIMINAR', label: 'Eliminar vehículo' },
  ],
  PROPIETARIOS: [
    { accion: 'VER',                  label: 'Ver Ficha' },
    { accion: 'CREAR',                label: 'Registrar propietario' },
    { accion: 'EDITAR',               label: 'Editar propietario' },
    { accion: 'ELIMINAR',             label: 'Eliminar propietario' },
    { accion: 'VER_DATOS_PERSONALES', label: '🔒 Ver datos personales (teléfono, dirección)' },
  ],
  SERVICIOS: [
    { accion: 'VER',         label: 'Ver Ficha' },
    { accion: 'CREAR',       label: 'Crear nueva OS' },
    { accion: 'EDITAR',      label: 'Editar OS abierta' },
    { accion: 'ANULAR',      label: 'Eliminar OS (antes: Anular)' },
    { accion: 'REABRIR',     label: 'Reabrir OS cerrada/anulada' },
    { accion: 'VER_TOTALES', label: '🔒 Ver totales y montos' },
    { accion: 'VER_TASA',    label: '🔒 Ver tasa de cambio en OS' },
  ],
  INVENTARIO: [
    { accion: 'VER',              label: 'Ver Ficha' },
    { accion: 'CREAR',            label: 'Registrar nuevo artículo' },
    { accion: 'EDITAR',           label: 'Editar artículo' },
    { accion: 'ELIMINAR',         label: 'Eliminar artículo' },
    { accion: 'ENTRADA_STOCK',    label: 'Registrar entrada de stock' },
    { accion: 'SALIDA_STOCK',     label: 'Registrar salida de stock' },
    { accion: 'EDITAR_STOCK',     label: 'Editar movimientos de stock (entradas/salidas)' },
    { accion: 'ANULAR_ENTRADA', label: 'Anular entradas de stock' },
    { accion: 'ANULAR_SALIDA',  label: 'Anular salidas de stock' },
    { accion: 'CAMBIAR_ESTADO', label: 'Activar / Inactivar artículos' },
    { accion: 'VER_INVENTARIO_GENERAL', label: 'Ver Inventario General completo (sin filtro de área)' },
    { accion: 'VER_MOVIMIENTOS',  label: 'Ver consulta de movimientos' },
    { accion: 'VER_CATEGORIAS',   label: 'Ver y gestionar Categorías de Inventario' },
    { accion: 'VER_TIPOS',        label: 'Ver y gestionar Tipos de Consumible' },
    { accion: 'VER_COSTOS',       label: '🔒 Ver precios de costo y CPP' },
    { accion: 'VER_PRECIOS_VENTA',label: '🔒 Ver precios de venta' },
    { accion: 'VER_EOQ_ABC',      label: '🔒 Ver análisis ABC / EOQ / Reorden' },
    { accion: 'AJUSTE_INCIDENCIA', label: '🔒 Realizar Ajuste por diferencia en Inventario (sobrante / faltante)' },
    { accion: 'VER_MARGEN_BRUTO', label: '🔒 Ver la pestaña de Margen Bruto % por Tipo de Artículo' },
    { accion: 'DEFINIR_MARGEN_BRUTO', label: '🔒 Definir/Cambiar el Margen Bruto %' },
    { accion: 'CORREGIR_MARGEN_BRUTO', label: '🔒 Corregir un Margen Bruto % ya registrado' },
    { accion: 'AJUSTAR_PRECIO_VENTA', label: '🔒 Ajustar manualmente el Precio de Venta calculado' },
    { accion: 'VER_ENTREGAS',    label: 'Ver Artículos por Entregar / pestaña Entregas de Ventas (sin el resto de Inventario)' },
    { accion: 'MARCAR_ENTREGA',  label: 'Confirmar Entrega de Mercancía Vendida al Cliente' },
  ],
  CATALOGO: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Agregar servicio al catálogo' },
    { accion: 'EDITAR',   label: 'Editar servicio del catálogo' },
    { accion: 'ELIMINAR', label: 'Eliminar servicio del catálogo' },
  ],
  TASAS: [
    { accion: 'VER',    label: 'Ver Ficha' },
    { accion: 'CREAR',  label: 'Registrar nueva tasa' },
    { accion: 'EDITAR', label: 'Editar tasa existente' },
  ],
  EMPLEADOS: [
    { accion: 'VER',                  label: 'Ver Ficha' },
    { accion: 'CREAR',                label: 'Registrar empleado' },
    { accion: 'EDITAR',               label: 'Editar empleado' },
    { accion: 'ELIMINAR',             label: 'Eliminar empleado' },
    { accion: 'VER_DATOS_PERSONALES', label: '🔒 Ver datos personales (sueldo, ID, teléfono)' },
  ],
  USUARIOS: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Crear nuevo usuario' },
    { accion: 'EDITAR',   label: 'Editar usuario' },
    { accion: 'ELIMINAR', label: 'Eliminar usuario' },
  ],
  EMISORES: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Registrar empresa' },
    { accion: 'EDITAR',   label: 'Editar empresa' },
    { accion: 'ELIMINAR', label: 'Eliminar empresa' },
  ],
  FACTURAS: [
    { accion: 'VER',         label: 'Ver Ficha' },
    { accion: 'CREAR',       label: 'Crear factura' },
    { accion: 'EDITAR',      label: 'Editar factura borrador' },
    { accion: 'APROBAR',     label: 'Aprobar factura' },
    { accion: 'ELIMINAR',    label: 'Eliminar factura anulada' },
    { accion: 'VER_TOTALES', label: '🔒 Ver montos y totales' },
  ],
  PAGOS: [
    { accion: 'VER',      label: 'Ver Obligaciones de Pago' },
    { accion: 'CREAR',    label: 'Registrar Nuevo Pago' },
    { accion: 'EDITAR',   label: 'Editar Pago Pendiente' },
    { accion: 'ELIMINAR', label: 'Anular Pago Pendiente' },
    { accion: 'APROBAR',  label: '🔒 Aprobar Pago Pendiente' },
    { accion: 'RECHAZAR', label: '🔒 Rechazar Pago Pendiente' },
    { accion: 'PAGAR',    label: 'Procesar Pago Aprobado' },
    { accion: 'ANULAR',   label: '🔒 Anular Pago Procesado' },
  ],
  CONTABILIDAD: [
    { accion: 'VER',           label: 'Ver asientos y reportes' },
    { accion: 'CREAR',         label: 'Crear asientos contables' },
    { accion: 'EDITAR',        label: 'Editar asientos en borrador' },
    { accion: 'ELIMINAR',      label: 'Eliminar asientos en borrador' },
    { accion: 'APROBAR',       label: '🔒 Aprobar asientos' },
    { accion: 'ANULAR',        label: '🔒 Anular asientos' },
    { accion: 'VER_MAYOR',     label: 'Ver libro mayor' },
    { accion: 'VER_BALANCE',   label: '🔒 Ver balance y estado de resultados' },
    { accion: 'PLAN_CUENTAS',  label: '🔒 Gestionar plan de cuentas' },
    { accion: 'PERIODOS',      label: '🔒 Gestionar períodos contables' },
    { accion: 'CXC',           label: 'Cuentas por Cobrar' },
    { accion: 'CXP',           label: 'Cuentas por Pagar' },
    { accion: 'CONCILIACION',  label: '🔒 Conciliación Bancaria' },
  ],
  PROVEEDORES: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Registrar proveedor' },
    { accion: 'EDITAR',   label: 'Editar proveedor' },
    { accion: 'ELIMINAR', label: 'Eliminar proveedor' },
  ],
  CLIENTES: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Registrar cliente' },
    { accion: 'EDITAR',   label: 'Editar cliente' },
    { accion: 'ELIMINAR', label: 'Eliminar cliente' },
  ],
  VENTAS: [
    { accion: 'VER',      label: 'Ver Ficha' },
    { accion: 'CREAR',    label: 'Armar / Facturar Venta' },
    { accion: 'EDITAR',   label: 'Editar Venta' },
    { accion: 'ELIMINAR', label: 'Eliminar Venta (Presupuesto)' },
  ],
  TRIBUTOS: [
    { accion: 'VER',    label: 'Ver Ficha' },
    { accion: 'CREAR',  label: 'Registrar tributo' },
    { accion: 'EDITAR', label: 'Editar tributo' },
    { accion: 'ELIMINAR', label: 'Eliminar tributo' },
  ],

};

// Variable global de permisos del usuario en sesión
var permisosActuales = {}; // { MODULO: ['ACCION1','ACCION2'] }

// Verificar si el usuario tiene un permiso (admins tienen todo)
function puedo(modulo, accion) {
  if (sesionActual && sesionActual.administrador) return true;
  return permisosActuales[modulo] && permisosActuales[modulo].includes(accion);
}

// Cache del "orden" jerárquico del usuario en sesión (1 = más alto, ej.
// Estratégico). Se resuelve una vez por sesión vía empleados.correo →
// id_nivel_jerarquico → param_niveles_jerarquicos.orden
let _ordenNivelSesion = undefined; // undefined = aún no resuelto, null = sin nivel asignado

// Cache del Área del empleado en sesión (para el algoritmo de enrutamiento
// de aprobación -- Nivel 2 en su Área, luego Nivel 1 subiendo por Área).
let _areaSesion = undefined; // undefined = aún no resuelto
async function _resolverAreaSesion() {
  if (_areaSesion !== undefined) return _areaSesion;
  try {
    const empRows = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(sesionActual?.correo_usuario||'')+'&select=id_area&limit=1');
    _areaSesion = empRows && empRows[0] ? empRows[0].id_area : null;
  } catch(e) { _areaSesion = null; }
  return _areaSesion;
}

async function _resolverOrdenNivelSesion() {
  if (_ordenNivelSesion !== undefined) return _ordenNivelSesion;
  try {
    if (sesionActual?.administrador) { _ordenNivelSesion = 0; return _ordenNivelSesion; } // admin siempre pasa
    const empRows = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(sesionActual?.correo_usuario||'')+'&select=id_nivel_jerarquico&limit=1');
    const idNivel = empRows && empRows[0] ? empRows[0].id_nivel_jerarquico : null;
    if (!idNivel) { _ordenNivelSesion = null; return null; }
    const nivRows = await api('param_niveles_jerarquicos','GET',null,'?id_jerarquicos=eq.'+idNivel+'&select=orden&limit=1');
    _ordenNivelSesion = nivRows && nivRows[0] ? nivRows[0].orden : null;
  } catch(e) { _ordenNivelSesion = null; }
  return _ordenNivelSesion;
}

// Monto máximo (USD) que el Nivel Jerárquico del usuario en sesión puede
// aprobar -- null = sin límite configurado (aprueba cualquier monto).
// Administrador siempre null (sin límite).
let _montoMaxAprobSesion; // undefined = aún no resuelto (para cachear, incluso si el valor real es null)
async function _resolverMontoMaxAprobacionSesion() {
  if (_montoMaxAprobSesion !== undefined) return _montoMaxAprobSesion;
  try {
    if (sesionActual?.administrador) { _montoMaxAprobSesion = null; return null; }
    const empRows = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(sesionActual?.correo_usuario||'')+'&select=id_nivel_jerarquico&limit=1');
    const idNivel = empRows && empRows[0] ? empRows[0].id_nivel_jerarquico : null;
    if (!idNivel) { _montoMaxAprobSesion = null; return null; }
    const nivRows = await api('param_niveles_jerarquicos','GET',null,'?id_jerarquicos=eq.'+idNivel+'&select=monto_maximo_aprobacion&limit=1');
    _montoMaxAprobSesion = (nivRows && nivRows[0] && nivRows[0].monto_maximo_aprobacion != null) ? Number(nivRows[0].monto_maximo_aprobacion) : null;
  } catch(e) { _montoMaxAprobSesion = null; }
  return _montoMaxAprobSesion;
}

// true si el usuario tiene el orden requerido O MEJOR (número menor = más alto)
async function tieneNivelMinimo(ordenRequerido) {
  if (sesionActual?.administrador) return true;
  const orden = await _resolverOrdenNivelSesion();
  if (orden == null) return false;
  return orden <= ordenRequerido;
}

// ─── API SUPABASE ───
// ─── EMPRESA ACTIVA ───
let _empresaActiva     = null; // { id_empresa, nombre, rif, ... }
let _empresasUsuario   = [];   // lista de empresas del usuario
let _tasaVigente       = 1;    // tasa USD→VES más reciente (se carga al iniciar)

// ─── CACHES DE MÓDULO SIN DECLARACIÓN PROPIA ───
// Solo las que NO tienen ya un 'let' en su propio archivo (ordenesCache,
// facturasCache, vehiculosCache, propietariosCache, catalogoCache,
// contAsientosCache, contCxcCache, contCxpCache YA están declaradas en
// ordenes.js/ingresos.js/vehiculos.js/catalogo.js/contabilidad.js --
// declararlas de nuevo aquí causaría SyntaxError "already declared" y
// rompería la carga completa de esos archivos, como pasó en el intento
// anterior). Estas cinco solo existían como asignación suelta dentro de
// renderModuloActual() (que únicamente corre al cambiar de Empresa) o del
// render*() de su propio módulo -- por eso Ventas fallaba con
// ReferenceError al necesitar clientesCache sin haber abierto Clientes.
let empleadosCache    = [];
let inventarioCache   = [];
let proveedoresCache  = [];
let clientesCache     = [];
let ventasCache       = [];

// JWT de sesión — se actualiza al hacer login con Supabase Auth
let _sessionJWT          = null;
let _sessionJWTExpiry    = null;
let _sessionRefreshToken = null;
let _intervalRenovacionJWT = null;

// Renueva el access_token en silencio usando el refresh_token, antes de que
// expire (dura 1h) — evita que operaciones fallen si la pestaña queda abierta
async function renovarJWTSilencioso() {
  if (!_sessionRefreshToken) return;
  try {
    const refRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: _sessionRefreshToken })
    });
    const refData = await refRes.json().catch(function() { return null; });
    if (refData && refData.access_token) {
      _sessionJWT          = refData.access_token;
      _sessionJWTExpiry    = refData.expires_at * 1000;
      _sessionRefreshToken = refData.refresh_token;
      const guardado = sessionStorage.getItem('sd_sesion') || localStorage.getItem('sd_sesion');
      if (guardado) {
        try {
          const obj = JSON.parse(guardado);
          obj.jwt = _sessionJWT; obj.jwtExpiry = _sessionJWTExpiry; obj.refreshToken = _sessionRefreshToken;
          const actualizado = JSON.stringify(obj);
          sessionStorage.setItem('sd_sesion', actualizado);
          localStorage.setItem('sd_sesion', actualizado);
        } catch(eStorage) { /* no crítico */ }
      }
    }
  } catch(eRef) { console.warn('[renovarJWTSilencioso] no se pudo renovar:', eRef); }
}

function iniciarRenovacionJWT() {
  if (_intervalRenovacionJWT) clearInterval(_intervalRenovacionJWT);
  _intervalRenovacionJWT = setInterval(renovarJWTSilencioso, 50 * 60 * 1000); // cada 50 min (expira a la hora)
  if (!window._visibilityRenovacionListener) {
    window._visibilityRenovacionListener = true;
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && _sessionRefreshToken && _sessionJWTExpiry
          && Date.now() >= (_sessionJWTExpiry - 3 * 60 * 1000)) {
        renovarJWTSilencioso();
      }
    });
  }
}

function detenerRenovacionJWT() {
  if (_intervalRenovacionJWT) { clearInterval(_intervalRenovacionJWT); _intervalRenovacionJWT = null; }
}
let _sessionEmail      = null;
let _sessionPassword   = null;
let _jwtBackoff        = null;

// Obtener JWT válido (refresca si expiró)
async function getJWT() {
  // Si hay JWT válido con más de 5 min de vida, usarlo
  if (_sessionJWT && _sessionJWTExpiry && ((_sessionJWTExpiry - Date.now()) > 300000)) {
    return _sessionJWT;
  }
  // Solo refrescar si tenemos credenciales del usuario actual
  if (!_sessionEmail || !_sessionPassword) return SUPABASE_KEY;
  // Si ya falló antes, no reintentar hasta que expire el backoff
  if (_jwtBackoff && Date.now() < _jwtBackoff) return SUPABASE_KEY;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: _sessionEmail, password: _sessionPassword })
    });
    const data = await res.json();
    if (data.access_token) {
      _sessionJWT       = data.access_token;
      _sessionJWTExpiry = Date.now() + (data.expires_in * 1000);
      _jwtBackoff       = null;
      return _sessionJWT;
    }
    // Si falla, esperar 5 minutos antes de reintentar
    _jwtBackoff = Date.now() + 300000;
  } catch(e) {}
  return SUPABASE_KEY;
}

// Obtener JWT inicial con credenciales del usuario
async function iniciarJWT(email, passwordPlano) {
  _sessionEmail    = email;
  _sessionPassword = passwordPlano;
  _sessionJWT      = null;
  _sessionJWTExpiry = null;
  return await getJWT();
}

let _renovacionEnCurso = null;

async function api(tabla, metodo = 'GET', cuerpo = null, filtro = '', sinRepresentacion = false) {
  // Si el token está por vencer (o ya venció) y hay refresh_token, renovarlo
  // ANTES de esta consulta — no depender solo del setInterval en segundo
  // plano, que los navegadores pueden pausar si la pestaña queda inactiva
  if (_sessionRefreshToken && _sessionJWTExpiry && Date.now() >= (_sessionJWTExpiry - 3 * 60 * 1000)) {
    if (!_renovacionEnCurso) _renovacionEnCurso = renovarJWTSilencioso().finally(function() { _renovacionEnCurso = null; });
    await _renovacionEnCurso;
  }
  const url = `${SUPABASE_URL}/rest/v1/${tabla}${filtro}`;
  // Usar el JWT firmado de la sesión (con permisos embebidos) si está vigente;
  // si no hay sesión o expiró, cae de vuelta a la anon key (solo lectura pública
  // según las políticas RLS de cada tabla — nunca acceso administrativo)
  const usarJWT = !!(_sessionJWT && _sessionJWTExpiry && Date.now() < _sessionJWTExpiry);
  const token = usarJWT ? _sessionJWT : SUPABASE_KEY;
  const construirOps = function(tok) {
    return {
      method: metodo,
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${tok}`,
        'Content-Type':  'application/json',
        'Prefer':        (metodo === 'POST' && !sinRepresentacion) ? 'return=representation' : 'return=minimal'
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    };
  };
  let r = await fetch(url, construirOps(token));
  // RESPALDO: si da 401 con el JWT, reintentar con la anon key para no
  // romper toda la app (defensa adicional; no debería activarse en uso normal).
  if (r.status === 401 && usarJWT) {
    console.warn('[api] JWT propio rechazado (401), reintentando con anon key:', tabla);
    r = await fetch(url, construirOps(SUPABASE_KEY));
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `Error ${r.status}`);
  }
  return metodo === 'GET' ? r.json() : (r.status === 204 ? null : r.json().catch(() => null));
}

// ── Cuentas Contables — vía función RPC (no lectura directa de la tabla) ──
// La tabla cont_cuentas tiene RLS cerrada a Administrador/Contabilidad.
// Cualquier otro módulo que necesite consultar el plan de cuentas para
// operar (Pagos, Inventario, Facturación) pasa por esta función RPC
// (security definer), que documenta explícitamente cada caso de uso en
// vez de mezclar permisos ajenos dentro de la política de la tabla.
// Se cachea en memoria porque se consulta desde muchos módulos distintos.
let _cuentasContablesCache = null;
async function obtenerCuentasContables(forzarRecarga) {
  if (_cuentasContablesCache && !forzarRecarga) return _cuentasContablesCache;
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/obtener_cuentas_contables', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + _sessionJWT,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({})
    });
    if (!resp.ok) { console.warn('obtenerCuentasContables: sin permiso o error', resp.status); return []; }
    _cuentasContablesCache = await resp.json() || [];
    return _cuentasContablesCache;
  } catch(e) {
    console.warn('Error obteniendo cuentas contables:', e);
    return _cuentasContablesCache || [];
  }
}

// ── Stock por Área — suma/resta atómica sobre inventario_stock_area ──
// delta puede ser positivo (entra/recibe) o negativo (sale/entrega).
// Si no existe la fila (id_articulo, id_area), la crea con stock_actual = delta.
// Devuelve el nuevo stock_actual resultante.
async function upsertStockArea(id_articulo, id_area, delta) {
  const fila = await api('inventario_stock_area', 'GET', null,
    '?id_articulo=eq.' + id_articulo + '&id_area=eq.' + id_area + '&select=stock_actual');
  const actual = (fila && fila[0]) ? parseFloat(fila[0].stock_actual || 0) : null;
  if (actual === null) {
    // No existe la fila — crearla directamente con el delta
    const nuevo = parseFloat(delta) || 0;
    await api('inventario_stock_area', 'POST', {
      id_articulo: id_articulo, id_area: id_area, stock_actual: nuevo
    });
    return nuevo;
  }
  const nuevoStock = parseFloat((actual + parseFloat(delta || 0)).toFixed(4));
  await api('inventario_stock_area', 'PATCH', { stock_actual: nuevoStock, actualizado_en: new Date().toISOString() },
    '?id_articulo=eq.' + id_articulo + '&id_area=eq.' + id_area);
  return nuevoStock;
}

// ── Consultar el stock DISPONIBLE (stock_actual - reservado) de un
// artículo en un área específica -- "reservado" son cantidades ya
// comprometidas por Presupuestos de Venta activos (BORRADOR/CONFIRMADA)
// que aún no se han facturado. Se resta aquí, en un solo lugar, para que
// todas las validaciones/displays existentes en Inventario (Transferencias,
// Salidas, corrección de faltantes, etc.) respeten automáticamente lo ya
// comprometido por Ventas, sin tener que tocar cada uno por separado.
async function obtenerStockArea(id_articulo, id_area) {
  const fila = await api('inventario_stock_area', 'GET', null,
    '?id_articulo=eq.' + id_articulo + '&id_area=eq.' + id_area + '&select=stock_actual,reservado');
  if (!fila || !fila[0]) return 0;
  const actual    = parseFloat(fila[0].stock_actual || 0);
  const reservado = parseFloat(fila[0].reservado || 0);
  return parseFloat((actual - reservado).toFixed(4));
}

// ── Ajustar la reserva de stock (columna 'reservado') de un artículo en
// un área específica -- mismo patrón que upsertStockArea, pero sobre la
// reserva en vez del stock real. Usado por Ventas al ingresar/quitar
// Cantidad en un Presupuesto (antes de Facturar).
async function ajustarReservaArea(id_articulo, id_area, delta) {
  const fila = await api('inventario_stock_area', 'GET', null,
    '?id_articulo=eq.' + id_articulo + '&id_area=eq.' + id_area + '&select=reservado');
  const actual = (fila && fila[0]) ? parseFloat(fila[0].reservado || 0) : null;
  if (actual === null) {
    const nuevo = Math.max(0, parseFloat(delta) || 0);
    await api('inventario_stock_area', 'POST', {
      id_articulo: id_articulo, id_area: id_area, stock_actual: 0, reservado: nuevo
    });
    return nuevo;
  }
  const nuevoReservado = Math.max(0, parseFloat((actual + parseFloat(delta || 0)).toFixed(4)));
  await api('inventario_stock_area', 'PATCH', { reservado: nuevoReservado, actualizado_en: new Date().toISOString() },
    '?id_articulo=eq.' + id_articulo + '&id_area=eq.' + id_area);
  return nuevoReservado;
}

// ── Consultar el stock CONSOLIDADO (todas las áreas) de un artículo ──
async function obtenerStockConsolidado(id_articulo) {
  const filas = await api('inventario_stock_area', 'GET', null,
    '?id_articulo=eq.' + id_articulo + '&select=stock_actual');
  return (filas || []).reduce(function(sum, f) { return sum + parseFloat(f.stock_actual || 0); }, 0);
}



// ─── CERRAR TODOS LOS MODALES ───
function cerrarTodosLosModales() {
  // Cerrar modales con clase 'abierto'
  document.querySelectorAll('.modal-overlay.abierto').forEach(function(m) {
    m.classList.remove('abierto');
  });
  // Cerrar modales con display:flex (ej: modal-cambio-clave)
  document.querySelectorAll('.modal-overlay').forEach(function(m) {
    m.style.display = 'none';
  });
  // Cerrar visor de imágenes
  var visor = document.getElementById('visor-imagen');
  if (visor) visor.style.display = 'none';
  // Cerrar aviso de inactividad
  var aviso = document.getElementById('aviso-inactividad');
  if (aviso) aviso.style.display = 'none';
  // Restaurar scroll del body
  document.body.style.overflow = '';
}

// ─── TOGGLE CONTRASEÑA ───
function resetCampoPass(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = 'password';
  input.value = '';
  // Resetear el ojo
  const btn = input.parentElement ? input.parentElement.querySelector('.ojo-btn') : null;
  if (btn) { btn.textContent = '👁'; btn.style.color = ''; }
}

function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? '👁' : '🙈';
  btn.style.color = visible ? '' : 'var(--naranja)';
}

// ─── MENÚ MÓVIL ───
function toggleMenu() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('menu-overlay');
  const abierto  = sidebar.classList.contains('abierta');
  if (abierto) {
    sidebar.classList.remove('abierta');
    overlay.style.display = 'none';
  } else {
    sidebar.classList.add('abierta');
    overlay.style.display = 'block';
  }
}

// Cerrar menú al hacer clic en un item (móvil)
function cerrarMenuMovil() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('menu-overlay');
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('abierta');
    overlay.style.display = 'none';
  }
}


// ─── CIERRE POR INACTIVIDAD (solo operadores) ───
let timerInactividad = null;
let contadorAviso   = null;
const MINUTOS_INACTIVIDAD = 10;

function iniciarTimerInactividad() {
  // ⚠️ DESACTIVADO PROVISIONALMENTE (a pedido del cliente) -- el resto de la
  // lógica de esta función y las siguientes se deja intacta para reactivar
  // fácilmente quitando este return.
  return;

  // Solo aplica a operadores
  if (!sesionActual || sesionActual.administrador) return;

  reiniciarTimerInactividad();

  // Eventos que reinician el timer
  const eventos = ['mousemove','keydown','click','scroll','touchstart'];
  eventos.forEach(e => document.addEventListener(e, reiniciarTimerInactividad));
}

function reiniciarTimerInactividad() {
  if (!sesionActual || sesionActual.administrador) return;

  // Limpiar timers anteriores
  if (timerInactividad) clearTimeout(timerInactividad);
  if (contadorAviso)   clearTimeout(contadorAviso);

  // Ocultar aviso si estaba visible
  const aviso = document.getElementById('aviso-inactividad');
  if (aviso) aviso.style.display = 'none';

  // Aviso 1 minuto antes (a los 4 minutos)
  contadorAviso = setTimeout(() => {
    mostrarAvisoInactividad();
  }, (MINUTOS_INACTIVIDAD - 1) * 60 * 1000);

  // Cerrar sesión a los 5 minutos
  timerInactividad = setTimeout(() => {
    cerrarSesionInactividad();
  }, MINUTOS_INACTIVIDAD * 60 * 1000);
}

function detenerTimerInactividad() {
  if (timerInactividad) clearTimeout(timerInactividad);
  if (contadorAviso)   clearTimeout(contadorAviso);
  const aviso = document.getElementById('aviso-inactividad');
  if (aviso) aviso.style.display = 'none';
  const eventos = ['mousemove','keydown','click','scroll','touchstart'];
  eventos.forEach(e => document.removeEventListener(e, reiniciarTimerInactividad));
}

function mostrarAvisoInactividad() {
  if (!sesionActual || sesionActual.administrador) return;
  const aviso = document.getElementById('aviso-inactividad');
  if (aviso) {
    aviso.style.display = 'flex';
    // Cuenta regresiva de 60 segundos
    let seg = 60;
    const contador = document.getElementById('inactividad-contador');
    if (contador) contador.textContent = seg;
    const interval = setInterval(() => {
      seg--;
      if (contador) contador.textContent = seg;
      if (seg <= 0) clearInterval(interval);
    }, 1000);
  }
}

async function cerrarSesionInactividad() {
  const correo = sesionActual?.correo_usuario;
  try {
    if (correo) await api('usuarios', 'PATCH', {
      sesion_activa: false,
      ultima_desconexion: new Date().toISOString()
    }, `?correo_usuario=eq.${encodeURIComponent(correo)}`);
  } catch(e) { console.error('Error marcando desconexión:', e); }
  limpiarSesionLocal();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '⏱ Sesión cerrada por inactividad.';
  errEl.style.display = 'block';
  errEl.style.background = 'rgba(255,107,0,0.12)';
  errEl.style.borderColor = 'rgba(255,107,0,0.4)';
  errEl.style.color = 'var(--naranja)';
}

// ─── RELOJ ───
function actualizarReloj() {
  const ahora = new Date();
  const f = ahora.toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const h = ahora.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });
  const el = document.getElementById('topbar-fecha');
  if (el) el.textContent = `${f}  ${h}`;
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ─── VERIFICAR SESIÓN INVALIDADA (cada 30 segundos) ───
// Forzar la verificación de sesión de inmediato al volver la pestaña a
// primer plano -- el setInterval de 30s puede quedar pausado por el
// navegador mientras la pestaña está en segundo plano (ahorro de
// recursos), dejando esa pestaña sin detectar que su sesión ya fue
// reemplazada por un inicio de sesión en otro lugar. Sin este refuerzo,
// dos sesiones simultáneas del mismo usuario podían parecer "activas"
// indefinidamente con solo dejar una pestaña de fondo.
if (!window._visibilitySesionListener) {
  window._visibilitySesionListener = true;
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && sesionActual && window._miTokenSesion && window._sesionLista) {
      verificarSesionActiva();
    }
  });
}

async function verificarSesionActiva() {
  if (!sesionActual) return;
  if (!window._miTokenSesion) return;
  if (!window._sesionLista) return; // Esperar hasta que la sesión esté completamente iniciada
  try {
    const res = await api('usuarios', 'GET', null,
      `?correo_usuario=eq.${encodeURIComponent(sesionActual.correo_usuario)}&select=sesion_activa,sesion_invalidada,estado_usuario,token_sesion`);
    if (!res || !res.length) return;
    const u = res[0];

    // ── CASO 0: Sesión desplazada — otro dispositivo inició sesión ──
    // Solo expulsar si _miTokenSesion está asignado Y es diferente al de BD
    if (window._miTokenSesion && u.token_sesion && u.token_sesion !== window._miTokenSesion) {
      console.warn('[polling] CASO 0 — token diferente. BD:', u.token_sesion, '| local:', window._miTokenSesion);
      limpiarSesionLocal();
      const errEl = document.getElementById('login-error');
      if (errEl) {
        errEl.textContent = '⚠️ Tu sesión fue cerrada porque iniciaste sesión en otro dispositivo.';
        errEl.style.display = 'block';
      }
      document.getElementById('pantalla-login').style.display = 'flex';
      document.getElementById('pantalla-app').style.display   = 'none';
      setTimeout(function() { document.getElementById('login-correo')?.focus(); }, 200);
      return;
    }

    // ── CASO 1: Usuario desactivado → expulsar ──
    if (u.estado_usuario === 'INACTIVO') {
      console.warn('[polling] CASO 1 — usuario INACTIVO');
      const correoActual = sesionActual.correo_usuario;
      limpiarSesionLocal();
      try { await api('usuarios', 'PATCH', { sesion_invalidada: false }, `?correo_usuario=eq.${encodeURIComponent(correoActual)}`); } catch(e) {}
      const errEl = document.getElementById('login-error');
      errEl.textContent = '🚫 Tu usuario fue desactivado por el administrador.';
      errEl.style.display = 'block';
      errEl.style.background = 'rgba(255,107,0,0.12)';
      errEl.style.borderColor = 'rgba(255,107,0,0.4)';
      errEl.style.color = 'var(--naranja)';
      return;
    }

    // ── CASO 2: Sesión cerrada por admin (sesion_invalidada=true + sesion_activa=false) → expulsar ──
    // Requiere AMBAS condiciones para evitar falsos positivos del beforeunload
    if (u.sesion_activa === false && u.sesion_invalidada === true) {
      console.warn('[polling] CASO 2 — sesion_activa:', u.sesion_activa, '| sesion_invalidada:', u.sesion_invalidada);
      const correoActual = sesionActual.correo_usuario;
      limpiarSesionLocal();
      try { await api('usuarios', 'PATCH', { sesion_invalidada: false }, `?correo_usuario=eq.${encodeURIComponent(correoActual)}`); } catch(e) {}
      const errEl = document.getElementById('login-error');
      errEl.textContent = '🔒 Tu sesión fue cerrada por el administrador.';
      errEl.style.display = 'block';
      errEl.style.background = 'rgba(255,107,0,0.12)';
      errEl.style.borderColor = 'rgba(255,107,0,0.4)';
      errEl.style.color = 'var(--naranja)';
      return;
    }

    // ── CASO 3: Permisos modificados (sesion_invalidada=true pero activo) → recargar sin expulsar ──
    if (u.sesion_invalidada === true) {
      console.warn('[polling] CASO 3 — permisos modificados');
      try {
        const perms = await api('usuarios_permisos', 'GET', null,
          '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario));
        permisosActuales = {};
        perms.forEach(function(p) {
          if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
          permisosActuales[p.modulo].push(p.accion);
        });
        const accesos = await api('usuarios_accesos', 'GET', null,
          '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario) + '&activo=eq.true&select=acceso_tipo');
        modulosAcceso = accesos.map(a => a.acceso_tipo);
        cargarTasaIVAGlobal();
        await api('usuarios', 'PATCH', { sesion_invalidada: false },
          `?correo_usuario=eq.${encodeURIComponent(sesionActual.correo_usuario)}`);
      } catch(eP) {}
    }

    // Heartbeat -- si llegamos hasta aquí, la sesión está sana (no se
    // expulsó en ningún CASO anterior). Actualizar ultima_conexion para
    // que la lista de Usuarios pueda mostrar correctamente "En línea"
    // mientras la sesión siga activa, no solo en el momento del login.
    try {
      await api('usuarios', 'PATCH', { ultima_conexion: new Date().toISOString() },
        `?correo_usuario=eq.${encodeURIComponent(sesionActual.correo_usuario)}`);
    } catch(eHb) {}
  } catch(e) {}
}
let _pollingInterval = setInterval(verificarSesionActiva, 30000);
let _intervalRefrescarUsuarios = null; // auto-refresco de la lista de Usuarios mientras esa pantalla esté abierta

// ─── LOGIN ───
document.getElementById('login-clave').addEventListener('keypress', e => {
  if (e.key === 'Enter') iniciarSesion();
});
// Auto login on Tab from password field
document.getElementById('login-clave').addEventListener('keydown', function(e) {
  if (e.key === 'Tab' && this.value.length >= 6) {
    e.preventDefault();
    iniciarSesion();
  }
});

async function iniciarSesion() {
  const correo = document.getElementById('login-correo').value.trim();
  const clave  = document.getElementById('login-clave').value;
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('btn-ingresar');

  errEl.style.display = 'none';

  if (!correo || !clave) {
    mostrarError('Por favor complete todos los campos.');
    return;
  }

  btn.textContent = 'VERIFICANDO...';
  btn.disabled = true;

  try {
    // Login REAL de Supabase Auth (auth.users) — el hook custom_access_token_hook
    // ya inyecta administrador/permisos/correo_usuario en el access_token, firmado
    // por Supabase con sus propias llaves (ya no firmamos nosotros el JWT)
    const loginRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave })
    });
    const loginData = await loginRes.json().catch(function() { return null; });
    if (!loginData || !loginData.access_token) {
      mostrarError((loginData && (loginData.msg || loginData.error_description)) || 'Correo o contraseña incorrectos.');
      return;
    }
    _sessionJWT          = loginData.access_token;
    _sessionJWTExpiry    = loginData.expires_at * 1000;
    _sessionRefreshToken = loginData.refresh_token;
    iniciarRenovacionJWT();

    // Traer el perfil completo con el JWT propio (ya autenticado, solo puede
    // devolver su propia fila una vez apliquemos RLS granular sobre usuarios)
    let usuInfoRes = await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' + encodeURIComponent(correo) + '&select=*', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + _sessionJWT }
    });
    let usuInfo = usuInfoRes.ok ? await usuInfoRes.json().catch(function() { return null; }) : null;

    // RESPALDO: por si algún día el token real fallara por cualquier motivo,
    // no dejar a nadie sin poder iniciar sesión.
    if (!usuInfo || !usuInfo.length) {
      usuInfoRes = await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' + encodeURIComponent(correo) + '&select=*', {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
      });
      usuInfo = await usuInfoRes.json().catch(function() { return null; });
    }

    const u = usuInfo && usuInfo[0];
    if (!u) {
      mostrarError('Error obteniendo datos de usuario. Intente de nuevo.');
      return;
    }

    if (u.estado_usuario === 'INACTIVO') {
      mostrarError('Usuario inactivo. Contacte al administrador.');
      // Revocar el token recién emitido -- no dejar un JWT válido activo
      // para una cuenta inactiva, aunque la pantalla de login lo bloquee.
      try {
        await fetch(SUPABASE_URL + '/auth/v1/logout', {
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + _sessionJWT }
        });
      } catch(eLogoutInactivo) {}
      _sessionJWT = null; _sessionRefreshToken = null; _sessionJWTExpiry = null;
      btn.textContent = 'INGRESAR';
      btn.disabled = false;
      return;
    }

    if (u.cambiar_clave) {
      // Mostrar modal de cambio obligatorio
      const avisoEl = document.getElementById('cambio-aviso');
      if (avisoEl) {
        avisoEl.textContent = '⚠️ Por seguridad debes cambiar tu contraseña antes de continuar.';
        avisoEl.style.display = 'block';
      }
      document.getElementById('cambio-titulo').textContent = 'CAMBIO DE CONTRASEÑA OBLIGATORIO';
      if (document.getElementById('cambio-nueva'))     document.getElementById('cambio-nueva').value     = '';
      if (document.getElementById('cambio-confirmar')) document.getElementById('cambio-confirmar').value = '';
      if (document.getElementById('cambio-error'))     document.getElementById('cambio-error').style.display  = 'none';
      if (document.getElementById('cambio-exito'))     document.getElementById('cambio-exito').style.display  = 'none';
      // Guardar correo temporalmente para el cambio
      window._cambioClaveCorreo = correo;
      window._cambioClaveActual = clave;
      document.getElementById('modal-cambio-clave').style.display = 'flex';
      btn.textContent = 'INGRESAR';
      btn.disabled = false;
      return;
    }

    // Si hay sesión activa en otro dispositivo, cerrarla automáticamente y permitir la nueva
    const miToken = Math.random().toString(36).substr(2) + Date.now().toString(36);
    window._miTokenSesion = miToken;
    // Escribir token en BD ANTES de habilitar el polling
    await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' + encodeURIComponent(correo), {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + _sessionJWT, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ sesion_activa: true, sesion_invalidada: false, ultimo_acceso: new Date().toISOString(), ultima_conexion: new Date().toISOString(), token_sesion: miToken })
    });
    // Reiniciar polling DESPUÉS de confirmar el token en BD
    clearInterval(_pollingInterval);
    _pollingInterval = setInterval(verificarSesionActiva, 30000);

    // Obtener accesos del usuario
    const accesos = await api('usuarios_accesos', 'GET', null,
      `?correo_usuario=eq.${encodeURIComponent(correo)}&activo=eq.true&select=acceso_tipo`);

    sesionActual = u;
    modulosAcceso = accesos.map(a => a.acceso_tipo);
    cargarTasaIVAGlobal(); // no bloqueante -- los cálculos usan tasaIVAActual() con fallback

    // Cargar permisos granulares
    try {
      const perms = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(u.correo_usuario));
      permisosActuales = {};
      perms.forEach(function(p) {
        if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
        permisosActuales[p.modulo].push(p.accion);
      });
    } catch(eP) { console.warn('Error cargando permisos al login:', eP); }

    // Reintentar (sin bloquear el login) el enrutamiento de Obligaciones que
    // se quedaron sin nadie disponible para aprobar -- ahora que esta sesión
    // está activa, puede que esta persona (u otra que también volvió a
    // conectarse) sea justo quien hacía falta.
    fetch(SUPABASE_URL + '/rest/v1/rpc/reintentar_enrutamiento_pendientes', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + _sessionJWT, 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function(r){ return r.json(); }).then(function(d){ console.log('[reintento de enrutamiento]', d); }).catch(function(e){ console.warn('Error en reintento de enrutamiento:', e); });

    // (sesion_activa y token_sesion ya actualizados en el fetch anterior)

    resetCampoPass('login-clave');

    // Determinar empresa activa
    try {
      const todasEmisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*');

      if (u.administrador) {
        // Admin ve todas las empresas
        _empresasUsuario = todasEmisores;
        if (todasEmisores.length === 1) _empresaActiva = todasEmisores[0];
      } else {
        // Usuario normal: filtrar por usuarios_empresas
        try {
          const ues = await api('usuarios_empresas','GET',null,
            '?correo_usuario=eq.'+encodeURIComponent(correo)+'&activo=eq.true&select=id_empresa');
          const idsPermitidos = new Set(ues.map(function(x){ return x.id_empresa; }));
          _empresasUsuario = todasEmisores.filter(function(e){ return idsPermitidos.has(e.id_empresa); });
        } catch(eUE) { _empresasUsuario = []; }

        // Empresa activa = empresa de la ficha de empleado. Se usa una
        // función RPC dedicada (security definer) en vez de leer la tabla
        // empleados directamente -- así no depende del permiso del módulo
        // EMPLEADOS (que no debería aplicar para esto), y sin exponer el
        // resto de la ficha (salario, evaluaciones, etc.), solo el id_empresa.
        let idEmpresaEmpleado = null;
        try {
          const respEmp = await fetch(SUPABASE_URL + '/rest/v1/rpc/obtener_mi_empresa', {
            method: 'POST',
            headers: {
              'apikey':        SUPABASE_KEY,
              'Authorization': 'Bearer ' + _sessionJWT,
              'Content-Type':  'application/json'
            },
            body: JSON.stringify({})
          });
          if (respEmp.ok) idEmpresaEmpleado = await respEmp.json();
        } catch(eRpcEmp) { console.warn('Error obteniendo empresa del empleado:', eRpcEmp); }
        if (idEmpresaEmpleado) {
          _empresaActiva = todasEmisores.find(function(e){ return e.id_empresa === idEmpresaEmpleado; }) || null;
        }
        if (!_empresaActiva) {
          mostrarError('No tiene empresa asignada. Contacte al administrador.');
          limpiarSesionLocal();
          btn.textContent = 'INGRESAR';
          btn.disabled = false;
          return;
        }
      }
    } catch(e) { console.warn(e); }

    // Entrar al sistema — siempre directo, cambio de empresa desde sidebar
    if (!_empresaActiva && _empresasUsuario.length > 0) {
      _empresaActiva = _empresasUsuario[0];
    }
    // Guardar sesión, empresa y JWT firmado en sessionStorage Y localStorage
    const sesionData = JSON.stringify({ usuario: u, accesos: modulosAcceso, jwt: _sessionJWT, jwtExpiry: _sessionJWTExpiry, refreshToken: _sessionRefreshToken });
    sessionStorage.setItem('sd_sesion', sesionData);
    localStorage.setItem('sd_sesion', sesionData);
    if (_empresaActiva) {
      sessionStorage.setItem('sd_empresa_activa', JSON.stringify(_empresaActiva));
      localStorage.setItem('sd_empresa_activa', JSON.stringify(_empresaActiva));
    }
    window._sesionLista = true; // Habilitar polling — token ya confirmado en BD
    iniciarApp();
    setTimeout(verificarNotificacionesPendientes, 2000);
    btn.textContent = 'INGRESAR';
    btn.disabled = false;
















    iniciarTimerInactividad();

    // Verificar vencimiento de clave DESPUÉS de iniciar app
    if (verificarVencimientoClave(u)) {
      mostrarCambioObligatorio(true);
    } else {
      const diasRestantes = diasRestantesClave(u);
      if (diasRestantes <= 15) {
        // Avisar si quedan 15 días o menos
        setTimeout(() => {
          if (confirm(`⚠️ Tu contraseña vence en ${diasRestantes} días.\n¿Deseas cambiarla ahora?`)) {
            mostrarCambioObligatorio(false);
          }
        }, 1000);
      }
    }

  } catch (e) {
    mostrarError('No se pudo conectar al servidor. Verifique su conexión.');
    console.error(e);
  } finally {
    btn.textContent = 'INGRESAR';
    btn.disabled = false;
  }
}

function mostrarError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ─── ACTUALIZAR UI DE EMPRESA ───
function actualizarEmpresaUI() {
  if (!_empresaActiva) return;
  const empEl = document.getElementById('empresa-activa-nombre');
  if (empEl) empEl.textContent = '🏢 ' + _empresaActiva.nombre;
  const topbarEmp = document.getElementById('topbar-empresa');
  if (topbarEmp) topbarEmp.textContent = '🏢 ' + _empresaActiva.nombre;
  try { var _taEl=document.getElementById('topbar-area'); if(_taEl && sesionActual && sesionActual.correo_usuario){ api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=areas:id_area(nombre,codigo)&limit=1').then(function(ea){ var ar=ea&&ea[0]?ea[0].areas:null; if(_taEl) _taEl.textContent=ar?ar.nombre+' ('+(ar.codigo||'')+')':''; }); } else if(_taEl){ _taEl.textContent=''; } } catch(eA){}
  const btnCambiar = document.getElementById('btn-cambiar-empresa');
  if (btnCambiar) btnCambiar.style.display = _empresasUsuario.length > 1 ? '' : 'none';
}

// ─── INICIAR APP ───
function iniciarApp() {
  document.getElementById('pantalla-login').style.display = 'none';
  document.getElementById('pantalla-app').style.display = 'block';

  // Restaurar empresa activa desde localStorage si no esta cargada
  if (!_empresaActiva) {
    try {
      var _empGuardada = localStorage.getItem('sd_empresa_activa');
      if (_empGuardada) _empresaActiva = JSON.parse(_empGuardada);
    } catch(e) {}
  }
  if (!_empresasUsuario || !_empresasUsuario.length) {
    api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*').then(function(r) {
      if (r && r.length) {
        _empresasUsuario = r;
        if (!_empresaActiva) _empresaActiva = r[0];
        if (typeof actualizarEmpresaUI === 'function') actualizarEmpresaUI();
      }
    }).catch(function(){});
  }

  // Actualizar datos del usuario en sidebar
  const nombre = sesionActual.nombre || sesionActual.correo_usuario;
  document.getElementById('nombre-usuario').textContent = nombre;
  // Mostrar empresa activa en sidebar y topbar
  actualizarEmpresaUI();
  document.getElementById('rol-usuario').textContent = sesionActual.administrador ? 'Administrador' : 'Operador';
  document.getElementById('avatar-inicial').textContent = nombre.charAt(0).toUpperCase();

  // Mostrar días restantes de clave
  const diasClave = diasRestantesClave(sesionActual);
  const elDias = document.getElementById('dias-clave');
  if (elDias) {
    if (diasClave <= 15) {
      elDias.textContent = `⚠️ Clave vence en ${diasClave}d`;
      elDias.style.color = diasClave <= 5 ? '#fc8181' : '#FF6B00';
    } else {
      elDias.textContent = `🔒 Clave: ${diasClave}d restantes`;
      elDias.style.color = '#555';
    }
  }

  // Mostrar módulos según accesos
  const esAdmin = sesionActual.administrador;
  TODOS_LOS_MODULOS.forEach(m => {
    const nav = document.getElementById(`nav-${m.sigla}`);
    if (nav) {
      if (esAdmin || modulosAcceso.includes(m.sigla)) {
        nav.style.display = 'flex';
      }
    }
  });
  // Parámetros: visible solo para administradores
  const navParam = document.getElementById('nav-PARAMETROS');
  if (navParam) navParam.style.display = esAdmin ? 'flex' : 'none';

  mostrarModulo('dashboard', null);

  // Cargar tasa USD vigente como global para todos los módulos
  api('tasas', 'GET', null, '?moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio')
    .then(function(r) { if (r && r[0]) _tasaVigente = parseFloat(r[0].tipo_cambio) || 1; })
    .catch(function() {});
}

// ─── LIMPIEZA COMPLETA DE SESIÓN ───
// ─── SELECCIÓN DE EMPRESA ───
function mostrarSeleccionEmpresa() {
  // Mostrar modal de selección sobre la app (no reusar pantalla-login)
  let selModal = document.getElementById('modal-seleccion-empresa');
  if (!selModal) {
    selModal = document.createElement('div');
    selModal.id = 'modal-seleccion-empresa';
    selModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(selModal);
  }
  selModal.style.display = 'flex';
  selModal.innerHTML =
    '<div style="background:var(--fondo);border-radius:12px;padding:48px 40px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto">'
    + '<div style="font-family:var(--font-display);font-size:32px;letter-spacing:2px;color:var(--naranja);margin-bottom:8px">SELECCIONAR EMPRESA</div>'
    + '<div style="color:var(--suave);font-size:13px;margin-bottom:32px">Selecciona la empresa con la que deseas operar</div>'
    + _empresasUsuario.map(function(e) {
        return '<button onclick="seleccionarEmpresa('+e.id_empresa+')" '
          + 'style="background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:16px 20px;'
          + 'text-align:left;cursor:pointer;margin-bottom:10px;width:100%;transition:all 0.15s;font-family:var(--font-body)"'
          + ' >'
          + '<div style="font-family:var(--font-display);font-size:18px;letter-spacing:1px;color:var(--texto)">'
          + '🏢 ' + e.nombre + '</div>'
          + '<div style="font-size:11px;color:var(--suave);margin-top:4px">' + (e.rif||'') + '</div>'
          + '</button>';
      }).join('')
    + '<button onclick="cerrarSesion()" style="background:none;border:none;color:var(--suave);font-size:12px;cursor:pointer;margin-top:16px;display:block">← Cerrar sesión</button>'
    + '</div>';
}

function seleccionarEmpresa(id_emisor) {
  id_emisor = parseInt(id_emisor);
  _empresaActiva = _empresasUsuario.find(function(e){ return e.id_empresa === id_emisor; });
  if (!_empresaActiva) return;
  // Al cambiar de empresa, la vista de Contabilidad debe volver a tomar la
  // Moneda Principal de la ficha de ESTA empresa -- si se dejaba el valor
  // de la empresa anterior, podía mostrar la moneda equivocada.
  if (typeof _contMoneda !== 'undefined') _contMoneda = null;
  // Guardar empresa activa en sessionStorage y localStorage
  sessionStorage.setItem('sd_empresa_activa', JSON.stringify(_empresaActiva));
  localStorage.setItem('sd_empresa_activa', JSON.stringify(_empresaActiva));
  // Cerrar modal de selección
  const selModal = document.getElementById('modal-seleccion-empresa');
  if (selModal) selModal.style.display = 'none';
  // Actualizar sidebar — forzar visible para admin con varias empresas
  const empEl = document.getElementById('empresa-activa-nombre');
  if (empEl) empEl.textContent = '🏢 ' + _empresaActiva.nombre;
  const topbarEmp2 = document.getElementById('topbar-empresa');
  if (topbarEmp2) topbarEmp2.textContent = '🏢 ' + _empresaActiva.nombre;
  try { var _taEl=document.getElementById('topbar-area'); if(_taEl && sesionActual && sesionActual.correo_usuario){ api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=areas:id_area(nombre,codigo)&limit=1').then(function(ea){ var ar=ea&&ea[0]?ea[0].areas:null; if(_taEl) _taEl.textContent=ar?ar.nombre+' ('+(ar.codigo||'')+')':''; }); } else if(_taEl){ _taEl.textContent=''; } } catch(eA){}
  const btnCambiar2 = document.getElementById('btn-cambiar-empresa');
  if (btnCambiar2) btnCambiar2.style.display = _empresasUsuario.length > 1 ? '' : 'none';
  // Si ya estaba en la app, solo recargar el módulo actual
  const app = document.getElementById('pantalla-app');
  if (app && app.style.display !== 'none') {
    renderModuloActual();
  } else {
    iniciarApp();
  }
}

function renderModuloActual() {
  // Limpiar TODOS los cachés para forzar recarga con nueva empresa
  ordenesCache      = [];
  facturasCache     = [];
  vehiculosCache    = [];
  propietariosCache = [];
  empleadosCache    = [];
  inventarioCache   = [];
  catalogoCache     = [];
  proveedoresCache  = [];
  clientesCache     = [];
  ventasCache       = [];
  usuariosCache     = [];
  contAsientosCache = [];
  contCxcCache      = [];
  contCxpCache      = [];
  // Recargar el módulo activo
  const moduloActivo = document.querySelector('.nav-item.activo');
  if (moduloActivo) moduloActivo.click();
  else renderDashboard();
}

function cambiarEmpresa() {
  if (_empresasUsuario.length <= 1) return;
  mostrarSeleccionEmpresa();
}

function limpiarSesionLocal() {
  // Detener polling PRIMERO para evitar expulsiones en loop
  clearInterval(_pollingInterval);
  detenerRenovacionJWT();
  window._sesionLista    = false;
  window._miTokenSesion  = null;
  // Limpiar JWT y empresa
  _sessionJWT          = null;
  _sessionJWTExpiry    = null;
  _sessionRefreshToken = null;
  _sessionEmail     = null;
  _sessionPassword  = null;
  _empresaActiva    = null;
  _empresasUsuario  = [];
  _ordenNivelSesion = undefined;
  cerrarTodosLosModales();
  detenerTimerInactividad();
  sesionActual     = null;
  modulosAcceso    = [];
  permisosActuales = {};
  _empParamCache   = {};
  sessionStorage.removeItem('sd_sesion');
  localStorage.removeItem('sd_sesion');
  localStorage.removeItem('sd_empresa_activa');
  document.getElementById('pantalla-app').style.display   = 'none';
  document.getElementById('pantalla-login').style.display = 'flex';
  document.getElementById('login-correo').value = '';
  resetCampoPass('login-clave');
  setTimeout(function() { document.getElementById('login-correo').focus(); }, 100);
  // Ocultar sidebar nav items
  document.querySelectorAll('.nav-item[id^="nav-"]').forEach(function(n) {
    n.style.display = 'none';
  });
}

// ─── CERRAR SESIÓN ───
async function cerrarSesion() {
  if (!confirm('¿Desea cerrar sesión?')) return;
  const correo = sesionActual?.correo_usuario;
  try {
    if (correo) await api('usuarios', 'PATCH', {
      sesion_activa: false,
      sesion_invalidada: false,
      ultima_desconexion: new Date().toISOString()
    }, `?correo_usuario=eq.${encodeURIComponent(correo)}`);
  } catch(e) { console.error('Error cerrando sesión:', e); }
  limpiarSesionLocal();
  // Redirigir a landing page
  window.location.href = 'landing.html';
}

// ─── NAVEGACIÓN ───
async function recargarPermisosActuales() {
  if (!sesionActual || sesionActual.administrador) return;
  try {
    const perms = await api('usuarios_permisos', 'GET', null,
      '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario));
    permisosActuales = {};
    perms.forEach(function(p) {
      if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
      permisosActuales[p.modulo].push(p.accion);
    });
    const accesos = await api('usuarios_accesos', 'GET', null,
      '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario) + '&activo=eq.true&select=acceso_tipo');
    modulosAcceso = accesos.map(a => a.acceso_tipo);
  } catch(e) { /* silencioso — no bloquear navegación */ }
}

async function mostrarModulo(modulo, navEl) {
  // Detener el auto-refresco de la lista de Usuarios si se navega a otro módulo
  if (modulo !== 'usuarios' && _intervalRefrescarUsuarios) {
    clearInterval(_intervalRefrescarUsuarios);
    _intervalRefrescarUsuarios = null;
  }
  // Verificar notificaciones pendientes al navegar
  verificarNotificacionesPendientes();
  // Quitar activo de todos
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('activo'));
  if (navEl) navEl.classList.add('activo');
  // Recargar permisos frescos antes de mostrar cualquier módulo
  await recargarPermisosActuales();

  const titulos = {
    dashboard:    'DASHBOARD',
    usuarios:     'GESTIÓN DE USUARIOS',
    tasas:        'TIPOS DE CAMBIO',
    parametros:   'PARÁMETROS DEL SISTEMA',
    vehiculos:    'VEHÍCULOS',
    propietarios: 'PROPIETARIOS',
    ordenes:      'ÓRDENES DE SERVICIO',
    inventario:   'INVENTARIO GENERAL',
    catalogo:     'CATÁLOGO DE SERVICIOS',
    emisores:     'DATOS DE EMPRESAS',
    facturas:     'CUENTAS POR COBRAR',
    pagos:        'CUENTAS POR PAGAR',
    empleados:    'EMPLEADOS',
    proveedores:  'PROVEEDORES',
    clientes:     'CLIENTES',
    ventas:       'VENTAS',
    proximo:      'PRÓXIMAMENTE'
  };

  document.getElementById('topbar-titulo').textContent = titulos[modulo] || modulo.toUpperCase();

  switch(modulo) {
    case 'dashboard':    renderDashboard();    break;
    case 'usuarios':     renderUsuarios();     break;
    case 'tasas':        renderTasas();        break;
    case 'tributos':     await renderTributos();    break;
    case 'vehiculos':    renderVehiculos();    break;
    case 'propietarios': renderPropietarios(); break;
    case 'parametros':   renderParametros();   break;
    case 'ordenes':      await renderOrdenes();      break;
    case 'inventario':   _invVista = 'tabla'; renderInventario();   break;
    case 'catalogo':
      // Resetear filtros al entrar al módulo para mostrar todos los servicios
      const buscarCat = document.getElementById('buscar-cat');
      const filtroCat = document.getElementById('filtro-cat-cat');
      if (buscarCat) buscarCat.value = '';
      if (filtroCat) filtroCat.value = '';
      renderCatalogo();
      break;
    case 'emisores':     renderEmisores();     break;
    case 'facturas':     renderFacturas();     break;
    case 'pagos':        renderPagos();        break;
    case 'empleados':    renderEmpleados();    break;
    case 'proveedores':  renderProveedores();  break;
    case 'clientes':     renderClientes();     break;
    case 'ventas':       renderVentas();       break;
    case 'contabilidad': renderContabilidad(); break;
    default:             renderProximo(navEl?.querySelector('.nav-icono')?.textContent || '🔧',
                                       navEl?.textContent.trim() || modulo);
  }
}

// ─── DASHBOARD ───
async function renderDashboard() {
  const c = document.getElementById('contenido-principal');
  c.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando datos...</div>`;

  try {
    // Contar registros de tablas existentes
    const [usuarios, tasas, vehiculos, propietarios, ordenes] = await Promise.all([
      api('usuarios', 'GET', null, '?select=id_usuario'),
      api('tasas', 'GET', null, '?select=id_tasa&order=fecha_registro.desc&limit=1'),
      api('vehiculos', 'GET', null, '?select=id_vehiculo'+emisorQ()),
      api('propietarios', 'GET', null, '?select=id_propietario'+emisorQ()),
      api('ordenes_servicio', 'GET', null, '?select=id_orden&estado=neq.CERRADA&estado=neq.ANULADA'+emisorQ()),
    ]);

    const ultimaTasa = tasas.length > 0 ? tasas[0] : null;
    let tasaValor = '—';
    if (ultimaTasa) {
      const t = await api('tasas', 'GET', null, `?id_tasa=eq.${ultimaTasa.id_tasa}&select=tipo_cambio,moneda_origen,moneda_destino`);
      if (t.length > 0) tasaValor = parseFloat(t[0].tipo_cambio).toFixed(2);
    }

    const hora = new Date().toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });

    const esAdmin = sesionActual.administrador;

    c.innerHTML = `
      <div class="bienvenida">
        <div>
          <h1>BIENVENIDO</h1>
          <p>${sesionActual.nombre} · ${esAdmin ? 'Administrador del Sistema' : 'Operador'}</p>
          <p style="margin-top:6px;font-size:12px;color:#888">S&D Systems Automotriz · Fase 1 activa</p>
        </div>
        <div class="hora">${hora}</div>
      </div>

      <div class="tarjetas-grid">
        ${esAdmin ? `
        <div class="tarjeta-stat" onclick="mostrarModulo('usuarios', document.getElementById('nav-USUARIOS'))">
          <div class="tarjeta-icono">👥</div>
          <div class="tarjeta-valor">${usuarios.length}</div>
          <div class="tarjeta-nombre">Usuarios</div>
        </div>
        <div class="tarjeta-stat" onclick="mostrarModulo('tasas', document.getElementById('nav-TASAS'))">
          <div class="tarjeta-icono">💱</div>
          <div class="tarjeta-valor">${tasaValor}</div>
          <div class="tarjeta-nombre">Última Tasa USD</div>
        </div>` : ''}
        ${puedo('VEHICULOS','VER') ? `
        <div class="tarjeta-stat" onclick="mostrarModulo('vehiculos', document.getElementById('nav-VEHICULOS'))">
          <div class="tarjeta-icono">🚗</div>
          <div class="tarjeta-valor">${vehiculos.length}</div>
          <div class="tarjeta-nombre">Vehículos</div>
        </div>` : ''}
        ${puedo('PROPIETARIOS','VER') ? `
        <div class="tarjeta-stat" onclick="mostrarModulo('propietarios', document.getElementById('nav-PROPIETARIOS'))">
          <div class="tarjeta-icono">👤</div>
          <div class="tarjeta-valor">${propietarios.length}</div>
          <div class="tarjeta-nombre">Propietarios</div>
        </div>` : ''}
        ${puedo('SERVICIOS','VER') ? `
        <div class="tarjeta-stat" onclick="mostrarModulo('ordenes', document.getElementById('nav-SERVICIOS'))">
          <div class="tarjeta-icono">🔧</div>
          <div class="tarjeta-valor">${ordenes.length}</div>
          <div class="tarjeta-nombre">OS Abiertas</div>
        </div>` : ''}
        ${esAdmin ? `
        <div class="tarjeta-stat" style="cursor:default">
          <div class="tarjeta-icono">🧾</div>
          <div class="tarjeta-valor">—</div>
          <div class="tarjeta-nombre">Facturas · Fase 4</div>
        </div>` : ''}
      </div>

      ${esAdmin ? `
      <div class="panel">
        <div class="panel-header">
          <h3>Estado del Sistema</h3>
          <span class="badge badge-verde">● EN LÍNEA</span>
        </div>
        <div style="padding:20px 24px">
          <table>
            <thead>
              <tr>
                <th>Módulo</th>
                <th>Fase</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Login y Control de Accesos</td><td>Fase 1</td><td><span class="badge badge-verde">Activo</span></td></tr>
              <tr><td>Usuarios y Permisos</td><td>Fase 1</td><td><span class="badge badge-verde">Activo</span></td></tr>
              <tr><td>Tipos de Cambio</td><td>Fase 1</td><td><span class="badge badge-verde">Activo</span></td></tr>
              <tr><td>Vehículos y Propietarios</td><td>Fase 2</td><td><span class="badge badge-verde">Activo</span></td></tr>
              <tr><td>Órdenes de Servicio</td><td>Fase 3</td><td><span class="badge badge-verde">Activo</span></td></tr>
              <tr><td>Facturación y Pagos</td><td>Fase 4</td><td><span class="badge badge-gris">Pendiente</span></td></tr>
              <tr><td>Empleados y Nómina</td><td>Fase 5</td><td><span class="badge badge-gris">Pendiente</span></td></tr>
              <tr><td>Proveedores y Tributos</td><td>Fase 6</td><td><span class="badge badge-gris">Pendiente</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;
  } catch (e) {
    c.innerHTML = `<div class="alerta alerta-error" style="display:block">Error cargando datos: ${msgErr(e)}</div>`;
  }
}

// ─── MÓDULO USUARIOS ───
let usuariosCache = [];

async function renderUsuarios(filtro) {
  if (!sesionActual?.administrador && !modulosAcceso.includes('USUARIOS')) {
    document.getElementById('contenido-principal').innerHTML =
      `<div class="alerta alerta-error" style="display:block">No tiene acceso a este módulo.</div>`;
    return;
  }

  // Auto-refrescar la lista cada 30s (mismo ritmo que el heartbeat de
  // ultima_conexion) mientras esta pantalla esté abierta, para que el
  // estado En línea/Desconectado se vea actualizado sin recargar a mano.
  if (_intervalRefrescarUsuarios) clearInterval(_intervalRefrescarUsuarios);
  _intervalRefrescarUsuarios = setInterval(function() {
    renderUsuarios(document.getElementById('buscar-usu')?.value || '');
  }, 30000);


  const c = document.getElementById('contenido-principal');
  const panelYaExiste = !!document.getElementById('buscar-usu');

  if (!panelYaExiste) {
    c.innerHTML = `
      <div class="panel" id="panel-usuarios">
        <div class="panel-header">
          <h3 id="usu-contador">Usuarios del Sistema</h3>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="text" id="buscar-usu" placeholder="Buscar por nombre o correo..."
              onkeyup="renderUsuarios(this.value)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();renderUsuarios(this.value)}else if(event.key==='Escape'){this.value='';renderUsuarios('')}"
              style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;width:240px">
            <button class="btn-secundario" onclick="document.getElementById('buscar-usu').value='';renderUsuarios()">↻ Actualizar</button>
            ${sesionActual?.administrador ? '<button class="btn-secundario" style="border-color:rgba(255,107,0,0.4);color:var(--naranja)" onclick="cerrarTodasLasSesiones()">⏻ Cerrar Todas las Sesiones</button>' : ''}
            ${puedo('USUARIOS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoUsuario()">+ Nuevo Usuario</button>' : ''}
          </div>
        </div>
        <div class="tabla-container" id="tabla-usu-cont">
          <div class="loading"><div class="spinner"></div> Cargando usuarios...</div>
        </div>
      </div>`;
  }

  const tablaCont = document.getElementById('tabla-usu-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  try {
    const usuarios = await api('usuarios', 'GET', null, '?select=*&order=fecha_registro.asc');
    usuariosCache = usuarios;

    // Cargar empresas de cada usuario (de la ficha de empleado)
    try {
      const empleadosMap = await api('empleados','GET',null,'?select=correo,id_empresa,emisores(nombre)');
      const mapaEmpleados = {};
      empleadosMap.forEach(function(e){ mapaEmpleados[e.correo] = e.emisores ? e.emisores.nombre : null; });
      usuarios.forEach(function(u){ u._empresaEmpleado = mapaEmpleados[u.correo_usuario] || null; });
    } catch(eEmp) {}

    const usuariosFiltrados = (filtro && filtro.trim())
      ? usuarios.filter(u => u.nombre.toLowerCase().includes(filtro.toLowerCase()) || u.correo_usuario.toLowerCase().includes(filtro.toLowerCase()))
      : usuarios;

    const filas = usuariosFiltrados.map(u => {
      // Considerar conectado solo si ultima_conexion fue hace menos de 6 minutos
      const ahora = new Date();
      const fechaUltimaCon = u.ultima_conexion ? new Date(u.ultima_conexion) : null;
      const minutosDesdeConexion = fechaUltimaCon ? (ahora - fechaUltimaCon) / (1000 * 60) : 999;
      const enLinea = u.sesion_activa === true && minutosDesdeConexion < 6;
      const ultimaCon = u.ultima_conexion
        ? new Date(u.ultima_conexion).toLocaleString('es-VE', { timeZone: 'America/Caracas',  day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : 'Nunca';
      const ultimaDes = u.ultima_desconexion
        ? new Date(u.ultima_desconexion).toLocaleString('es-VE', { timeZone: 'America/Caracas',  day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '—';

      return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="position:relative">
              <div class="usuario-avatar" style="width:30px;height:30px;font-size:13px">${u.nombre.charAt(0)}</div>
              <div style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${enLinea ? '#38a169' : '#444'};border:2px solid var(--gris1)"></div>
            </div>
            <div>
              <div style="font-weight:500">${u.nombre}</div>
              <div style="font-size:11px;color:var(--suave)">${u.correo_usuario}</div>
              ${u._empresaEmpleado ? `<div style="font-size:10px;color:var(--naranja);font-weight:600">🏢 ${u._empresaEmpleado}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="badge ${u.administrador ? 'badge-naranja' : 'badge-gris'}">${u.administrador ? 'Admin' : 'Operador'}</span></td>
        <td>
          <div style="display:flex;flex-direction:column;gap:4px">
            <span class="badge ${u.estado_usuario === 'ACTIVO' ? 'badge-verde' : 'badge-rojo'}">${u.estado_usuario}</span>
            <span style="font-size:10px;color:${enLinea ? '#68d391' : 'var(--suave)'}">
              ${enLinea ? '● En línea' : '○ Desconectado'}
            </span>
          </div>
        </td>
        <td style="font-size:11px;color:var(--suave)">
          <div>Reg: ${new Date(u.fecha_registro).toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day:'2-digit', month:'2-digit', year:'numeric' })}</div>
          <div style="margin-top:3px">Ent: ${ultimaCon}</div>
          <div style="margin-top:3px;color:#444">Sal: ${ultimaDes}</div>
        </td>
        <td>
          <div style="display:flex;gap:8px">
            <button class="btn-secundario" onclick="verFichaUsuario(${u.id_usuario})">Ver</button>
            ${u.correo_usuario === sesionActual.correo_usuario ? '<span style="font-size:11px;color:var(--suave);padding:8px 4px">Tú</span>' : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    const contador = document.getElementById('usu-contador');
    if (contador) contador.textContent = `Usuarios del Sistema (${usuariosFiltrados.length})`;

    const tabla = document.getElementById('tabla-usu-cont');
    if (tabla) tabla.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Tipo</th>
            <th>Estado / Conexión</th>
            <th>Fechas</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>${filas || '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--suave)">No hay usuarios que coincidan</td></tr>'}</tbody>
      </table>`;
  } catch(e) {
    const tabla = document.getElementById('tabla-usu-cont');
    if (tabla) tabla.innerHTML = `<div class="alerta alerta-error" style="display:block">Error: ${msgErr(e)}</div>`;
    else document.getElementById('contenido-principal').innerHTML = `<div class="alerta alerta-error" style="display:block">Error: ${msgErr(e)}</div>`;
  }
}

async function verFichaUsuario(id) {
  // Asegurar que el caché está cargado
  if (!usuariosCache || !usuariosCache.length) {
    const us = await api('usuarios','GET',null,'?select=*&order=fecha_registro.asc');
    usuariosCache = us;
  }
  const u = usuariosCache.find(function(x) { return x.id_usuario === parseInt(id); });
  if (!u) { console.warn('Usuario no encontrado en caché:', id); return; }
  // Cargar permisos del usuario
  let permisosU = {};
  try {
    const perms = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(u.correo_usuario));
    perms.forEach(function(p) {
      if (!permisosU[p.modulo]) permisosU[p.modulo] = [];
      permisosU[p.modulo].push(p.accion);
    });
  } catch(e) {}

  const ahora = new Date();
  const fechaUltimaCon = u.ultima_conexion ? new Date(u.ultima_conexion) : null;
  const minutosDesde = fechaUltimaCon ? (ahora - fechaUltimaCon) / (1000*60) : 999;
  const enLinea = u.sesion_activa && minutosDesde < 6;

  // Cargar facultades de aprobación del usuario
  const facMap = {};
  try {
    const facs = await api('usuario_aprobaciones','GET',null,
      '?id_usuario=eq.'+u.id_usuario+'&puede_aprobar=eq.true&select=modulo');
    facs.forEach(function(f){ facMap[f.modulo] = true; });
  } catch(e) {}

  // Armar lista de módulos y permisos
  let modulosHTML = '';
  const MODULOS_CON_APROBACION = ['PAGOS','FACTURAS','CONTABILIDAD'];
  modulosHTML = TODOS_LOS_MODULOS.map(function(m) {
    const accs = permisosU[m.sigla];
    if (!accs || !accs.length) return '';
    const puedeAprob = facMap[m.sigla] ? ' <span style="font-size:10px;background:rgba(34,197,94,0.2);color:#22c55e;border-radius:10px;padding:1px 6px">✓ Aprueba</span>' : '';
    const badgeAprob = MODULOS_CON_APROBACION.includes(m.sigla) ? puedeAprob : '';
    return '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,107,0,0.1);color:var(--naranja);padding:5px 12px;border-radius:20px;margin:3px;font-size:12px;font-weight:600">' + m.icono + ' ' + m.nombre + badgeAprob + '</span>';
  }).filter(Boolean).join('');







  document.getElementById('ficha-usu-contenido').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">'
    + '<div style="position:relative">'
    + '<div class="usuario-avatar" style="width:48px;height:48px;font-size:20px">' + u.nombre.charAt(0) + '</div>'
    + '<div style="position:absolute;bottom:0;right:0;width:12px;height:12px;border-radius:50%;background:' + (enLinea ? '#38a169' : '#444') + ';border:2px solid var(--gris1)"></div>'
    + '</div>'
    + '<div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + u.nombre + '</div>'
    + '<div style="font-size:12px;color:var(--suave)">' + u.correo_usuario + '</div>'
    + '<span class="badge ' + (u.administrador ? 'badge-naranja' : 'badge-gris') + '" style="margin-top:4px">' + (u.administrador ? 'Administrador' : 'Operador') + '</span>'
    + '</div></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Estado</div>'
    + '<span class="badge ' + (u.estado_usuario === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + u.estado_usuario + '</span></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Conexión</div>'
    + '<div style="font-size:12px;color:' + (enLinea ? '#68d391' : 'var(--suave)') + '">' + (enLinea ? '● En línea' : '○ Desconectado') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Última Conexión</div>'
    + '<div style="font-size:12px">' + (u.ultima_conexion ? new Date(u.ultima_conexion).toLocaleString('es-VE', { timeZone: 'America/Caracas', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Nunca') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Registrado</div>'
    + '<div style="font-size:12px">' + new Date(u.fecha_registro).toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day:'2-digit', month:'2-digit', year:'numeric' }) + '</div></div>'
    + '</div>'
    + (u.administrador ? '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--naranja)">👑 Acceso total al sistema — Administrador</div>'
      : ('<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;margin-top:4px">Permisos Asignados</div>'
        + (modulosHTML || '<div style="color:var(--suave);font-size:13px">Sin permisos asignados</div>')));

  var btnEditar = document.getElementById('ficha-usu-btn-editar');
  var btnReset  = document.getElementById('ficha-usu-btn-reset');
  var btnEliminar = document.getElementById('ficha-usu-btn-eliminar');
  if (btnEditar)  { btnEditar._id = u.id_usuario; btnEditar.onclick = function() { cerrarModal('modal-ficha-usu'); abrirEditarUsuario(this._id); }; btnEditar.style.display = puedo('USUARIOS','EDITAR') ? '' : 'none'; }
  if (btnReset)   { btnReset._correo = u.correo_usuario; btnReset._nombre = u.nombre; btnReset.onclick = function() { resetearClave(this._correo, this._nombre); }; btnReset.style.display = puedo('USUARIOS','EDITAR') && u.correo_usuario !== sesionActual.correo_usuario ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = u.id_usuario; btnEliminar._nombre = u.nombre; btnEliminar.onclick = function() { cerrarModal('modal-ficha-usu'); eliminarUsuario(this._id, this._nombre); }; btnEliminar.style.display = puedo('USUARIOS','ELIMINAR') && u.correo_usuario !== sesionActual.correo_usuario ? '' : 'none'; }
  var btnCerrarSesion = document.getElementById('ficha-usu-btn-cerrar-sesion');
  if (btnCerrarSesion) {
    btnCerrarSesion._correo = u.correo_usuario;
    btnCerrarSesion._nombre = u.nombre;
    btnCerrarSesion.onclick = function() { cerrarSesionUsuario(this._correo, this._nombre); };
    btnCerrarSesion.style.display = sesionActual?.administrador && enLinea && u.correo_usuario !== sesionActual.correo_usuario ? '' : 'none';
  }

  abrirModal('modal-ficha-usu');
  focusFirstField('modal-ficha-usu');
}

async function onSelEmpleadoUsuario() {
  var sel = document.getElementById('u-emp-selector');
  if (!sel || !sel.value) return;
  var opt = sel.options[sel.selectedIndex];
  var nombre = opt.dataset.nombre || '';
  var correo = opt.dataset.correo || '';
  if (nombre) document.getElementById('u-nombre').value = nombre;
  if (correo) {
    document.getElementById('u-correo').value = correo;
    await cargarEmpresasAccesoModal(correo);
  }
  // Resetear selector después de importar
  sel.value = '';
}

async function abrirNuevoUsuario() {
  document.getElementById('modal-titulo').textContent = 'NUEVO USUARIO';
  document.getElementById('u-nombre').value = '';
  document.getElementById('u-correo').value = '';
  document.getElementById('u-clave').value = '';
  document.getElementById('u-clave-confirmar').value = '';
  document.getElementById('u-clave-confirmar-cont').style.display = 'none';
  document.getElementById('u-estado').value = 'ACTIVO';
  document.getElementById('u-admin').value = 'false';
  document.getElementById('u-id-editando').value = '';
  document.getElementById('u-correo').disabled = false;
  document.getElementById('alerta-modal-ok').style.display = 'none';
  document.getElementById('alerta-modal-error').style.display = 'none';
  document.getElementById('fortaleza-usuario').style.display = 'none';
  document.getElementById('fortaleza-fill-u').style.width = '0%';
  var btnCerrarSesionNuevo = document.getElementById('editar-usu-btn-cerrar-sesion');
  if (btnCerrarSesionNuevo) btnCerrarSesionNuevo.style.display = 'none';
  renderAccesosModal([]);
  await cargarEmpresasAccesoModal(null);

  // Cargar empleados para el selector (solo en nuevo usuario)
  try {
    const emps = await api('empleados', 'GET', null, '?estatus=eq.ACTIVO&order=nombre_completo.asc&select=id_empleado,nombre_completo,correo&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
    const selEmp = document.getElementById('u-emp-selector');
    if (selEmp) {
      selEmp.innerHTML = '<option value="">— Seleccionar empleado —</option>'
        + emps.map(function(e) {
            return '<option value="' + e.id_empleado + '" data-nombre="' + (e.nombre_completo||'') + '" data-correo="' + (e.correo||'') + '">'
              + e.nombre_completo + (e.correo ? ' · ' + e.correo : '') + '</option>';
          }).join('');
    }
    // Mostrar selector solo en nuevo usuario
    var empCont = document.getElementById('u-emp-selector-cont');
    if (empCont) empCont.style.display = '';
  } catch(eEmp) {
    var empCont = document.getElementById('u-emp-selector-cont');
    if (empCont) empCont.style.display = 'none';
  }

  abrirModal('modal-usuario');
  focusFirstField('modal-usuario');
}

async function abrirEditarUsuario(id) {
  const u = usuariosCache.find(x => x.id_usuario === id);
  if (!u) return;

  document.getElementById('modal-titulo').textContent = 'EDITAR USUARIO';
  document.getElementById('u-nombre').value = u.nombre;
  // Cargar permisos granulares del usuario a editar
  var permisosUsuario = {};
  try {
    var permsU = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(u.correo_usuario));
    permsU.forEach(function(p) {
      if (!permisosUsuario[p.modulo]) permisosUsuario[p.modulo] = [];
      permisosUsuario[p.modulo].push(p.accion);
    });
  } catch(e) {}
  // Cargar accesos del módulo ya aquí para poder inicializar permisos si están vacíos
  var accesosTemp = [];
  try {
    var aTemp = await api('usuarios_accesos', 'GET', null,
      '?correo_usuario=eq.' + encodeURIComponent(u.correo_usuario) + '&activo=eq.true&select=acceso_tipo');
    accesosTemp = aTemp.map(function(a) { return a.acceso_tipo; });
  } catch(e) {}
  // Los permisos solo se activan manualmente — nunca se pre-seleccionan automáticamente
  document.getElementById('u-correo').value = u.correo_usuario;
  document.getElementById('u-correo').disabled = true;
  // Ocultar selector de empleado en edición
  var empCont = document.getElementById('u-emp-selector-cont');
  if (empCont) empCont.style.display = 'none';
  document.getElementById('u-clave').value = '';
  document.getElementById('u-clave-confirmar').value = '';
  document.getElementById('u-clave-confirmar-cont').style.display = 'none';
  document.getElementById('u-estado').value = u.estado_usuario;
  document.getElementById('u-admin').value = u.administrador ? 'true' : 'false';
  document.getElementById('u-id-editando').value = id;
  document.getElementById('alerta-modal-ok').style.display = 'none';
  document.getElementById('alerta-modal-error').style.display = 'none';

  // Usar accesosTemp ya cargado arriba (evita doble llamada a la API)
  renderAccesosModal(accesosTemp, permisosUsuario);
  const correoEditar = u.correo_usuario;
  await cargarEmpresasAccesoModal(correoEditar);
  await cargarFacultadesEnModal(id);

  // Botón de Cerrar Sesión — visible siempre al editar (no depende de que esté
  // "en línea" ahora mismo, a diferencia del de "Ver Ficha"), para forzar el
  // refresco de permisos justo después de editarlos, sin importar si el
  // usuario se conecta recién más tarde.
  var btnCerrarSesionEdit = document.getElementById('editar-usu-btn-cerrar-sesion');
  if (btnCerrarSesionEdit) {
    btnCerrarSesionEdit.style.display = sesionActual?.administrador && u.correo_usuario !== sesionActual.correo_usuario ? '' : 'none';
    btnCerrarSesionEdit.onclick = function() { cerrarSesionUsuario(u.correo_usuario, u.nombre, 'modal-usuario'); };
  }

  abrirModal('modal-usuario');
  focusFirstField('modal-usuario');
}

// Estado JS de permisos — se actualiza con cada clic
var _estadoModulos = {};
var _estadoPermisos = {};

function renderAccesosModal(seleccionados, permisosSelec) {
  permisosSelec = permisosSelec || {};
  _estadoModulos = {};
  _estadoPermisos = {};
  TODOS_LOS_MODULOS.forEach(function(m) {
    _estadoModulos[m.sigla] = seleccionados.includes(m.sigla);
    _estadoPermisos[m.sigla] = {};
    var permsMod = permisosSelec[m.sigla] || [];
    (PERMISOS_POR_MODULO[m.sigla] || []).forEach(function(a) {
      _estadoPermisos[m.sigla][a.accion] = permsMod.includes(a.accion);
    });
  });
  var grid = document.getElementById('accesos-grid');
  grid.style.gridTemplateColumns = '1fr';
  grid.style.gap = '4px';
  var html = '';
  TODOS_LOS_MODULOS.forEach(function(m) {
    var on = _estadoModulos[m.sigla];
    var acciones = PERMISOS_POR_MODULO[m.sigla] || [];
    html += '<div id="blk-' + m.sigla + '" style="border:1px solid ' + (on ? 'var(--naranja)' : 'var(--borde)') + ';border-radius:6px;margin-bottom:4px">';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--gris2)">';
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;cursor:pointer;flex:1;margin:0">';
    html += '<input type="checkbox" style="accent-color:var(--naranja);width:14px;height:14px" ' + (on ? 'checked' : '') + ' onchange="_toggleModulo(\'' + m.sigla + '\',this.checked)">';
    html += m.icono + ' ' + m.nombre + '</label>';
    html += '<span style="font-size:10px;color:var(--suave);cursor:pointer" onclick="_togglePanel(\'' + m.sigla + '\')">▾ ' + (acciones.length ? acciones.length + ' permisos' : '') + '</span>';
    html += '</div>';
    html += '<div id="pnl-' + m.sigla + '" style="display:' + (on ? 'block' : 'none') + ';padding:10px 14px 12px;border-top:1px solid var(--borde)">';
    if (acciones.length) {
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--borde)">';
      acciones.forEach(function(a) {
        var c = _estadoPermisos[m.sigla][a.accion];
        var lock = a.label.indexOf('\uD83D\uDD12') >= 0 || a.label.indexOf('\uD83D') === 0;
        var col = lock ? '#f59e0b' : 'var(--suave)';
        html += '<label style="display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer;padding:3px 0;color:' + col + '">';
         html += '<input type="checkbox" id="perm-' + m.sigla + '-' + a.accion + '" style="accent-color:var(--naranja);width:13px;height:13px" ' + (c ? 'checked' : '') + ' onchange="_togglePermiso(\'' + m.sigla + '\',\'' + a.accion + '\',this.checked)"> ';
        html += a.label + '</label>';
      });
      html += '</div>';
    }
    html += '</div></div>';
  });
  grid.innerHTML = html;
}
function _togglePanel(sigla) {
  var p = document.getElementById('pnl-' + sigla);
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
function _toggleModulo(sigla, val) {
  _estadoModulos[sigla] = val;
  var b = document.getElementById('blk-' + sigla);
  if (b) b.style.borderColor = val ? 'var(--naranja)' : 'var(--borde)';
  var pnl = document.getElementById('pnl-' + sigla);
  if (val) {
    // Al activar: solo mostrar el panel, sin marcar ningún permiso automáticamente
    if (pnl) pnl.style.display = 'block';
  } else {
    // Al desactivar: limpiar TODOS los permisos de este módulo
    if (!_estadoPermisos[sigla]) _estadoPermisos[sigla] = {};
    (PERMISOS_POR_MODULO[sigla] || []).forEach(function(a) {
      _estadoPermisos[sigla][a.accion] = false;
      var chk = document.getElementById('perm-' + sigla + '-' + a.accion);
      if (chk) chk.checked = false;
    });
    if (pnl) pnl.style.display = 'none';
  }
}
function _togglePermiso(sigla, accion, val) {
  if (!_estadoPermisos[sigla]) _estadoPermisos[sigla] = {};
  _estadoPermisos[sigla][accion] = val;
}
function toggleAcceso(el,s){}
function toggleAccesoBloque(el){}
function toggleModuloDetalle(s){}
function toggleModuloAcceso(cb){}

async function guardarUsuario() {
  const idEdit  = document.getElementById('u-id-editando').value;
  if (idEdit && !puedo('USUARIOS','EDITAR')) { alert('No tiene permiso para editar usuarios.'); return; }
  if (!idEdit && !puedo('USUARIOS','CREAR')) { alert('No tiene permiso para crear usuarios.'); return; }
  const nombre  = document.getElementById('u-nombre').value.trim();
  const correo  = document.getElementById('u-correo').value.trim();
  const clave   = document.getElementById('u-clave').value;
  const estado  = document.getElementById('u-estado').value;
  const esAdmin = document.getElementById('u-admin').value === 'true';

  const okEl  = document.getElementById('alerta-modal-ok');
  const errEl = document.getElementById('alerta-modal-error');
  okEl.style.display = 'none';
  errEl.style.display = 'none';

  if (!nombre || !correo) {
    errEl.textContent = 'Nombre y correo son obligatorios.';
    errEl.style.display = 'block';
    return;
  }

  if (!idEdit && !clave) {
    errEl.textContent = 'La contraseña es obligatoria para nuevos usuarios.';
    errEl.style.display = 'block';
    return;
  }

  // Validar política si se ingresó una clave
  if (clave) {
    const erroresPol = validarPoliticaClave(clave);
    if (erroresPol.length > 0) {
      errEl.textContent = erroresPol[0];
      errEl.style.display = 'block';
      return;
    }
  }

  // Accesos seleccionados — checkboxes con name="mod_SIGLA"
  // Leer estado directamente desde variables JS (no desde el DOM)
  var accesosSelec = [];
  var permisosSelec = {};
  Object.keys(_estadoModulos).forEach(function(sigla) {
    if (_estadoModulos[sigla]) accesosSelec.push(sigla);
  });
  Object.keys(_estadoPermisos).forEach(function(sigla) {
    Object.keys(_estadoPermisos[sigla]).forEach(function(accion) {
      if (_estadoPermisos[sigla][accion]) {
        if (!permisosSelec[sigla]) permisosSelec[sigla] = [];
        permisosSelec[sigla].push(accion);
      }
    });
  });
  // Excluir permisos de módulos no activos
  Object.keys(permisosSelec).forEach(function(sigla) {
    if (!accesosSelec.includes(sigla)) {
      delete permisosSelec[sigla];
    }
  });

  try {
    if (!idEdit) {
      // NUEVO USUARIO
      const claveConfNuevo = document.getElementById('u-clave-confirmar')?.value || '';
      if (clave !== claveConfNuevo) {
        errEl.textContent = 'Las contraseñas no coinciden.';
        errEl.style.display = 'block';
        document.getElementById('u-clave-confirmar')?.focus();
        return;
      }
      const claveHash = await hashearClave(clave);
      await api('usuarios', 'POST', {
        correo_usuario: correo,
        nombre, contrasena: claveHash,
        estado_usuario: estado,
        administrador: esAdmin
      });
      // Insertar accesos en lote
      if (accesosSelec.length > 0) {
        await api('usuarios_accesos', 'POST',
          accesosSelec.map(function(sigla) { return {
            correo_usuario: correo, acceso_tipo: sigla,
            id_usuario: sesionActual.correo_usuario, activo: true
          }; })
        );
      }
      // Insertar permisos en lote
      var newPermsLote = [];
      Object.entries(permisosSelec).forEach(function(entry) {
        var mod = entry[0], accs = entry[1];
        accs.forEach(function(acc) {
          newPermsLote.push({ correo_usuario: correo, modulo: mod, accion: acc });
        });
      });
      if (newPermsLote.length > 0) {
        try { await api('usuarios_permisos', 'POST', newPermsLote); } catch(eNP) {}
      }
      // Guardar empresas con acceso
      try {
        await api('usuarios_empresas','DELETE',null,'?correo_usuario=eq.'+encodeURIComponent(correo));
        const empIds = getEmpresasAccesoSeleccionadas();
        if (empIds.length) {
          for (const eid of empIds) {
            await api('usuarios_empresas','POST',{ correo_usuario: correo, id_empresa: eid, activo: true });
          }
        }
      } catch(eUE) { console.warn('Error guardando empresas:', eUE); }
      okEl.textContent = '✓ Usuario creado exitosamente.';
      const nuevoU = await api('usuarios','GET',null,'?correo_usuario=eq.'+encodeURIComponent(correo)+'&select=id_usuario');
      if (nuevoU.length) await guardarFacultadesAprobacion(nuevoU[0].id_usuario);
    } else {
      // EDITAR USUARIO
      const datos = { nombre, estado_usuario: estado, administrador: esAdmin };
      if (clave) {
        const claveConf = document.getElementById('u-clave-confirmar')?.value || '';
        if (clave !== claveConf) {
          errEl.textContent = 'Las contraseñas no coinciden.';
          errEl.style.display = 'block';
          document.getElementById('u-clave-confirmar')?.focus();
          return;
        }
        const claveHashEdit = await hashearClave(clave);
        datos.contrasena    = claveHashEdit;
        datos.cambiar_clave = false;
      }
      await api('usuarios', 'PATCH', datos, `?id_usuario=eq.${idEdit}`);

      // Actualizar accesos: borrar y reinsertar
      const correoEdit = usuariosCache.find(u => u.id_usuario == idEdit)?.correo_usuario;
      if (correoEdit) {
        // Advertir si se va a guardar sin ningún módulo de acceso
        if (accesosSelec.length === 0) {
          if (!confirm('⚠ No hay módulos de acceso seleccionados. El usuario quedará sin acceso a ningún módulo. ¿Desea continuar?')) {
            const btnG = document.querySelector('#modal-usuario .btn-primario');
            if (btnG) { btnG.disabled = false; btnG.textContent = 'GUARDAR'; }
            return;
          }
        }
        await api('usuarios_accesos', 'DELETE', null, `?correo_usuario=eq.${encodeURIComponent(correoEdit)}`);
        await api('usuarios_permisos', 'DELETE', null, `?correo_usuario=eq.${encodeURIComponent(correoEdit)}`);
        // Reinsertar accesos en lote
        if (accesosSelec.length > 0) {
          await api('usuarios_accesos', 'POST',
            accesosSelec.map(function(sigla) { return {
              correo_usuario: correoEdit, acceso_tipo: sigla,
              id_usuario: sesionActual.correo_usuario, activo: true
            }; })
          );
        }
        // Reinsertar permisos en lote
        var permsLote = [];
        Object.entries(permisosSelec).forEach(function(entry) {
          var mod = entry[0], accs = entry[1];
          accs.forEach(function(acc) {
            permsLote.push({ correo_usuario: correoEdit, modulo: mod, accion: acc });
          });
        });
        if (permsLote.length > 0) {
          try { await api('usuarios_permisos', 'POST', permsLote); } catch(eP) {}
        }
      }
      // Guardar empresas con acceso
      try {
        const correoEdit = usuariosCache.find(function(u){ return u.id_usuario==idEdit; })?.correo_usuario || correo;
        await api('usuarios_empresas','DELETE',null,'?correo_usuario=eq.'+encodeURIComponent(correoEdit));
        const empIds2 = getEmpresasAccesoSeleccionadas();
        if (empIds2.length) {
          for (const eid of empIds2) {
            await api('usuarios_empresas','POST',{ correo_usuario: correoEdit, id_empresa: eid, activo: true });
          }
        }
      } catch(eUE2) { console.warn('Error guardando empresas:', eUE2); }
      okEl.textContent = '✓ Usuario actualizado exitosamente.';
      await guardarFacultadesAprobacion(parseInt(idEdit));

      // Marcar sesion_invalidada para que el usuario recargue permisos en su próxima verificación
      // Solo desactivar sesión si el usuario fue marcado como INACTIVO
      try {
        const correoEdit = usuariosCache.find(u => u.id_usuario == idEdit)?.correo_usuario;
        if (correoEdit) {
          if (estado === 'INACTIVO') {
            await api('usuarios', 'PATCH', {
              sesion_activa: false,
              sesion_invalidada: true,
              ultima_desconexion: new Date().toISOString()
            }, `?id_usuario=eq.${idEdit}`);
            okEl.textContent = '✓ Usuario desactivado. Su sesión activa fue cerrada.';
          } else {
            // Solo marcar para recargar permisos, sin expulsar
            await api('usuarios', 'PATCH', { sesion_invalidada: true }, `?id_usuario=eq.${idEdit}`);
          }
        }
      } catch(eInv) { console.warn('Error actualizando sesión:', eInv); }
    }

    // Guardar facultades de aprobación
    const idUsrFac = parseInt(document.getElementById('usr-id')?.value||'0');
    if (idUsrFac) {
      for (const mod of ['PAGOS','FACTURAS','CONTABILIDAD']) {
        const checked = document.getElementById('u-aprueba-'+mod.toLowerCase())?.checked || false;
        try { await api('usuario_aprobaciones','DELETE',null,'?id_usuario=eq.'+idUsrFac+'&modulo=eq.'+mod); } catch(e) {}
        try { await api('usuario_aprobaciones','POST',{ id_usuario: idUsrFac, modulo: mod, puede_aprobar: checked }); } catch(e) {}
      }
    }
    okEl.style.display = 'block';
    if (!idEdit) {
      // Usuario nuevo: sí se cierra, no hay nada más que hacer aquí después de crearlo.
      setTimeout(() => {
        cerrarModal('modal-usuario');
        document.getElementById('contenido-principal').innerHTML = '';
        renderUsuarios();
      }, 1200);
    } else {
      // Editar usuario: el modal se queda abierto -- así se puede usar el botón
      // "Cerrar Sesión" justo después de guardar los permisos, sin tener que
      // volver a entrar a Editar Usuario para encontrarlo.
      document.getElementById('contenido-principal').innerHTML = '';
      await renderUsuarios();
    }

  } catch(e) {
    errEl.textContent = `Error: ${msgErr(e)}`;
    errEl.style.display = 'block';
  }
}

// ─── GUARDAR/CARGAR FACULTADES DE APROBACIÓN ───
async function guardarFacultadesAprobacion(id_usuario) {
  const modulos = [
    { id: 'u-aprueba-facturas',     modulo: 'FACTURAS' },
    { id: 'u-aprueba-pagos',        modulo: 'PAGOS' },
    { id: 'u-aprueba-contabilidad', modulo: 'CONTABILIDAD' },
  ];
  // Borrar facultades existentes
  await api('usuario_aprobaciones','DELETE',null,'?id_usuario=eq.'+id_usuario);
  // Insertar las seleccionadas
  const seleccionadas = modulos
    .filter(function(m){ return document.getElementById(m.id)?.checked; })
    .map(function(m){ return { id_usuario: id_usuario, modulo: m.modulo, puede_aprobar: true }; });
  if (seleccionadas.length) {
    await api('usuario_aprobaciones','POST', seleccionadas);
  }
}

async function cargarFacultadesEnModal(id_usuario) {
  const checks = {
    'FACTURAS':      'u-aprueba-facturas',
    'PAGOS':         'u-aprueba-pagos',
    'CONTABILIDAD':  'u-aprueba-contabilidad',
  };
  // Resetear
  Object.values(checks).forEach(function(id){ 
    const el = document.getElementById(id); 
    if (el) el.checked = false; 
  });
  if (!id_usuario) return;
  try {
    const rows = await api('usuario_aprobaciones','GET',null,
      '?id_usuario=eq.'+id_usuario+'&puede_aprobar=eq.true&select=modulo');
    rows.forEach(function(r){
      const elId = checks[r.modulo];
      if (elId) { const el = document.getElementById(elId); if (el) el.checked = true; }
    });
  } catch(e) {}
}

// ─── CERRAR SESIÓN DE UN USUARIO ESPECÍFICO ───
async function cerrarSesionUsuario(correo, nombre, modalOrigen) {
  if (!confirm('¿Cerrar la sesión activa de "' + nombre + '"?')) return;
  try {
    await api('usuarios', 'PATCH', {
      sesion_activa: false,
      sesion_invalidada: true,
      ultima_desconexion: new Date().toISOString()
    }, '?correo_usuario=eq.' + encodeURIComponent(correo));
    cerrarModal(modalOrigen || 'modal-ficha-usu');
    renderUsuarios();
    alert('✓ Sesión de "' + nombre + '" cerrada. El usuario será expulsado en los próximos 30 segundos.');
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

// ─── CERRAR TODAS LAS SESIONES ACTIVAS ───
async function cerrarTodasLasSesiones() {
  if (!confirm('¿Cerrar TODAS las sesiones activas del sistema?\n\nTodos los usuarios conectados serán expulsados en los próximos 30 segundos.')) return;
  try {
    // Marcar como invalidadas todas las sesiones activas excepto la del admin actual
    await api('usuarios', 'PATCH', {
      sesion_activa: false,
      sesion_invalidada: true,
      ultima_desconexion: new Date().toISOString()
    }, '?sesion_activa=eq.true&correo_usuario=neq.' + encodeURIComponent(sesionActual.correo_usuario));
    renderUsuarios();
    // Mostrar confirmación en el panel
    const cont = document.getElementById('tabla-usu-cont');
    if (cont) {
      const aviso = document.createElement('div');
      aviso.className = 'alerta alerta-exito';
      aviso.style.display = 'block';
      aviso.style.margin = '0 0 12px 0';
      aviso.textContent = '✓ Todas las sesiones activas han sido cerradas.';
      cont.parentElement.insertBefore(aviso, cont);
      setTimeout(function() { aviso.remove(); }, 4000);
    }
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

async function eliminarUsuario(id, nombre) {
  if (!puedo('USUARIOS','ELIMINAR')) { alert('No tiene permiso para eliminar usuarios.'); return; }
  if (!confirm(`¿Eliminar al usuario "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api('usuarios', 'DELETE', null, `?id_usuario=eq.${id}`);
    renderUsuarios();
  } catch(e) {
    alert('Error al eliminar: ' + msgErr(e));
  }
}

// ─── MÓDULO TASAS ───
async function renderTasas() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('TASAS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando tasas en tiempo real...</div>';

  try {
    // Fetch en paralelo: tasas de Supabase + historiales de dolarapi
    const [resUsd, resEur, resUsdt, resHistUsd, resHistEur, resHistUsdt, resTasasSupabase] = await Promise.allSettled([
      fetch('https://ve.dolarapi.com/v1/dolares/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/euros/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/dolares/paralelo').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/historicos/dolares/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/historicos/euros/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/historicos/dolares/paralelo').then(r => r.json()),
      fetch(SUPABASE_URL + '/rest/v1/tasas?select=*&order=fecha_valor.desc&limit=30', {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY) }
      }).then(r => r.json())
    ]);

    const usd      = resUsd.status      === 'fulfilled' ? resUsd.value      : null;
    const eur      = resEur.status      === 'fulfilled' ? resEur.value      : null;
    const usdt     = resUsdt.status     === 'fulfilled' ? resUsdt.value     : null;
    const histUsd  = resHistUsd.status  === 'fulfilled' && Array.isArray(resHistUsd.value)  ? resHistUsd.value  : [];
    const histEur  = resHistEur.status  === 'fulfilled' && Array.isArray(resHistEur.value)  ? resHistEur.value  : [];
    const histUsdt = resHistUsdt.status === 'fulfilled' && Array.isArray(resHistUsdt.value) ? resHistUsdt.value : [];
    const tasasDB  = resTasasSupabase.status === 'fulfilled' && Array.isArray(resTasasSupabase.value) ? resTasasSupabase.value : [];

    // Fecha actual en zona horaria Venezuela (UTC-4)
    const _ahora = new Date();
    const _vzla  = new Date(_ahora.getTime() - (4 * 60 * 60 * 1000));
    const hoyStr = _vzla.toISOString().split('T')[0];

    // Función para obtener valor de una fecha específica del historial dolarapi
    function getValorFecha(hist, fecha) {
      const r = hist.find(function(h) { return h.fecha && h.fecha.startsWith(fecha); });
      return r && r.promedio ? parseFloat(r.promedio) : null;
    }

    // Función para obtener tasa de Supabase por moneda y fecha_valor <= hoy
    function getTasaDB(moneda, fechaMax) {
      const registros = tasasDB
        .filter(function(t) {
          if (t.moneda_origen !== moneda) return false;
          const fv = String(t.fecha_valor || '').substring(0, 10);
          return fv >= '2020-01-01' && fv <= fechaMax;
        })
        .sort(function(a, b) {
          const fa = String(a.fecha_valor || '').substring(0, 10);
          const fb = String(b.fecha_valor || '').substring(0, 10);
          if (fb !== fa) return fb.localeCompare(fa);
          return (b.id_tasa || 0) - (a.id_tasa || 0);
        });
      return registros.length ? registros[0] : null;
    }

    // Último día hábil disponible en el historial (<=hoy)
    function getUltimoDiaHabil(hist) {
      const candidatos = hist
        .filter(function(h) {
          if (!h.fecha || !h.promedio) return false;
          const f = h.fecha.split('T')[0];
          const d = new Date(f + 'T12:00:00').getDay();
          return d >= 1 && d <= 5 && f <= hoyStr;
        })
        .sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
      return candidatos.length ? candidatos[0] : null;
    }

    // Valores vigentes: Supabase primero, dolarapi como respaldo
    const _ultUsd  = getUltimoDiaHabil(histUsd);
    const _ultEur  = getUltimoDiaHabil(histEur);
    const _ultUsdt = getUltimoDiaHabil(histUsdt);

    const _dbUsd  = getTasaDB('USD', hoyStr);
    const _dbEur  = getTasaDB('EUR', hoyStr);

    const usdVal  = _dbUsd  ? parseFloat(_dbUsd.tipo_cambio)  : (_ultUsd  ? parseFloat(_ultUsd.promedio)  : null);
    const eurVal  = _dbEur  ? parseFloat(_dbEur.tipo_cambio)  : (_ultEur  ? parseFloat(_ultEur.promedio)  : null);
    const usdtVal = _ultUsdt ? parseFloat(_ultUsdt.promedio)  : (usdt && usdt.promedio ? parseFloat(usdt.promedio) : null);

    // Fecha de las tarjetas vigentes — siempre string YYYY-MM-DD
    const vigenteFecha = _dbUsd
      ? String(_dbUsd.fecha_valor).substring(0, 10)
      : (_ultUsd ? String(_ultUsd.fecha).substring(0, 10) : hoyStr);

    // Fuente de los datos
    const fuenteUsd  = _dbUsd ? 'BCV Oficial' : 'dolarapi.com';
    const fuenteEur  = _dbEur ? 'BCV Oficial' : 'dolarapi.com';

    function getCierreAnterior(hist, valorHoy) {
      if (!hist.length) return null;
      // Filtrar días hábiles con fecha estrictamente anterior a hoy y con valor válido
      const candidatos = hist
        .filter(function(h) {
          if (!h.fecha || !h.promedio) return false;
          const f = h.fecha.split('T')[0];
          const d = new Date(f + 'T12:00:00').getDay();
          const val = parseFloat(h.promedio);
          return d >= 1 && d <= 5 && f < hoyStr && val > 0 && val !== valorHoy;
        })
        .sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
      return candidatos.length ? parseFloat(candidatos[0].promedio) : null;
    }

    const usdCierre  = getCierreAnterior(histUsd,  usdVal);
    const eurCierre  = getCierreAnterior(histEur,  eurVal);
    const usdtCierre = getCierreAnterior(histUsdt, usdtVal);

    const horaActual = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const esFDS = [0, 6].includes(new Date().getDay());

    // Calcular variación
    function varCalc(val, cierre) {
      if (!val || !cierre || cierre === 0) return { abs: null, pct: null };
      return { abs: (val - cierre).toFixed(4), pct: ((val - cierre) / cierre * 100).toFixed(2) };
    }

    function varHTML(abs, pct) {
      if (abs === null) return '<span style="color:#444;font-size:12px">Sin datos de cierre anterior</span>';
      const n    = parseFloat(abs);
      const col  = n > 0 ? '#68d391' : n < 0 ? '#fc8181' : '#888';
      const arr  = n > 0 ? '▲' : n < 0 ? '▼' : '●';
      const sign = n > 0 ? '+' : '';
      return '<span style="color:' + col + ';font-size:13px;font-weight:600">'
        + arr + ' ' + sign + parseFloat(pct).toFixed(2) + '%'
        + '</span>'
        + ' <span style="color:' + col + ';font-size:11px">(' + sign + parseFloat(abs).toFixed(4) + ' Bs)</span>';
    }

    function tarjeta(icono, nombre, val, cierre, fuente, color) {
      const fmt  = val ? val.toFixed(4) : '—';
      const vVar = varCalc(val, cierre);
      return '<div style="background:var(--gris1);border:1px solid var(--borde);border-radius:10px;padding:24px 28px;flex:1;min-width:240px;position:relative;overflow:hidden">'
        + '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + color + '"></div>'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-size:26px">' + icono + '</span>'
        + '<div>'
        + '<div style="font-family:var(--font-display);font-size:20px;letter-spacing:2px;color:var(--texto)">' + nombre + ' / VES</div>'
        + '<div style="font-size:10px;color:#555;letter-spacing:1px;margin-top:2px">' + fuente + '</div>'
        + '</div></div>'
        + '<div style="font-size:10px;color:#444;font-family:var(--font-mono)">' + horaActual + '</div>'
        + '</div>'
        + '<div style="font-family:var(--font-mono);font-size:40px;font-weight:700;color:' + color + ';margin-bottom:16px;line-height:1">'
        + fmt + ' <span style="font-size:14px;color:#555;font-weight:400">Bs</span></div>'
        + '<div style="padding-top:12px;border-top:1px solid var(--borde)">'
        + '<div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">vs cierre anterior</div>'
        + varHTML(vVar.abs, vVar.pct)
        + '</div></div>';
    }

    // Separar fechas en: pasadas, hoy, y próximo día hábil
    const hoyDow = new Date().getDay(); // 0=dom, 6=sab

    // Obtener todas las fechas hábiles de la API ordenadas desc
    const todasFechasHabiles = histUsd
      .filter(function(h) {
        if (!h.fecha) return false;
        const d = new Date(h.fecha + 'T12:00:00').getDay();
        return d >= 1 && d <= 5;
      })
      .map(function(h) { return h.fecha.split('T')[0]; })
      .sort(function(a, b) { return b.localeCompare(a); });

    // Próximo día hábil: fecha más reciente que sea HOY o FUTURA
    const proximaFecha = todasFechasHabiles.find(function(f) { return f >= hoyStr; }) || null;

    // Historial: fechas estrictamente ANTERIORES a hoy (pasado), últimas 5 + 1 para variación
    const fechasPasadas = todasFechasHabiles
      .filter(function(f) { return f < hoyStr; })
      .slice(0, 6); // 5 + 1 para variación del 1er día
    const dias5 = fechasPasadas.slice(0, 5);

    function celdaHist(val, valAnterior) {
      if (val === null) return '<td style="text-align:center;color:#444;padding:12px 16px">—</td>';
      const fmt = val.toFixed(4);
      let varStr = '';
      if (valAnterior !== null) {
        const diff = val - valAnterior;
        const pct  = (diff / valAnterior * 100).toFixed(2);
        const col  = diff > 0 ? '#68d391' : diff < 0 ? '#fc8181' : '#888';
        const arr  = diff > 0 ? '▲' : diff < 0 ? '▼' : '●';
        const sign = diff > 0 ? '+' : '';
        varStr = '<div style="font-size:10px;color:' + col + ';margin-top:2px">' + arr + ' ' + sign + pct + '%</div>';
      }
      return '<td style="text-align:center;padding:12px 16px">'
        + '<div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--texto)">' + fmt + '</div>'
        + varStr + '</td>';
    }

    let filasHist = '';
    if (dias5.length) {
      dias5.forEach(function(f, i) {
        const fAntes   = fechasPasadas[i + 1] || null;
        const usdH     = getValorFecha(histUsd,  f);
        const eurH     = getValorFecha(histEur,  f);
        const usdtH    = getValorFecha(histUsdt, f);
        const usdHA    = fAntes ? getValorFecha(histUsd,  fAntes) : null;
        const eurHA    = fAntes ? getValorFecha(histEur,  fAntes) : null;
        const usdtHA   = fAntes ? getValorFecha(histUsdt, fAntes) : null;
        const fechaFmt = new Date(f + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'short', day:'2-digit', month:'short', year:'numeric' });
        filasHist += '<tr>'
          + '<td style="font-size:12px;color:var(--suave);white-space:nowrap;padding:12px 16px">' + fechaFmt + '</td>'
          + celdaHist(usdH,  usdHA)
          + celdaHist(eurH,  eurHA)
          + celdaHist(usdtH, usdtHA)
          + '</tr>';
      });
    } else {
      filasHist = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--suave)">No se pudieron cargar los datos históricos</td></tr>';
    }

    // ── Próxima tasa hábil ──
    let proximaHTML = '';
    const fechaHoyFmt = new Date(vigenteFecha + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const fechaHoyCap = fechaHoyFmt.charAt(0).toUpperCase() + fechaHoyFmt.slice(1);

    if (proximaFecha) {
      const eHoy    = proximaFecha === hoyStr;
      // USD y EUR: Supabase primero, dolarapi como respaldo -- aquí se exige
      // coincidencia EXACTA de fecha_valor (a diferencia de getTasaDB, que
      // cae de vuelta a la fecha anterior más reciente -- correcto para
      // "vigente hoy", pero incorrecto aquí: si aún no existe la fila real
      // de la próxima fecha, NO se debe mostrar la de hoy como si ya
      // estuviera publicada por el BCV).
      const getTasaDBExacta = function(moneda, fechaExacta) {
        const reg = tasasDB.find(function(t) {
          return t.moneda_origen === moneda && String(t.fecha_valor || '').substring(0, 10) === fechaExacta;
        });
        return reg || null;
      };
      const _dbPUsd = getTasaDBExacta('USD', proximaFecha);
      const _dbPEur = getTasaDBExacta('EUR', proximaFecha);
      const pUsd    = _dbPUsd ? parseFloat(_dbPUsd.tipo_cambio) : getValorFecha(histUsd,  proximaFecha);
      const pEur    = _dbPEur ? parseFloat(_dbPEur.tipo_cambio) : getValorFecha(histEur,  proximaFecha);
      const pUsdt   = getValorFecha(histUsdt, proximaFecha);
      const subLabel= (_dbPUsd || _dbPEur) ? 'Publicada por el BCV' : 'Disponible anticipadamente';
      const pFmt    = new Date(proximaFecha + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'long', day:'2-digit', month:'long', year:'numeric' });
      const pCap    = pFmt.charAt(0).toUpperCase() + pFmt.slice(1);
      const label   = 'FECHA VALOR : ' + pCap;

      function celdaProx(val, color) {
        if (!val) return '<div style="color:#444;font-size:13px">—</div>';
        return '<div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:' + color + '">'
          + val.toFixed(4) + ' <span style="font-size:11px;color:#555;font-weight:400">Bs</span></div>';
      }

      proximaHTML = '<div id="seccion-proxima-tasa" style="background:var(--gris1);border:1px solid var(--borde);border-radius:8px;padding:20px 24px;margin-bottom:24px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
        + '<div>'
        + '<div style="font-family:var(--font-display);font-size:13px;letter-spacing:3px;color:var(--naranja);text-transform:uppercase">' + label + '</div>'
        + '<div style="font-size:12px;color:var(--suave);margin-top:3px">' + subLabel + '</div>'
        + '</div></div>'
        + '<div style="display:flex;gap:32px;flex-wrap:wrap">'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇺🇸 USD</div>' + celdaProx(pUsd, '#FF6B00') + '</div>'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇪🇺 EUR</div>' + celdaProx(pEur, '#4299e1') + '</div>'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">💲 USDT</div>' + celdaProx(pUsdt, '#F0B90B') + '</div>'
        + '</div></div>';
    } else {
      proximaHTML = '<div style="background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:16px 20px;margin-bottom:24px;font-size:13px;color:var(--suave)">'
        + '⏳ La tasa del próximo día hábil aún no está disponible — estará publicada en breve</div>';
    }

    const hoy  = new Date().toISOString().split('T')[0];
    const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    c.innerHTML =
      '<div style="margin-bottom:24px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">'
      + '<div style="font-family:var(--font-display);font-size:13px;letter-spacing:3px;color:var(--suave);text-transform:uppercase">'
      + '<span style="color:var(--naranja)">●</span> TASA VIGENTE : ' + fechaHoyCap
      + (esFDS ? ' <span style="font-size:10px;color:#555;letter-spacing:1px">— Fin de semana, último cierre hábil</span>' : '')
      + '</div>'
      + '<div style="display:flex;gap:10px">'
      + '<button onclick="renderTasas()" class="btn-secundario">↻ Actualizar vista</button>'
      + (puedo('TASAS','CREAR') ? '<button onclick="sincronizarTasasBCV(this)" class="btn-primario" style="display:flex;align-items:center;gap:6px"><span>⬇</span> Sincronizar BCV</button>' : '')
      + '</div></div>'
      + '<div style="display:flex;gap:16px;flex-wrap:wrap">'
      + tarjeta('🇺🇸', 'USD',  usdVal,  usdCierre,  fuenteUsd,  '#FF6B00')
      + tarjeta('🇪🇺', 'EUR',  eurVal,  eurCierre,  fuenteEur,  '#4299e1')
      + tarjeta('💲',  'USDT', usdtVal, usdtCierre, 'Mercado P2P',  '#F0B90B')
      + '</div></div>'

      + proximaHTML

      + '<div class="panel" style="margin-bottom:24px;border:1px solid rgba(255,107,0,0.3)">'
      + '<div class="panel-header" style="border-bottom:1px solid rgba(255,107,0,0.15)">'
      + '<div>'
      + '<h3 style="color:var(--naranja)">📋 Ingresar Tasa Oficial BCV</h3>'
      + '<div style="font-size:11px;color:var(--suave);margin-top:3px">Registro manual de la tasa publicada en bcv.org.ve</div>'
      + '</div></div>'
      + '<div style="padding:20px 24px">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;align-items:end">'
      + '<div class="form-campo" style="margin:0">'
      + '<label>Fecha Valor</label>'
      + '<input type="date" id="bcv-fecha" value="' + (proximaFecha || hoy) + '" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;width:100%">'
      + '</div>'
      + '<div class="form-campo" style="margin:0">'
      + '<label>🇺🇸 USD / Bs</label>'
      + '<input type="number" id="bcv-usd" placeholder="Ej: 493.37650000" step="0.00000001" min="0" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:14px;padding:10px 14px;border-radius:5px;outline:none;width:100%">'
      + '</div>'
      + '<div class="form-campo" style="margin:0">'
      + '<label>🇪🇺 EUR / Bs</label>'
      + '<input type="number" id="bcv-eur" placeholder="Ej: 577.52186207" step="0.00000001" min="0" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:14px;padding:10px 14px;border-radius:5px;outline:none;width:100%">'
      + '</div>'
      + '<div style="padding-bottom:1px">'
      + '<button class="btn-primario" style="width:100%;padding:11px" onclick="guardarTasaBCVManual()">💾 GUARDAR TASAS BCV</button>'
      + '</div>'
      + '</div>'
      + '<div id="bcv-manual-msg" style="margin-top:12px;display:none"></div>'
      + '</div></div>'

      + '<div class="panel" style="margin-bottom:24px">'
      + '<div class="panel-header"><h3>Historial — Últimos 5 Días Hábiles</h3></div>'
      + '<div class="tabla-container"><table>'
      + '<thead><tr>'
      + '<th style="width:140px">Fecha</th>'
      + '<th style="text-align:center;color:#FF6B00">🇺🇸 USD / Bs</th>'
      + '<th style="text-align:center;color:#4299e1">🇪🇺 EUR / Bs</th>'
      + '<th style="text-align:center;color:#F0B90B">💲 USDT / Bs</th>'
      + '</tr></thead>'
      + '<tbody>' + filasHist + '</tbody>'
      + '</table></div></div>'

      + '<div class="panel">'
      + '<div class="panel-header"><h3>Consultar Tasa por Fecha</h3></div>'
      + '<div style="padding:20px 24px">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;align-items:end">'
      + '<div class="form-campo" style="margin:0">'
      + '<label>Fecha a consultar</label>'
      + '<input type="date" id="fecha-consulta" max="' + hoy + '" value="' + ayer + '" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;width:100%">'
      + '</div>'
      + '<div style="padding-bottom:1px">'
      + '<button class="btn-primario" style="width:100%;padding:11px" onclick="consultarTasaPorFecha()">CONSULTAR</button>'
      + '</div>'
      + '</div>'
      + '<div id="resultado-fecha" style="margin-top:16px"></div>'
      + '</div></div>';
  } catch(e) {
    console.error(e);
  }
}


async function consultarTasaPorFecha() {
  const fecha = document.getElementById('fecha-consulta').value;
  const resEl = document.getElementById('resultado-fecha');
  if (!fecha) return;

  resEl.innerHTML = '<div class="loading"><div class="spinner"></div> Consultando historial...</div>';

  try {
    // Determinar fecha de búsqueda (fin de semana → viernes anterior)
    const fechaObj  = new Date(fecha + 'T12:00:00');
    const diaSemana = fechaObj.getDay();
    const esFDS     = diaSemana === 0 || diaSemana === 6;
    let fechaBuscar = fecha;
    if (diaSemana === 0) {
      const v = new Date(fechaObj); v.setDate(v.getDate() - 2);
      fechaBuscar = v.toISOString().split('T')[0];
    } else if (diaSemana === 6) {
      const v = new Date(fechaObj); v.setDate(v.getDate() - 1);
      fechaBuscar = v.toISOString().split('T')[0];
    }

    // Consultar los 3 historiales desde la API
    const [resUsdH, resEurH, resUsdtH] = await Promise.allSettled([
      fetch('https://ve.dolarapi.com/v1/historicos/dolares/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/historicos/euros/oficial').then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/historicos/dolares/paralelo').then(r => r.json())
    ]);

    const histUsd  = resUsdH.status  === 'fulfilled' && Array.isArray(resUsdH.value)  ? resUsdH.value  : [];
    const histEur  = resEurH.status  === 'fulfilled' && Array.isArray(resEurH.value)  ? resEurH.value  : [];
    const histUsdt = resUsdtH.status === 'fulfilled' && Array.isArray(resUsdtH.value) ? resUsdtH.value : [];

    function getValor(hist, f) {
      const r = hist.find(function(h) { return h.fecha && h.fecha.startsWith(f); });
      return r && r.promedio ? parseFloat(r.promedio) : null;
    }

    const usdVal  = getValor(histUsd,  fechaBuscar);
    const eurVal  = getValor(histEur,  fechaBuscar);
    const usdtVal = getValor(histUsdt, fechaBuscar);

    // Formatear fecha mostrada
    const fechaMostrar = new Date(fechaBuscar + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas', 
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });
    const fechaOrig = esFDS ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas', 
      weekday: 'long', day: '2-digit', month: 'long'
    }) : null;
    const capFecha = fechaMostrar.charAt(0).toUpperCase() + fechaMostrar.slice(1);

    function bloque(icono, nombre, val, color) {
      if (!val) {
        return '<div style="background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:16px 20px;'
          + 'display:flex;align-items:center;gap:12px;margin-bottom:10px">'
          + '<span style="font-size:20px">' + icono + '</span>'
          + '<div><div style="font-size:13px;color:#444">' + nombre + ' — Sin datos para esta fecha</div>'
          + '<div style="font-size:10px;color:#555;margin-top:4px">El historial del mercado P2P está disponible desde mediados de febrero 2026</div>'
          + '</div></div>';
      }
      return '<div style="background:var(--gris1);border:1px solid ' + color + '30;border-left:3px solid ' + color + ';'
        + 'border-radius:8px;padding:18px 22px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-size:22px">' + icono + '</span>'
        + '<div style="font-family:var(--font-display);font-size:17px;letter-spacing:1px;color:var(--texto)">' + nombre + '</div>'
        + '</div>'
        + '<div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:' + color + '">'
        + val.toFixed(4) + ' <span style="font-size:13px;color:#555;font-weight:400">Bs</span>'
        + '</div></div>'
        + '<div style="font-size:10px;color:#555;margin-top:8px">🌐 ve.dolarapi.com</div>'
        + '</div>';
    }

    resEl.innerHTML =
      '<div style="margin-bottom:16px">'
      + '<div style="font-family:var(--font-display);font-size:17px;color:var(--naranja);margin-bottom:4px">' + capFecha + '</div>'
      + (esFDS ? '<div style="font-size:11px;color:#888;margin-bottom:10px">⚠️ '
        + (fechaOrig ? fechaOrig.charAt(0).toUpperCase() + fechaOrig.slice(1) : '')
        + ' es fin de semana — mostrando tasas del viernes anterior</div>' : '')
      + '</div>'
      + bloque('🇺🇸', 'USD — Dólar Oficial BCV / VES', usdVal,  '#FF6B00')
      + bloque('🇪🇺', 'EUR — Euro Oficial BCV / VES',  eurVal,  '#4299e1')
      + bloque('💲',  'USDT — Mercado P2P / VES',      usdtVal, '#F0B90B');

  } catch(e) {
    resEl.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>';
    console.error(e);
  }
}




// ── Helper global para estado Guardando en botones ──
function btnSetGuardando(btn, guardando, textoOriginal, textoEnProgreso) {
  if (!btn) return;
  if (guardando) {
    btn.dataset.textoOriginal = btn.textContent;
    btn.textContent = textoEnProgreso || 'Guardando...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.textoOriginal || textoOriginal || 'Guardar';
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// SISTEMA DE NOTIFICACIONES INTERNAS
// ══════════════════════════════════════════════════════════════
let _notifPendienteActual = null;
let _notifEsEntradaSinResolver = false;
let _notifEntradaInfo = null; // { id_entrada, id_articulo, nombre_articulo }

async function verificarNotificacionesPendientes() {
  if (window._suprimirCheckNotifUnaVez) { window._suprimirCheckNotifUnaVez = false; return; }
  if (!sesionActual?.correo_usuario) return;
  try {
    const notifs = await api('notificaciones','GET',null,
      '?correo_destino=eq.'+encodeURIComponent(sesionActual.correo_usuario)
      +'&estado=eq.PENDIENTE&order=fecha_creacion.asc&select=*');
    if (notifs && notifs.length > 0) {
      await mostrarNotifPendiente(notifs[0]);
    }
  } catch(e) { console.warn('Error verificando notificaciones:', e); }
}

async function mostrarNotifPendiente(notif) {
  _notifPendienteActual = notif;
  _notifEsEntradaSinResolver = false;
  _notifEntradaInfo = null;
  const lista = document.getElementById('notif-pendiente-lista');
  if (!lista) return;
  lista.innerHTML =
    '<div style="background:rgba(255,107,0,0.06);border:1px solid rgba(255,107,0,0.2);border-radius:8px;padding:16px;margin-bottom:12px">'
    +'<div style="font-size:12px;color:var(--suave);margin-bottom:8px">'+fmtFecha(notif.fecha_creacion)+'</div>'
    +'<div style="font-size:13px;color:var(--texto);line-height:1.6">'+notif.mensaje+'</div>'
    +'</div>';

  // Detectar el tipo de notificación por su 'accion' en datos_extra, para
  // mostrar titulo/instrucción/botón acordes -- no todas son de Inventario.
  let accionNotif = 'confirmar_recepcion';
  let extrasNotif = null;
  try {
    extrasNotif = notif.datos_extra
      ? (typeof notif.datos_extra === 'string' ? JSON.parse(notif.datos_extra) : notif.datos_extra)
      : null;
    if (extrasNotif && extrasNotif.accion) accionNotif = extrasNotif.accion;
  } catch(eTipo) {}

  const titEl = document.getElementById('notif-pendiente-titulo');
  const instrEl = document.getElementById('notif-pendiente-instruccion');
  const btnConf = document.getElementById('btn-notif-confirmar');
  const btnEscalar = document.getElementById('btn-notif-escalar');
  const btnRechazarEnt = document.getElementById('btn-notif-rechazar-entrada');
  if (btnEscalar) btnEscalar.style.display = 'none';
  if (btnRechazarEnt) btnRechazarEnt.style.display = accionNotif === 'aprobar_entrada' ? '' : 'none';
  const btnVerDespues = document.getElementById('btn-notif-ver-despues');
  // No tiene sentido "posponer" una aprobación de Entrada de Compra, ni el
  // aviso de que ya fue rechazada -- en ambos casos hay una única acción
  // clara a seguir en el momento.
  if (btnVerDespues) btnVerDespues.style.display = (accionNotif === 'aprobar_entrada' || accionNotif === 'entrada_compra_rechazada' || accionNotif === 'confirmar_recepcion') ? 'none' : '';
  const CONFIG_NOTIF = {
    confirmar_recepcion: { titulo: '📦 Solicitud de Recepción', instruccion: 'Al confirmar, valida que recibió el consumible correctamente.', boton: '✓ Confirmar Recepción' },
    aprobar_pago:         { titulo: '📝 Solicitud de Aprobación', instruccion: 'Vaya al módulo de Pagos para revisar y aprobar esta Obligación.', boton: '✓ Confirmar Pago' },
    aprobar_entrada:      { titulo: '📝 Compra de Inventario', instruccion: 'Revise el detalle e indique si Aprueba o Rechaza esta Entrada -- mientras no se resuelva, no afecta Stock ni Contabilidad.', boton: '✓ Aprobar' },
    entrada_compra_rechazada: { titulo: '❌ Compra Rechazada', instruccion: 'Revise el motivo, corrija la Entrada y vuelva a guardarla para que se reenvíe a aprobación.', boton: 'Proceder' },
    registrar_pago:       { titulo: '✅ Solicitud de Pago Aprobada', instruccion: 'Puede ir al módulo de Pagos para Registrar el Pago cuando guste.', boton: 'Entendido' },
    ver_rechazo:          { titulo: '❌ Solicitud de Pago Rechazada', instruccion: 'Revise el motivo y corrija la Obligación en el módulo de Pagos.', boton: 'Entendido' },
    sin_firma_disponible: { titulo: '⚠️ Sin Firma Autorizada Disponible', instruccion: 'Ningún aprobador con Nivel de Firma tiene sesión activa en este momento. Avise a su supervisor o intente más tarde.', boton: 'Entendido' },
    solicitud_anulacion_entrada: { titulo: '⚠ Solicitud de Anulación de Entrada', instruccion: 'Revise el detalle e ingrese a Inventario → Historial para decidir si anula el movimiento.', boton: 'Ir a Revisar' }
  };
  let cfgNotif = CONFIG_NOTIF[accionNotif] || CONFIG_NOTIF.confirmar_recepcion;

  // ── Caso especial: rechazo de una CxP automática de Entrada de Stock ──
  // No se marca como resuelta con solo pulsar el botón -- se re-verifica en
  // vivo si la Entrada sigue EN_REVISION; si sigue así, el botón lleva a
  // corregirla (Inventario) en vez de descartar la notificación, y esta
  // seguirá reapareciendo hasta que realmente se corrija o se anule.
  if (accionNotif === 'ver_rechazo' && extrasNotif && extrasNotif.id_entrada) {
    try {
      const entRows = await api('stock_entradas','GET',null,
        '?id_entrada=eq.'+extrasNotif.id_entrada+'&select=estado_revision,id_articulo,anulada');
      const entRow = entRows && entRows[0];
      if (entRow && !entRow.anulada && entRow.estado_revision === 'EN_REVISION') {
        _notifEsEntradaSinResolver = true;
        let nombreArt = '';
        try {
          const artRows = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+entRow.id_articulo+'&select=nombre_articulo');
          nombreArt = artRows && artRows[0] ? artRows[0].nombre_articulo : '';
        } catch(e) {}
        _notifEntradaInfo = { id_entrada: extrasNotif.id_entrada, id_articulo: entRow.id_articulo, nombre_articulo: nombreArt };
        cfgNotif = {
          titulo: '❌ Entrada de Stock Rechazada — Pendiente',
          instruccion: 'Esta Entrada quedó sin resolver. Corríjala desde Inventario, o solicite la anulación a su superior si no puede corregirla usted mismo.',
          boton: 'Ir a Corregir'
        };
        if (btnEscalar && !sesionActual?.administrador && !puedo('INVENTARIO','ANULAR_ENTRADA')) {
          btnEscalar.style.display = '';
        }
      }
      // Si ya no está EN_REVISION (se corrigió o se anuló), se comporta
      // como una notificación normal -- se descarta al pulsar "Entendido".
    } catch(eChkEnt) { console.warn('Error verificando estado de Entrada:', eChkEnt); }
  }

  if (accionNotif === 'solicitud_anulacion_entrada' && extrasNotif && extrasNotif.id_entrada) {
    try {
      const entRows2 = await api('stock_entradas','GET',null,
        '?id_entrada=eq.'+extrasNotif.id_entrada+'&select=estado_revision,id_articulo,anulada');
      const entRow2 = entRows2 && entRows2[0];
      if (entRow2 && !entRow2.anulada && entRow2.estado_revision === 'EN_REVISION') {
        _notifEsEntradaSinResolver = true;
        _notifEntradaInfo = { id_entrada: extrasNotif.id_entrada, id_articulo: entRow2.id_articulo, nombre_articulo: extrasNotif.nombre_articulo || '' };
      }
    } catch(eChkEnt2) { console.warn('Error verificando estado de Entrada:', eChkEnt2); }
  }

  if (titEl) titEl.textContent = cfgNotif.titulo;
  if (instrEl) instrEl.textContent = cfgNotif.instruccion;
  if (btnConf) { btnConf.textContent = cfgNotif.boton; btnConf.dataset.textoOriginal = cfgNotif.boton; }

  document.getElementById('modal-notif-pendiente').style.display = 'flex';
}

async function notifConfirmar() {
  if (!_notifPendienteActual) return;

  // ── Caso especial: Entrada de Stock rechazada, todavía sin resolver ──
  // No se marca como leída -- solo navega a corregirla. Volverá a aparecer
  // en la próxima navegación si sigue sin resolverse.
  if (_notifEsEntradaSinResolver && _notifEntradaInfo) {
    document.getElementById('modal-notif-pendiente').style.display = 'none';
    window._suprimirCheckNotifUnaVez = true;
    mostrarModulo('inventario', document.getElementById('nav-INVENTARIO'));
    setTimeout(function() {
      if (typeof verHistorialStock === 'function') {
        verHistorialStock(_notifEntradaInfo.id_articulo, _notifEntradaInfo.nombre_articulo || '');
      }
    }, 350);
    return;
  }

  const btn = document.getElementById('btn-notif-confirmar');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmando...'; }
  try {
    // Revalidación fresca: esta notificación pudo quedar abierta en pantalla
    // desde antes de que alguien EDITARA la Salida que la originó -- en ese
    // caso la Salida ya anuló esta notificación (estado=ANULADO) y generó
    // una nueva con los datos correctos. Si se confirmara igual la vieja
    // (con datos_extra desactualizados, ej. una cantidad ya corregida), se
    // acreditaría stock con el número equivocado. Se verifica el estado
    // REAL en la base antes de proceder, sin confiar en el objeto en
    // memoria del navegador.
    const notifFrescaChk = await api('notificaciones','GET',null,
      '?id=eq.'+_notifPendienteActual.id+'&select=id,estado');
    if (!notifFrescaChk || !notifFrescaChk[0] || notifFrescaChk[0].estado !== 'PENDIENTE') {
      document.getElementById('modal-notif-pendiente').style.display = 'none';
      _notifPendienteActual = null;
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '✓ Confirmar Recepción'; }
      alert('Esta notificación ya no está vigente -- probablemente fue actualizada (por ejemplo, si se corrigió la cantidad de la Salida que la originó). Se recargarán sus notificaciones pendientes.');
      window._suprimirCheckNotifUnaVez = false;
      setTimeout(verificarNotificacionesPendientes, 200);
      return;
    }

    const extras = _notifPendienteActual.datos_extra
      ? (typeof _notifPendienteActual.datos_extra === 'string'
          ? JSON.parse(_notifPendienteActual.datos_extra)
          : _notifPendienteActual.datos_extra)
      : null;
    const accionNotif = extras && extras.accion || null;

    // ── Caso especial: Aprobación de Entrada de Compra -- se resuelve
    // directo desde la notificación (aprobarEntradaCompra ya revalida el
    // límite del Nivel de Firma y ejecuta Stock/CPP/Asiento/CxP), en vez de
    // solo acreditar stock como hace confirmar_recepcion.
    if (accionNotif === 'aprobar_entrada' && extras && extras.id_entrada) {
      await api('notificaciones','PATCH',
        { estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },
        '?id=eq.'+_notifPendienteActual.id);
      document.getElementById('modal-notif-pendiente').style.display = 'none';
      _notifPendienteActual = null;
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '✓ Confirmar Recepción'; }
      if (typeof aprobarEntradaCompra === 'function') await aprobarEntradaCompra(extras.id_entrada);
      await verificarNotificacionesPendientes();
      // Ir directo a Cuentas por Pagar -- ya se resolvió la Entrada, tiene
      // sentido ver de inmediato la Obligación de Pago que quedó (o no)
      // generada, sin quedarse en la pantalla donde estaba antes.
      mostrarModulo('pagos', document.getElementById('nav-PAGOS'));
      return;
    }

    // ── Caso especial: aviso de Entrada de Compra Rechazada -- al pulsar
    // "Proceder", en vez de solo cerrar el aviso, llevar directo al
    // Historial de Movimientos del artículo, donde puede ver la Entrada
    // rechazada en contexto y corregirla desde ahí.
    if (accionNotif === 'entrada_compra_rechazada' && extras && extras.id_entrada) {
      await api('notificaciones','PATCH',
        { estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },
        '?id=eq.'+_notifPendienteActual.id);
      document.getElementById('modal-notif-pendiente').style.display = 'none';
      _notifPendienteActual = null;
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '✓ Confirmar Recepción'; }
      await verificarNotificacionesPendientes();
      try {
        const entRowsRech = await api('stock_entradas','GET',null,
          '?id_entrada=eq.'+extras.id_entrada+'&select=id_articulo');
        const idArticuloRech = entRowsRech && entRowsRech[0] ? entRowsRech[0].id_articulo : null;
        let nombreArtRech = '';
        if (idArticuloRech) {
          const artRowsRech = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+idArticuloRech+'&select=nombre_articulo');
          nombreArtRech = artRowsRech && artRowsRech[0] ? artRowsRech[0].nombre_articulo : '';
        }
        window._suprimirCheckNotifUnaVez = true;
        mostrarModulo('inventario', document.getElementById('nav-INVENTARIO'));
        setTimeout(function() {
          if (idArticuloRech && typeof verHistorialStock === 'function') verHistorialStock(idArticuloRech, nombreArtRech);
        }, 350);
      } catch(eNavRech) { console.warn('Error navegando al Historial de Movimientos:', eNavRech); }
      return;
    }

    // 1. Marcar notificación como APROBADO
    await api('notificaciones','PATCH',
      { estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },
      '?id=eq.'+_notifPendienteActual.id);

    // 2. Sumar stock al ÁREA DESTINO (solo aplica a notificaciones de
    // Recepción de Artículo, y solo para Mercancía — un Consumible ya se
    // gastó de inmediato al salir de Compras, así que confirmar su
    // recepción es solo un acuse, sin efecto en el stock).
    try {
      if (extras && extras.id_articulo && extras.cantidad && extras.id_area_destino) {
        const artRes = await api('inventario_almacen','GET',null,
          '?id_articulo=eq.'+extras.id_articulo+'&select=id_articulo,id_cuenta_contable');
        if (artRes && artRes[0]) {
          let esMercanciaNotif = false;
          if (artRes[0].id_cuenta_contable) {
            const ctaNotif = (await obtenerCuentasContables()).find(function(c){ return c.id_cuenta === artRes[0].id_cuenta_contable; });
            esMercanciaNotif = !!(ctaNotif && ctaNotif.codigo === '1.1.03.001');
          }
          if (esMercanciaNotif) {
            await upsertStockArea(extras.id_articulo, extras.id_area_destino, parseFloat(extras.cantidad));
          }
        }
      }
    } catch(eStock) { console.warn('Error actualizando stock al confirmar:', eStock); }

    document.getElementById('modal-notif-pendiente').style.display = 'none';
    _notifPendienteActual = null;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '✓ Confirmar Recepción'; }

    // Si el Usuario está viendo Inventario General en este momento, se
    // refresca -- de lo contrario el badge "Por Confirmar" y el Stock
    // desactualizado se quedaban pegados hasta que alguien saliera y
    // volviera a entrar al módulo manualmente.
    if (document.getElementById('buscar-inv') && typeof renderInventario === 'function') {
      try { await renderInventario(document.getElementById('buscar-inv').value || ''); } catch(eRefreshInv) {}
    }

    // Llevar directo a Inventario General tras confirmar una Recepción --
    // antes solo se refrescaba si el usuario ya estaba parado ahí; ahora
    // se navega siempre para que vea de inmediato el Stock actualizado.
    if (!accionNotif && extras && extras.id_area_destino) {
      await verificarNotificacionesPendientes();
      mostrarModulo('inventario', document.getElementById('nav-INVENTARIO'));
      return;
    }

    // 3. Llevar directo al listado de Cuentas por Pagar si es una
    // notificación de aprobación de Pagos, en vez de solo cerrar el popup
    if (accionNotif === 'aprobar_pago' && extras && extras.id_cxp) {
      mostrarModulo('pagos', document.getElementById('nav-PAGOS'));
      return;
    }

    // Verificar si hay más notificaciones pendientes
    await verificarNotificacionesPendientes();
  } catch(e) {
    alert('Error al confirmar: '+msgErr(e));
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '✓ Confirmar Recepción'; }
  }
}

function notifVerDespues() {
  document.getElementById('modal-notif-pendiente').style.display = 'none';
  // No marca como leída — volverá a aparecer en la próxima navegación
}

// Rechaza una Entrada de Compra directo desde la notificación -- reutiliza
// rechazarEntradaCompra() (en inventario.js, ya pide el motivo, revalida
// que siga PENDIENTE, y notifica al creador), y aquí solo se encarga de
// cerrar/marcar esta notificación puntual como resuelta.
// Diálogo genérico Sí/No con el mismo estilo visual del resto de la app
// (evita la alerta nativa fea del navegador) -- usado antes de acciones
// irreversibles o que abren otro paso (como pedir el motivo de un rechazo).
async function confirmarSiNo(mensaje) {
  return new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10001;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:360px;width:90%">'
      + '<div style="font-size:14px;margin-bottom:20px;color:#e8e8e8;text-align:center">'+mensaje+'</div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-sn-si" style="background:#fc8181;border:none;color:#1a1a1a;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Sí</button>'
      + '<button id="btn-sn-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">No</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const cerrar = function(v) { document.body.removeChild(div); resolve(v); };
    div.querySelector('#btn-sn-si').onclick = function(){ cerrar(true); };
    div.querySelector('#btn-sn-no').onclick = function(){ cerrar(false); };
  });
}

// Aviso simple (solo "Aceptar"), mismo estilo -- reemplaza al alert()
// nativo del navegador, que se ve ajeno al resto de la app.
async function mostrarAvisoOk(mensaje, esError) {
  return new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10001;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid '+(esError?'#fc8181':'#333')+';border-radius:10px;padding:24px;max-width:360px;width:90%">'
      + '<div style="font-size:14px;margin-bottom:20px;color:'+(esError?'#fc8181':'#e8e8e8')+';text-align:center">'+mensaje+'</div>'
      + '<div style="display:flex;justify-content:center">'
      + '<button id="btn-aviso-ok" style="background:'+(esError?'#333':'var(--naranja)')+';border:none;color:'+(esError?'#e8e8e8':'#1a1a1a')+';padding:10px 32px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Aceptar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    div.querySelector('#btn-aviso-ok').onclick = function(){ document.body.removeChild(div); resolve(); };
  });
}

async function notifRechazarEntrada() {
  if (!_notifPendienteActual) return;
  const extras = _notifPendienteActual.datos_extra
    ? (typeof _notifPendienteActual.datos_extra === 'string'
        ? JSON.parse(_notifPendienteActual.datos_extra)
        : _notifPendienteActual.datos_extra)
    : null;
  if (!extras || !extras.id_entrada) return;
  const confirmaRech = await confirmarSiNo('¿Seguro que desea rechazar esta Entrada?');
  if (!confirmaRech) return;
  const idNotifRech = _notifPendienteActual.id;
  if (typeof rechazarEntradaCompra !== 'function') return;
  const seRechazoOk = await rechazarEntradaCompra(extras.id_entrada);
  // Si el Usuario canceló el diálogo de motivo (o algo falló), la
  // notificación se queda tal cual, para volver a intentarlo -- no se
  // cierra el modal ni se marca como resuelta.
  if (!seRechazoOk) return;
  document.getElementById('modal-notif-pendiente').style.display = 'none';
  _notifPendienteActual = null;
  try {
    await api('notificaciones','PATCH',
      { estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },
      '?id=eq.'+idNotifRech);
  } catch(eNotifRechCierre) { console.warn('Error cerrando notificación de aprobación:', eNotifRechCierre); }
  await verificarNotificacionesPendientes();
  mostrarModulo('pagos', document.getElementById('nav-PAGOS'));
}

async function notifSolicitarAnulacion() {
  if (!_notifEntradaInfo) return;
  const btnEsc = document.getElementById('btn-notif-escalar');
  if (btnEsc) { btnEsc.disabled = true; btnEsc.textContent = 'Enviando...'; }
  try {
    const entRows = await api('stock_entradas','GET',null,
      '?id_entrada=eq.'+_notifEntradaInfo.id_entrada+'&select=id_area,cantidad,motivo');
    const ent = entRows && entRows[0];
    const artRows = await api('inventario_almacen','GET',null,
      '?id_articulo=eq.'+_notifEntradaInfo.id_articulo+'&select=nombre_articulo');
    const nombreArt = artRows && artRows[0] ? artRows[0].nombre_articulo : _notifEntradaInfo.nombre_articulo || 'artículo';

    // Buscar al responsable de mayor jerarquía del área (mismo patrón que
    // ya se usa para notificar reversos de Salida)
    const responsables = await api('empleados', 'GET', null,
      '?id_area=eq.' + (ent?.id_area || 0) + '&id_nivel_jerarquico=not.is.null&order=id_nivel_jerarquico.asc&select=correo&limit=1'
      + (_empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : ''));
    const correoSuperior = responsables && responsables[0] ? responsables[0].correo : null;

    if (!correoSuperior) {
      alert('No se encontró un responsable de mayor jerarquía en el área de esta Entrada. Notifique manualmente a su supervisor.');
      if (btnEsc) { btnEsc.disabled = false; btnEsc.textContent = '⬆ Solicitar Anulación al Superior'; }
      return;
    }

    await api('notificaciones','POST',{
      correo_destino: correoSuperior,
      titulo: 'Solicitud de Anulación de Entrada de Stock',
      mensaje: (sesionActual?.nombre || sesionActual?.correo_usuario || 'Un operador') + ' solicita la anulación de ENT-' + _notifEntradaInfo.id_entrada + ' (' + (ent?.cantidad || '') + ' uds. de "' + nombreArt + '"), ya que la Obligación de Pago fue rechazada y no cuenta con el permiso para anularla directamente.',
      estado: 'PENDIENTE',
      fecha_creacion: new Date().toISOString(),
      datos_extra: JSON.stringify({ accion: 'solicitud_anulacion_entrada', id_entrada: _notifEntradaInfo.id_entrada, nombre_articulo: nombreArt })
    }, '', true);

    // La notificación de rechazo original ya cumplió su propósito (se
    // escaló) -- se marca resuelta para el Operador; la responsabilidad
    // de resolverlo pasa ahora al Superior.
    if (_notifPendienteActual) {
      await api('notificaciones','PATCH',{ estado: 'APROBADO', fecha_respuesta: new Date().toISOString() }, '?id=eq.'+_notifPendienteActual.id);
    }

    document.getElementById('modal-notif-pendiente').style.display = 'none';
    alert('Se notificó al superior del área para que decida sobre la anulación.');
    _notifPendienteActual = null;
    _notifEsEntradaSinResolver = false;
    _notifEntradaInfo = null;
    await verificarNotificacionesPendientes();
  } catch(eEsc) {
    alert('Error al escalar la solicitud: ' + msgErr(eEsc));
  } finally {
    if (btnEsc) { btnEsc.disabled = false; btnEsc.textContent = '⬆ Solicitar Anulación al Superior'; }
  }
}


// ═══ SECCION: Utilidades compartidas (movidas desde facturacion.js) ═══

function emisorQ() {
  return _empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : '';
}

function emisorQStart() {
  return _empresaActiva ? '?id_empresa=eq.' + _empresaActiva.id_empresa : '?';
}

// Traduce errores técnicos de red/navegador (que el usuario no puede
// interpretar) a un mensaje amigable. "Failed to fetch" (Chrome/Edge),
// "NetworkError when attempting to fetch resource" (Firefox) y
// "Load failed" (Safari) son las variantes típicas cuando no hay conexión
// a Internet o el servidor no responde.
// Simplifica el numero_doc para mostrarlo al usuario -- internamente lleva
// un sufijo con el id_cxp (para evitar duplicados en la base de datos),
// pero eso no le aporta nada al usuario. CONTADO: "ENT-1-1" -> "ENT-1".
// CRÉDITO: "ENT-1-C2-15" -> "ENT-1-C2". El valor guardado en la base de
// datos NO cambia, esto es solo para mostrar.
function fmtNumeroDoc(numeroDoc) {
  if (!numeroDoc) return numeroDoc;
  const mCredito = numeroDoc.match(/^(ENT-\d+-C\d+)-\d+$/);
  if (mCredito) return mCredito[1];
  const mContado = numeroDoc.match(/^(ENT-\d+)-\d+$/);
  if (mContado) return mContado[1];
  return numeroDoc;
}

function msgErr(e) {
  const m = (e && e.message) || String(e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return 'Falla de Comunicación — verifique su conexión a Internet e intente de nuevo.';
  }
  return m;
}

function fmtFecha(fecha) {
  if (!fecha) return '—';
  const f = fecha.substring(0, 10); // YYYY-MM-DD
  const partes = f.split('-');
  if (partes.length !== 3) return fecha;
  return partes[2] + '-' + partes[1] + '-' + partes[0];
}

// ══════════════════════════════════════════════════════════════
//  TARJETA DE ENTREGA (compartida entre Ventas e Inventario General)
//
//  Un solo lugar que dibuja la tarjeta de "qué compone esta Venta y su
//  estado de entrega", para que Ventas (consulta) e Inventario (proceso
//  real de entrega) SIEMPRE se vean exactamente igual -- si algún día hay
//  que ajustar el formato, se ajusta aquí una sola vez.
//
//  v: fila de `ventas` con embeds clientes(...) y facturas(...,total_ves)
//  lineas: arreglo [{nombre, cantidad}, ...] de venta_detalle
//  opts:
//    soloLectura  -- true en Ventas (Lista) e Inventario > Histórico;
//                    false en Inventario > Pendientes (permite entregar)
//    puedeMarcar  -- solo aplica si soloLectura=false
// ══════════════════════════════════════════════════════════════
function renderTarjetaEntregaVenta(v, lineas, opts) {
  opts = opts || {};
  const cli = v.clientes;
  const fecha = v.facturas?.fecha_emision ? fmtFecha(v.facturas.fecha_emision) : (v.fecha_venta ? fmtFecha(v.fecha_venta) : '—');
  const entregada = !!v.entregado;

  const filasArts = (lineas && lineas.length)
    ? lineas.map(function(l) {
        return '<tr>'
          + '<td style="text-align:center;font-family:var(--font-mono)">'+l.cantidad+'</td>'
          + '<td>'+l.nombre+'</td>'
          + '<td style="text-align:center"><input type="checkbox" '+(opts.soloLectura?('disabled'+(entregada?' checked':'')):'')+' style="width:16px;height:16px;cursor:'+(opts.soloLectura?'default':'pointer')+'"></td>'
          + '</tr>';
      }).join('')
    : '<tr><td colspan="3" style="text-align:center;color:var(--suave)">Sin artículos registrados</td></tr>';

  let pie;
  if (opts.soloLectura) {
    pie = entregada
      ? '<div style="color:#22c55e;font-size:12px">✓ Entregado el '+(v.fecha_entrega?fmtFecha(v.fecha_entrega):'—')+' por '+(v.entregado_por||'—')+'</div>'
      : '<div style="color:var(--suave);font-size:12px">⏳ Pendiente de entrega en Almacén</div>';
  } else {
    pie = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'
      + '<div style="font-size:11px;color:var(--suave);text-transform:uppercase;letter-spacing:1px">Validar Entrega</div>'
      + (opts.puedeMarcar
          ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
            + '<input type="text" id="entrega-almacen-input-'+v.id_venta+'" placeholder="N° de Factura" '
            + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_confirmarEntregaAlmacen('+v.id_venta+')}" '
            + 'style="background:var(--fondo);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:140px">'
            + '<button class="btn-primario" id="entrega-almacen-btn-'+v.id_venta+'" style="font-size:11px;padding:8px 14px" onclick="_confirmarEntregaAlmacen('+v.id_venta+')">Confirmar Entrega</button>'
            + '</div>'
          : '<span style="font-size:11px;color:var(--suave)">Sin permiso para entregar</span>')
      + '</div>'
      + '<div id="entrega-almacen-msg-'+v.id_venta+'" style="display:none;font-size:11px;margin-top:8px;text-align:right"></div>';
  }

  return '<div style="margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px">'
      + '<div>'
        // N° de Factura -- solo se muestra en modo lectura (Histórico o
        // consulta desde Ventas). En Inventario > Pendientes se sigue
        // ocultando a propósito: es el dato que el operador debe obtener
        // del Cliente físicamente, para validar la entrega.
        + (opts.soloLectura ? '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">N° Factura</div>'
          + '<div style="font-family:var(--font-mono);font-size:13px;margin-bottom:6px">'+(v.facturas?.numero_factura||'—')+'</div>' : '')
        + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Cédula/RIF</div>'
        + '<div style="font-family:var(--font-mono);font-size:13px;margin-bottom:6px">'+(cli?(cli.condicion_legal+'-'+cli.identificacion):'—')+'</div>'
        + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Cliente</div>'
        + '<div style="font-size:13px;font-weight:600">'+(cli?cli.nombre_apellido:'—')+'</div>'
      + '</div>'
      + '<div style="text-align:right">'
        + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Fecha</div>'
        + '<div style="font-size:13px;margin-bottom:6px">'+fecha+'</div>'
        + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Monto Factura</div>'
        + '<div style="font-family:var(--font-mono);font-size:14px;color:var(--naranja);font-weight:600">'+fmtBs(v.facturas?.total_ves||0)+' Bs</div>'
        + '<div style="font-family:var(--font-mono);font-size:11px;color:var(--suave)">$ '+fmtUSD(v.total_usd||0)+'</div>'
      + '</div>'
    + '</div>'
    + '<div style="background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:16px">'
    + '<div style="max-height:220px;overflow-y:auto;margin-bottom:12px;border-bottom:1px solid var(--borde)">'
    + '<table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:1px solid var(--borde)">'
      + '<th style="text-align:center;font-size:10px;color:var(--suave);text-transform:uppercase;padding:6px 0;width:70px;position:sticky;top:0;background:var(--gris2)">Cantidad</th>'
      + '<th style="text-align:left;font-size:10px;color:var(--suave);text-transform:uppercase;padding:6px 0;position:sticky;top:0;background:var(--gris2)">Artículos</th>'
      + '<th style="text-align:center;font-size:10px;color:var(--suave);text-transform:uppercase;padding:6px 0;width:80px;position:sticky;top:0;background:var(--gris2)">Entregado</th>'
      + '</tr></thead><tbody>'
      + filasArts
      + '</tbody></table>'
    + '</div>'
    + '<div style="padding-top:12px">'+pie+'</div>'
    + '</div>'
  + '</div>';
}

async function cargarEmpresasAccesoModal(correo) {
  const grid = document.getElementById('empresas-acceso-grid');
  if (!grid) return;
  try {
    const todasEmisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id_empresa,nombre,rif');
    let asignadas = new Set();
    let idEmpresaNomina = null;
    if (correo) {
      const ues = await api('usuarios_empresas','GET',null,
        '?correo_usuario=eq.'+encodeURIComponent(correo)+'&activo=eq.true&select=id_empresa');
      ues.forEach(function(u){ asignadas.add(u.id_empresa); });
      // La empresa donde está registrado como empleado (nómina) debe verse
      // marcada por defecto, aunque todavía no tenga fila en usuarios_empresas
      try {
        const empRows = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(correo)+'&select=id_empresa&limit=1');
        if (empRows && empRows[0] && empRows[0].id_empresa) {
          idEmpresaNomina = empRows[0].id_empresa;
          asignadas.add(idEmpresaNomina);
        }
      } catch(eEmpN) { console.warn('Error obteniendo empresa de nómina:', eEmpN); }
    }
    grid.innerHTML = todasEmisores.map(function(e) {
      const esNomina = e.id_empresa === idEmpresaNomina;
      const marcada  = esNomina || asignadas.has(e.id_empresa);
      const checked  = marcada ? 'checked' : '';
      const disabled = esNomina ? 'disabled' : '';
      return '<label style="display:flex;align-items:center;gap:8px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:8px 12px;cursor:'+(esNomina?'not-allowed':'pointer')+';font-size:12px"'+(esNomina?' title="Empresa de Nómina -- no se puede quitar"':'')+'>'
        + '<input type="checkbox" value="'+e.id_empresa+'" '+checked+' '+disabled+' class="emp-acceso-check" style="accent-color:var(--naranja);width:15px;height:15px">'
        + '<div><div style="font-weight:600">'+e.nombre+(esNomina ? ' <span style="font-size:10px;color:var(--naranja);font-weight:400">🔒 (Empresa de Nómina)</span>' : '')+'</div>'
        + (e.rif ? '<div style="font-size:10px;color:var(--suave)">'+e.rif+'</div>' : '')
        + '</div></label>';
    }).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color:var(--suave);font-size:12px">Error cargando empresas</div>';
  }
}

function getEmpresasAccesoSeleccionadas() {
  const checks = document.querySelectorAll('.emp-acceso-check:checked');
  return Array.from(checks).map(function(c){ return parseInt(c.value); });
}

async function hashearClave(clave) {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/hashear_clave', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_clave: clave })
    });
    return await res.json();
  } catch(e) {
    throw new Error('Error hasheando contraseña: ' + e.message);
  }
}

async function verificarContrasena(correoUsu, claveIngresada) {
  try {
    // Usa el JWT de sesión si existe (todos los llamadores actuales son
    // re-confirmaciones a mitad de sesión); cae a la anon key solo si no hay sesión
    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
      'Content-Type':  'application/json'
    };
    // Buscar usuario
    const res = await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' 
      + encodeURIComponent(correoUsu) 
      + '&select=correo_usuario,contrasena,estado_usuario,nombre,administrador', { headers });
    const data = await res.json();
    if (!data || !data.length) return { ok: false, msg: 'Usuario no encontrado.' };
    const usu = data[0];
    if (usu.estado_usuario === 'INACTIVO') return { ok: false, msg: 'Usuario inactivo.' };

    // Verificar bcrypt via RPC
    const resVerif = await fetch(SUPABASE_URL + '/rest/v1/rpc/verificar_clave', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ p_clave: claveIngresada, p_hash: usu.contrasena })
    });
    
    if (!resVerif.ok) {
      // Fallback: si RPC falla, intentar comparación directa (compatibilidad)
      console.warn('RPC verificar_clave falló, usando fallback');
      return { ok: false, msg: 'Error de autenticación. Contacte al administrador.' };
    }
    
    const valido = await resVerif.json();
    if (!valido) return { ok: false, msg: 'Contraseña incorrecta.' };
    return { ok: true, usuario: usu };
  } catch(e) {
    return { ok: false, msg: 'Error verificando contraseña: ' + msgErr(e) };
  }
}

async function validarClaveUsuarioActual(clave) {
  const correo = sesionActual?.correo_usuario;
  if (!correo || !clave) return { ok: false, msg: 'Debe ingresar su contraseña.' };
  const verif = await verificarContrasena(correo, clave);
  if (!verif.ok) return { ok: false, msg: 'Contraseña incorrecta.' };
  return { ok: true };
}

async function validarClaveReceptor(id_empleado, clave) {
  if (!id_empleado || !clave) return { ok: false, msg: 'Debe seleccionar un empleado remitente e ingresar su contraseña.' };
  try {
    // Buscar el correo del empleado
    const empArr = await api('empleados', 'GET', null, '?id_empleado=eq.' + id_empleado + '&select=id_empleado,nombre_completo,correo');
    const emp = empArr[0];
    if (!emp) return { ok: false, msg: 'Empleado no encontrado.' };
    if (!emp.correo) return { ok: false, msg: 'El empleado remitente no tiene correo registrado en el sistema.' };

    // Buscar usuario por correo y validar contraseña
    const usuArr = await api('usuarios', 'GET', null,
      '?correo_usuario=ilike.' + encodeURIComponent(emp.correo) + '&estado_usuario=eq.ACTIVO&select=correo_usuario,contrasena,nombre');
    const usu = usuArr[0];
    if (!usu) return { ok: false, msg: 'El empleado "' + emp.nombre_completo + '" no tiene usuario activo en el sistema.' };
    const verifRec = await verificarContrasena(usu.correo_usuario, clave);
    if (!verifRec.ok) return { ok: false, msg: '' + emp.nombre_completo + ' Contraseña incorrecta.' };

    return { ok: true, nombre: emp.nombre_completo };
  } catch(err) {
    return { ok: false, msg: 'Error validando receptor: ' + msgErr(err) };
  }
}

async function cargarEmpleadosPorArea(id_area, selectId, soloConPermiso) {
  // soloConPermiso: si true, filtra solo empleados con permiso INVENTARIO->ENTRADA_STOCK
  const sel = document.getElementById(selectId);
  if (!sel) return;
  if (!id_area) {
    sel.innerHTML = '<option value="">— Seleccionar área primero —</option>';
    return;
  }
  sel.innerHTML = '<option value="">Cargando...</option>';
  try {
    const emps = await api('empleados', 'GET', null,
      '?id_area=eq.' + id_area + '&estatus=eq.ACTIVO&order=nombre_completo.asc&select=id_empleado,nombre_completo,id_cargo,correo,param_cargos(nombre)');
    if (!emps || !emps.length) {
      sel.innerHTML = '<option value="">— Sin empleados en esta área —</option>';
      return;
    }

    let empsFiltrados = emps;

    if (soloConPermiso) {
      // Obtener correos con permiso INVENTARIO → ENTRADA_STOCK
      const perms = await api('usuarios_permisos', 'GET', null,
        '?modulo=eq.INVENTARIO&accion=eq.ENTRADA_STOCK&select=correo_usuario') || [];
      const correosAutorizados = perms.map(function(p){ return (p.correo_usuario||'').toLowerCase(); });

      // Cruzar por empleados.correo (el vínculo es correo, no id_usuario)
      if (correosAutorizados.length) {
        empsFiltrados = emps.filter(function(e){
          return e.correo && correosAutorizados.includes(e.correo.toLowerCase());
        });
      } else {
        empsFiltrados = [];
      }
    }

    if (!empsFiltrados.length) {
      sel.innerHTML = '<option value="">— Sin empleados autorizados en esta área —</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Seleccionar empleado —</option>'
      + empsFiltrados.map(function(e) {
          return '<option value="' + e.id_empleado + '">'
            + e.nombre_completo
            + (e.param_cargos ? ' · ' + e.param_cargos.nombre : '')
            + '</option>';
        }).join('');
  } catch(err) {
    sel.innerHTML = '<option value="">— Error cargando empleados —</option>';
    console.error('cargarEmpleadosPorArea:', err);
  }
}

function parseMontoVE(texto) {
  const raw = String(texto || '').replace(/\./g,'').replace(',','.');
  return parseFloat(raw) || 0;
}

// Inverso de parseMontoVE() -- convierte un número plano a formato
// venezolano (puntos de millar, coma decimal), igual al que produce el
// onblur del campo cuando el Usuario escribe a mano.
function formatearMontoVE(num) {
  const v = parseFloat(num);
  if (isNaN(v)) return '';
  const p = v.toFixed(2).split('.');
  return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
}

// Re-trigger de build (index.html quedó desactualizado tras el push anterior, mismo síntoma ya documentado)

// re-trigger build 2026-08-27-21-00
