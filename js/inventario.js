// ─── S&D Systems — Módulo: INVENTARIO (unificado) ───
// Fusion de inventario.js + inventario2.js + funciones de facturacion.js
// Reorganizacion ejecutada el 2026-08-03
//
// Fix 2026-08-04: se recuperaron 8 variables globales que se perdieron en
// la fusión original (el script de extracción solo copió funciones, no
// las variables sueltas declaradas fuera de ellas).
let _historialEstado = { id_articulo: null, cursor: null, terminado: false, idAreaH: null, filtro: 'todas' };
const HISTORIAL_PAGE_SIZE = 50;
const CAMPOS_EDIT_ENTRADA = ['edit-mov-fecha-negociacion','edit-mov-moneda','edit-mov-cantidad',
  'edit-mov-precio','edit-mov-precio-venta','edit-mov-motivo','edit-mov-proveedor',
  'edit-mov-cliente','edit-mov-area-origen','edit-mov-area','edit-mov-empleado',
  'edit-mov-esquema-pago','edit-mov-obs'];
const CAMPOS_EDIT_SALIDA = ['edit-sal-fecha','edit-sal-cantidad','edit-sal-precio-venta',
  'edit-sal-moneda-venta','edit-sal-area','edit-sal-empleado','edit-sal-observaciones'];
let _editMovTipoActual   = null;
let _editMovPuedeEditar  = false;
let _editMovEstaPagado   = false;
let _editMovVistaComoEntrada = false; // true = se está viendo una Salida desde el Área receptora (se lee como Entrada)
// Notificación de Recepción ligada a la Salida que se está editando (solo
// aplica si tiene Empleado que Recibe -- si no, el stock se acreditó de
// inmediato al crearla y no hay notificación de por medio). null = no
// aplica esta regla; {id, estado} = sí aplica.
let _editMovNotifSalida = null;
let _idAreaComprasCache = null;
async function obtenerIdAreaCompras() {
  if (_idAreaComprasCache !== null) return _idAreaComprasCache;
  try {
    const r = await api('param_areas','GET',null,'?codigo=eq.2300&select=id&limit=1');
    _idAreaComprasCache = r?.[0]?.id || null;
  } catch(e) { console.warn('No se pudo determinar el Área de Compras:', e); _idAreaComprasCache = null; }
  return _idAreaComprasCache;
}
var _invVista = 'tabla';
var _invSaldoConsolidado = null; // { id_articulo: totalTodasLasAreas }
let _invCategoriasCache = [];
let _invAreasCache = []; // Áreas activas -- para el selector de Área visible solo con VER_INVENTARIO_GENERAL
let _invPendientesPorArticulo = {}; // { id_articulo: [{cantidad, nombreArea, codigoArea}] } -- entregas en tránsito, pendientes de "Confirmar Recepción"
let _invAreasConStock = new Set(); // ids de Área con al menos un artículo con stock > 0 (se recalcula en calcularInvSaldoArea)
let _invFiltroAreaManual = null; // id_area elegido manualmente por un usuario con VER_INVENTARIO_GENERAL (null = ver consolidado)
let _invSaldoArea = null; // Saldo por área del usuario — null = mostrar stock global
var _fichaInvActual = { id: null, nombre: '' }; // reubicada aqui desde ingresos.js, es de Inventario

// ═══ SECCION: Analisis, Lista General, ABC/EOQ/Reorden, Categorias/Tipos (ex inventario2.js) ═══
function clasificarABC(items) {
  if (!items.length) return items;
  const conValor = items.map(function(r) {
    // valor_inventario SIEMPRE en USD, y en VIVO (CPP ÷ Margen vigente) --
    // el guardado es solo el histórico de la última Salida; usar ese
    // rompería la clasificación si el CPP o el Margen cambiaron desde
    // entonces, además del riesgo de mezclar monedas (ver precioVentaDual).
    const ventaUSD = precioVentaEnVivo(r).usd;
    return Object.assign({}, r, { valor_inventario: ventaUSD * stockMostrarArticulo(r.id_articulo) });
  });
  conValor.sort(function(a, b) { return b.valor_inventario - a.valor_inventario; });
  const totalValor = conValor.reduce(function(s, r) { return s + r.valor_inventario; }, 0);
  var acumulado = 0;
  return conValor.map(function(r) {
    acumulado += r.valor_inventario;
    var pct = totalValor > 0 ? (acumulado / totalValor) * 100 : 0;
    return Object.assign({}, r, { clase_abc: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C' });
  });
}

// Tasa BCV para convertir el CPP a Bs -- NO es la de hoy, es la que existía
// en la fecha de la ÚLTIMA Entrada de cada Artículo (el CPP es un
// promedio ponderado, así que su valor "nace" en el momento de esa
// compra, no hoy). El Precio de Venta sí usa la tasa de HOY (es un cálculo
// en vivo, no histórico) -- son cosas distintas a propósito.
let _tasaCppPorArticulo = {};
async function refrescarTasasHistoricasCPP() {
  _tasaCppPorArticulo = {};
  try {
    const idsArt = inventarioCache.map(function(r){ return r.id_articulo; });
    if (!idsArt.length) return;
    // 1. Última fecha de Entrada por Artículo -- se trae todo ordenado por
    // fecha desc y se toma solo la primera vez que aparece cada Artículo
    // (PostgREST no tiene un "distinct on" directo por esta vía). Se
    // filtra por los Artículos ya cargados (inventarioCache, correctamente
    // scoped por empresa) en vez de id_empresa directo -- esa columna no
    // se usa en ningún otro lado sobre stock_entradas.
    const entradas = await api('stock_entradas','GET',null,
      '?id_articulo=in.('+idsArt.join(',')+')'
      +'&or=(anulada.eq.false,anulada.is.null)&order=fecha_entrada.desc&select=id_articulo,fecha_entrada') || [];
    const ultimaFechaPorArticulo = {};
    entradas.forEach(function(e) {
      if (ultimaFechaPorArticulo[e.id_articulo] === undefined) {
        ultimaFechaPorArticulo[e.id_articulo] = e.fecha_entrada;
      }
    });
    // 2. Histórico completo de tasas USD, ordenado ascendente -- se recorre
    // una sola vez para resolver todas las fechas necesarias.
    const tasas = await api('tasas','GET',null,
      '?moneda_origen=eq.USD&order=fecha_valor.asc&select=fecha_valor,tipo_cambio') || [];
    Object.keys(ultimaFechaPorArticulo).forEach(function(idArt) {
      const fecha = ultimaFechaPorArticulo[idArt];
      // La tasa vigente a esa fecha es la más reciente cuyo fecha_valor
      // sea <= la fecha de la Entrada.
      let tasaEncontrada = null;
      for (let i = tasas.length - 1; i >= 0; i--) {
        if (tasas[i].fecha_valor <= fecha) { tasaEncontrada = parseFloat(tasas[i].tipo_cambio); break; }
      }
      if (tasaEncontrada !== null) _tasaCppPorArticulo[idArt] = tasaEncontrada;
    });
  } catch(e) { console.warn('Error refrescando Tasas históricas del CPP:', e); }
}

// Margen Bruto % vigente HOY para cada Tipo de Artículo, en una sola
// consulta (no una por Artículo) -- se usa para calcular el Precio de
// Venta EN VIVO donde se muestra el estado actual del Inventario
// (Inventario General, Ficha del Artículo, Análisis ABC). El valor
// guardado en inventario_almacen.precio_venta_moneda es solo el histórico
// de la última Salida -- el real, si el CPP o el Margen cambiaron desde
// entonces (por una Entrada nueva, o una corrección de Margen), es este.
let _margenesVigentesMap = {};
async function refrescarMargenesVigentes() {
  _margenesVigentesMap = {};
  try {
    const hoy = new Date().toISOString().slice(0,10);
    const rows = await api('param_margen_bruto','GET',null,
      '?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)
      +'&estado=neq.ANULADO&fecha_vigencia_desde=lte.'+hoy
      +'&order=fecha_vigencia_desde.desc,id.desc&select=id_tipo_articulo,margen_pct') || [];
    rows.forEach(function(r) {
      // Ya viene ordenado desc -- la primera vez que aparece un Tipo es su
      // vigente más reciente; las siguientes filas de ese mismo Tipo se
      // ignoran (son vigencias más viejas, ya reemplazadas).
      if (_margenesVigentesMap[r.id_tipo_articulo] === undefined) {
        _margenesVigentesMap[r.id_tipo_articulo] = parseFloat(r.margen_pct);
      }
    });
  } catch(e) { console.warn('Error refrescando Márgenes vigentes:', e); }
}

// Precio de Venta EN VIVO: CPP actual ÷ (1 − Margen vigente del Tipo/100).
// Devuelve {bs, usd} -- 0/0 si el Tipo no tiene Margen definido (regla de
// negocio) o si el Artículo no tiene Tipo asignado.
function precioVentaEnVivo(r) {
  const cpp = parseFloat(r.precio_costo_moneda || 0);
  const margen = r.id_tipo_articulo !== null && r.id_tipo_articulo !== undefined
    ? _margenesVigentesMap[r.id_tipo_articulo]
    : undefined;
  if (margen === undefined || margen >= 100) return { bs: 0, usd: 0 };
  const usd = cpp / (1 - margen/100);
  return { bs: usd * (_tasaVigente || 0), usd: usd, margen: margen };
}

function invCalcularStockSeguridad() {
  const demandaAnual = parseFloat(document.getElementById('inv-demanda-anual')?.value) || 0;
  const leadTime     = parseFloat(document.getElementById('inv-lead-time')?.value) || 0;
  const segEl        = document.getElementById('inv-stock-seg');
  const minEl        = document.getElementById('inv-stock-min');
  if (!segEl) return;
  if (demandaAnual > 0 && leadTime > 0) {
    const demandaDiaria = demandaAnual / 365;
    const stockSeg = Math.ceil(demandaDiaria * leadTime * 0.5);
    segEl.value = stockSeg;
    // Precargar Stock Mínimo solo si está vacío
    if (minEl && !minEl.value) minEl.value = stockSeg;
  } else {
    segEl.value = '';
  }
}

function calcularEOQ(demandaAnual, costoPedido, costoMantenimiento) {
  if (!demandaAnual || !costoPedido || !costoMantenimiento) return null;
  return Math.sqrt((2 * demandaAnual * costoPedido) / costoMantenimiento);
}

function calcularPuntoReorden(r) {
  var lead = parseFloat(r.lead_time_dias || 7);
  var demanda = parseFloat(r.demanda_diaria || (r.demanda_anual ? r.demanda_anual / 365 : 0));
  var stockSeg = parseFloat(r.stock_seguridad || r.stock_minimo_articulo || 0);
  return Math.ceil(demanda * lead + stockSeg);
}

// El Costo (CPP) SIEMPRE está guardado en USD (convención fija del
// sistema). El Precio de Venta, en cambio, puede estar guardado en USD O
// en VES, según inventario_almacen.moneda_venta -- esta función normaliza
// ambos formatos a un par {bs, usd} siempre coherente, para no convertir
// dos veces (ni comparar VES contra USD) en ningún lugar que lo muestre.
function precioVentaDual(precioGuardado, monedaGuardada) {
  const p = parseFloat(precioGuardado || 0);
  if ((monedaGuardada || 'USD').toUpperCase() === 'VES') {
    return { bs: p, usd: _tasaVigente ? (p / _tasaVigente) : 0 };
  }
  return { bs: p * (_tasaVigente || 0), usd: p };
}

async function calcularInvSaldoArea() {
  try {
    // Consolidado (todas las áreas) — se calcula siempre, lo usan los
    // usuarios con VER_INVENTARIO_GENERAL y sirve de referencia general.
    const todasLasFilas = await api('inventario_stock_area','GET',null,'?select=id_articulo,id_area,stock_actual') || [];
    const consolidado = {};
    const areasConStock = new Set();
    todasLasFilas.forEach(function(f){
      consolidado[f.id_articulo] = (consolidado[f.id_articulo]||0) + parseFloat(f.stock_actual||0);
      if (parseFloat(f.stock_actual||0) > 0) areasConStock.add(String(f.id_area));
    });
    _invSaldoConsolidado = consolidado;
    _invAreasConStock = areasConStock;

    const tienePermisoGeneral = sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL');

    // Filtro manual por Área -- solo lo puede usar quien YA ve el
    // consolidado (VER_INVENTARIO_GENERAL). Le permite enfocarse en una
    // Área específica sin perder, por defecto, la vista general de siempre.
    const idAreaManual = tienePermisoGeneral ? _invFiltroAreaManual : null;

    if (tienePermisoGeneral && !idAreaManual) {
      _invSaldoArea = null; // Ven el consolidado (comportamiento de siempre)
      return;
    }

    let id_areaUsuario = idAreaManual;
    if (!id_areaUsuario) {
      // Camino original: usuario SIN el permiso -- se limita a su propia Área
      const correo = sesionActual?.correo_usuario;
      if (!correo) { _invSaldoArea = null; return; }
      const empRes = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(correo)+'&select=id_area&limit=1').catch(function(){ return []; });
      id_areaUsuario = empRes?.[0]?.id_area || null;
      if (!id_areaUsuario) { _invSaldoArea = {}; return; }
    }

    const filas = await api('inventario_stock_area','GET',null,'?id_area=eq.'+id_areaUsuario+'&select=id_articulo,stock_actual') || [];
    const saldo = {};
    filas.forEach(function(f){ saldo[f.id_articulo] = parseFloat(f.stock_actual||0); });
    _invSaldoArea = saldo;
  } catch(e) {
    console.warn('calcularInvSaldoArea error:', e);
    _invSaldoArea = null;
    _invSaldoConsolidado = null;
  }
}

function stockMostrarArticulo(id_articulo) {
  if (_invSaldoArea) return _invSaldoArea[id_articulo] || 0;
  if (_invSaldoConsolidado) return _invSaldoConsolidado[id_articulo] || 0;
  return 0;
}

async function renderInventario(filtro) {
  if (!sesionActual?.administrador && !modulosAcceso.includes('INVENTARIO')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  const panelYaExiste = !!document.getElementById('buscar-inv');
  if (!panelYaExiste) {
    c.innerHTML = '<div class="panel" id="panel-inventario" style="margin-top:-16px">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px;padding:14px 24px">'
      + '<h3 id="inv-contador" style="display:none"></h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<div style="display:flex;gap:3px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:3px">'
      + '<button id="inv-tab-tabla"   onclick="invCambiarVista(\'tabla\')"   class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:var(--naranja);color:#fff">Inventario</button>'
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-abc"     onclick="invCambiarVista(\'abc\')"     class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">Análisis ABC</button>' : '')
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-reorden" onclick="invCambiarVista(\'reorden\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">Reorden</button>' : '')
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-eoq"     onclick="invCambiarVista(\'eoq\')"     class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">EOQ</button>' : '')
      + (puedo('INVENTARIO','VER_MOVIMIENTOS') ? '<button id="inv-tab-movimientos" onclick="invCambiarVista(\'movimientos\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">📋 Movimientos</button>' : '')
      + (puedo('INVENTARIO','VER_CATEGORIAS') ? '<button id="inv-tab-categorias" onclick="invCambiarVista(\'categorias\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">📦 Categorías</button>' : '')
      + (puedo('INVENTARIO','VER_TIPOS') ? '<button id="inv-tab-tipos" onclick="invCambiarVista(\'tipos\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">🔩 Tipos</button>' : '')
      + (puedo('INVENTARIO','VER_MARGEN_BRUTO') ? '<button id="inv-tab-margen" onclick="invCambiarVista(\'margen\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">📊 Margen Bruto</button>' : '')
      + ((sesionActual?.administrador || puedo('PAGOS','APROBAR')) ? '<button id="inv-tab-aprobaciones" onclick="invCambiarVista(\'aprobaciones\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">✅ Aprobaciones Pendientes</button>' : '')
      + '</div>'
      + '<select id="inv-filtro-cat" onchange="invFiltrarCategoria()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todas las categorías</option>'
      + (_invCategoriasCache.map ? _invCategoriasCache.map(function(c){ return '<option value="'+c.id_categoria+'">'+c.nombre+'</option>'; }).join('') : '')
      + '</select>'
      // Filtro por Área -- visible SOLO para quien ya tiene VER_INVENTARIO_GENERAL
      // (o es Administrador). Sin este permiso, el usuario ya está limitado a su
      // propia Área automáticamente, así que este selector no le aporta nada.
      + ((sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) ?
          '<select id="inv-filtro-area" onchange="invFiltrarArea()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
          + '<option value="">Todas las Áreas (consolidado)</option>'
          + (_invAreasCache.map ? _invAreasCache.map(function(a){ return '<option value="'+a.id+'">'+a.nombre+(a.codigo?' ('+a.codigo+')':'')+'</option>'; }).join('') : '')
          + '</select>'
        : '')
      + '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--suave);cursor:pointer">'
      + '<input type="checkbox" id="inv-mostrar-todos" onchange="renderInventario(document.getElementById(\'buscar-inv\')?.value||\'\')">'
      + 'Solo con stock</label>'
      + '<input type="text" id="buscar-inv" placeholder="Buscar artículo o código..." '
      + 'onkeyup="renderInventario(this.value)" '
      + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();renderInventario(this.value)}else if(event.key===\'Escape\'){this.value=\'\';renderInventario(\'\');}" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;width:180px">'
      + (puedo('INVENTARIO','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoInventario()">+ Nuevo Artículo</button>' : '')
      + '</div></div>'
      + '<div id="alerta-stock-bajo" style="display:none"></div>'
      + '<div id="tabla-inv-cont"><div class="loading"><div class="spinner"></div> Cargando...</div></div>'
      + '</div>';
  }

  // Solo al ABRIR el módulo (no en cada re-render por búsqueda/filtro): si
  // el Usuario tiene acceso al stock global (VER_INVENTARIO_GENERAL o
  // Administrador), por defecto se le muestra SU PROPIA Área. Más abajo,
  // después de calcularInvSaldoArea(), se revisa si esa Área realmente
  // tiene stock -- si no, se cae al consolidado.
  if (!panelYaExiste && (sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL'))) {
    try {
      const correoPropio = sesionActual?.correo_usuario;
      if (correoPropio) {
        const empPropio = await api('empleados','GET',null,
          '?correo=eq.'+encodeURIComponent(correoPropio)+'&select=id_area&limit=1');
        _invFiltroAreaManual = empPropio?.[0]?.id_area || null;
      }
    } catch(e) {}
  }
  const tablaCont = document.getElementById('tabla-inv-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  // Si estamos en vista movimientos, no recargar la tabla
  if (_invVista === 'movimientos' || _invVista === 'categorias' || _invVista === 'tipos') return;

  try {
    // Por defecto muestra todos — el checkbox "Solo con stock" activa el filtro
    const soloConStock = document.getElementById('inv-mostrar-todos')?.checked || false;
    // Siempre limpiar cache para forzar recarga desde BD
    inventarioCache = [];
    // Cargar cache de categorías si está vacío (para filtro y tabla)
    if (!_invCategoriasCache || !_invCategoriasCache.length) {
      try {
        _invCategoriasCache = await api('inv_categorias','GET',null,
          '?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || [];
        // Actualizar opciones del filtro si ya existe
        const selCat = document.getElementById('inv-filtro-cat');
        if (selCat && _invCategoriasCache.length) {
          const optsExtra = _invCategoriasCache.map(function(c){
            return '<option value="'+c.id_categoria+'">'+c.nombre+'</option>';
          }).join('');
          if (!selCat.innerHTML.includes(optsExtra)) {
            selCat.innerHTML = '<option value="">Todas las categorías</option>' + optsExtra;
          }
        }
      } catch(e) {}
    }
    // Cargar cache de nombres de Área si está vacío -- solo aplica a quien
    // tiene el selector visible (VER_INVENTARIO_GENERAL o Administrador).
    // El llenado real del <select>, filtrado a las Áreas con stock, se
    // hace más abajo, después de calcularInvSaldoArea().
    if ((sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) && (!_invAreasCache || !_invAreasCache.length)) {
      try {
        _invAreasCache = await api('param_areas','GET',null,'?estado=eq.ACTIVO&order=codigo.asc,nombre.asc') || [];
      } catch(e) {}
    }
    const itemsTodos = await api('inventario_almacen', 'GET', null, '?order=nombre_articulo.asc&select=*' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || [];
    const items = itemsTodos; // se muestran Activos e Inactivos; se distinguen por la columna Estado
    inventarioCache = items;

    // Márgenes vigentes por Tipo -- para calcular el Precio de Venta EN
    // VIVO (el real, según CPP y Margen actuales), no el guardado (que es
    // solo el histórico de la última Salida). Se refresca siempre junto
    // con el inventario, igual que ya hace calcularInvSaldoArea().
    await refrescarMargenesVigentes();
    await refrescarTasasHistoricasCPP();

    // Cargar entregas pendientes de "Confirmar Recepción" -- mientras el
    // receptor no confirma, el stock no está ni en el área que lo entregó
    // ni en la que lo recibe (ver notifConfirmar en core.js). Se muestran
    // aquí para que no parezca que el Artículo desapareció.
    _invPendientesPorArticulo = {};
    try {
      const notifsPend = await api('notificaciones','GET',null,
        '?tipo=eq.RECEPCION_ARTICULO&estado=eq.PENDIENTE&select=datos_extra'
        + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
      if (notifsPend && notifsPend.length) {
        const idsAreaNecesarias = new Set();
        const pendientesParsed = notifsPend.map(function(n) {
          try {
            const extra = typeof n.datos_extra === 'string' ? JSON.parse(n.datos_extra) : n.datos_extra;
            if (extra && extra.id_articulo && extra.id_area_destino) {
              idsAreaNecesarias.add(extra.id_area_destino);
              return extra;
            }
          } catch(eParsePend) {}
          return null;
        }).filter(Boolean);
        if (pendientesParsed.length) {
          // Reutilizar _invAreasCache si ya está cargado (usuarios con
          // VER_INVENTARIO_GENERAL); si no, traer solo las Áreas necesarias.
          let mapaAreasNombres = {};
          if (_invAreasCache && _invAreasCache.length) {
            _invAreasCache.forEach(function(a){ mapaAreasNombres[a.id] = a; });
          }
          const idsFaltantes = Array.from(idsAreaNecesarias).filter(function(id){ return !mapaAreasNombres[id]; });
          if (idsFaltantes.length) {
            const areasExtra = await api('param_areas','GET',null,'?id=in.(' + idsFaltantes.join(',') + ')&select=id,nombre,codigo') || [];
            areasExtra.forEach(function(a){ mapaAreasNombres[a.id] = a; });
          }
          pendientesParsed.forEach(function(extra) {
            const areaInfo = mapaAreasNombres[extra.id_area_destino];
            if (!_invPendientesPorArticulo[extra.id_articulo]) _invPendientesPorArticulo[extra.id_articulo] = [];
            _invPendientesPorArticulo[extra.id_articulo].push({
              cantidad: extra.cantidad,
              nombreArea: areaInfo ? areaInfo.nombre : 'Área desconocida',
              codigoArea: areaInfo ? areaInfo.codigo : null
            });
          });
        }
      }
    } catch(ePend) { console.warn('Error cargando entregas pendientes de confirmar:', ePend); }

    // Calcular saldo por área (función centralizada) — ANTES de cualquier filtro de stock,
    // para que "Solo con stock" y el filtro por área usen la fuente correcta (inventario_stock_area)
    await calcularInvSaldoArea();

    // Si el Área actualmente filtrada (sea el default de apertura, o una
    // elegida manualmente antes) se quedó SIN stock -- por ejemplo, justo
    // se acaba de hacer una Salida que dejó todo en 0 -- se cae al
    // consolidado en vez de mostrar una lista vacía sin explicación. Se
    // reevalúa en CADA render (no solo al abrir el módulo), porque el
    // usuario puede volver a esta pantalla después de un movimiento de
    // stock sin haber cerrado el módulo. Se usa _invAreasConStock -- ya
    // calculado por calcularInvSaldoArea() y probado.
    if (_invFiltroAreaManual && !_invAreasConStock.has(String(_invFiltroAreaManual))) {
      _invFiltroAreaManual = null;
      await calcularInvSaldoArea();
    }

    // Llenar el select de Área -- solo con las Áreas que tienen al menos
    // un artículo con stock (_invAreasConStock, calculado arriba). Se hace
    // aquí y no antes porque depende del resultado de calcularInvSaldoArea().
    const selArea = document.getElementById('inv-filtro-area');
    if (selArea) {
      const areasConStockList = _invAreasCache.filter(function(a){ return _invAreasConStock.has(String(a.id)); });
      const optsExtraArea = areasConStockList.map(function(a){
        return '<option value="'+a.id+'">'+a.nombre+(a.codigo?' ('+a.codigo+')':'')+'</option>';
      }).join('');
      // Siempre se reconstruye -- antes había una comprobación
      // (".includes()") para evitar reconstruir si "parecía" no haber
      // cambiado, pero eso fallaba en silencio: si la lista nueva (correcta,
      // más corta) era un subconjunto de una lista vieja ya renderizada (con
      // áreas sin stock de antes), el chequeo se engañaba y el <select>
      // nunca se actualizaba, dejando áreas sin stock visibles.
      selArea.innerHTML = '<option value="">Todas las Áreas (consolidado)</option>' + optsExtraArea;
      selArea.value = _invFiltroAreaManual || '';
    }

    const itemsFiltradosBase = soloConStock ? items.filter(function(r) { return stockMostrarArticulo(r.id_articulo) > 0; }) : items;

    // ── Mostrar SOLO artículos que alguna vez tuvieron movimiento en el
    // Área del Usuario -- ver un artículo con el que nunca ha trabajado no
    // le aporta nada. IMPORTANTE: el criterio es "existe una fila para ese
    // artículo en inventario_stock_area" (upsertStockArea nunca borra la
    // fila, solo la actualiza -- ver core.js), NO "stock_actual > 0". Antes
    // exigía stock positivo, y si el Área llegaba a 0 en TODO, Inventario
    // General se quedaba completamente vacío -- incluso perdiendo el
    // acceso a su propio Historial de movimientos (solo se entra a través
    // de un artículo listado). Quien tiene VER_INVENTARIO_GENERAL y eligió
    // una Área específica desde el selector sigue viendo TODOS los
    // artículos del sistema, con 0 donde no tenga stock.
    const esPrivilegiadoInv = sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL');
    let itemsFiltradosBase2 = itemsFiltradosBase;
    if (_invSaldoArea && !esPrivilegiadoInv) {
      itemsFiltradosBase2 = itemsFiltradosBase.filter(function(r) {
        return Object.prototype.hasOwnProperty.call(_invSaldoArea, r.id_articulo);
      });
    }

    const catFiltro = document.getElementById('inv-filtro-cat') ? document.getElementById('inv-filtro-cat').value : '';
  var itemsFiltrados = catFiltro
    ? itemsFiltradosBase2.filter(function(r) { return String(r.id_categoria_articulo) === String(catFiltro); })
    : itemsFiltradosBase2;
  if (filtro && filtro.trim()) {
    const t = filtro.toLowerCase();
    itemsFiltrados = itemsFiltrados.filter(function(r) {
      return r.nombre_articulo.toLowerCase().includes(t) || (r.codigo_articulo || '').toLowerCase().includes(t) || (r.descripcion_articulo || '').toLowerCase().includes(t);
    });
  }
    const stockBajos = items.filter(function(r) { return parseFloat(r.stock_minimo_articulo||0) > 0 && stockMostrarArticulo(r.id_articulo) <= r.stock_minimo_articulo; }).length;
    const alertaDiv = document.getElementById('alerta-stock-bajo');
    if (alertaDiv) {
      if (stockBajos > 0) {
        alertaDiv.innerHTML = '<div class="alerta alerta-error" style="display:block;margin:0;border-radius:0">⚠ ' + stockBajos + ' artículo(s) con stock bajo o agotado. Revisar pestaña Reorden.</div>';
        alertaDiv.style.display = 'block';
      } else { alertaDiv.style.display = 'none'; }
    }
    const contador = document.getElementById('inv-contador');
    if (contador) contador.textContent = 'Inventario General (' + itemsFiltrados.length + ')';
    // No recargar si estamos en la vista de movimientos — es independiente del cache
    if (_invVista !== 'movimientos') {
      invRenderVista(itemsFiltrados, _invVista);
    }
  } catch(e) {
    const tabla = document.getElementById('tabla-inv-cont');
    if (tabla) tabla.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function invFiltrarCategoria() {
  var catId = document.getElementById('inv-filtro-cat').value;
  var items = catId
    ? inventarioCache.filter(function(r) { return String(r.id_categoria_articulo) === String(catId); })
    : inventarioCache;
  // Aplicar también filtro de búsqueda si existe
  var buscar = document.getElementById('buscar-inv');
  if (buscar && buscar.value.trim()) {
    var t = buscar.value.toLowerCase();
    items = items.filter(function(r) {
      return r.nombre_articulo.toLowerCase().includes(t) || (r.codigo_articulo || '').toLowerCase().includes(t);
    });
  }
  var contador = document.getElementById('inv-contador');
  if (contador) contador.textContent = 'Inventario General (' + items.length + ')';
  invRenderVista(items, _invVista);
}

// A diferencia de invFiltrarCategoria (que solo filtra la cache en el
// cliente), cambiar de Área requiere recalcular el saldo real desde
// inventario_stock_area en el servidor -- por eso se apoya en
// calcularInvSaldoArea() y se vuelve a renderizar todo el módulo.
async function invFiltrarArea() {
  const sel = document.getElementById('inv-filtro-area');
  _invFiltroAreaManual = sel && sel.value ? parseInt(sel.value) : null;
  await renderInventario(document.getElementById('buscar-inv')?.value || '');
}

async function invCambiarVista(vista) {
  _invVista = vista;
  document.querySelectorAll('.inv-tab').forEach(function(btn) {
    var activo = btn.id === 'inv-tab-' + vista;
    btn.style.background = activo ? 'var(--naranja)' : 'transparent';
    btn.style.color = activo ? '#fff' : 'var(--suave)';
  });
  // Ocultar "+ Nuevo Artículo" en vistas de administración
  const btnNuevo = document.querySelector('#panel-inventario .btn-primario[onclick="abrirNuevoInventario()"]');
  if (btnNuevo) {
    btnNuevo.style.display = (vista === 'categorias' || vista === 'tipos' || vista === 'margen' || vista === 'aprobaciones') ? 'none' : '';
  }
  const contTabla = document.getElementById('tabla-inv-cont');
  if (vista === 'movimientos') {
    await invRenderMovimientos(contTabla);
  } else {
    await invRenderVista(inventarioCache, vista);
  }
}

async function invRenderVista(items, vista) {
  const cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  if (vista === 'tabla') invRenderTabla(items, cont);
  else if (vista === 'abc') invRenderABC(items, cont);
  else if (vista === 'reorden') invRenderReorden(items, cont);
  else if (vista === 'eoq') invRenderEOQ(items, cont);
  else if (vista === 'movimientos') await invRenderMovimientos(cont);
  else if (vista === 'categorias') await invRenderCategorias(cont);
  else if (vista === 'tipos')      await invRenderTipos(cont);
  else if (vista === 'margen')     await invRenderMargenBruto(cont);
  else if (vista === 'aprobaciones') await invRenderAprobacionesPendientes(cont);
}

function invRenderTabla(items, cont) {
  const abcMap = {};
  clasificarABC(inventarioCache).forEach(function(r) { abcMap[r.id_articulo] = r.clase_abc; });
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const filas = items.map(function(r) {
    const stockMostrar = stockMostrarArticulo(r.id_articulo);
    const stockBajo = parseFloat(r.stock_minimo_articulo||0) > 0 && stockMostrar <= r.stock_minimo_articulo;
    const abc = abcMap[r.id_articulo] || '—';
    return '<tr>'
      + '<td style="padding:5px 8px;vertical-align:middle"><div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:10px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:2px 6px;border-radius:3px">' + abc + '</span>'
      + '<div><div style="font-family:var(--font-mono);font-size:10px;color:var(--suave);line-height:1.3">' + (r.codigo_articulo || '—')
      + (r.id_categoria_articulo ? ' · <span style="color:var(--suave)">' + (_invCategoriasCache.find(function(c){return c.id_categoria===r.id_categoria_articulo;})?.nombre || '') + '</span>' : '')
      + '</div>'
      + '<div style="font-weight:500;line-height:1.3">' + r.nombre_articulo + '</div>'
      + (r.descripcion_articulo ? '<div style="font-size:10px;color:var(--suave);line-height:1.3">' + r.descripcion_articulo + '</div>' : '') + '</div></div></td>'
      + (function() {
          const pendientesArt = _invPendientesPorArticulo[r.id_articulo] || [];
          const pendientesHtml = pendientesArt.map(function(p) {
            return '<div style="font-size:9px;color:var(--naranja);margin-top:2px;background:rgba(255,107,0,0.1);border-radius:3px;padding:1px 6px;display:inline-block">'
              + '📦 ' + p.cantidad + ' unid. — ' + p.nombreArea + (p.codigoArea ? ' (' + p.codigoArea + ')' : '') + ' — <strong>Por Confirmar</strong></div>';
          }).join('');
          return '<td style="padding:5px 8px;vertical-align:middle"><span class="badge ' + (stockBajo ? 'badge-rojo' : 'badge-verde') + '">' + stockMostrar + ' ' + (r.unidad || 'UND') + '</span>'
            + (_invSaldoArea ? '<div style="font-size:9px;color:var(--suave);margin-top:1px">Stock área</div>' : '')
            + (stockBajo ? '<div style="font-size:9px;color:#fc8181;margin-top:2px">⚠ Bajo mínimo (' + r.stock_minimo_articulo + ')</div>' : '')
            + pendientesHtml + '</td>';
        })()
      + (puedo('INVENTARIO','VER_COSTOS')
          ? (function() {
              // Tasa histórica (de la última Entrada de ESTE Artículo), no
              // la de hoy -- si nunca tuvo Entrada, se usa la de hoy como
              // respaldo (no hay otra referencia posible).
              const tasaCppFila = _tasaCppPorArticulo[r.id_articulo] || _tasaVigente;
              const cppBsFila = fmtBs((stockMostrar === 0 ? 0 : parseFloat(r.precio_costo_moneda||0)) * tasaCppFila);
              return '<td style="padding:5px 8px;vertical-align:middle;font-family:var(--font-mono);font-size:12px">'
                + '<div style="color:var(--suave);font-size:9px">COSTO PROM. (CPP)</div>'
                + '<span>' + cppBsFila + ' Bs</span>'
                + '<div style="font-size:9px;color:var(--suave);margin-top:1px">$ ' + fmtUSD(stockMostrar === 0 ? 0 : r.precio_costo_moneda) + ' (Bs ' + cppBsFila + ')</div>'
                + (r.precio_costo_ultimo_moneda
                    ? '<div style="font-size:9px;color:var(--suave);margin-top:1px">Última compra: $ ' + fmtUSD(r.precio_costo_ultimo_moneda) + '</div>'
                    : '')
                + '</td>';
            })()
          : '<td style="padding:5px 8px;vertical-align:middle;text-align:center;color:#555;font-size:11px">🔒</td>')
      + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
          ? (function() {
              const sinStock = stockMostrar === 0;
              const dualVenta = sinStock ? {bs:0,usd:0,margen:undefined} : precioVentaEnVivo(r);
              const margenTxt = dualVenta.margen !== undefined ? dualVenta.margen.toFixed(1) + '%' : 'sin definir';
              return '<td style="padding:5px 8px;vertical-align:middle;font-family:var(--font-mono);font-size:12px"><div style="color:var(--suave);font-size:9px">Venta</div>'
                + '<span style="color:var(--naranja)">' + fmtBs(dualVenta.bs) + ' Bs</span>'
                + '<div style="font-size:9px;color:var(--suave);margin-top:1px">$ ' + fmtUSD(dualVenta.usd) + '</div>'
                + '<div style="font-size:9px;color:var(--suave);margin-top:1px">Margen: ' + margenTxt + '</div></td>';
            })()
          : '<td style="padding:5px 8px;vertical-align:middle;text-align:center;color:#555;font-size:11px">🔒</td>')
      + '<td style="padding:5px 8px;vertical-align:middle"><span class="badge ' + (r.estado === 'INACTIVO' ? 'badge-rojo' : 'badge-verde') + '">' + (r.estado || 'ACTIVO') + '</span></td>'
      + '<td style="padding:5px 8px;vertical-align:middle"><div style="display:flex;gap:6px">'
      + '<button class="btn-naranja" onclick="verFichaInventario(' + r.id_articulo + ')">Ver</button>'
      + (puedo('INVENTARIO','ENTRADA_STOCK') ? '<button class="btn-secundario" style="border-color:rgba(255,107,0,0.4);color:var(--naranja)" onclick="abrirStockArticulo(' + r.id_articulo + ',\'' + r.nombre_articulo.replace(/'/g,"\\'"  ) + '\')" >Stock</button>' : '')
      + '</div></td></tr>';
  }).join('');
  const thStyleInv = 'background:var(--gris1);position:sticky;top:0;z-index:1';
  cont.innerHTML = '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 285px));overflow-y:auto"><table><thead><tr>'
    + '<th style="' + thStyleInv + '">Artículo</th><th style="' + thStyleInv + '">Stock</th><th style="' + thStyleInv + '">Precio Costo</th><th style="' + thStyleInv + '">Precio Venta</th><th style="' + thStyleInv + '">Estado</th><th style="' + thStyleInv + '">Acción</th>'
    + '</tr></thead><tbody>' + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">Sin artículos registrados</td></tr>') + '</tbody></table></div>';
}

function invRenderABC(items, cont) {
  const clasificados = clasificarABC(items);
  const totalValor = clasificados.reduce(function(s, r) { return s + r.valor_inventario; }, 0);
  const grupos = { A: [], B: [], C: [] };
  clasificados.forEach(function(r) { grupos[r.clase_abc].push(r); });
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const abcDesc = { A: 'Alta rotación y valor (80% del total)', B: 'Valor y rotación media (15%)', C: 'Bajo valor y rotación (5%)' };
  var filasHTML = '';
  ['A','B','C'].forEach(function(g) {
    const gs = grupos[g];
    const vg = gs.reduce(function(s, r) { return s + r.valor_inventario; }, 0);
    const pct = totalValor > 0 ? (vg / totalValor * 100).toFixed(1) : '0.0';
    filasHTML += '<tr style="background:' + abcColor[g] + '12"><td colspan="6" style="padding:6px 12px;font-size:10px;font-weight:700;letter-spacing:2px;color:' + abcColor[g] + '">CLASE ' + g + ' — ' + abcDesc[g] + ' (' + gs.length + ' items · ' + pct + '% del valor total)</td></tr>';
    gs.forEach(function(r) {
      filasHTML += '<tr>'
        + '<td><span style="font-size:10px;font-weight:700;color:' + abcColor[g] + ';background:' + abcColor[g] + '22;padding:2px 7px;border-radius:3px">' + g + '</span></td>'
        + '<td style="font-weight:500">' + r.nombre_articulo + '</td>'
        + '<td style="font-family:var(--font-mono);text-align:center">' + stockMostrarArticulo(r.id_articulo) + ' ' + (r.unidad||'UND') + '</td>'
        + '<td style="font-family:var(--font-mono)">$ ' + fmtUSD(precioVentaEnVivo(r).usd) + '</td>'
        + '<td style="font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(r.valor_inventario) + '</td>'
        + '<td style="font-size:11px;color:var(--suave)">' + pct + '%</td></tr>';
    });
  });
  cont.innerHTML = '<div style="display:flex;gap:12px;padding:12px;background:var(--gris2);border-radius:6px;margin-bottom:10px;font-size:11px;flex-wrap:wrap">'
    + '<div><span style="color:#22c55e;font-weight:700">● Clase A</span> — Supervisión diaria · Stock seguridad alto · Pedidos frecuentes</div>'
    + '<div><span style="color:#f59e0b;font-weight:700">● Clase B</span> — Revisión semanal · Reorden automático</div>'
    + '<div><span style="color:#94a3b8;font-weight:700">● Clase C</span> — Revisión mensual · Pedidos consolidados</div>'
    + '</div>'
    + '<div style="padding:8px 14px;background:rgba(255,107,0,0.08);border-left:3px solid var(--naranja);border-radius:4px;margin-bottom:10px;font-size:11px;color:var(--suave)">'
    + '<b style="color:var(--naranja)">FIFO / PEPS:</b> El stock existente (ingresado primero) se consume antes que el nuevo. Los items Clase A deben rotarse con mayor control. Registra la fecha de ingreso al editar cada artículo.</div>'
    + '<div class="tabla-container"><table><thead><tr><th>Clase</th><th>Artículo</th><th style="text-align:center">Stock</th><th>P. Venta</th><th>Valor Inventario</th><th>% Total</th></tr></thead><tbody>'
    + filasHTML + '</tbody></table></div>';
}

function invRenderReorden(items, cont) {
  const filas = items.map(function(r) {
    const stockMostrarReord = stockMostrarArticulo(r.id_articulo);
    const pr = calcularPuntoReorden(r);
    const critico = stockMostrarReord <= r.stock_minimo_articulo;
    const enReorden = !critico && stockMostrarReord <= pr;
    const demanda = r.demanda_diaria || (r.demanda_anual ? (r.demanda_anual/365).toFixed(2) : null);
    return '<tr>'
      + '<td><div style="font-weight:500">' + r.nombre_articulo + '</div><div style="font-size:10px;color:var(--suave)">' + (r.codigo_articulo||'') + '</div></td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + stockMostrarReord + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_minimo_articulo + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + (demanda !== null ? demanda : '<span style="color:var(--suave);font-size:10px">—</span>') + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + (r.lead_time_dias || 7) + ' días</td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-weight:700;color:' + (critico ? '#ef4444' : enReorden ? '#f59e0b' : '#22c55e') + '">' + pr + '</td>'
      + '<td style="text-align:center">'
      + (critico ? '<span style="font-size:10px;font-weight:700;color:#fff;background:#ef4444;padding:3px 8px;border-radius:4px">⚠ CRÍTICO</span>'
        : enReorden ? '<span style="font-size:10px;font-weight:700;color:#fff;background:#f59e0b;padding:3px 8px;border-radius:4px">Pedir ahora</span>'
        : '<span style="font-size:10px;color:#22c55e">✓ OK</span>')
      + '</td></tr>';
  }).join('');
  cont.innerHTML = '<div style="padding:8px 14px;background:rgba(255,107,0,0.08);border-left:3px solid var(--naranja);border-radius:4px;margin-bottom:10px;font-size:11px;color:var(--suave)">'
    + '<b style="color:var(--naranja)">Punto de Reorden = (Demanda Diaria × Lead Time) + Stock de Seguridad.</b> '
    + 'JIT: Pedir solo lo necesario al alcanzar el punto de reorden. Configura Demanda Anual y Lead Time en cada artículo.</div>'
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Artículo</th><th style="text-align:center">Stock</th><th style="text-align:center">Mínimo</th><th style="text-align:center">Dem./Día</th><th style="text-align:center">Lead Time</th><th style="text-align:center">Punto Reorden</th><th style="text-align:center">Estado</th>'
    + '</tr></thead><tbody>'
    + (filas || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">Sin artículos</td></tr>')
    + '</tbody></table></div>';
}

function invRenderEOQ(items, cont) {
  const filas = items.map(function(r) {
    var D = parseFloat(r.demanda_anual || 0);
    var S = parseFloat(r.costo_pedido_usd || 25);
    var H = parseFloat(r.precio_costo_moneda || 0) * 0.20;
    var eoq = (D && H) ? Math.round(calcularEOQ(D, S, H)) : null;
    var nPed = (eoq && D) ? Math.ceil(D / eoq) : null;
    var ciclo = (nPed && nPed > 0) ? Math.round(365 / nPed) : null;
    return '<tr>'
      + '<td><div style="font-weight:500">' + r.nombre_articulo + '</div></td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + (D || '<span style="color:var(--suave);font-size:10px">No configurado</span>') + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">$ ' + fmtUSD(S) + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">$ ' + fmtUSD(H) + '</td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-weight:700;color:var(--naranja)">' + (eoq !== null ? eoq + ' ' + (r.unidad||'UND') : '—') + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center;color:var(--suave)">' + (nPed !== null ? nPed + ' veces/año' : '—') + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center;color:var(--suave)">' + (ciclo !== null ? 'c/' + ciclo + ' días' : '—') + '</td></tr>';
  }).join('');
  cont.innerHTML = '<div style="padding:8px 14px;background:var(--gris2);border-radius:6px;margin-bottom:10px;font-size:11px;color:var(--suave)">'
    + '<b style="color:var(--naranja)">EOQ = √(2 × D × S / H)</b> donde D = demanda anual, S = costos operativos ($25 default), H = costo de mantenimiento (20% del precio costo). '
    + 'Configura <b>Demanda Anual</b> y <b>Costos Operativos</b> en la edición de cada artículo.</div>'
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Artículo</th><th style="text-align:center">Demanda Anual</th><th style="text-align:center">Costos Operativos</th><th style="text-align:center">Costo Mant.</th><th style="text-align:center">EOQ Óptimo</th><th style="text-align:center">Pedidos/Año</th><th style="text-align:center">Frecuencia</th>'
    + '</tr></thead><tbody>'
    + (filas || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">Sin artículos</td></tr>')
    + '</tbody></table></div>';
}

async function verFichaInventario(id) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER')) {
    alert('No tiene permiso para ver la ficha del artículo.'); return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  _fichaInvActual = { id: r.id_articulo, nombre: r.nombre_articulo };

  // Cerrar modales secundarios que puedan estar abiertos
  ['modal-entrada-stock','modal-salida-stock','modal-historial-stock',
   'modal-edit-movimiento','modal-stock-articulo'].forEach(function(m) {
    cerrarModal(m);
  });

  // ── GET fresco de BD para costos actualizados (el stock ya se lee de inventario_stock_area) ──
  try {
    var qs = '?id_articulo=eq.' + id + '&select=precio_costo_moneda,precio_costo_ultimo_moneda,precio_venta_moneda,moneda_venta';
    if (_empresaActiva && _empresaActiva.id_empresa) qs += '&id_empresa=eq.' + _empresaActiva.id_empresa;
    var fresh = await api('inventario_almacen', 'GET', null, qs);
    if (fresh && fresh[0]) {
      r.precio_costo_moneda        = parseFloat(fresh[0].precio_costo_moneda)        || 0;
      r.precio_costo_ultimo_moneda = parseFloat(fresh[0].precio_costo_ultimo_moneda) || 0;
      r.precio_venta_moneda        = parseFloat(fresh[0].precio_venta_moneda)        || 0;
      r.moneda_venta                = fresh[0].moneda_venta || 'USD';
    }
  } catch(e) { console.warn('verFichaInventario GET fresco:', e.message); }

  // Márgenes vigentes -- fresco también aquí, por si la Ficha se abre sin
  // haber pasado antes por la lista general recién cargada.
  await refrescarMargenesVigentes();
    await refrescarTasasHistoricasCPP();

  const abcMap = {};
  clasificarABC(inventarioCache).forEach(function(x) { abcMap[x.id_articulo] = x.clase_abc; });
  const abc = abcMap[r.id_articulo] || '—';
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const stockMostrarFicha = stockMostrarArticulo(r.id_articulo);
  const sinStockFicha = stockMostrarFicha === 0;
  const costoMostrarFicha = sinStockFicha ? 0 : parseFloat(r.precio_costo_moneda||0);
  const dualVentaFicha = sinStockFicha ? {bs:0,usd:0,margen:undefined} : precioVentaEnVivo(r);
  const margenTxt = dualVentaFicha.margen !== undefined ? dualVentaFicha.margen.toFixed(1) + '%' : 'sin definir';
  const stockBajo = stockMostrarFicha <= r.stock_minimo_articulo;

  document.getElementById('ficha-inv-contenido').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">'
    + '<span style="font-size:11px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:4px 10px;border-radius:4px">Clase ' + abc + '</span>'
    + '<div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + r.nombre_articulo + '</div>'
    + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (r.codigo_articulo || 'Sin código') + ' · ' + (r.unidad || 'UND') + '</div>'
    + '</div></div>'
    + (r.descripcion_articulo ? '<div style="background:var(--gris2);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--suave)">' + r.descripcion_articulo + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Actual</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px;color:' + (stockBajo ? '#fc8181' : 'var(--naranja)') + '">' + stockMostrarFicha + ' ' + (r.unidad||'UND') + '</div>'
    + (_invSaldoArea ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Stock en tu área</div>' : '')
    + (stockBajo ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo_articulo + ')</div>' : '') + '</div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Mínimo</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px">' + r.stock_minimo_articulo + ' ' + (r.unidad||'UND') + '</div></div>'
    + (puedo('INVENTARIO','VER_COSTOS') ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Costo Prom. (CPP)</div><div style="font-family:var(--font-mono)">' + fmtBs(costoMostrarFicha * (_tasaCppPorArticulo[r.id_articulo] || _tasaVigente)) + ' Bs</div><div style="font-size:11px;color:var(--suave);margin-top:2px;font-family:var(--font-mono)">$ ' + fmtUSD(costoMostrarFicha) + '</div></div>' : '')
    + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
        ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio Venta</div>'
          + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + fmtBs(dualVentaFicha.bs) + ' Bs</div>'
          + '<div style="font-size:11px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(dualVentaFicha.usd) + '</div>'
          + '<div style="font-size:10px;color:var(--suave);margin-top:2px">Margen: ' + margenTxt + '</div></div>'
        : '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio Venta</div>'
          + '<div style="font-size:13px;color:#555">🔒</div></div>')
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Categoría</div>'
    + '<div style="font-size:13px">' + (_invCategoriasCache.find(function(c){return c.id_categoria===r.id_categoria_articulo;})?.nombre || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Valor Inventario</div>'
    + '</div>'
    + '</div>'
    + '<div style="background:var(--gris2);border-radius:6px;padding:12px 14px;margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Cuenta Contable Inventario</div>'
    + '<div id="ficha-inv-cta-inventario" style="font-size:12px;font-family:var(--font-mono);color:var(--suave)">—</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Cuenta Costo / Gasto</div>'
    + '<div id="ficha-inv-cta-costo" style="font-size:12px;font-family:var(--font-mono);color:var(--suave)">—</div></div>'
    + '</div>'

  // Botones de acción en el footer
  var btnEditar = document.getElementById('ficha-inv-btn-editar');
  var btnEliminar = document.getElementById('ficha-inv-btn-eliminar');
  if (btnEditar)  { btnEditar._id = r.id_articulo;  btnEditar.onclick = function() { cerrarModal('modal-ficha-inv'); abrirEditarInventario(this._id); }; btnEditar.style.display = puedo('INVENTARIO','EDITAR') ? '' : 'none'; }
  if (btnEliminar) {
    btnEliminar._id = r.id_articulo; btnEliminar._nombre = r.nombre_articulo;
    btnEliminar.onclick = function() { cerrarModal('modal-ficha-inv'); eliminarInventario(this._id, this._nombre); };
    btnEliminar.style.display = 'none'; // oculto por defecto, se muestra solo si no tiene entradas
    const msgElReset = document.getElementById('ficha-inv-msg-eliminar');
    if (msgElReset) msgElReset.style.display = 'none'; // resetear por si quedó visible de otro artículo
    if (puedo('INVENTARIO','ELIMINAR')) {
      api('stock_entradas','GET',null,'?id_articulo=eq.'+r.id_articulo+'&select=id_entrada&limit=1').then(function(ents) {
        if (!ents || !ents.length) {
          btnEliminar.style.display = '';
          btnEliminar.title = '';
          if (msgElReset) msgElReset.style.display = 'none';
        } else {
          // Mostrar mensaje explicativo debajo del historial
          if (msgElReset) {
            msgElReset.textContent = r.estado === 'INACTIVO'
              ? '⚠ Para revertir la condición de Inactivo, márquelo como Activo desde Editar.'
              : '⚠ Para dar de baja a este Artículo, márquelo como Inactivo desde Editar.';
            msgElReset.style.display = 'block';
          }
        }
      });
    }
  }

  abrirModal('modal-ficha-inv');
  focusFirstField('modal-ficha-inv');

  // Cargar nombres de cuentas contables (vía RPC, no lectura directa de la tabla)
  var _idsC = [r.id_cuenta_contable, r.id_cuenta_costo_gasto].filter(Boolean);
  if (_idsC.length) {
    obtenerCuentasContables().then(function(ctas) {
      var ctaInv = ctas ? ctas.find(function(c){ return c.id_cuenta === r.id_cuenta_contable; }) : null;
      var ctaCG  = ctas ? ctas.find(function(c){ return c.id_cuenta === r.id_cuenta_costo_gasto; }) : null;
      var elInv  = document.getElementById('ficha-inv-cta-inventario');
      var elCG   = document.getElementById('ficha-inv-cta-costo');
      if (elInv) elInv.textContent = ctaInv ? ctaInv.codigo + ' — ' + ctaInv.nombre : '—';
      if (elCG)  elCG.textContent  = ctaCG  ? ctaCG.codigo  + ' — ' + ctaCG.nombre  : '—';
    });
  }

  // Historial de movimientos: se abre en el modal dedicado (con pestañas
  // Todas/Entradas/Salidas y paginación) en vez de cargar aquí dos listas
  // sin límite — evita duplicar lógica y hereda los fixes ya hechos ahí.
  const contHist = document.getElementById('ficha-inv-historial');
  if (contHist) {
    contHist.innerHTML = '<div style="padding:12px 0"><button class="btn-secundario" style="width:100%;padding:10px;font-size:12px" onclick="cerrarModal(\'modal-ficha-inv\');verHistorialStock(' + r.id_articulo + ',\'' + (r.nombre_articulo||'').replace(/'/g,"\\'") + '\')">📋 Ver Historial de Movimientos</button></div>';
  }
}

async function abrirEntradaStock(id) {
  await cargarTasaIVAGlobal(); // refresca IVA vigente cada vez que se abre el formulario
  let r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r && _fichaInvActual && _fichaInvActual.id === id) {
    r = _fichaInvActual;
    r.id_articulo = id;
  }
  if (!r) { alert('Error: artículo no encontrado. Intente recargar el inventario.'); return; }

  // GET fresco de BD (el stock ya se lee de inventario_stock_area más abajo)
  try {
    var qs = '?id_articulo=eq.' + id + '&select=precio_costo_moneda,precio_venta_moneda,unidad,estado';
    if (_empresaActiva && _empresaActiva.id_empresa) qs += '&id_empresa=eq.' + _empresaActiva.id_empresa;
    const fresh = await api('inventario_almacen', 'GET', null, qs);
    if (fresh && fresh[0]) {
      if (fresh[0].precio_costo_moneda   != null) r.precio_costo_moneda   = parseFloat(fresh[0].precio_costo_moneda);
      if (fresh[0].precio_venta_moneda   != null) r.precio_venta_moneda   = parseFloat(fresh[0].precio_venta_moneda);
      r.estado = fresh[0].estado;
    }
  } catch(e) { console.warn('abrirEntradaStock GET fresco:', e.message); }

  // Bloquear si el artículo está Inactivo -- se pausó por decisión de
  // negocio (ej. precio disparado) y no debe recibir movimientos nuevos
  // hasta que se reactive desde Editar.
  if (r.estado === 'INACTIVO') {
    alert('Este artículo está Inactivo. Reactívelo desde Editar antes de registrar una Entrada.');
    return;
  }

  document.getElementById('es-id').value = id;
  document.getElementById('es-nombre').textContent = r.nombre_articulo;
  await calcularInvSaldoArea();
  document.getElementById('es-stock-actual').textContent = stockMostrarArticulo(id) + ' ' + (r.unidad || 'UND');
  const esLblUnidad = document.getElementById('es-label-unidad');
  if (esLblUnidad) esLblUnidad.textContent = r.unidad || 'UND';
  document.getElementById('es-cantidad').value = '';
  var selMoneda = document.getElementById('es-moneda-compra');
  if (selMoneda) selMoneda.selectedIndex = 0;
  document.getElementById('es-precio-costo').value = '';
  var selMotivo = document.getElementById('es-motivo');
  if (selMotivo) selMotivo.selectedIndex = 0;
  var selPago = document.getElementById('es-esquema-pago');
  if (selPago) selPago.selectedIndex = 0;
  if (document.getElementById('es-fecha-negociacion')) document.getElementById('es-fecha-negociacion').value = getHoyVzla();
  if (document.getElementById('es-fecha-pago')) document.getElementById('es-fecha-pago').value = '';
  if (document.getElementById('es-fecha-pago-cont')) document.getElementById('es-fecha-pago-cont').style.display = 'none';
  const refCPP = document.getElementById('es-ref-cpp');
  if (refCPP) refCPP.textContent = '$ ' + fmtUSD(r.precio_costo_moneda) + ' (CPP actual)';
  document.getElementById('alerta-es-ok').style.display = 'none';
  document.getElementById('alerta-es-err').style.display = 'none';
  if (document.getElementById('es-clave-receptor'))  document.getElementById('es-clave-receptor').value = '';
  if (document.getElementById('es-factura-devolucion')) { document.getElementById('es-factura-devolucion').value = ''; document.getElementById('es-factura-devolucion-info').style.display = 'none'; }
  if (document.getElementById('es-area-origen'))    document.getElementById('es-area-origen').value = '';
  if (document.getElementById('es-moneda-compra'))  { var sm = document.getElementById('es-moneda-compra'); sm.selectedIndex = 0; }
  if (document.getElementById('es-tributos-cont'))  document.getElementById('es-tributos-cont').style.display = 'none';
  document.querySelectorAll('input[name="es-entrada-incluye-iva"]').forEach(function(r){ r.checked = false; });
  document.querySelectorAll('input[name="es-exento-iva"]').forEach(function(r){ r.checked = false; });
  const exentoVal = document.getElementById('es-exento-iva-val');
  if (exentoVal) exentoVal.value = '';
  const ivaVal = document.getElementById('es-incluye-iva-val');
  if (ivaVal) ivaVal.value = '';
  const incluyeIVACont = document.getElementById('es-incluye-iva-cont');
  if (incluyeIVACont) incluyeIVACont.style.display = 'none';
  if (document.getElementById('es-tributos-preview')) document.getElementById('es-tributos-preview').style.display = 'none';
  if (document.getElementById('es-precio-usd-cont'))document.getElementById('es-precio-usd-cont').style.display = 'none';
  if (document.getElementById('es-tasa-bcv'))       document.getElementById('es-tasa-bcv').value = '';
  if (document.getElementById('es-precio-usd-calc'))document.getElementById('es-precio-usd-calc').value = '';
  if (document.getElementById('es-monto-total'))    document.getElementById('es-monto-total').value = '0,00';
  const lblMontoTotalReset = document.getElementById('es-label-monto-total');
  if (lblMontoTotalReset) lblMontoTotalReset.textContent = 'Monto en USD';
  const esquemaEl = document.getElementById('es-esquema-pago');
  if (esquemaEl) esquemaEl.selectedIndex = 0;
  const creditoCont = document.getElementById('es-credito-cont');
  if (creditoCont) creditoCont.style.display = 'none';
  const prevEl = document.getElementById('es-cuotas-preview');
  if (prevEl) { prevEl.innerHTML = ''; delete prevEl.dataset.cuotas; }
  const montoCuotaEl = document.getElementById('es-cuotas-monto');
  if (montoCuotaEl) montoCuotaEl.value = '';
  const numCuotasEl = document.getElementById('es-cuotas-num');
  if (numCuotasEl) numCuotasEl.value = '';
  const fechaCuotaEl = document.getElementById('es-cuotas-fecha-inicio');
  if (fechaCuotaEl) fechaCuotaEl.value = '';
  // Setear área y empleado desde el usuario logueado (hidden fields)
  await cargarUsuarioReceptorEntrada();
  document.getElementById('es-proveedor').innerHTML = '<option value="">— Seleccionar proveedor (opcional) —</option>';
  Promise.all([
    api('proveedores', 'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif,id_categoria,param_categorias_proveedor:id_categoria(nombre)'),
    api('param_categorias_proveedor','GET',null,'?nombre=ilike.*Artículo*&select=id&limit=1'),
    api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
    api('os_mercancias', 'GET', null, '?id_articulo=eq.'+id+'&select=id_orden,cantidad,subtotal_usd'),
  ]).then(async function(res) {
    var provs = res[0], areas = res[2], repsArt = res[3] || [];
    var catArticulo = res[1] && res[1][0] ? res[1][0].id : null;
    if (catArticulo) provs = provs.filter(function(p){ return p.id_categoria === catArticulo; });
    var selProv = document.getElementById('es-proveedor');
    selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
      + provs.map(function(p) { return '<option value="' + p.id_proveedor + '">' + p.nombre + (p.rif ? ' (' + p.rif + ')' : '') + '</option>'; }).join('');
    var selOrigen = document.getElementById('es-area-origen');
    if (selOrigen) {
      // Excluir el Área receptora (siempre Compras en Entrada de Stock) de
      // las opciones de Origen -- no tiene sentido una Transferencia de un
      // Área hacia sí misma.
      var idAreaReceptoraForm = await obtenerIdAreaCompras();
      var areasOrigenDisp = idAreaReceptoraForm
        ? areas.filter(function(a){ return String(a.id) !== String(idAreaReceptoraForm); })
        : areas;
      selOrigen.innerHTML = '<option value="">— Seleccionar área de origen —</option>'
        + areasOrigenDisp.map(function(a) { return '<option value="' + a.id + '">' + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>'; }).join('');
    }
    // Cargar facturas elegibles para Devolución (solo las que facturaron ESTE artículo)
    var selFact = document.getElementById('es-factura-devolucion');
    if (selFact && repsArt.length) {
      var idsOrden = repsArt.map(function(r){ return r.id_orden; }).filter(function(v,i,a){ return v && a.indexOf(v)===i; });
      if (idsOrden.length) {
        api('facturas','GET',null,'?id_orden=in.('+idsOrden.join(',')+')&estado=eq.EMITIDA&select=id_factura,numero_factura,id_orden,receptor_nombre,subtotal_usd,iva_usd,igtf_usd,total_usd,tasa_bcv,aplica_iva,aplica_igtf').then(function(facs) {
          window._facturasDevolucionArt = (facs||[]).map(function(f) {
            var lineaOS = repsArt.find(function(r){ return r.id_orden === f.id_orden; });
            return Object.assign({}, f, { cantidad_facturada: lineaOS ? parseFloat(lineaOS.cantidad) : 0, subtotal_usd_linea: lineaOS ? parseFloat(lineaOS.subtotal_usd) : 0 });
          });
          selFact.innerHTML = '<option value="">— Seleccionar factura —</option>'
            + window._facturasDevolucionArt.map(function(f) { return '<option value="'+f.id_factura+'">'+f.numero_factura+' — '+(f.receptor_nombre||'')+' ('+f.cantidad_facturada+' unid.)</option>'; }).join('');
        }).catch(function(){});
      } else {
        selFact.innerHTML = '<option value="">— Este artículo no tiene facturas emitidas —</option>';
      }
    } else if (selFact) {
      selFact.innerHTML = '<option value="">— Este artículo no tiene facturas emitidas —</option>';
    }
    onCambiarMotivoEntrada();
    if (typeof buscarTasaBCVNegociacion === 'function') buscarTasaBCVNegociacion();
  }).catch(function(){});
  abrirModal('modal-entrada-stock');
  focusFirstField('modal-entrada-stock');
  setTimeout(function() { document.getElementById('es-cantidad').focus(); }, 100);
}

function onCambioEsquemaPago() {
  const esquema = document.getElementById('es-esquema-pago')?.value;
  const cont    = document.getElementById('es-credito-cont');
  if (cont) cont.style.display = esquema === 'CREDITO' ? '' : 'none';
  const fechaPagoCont = document.getElementById('es-fecha-pago-cont');
  if (fechaPagoCont) fechaPagoCont.style.display = esquema === 'CONTADO' ? '' : 'none';
  if (esquema === 'CREDITO') calcularCuotasEntrada();
}

function calcularCuotasEntrada() {
  const numCuotas  = parseInt(document.getElementById('es-cuotas-num')?.value) || 0;
  const fechaInicio = document.getElementById('es-cuotas-fecha-inicio')?.value || '';
  const intervalo  = parseInt(document.getElementById('es-cuotas-intervalo')?.value) || 30;
  const precioRawCuotas   = parseMontoVE(document.getElementById('es-precio-costo')?.value);
  const monedaCuotas      = document.getElementById('es-moneda-compra')?.value || 'USD';
  const tasaBCVCuotasVal  = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
  // El precio se ingresa en la Moneda Negociación (puede ser VES) -- convertir
  // siempre a USD antes de calcular, igual que se hace al guardar
  // (guardarEntradaStock/nuevoPrecioCostoRaw), para que ambos cálculos coincidan
  const montoTotal = monedaCuotas === 'VES'
    ? (tasaBCVCuotasVal > 0 ? parseFloat((precioRawCuotas / tasaBCVCuotasVal).toFixed(4)) : parseMontoVE(document.getElementById('es-precio-usd-calc')?.value))
    : (precioRawCuotas || parseMontoVE(document.getElementById('es-precio-usd-calc')?.value));
  const cantidad   = parseFloat(document.getElementById('es-cantidad')?.value) || 0;
  // montoTotal es el precio NEGOCIADO (puede traer IVA incluido o no) —
  // reconstruir el TOTAL con IVA correctamente antes de repartir en cuotas
  const exentoCuotasEnt  = document.getElementById('es-exento-iva-val')?.value === 'SI';
  const incluyeCuotasEnt = document.getElementById('es-incluye-iva-val')?.value === 'SI';
  const montoBaseEnt = montoTotal * cantidad;
  const totalUSD   = parseFloat((exentoCuotasEnt || incluyeCuotasEnt ? montoBaseEnt : montoBaseEnt * (1+tasaIVAActual())).toFixed(2));
  const preview    = document.getElementById('es-cuotas-preview');
  if (!preview) return;

  if (!numCuotas || !fechaInicio) {
    preview.innerHTML = '';
    return;
  }

  // Validar que monto por cuota no exceda el total
  const montoCuotaInput = parseFloat(document.getElementById('es-cuotas-monto')?.value) || 0;
  const montoMaxCuota = parseFloat((totalUSD / numCuotas).toFixed(2));
  const montoCuotaFinal = montoCuotaInput > 0 ? montoCuotaInput : montoMaxCuota;

  // Auto-llenar monto si está vacío
  const montoEl = document.getElementById('es-cuotas-monto');
  if (montoEl && !montoEl.value && totalUSD > 0) montoEl.value = montoMaxCuota;

  // Validar que las cuotas no excedan el total
  const totalCuotas = parseFloat((montoCuotaFinal * numCuotas).toFixed(2));
  if (totalCuotas > totalUSD + 0.01) {
    preview.innerHTML = '<div style="color:#fc8181;font-size:12px">⚠ El monto por cuota ($ '+fmtUSD(montoCuotaFinal)+' × '+numCuotas+' = $ '+fmtUSD(totalCuotas)+') excede el total ($ '+fmtUSD(totalUSD)+'). Reduzca el monto por cuota.</div>';
    return;
  }

  // Generar tabla de cuotas
  // Ajusta fecha al lunes siguiente si cae en fin de semana
  function ajustarHabilLunes(d) {
    var dia = d.getDay(); // 0=domingo, 6=sábado
    if (dia === 6) d.setDate(d.getDate() + 2); // sábado → lunes
    if (dia === 0) d.setDate(d.getDate() + 1); // domingo → lunes
    return d;
  }

  const cuotas = [];
  let fecha = ajustarHabilLunes(new Date(fechaInicio + 'T00:00:00'));
  for (let i = 0; i < numCuotas; i++) {
    if (i > 0) {
      fecha = ajustarHabilLunes(new Date(new Date(cuotas[i-1].fecha + 'T00:00:00').setDate(
        new Date(cuotas[i-1].fecha + 'T00:00:00').getDate() + intervalo
      )));
    }
    cuotas.push({
      num:   i + 1,
      fecha: fecha.toISOString().split('T')[0],
      monto: i === numCuotas - 1
        ? parseFloat((totalUSD - montoCuotaFinal * (numCuotas - 1)).toFixed(2))
        : montoCuotaFinal
    });
  }

  const total = cuotas.reduce(function(s,c){ return s + c.monto; }, 0);
  const diff  = parseFloat((totalUSD - total).toFixed(2));

  preview.innerHTML =
    '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">Vista previa de cuotas — Total: $ '+fmtUSD(total)
    +(diff !== 0 ? ' <span style="color:#fc8181">(diferencia: $ '+fmtUSD(Math.abs(diff))+')</span>' : ' <span style="color:#22c55e">✓</span>')+'</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Cuota</th>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Fecha Vencimiento</th>'
    +'<th style="padding:6px 8px;text-align:right;color:var(--suave);font-size:10px">Monto USD</th>'
    +'</tr></thead><tbody>'
    + cuotas.map(function(c) {
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:6px 8px;font-weight:600">Cuota '+c.num+'</td>'
          +'<td style="padding:6px 8px;font-family:var(--font-mono)">'+fmtFecha(c.fecha)+'</td>'
          +'<td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);color:var(--naranja)">$ '+fmtUSD(c.monto)+'</td>'
          +'</tr>';
      }).join('')
    +'</tbody></table></div>';

  // Guardar cuotas en dataset para usarlas al guardar
  preview.dataset.cuotas = JSON.stringify(cuotas);
}

async function guardarEntradaStock() {
  // Protección doble ejecución
  if (window._guardandoEntrada) return;
  window._guardandoEntrada = true;
  const btnGuardar = document.querySelector('#modal-entrada-stock .btn-primario');
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...'; }

  if (!puedo('INVENTARIO','ENTRADA_STOCK')) {
    alert('No tiene permiso para ingresar stock.');
    window._guardandoEntrada = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'INGRESAR STOCK'; }
    return;
  }
  const id       = parseInt(document.getElementById('es-id').value);
  const cantidad = parseFloat(document.getElementById('es-cantidad').value) || 0;
  const okEl     = document.getElementById('alerta-es-ok');
  const errEl    = document.getElementById('alerta-es-err');
  okEl.style.display = 'none';
  errEl.style.display = 'none';

  const resetBtn = function() {
    window._guardandoEntrada = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'INGRESAR STOCK'; }
  };

  const mostrarError = function(msg, focusId) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
    resetBtn();
  };

  // ── Validaciones en orden de aparición en pantalla ──
  const motivoSel = document.getElementById('es-motivo')?.value;
  if (!motivoSel)                   return mostrarError('Seleccione la Transacción.', 'es-motivo');
  const fechaNeg  = document.getElementById('es-fecha-negociacion')?.value;
  const hoy       = getHoyVzla();
  if (!fechaNeg)                    return mostrarError('Seleccione la Fecha.', 'es-fecha-negociacion');
  if (fechaNeg > hoy)               return mostrarError('La Fecha no puede ser mayor al día de hoy.', 'es-fecha-negociacion');
  if (cantidad <= 0)                return mostrarError('Ingrese una cantidad mayor a 0.', 'es-cantidad');

  // Moneda / Precio Negociación / Modalidad de Pago — SOLO para Compra.
  // Devolución, Ajuste y Transferencia usan el CPP actual del artículo tal
  // cual está, sin promediar un precio inventado solo para pasar el formulario.
  let monedaSel = null, precioVal = 0;
  if (motivoSel === 'compra') {
    monedaSel = document.getElementById('es-moneda-compra')?.value;
    if (!monedaSel)                 return mostrarError('Seleccione la Moneda Negociación.', 'es-moneda-compra');
    precioVal = parseMontoVE(document.getElementById('es-precio-costo')?.value);
    if (precioVal <= 0)             return mostrarError('Ingrese el Precio Negociación.', 'es-precio-costo');
  }
  // Precio Venta — opcional, no se valida
  // Proveedor, Factura o Área origen — obligatorio según motivo
  if (motivoSel === 'compra') {
    const provSel = document.getElementById('es-proveedor')?.value;
    if (!provSel) return mostrarError('Seleccione el Proveedor.', 'es-proveedor');
    // Exento IVA obligatorio
    const exentoSel = document.querySelector('input[name="es-exento-iva"]:checked');
    if (!exentoSel) return mostrarError('Debe indicar si el Gasto está Exento de IVA.', 'es-exento-iva-si');
    // Si NO exento, IVA obligatorio
    if (exentoSel.value === 'NO') {
      const ivaSeleccionado = document.getElementById('es-incluye-iva-val')?.value ? {value: document.getElementById('es-incluye-iva-val').value} : null;
      if (!ivaSeleccionado) return mostrarError('Debe indicar si el monto facturado incluye IVA.', 'es-incluye-iva-si');
    }
  } else if (motivoSel === 'transferencia') {
    const areaOrig = document.getElementById('es-area-origen')?.value;
    if (!areaOrig)                  return mostrarError('Seleccione el Área de Origen.', 'es-area-origen');
  } else if (motivoSel === 'devolucion') {
    const facturaSel = document.getElementById('es-factura-devolucion')?.value;
    if (!facturaSel)                return mostrarError('Seleccione la Factura a la que corresponde esta devolución.', 'es-factura-devolucion');
  }
  let pagoDSel = null;
  if (motivoSel === 'compra') {
    pagoDSel = document.getElementById('es-esquema-pago')?.value;
    if (!pagoDSel) return mostrarError('Seleccione la Modalidad de Pago.', 'es-esquema-pago');
    if (pagoDSel === 'CONTADO') {
      const fechaPagoVal = document.getElementById('es-fecha-pago')?.value || '';
      if (!fechaPagoVal) return mostrarError('Ingrese la Fecha de Pago.', 'es-fecha-pago');
    }
    if (pagoDSel === 'CREDITO') {
      const numCuotasVal  = parseInt(document.getElementById('es-cuotas-num')?.value) || 0;
      const fechaCuotaVal = document.getElementById('es-cuotas-fecha-inicio')?.value || '';
      if (!numCuotasVal || numCuotasVal < 1) return mostrarError('Ingrese el número de cuotas.', 'es-cuotas-num');
      if (!fechaCuotaVal) return mostrarError('Ingrese la Fecha de la Primera Cuota.', 'es-cuotas-fecha-inicio');
      if (fechaCuotaVal <= getHoyVzla()) return mostrarError('La Fecha de la Primera Cuota tiene que ser mayor que el día de hoy.', 'es-cuotas-fecha-inicio');
    }
  }
  // Observaciones — opcional, no se valida

  try {
    const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
    let nuevoPrecioCosto = 0;
    let nuevoPrecioCostoRaw = 0;
    let moneda_compra_val = 'USD';
    let precio_compra_original = null;
    let tasa_bcv_usada = _tasaVigente || null;
    let incluyeIVA_ent = false;
    const IVA_RATE_ENT = tasaIVAActual();

    if (motivoSel === 'compra') {
      const precioIngresado  = parseMontoVE(document.getElementById('es-precio-costo').value);
      const monedaCompra     = document.getElementById('es-moneda-compra')?.value || 'USD';
      const tasaBCVVal       = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
      incluyeIVA_ent = document.getElementById('es-incluye-iva-val')?.value === 'SI' || false;
      nuevoPrecioCostoRaw = monedaCompra === 'VES'
        ? (tasaBCVVal > 0 ? parseFloat((precioIngresado / tasaBCVVal).toFixed(4)) : parseMontoVE(document.getElementById('es-precio-usd-calc')?.value))
        : precioIngresado;
      // Si incluye IVA — precio costo = base sin IVA
      nuevoPrecioCosto = incluyeIVA_ent
        ? parseFloat((nuevoPrecioCostoRaw / (1 + IVA_RATE_ENT)).toFixed(4))
        : nuevoPrecioCostoRaw;
      if (monedaCompra === 'VES' && precioIngresado > 0 && nuevoPrecioCosto <= 0) {
        errEl.textContent = 'No se encontró tasa BCV para convertir el precio.';
        errEl.style.display = 'block';
        document.getElementById('es-precio-costo')?.focus();
        resetBtn(); return;
      }
      moneda_compra_val      = monedaCompra;
      precio_compra_original = precioIngresado;
      tasa_bcv_usada         = tasaBCVVal > 0 ? tasaBCVVal : null;
      // Si no hay tasa, buscarla de la fecha de negociación
      if (!tasa_bcv_usada) {
        const fechaNegBusq = document.getElementById('es-fecha-negociacion')?.value || getHoyVzla();
        try {
          const tasaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaNegBusq+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
          if (tasaRows && tasaRows[0]) tasa_bcv_usada = parseFloat(tasaRows[0].tipo_cambio);
        } catch(e) {}
      }
      // Último recurso: la tasa vigente en caché
      if (!tasa_bcv_usada) tasa_bcv_usada = _tasaVigente || null;
      // Si aun así no hay tasa válida, DETENER -- de lo contrario el monto_ves
      // de la CxP y del asiento contable caerían a "monto_usd * 1" más abajo
      // (un caso real: $30 USD se registró como Bs 30 exactos, tratando el
      // dólar 1:1 con el bolívar por falta de una tasa BCV registrada).
      if (!tasa_bcv_usada || tasa_bcv_usada <= 1) {
        errEl.textContent = 'No se encontró una Tasa BCV válida para la Fecha de Negociación. Registre la tasa del día en Parámetros → Tasas de Cambio antes de continuar (o ingrésela manualmente en el campo Tasa BCV de este formulario).';
        errEl.style.display = 'block';
        document.getElementById('es-tasa-bcv')?.focus();
        resetBtn(); return;
      }
    } else {
      // Devolución / Ajuste / Transferencia: sin negociación — usar la tasa
      // vigente solo como referencia para mostrar montos en Bs, sin exigirla.
      if (!tasa_bcv_usada || tasa_bcv_usada <= 1) tasa_bcv_usada = 1;
    }
    const nuevoPrecioVenta       = null; // precio venta se gestiona desde SALIDA

    // ── FASE 1: Todas las validaciones ANTES de tocar BD ──
    const motivoEnt = motivoSel;
    if (motivoEnt === 'compra') {
      const idProvVal = document.getElementById('es-proveedor')?.value;
      if (!idProvVal) { errEl.textContent = 'Debe seleccionar el proveedor.'; errEl.style.display = 'block'; document.getElementById('es-proveedor')?.focus(); resetBtn(); return; }
    } else if (motivoEnt === 'devolucion') {
      const facturaDevVal = document.getElementById('es-factura-devolucion')?.value;
      if (!facturaDevVal) { errEl.textContent = 'Debe seleccionar la Factura a la que corresponde esta devolución.'; errEl.style.display = 'block'; document.getElementById('es-factura-devolucion')?.focus(); resetBtn(); return; }
      const facSel = (window._facturasDevolucionArt || []).find(function(f){ return String(f.id_factura) === String(facturaDevVal); });
      if (facSel && cantidad > facSel.cantidad_facturada) {
        errEl.textContent = 'La cantidad a devolver (' + cantidad + ') no puede superar lo facturado en esta factura (' + facSel.cantidad_facturada + ').';
        errEl.style.display = 'block'; document.getElementById('es-cantidad')?.focus(); resetBtn(); return;
      }
    } else if (motivoEnt === 'transferencia') {
      const idOrigenVal = document.getElementById('es-area-origen')?.value;
      if (!idOrigenVal) { errEl.textContent = 'Debe seleccionar el área de origen.'; errEl.style.display = 'block'; document.getElementById('es-area-origen')?.focus(); resetBtn(); return; }
      // Transferencia solo aplica a Mercancías (cuenta 1.1.03.001) — un Consumible
      // (1.1.03.002) ya se gastó al salir de Compras y no puede "devolverse" como
      // inventario; su corrección es ANULAR la Salida original, no Transferencia.
      if (r.id_cuenta_contable) {
        const ctasArt = await obtenerCuentasContables();
        const ctaArt = ctasArt.find(function(c){ return c.id_cuenta === r.id_cuenta_contable; });
        const codigoCta = ctaArt ? ctaArt.codigo : null;
        if (codigoCta && codigoCta !== '1.1.03.001') {
          errEl.textContent = 'Este artículo es un Consumible (cuenta ' + codigoCta + '). Transferencia solo aplica a Mercancías. Si se envió a la área equivocada, anule la Salida original desde su Historial.';
          errEl.style.display = 'block';
          resetBtn(); return;
        }
      }
    }
    const id_areaEntVal = document.getElementById('es-area')?.value || 
      (await obtenerIdAreaCompras());
    const idEmpEntVal = parseInt(document.getElementById('es-empleado')?.value) || null;
    const claveEnt = document.getElementById('es-clave-receptor')?.value || '';
    if (!claveEnt) { errEl.textContent = 'El empleado remitente debe ingresar su contraseña.'; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }
    const validEnt = await validarClaveReceptor(idEmpEntVal, claveEnt);
    if (!validEnt.ok) { errEl.textContent = validEnt.msg; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }

    const id_areaEnt      = parseInt(id_areaEntVal) || null;
    const id_areaOrigenH  = (motivoEnt === 'transferencia') ? (parseInt(document.getElementById('es-area-origen')?.value) || null) : null;

    // Bloqueo real (no solo visual): el Área de Origen nunca puede ser la
    // misma que la receptora -- una auto-transferencia no tiene sentido y
    // dejaría el stock de esa Área intacto tras dos movimientos opuestos
    // que se cancelan entre sí, sin ningún efecto real más que ruido en
    // el Historial.
    if (motivoEnt === 'transferencia' && id_areaOrigenH && id_areaEnt && id_areaOrigenH === id_areaEnt) {
      errEl.textContent = 'El Área de Origen no puede ser la misma que el Área receptora. Seleccione un Área distinta.';
      errEl.style.display = 'block';
      document.getElementById('es-area-origen')?.focus();
      resetBtn(); return;
    }

    // ── FASE 1B: Si es Transferencia, validar que el Área de Origen tenga stock suficiente ──
    // (antes de crear ningún registro — evita dejar una Entrada huérfana si se rechaza)
    let stockOrigenActual = null;
    if (motivoEnt === 'transferencia' && id_areaOrigenH) {
      stockOrigenActual = await obtenerStockArea(id, id_areaOrigenH);
      if (stockOrigenActual < cantidad) {
        errEl.textContent = 'El Área de Origen no tiene suficiente stock disponible (' + stockOrigenActual + ' ' + (r.unidad||'UND') + ' disponibles).';
        errEl.style.display = 'block';
        document.getElementById('es-area-origen')?.focus();
        resetBtn(); return;
      }
    }

    // ── FASE 2: Leer stock de Compras (área receptora) fresco de BD — única fuente de verdad del CPP ──
    let stockActual = await obtenerStockArea(id, id_areaEnt);
    let costoActual = parseFloat(r?.precio_costo_moneda || 0);
    const artFresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id + '&select=precio_costo_moneda');
    if (artFresh && artFresh[0]) costoActual = parseFloat(artFresh[0].precio_costo_moneda || 0);
    const nuevoStock = stockActual + cantidad;

    // CPP
    var cpp = costoActual;
    if (nuevoPrecioCosto > 0) {
      cpp = nuevoStock > 0
        ? ((stockActual * costoActual) + (cantidad * nuevoPrecioCosto)) / nuevoStock
        : nuevoPrecioCosto;
    }

    // ── FASE 3: Registrar entrada en historial ──
    const idProvEnt  = (motivoEnt === 'compra') ? (parseInt(document.getElementById('es-proveedor')?.value) || null) : null;
    const clienteNomH  = (motivoEnt === 'devolucion') ? ((window._facturasDevolucionArt || []).find(function(f){ return String(f.id_factura) === String(document.getElementById('es-factura-devolucion')?.value); })?.receptor_nombre || null) : null;
    const idFacturaH   = (motivoEnt === 'devolucion') ? (parseInt(document.getElementById('es-factura-devolucion')?.value) || null) : null;

    // Monto TOTAL (con IVA si aplica) -- se calcula UNA sola vez, ANTES de
    // guardar la Entrada, para que quede congelado en la fila (columna
    // monto_total_con_iva) y así el Asiento y la CxP -- que para Compra
    // ahora se generan recién al APROBAR, posiblemente horas/días después,
    // por otra persona -- usen exactamente este mismo monto, sin
    // recalcularlo con una tasa o un redondeo distinto al de este momento.
    const exentoIVAEnt2   = document.getElementById('es-exento-iva-val')?.value === 'SI';
    const precioBaseAsiento = motivoEnt === 'compra' ? nuevoPrecioCostoRaw : costoActual;
    const montoTotalConIVA = motivoEnt !== 'compra'
      ? parseFloat((precioBaseAsiento * cantidad).toFixed(2))
      : (exentoIVAEnt2
          ? parseFloat((precioBaseAsiento * cantidad).toFixed(2))
          : parseFloat((precioBaseAsiento * cantidad * (incluyeIVA_ent ? 1 : (1 + IVA_RATE_ENT))).toFixed(2)));

    // Cuotas (solo Crédito): se guarda el desglose YA CALCULADO tal cual se
    // ve en pantalla (con cualquier ajuste manual del Usuario al monto por
    // cuota, y el ajuste de fecha a día hábil) -- no se recalcula después,
    // para que la aprobación (que puede pasar mucho más tarde) use
    // exactamente lo que el Usuario vio y aceptó al crear la Entrada.
    let cuotasJsonVal = null;
    if (motivoEnt === 'compra' && document.getElementById('es-esquema-pago')?.value === 'CREDITO') {
      const previewCuotasEnt = document.getElementById('es-cuotas-preview');
      cuotasJsonVal = previewCuotasEnt?.dataset.cuotas ? previewCuotasEnt.dataset.cuotas : null;
    }

    let id_entrada = null;
    const entradaRes = await api('stock_entradas', 'POST', {
      id_articulo:            id,
      cantidad:               cantidad,
      precio_costo_moneda:    nuevoPrecioCosto > 0 ? nuevoPrecioCosto : costoActual,
      precio_compra_original: precio_compra_original || null,
      moneda_compra:          moneda_compra_val,
      tasa_bcv:               tasa_bcv_usada,
      fecha_entrada:          document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
      fecha_negociacion:      document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
      id_area:                id_areaEnt,
      id_empleado:            idEmpEntVal,
      id_proveedor:           idProvEnt,
      cliente_nombre:         clienteNomH,
      id_factura:             idFacturaH,
      id_area_origen:         id_areaOrigenH,
      motivo:                 motivoEnt || null,
      esquema_pago:           document.getElementById('es-esquema-pago')?.value || null,
      observaciones:          ((motivoEnt === 'transferencia' ? '[TRANSFERENCIA] ' : '') + (document.getElementById('es-observaciones')?.value.trim() || '')) || null,
      exento_iva:             document.getElementById('edit-mov-exento-iva-val')?.value === 'SI' ? true : (document.getElementById('es-exento-iva-val')?.value === 'SI' ? true : (document.getElementById('es-exento-iva-val')?.value === 'NO' ? false : null)),
      incluye_iva:            document.getElementById('es-incluye-iva-val')?.value === 'SI' ? true : (document.getElementById('es-incluye-iva-val')?.value === 'NO' ? false : null),
      monto_total_con_iva:    montoTotalConIVA,
      cuotas_json:            cuotasJsonVal,
      estado_aprobacion:      motivoEnt === 'compra' ? 'PENDIENTE' : null,
      id_usuario:             sesionActual.correo_usuario
    });
    id_entrada = entradaRes && entradaRes[0] ? entradaRes[0].id_entrada : null;

    // ── COMPRA: se detiene aquí -- no se toca Stock, CPP, Asiento ni CxP
    // todavía. Eso solo pasa cuando un Nivel de Firma APRUEBE esta Entrada
    // (ver ejecutarEfectosEntradaCompra() / aprobarEntradaCompra()). Se
    // notifica al aprobador correspondiente y se corta la ejecución aquí.
    if (motivoEnt === 'compra') {
      try {
        const numDocSol = id_entrada ? 'ENT-' + id_entrada : ('ENT-INV-' + id);
        await enrutarAprobacionEntrada(montoTotalConIVA, id_entrada, numDocSol);
      } catch(eEnrutEnt) { console.warn('Error enrutando aprobación de Entrada:', eEnrutEnt); }
      okEl.textContent = 'Entrada registrada -- pendiente de aprobación de un Nivel de Firma antes de afectar Stock/Contabilidad.';
      okEl.style.display = 'block';
      setTimeout(async function() {
        cerrarModal('modal-entrada-stock');
        cerrarModal('modal-stock-articulo');
        renderInventario();
      }, 1400);
      resetBtn();
      return;
    }

    // ── FASE 4: Actualizar CPP (global, sigue en inventario_almacen) y stock del área receptora (Compras) ──
    const patchCPP = { precio_costo_moneda: parseFloat(cpp.toFixed(4)) };
    if (nuevoPrecioCosto > 0) patchCPP.precio_costo_ultimo_moneda = nuevoPrecioCosto;
    await api('inventario_almacen', 'PATCH', patchCPP, '?id_articulo=eq.' + id);
    await upsertStockArea(id, id_areaEnt, cantidad);

    // ── FASE 4.5: Si es Transferencia, registrar la salida del Área de Origen y descontarle el stock ──
    if (motivoEnt === 'transferencia' && id_areaOrigenH) {
      const idEmpEntregaH = parseInt(document.getElementById('es-empleado-entrega')?.value) || null;
      const obsUsuarioTransf = document.getElementById('es-observaciones')?.value.trim() || '';
      await api('stock_salidas', 'POST', {
        id_articulo:       id,
        cantidad:          cantidad,
        fecha_salida:      getHoyVzla(),
        id_area:           id_areaEnt,          // destino (Compras, receptor)
        id_area_entrega:   id_areaOrigenH,       // origen (quien entrega)
        id_empleado:       idEmpEntVal,         // receptor
        id_empleado_entrega: idEmpEntregaH,
        // Prefijo reconocible -- distingue este registro espejo de una
        // Salida real (venta/entrega) para mostrarlo como "Transferencia"
        // en el Historial, en vez de "Salida" (que confunde).
        observaciones:     '[TRANSFERENCIA] ' + obsUsuarioTransf,
        id_usuario:        sesionActual.correo_usuario
      });
      // Descontar del Área de Origen (ya validamos en FASE 1B que tenía suficiente)
      await upsertStockArea(id, id_areaOrigenH, -cantidad);
    }

    // ── FASE 5: Asiento contable ──
    // NOTA: Transferencia (Área → Compras) NUNCA genera asiento contable.
    // - Si es Mercancía: nunca se gastó al salir de Compras (sigue como inventario
    //   en el área), así que al volver solo se mueve el stock, sin asiento.
    // - Si es un Consumible enviado por error a otra área: la corrección correcta
    //   es ANULAR la Salida original desde su Historial (no un Reverso/asiento
    //   nuevo aquí) — anular deja sin efecto el gasto ya registrado, en vez de
    //   generar un segundo asiento que podría producir ganancias/pérdidas ficticias.

    // montoTotalConIVA, precioBaseAsiento y exentoIVAEnt2 ya se calcularon
    // arriba, antes de guardar la Entrada (para poder congelarlo en
    // monto_total_con_iva) -- se reutilizan aquí tal cual.

    // Transferencias de otros articulos (Mercancias) NO generan asiento aqui.
    // Devolución de Cliente tampoco usa el asiento genérico — usa su propio
    // reverso de Ingreso + Costo de Venta más abajo (ver bloque siguiente).
    if (motivoEnt !== "transferencia" && motivoEnt !== "devolucion") try {
      const areaNombreEnt = document.getElementById('es-area-display')?.textContent || 'Área';
      const tipoAst = motivoEnt === 'compra' ? 'ENTRADA_COMPRA' : 'ENTRADA_AJUSTE';
      await generarAsientoInventario(tipoAst, {
        articulo:   r.nombre_articulo || r.codigo_articulo || ('Art#' + id),
        cantidad:   cantidad,
        montoUSD:   montoTotalConIVA,
        areaId:     id_areaEnt,
        areaNombre: areaNombreEnt,
        referencia: id_entrada ? 'ENT-' + id_entrada : ('ENT-INV-' + id),
        id_cuentaInventario: r.id_cuenta_contable || null,
        fecha:      document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
        tasa:       tasa_bcv_usada || null,
        // montoTotalConIVA ya es el TOTAL (con IVA incluido si no es exento);
        // se le pide a generarAsientoInventario que lo desgloce (base = total/1.16)
        incluyeIVA:  true,
        exentoIVA:   exentoIVAEnt2
        // NOTA: ya NO se pasa baseExactaUSD/baseExactaBs con el CPP mezclado.
        // El asiento de la Compra debe reflejar SIEMPRE el monto real de esta
        // factura (Base/IVA/Total tal como se ve en Tributos) -- la Cuenta
        // por Pagar y el Crédito Fiscal de IVA deben coincidir exacto con lo
        // facturado por el proveedor, sin mezclarse con el costo promedio de
        // compras anteriores. El posible residuo de redondeo que esto genera
        // en la cuenta de Inventario se resuelve con un asiento de ajuste
        // automático cuando el stock del artículo llegue a 0.
      });
    } catch(eAstInv) { console.warn('Error asiento entrada inventario:', eAstInv); }

    // ── Devolución de Cliente: reverso de Ingreso + reverso de Costo de Venta ──
    // (prorrateado según cuánto de lo facturado se está devolviendo)
    if (motivoEnt === 'devolucion') try {
      const idFacturaDev = parseInt(document.getElementById('es-factura-devolucion')?.value) || null;
      if (idFacturaDev) {
        const facRes = await api('facturas','GET',null,'?id_factura=eq.'+idFacturaDev+
          '&select=id_factura,numero_factura,id_orden,receptor_nombre,subtotal_usd,iva_usd,igtf_usd,total_usd,tasa_bcv,aplica_iva,aplica_igtf');
        const facDev = facRes && facRes[0] ? facRes[0] : null;
        const lineaOS = facDev ? (await api('os_mercancias','GET',null,'?id_orden=eq.'+facDev.id_orden+'&id_articulo=eq.'+id+'&select=cantidad,subtotal_usd'))?.[0] : null;

        if (facDev && lineaOS && parseFloat(lineaOS.cantidad) > 0) {
          const cantFacturada   = parseFloat(lineaOS.cantidad);
          const proporcion      = Math.min(1, cantidad / cantFacturada);
          const subtotalLineaUS = parseFloat(lineaOS.subtotal_usd || 0);
          const subtotalDevUSD  = parseFloat((subtotalLineaUS * proporcion).toFixed(2));
          // IVA/IGTF prorrateados según la participación de esta línea en la factura total
          const participacion   = facDev.subtotal_usd > 0 ? (subtotalLineaUS / facDev.subtotal_usd) : 0;
          const ivaDevUSD  = facDev.aplica_iva  ? parseFloat((facDev.iva_usd  * participacion * proporcion).toFixed(2)) : 0;
          const igtfDevUSD = facDev.aplica_igtf ? parseFloat((facDev.igtf_usd * participacion * proporcion).toFixed(2)) : 0;
          const totalDevUSD = parseFloat((subtotalDevUSD + ivaDevUSD + igtfDevUSD).toFixed(2));
          const tasaDev = parseFloat(facDev.tasa_bcv) || tasa_bcv_usada || 1;

          const todasCtasDev = await obtenerCuentasContables();
          const cuentasDev = todasCtasDev.filter(function(c){ return ['1.1.02.001','4.1.02.001','2.1.03.001'].includes(c.codigo); });
          const cCxCDev    = cuentasDev.find(function(c){ return c.codigo==='1.1.02.001'; });
          const cIngRepDev = cuentasDev.find(function(c){ return c.codigo==='4.1.02.001'; });
          const cIVADev    = cuentasDev.find(function(c){ return c.codigo==='2.1.03.001'; });
          let cIGTFDev = null;
          if (igtfDevUSD > 0) {
            cIGTFDev = todasCtasDev.find(function(c){ return c.estado === 'ACTIVO' && /igtf.*por.*pagar/i.test(c.nombre||''); })
              || todasCtasDev.find(function(c){ return c.codigo === '2.1.03.004'; })
              || null;
          }

          const anioDev = new Date().getFullYear();
          const seqBase = await api('cont_asientos','GET',null,'?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
          let seqDev = 1;
          if (seqBase[0]?.numero_asiento) { const mmD = seqBase[0].numero_asiento.match(/(\d+)$/); if (mmD) seqDev = parseInt(mmD[1])+1; }

          // Asiento 1: Reverso del Ingreso (nota de crédito)
          const numAstDev1 = 'AST-'+anioDev+'-'+String(seqDev).padStart(4,'0');
          const astDev1 = await api('cont_asientos','POST',{
            id_empresa: _empresaActiva?.id_empresa||0, numero_asiento: numAstDev1,
            tipo: 'DEVOLUCION_VENTA', fecha: document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
            descripcion: 'Devolución de Cliente — Factura '+facDev.numero_factura+' — '+(r.nombre_articulo||'')+' x'+cantidad,
            referencia: id_entrada ? 'ENT-'+id_entrada : 'DEV-'+id,
            estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaDev,
            id_usuario: sesionActual?.correo_usuario||null
          });
          const arDev1 = Array.isArray(astDev1) ? astDev1[0] : astDev1;
          if (arDev1?.id_asiento) {
            let ordenDev = 1;
            if (cIngRepDev) await api('cont_asiento_lineas','POST',{ id_asiento:arDev1.id_asiento, id_cuenta:cIngRepDev.id_cuenta, orden:ordenDev++,
              descripcion:'Reverso Ingreso — Devolución Fact. '+facDev.numero_factura, debe_usd:subtotalDevUSD, haber_usd:0, debe_ves:parseFloat((subtotalDevUSD*tasaDev).toFixed(2)), haber_ves:0, tasa_bcv:tasaDev });
            if (cIVADev && ivaDevUSD > 0) await api('cont_asiento_lineas','POST',{ id_asiento:arDev1.id_asiento, id_cuenta:cIVADev.id_cuenta, orden:ordenDev++,
              descripcion:'Reverso IVA — Devolución Fact. '+facDev.numero_factura, debe_usd:ivaDevUSD, haber_usd:0, debe_ves:parseFloat((ivaDevUSD*tasaDev).toFixed(2)), haber_ves:0, tasa_bcv:tasaDev });
            if (cIGTFDev && igtfDevUSD > 0) await api('cont_asiento_lineas','POST',{ id_asiento:arDev1.id_asiento, id_cuenta:cIGTFDev.id_cuenta, orden:ordenDev++,
              descripcion:'Reverso IGTF — Devolución Fact. '+facDev.numero_factura, debe_usd:igtfDevUSD, haber_usd:0, debe_ves:parseFloat((igtfDevUSD*tasaDev).toFixed(2)), haber_ves:0, tasa_bcv:tasaDev });
            if (cCxCDev) await api('cont_asiento_lineas','POST',{ id_asiento:arDev1.id_asiento, id_cuenta:cCxCDev.id_cuenta, orden:ordenDev++,
              descripcion:'Reverso CxC — Devolución Fact. '+facDev.numero_factura, debe_usd:0, haber_usd:totalDevUSD, debe_ves:0, haber_ves:parseFloat((totalDevUSD*tasaDev).toFixed(2)), tasa_bcv:tasaDev });
          }

          // Asiento 2: Reverso del Costo de Venta (al CPP vigente del artículo)
          if (r.id_cuenta_contable && r.id_cuenta_costo_gasto) {
            const cppDevUSD = parseFloat((cantidad * parseFloat(r.precio_costo_moneda||0)).toFixed(4));
            if (cppDevUSD > 0) {
              const numAstDev2 = 'AST-'+anioDev+'-'+String(seqDev+1).padStart(4,'0');
              const astDev2 = await api('cont_asientos','POST',{
                id_empresa: _empresaActiva?.id_empresa||0, numero_asiento: numAstDev2,
                tipo: 'DEVOLUCION_VENTA', fecha: document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
                descripcion: 'Reverso Costo de Venta — Devolución Fact. '+facDev.numero_factura+' — '+(r.nombre_articulo||'')+' x'+cantidad,
                referencia: id_entrada ? 'ENT-'+id_entrada : 'DEV-'+id,
                estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaDev,
                id_usuario: sesionActual?.correo_usuario||null
              });
              const arDev2 = Array.isArray(astDev2) ? astDev2[0] : astDev2;
              const montoVESDev2 = parseFloat((cppDevUSD*tasaDev).toFixed(2));
              if (arDev2?.id_asiento) {
                await api('cont_asiento_lineas','POST',{ id_asiento:arDev2.id_asiento, id_cuenta:r.id_cuenta_contable, orden:1,
                  descripcion:'Reingreso a Inventario — Devolución: '+(r.nombre_articulo||'')+' x'+cantidad,
                  debe_usd:cppDevUSD, haber_usd:0, debe_ves:montoVESDev2, haber_ves:0, tasa_bcv:tasaDev });
                await api('cont_asiento_lineas','POST',{ id_asiento:arDev2.id_asiento, id_cuenta:r.id_cuenta_costo_gasto, orden:2,
                  descripcion:'Reverso Costo de Venta: '+(r.nombre_articulo||'')+' x'+cantidad,
                  debe_usd:0, haber_usd:cppDevUSD, debe_ves:0, haber_ves:montoVESDev2, tasa_bcv:tasaDev });
              }
            }
          }
        }
      }
    } catch(eDevAst) { console.warn('Error generando asientos de Devolución de Cliente:', eDevAst); }

    // NOTA: la creación de la CxP para motivo='compra' ya NO ocurre aquí --
    // esa rama de código siempre hacía "return" más arriba (ver bloque
    // "COMPRA: se detiene aquí"), así que este bloque había quedado
    // inalcanzable. La CxP para Compras ahora se crea en
    // ejecutarEfectosEntradaCompra(), al momento de la aprobación.

    // ── FASE 6: Actualizar cache y cerrar ──
    if (r) {
      r.precio_costo_moneda       = parseFloat(cpp.toFixed(4));
      if (nuevoPrecioCosto > 0) r.precio_costo_ultimo_moneda = nuevoPrecioCosto;
    }
    okEl.textContent = 'Stock de Compras actualizado: ' + stockActual + ' → ' + nuevoStock + ' ' + (r?.unidad || 'UND');
    okEl.style.display = 'block';
    setTimeout(async function() {
      cerrarModal('modal-entrada-stock');
      cerrarModal('modal-stock-articulo');
      await calcularInvSaldoArea();
      renderInventario();
      resetBtn();
    }, 1200);

  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    resetBtn();
  }
}

// Enruta la notificación de aprobación para una Entrada de Compra que
// todavía no tiene CxP (nace recién al aprobar) -- llama a la función RPC
// _buscar_y_notificar_aprobador_entrada / enrutar_aprobacion_entrada (misma
// lógica de Área → Nivel 2 con límite de monto → escala a Nivel 1, que ya
// usa Pagos para las CxP, pero referenciando la Entrada directamente).
async function enrutarAprobacionEntrada(monto, idEntrada, numeroDoc) {
  try {
    const idAreaCreador = await _resolverAreaSesion();
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/enrutar_aprobacion_entrada', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_id_area: idAreaCreador,
        p_monto: monto,
        p_id_entrada: idEntrada,
        p_numero_doc: numeroDoc,
        p_correo_creador: sesionActual?.correo_usuario || null
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(function(){ return {}; });
      throw new Error(err.message || 'Error ' + resp.status);
    }
    const data = await resp.json();
    console.log('[enrutamiento de aprobación de Entrada]', data);
  } catch(e) { console.warn('Error en enrutamiento de aprobación de Entrada:', e); }
}

// Ejecuta TODO lo que antes pasaba de inmediato al guardar una Entrada de
// Compra (Stock/CPP, Asiento contable, CxP) -- ahora ocurre recién cuando
// un Nivel de Firma la APRUEBA. Lee todo desde la fila YA GUARDADA en
// stock_entradas (parámetro m), no de un formulario en pantalla -- para
// cuando esto se ejecuta, el formulario original ya no existe: puede
// aprobarlo otra persona, en otro momento, desde otra pantalla.
async function ejecutarEfectosEntradaCompra(m) {
  const id = m.id_articulo;
  const cantidad = parseFloat(m.cantidad || 0);
  const nuevoPrecioCosto = parseFloat(m.precio_costo_moneda || 0); // ya es el costo unitario sin IVA, congelado al crear
  const id_areaEnt = m.id_area;
  const tasa_bcv_usada = parseFloat(m.tasa_bcv || 0) || null;
  const montoTotalConIVA = parseFloat(m.monto_total_con_iva || 0);

  // Artículo fresco (nombre, cuentas contables) -- puede no estar en
  // inventarioCache si quien aprueba nunca abrió Inventario General.
  const artRows = await api('inventario_almacen','GET',null,
    '?id_articulo=eq.'+id+'&select=nombre_articulo,codigo_articulo,precio_costo_moneda,id_cuenta_contable,id_cuenta_costo_gasto');
  const r = artRows && artRows[0] ? artRows[0] : {};

  // ── Stock/CPP: mismo cálculo de siempre, pero con el stock/costo FRESCOS
  // de ahora mismo (no los de cuando se creó la Entrada -- pudo pasar
  // tiempo entre crear y aprobar, y otros movimientos pudieron ocurrir).
  const stockActual = await obtenerStockArea(id, id_areaEnt);
  const costoActual = parseFloat(r.precio_costo_moneda || 0);
  const nuevoStock = stockActual + cantidad;
  let cpp = costoActual;
  if (nuevoPrecioCosto > 0) {
    cpp = nuevoStock > 0
      ? ((stockActual * costoActual) + (cantidad * nuevoPrecioCosto)) / nuevoStock
      : nuevoPrecioCosto;
  }
  const patchCPP = { precio_costo_moneda: parseFloat(cpp.toFixed(4)) };
  if (nuevoPrecioCosto > 0) patchCPP.precio_costo_ultimo_moneda = nuevoPrecioCosto;
  await api('inventario_almacen', 'PATCH', patchCPP, '?id_articulo=eq.' + id);
  await upsertStockArea(id, id_areaEnt, cantidad);

  // ── Asiento contable (ENTRADA_COMPRA) ──
  let areaNombreEnt = 'Área';
  try {
    const areaRows = await api('param_areas','GET',null,'?id=eq.'+id_areaEnt+'&select=nombre');
    if (areaRows && areaRows[0]) areaNombreEnt = areaRows[0].nombre;
  } catch(eAreaNom) {}
  try {
    await generarAsientoInventario('ENTRADA_COMPRA', {
      articulo:   r.nombre_articulo || r.codigo_articulo || ('Art#' + id),
      cantidad:   cantidad,
      montoUSD:   montoTotalConIVA,
      areaId:     id_areaEnt,
      areaNombre: areaNombreEnt,
      referencia: 'ENT-' + m.id_entrada,
      id_cuentaInventario: r.id_cuenta_contable || null,
      fecha:      m.fecha_negociacion || m.fecha_entrada,
      tasa:       tasa_bcv_usada || null,
      incluyeIVA:  true,
      exentoIVA:   m.exento_iva === true
    });
  } catch(eAstInv) { console.warn('Error asiento entrada inventario (aprobación):', eAstInv); }

  // ── CxP: nace ya APROBADA -- el Nivel de Firma que aprobó la Entrada ya
  // cubrió esa validación, no tiene sentido pedirle a alguien que la
  // vuelva a aprobar para el pago.
  try {
    const montoUSD = montoTotalConIVA;
    const montoVES = parseFloat((montoUSD * (tasa_bcv_usada || _tasaVigente || 1)).toFixed(2));
    const numDocBase = 'ENT-' + m.id_entrada;
    const artNomCxP = r.nombre_articulo || r.codigo_articulo || 'Art#'+id;
    const fechaNegCxP = m.fecha_negociacion || m.fecha_entrada;
    const ahoraIso = new Date().toISOString();

    if (m.esquema_pago === 'CREDITO') {
      const cuotas = m.cuotas_json ? (typeof m.cuotas_json === 'string' ? JSON.parse(m.cuotas_json) : m.cuotas_json) : [];
      if (!cuotas.length) throw new Error('La Entrada no tiene el desglose de cuotas guardado.');
      const totalVesCuotas = parseFloat((montoTotalConIVA * (tasa_bcv_usada || 1)).toFixed(2));
      let acumVesCuotas = 0;
      for (let i = 0; i < cuotas.length; i++) {
        const c = cuotas[i];
        const esUltimaCuota = i === cuotas.length - 1;
        const montoVesCuota = esUltimaCuota
          ? parseFloat((totalVesCuotas - acumVesCuotas).toFixed(2))
          : parseFloat((c.monto * (tasa_bcv_usada || 1)).toFixed(2));
        acumVesCuotas = parseFloat((acumVesCuotas + montoVesCuota).toFixed(2));
        const cxpCuotaCreada = await api('cont_cxp','POST',{
          id_proveedor:     m.id_proveedor,
          id_empresa:       _empresaActiva?.id_empresa || null,
          id_cuenta_gasto:  r.id_cuenta_costo_gasto || null,
          tipo:             'COMPRA_ARTICULO_CREDITO',
          numero_doc:       numDocBase + '-C' + c.num,
          fecha_emision:    fechaNegCxP,
          fecha_vencimiento: c.fecha,
          moneda_pago:      m.moneda_compra || 'USD',
          estado:           'APROBADA',
          aprobado_por:     m.aprobado_por || null,
          fecha_aprobacion: ahoraIso,
          monto_usd:        parseFloat(c.monto.toFixed(2)),
          monto_ves:        montoVesCuota,
          tasa_bcv:         tasa_bcv_usada || 1,
          tasa_bcv_compra:  tasa_bcv_usada || 1,
          pagado_usd:       0,
          saldo_usd:        parseFloat(c.monto.toFixed(2)),
          observaciones:    artNomCxP + ' x ' + cantidad + ' uds.',
          esquema_pago:     'CREDITO',
          id_usuario:       m.id_usuario || null
        });
        if (cxpCuotaCreada && cxpCuotaCreada[0]) {
          await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-C' + c.num + '-' + cxpCuotaCreada[0].id_cxp }, '?id_cxp=eq.' + cxpCuotaCreada[0].id_cxp);
        }
      }
    } else {
      const cxpCreada = await api('cont_cxp','POST',{
        id_proveedor:    m.id_proveedor,
        id_empresa:      _empresaActiva?.id_empresa || null,
        id_cuenta_gasto: r.id_cuenta_costo_gasto || null,
        tipo:            'COMPRA_ARTICULO',
        numero_doc:      numDocBase,
        fecha_emision:   fechaNegCxP,
        fecha_vencimiento: fechaNegCxP,
        moneda_pago:     m.moneda_compra || 'USD',
        estado:          'APROBADA',
        aprobado_por:    m.aprobado_por || null,
        fecha_aprobacion: ahoraIso,
        monto_usd:       montoUSD,
        monto_ves:       montoVES,
        tasa_bcv:        tasa_bcv_usada || 1,
        tasa_bcv_compra: tasa_bcv_usada || 1,
        pagado_usd:      0,
        saldo_usd:       montoUSD,
        observaciones:   artNomCxP + ' x ' + cantidad + ' uds.',
        esquema_pago:    'CONTADO',
        id_usuario:      m.id_usuario || null
      });
      if (cxpCreada && cxpCreada[0]) {
        await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-' + cxpCreada[0].id_cxp }, '?id_cxp=eq.' + cxpCreada[0].id_cxp);
      }
    }
  } catch(eCxP) { console.warn('Error creando CxP (aprobación de Entrada):', eCxP.message); }
}

// Aprueba una Entrada de Compra pendiente -- revalida el monto contra el
// límite del Nivel de Firma de quien aprueba, marca la Entrada como
// APROBADA, y ejecuta recién ahí todos los efectos (Stock/CPP/Asiento/CxP).
async function aprobarEntradaCompra(id_entrada) {
  if (!sesionActual?.administrador && !puedo('PAGOS','APROBAR')) {
    alert('No tiene permiso para aprobar Entradas de Compra.'); return;
  }
  try {
    const entRows = await api('stock_entradas','GET',null,'?id_entrada=eq.'+id_entrada);
    const m = entRows && entRows[0] ? entRows[0] : null;
    if (!m) { alert('No se encontró la Entrada.'); return; }
    if (m.estado_aprobacion !== 'PENDIENTE') {
      alert('Esta Entrada ya no está pendiente de aprobación (estado actual: ' + (m.estado_aprobacion || '—') + '). Puede que ya haya sido aprobada, rechazada o editada por otra persona.');
      return;
    }
    // Revalidar límite de Nivel de Firma de quien aprueba, contra el monto real.
    if (!sesionActual?.administrador) {
      const montoMaxAprob = await _resolverMontoMaxAprobacionSesion();
      if (montoMaxAprob !== null && parseFloat(m.monto_total_con_iva||0) > montoMaxAprob) {
        alert('Esta Entrada ($' + parseFloat(m.monto_total_con_iva||0).toFixed(2) + ') supera el monto máximo que su Nivel de Firma puede aprobar ($' + montoMaxAprob.toFixed(2) + '). Debe ser aprobada por un Nivel de Firma superior.');
        return;
      }
    }
    await api('stock_entradas','PATCH',{
      estado_aprobacion: 'APROBADA',
      aprobado_por: sesionActual?.correo_usuario || null,
      fecha_aprobacion: new Date().toISOString()
    },'?id_entrada=eq.'+id_entrada);
    // Releer con aprobado_por ya seteado, para que ejecutarEfectosEntradaCompra lo use en la CxP
    const mAprobado = Object.assign({}, m, { aprobado_por: sesionActual?.correo_usuario || null });
    await ejecutarEfectosEntradaCompra(mAprobado);
    alert('Entrada aprobada. Stock, Costo y Cuenta por Pagar actualizados.');
    await calcularInvSaldoArea();
    renderInventario();
  } catch(e) {
    alert('Error al aprobar la Entrada: ' + e.message);
  }
}

async function invCargarCategorias(selCatId) {
  const sel = document.getElementById('inv-categoria');
  if (!sel) return;
  try {
    if (!_invCategoriasCache.length) {
      _invCategoriasCache = await api('inv_categorias','GET',null,
        '?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || [];
    }
    sel.innerHTML = '<option value="">— Seleccionar categoría —</option>'
      + _invCategoriasCache.map(function(c) {
          return '<option value="'+c.id_categoria+'"'+(selCatId && selCatId==c.id_categoria?' selected':'')+'>'+
            (c.codigo?c.codigo+' — ':'')+c.nombre+'</option>';
        }).join('');
  } catch(e) { console.warn('invCargarCategorias:', e); }
  await invCargarTiposArticulo(selCatId ? null : undefined);
}

async function invCargarTiposArticulo(selTipoId) {
  const sel = document.getElementById('inv-tipo-articulo');
  const catId = parseInt(document.getElementById('inv-categoria')?.value) || null;
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar tipo —</option>';
  if (!catId) return;
  try {
    const tipos = await api('inv_articulos_tipo','GET',null,
      '?estado=eq.ACTIVO&id_categoria=eq.'+catId+'&order=nombre.asc') || [];
    sel.innerHTML = '<option value="">— Seleccionar tipo —</option>'
      + tipos.map(function(t) {
          return '<option value="'+t.id_tipo+'"'+(selTipoId && selTipoId==t.id_tipo?' selected':'')+'>'+
            (t.codigo?t.codigo+' — ':'')+t.nombre+'</option>';
        }).join('');
  } catch(e) { console.warn('invCargarTiposArticulo:', e); }
}

async function abrirNuevoInventario() {
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) infoEl.style.display = 'none';
  var avisoBloqueoNuevo = document.getElementById('inv-aviso-bloqueado');
  if (avisoBloqueoNuevo) avisoBloqueoNuevo.style.display = 'none';
  var avisoCuentasNuevo = document.getElementById('inv-aviso-cuentas');
  if (avisoCuentasNuevo) avisoCuentasNuevo.style.display = 'none';
  // Cargar cuentas del grupo 1.1.03 para nuevo artículo
  try {
    const todasCtasN = await obtenerCuentasContables();
    const ctas113 = todasCtasN.filter(function(c){ return c.codigo && c.codigo.indexOf('1.1.03') === 0 && c.estado === 'ACTIVA' && c.permite_movimiento === true; }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const selCta = document.getElementById('inv-cuenta-contable');
    if (selCta) selCta.innerHTML = '<option value="">— Seleccionar cuenta 1.1.03.xxx —</option>' + ctas113.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
    const ctasCGn = todasCtasN.filter(function(c){ return ['EGRESO','COSTO'].includes(c.tipo) && c.estado === 'ACTIVA' && c.permite_movimiento === true; }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const selCGn = document.getElementById('inv-cuenta-costo-gasto');
    if (selCGn) { selCGn.innerHTML = '<option value="">— Seleccionar cuenta —</option>' + ctasCGn.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join(''); selCGn.value = ''; }
  } catch(e2) {}
  ['inv-id','inv-codigo','inv-nombre','inv-descripcion','inv-stock','inv-stock-min','inv-costo','inv-venta','inv-demanda-anual','inv-lead-time','inv-costo-pedido','inv-stock-seg'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('inv-unidad').value = 'UND';
  const invEstadoNuevo = document.getElementById('inv-estado');
  if (invEstadoNuevo) {
    invEstadoNuevo.value = 'ACTIVO';
    invEstadoNuevo.disabled = !(sesionActual?.administrador || puedo('INVENTARIO','CAMBIAR_ESTADO'));
  }
  var invVentaContN = document.getElementById('inv-venta-cont');
  if (invVentaContN) invVentaContN.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  // Asegurar que todos los campos estén habilitados al crear nuevo
  ['inv-categoria','inv-tipo-articulo','inv-codigo','inv-nombre','inv-descripcion','inv-unidad'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  const invStockNuevo = document.getElementById('inv-stock');
  if (invStockNuevo) { invStockNuevo.disabled = false; invStockNuevo.title = ''; }
  document.getElementById('modal-inv-titulo').textContent = 'NUEVO ARTICULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';
  _invCategoriasCache = []; // Forzar recarga
  await invCargarCategorias(null);
  abrirModal('modal-inventario');
  setTimeout(function() {
    const body = document.querySelector('#modal-inventario .modal-body');
    if (body) body.scrollTop = 0;
    document.getElementById('inv-categoria')?.focus();
  }, 80);
}

async function abrirEditarInventario(id) {
  // Asegurar que _invSaldoArea esté calculado para mostrar stock correcto del área
  await calcularInvSaldoArea();
  try {
    const todasCtasE = await obtenerCuentasContables();
    const ctas113e = todasCtasE.filter(function(c){ return c.codigo && c.codigo.indexOf('1.1.03') === 0 && c.estado === 'ACTIVA' && c.permite_movimiento === true; }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const selCtaE = document.getElementById('inv-cuenta-contable');
    if (selCtaE) { selCtaE.innerHTML = '<option value="">— Seleccionar —</option>' + ctas113e.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join(''); }
    const ctasCGe = todasCtasE.filter(function(c){ return ['EGRESO','COSTO'].includes(c.tipo) && c.estado === 'ACTIVA' && c.permite_movimiento === true; }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const selCGe = document.getElementById('inv-cuenta-costo-gasto');
    if (selCGe) selCGe.innerHTML = '<option value="">— Seleccionar cuenta —</option>' + ctasCGe.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
  } catch(e3) {}
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  // Preseleccionar cuenta contable
  const selCtaFinal = document.getElementById('inv-cuenta-contable');
  if (selCtaFinal && r.id_cuenta_contable) selCtaFinal.value = r.id_cuenta_contable;
  const selCGFinal = document.getElementById('inv-cuenta-costo-gasto');
  if (selCGFinal && r.id_cuenta_costo_gasto) selCGFinal.value = r.id_cuenta_costo_gasto;
  document.getElementById('inv-id').value = r.id_articulo;
  document.getElementById('inv-codigo').value = r.codigo_articulo || '';
  document.getElementById('inv-nombre').value = (r.nombre_articulo || '').toUpperCase();
  document.getElementById('inv-descripcion').value = r.descripcion_articulo || '';
  document.getElementById('inv-stock').value = stockMostrarArticulo(r.id_articulo);
  // El stock real vive en inventario_stock_area (por área) desde que se migró el esquema —
  // este campo ya no debe ser editable ni guardarse al editar un artículo existente.
  // Un artículo nuevo sí puede definir un stock inicial (se asigna a Compras en guardarInventario).
  document.getElementById('inv-stock').disabled = !!id;
  document.getElementById('inv-stock').title = id ? 'El stock se gestiona por Entrada/Salida/Ajuste, no desde aquí' : '';
  document.getElementById('inv-stock-min').value = r.stock_minimo_articulo;
  document.getElementById('inv-costo').value = r.precio_costo_moneda || '';
  document.getElementById('inv-venta').value = r.precio_venta_moneda || '';
  var invVentaCont = document.getElementById('inv-venta-cont');
  if (invVentaCont) invVentaCont.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  document.getElementById('inv-unidad').value = r.unidad || 'UND';
  const invEstadoEdit = document.getElementById('inv-estado');
  if (invEstadoEdit) {
    invEstadoEdit.value = r.estado || 'ACTIVO';
    invEstadoEdit.disabled = !(sesionActual?.administrador || puedo('INVENTARIO','CAMBIAR_ESTADO'));
  }
  await invCargarCategorias(r.id_categoria_articulo || null);
  await invCargarTiposArticulo(r.id_tipo_articulo || null);
  document.getElementById('inv-demanda-anual').value = r.demanda_anual || '';
  document.getElementById('inv-lead-time').value = r.lead_time_dias || '';
  document.getElementById('inv-costo-pedido').value = r.costo_pedido_usd || '';
  document.getElementById('inv-stock-seg').value = r.stock_seguridad || '';
  document.getElementById('modal-inv-titulo').textContent = 'EDITAR ARTICULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';

  // Bloquear Categoría/Tipo/Código/Nombre/Unidad SOLO si el artículo ya
  // tiene Entradas de Stock registradas (podrían romper coherencia con
  // movimientos históricos si cambian después). Si nunca se le ha hecho
  // ninguna Entrada, se permite editar todo libremente -- mismo criterio
  // que ya usa eliminarInventario() para decidir si se puede borrar.
  // Descripción queda editable siempre -- es solo texto informativo.
  let tieneEntradasArt = false;
  try {
    const entradasChk = await api('stock_entradas','GET',null,'?id_articulo=eq.'+id+'&select=id_entrada&limit=1');
    tieneEntradasArt = entradasChk && entradasChk.length > 0;
  } catch(eChkEnt) { console.warn('Error verificando Entradas del artículo:', eChkEnt); tieneEntradasArt = true; /* por seguridad, bloquear si no se pudo confirmar */ }
  ['inv-categoria','inv-tipo-articulo','inv-codigo','inv-nombre','inv-unidad'].forEach(function(id2) {
    var el = document.getElementById(id2);
    if (el) el.disabled = tieneEntradasArt;
  });
  const avisoBloqueo = document.getElementById('inv-aviso-bloqueado');
  if (avisoBloqueo) avisoBloqueo.style.display = tieneEntradasArt ? '' : 'none';
  const avisoCuentas = document.getElementById('inv-aviso-cuentas');
  if (avisoCuentas) avisoCuentas.style.display = tieneEntradasArt ? '' : 'none';

  // En edición mostrar stock actual y precio costo como info (solo lectura)
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) {
    infoEl.style.display = '';
    const stockFicha = stockMostrarArticulo(r.id_articulo);
    document.getElementById('inv-info-stock-val').textContent = stockFicha + ' ' + (r.unidad || 'UND');
    document.getElementById('inv-info-costo-val').textContent = '$ ' + parseFloat(r.precio_costo_moneda || 0).toFixed(2) + ' (CPP)';
  }
  abrirModal('modal-inventario');
  focusFirstField('modal-inventario');
  setTimeout(function() {
    const body = document.querySelector('#modal-inventario .modal-body');
    if (body) body.scrollTop = 0;
  }, 50);
}

async function guardarInventario() {
  const id = document.getElementById('inv-id').value;
  if (id && !puedo('INVENTARIO','EDITAR')) { alert('No tiene permiso para editar artículos.'); return; }
  if (!id && !puedo('INVENTARIO','CREAR')) { alert('No tiene permiso para crear artículos.'); return; }
  const codigo   = document.getElementById('inv-codigo').value.trim();
  const nombre   = document.getElementById('inv-nombre').value.trim().toUpperCase();
  const desc     = document.getElementById('inv-descripcion').value.trim();
  const stock    = parseInt(document.getElementById('inv-stock').value) || 0;
  const stockMin = parseInt(document.getElementById('inv-stock-min').value) || 0;
  const costo    = parseFloat(document.getElementById('inv-costo').value) || 0;
  const venta    = parseFloat(document.getElementById('inv-venta').value) || 0;
  const unidad   = document.getElementById('inv-unidad').value;
  const okEl     = document.getElementById('alerta-inv-ok');
  const errEl    = document.getElementById('alerta-inv-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const id_categoria2 = parseInt(document.getElementById('inv-categoria')?.value) || 0;
  if (!id_categoria2) { errEl.textContent = 'Debe seleccionar una Categoría.'; errEl.style.display = 'block'; document.getElementById('inv-categoria')?.focus(); return; }
  const idTipoArt2 = parseInt(document.getElementById('inv-tipo-articulo')?.value) || 0;
  if (!idTipoArt2) { errEl.textContent = 'Debe seleccionar un Tipo de Artículo.'; errEl.style.display = 'block'; document.getElementById('inv-tipo-articulo')?.focus(); return; }
  if (!codigo) { errEl.textContent = 'El código del artículo es obligatorio.'; errEl.style.display = 'block'; document.getElementById('inv-codigo')?.focus(); return; }
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; document.getElementById('inv-nombre')?.focus(); return; }
  if (!unidad) { errEl.textContent = 'La unidad de medida es obligatoria.'; errEl.style.display = 'block'; document.getElementById('inv-unidad')?.focus(); return; }
  const idCtaContable2 = parseInt(document.getElementById('inv-cuenta-contable')?.value) || 0;
  if (!idCtaContable2) { errEl.textContent = 'Debe seleccionar la Cuenta Contable Inventario (1.1.03.xxx).'; errEl.style.display = 'block'; document.getElementById('inv-cuenta-contable')?.focus(); return; }
  const idCtaCG2 = parseInt(document.getElementById('inv-cuenta-costo-gasto')?.value) || 0;
  if (!idCtaCG2) { errEl.textContent = 'Debe seleccionar la Cuenta Costo / Gasto de Inventario.'; errEl.style.display = 'block'; document.getElementById('inv-cuenta-costo-gasto')?.focus(); return; }

  const btnGuardar = document.getElementById('btn-guardar-inventario');
  const textoOriginalBtn = btnGuardar ? btnGuardar.textContent : 'GUARDAR';
  if (btnGuardar) { btnGuardar.textContent = 'GUARDANDO...'; btnGuardar.disabled = true; }

  try {
    // Validar código duplicado
    if (codigo) {
      let qDup = '?codigo_articulo=eq.' + encodeURIComponent(codigo) + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
      if (id) qDup += '&id_articulo=neq.' + id; // excluir el propio al editar
      const dup = await api('inventario_almacen','GET',null,qDup + '&select=id_articulo&limit=1');
      if (dup && dup.length) {
        errEl.textContent = 'Ya existe un artículo con el código "' + codigo + '". Usa un código diferente.';
        errEl.style.display = 'block';
        document.getElementById('inv-categoria')?.focus();
        return;
      }
    }
    const demandaAnual = parseInt(document.getElementById('inv-demanda-anual').value) || null;
    const leadTime     = parseInt(document.getElementById('inv-lead-time').value) || null;
    const costoPedido  = parseFloat(document.getElementById('inv-costo-pedido').value) || null;
    const stockSeg     = parseInt(document.getElementById('inv-stock-seg').value) || 0;
    const id_categoria    = parseInt(document.getElementById('inv-categoria')?.value) || null;
    const id_tipo_articulo = parseInt(document.getElementById('inv-tipo-articulo')?.value) || null;
    const ventaFinal     = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? venta : undefined;
    const datos = { nombre_articulo: nombre, descripcion_articulo: desc || null, codigo_articulo: codigo || null,
      ...(!id || puedo('INVENTARIO','CAMBIAR_ESTADO') || sesionActual?.administrador
        ? { estado: !id ? 'ACTIVO' : (document.getElementById('inv-estado')?.value || 'ACTIVO') } : {}),
      stock_minimo_articulo: stockMin, precio_costo_moneda: costo,
      id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null,
      ...(ventaFinal !== undefined ? { precio_venta_moneda: ventaFinal } : {}),
      unidad, id_categoria_articulo: id_categoria, id_tipo_articulo: id_tipo_articulo,
      id_cuenta_contable: parseInt(document.getElementById('inv-cuenta-contable')?.value) || null,
      id_cuenta_costo_gasto: parseInt(document.getElementById('inv-cuenta-costo-gasto')?.value) || null,
      demanda_anual: demandaAnual, lead_time_dias: leadTime, costo_pedido_usd: costoPedido, stock_seguridad: stockSeg,
      id_usuario: sesionActual.correo_usuario };
    // stock_actual_articulo es un campo heredado, congelado a propósito desde que el
    // stock real vive en inventario_stock_area — nunca se sobreescribe al editar.
    if (id) {
      await api('inventario_almacen', 'PATCH', datos, '?id_articulo=eq.' + id);
    } else {
      datos.stock_actual_articulo = 0; // se mantiene en 0; el stock real entra vía inventario_stock_area
      const nuevoArt = await api('inventario_almacen', 'POST', datos);
      const idNuevoArt = nuevoArt && nuevoArt[0] ? nuevoArt[0].id_articulo : null;
      if (idNuevoArt && stock > 0) {
        // Stock inicial declarado al crear el artículo — se asigna a Compras (área principal),
        // que es la única área que recibe stock directamente.
        const idAreaComprasNuevo = await obtenerIdAreaCompras();
        if (idAreaComprasNuevo) await upsertStockArea(idNuevoArt, idAreaComprasNuevo, stock);
      }
    }
    okEl.textContent = '✓ Artículo guardado.'; okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-inventario'); document.getElementById('contenido-principal').innerHTML=''; renderInventario(); }, 1000);
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
  finally { if (btnGuardar) { btnGuardar.textContent = textoOriginalBtn; btnGuardar.disabled = false; } }
}

async function eliminarInventario(id, nombre) {
  if (!puedo('INVENTARIO','ELIMINAR')) { alert('No tiene permiso para eliminar artículos.'); return; }
  try {
    const [entradas, salidas] = await Promise.all([
      api('stock_entradas', 'GET', null, '?id_articulo=eq.' + id + '&select=id_entrada&limit=1'),
      api('os_mercancias',   'GET', null, '?id_articulo=eq.' + id + '&select=id_os_mercancia&limit=1')
    ]);
    if (entradas && entradas.length > 0) {
      alert('No se puede eliminar "' + nombre + '" porque tiene entradas de stock registradas.');
      return;
    }
    if (salidas && salidas.length > 0) {
      alert('No se puede eliminar "' + nombre + '" porque tiene salidas en Órdenes de Servicio.');
      return;
    }
    if (!confirm('¿Eliminar "' + nombre + '"?\nEsta acción no se puede deshacer.')) return;
    await api('inventario_almacen', 'DELETE', null, '?id_articulo=eq.' + id);
    document.getElementById('contenido-principal').innerHTML = '';
    renderInventario();
  } catch(e) { alert('Error: ' + e.message); }
}

async function invRenderCategorias(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const cats = await api('inv_categorias','GET',null,'?id_empresa=eq.'+id_emisor+'&order=nombre.asc&select=*') || [];
    const filas = cats.map(function(c) {
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-family:var(--font-mono);color:var(--naranja);font-size:12px">'+(c.codigo||'—')+'</td>'
        +'<td style="padding:8px;font-size:13px;font-weight:500">'+c.nombre+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+(c.descripcion||'')+'</td>'
        +'<td style="padding:8px"><span class="badge '+(c.estado==='ACTIVO'?'badge-verde':'badge-rojo')+'">'+c.estado+'</span></td>'
        +'<td style="padding:8px"><button class="btn-naranja" onclick="invAbrirCategoria('+c.id_categoria+')" style="font-size:11px;padding:4px 10px">Ver</button></td>'
        +'</tr>';
    }).join('');
    cont.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="font-size:18px;font-weight:600">📦 Categorías de Inventario <span style="font-size:13px;color:var(--suave)">('+cats.length+')</span></div>'
      +'<button class="btn-primario" onclick="invAbrirCategoria(null)" style="font-size:12px">+ Nueva</button>'
      +'</div>'
      +'<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Código</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Nombre</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Descripción</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Estado</th>'
      +'<th style="padding:8px"></th>'
      +'</tr></thead><tbody>'+(filas||'<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--suave)">Sin categorías registradas</td></tr>')
      +'</tbody></table></div>';
  } catch(e) { cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>'; }
}

async function invAbrirCategoria(id) {
  let item = null;
  if (id) { const r = await api('inv_categorias','GET',null,'?id_categoria=eq.'+id)||[]; item=r[0]||null; }
  const html = '<div class="form-grid">'
    +'<div class="form-campo"><label>Código *</label><input type="text" id="icat-codigo" value="'+(item?.codigo||'')+'" placeholder="Ej: CAT-01" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Nombre *</label><input type="text" id="icat-nombre" value="'+(item?.nombre||'')+'" placeholder="Nombre de la categoría" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Descripción</label><textarea id="icat-desc" oninput="this.value=this.value.toUpperCase()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;resize:vertical;min-height:60px;width:100%;text-transform:uppercase">'+(item?.descripcion||'')+'</textarea></div>'
    +'<div class="form-campo form-full"><label>Estado</label><select id="icat-estado" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="ACTIVO"'+((!item||item.estado==="ACTIVO")?" selected":"")+'>Activo</option><option value="INACTIVO"'+(item?.estado==="INACTIVO"?" selected":"")+'>Inactivo</option></select></div>'
    +'</div><input type="hidden" id="icat-id" value="'+(id||'')+'">'
    +'<div class="alerta alerta-exito" id="icat-ok" style="margin-top:12px;display:none"></div>'
    +'<div class="alerta alerta-error" id="icat-err" style="margin-top:8px;display:none"></div>';
  document.getElementById('modal-param-titulo').textContent = id ? 'EDITAR CATEGORÍA' : 'NUEVA CATEGORÍA';
  document.getElementById('modal-param-body').innerHTML = html;
  document.getElementById('modal-param-footer-alertas').innerHTML = '';
  document.getElementById('modal-param-guardar').onclick = invGuardarCategoria;
  document.getElementById('modal-param-guardar').style.display = '';
  const btnElim = document.getElementById('modal-param-eliminar');
  if (btnElim) { btnElim.style.display = id ? '' : 'none'; window._paramKey='inv_categorias'; window._paramId=id; }
  abrirModal('modal-param');
  setTimeout(function(){ document.getElementById('icat-codigo')?.focus(); }, 100);
}

async function invGuardarCategoria() {
  const id=document.getElementById('icat-id').value, nombre=document.getElementById('icat-nombre')?.value.trim().toUpperCase();
  const codigo=document.getElementById('icat-codigo')?.value.trim().toUpperCase();
  const okEl=document.getElementById('icat-ok'), errEl=document.getElementById('icat-err');
  okEl.style.display='none'; errEl.style.display='none';
  if (!codigo) { errEl.textContent='El código es obligatorio.'; errEl.style.display='block'; document.getElementById('icat-codigo')?.focus(); return; }
  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl.style.display='block'; document.getElementById('icat-nombre')?.focus(); return; }
  const datos = { nombre, estado:document.getElementById('icat-estado')?.value||'ACTIVO',
    codigo:codigo||null,
    descripcion:document.getElementById('icat-desc')?.value.trim().toUpperCase()||null, id_empresa:_empresaActiva?.id_empresa||null };
  try {
    if (id) await api('inv_categorias','PATCH',datos,'?id_categoria=eq.'+id);
    else    await api('inv_categorias','POST',datos);
    _invCategoriasCache=[];
    okEl.textContent='✓ Categoría '+(id?'actualizada':'creada')+'.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-param'); invRenderCategorias(); }, 900);
  } catch(e) { errEl.textContent='Error: '+e.message; errEl.style.display='block'; }
}

async function invRenderTipos(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const [tipos, cats] = await Promise.all([
      api('inv_articulos_tipo','GET',null,'?id_empresa=eq.'+id_emisor+'&order=nombre.asc&select=*'),
      api('inv_categorias','GET',null,'?id_empresa=eq.'+id_emisor+'&select=id_categoria,nombre,codigo'),
    ]);
    const catsMap = {}; (cats||[]).forEach(function(c){ catsMap[c.id_categoria]=c; });
    const filas = (tipos||[]).map(function(t) {
      const cat=catsMap[t.id_categoria];
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-family:var(--font-mono);color:var(--naranja);font-size:12px">'+(t.codigo||'—')+'</td>'
        +'<td style="padding:8px;font-size:13px;font-weight:500">'+t.nombre+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+(cat?(cat.codigo?cat.codigo+' — ':'')+cat.nombre:'—')+'</td>'
        +'<td style="padding:8px"><span class="badge '+(t.estado==='ACTIVO'?'badge-verde':'badge-rojo')+'">'+t.estado+'</span></td>'
        +'<td style="padding:8px"><button class="btn-naranja" onclick="invAbrirTipo('+t.id_tipo+')" style="font-size:11px;padding:4px 10px">Ver</button></td>'
        +'</tr>';
    }).join('');
    cont.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="font-size:18px;font-weight:600">🔩 Tipos de Artículo <span style="font-size:13px;color:var(--suave)">('+(tipos?.length||0)+')</span></div>'
      +'<button class="btn-primario" onclick="invAbrirTipo(null)" style="font-size:12px">+ Nuevo</button>'
      +'</div>'
      +'<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Código</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Nombre</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Categoría</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Estado</th>'
      +'<th style="padding:8px"></th>'
      +'</tr></thead><tbody>'+(filas||'<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--suave)">Sin tipos registrados</td></tr>')
      +'</tbody></table></div>';
  } catch(e) { cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>'; }
}

// Lista las Entradas de Compra con estado_aprobacion = 'PENDIENTE' -- con
// botones reales de Aprobar/Rechazar. Solo Compras a Proveedor pasan por
// aquí (Devolución/Ajuste/Transferencia siguen ejecutándose de inmediato,
// sin necesitar aprobación).
async function invRenderAprobacionesPendientes(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const pendientes = await api('stock_entradas','GET',null,
      '?motivo=eq.compra&estado_aprobacion=eq.PENDIENTE&order=fecha_registro.asc'
      +'&select=id_entrada,id_articulo,cantidad,fecha_negociacion,monto_total_con_iva,moneda_compra,esquema_pago,id_usuario,id_proveedor') || [];
    if (!pendientes.length) {
      cont.innerHTML = '<div style="text-align:center;color:var(--suave);padding:40px">✅ No hay Entradas de Compra pendientes de aprobación.</div>';
      return;
    }
    const idsArt = [...new Set(pendientes.map(function(p){ return p.id_articulo; }))];
    const idsProv = [...new Set(pendientes.map(function(p){ return p.id_proveedor; }).filter(Boolean))];
    const [arts, provs] = await Promise.all([
      idsArt.length ? api('inventario_almacen','GET',null,'?id_articulo=in.('+idsArt.join(',')+')&select=id_articulo,nombre_articulo,codigo_articulo') : Promise.resolve([]),
      idsProv.length ? api('proveedores','GET',null,'?id_proveedor=in.('+idsProv.join(',')+')&select=id_proveedor,nombre') : Promise.resolve([]),
    ]);
    const artMap = {}; (arts||[]).forEach(function(a){ artMap[a.id_articulo] = a; });
    const provMap = {}; (provs||[]).forEach(function(p){ provMap[p.id_proveedor] = p.nombre; });

    const filas = pendientes.map(function(p) {
      const art = artMap[p.id_articulo];
      const nomArt = art ? (art.codigo_articulo ? art.codigo_articulo+' — ' : '') + art.nombre_articulo : ('Art#'+p.id_articulo);
      const nomProv = provMap[p.id_proveedor] || '—';
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-size:12px">'+formatearFechaCorta(p.fecha_negociacion)+'</td>'
        +'<td style="padding:8px;font-size:12px">'+nomArt+'</td>'
        +'<td style="padding:8px;text-align:right;font-family:var(--font-mono);font-size:12px">'+p.cantidad+'</td>'
        +'<td style="padding:8px;font-size:12px">'+nomProv+'</td>'
        +'<td style="padding:8px;text-align:right;font-family:var(--font-mono);font-weight:600;color:var(--naranja)">$ '+fmtUSD(p.monto_total_con_iva)+'</td>'
        +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+(p.esquema_pago||'—')+'</td>'
        +'<td style="padding:8px;white-space:nowrap">'
        +'<button class="btn-naranja" onclick="aprobarEntradaCompra('+p.id_entrada+')" style="font-size:11px;padding:4px 10px;margin-right:6px">✓ Aprobar</button>'
        +'<button class="btn-secundario" style="border-color:rgba(252,129,129,0.4);color:#fc8181" onclick="rechazarEntradaCompra('+p.id_entrada+')">✕ Rechazar</button>'
        +'</td></tr>';
    }).join('');

    cont.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Fecha</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
      +'<th style="padding:8px;text-align:right;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Cant.</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Proveedor</th>'
      +'<th style="padding:8px;text-align:right;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Monto</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Pago</th>'
      +'<th style="padding:8px"></th>'
      +'</tr></thead><tbody>'+filas+'</tbody></table></div>';
  } catch(e) { cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>'; }
}

async function rechazarEntradaCompra(id_entrada) {
  if (!sesionActual?.administrador && !puedo('PAGOS','APROBAR')) {
    alert('No tiene permiso para rechazar Entradas de Compra.'); return;
  }
  const motivo = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8;text-align:center">Rechazar Entrada de Compra</div>'
      + '<label style="font-size:12px;color:#999;display:block;margin-bottom:4px">Motivo del rechazo *</label>'
      + '<textarea id="dlg-rechazo-ent-motivo" rows="3" placeholder="Explique por qué se rechaza esta Entrada..." style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:12px;resize:vertical;font-family:inherit"></textarea>'
      + '<div id="dlg-rechazo-ent-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-confirm-ent-si" style="background:#fc8181;border:none;color:#1a1a1a;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Rechazar</button>'
      + '<button id="btn-confirm-ent-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const motivoEl = div.querySelector('#dlg-rechazo-ent-motivo');
    const errEl = div.querySelector('#dlg-rechazo-ent-err');
    motivoEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-confirm-ent-si').onclick = function() {
      const val = motivoEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese el motivo del rechazo.'; errEl.style.display = 'block'; return; }
      cerrar(val);
    };
    div.querySelector('#btn-confirm-ent-no').onclick = function() { cerrar(null); };
  });
  if (!motivo) return;

  try {
    const entRows = await api('stock_entradas','GET',null,'?id_entrada=eq.'+id_entrada);
    const m = entRows && entRows[0] ? entRows[0] : null;
    if (!m) { alert('No se encontró la Entrada.'); return; }
    if (m.estado_aprobacion !== 'PENDIENTE') {
      alert('Esta Entrada ya no está pendiente de aprobación (estado actual: ' + (m.estado_aprobacion || '—') + ').');
      return;
    }
    await api('stock_entradas','PATCH',{
      estado_aprobacion: 'RECHAZADA',
      motivo_rechazo: motivo
    },'?id_entrada=eq.'+id_entrada);

    if (m.id_usuario) {
      try {
        await api('notificaciones','POST',{
          correo_destino: m.id_usuario,
          titulo: 'Entrada de Compra Rechazada',
          mensaje: 'Tu Entrada de Compra "ENT-'+id_entrada+'" fue rechazada por '+(sesionActual?.nombre || sesionActual?.correo_usuario || 'un supervisor')+'. Motivo: '+motivo+'. Corríjala y vuelva a guardarla para que se reenvíe a aprobación.',
          estado: 'PENDIENTE',
          fecha_creacion: new Date().toISOString(),
          datos_extra: JSON.stringify({ id_entrada: id_entrada, accion: 'ver_rechazo' })
        }, '', true);
      } catch(eNotifRechEnt) { console.warn('Error notificando rechazo de Entrada:', eNotifRechEnt); }
    }
    alert('Entrada rechazada.');
    renderInventario();
  } catch(e) {
    alert('Error al rechazar la Entrada: ' + e.message);
  }
}

async function invRenderMargenBruto(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const hoy = new Date().toISOString().slice(0,10);
    const [tipos, cats, margenesTodos] = await Promise.all([
      api('inv_articulos_tipo','GET',null,'?id_empresa=eq.'+id_emisor+'&estado=eq.ACTIVO&order=nombre.asc&select=*'),
      api('inv_categorias','GET',null,'?id_empresa=eq.'+id_emisor+'&select=id_categoria,nombre,codigo'),
      api('param_margen_bruto','GET',null,'?id_empresa=eq.'+id_emisor+'&order=fecha_vigencia_desde.desc,id.desc&select=*'),
    ]);
    _invMargenBrutoCache = margenesTodos || [];
    const margenes = _invMargenBrutoCache.filter(function(m){ return m.fecha_vigencia_desde <= hoy && m.estado !== 'ANULADO'; });
    const catsMap = {}; (cats||[]).forEach(function(c){ catsMap[c.id_categoria]=c; });
    // El vigente de cada Tipo es el de fecha_vigencia_desde más reciente
    // (ya viene ordenado desc, así que basta con quedarse con el primero
    // que aparezca por id_tipo_articulo).
    const vigenteMap = {};
    (margenes||[]).forEach(function(m) {
      if (!vigenteMap[m.id_tipo_articulo]) vigenteMap[m.id_tipo_articulo] = m;
    });
    const filas = (tipos||[]).map(function(t) {
      const cat = catsMap[t.id_categoria];
      const vig = vigenteMap[t.id_tipo];
      const margenTxt = vig ? parseFloat(vig.margen_pct).toFixed(2)+'%' : '0.00% <span style="color:var(--suave);font-size:11px">(sin definir)</span>';
      const vigDesdeTxt = vig ? formatearFechaCorta(vig.fecha_vigencia_desde) : '—';
      const tieneHistorial = _invMargenBrutoCache.some(function(m){ return m.id_tipo_articulo===t.id_tipo; });
      const puedeDefinir = sesionActual?.administrador || puedo('INVENTARIO','DEFINIR_MARGEN_BRUTO');
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+(cat?(cat.codigo?cat.codigo+' — ':'')+cat.nombre:'—')+'</td>'
        +'<td style="padding:8px;font-size:13px;font-weight:500">'+(t.codigo?t.codigo+' — ':'')+t.nombre+'</td>'
        +'<td style="padding:8px;font-family:var(--font-mono);font-weight:600;color:'+(vig?'#22c55e':'var(--suave)')+'">'+margenTxt+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+vigDesdeTxt+'</td>'
        +'<td style="padding:8px;white-space:nowrap">'
        +(puedeDefinir?'<button class="btn-naranja" onclick="abrirDefinirMargen('+t.id_tipo+',\''+t.nombre.replace(/'/g,"\\'")+'\')" style="font-size:11px;padding:4px 10px;margin-right:6px">Definir/Cambiar</button>':'')
        +(tieneHistorial?'<button class="btn-secundario" onclick="verHistorialMargen('+t.id_tipo+',\''+t.nombre.replace(/'/g,"\\'")+'\')" style="font-size:11px;padding:4px 10px">Ver historial</button>':'')
        +'</td>'
        +'</tr>';
    }).join('');
    cont.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="font-size:18px;font-weight:600">📊 Margen Bruto % por Tipo de Artículo <span style="font-size:13px;color:var(--suave)">('+(tipos?.length||0)+')</span></div>'
      +'</div>'
      +'<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Categoría</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Tipo de Artículo</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Margen Vigente</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Vigente desde</th>'
      +'<th style="padding:8px"></th>'
      +'</tr></thead><tbody>'+(filas||'<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--suave)">Sin Tipos de Artículo registrados</td></tr>')
      +'</tbody></table></div>';
  } catch(e) { cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>'; }
}

let _invMargenBrutoCache = [];

function abrirDefinirMargen(id_tipo, nombreTipo) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','DEFINIR_MARGEN_BRUTO')) {
    alert('No tiene permiso para definir el Margen Bruto.'); return;
  }
  document.getElementById('margen-id-tipo').value = id_tipo;
  document.getElementById('margen-tipo-nombre').textContent = nombreTipo || '—';
  document.getElementById('margen-pct').value = '';
  document.getElementById('margen-fecha').value = new Date().toISOString().slice(0,10);
  document.getElementById('alerta-margen-ok').style.display = 'none';
  document.getElementById('alerta-margen-err').style.display = 'none';
  abrirModal('modal-definir-margen');
}

async function guardarMargenBruto() {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','DEFINIR_MARGEN_BRUTO')) {
    alert('No tiene permiso para definir el Margen Bruto.'); return;
  }
  const errEl = document.getElementById('alerta-margen-err');
  const okEl = document.getElementById('alerta-margen-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  const id_tipo_articulo = parseInt(document.getElementById('margen-id-tipo').value) || null;
  const margen_pct = parseFloat(document.getElementById('margen-pct').value);
  const fecha_vigencia_desde = document.getElementById('margen-fecha').value;
  if (!id_tipo_articulo) { errEl.textContent = 'Falta el Tipo de Artículo.'; errEl.style.display = 'block'; return; }
  if (isNaN(margen_pct) || margen_pct < 0) { errEl.textContent = 'Ingrese un % de Margen válido (0 o mayor).'; errEl.style.display = 'block'; document.getElementById('margen-pct')?.focus(); return; }
  if (!fecha_vigencia_desde) { errEl.textContent = 'Seleccione la Fecha de Vigencia.'; errEl.style.display = 'block'; document.getElementById('margen-fecha')?.focus(); return; }
  // Ya existe una restricción UNIQUE en la base (id_empresa, id_tipo_articulo,
  // fecha_vigencia_desde) -- esta validación es solo para mostrar un mensaje
  // amigable en vez del error crudo de Postgres si de todos modos se llega
  // a intentar (p.ej. caché desactualizada del historial en pantalla).
  const yaExiste = (_invMargenBrutoCache||[]).some(function(m) {
    return m.id_tipo_articulo === id_tipo_articulo && m.fecha_vigencia_desde === fecha_vigencia_desde;
  });
  if (yaExiste) {
    errEl.textContent = 'Ya existe un Margen registrado para este Tipo con esa misma Fecha de Vigencia. Elija otra fecha, o edite el valor existente desde "Ver historial".';
    errEl.style.display = 'block';
    document.getElementById('margen-fecha')?.focus();
    return;
  }
  try {
    await api('param_margen_bruto', 'POST', {
      id_empresa: _empresaActiva?.id_empresa || null,
      id_tipo_articulo: id_tipo_articulo,
      margen_pct: margen_pct,
      fecha_vigencia_desde: fecha_vigencia_desde,
      id_usuario: sesionActual?.correo_usuario || null,
    });
    okEl.textContent = '✓ Margen registrado correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-definir-margen');
      invRenderMargenBruto();
    }, 900);
  } catch(e) {
    const msgDuplicado = (e.message || '').indexOf('margen_bruto_unico') !== -1 || (e.message || '').indexOf('duplicate') !== -1;
    errEl.textContent = msgDuplicado
      ? 'Ya existe un Margen registrado para este Tipo con esa misma Fecha de Vigencia.'
      : 'Error al guardar: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function verHistorialMargen(id_tipo, nombreTipo) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_MARGEN_BRUTO')) {
    alert('No tiene permiso para ver el Historial de Margen Bruto.'); return;
  }
  const filas = (_invMargenBrutoCache||[]).filter(function(m){ return m.id_tipo_articulo===id_tipo; });
  const tituloEl = document.getElementById('historial-margen-titulo');
  if (tituloEl) tituloEl.textContent = '📜 Historial de Margen — ' + (nombreTipo || '');
  const cont = document.getElementById('historial-margen-cont');
  if (!filas.length) {
    cont.innerHTML = '<div style="text-align:center;padding:24px;color:var(--suave)">Sin historial registrado para este Tipo.</div>';
  } else {
    // La fila corregible es la ACTIVO más reciente (filas ya viene ordenado
    // por fecha_vigencia_desde desc, id desc desde invRenderMargenBruto) --
    // solo esa puede "Corregirse"; una ya reemplazada o ya anulada, no.
    const idMasRecienteActivo = (filas.find(function(m){ return m.estado !== 'ANULADO'; }) || {}).id;
    cont.innerHTML = '<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:100px">Vigente desde</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:80px">Margen %</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Registrado por</th>'
      +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:80px">Estado</th>'
      +'<th style="padding:8px;width:110px"></th>'
      +'</tr></thead><tbody>'
      + filas.map(function(m) {
        const anulado = m.estado === 'ANULADO';
        const styleTachado = anulado ? 'text-decoration:line-through;opacity:0.55' : '';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px;'+styleTachado+'">'+formatearFechaCorta(m.fecha_vigencia_desde)+'</td>'
          +'<td style="padding:8px;font-family:var(--font-mono);font-weight:600;'+styleTachado+'">'+parseFloat(m.margen_pct).toFixed(2)+'%</td>'
          +'<td style="padding:8px;font-size:12px;color:var(--suave);'+styleTachado+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(m.id_usuario||'')+'">'+(m.id_usuario||'—')+'</td>'
          +'<td style="padding:8px"><span class="badge '+(anulado?'badge-rojo':'badge-verde')+'" style="font-size:10px">'+(anulado?'ANULADO':'ACTIVO')+'</span></td>'
          +'<td style="padding:8px">'+(m.id===idMasRecienteActivo && (sesionActual?.administrador || puedo('INVENTARIO','CORREGIR_MARGEN_BRUTO'))
              ? '<button class="btn-naranja" onclick="abrirCorregirMargen('+m.id+','+m.id_tipo_articulo+',\''+(nombreTipo||'').replace(/'/g,"\\'")+'\','+parseFloat(m.margen_pct)+')" style="font-size:11px;padding:4px 10px">✏ Corregir</button>'
              : '')+'</td>'
          +'</tr>';
      }).join('')
      +'</tbody></table>';
  }
  abrirModal('modal-historial-margen');
}

function abrirCorregirMargen(idViejo, id_tipo, nombreTipo, valorViejo) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','CORREGIR_MARGEN_BRUTO')) {
    alert('No tiene permiso para corregir el Margen Bruto.'); return;
  }
  // Blindaje: revalidar que esta fila SIGUE siendo la más reciente activa --
  // por si el Historial en pantalla quedó desactualizado (otra persona
  // pudo haber agregado un valor más nuevo mientras se tenía este modal
  // abierto).
  const filasVigentes = (_invMargenBrutoCache||[])
    .filter(function(m){ return m.id_tipo_articulo===id_tipo && m.estado !== 'ANULADO'; });
  const masReciente = filasVigentes[0]; // ya viene ordenado desc desde la carga
  if (!masReciente || masReciente.id !== idViejo) {
    alert('No se puede corregir este registro: ya existe un valor más reciente que lo reemplazó. Actualice el Historial e inténtelo de nuevo si hace falta.');
    return;
  }
  document.getElementById('corregir-margen-id-viejo').value = idViejo;
  document.getElementById('corregir-margen-id-tipo').value = id_tipo;
  document.getElementById('corregir-margen-tipo-nombre').textContent = nombreTipo || '—';
  document.getElementById('corregir-margen-valor-viejo').textContent = parseFloat(valorViejo).toFixed(2) + '%';
  document.getElementById('corregir-margen-pct').value = '';
  document.getElementById('corregir-margen-clave').value = '';
  document.getElementById('alerta-corregir-margen-ok').style.display = 'none';
  document.getElementById('alerta-corregir-margen-err').style.display = 'none';
  cerrarModal('modal-historial-margen');
  abrirModal('modal-corregir-margen');
}

async function guardarCorreccionMargen() {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','CORREGIR_MARGEN_BRUTO')) {
    alert('No tiene permiso para corregir el Margen Bruto.'); return;
  }
  const errEl = document.getElementById('alerta-corregir-margen-err');
  const okEl = document.getElementById('alerta-corregir-margen-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  const idViejo = parseInt(document.getElementById('corregir-margen-id-viejo').value) || null;
  const id_tipo = parseInt(document.getElementById('corregir-margen-id-tipo').value) || null;
  const nuevoPct = parseFloat(document.getElementById('corregir-margen-pct').value);
  const clave = document.getElementById('corregir-margen-clave').value || '';
  if (!idViejo || !id_tipo) { errEl.textContent = 'Faltan datos del registro a corregir.'; errEl.style.display = 'block'; return; }
  if (isNaN(nuevoPct) || nuevoPct < 0) { errEl.textContent = 'Ingrese un % de Margen válido (0 o mayor).'; errEl.style.display = 'block'; document.getElementById('corregir-margen-pct')?.focus(); return; }
  if (!clave) { errEl.textContent = 'Ingrese su contraseña para confirmar la corrección.'; errEl.style.display = 'block'; document.getElementById('corregir-margen-clave')?.focus(); return; }
  try {
    const verif = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verif.ok) { errEl.textContent = verif.msg || 'Contraseña incorrecta.'; errEl.style.display = 'block'; return; }

    // Revalidación fresca (defensa en profundidad): confirmar en la base,
    // justo antes de escribir, que esta sigue siendo la ACTIVO más
    // reciente para este Tipo.
    const freschChk = await api('param_margen_bruto','GET',null,
      '?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&id_tipo_articulo=eq.'+id_tipo
      +'&estado=neq.ANULADO&order=fecha_vigencia_desde.desc,id.desc&limit=1&select=id');
    if (!freschChk || !freschChk[0] || freschChk[0].id !== idViejo) {
      errEl.textContent = 'No se puede corregir: ya existe un valor más reciente que lo reemplazó.';
      errEl.style.display = 'block';
      return;
    }

    const hoy = new Date().toISOString().slice(0,10);
    await api('param_margen_bruto', 'PATCH', { estado: 'ANULADO' }, '?id=eq.'+idViejo);
    await api('param_margen_bruto', 'POST', {
      id_empresa: _empresaActiva?.id_empresa || null,
      id_tipo_articulo: id_tipo,
      margen_pct: nuevoPct,
      fecha_vigencia_desde: hoy,
      id_usuario: sesionActual?.correo_usuario || null,
      estado: 'ACTIVO',
    });
    okEl.textContent = '✓ Corrección aplicada correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-corregir-margen');
      invRenderMargenBruto();
    }, 900);
  } catch(e) {
    errEl.textContent = 'Error al corregir: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function invAbrirTipo(id) {
  const id_emisor = _empresaActiva?.id_empresa || 0;
  let item = null;
  if (id) { const r=await api('inv_articulos_tipo','GET',null,'?id_tipo=eq.'+id)||[]; item=r[0]||null; }
  const cats = await api('inv_categorias','GET',null,'?estado=eq.ACTIVO&id_empresa=eq.'+id_emisor+'&order=nombre.asc')||[];
  const opcCats = cats.map(function(c) {
    return '<option value="'+c.id_categoria+'"'+(item?.id_categoria===c.id_categoria?' selected':'')+'>'+
      (c.codigo?c.codigo+' — ':'')+c.nombre+'</option>';
  }).join('');
  const html = '<div class="form-grid">'
    +'<div class="form-campo"><label>Código *</label><input type="text" id="itipo-codigo" value="'+(item?.codigo||'')+'" placeholder="Ej: TIPO-01" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Nombre *</label><input type="text" id="itipo-nombre" value="'+(item?.nombre||'')+'" placeholder="Nombre del tipo" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Categoría *</label><select id="itipo-categoria" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="">— Seleccionar —</option>'+opcCats+'</select></div>'
    +'<div class="form-campo form-full"><label>Descripción</label><textarea id="itipo-desc" oninput="this.value=this.value.toUpperCase()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;resize:vertical;min-height:60px;width:100%;text-transform:uppercase">'+(item?.descripcion||'')+'</textarea></div>'
    +'<div class="form-campo form-full"><label>Estado</label><select id="itipo-estado" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="ACTIVO"'+((!item||item.estado==="ACTIVO")?" selected":"")+'>Activo</option><option value="INACTIVO"'+(item?.estado==="INACTIVO"?" selected":"")+'>Inactivo</option></select></div>'
    +'</div><input type="hidden" id="itipo-id" value="'+(id||'')+'">'
    +'<div class="alerta alerta-exito" id="itipo-ok" style="margin-top:12px;display:none"></div>'
    +'<div class="alerta alerta-error" id="itipo-err" style="margin-top:8px;display:none"></div>';
  document.getElementById('modal-param-titulo').textContent = id ? 'EDITAR TIPO' : 'NUEVO TIPO';
  document.getElementById('modal-param-body').innerHTML = html;
  document.getElementById('modal-param-footer-alertas').innerHTML = '';
  document.getElementById('modal-param-guardar').onclick = invGuardarTipo;
  document.getElementById('modal-param-guardar').style.display = '';
  const btnElim = document.getElementById('modal-param-eliminar');
  if (btnElim) { btnElim.style.display = id ? '' : 'none'; window._paramKey='inv_articulos_tipo'; window._paramId=id; }
  abrirModal('modal-param');
  setTimeout(function(){ document.getElementById('itipo-codigo')?.focus(); }, 100);
}

async function invGuardarTipo() {
  const id=document.getElementById('itipo-id').value, nombre=document.getElementById('itipo-nombre')?.value.trim().toUpperCase();
  const codigoTipo=document.getElementById('itipo-codigo')?.value.trim().toUpperCase();
  const catId=parseInt(document.getElementById('itipo-categoria')?.value)||null;
  const okEl=document.getElementById('itipo-ok'), errEl=document.getElementById('itipo-err');
  okEl.style.display='none'; errEl.style.display='none';
  if (!codigoTipo) { errEl.textContent='El código es obligatorio.'; errEl.style.display='block'; document.getElementById('itipo-codigo')?.focus(); return; }
  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl.style.display='block'; document.getElementById('itipo-nombre')?.focus(); return; }
  if (!catId)  { errEl.textContent='Debe seleccionar una categoría.'; errEl.style.display='block'; document.getElementById('itipo-categoria')?.focus(); return; }
  const datos = { nombre, id_categoria:catId, estado:document.getElementById('itipo-estado')?.value||'ACTIVO',
    codigo:codigoTipo||null,
    descripcion:document.getElementById('itipo-desc')?.value.trim().toUpperCase()||null, id_empresa:_empresaActiva?.id_empresa||null };
  try {
    if (id) await api('inv_articulos_tipo','PATCH',datos,'?id_tipo=eq.'+id);
    else    await api('inv_articulos_tipo','POST',datos);
    okEl.textContent='✓ Tipo '+(id?'actualizado':'creado')+'.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-param'); invRenderTipos(); }, 900);
  } catch(e) { errEl.textContent='Error: '+e.message; errEl.style.display='block'; }
}

async function invRenderMovimientos(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;

  const hoy = new Date();
  const primerDia = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0') + '-01';
  const ultimoDia = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0') + '-' + String(new Date(hoy.getFullYear(),hoy.getMonth()+1,0).getDate()).padStart(2,'0');
  const INP = 'background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:7px 10px;border-radius:5px;font-size:12px;height:33px;box-sizing:border-box';
  const INP_FECHA = INP + ';font-size:12px !important;font-weight:400 !important;padding:7px 10px !important;height:33px !important;box-sizing:border-box !important';

  cont.innerHTML =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Desde</label>'
    + '<input type="date" id="mov-desde" value="' + primerDia + '" onchange="invCargarMovimientos()" style="' + INP_FECHA + '"></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Hasta</label>'
    + '<input type="date" id="mov-hasta" value="' + ultimoDia + '" onchange="invCargarMovimientos()" style="' + INP_FECHA + '"></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Agrupar por</label>'
    + '<select id="mov-agrup" onchange="invCargarMovimientos()" style="' + INP + '">'
    + '<option value="movimientos">Movimientos</option>'
    + '<option value="categoria">Por Categoría</option>'
    + '<option value="area">Por Área</option>'
    + '<option value="articulo">Por Artículo</option>'
    + '<option value="proveedor">Por Proveedor</option>'
    + '<option value="rotacion">Rotación</option>'
    + '<option value="saldo_area">Movimiento Neto del Período (por Área)</option>'
    + '<option value="saldo_actual">Saldo Actual por Área</option>'
    + '</select></div>'
    + '<div id="mov-filtro-tipo-cont"><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Tipo</label>'
    + '<select id="mov-tipo" onchange="invCargarMovimientos()" style="' + INP + '">'
    + '<option value="">Todos</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option>'
    + '</select></div>'
    + '<div id="mov-filtro-art-cont"><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Artículo</label>'
    + '<input type="text" id="mov-articulo" placeholder="Buscar artículo..." onkeyup="invCargarMovimientos()" style="' + INP + ';min-width:160px"></div>'
    + '</div>'
    + '<div id="mov-resultado"><div style="text-align:center;color:var(--suave);padding:40px">Cargando...</div></div>';

  await invCargarMovimientos();
}

async function invCargarMovimientos() {
  const res   = document.getElementById('mov-resultado');
  const desde = document.getElementById('mov-desde')?.value;
  const hasta = document.getElementById('mov-hasta')?.value;
  const agrup = document.getElementById('mov-agrup')?.value || 'movimientos';
  const tipo  = document.getElementById('mov-tipo')?.value || '';
  const busq  = (document.getElementById('mov-articulo')?.value || '').trim().toLowerCase();
  if (!res) return;

  res.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const monedaRef = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const simRef    = monedaRef === 'USD' ? '$' : monedaRef;

    // Cargar cache si está vacío
    if (!inventarioCache || !inventarioCache.length) {
      const arts = await api('inventario_almacen','GET',null,'?estado=eq.ACTIVO&id_empresa=eq.'+id_emisor+'&select=*&order=nombre_articulo.asc');
      if (arts) inventarioCache = arts;
    }
    const idsArticulos = inventarioCache.map(function(x){ return x.id_articulo; });
    if (!idsArticulos.length) { res.innerHTML = '<div style="text-align:center;color:var(--suave);padding:40px">Sin artículos registrados.</div>'; return; }
    const inClause = idsArticulos.join(',');

    // Cargar entradas y salidas según filtro
    // Filtrar por área si el usuario no tiene VER_INVENTARIO_GENERAL
    let id_areaMovs = null;
    let id_areaMovsNombre = null;
    if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) {
      try {
        const correo = sesionActual?.correo_usuario;
        const empRes = correo ? await api('empleados','GET',null,
          '?correo=eq.'+encodeURIComponent(correo)+'&select=id_area,param_areas(nombre,codigo)&limit=1') : [];
        id_areaMovs = empRes?.[0]?.id_area || null;
        id_areaMovsNombre = empRes?.[0]?.param_areas
          ? empRes[0].param_areas.nombre + (empRes[0].param_areas.codigo ? ' (' + empRes[0].param_areas.codigo + ')' : '')
          : null;
      } catch(e) {}
    }

    let entradas = [], salidas = [];
    if (!tipo || tipo === 'ENTRADA') {
      let qE = '?id_articulo=in.('+inClause+')&order=fecha_entrada.desc&select=*,area_receptora:id_area(nombre,codigo),area_origen:id_area_origen(nombre,codigo),proveedor:id_proveedor(nombre)';
      if (desde) qE += '&fecha_entrada=gte.'+desde;
      if (hasta) qE += '&fecha_entrada=lte.'+hasta;
      // Para operador de área: entradas directas a su área + salidas recibidas
      if (id_areaMovs) qE += '&id_area=eq.'+id_areaMovs;
      entradas = await api('stock_entradas','GET',null,qE) || [];
    }
    if (!tipo || tipo === 'SALIDA') {
      let qS = '?id_articulo=in.('+inClause+')&order=fecha_salida.desc&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo)';
      if (desde) qS += '&fecha_salida=gte.'+desde;
      if (hasta) qS += '&fecha_salida=lte.'+hasta;
      // Para operador de área: salidas recibidas O enviadas desde su área
      if (id_areaMovs) qS += '&or=(id_area.eq.'+id_areaMovs+',id_area_entrega.eq.'+id_areaMovs+')';
      salidas = await api('stock_salidas','GET',null,qS) || [];
    }

    // Helper para obtener artículo del cache
    const getArt = function(id) { return inventarioCache.find(function(x){ return x.id_articulo === id; }); };
    const artNom = function(a)  { return a ? a.nombre_articulo+(a.codigo_articulo?' ('+a.codigo_articulo+')':'') : '—'; };

    // Movimientos anulados excluidos de TODAS las vistas de resumen/totales
    // (área, categoría, artículo, proveedor, rotación, saldo por área) --
    // solo la lista cronológica "Movimientos" los sigue mostrando, marcados
    // con "REV", porque ahí sí interesa ver que existieron aunque ya no
    // cuenten. Antes se sumaban igual en los totales, inflando los saldos.
    const entradasValidas = entradas.filter(function(e){ return !e.anulada; });
    const salidasValidas  = salidas.filter(function(s){ return !s.anulada; });
    // Para cálculos de SALDO (no de actividad/volumen): una Transferencia
    // genera DOS registros para el mismo movimiento real -- una Entrada
    // (lado receptor) y una Salida "espejo" (lado origen), ambas marcadas
    // [TRANSFERENCIA]. Sumar ambas duplica el efecto (ya lo capta la
    // Entrada). Se excluyen aquí, mismo criterio que ya usa el Historial.
    const salidasSinTransferencia = salidasValidas.filter(function(s){
      return (s.observaciones||'').indexOf('[TRANSFERENCIA]') === -1;
    });

    // ── VISTAS ────────────────────────────────────────────────
    if (agrup === 'movimientos') {
      // Lista cronológica
      const movs = [];
      entradas.forEach(function(e) {
        const art = getArt(e.id_articulo);
        if (busq && !artNom(art).toLowerCase().includes(busq)) return;
        const motivo = e.id_proveedor ? 'Compra' : (e.id_area_origen ? 'Transferencia' : (e.cliente_nombre ? 'Devolución' : 'Ajuste'));
        movs.push({ tipo:'ENTRADA', fecha:e.fecha_entrada, art:artNom(art),
          origen: e.area_origen ? e.area_origen.nombre+(e.area_origen.codigo?' ('+e.area_origen.codigo+')':'') : (e.proveedor?e.proveedor.nombre:(e.cliente_nombre||'—')),
          destino: e.area_receptora ? e.area_receptora.nombre+(e.area_receptora.codigo?' ('+e.area_receptora.codigo+')':'') : '—',
          motivo:motivo, cant:e.cantidad, costo:e.precio_costo_moneda||0, moneda:e.moneda_compra||monedaRef, rev:e.anulada });
      });
      salidas.forEach(function(s) {
        const art = getArt(s.id_articulo);
        if (busq && !artNom(art).toLowerCase().includes(busq)) return;
        movs.push({ tipo:'SALIDA', fecha:s.fecha_salida, art:artNom(art),
          origen: s.area_entrega ? s.area_entrega.nombre+(s.area_entrega.codigo?' ('+s.area_entrega.codigo+')':'') : '—',
          destino: s.area_receptora ? s.area_receptora.nombre+(s.area_receptora.codigo?' ('+s.area_receptora.codigo+')':'') : '—',
          motivo:'Salida interna', cant:s.cantidad, costo:0, moneda:'', rev:s.anulada });
      });
      movs.sort(function(a,b){ return b.fecha>a.fecha?1:b.fecha<a.fecha?-1:0; });
      if (!movs.length) { res.innerHTML='<div style="text-align:center;color:var(--suave);padding:40px">Sin movimientos en el período.</div>'; return; }
      const colC = puedo('INVENTARIO','VER_COSTOS') ? '<th style="text-align:right;padding:4px 7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:100px">Costo</th>' : '';
      res.innerHTML = '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 360px));overflow-y:auto"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>'
        + '<th style="padding:4px 7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:90px">Fecha</th>'
        + '<th style="padding:4px 7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
        + '<th style="text-align:right;padding:4px 7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:56px">Cant.</th>'
        + '<th style="padding:4px 7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Origen</th>'
        + '<th style="padding:4px 7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Destino</th>'
        + '<th style="padding:4px 7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde);width:110px">Motivo</th>'
        + colC + '</tr></thead><tbody>'
        + movs.map(function(m) {
            const eE=m.tipo==='ENTRADA', c=eE?'#22c55e':'#fc8181';
            const badge='<span style="background:'+(eE?'rgba(34,197,94,0.1)':'rgba(252,129,129,0.1)')+';color:'+c+';border:1px solid '+c+';border-radius:4px;padding:1px 5px;font-size:9px">'+m.tipo+'</span>'+(m.rev?'<span style="color:#fc8181;font-size:9px;margin-left:3px">REV</span>':'');
            const costoTd = puedo('INVENTARIO','VER_COSTOS') ? '<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-size:12px;color:var(--suave)">'+(eE&&m.costo>0?(m.moneda==='VES'?'Bs ':simRef+' ')+fmtUSD(m.costo):'—')+'</td>' : '';
            return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)'+(m.rev?';opacity:0.5':'')+'">'
              +'<td style="padding:7px;font-size:12px;line-height:1.3">'+fmtFecha(m.fecha)+'<div style="margin-top:2px">'+badge+'</div></td>'
              +'<td style="padding:7px;font-size:12px;word-break:break-word">'+m.art+'</td>'
              +'<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-size:12px">'+m.cant+'</td>'
              +'<td style="padding:7px;font-size:12px;word-break:break-word">'+m.origen+'</td>'
              +'<td style="padding:7px;font-size:12px;word-break:break-word">'+m.destino+'</td>'
              +'<td style="padding:7px;font-size:11px;color:var(--suave);word-break:break-word">'+m.motivo+'</td>'
              +costoTd+'</tr>';
          }).join('')
        + '</tbody></table></div>';

    } else if (agrup === 'categoria') {
      const cats = {};
      // Helper para obtener nombre de categoría desde cache
      const getCatNom = function(art) {
        if (art.id_categoria_articulo) {
          const c = _invCategoriasCache.find(function(c){ return c.id_categoria === art.id_categoria_articulo; });
          if (c) return (c.codigo ? c.codigo + ' — ' : '') + c.nombre.toUpperCase();
        }
        var _catG = _invCategoriasCache.find(function(c){ return c.id_categoria === art.id_categoria_articulo; }); return (_catG ? _catG.nombre : 'SIN CATEGORÍA').toUpperCase();
      };
      entradasValidas.forEach(function(e) {
        const art = getArt(e.id_articulo); if (!art) return;
        const cat = getCatNom(art);
        if (!cats[cat]) cats[cat] = { entradas:0, salidas:0, costo:0 };
        cats[cat].entradas += parseFloat(e.cantidad||0);
        cats[cat].costo    += parseFloat(e.precio_costo_moneda||0) * parseFloat(e.cantidad||0);
      });
      salidasValidas.forEach(function(s) {
        const art = getArt(s.id_articulo); if (!art) return;
        const cat = getCatNom(art);
        if (!cats[cat]) cats[cat] = { entradas:0, salidas:0, costo:0 };
        cats[cat].salidas += parseFloat(s.cantidad||0);
      });
      const filas = Object.keys(cats).sort().map(function(cat) {
        const c = cats[cat], saldo = c.entradas - c.salidas;
        const costoTd = puedo('INVENTARIO','VER_COSTOS') ? '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:12px">'+simRef+' '+fmtUSD(c.costo)+'</td>' : '';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px;font-weight:600;letter-spacing:0.5px">'+cat+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+c.entradas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+c.salidas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:'+(saldo>=0?'var(--naranja)':'#fc8181')+'">'+saldo+'</td>'
          +costoTd+'</tr>';
      });
      const colC2 = puedo('INVENTARIO','VER_COSTOS') ? '<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Costo Total</th>' : '';
      res.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
        +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Categoría</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Entradas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Salidas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo</th>'
        +colC2+'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';

    } else if (agrup === 'area') {
      const areas = {}; // key: areaNom||artNom
      // ENTRADAS directas (compras, ajustes) - excluir transferencias para no contar doble
      entradasValidas.forEach(function(e) {
        if (e.motivo === 'transferencia') return; // Las transferencias se manejan desde salidas
        const art = getArt(e.id_articulo);
        const areaNom = e.area_receptora ? e.area_receptora.nombre+(e.area_receptora.codigo?' ('+e.area_receptora.codigo+')':'') : 'Sin área';
        const artNom  = art ? art.nombre_articulo : ('Art #'+e.id_articulo);
        const key = areaNom+'||'+artNom;
        if (!areas[key]) areas[key] = { area:areaNom, art:artNom, entradas:0, salidas:0 };
        areas[key].entradas += parseFloat(e.cantidad||0);
      });
      // SALIDAS = SALIDA del area origen + ENTRADA del area receptora
      salidasValidas.forEach(function(s) {
        const art = getArt(s.id_articulo);
        const artNom    = art ? art.nombre_articulo : ('Art #'+s.id_articulo);
        // Area origen: quien entrega -> SALIDA
        const nomOrigen = s.area_entrega   ? s.area_entrega.nombre+(s.area_entrega.codigo?' ('+s.area_entrega.codigo+')':'') : 'Sin área';
        var kO = nomOrigen+'||'+artNom;
        if (!areas[kO]) areas[kO] = { area:nomOrigen, art:artNom, entradas:0, salidas:0 };
        areas[kO].salidas += parseFloat(s.cantidad||0);
        // Area receptora: quien recibe -> ENTRADA
        const nomDest = s.area_receptora ? s.area_receptora.nombre+(s.area_receptora.codigo?' ('+s.area_receptora.codigo+')':'') : null;
        if (nomDest) {
          var kD = nomDest+'||'+artNom;
          if (!areas[kD]) areas[kD] = { area:nomDest, art:artNom, entradas:0, salidas:0 };
          areas[kD].entradas += parseFloat(s.cantidad||0);
        }
      });
      var thStyle = 'padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)';
      // Filtrar por area del operador si no tiene VER_INVENTARIO_GENERAL
      var areaKeys = Object.keys(areas).sort();
      if (id_areaMovs && id_areaMovsNombre) {
        // Los movimientos ya vienen filtrados por id_area desde el query.
        // Solo mostramos filas de su propia area.
        areaKeys = areaKeys.filter(function(k) {
          return areas[k].area === id_areaMovsNombre;
        });
      }
      var filas = areaKeys.map(function(k) {
        var v = areas[k], saldo = v.entradas - v.salidas;
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'          +'<td style="padding:8px;font-size:12px">'+v.area+'</td>'          +'<td style="padding:8px;font-size:12px">'+v.art+'</td>'          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+v.entradas+'</td>'          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+v.salidas+'</td>'          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:'+(saldo>=0?'var(--naranja)':'#fc8181')+'">'+saldo+'</td></tr>';
      });
      res.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'        +'<th style="'+thStyle+';text-align:left">Área</th>'        +'<th style="'+thStyle+';text-align:left">Artículo</th>'        +'<th style="'+thStyle+';text-align:right">Entradas</th>'        +'<th style="'+thStyle+';text-align:right">Salidas</th>'        +'<th style="'+thStyle+';text-align:right">Saldo</th>'        +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';

      } else if (agrup === 'articulo') {
      const arts = {};
      entradasValidas.forEach(function(e) {
        const art=getArt(e.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_moneda||0, stock:stockMostrarArticulo(art.id_articulo), hist:[] };
        arts[nom].entradas += parseFloat(e.cantidad||0);
        arts[nom].hist.push({ fecha:e.fecha_entrada, tipo:'E', cant:e.cantidad, cpp:e.precio_costo_moneda||0 });
      });
      salidasValidas.forEach(function(s) {
        const art=getArt(s.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_moneda||0, stock:stockMostrarArticulo(art.id_articulo), hist:[] };
        arts[nom].salidas += parseFloat(s.cantidad||0);
        arts[nom].hist.push({ fecha:s.fecha_salida, tipo:'S', cant:s.cantidad, cpp:0 });
      });
      const filas = Object.keys(arts).filter(function(n){ return !busq||n.toLowerCase().includes(busq); }).sort().map(function(nom) {
        const a=arts[nom], saldo=a.entradas-a.salidas;
        const costoTds = puedo('INVENTARIO','VER_COSTOS')
          ? '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:12px">'+simRef+' '+fmtUSD(a.cpp)+'</td>'
            +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:12px">'+a.stock+'</td>'
          : '';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px">'+nom+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+a.entradas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+a.salidas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:'+(saldo>=0?'var(--naranja)':'#fc8181')+'">'+saldo+'</td>'
          +costoTds+'</tr>';
      });
      const costoCols = puedo('INVENTARIO','VER_COSTOS')
        ? '<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">CPP</th>'
          +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Stock Actual</th>'
        : '';
      res.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
        +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Entradas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Salidas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo</th>'
        +costoCols+'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';

    } else if (agrup === 'proveedor') {
      const provs = {};
      entradasValidas.filter(function(e){ return e.id_proveedor; }).forEach(function(e) {
        const nom = e.proveedor ? e.proveedor.nombre : 'Prov #'+e.id_proveedor;
        if (!provs[nom]) provs[nom] = { cant:0, monto:0, items:0 };
        provs[nom].cant   += parseFloat(e.cantidad||0);
        provs[nom].monto  += (parseFloat(e.precio_costo_moneda||0)*parseFloat(e.cantidad||0));
        provs[nom].items  += 1;
      });
      const filas = Object.keys(provs).sort().map(function(nom) {
        const p=provs[nom];
        const costoTd = puedo('INVENTARIO','VER_COSTOS') ? '<td style="text-align:right;padding:8px;font-family:var(--font-mono)">'+simRef+' '+fmtUSD(p.monto)+'</td>' : '';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px">'+nom+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono)">'+p.items+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono)">'+p.cant+'</td>'
          +costoTd+'</tr>';
      });
      const colC3 = puedo('INVENTARIO','VER_COSTOS') ? '<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Monto Total</th>' : '';
      res.innerHTML = (!filas.length ? '<div style="text-align:center;color:var(--suave);padding:40px">Sin compras a proveedores en el período.</div>'
        : '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
          +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Proveedor</th>'
          +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Transacciones</th>'
          +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Unidades</th>'
          +colC3+'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>');

    } else if (agrup === 'rotacion') {
      // "Salidas" aquí debe reflejar consumo/uso real (venta, OS, etc.), no
      // el movimiento interno entre Áreas -- una Transferencia no es una
      // salida real del Artículo (sigue en la empresa, solo cambió de
      // Área), y contarla duplicaría su efecto contra la Entrada emparejada.
      const rot = {};
      entradasValidas.forEach(function(e) {
        const art=getArt(e.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!rot[nom]) rot[nom] = { entradas:0, salidas:0, movs:0 };
        rot[nom].entradas += parseFloat(e.cantidad||0);
        rot[nom].movs++;
      });
      salidasSinTransferencia.forEach(function(s) {
        const art=getArt(s.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!rot[nom]) rot[nom] = { entradas:0, salidas:0, movs:0 };
        rot[nom].salidas += parseFloat(s.cantidad||0);
        rot[nom].movs++;
      });
      const filas = Object.keys(rot).sort(function(a,b){ return (rot[b].entradas+rot[b].salidas)-(rot[a].entradas+rot[a].salidas); }).map(function(nom) {
        const r=rot[nom], saldo=r.entradas-r.salidas;
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px">'+nom+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+r.entradas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+r.salidas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:'+(saldo>=0?'var(--naranja)':'#fc8181')+'">'+saldo+'</td></tr>';
      });
      res.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
        +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Entradas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Salidas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo</th>'
        +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';

    } else if (agrup === 'saldo_area') {
      // Movimiento neto del período: cuánto cambió el stock de cada Área
      // durante el rango Desde/Hasta seleccionado (entradas menos salidas
      // DE ESE PERÍODO). NO es el saldo real actual -- si el Artículo tuvo
      // movimientos antes de "Desde", esos no se cuentan aquí. Para el
      // saldo real, ver "Saldo Actual por Área".
      const saldos = {};
      entradasValidas.forEach(function(e) {
        const nom = e.area_receptora ? e.area_receptora.nombre+(e.area_receptora.codigo?' ('+e.area_receptora.codigo+')':'') : 'Sin área';
        const art = getArt(e.id_articulo); if(!art) return;
        if (!saldos[nom]) saldos[nom] = {};
        if (!saldos[nom][artNom(art)]) saldos[nom][artNom(art)] = 0;
        saldos[nom][artNom(art)] += parseFloat(e.cantidad||0);
      });
      // Aquí sí se usa salidasValidas completo (no salidasSinTransferencia)
      // para el lado que RESTA -- el Área que entrega SIEMPRE pierde ese
      // stock, sea Transferencia o no, y esa resta no está duplicada en
      // ningún otro lado. Lo que sí hay que omitir es la SUMA al Área que
      // recibe cuando es Transferencia, porque esa parte ya la capta la
      // Entrada emparejada (ver nota arriba).
      salidasValidas.forEach(function(s) {
        const art = getArt(s.id_articulo); if(!art) return;
        const cant = parseFloat(s.cantidad||0);
        const esTransferencia = (s.observaciones||'').indexOf('[TRANSFERENCIA]') !== -1;
        // Descuenta del área que entrega
        const nomOrigen = s.area_entrega ? s.area_entrega.nombre+(s.area_entrega.codigo?' ('+s.area_entrega.codigo+')':'') : 'Sin área';
        if (!saldos[nomOrigen]) saldos[nomOrigen] = {};
        if (!saldos[nomOrigen][artNom(art)]) saldos[nomOrigen][artNom(art)] = 0;
        saldos[nomOrigen][artNom(art)] -= cant;
        // Suma al área que recibe -- NO si es Transferencia (ya la sumó la
        // Entrada emparejada; sumarla aquí también la duplicaría).
        if (s.area_receptora && !esTransferencia) {
          const nomDestino = s.area_receptora.nombre+(s.area_receptora.codigo?' ('+s.area_receptora.codigo+')':'');
          if (!saldos[nomDestino]) saldos[nomDestino] = {};
          if (!saldos[nomDestino][artNom(art)]) saldos[nomDestino][artNom(art)] = 0;
          saldos[nomDestino][artNom(art)] += cant;
        }
      });
      let html = '<div style="font-size:11px;color:var(--suave);margin-bottom:10px">📌 Esto es el movimiento neto <strong>del período seleccionado</strong> (Desde/Hasta), no el saldo real actual. Para el saldo real, use "Saldo Actual por Área".</div>';
      Object.keys(saldos).sort().forEach(function(area) {
        const filas = Object.keys(saldos[area]).sort().map(function(art) {
          const s=saldos[area][art];
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
            +'<td style="padding:7px;font-size:12px">'+art+'</td>'
            +'<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-weight:700;color:'+(s>=0?'var(--naranja)':'#fc8181')+'">'+s+'</td></tr>';
        });
        html += '<div style="margin-bottom:20px"><div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:8px 14px;margin-bottom:6px;font-family:var(--font-mono);color:var(--naranja)">'+area+'</div>'
          +'<table style="width:100%;border-collapse:collapse"><thead><tr>'
          +'<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
          +'<th style="text-align:right;padding:7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Neto del Período</th>'
          +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';
      });
      res.innerHTML = html;

    } else if (agrup === 'saldo_actual') {
      // Saldo REAL actual por Área -- ignora el filtro Desde/Hasta a
      // propósito (un saldo es "ahora mismo", no depende de un rango de
      // fechas). Viene directo de inventario_stock_area, la misma fuente
      // que usa el resto del sistema (Inventario General, selector de
      // Artículos en la OS, etc.) -- así siempre coincide.
      let qStock = '?id_articulo=in.('+inClause+')&select=id_articulo,stock_actual,area:id_area(nombre,codigo)';
      if (id_areaMovs) qStock += '&id_area=eq.'+id_areaMovs;
      const stockRows = await api('inventario_stock_area','GET',null,qStock) || [];
      const porArea = {};
      stockRows.forEach(function(r) {
        const art = getArt(r.id_articulo); if (!art) return;
        const nom = r.area ? r.area.nombre+(r.area.codigo?' ('+r.area.codigo+')':'') : 'Sin área';
        const stk = parseFloat(r.stock_actual||0);
        if (!stk) return; // no mostrar ceros, igual que el resto del sistema
        if (!porArea[nom]) porArea[nom] = {};
        porArea[nom][artNom(art)] = stk;
      });
      let html2 = '';
      Object.keys(porArea).sort().forEach(function(area) {
        const filas = Object.keys(porArea[area]).sort().map(function(art) {
          const s=porArea[area][art];
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
            +'<td style="padding:7px;font-size:12px">'+art+'</td>'
            +'<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-weight:700;color:'+(s>=0?'var(--naranja)':'#fc8181')+'">'+s+'</td></tr>';
        });
        html2 += '<div style="margin-bottom:20px"><div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:8px 14px;margin-bottom:6px;font-family:var(--font-mono);color:var(--naranja)">'+area+'</div>'
          +'<table style="width:100%;border-collapse:collapse"><thead><tr>'
          +'<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
          +'<th style="text-align:right;padding:7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo Actual</th>'
          +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';
      });
      res.innerHTML = html2 || '<div style="text-align:center;color:var(--suave);padding:40px">Sin stock registrado.</div>';
    }

  } catch(e) {
    res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>';
    console.error('invCargarMovimientos:', e);
  }
}

// ═══ SECCION: Historial, Edicion y Anulacion de Movimientos (ex inventario.js) ═══
async function verHistorialStock(id_articulo, nombreArt) {
  const tieneAcceso = sesionActual?.administrador
    || puedo('INVENTARIO','VER')
    || puedo('INVENTARIO','ENTRADA_STOCK')
    || puedo('INVENTARIO','SALIDA_STOCK');
  if (!tieneAcceso) { alert('No tiene permiso.'); return; }

  console.log('[SYD] verHistorialStock id:', id_articulo, 'nombre:', nombreArt);

  const elNombre = document.getElementById('historial-art-nombre');
  const elCont   = document.getElementById('historial-contenido');
  const elId     = document.getElementById('historial-id-articulo');

  if (!elNombre || !elCont || !elId) {
    console.error('[SYD] verHistorialStock: elementos del modal no encontrados');
    return;
  }

  elNombre.textContent = nombreArt || '—';
  elCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando historial...</div>';
  elId.value = id_articulo;

  // Asegurar que _fichaInvActual esté seteado para el Retornar
  if (!_fichaInvActual || !_fichaInvActual.id) {
    _fichaInvActual = { id: id_articulo, nombre: nombreArt || '' };
  }

  abrirModal('modal-historial-stock');
  focusFirstField('modal-historial-stock');

  try {
    await recargarHistorial(id_articulo);
  } catch(e) {
    console.error('[SYD] recargarHistorial error:', e.message);
    elCont.innerHTML = '<div style="color:#fc8181;padding:16px">Error: ' + e.message + '</div>';
  }
}

async function recargarHistorial(id_articulo) {
  if (!id_articulo) id_articulo = document.getElementById('historial-id-articulo').value;
  const cont = document.getElementById('historial-contenido');
  try {
    // Tres casos, bien diferenciados (el fix anterior solo contempló el 1 y
    // el 3, dejando roto el 2 -- ya no filtraba nada con el filtro manual
    // activo):
    // 1. Usuario SIN VER_INVENTARIO_GENERAL -- se limita a su propia Área.
    // 2. Usuario CON el permiso, pero con el filtro manual de Área activo
    //    en Inventario General -- el Historial debe respetar ESA Área
    //    elegida (no la del empleado, que puede no coincidir).
    // 3. Usuario CON el permiso, sin filtro manual -- ve todo, sin filtrar.
    let id_areaH = null;
    let esAreaComprasH = false;
    const tienePermisoGeneralH = sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL');
    if (!tienePermisoGeneralH) {
      // Caso 1
      const empH = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').catch(function(){ return []; });
      id_areaH = empH?.[0]?.id_area || null;
    } else if (_invFiltroAreaManual) {
      // Caso 2
      id_areaH = _invFiltroAreaManual;
    }
    // Caso 3: id_areaH se queda en null -- sin filtrar, ve todo.
    if (id_areaH) {
      // El Área de Compras se identifica por su código real (2300 —
      // "Gerencias de Compras"), NO por emisores.id_area_principal (esa
      // columna no existe; era un bug ya presente desde antes). "Gerencia
      // General (1200)" es un Área totalmente distinta a Compras.
      try {
        const areaComprasRow = await api('param_areas','GET',null,'?codigo=eq.2300&select=id&limit=1');
        const idAreaComprasReal = areaComprasRow?.[0]?.id || null;
        esAreaComprasH = idAreaComprasReal != null && String(id_areaH) === String(idAreaComprasReal);
      } catch(eAreaCompras) { console.warn('No se pudo determinar el Área de Compras:', eAreaCompras); }
    }
    _historialEstado = { id_articulo: id_articulo, cursor: null, terminado: false, idAreaH: id_areaH, esAreaCompras: esAreaComprasH, filtro: 'todas' };
    _actualizarTabsHistorial();

    const movimientos = await _obtenerPaginaHistorial();
    if (!movimientos.length) {
      cont.innerHTML = '<div style="text-align:center;padding:32px;color:var(--suave)">Sin movimientos registrados</div>';
      return;
    }
    cont.innerHTML = _renderTablaHistorial(movimientos);
  } catch(err) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

async function filtrarHistorial(tipo) {
  _historialEstado.filtro = tipo;
  _historialEstado.cursor = null;
  _historialEstado.terminado = false;
  _actualizarTabsHistorial();
  const cont = document.getElementById('historial-contenido');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const movimientos = await _obtenerPaginaHistorial();
    if (!movimientos.length) {
      cont.innerHTML = '<div style="text-align:center;padding:32px;color:var(--suave)">Sin movimientos ' + (tipo === 'entrada' ? 'de Entrada' : tipo === 'salida' ? 'de Salida' : '') + ' registrados</div>';
      return;
    }
    cont.innerHTML = _renderTablaHistorial(movimientos);
  } catch(err) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function _actualizarTabsHistorial() {
  const map = { todas: 'historial-tab-todas', entrada: 'historial-tab-entrada', salida: 'historial-tab-salida' };
  Object.keys(map).forEach(function(k) {
    const btn = document.getElementById(map[k]);
    if (btn) btn.className = (k === _historialEstado.filtro) ? 'btn-naranja' : 'btn-secundario';
  });
}

async function _obtenerPaginaHistorial() {
  const { id_articulo, cursor, idAreaH, esAreaCompras, filtro } = _historialEstado;
  const cursorQS = cursor ? '&fecha_registro=lt.' + encodeURIComponent(cursor) : '';
  const qEnt = '?id_articulo=eq.' + id_articulo + (idAreaH ? '&id_area=eq.'+idAreaH : '') + cursorQS
    + '&order=fecha_registro.desc&limit=' + HISTORIAL_PAGE_SIZE
    + '&select=*,area_receptora:id_area(nombre,codigo),area_origen:id_area_origen(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),proveedores(nombre)';

  // Solo Compras hace Entradas (incluida Transferencia: Área Origen → Compras), así que
  // cada Transferencia deja DOS filas reales: una en stock_entradas (ganancia de Compras)
  // y una espejo en stock_salidas con id_area = Compras (destino) — puesta ahí solo para
  // trazabilidad del lado del Área Origen. Si Compras ve su propio historial y filtramos
  // por "id_area = Compras OR id_area_entrega = Compras", esa fila espejo hace match DOS
  // veces (una por su propia entrada, otra por esta salida) y la Transferencia se duplica
  // como "Entrada" repetida. Por eso, cuando el área del usuario es Compras, solo se cuentan
  // las salidas donde Compras fue quien ENTREGÓ (id_area_entrega) — nunca donde aparece como
  // destino (id_area), ya que ese lado ya está cubierto por su fila de stock_entradas.
  // esAreaCompras ya viene calculado desde recargarHistorial() -- identificando el Área de
  // Compras por su código real (2300), no por una columna que no existe en emisores.
  const filtroAreaSal = !idAreaH ? ''
    : esAreaCompras ? '&id_area_entrega=eq.' + idAreaH
    : '&or=(id_area.eq.' + idAreaH + ',id_area_entrega.eq.' + idAreaH + ')';
  const qSal = '?id_articulo=eq.' + id_articulo + filtroAreaSal + cursorQS
    + '&order=fecha_registro.desc&limit=' + HISTORIAL_PAGE_SIZE
    + '&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),empleado_entrega:id_empleado_entrega(nombre_completo)';

  const [entradas, salidas] = await Promise.all([
    filtro !== 'salida'  ? api('stock_entradas', 'GET', null, qEnt) : Promise.resolve([]),
    filtro !== 'entrada' ? api('stock_salidas',  'GET', null, qSal) : Promise.resolve([]),
  ]);

  const combinados = [
    ...entradas.map(function(e) { return { ...e, tipo: 'ENTRADA', fecha: e.fecha_entrada, fecha_reg: e.fecha_registro }; }),
    ...salidas.map(function(s)  {
      const tipoMov = idAreaH && String(s.id_area) === String(idAreaH) ? 'ENTRADA' : 'SALIDA';
      return { ...s, tipo: tipoMov, fecha: s.fecha_salida, fecha_reg: s.fecha_registro };
    }),
  ].sort(function(a, b) { return new Date(b.fecha_reg) - new Date(a.fecha_reg); });

  const pagina = combinados.slice(0, HISTORIAL_PAGE_SIZE);
  // Si ambas tablas consultadas devolvieron menos del tamaño de página, ya no queda nada más que traer.
  _historialEstado.terminado = entradas.length < HISTORIAL_PAGE_SIZE && salidas.length < HISTORIAL_PAGE_SIZE;
  if (pagina.length) _historialEstado.cursor = pagina[pagina.length - 1].fecha_reg;
  return pagina;
}

async function cargarMasHistorial() {
  const btn = document.getElementById('historial-btn-cargar-mas');
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }
  try {
    const pagina = await _obtenerPaginaHistorial();
    const cont = document.getElementById('historial-contenido');
    const tbody = cont.querySelector('tbody');
    if (tbody && pagina.length) tbody.insertAdjacentHTML('beforeend', pagina.map(_renderFilaHistorial).join(''));
    const footerViejo = document.getElementById('historial-footer-paginacion');
    if (footerViejo) footerViejo.remove();
    cont.insertAdjacentHTML('beforeend', _renderFooterPaginacion());
  } catch(e) {
    alert('Error cargando más movimientos: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Cargar más'; }
  }
}

function _renderFooterPaginacion() {
  if (_historialEstado.terminado) {
    return '<div id="historial-footer-paginacion" style="text-align:center;padding:12px;color:var(--suave);font-size:11px">— Fin del historial —</div>';
  }
  return '<div id="historial-footer-paginacion" style="text-align:center;padding:12px">'
    + '<button id="historial-btn-cargar-mas" class="btn-secundario" style="padding:8px 20px;font-size:12px" onclick="cargarMasHistorial()">Cargar más</button>'
    + '</div>';
}

function _renderTablaHistorial(movimientos) {
  const thStyle = 'padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px;background:var(--gris1);position:sticky;top:0;z-index:1';
  return '<table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr>'
    + '<th style="text-align:left;' + thStyle + '">FECHA</th>'
    + '<th style="text-align:left;' + thStyle + '">REF</th>'
    + '<th style="text-align:left;' + thStyle + '">TIPO</th>'
    + '<th style="text-align:center;' + thStyle + '">CANTIDAD</th>'
    + '<th style="text-align:left;' + thStyle + '">ÁREA / DETALLE</th>'
    + '<th style="text-align:center;' + thStyle + '">ESTADO</th>'
    + '<th style="text-align:center;' + thStyle + '">ACCIÓN</th>'
    + '</tr></thead><tbody>'
    + movimientos.map(_renderFilaHistorial).join('')
    + '</tbody></table>'
    + _renderFooterPaginacion();
}

function _renderFilaHistorial(m) {
  const esEntrada = m.tipo === 'ENTRADA';
  const tieneMarcadorTransf = (m.observaciones || '').indexOf('[TRANSFERENCIA]') === 0;
  const obsSinMarcador = tieneMarcadorTransf ? (m.observaciones || '').replace('[TRANSFERENCIA]', '').trim() : (m.observaciones || '');
  const anulada = !!m.anulada;
  const areaRec = m.area_receptora || m.param_areas;
  const area = areaRec ? areaRec.nombre + (areaRec.codigo ? ' (' + areaRec.codigo + ')' : '') : '—';
  return '<tr style="opacity:' + (anulada ? '0.5' : '1') + '">'
    + '<td style="padding:8px 0;font-size:12px;color:var(--suave)">' + (m.fecha ? fmtFecha(m.fecha) : '—') + '</td>'
    + '<td style="padding:8px;font-size:12px;font-family:var(--font-mono);color:var(--naranja)">'
    + 'Ref: ' + (m.id_entrada ? 'ENT-' + m.id_entrada : 'SAL-' + m.id_salida) + '</td>'
    + '<td style="padding:8px"><span class="badge ' + (esEntrada ? 'badge-verde' : 'badge-rojo') + '">'
    + (esEntrada ? '▲ Entrada' : '▼ Salida') + '</span>'
    + (anulada ? '<div style="font-size:10px;color:#fc8181;margin-top:2px">Anulada</div>' : '') + '</td>'
    + '<td style="text-align:center;padding:8px;font-family:var(--font-mono);font-weight:600;color:' + (esEntrada ? '#22c55e' : '#fc8181') + '">'
    + (esEntrada ? '+' : '-') + m.cantidad + '</td>'
    + '<td style="padding:8px;font-size:12px">'
    + (esEntrada
      ? '<div>' + (m.area_receptora ? m.area_receptora.nombre + (m.area_receptora.codigo ? ' (' + m.area_receptora.codigo + ')' : '') : '—') + '</div>'
        + (m.area_origen ? '<div style="font-size:11px;color:#60a5fa">↩ Origen: ' + m.area_origen.nombre + (m.area_origen.codigo ? ' (' + m.area_origen.codigo + ')' : '') + '</div>' : '')
        + (m.proveedores ? '<div style="font-size:11px;color:#a78bfa">🏭 ' + m.proveedores.nombre + '</div>' : '')
        + ((puedo('INVENTARIO','VER_COSTOS') && (m.precio_compra_original ?? m.precio_costo_moneda))
            ? '<div style="font-size:11px;color:var(--suave)">' + (m.moneda_compra === 'VES' ? 'Bs. ' + fmtBs(m.precio_compra_original ?? m.precio_costo_moneda) : '$ ' + fmtUSD(m.precio_compra_original ?? m.precio_costo_moneda)) + ' / u</div>'
            : '')
      : '<div>' + area + '</div>')
    + ((esEntrada ? m.empleado_recibe : m.empleado_recibe) ? '<div style="font-size:11px;color:#60a5fa">👤 Recibe: ' + (m.empleado_recibe?.nombre_completo||'') + '</div>' : '')
    + ((!esEntrada && m.empleado_entrega) ? '<div style="font-size:11px;color:#fb923c">👤 Entrega: ' + m.empleado_entrega.nombre_completo + '</div>' : '')
    + (tieneMarcadorTransf ? '<div style="font-size:11px;font-weight:600;color:var(--naranja);margin-top:2px">[TRANSFERENCIA]</div>' : '')
    + (obsSinMarcador ? '<div style="font-size:11px;color:var(--suave)">' + obsSinMarcador + '</div>' : '')
    + '</td>'
    + '<td style="text-align:center;padding:8px 0">'
    + (anulada
        ? '<span style="font-size:10px;font-weight:600;color:#fc8181">Anulada</span>'
        : '<span style="font-size:10px;color:#22c55e">Activa</span>')
    + '</td>'
    + '<td style="text-align:center;padding:8px 0">'
    + (function() {
        const esSobrante = esEntrada && m.motivo === 'ajuste';
        const esFaltante = !esEntrada && (m.observaciones || '').indexOf('FALTANTE (Ajuste de Inventario)') === 0;
        if (esSobrante || esFaltante) {
          return '<button class="btn-secundario" style="font-size:11px;padding:5px 10px" onclick="verFichaAjuste(\'' + (esSobrante ? 'ENTRADA' : 'SALIDA') + '\',' + (m.id_entrada||m.id_salida) + ',' + m.id_articulo + ')">👁 Ver</button>';
        }
        if (anulada) return '<span style="color:var(--suave);font-size:11px">—</span>';
        const soloLec = (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')) ? 'true' : 'false';
        if (m.id_entrada) return '<button class="btn-secundario" style="font-size:11px;padding:5px 10px" onclick="verFichaEntradaStock(' + m.id_entrada + ',' + m.id_articulo + ')">👁 Ver</button>';
        return '<button class="btn-secundario" style="font-size:11px;padding:5px 10px" onclick="editarMovimiento(\'SALIDA\',' + m.id_salida + ',' + m.id_articulo + ',' + soloLec + ',' + esEntrada + ')">👁 Ver</button>';
      })()
    + '</td>'
    + '</tr>';
}

function retornarDesdeEditMovimiento() {
  cerrarModal('modal-edit-movimiento');
  // Flujo 3: siempre volver al Historial de Movimientos
  if (_fichaInvActual && _fichaInvActual.id) {
    verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
  }
}

async function verFichaEntradaStock(id_entrada, id_articulo) {
  // Verificar si existe CxP asociada y su estado de pago
  let estaPagado = false;
  try {
    const numDoc = 'ENT-' + id_entrada;
    const cxps = await api('cont_cxp', 'GET', null,
      '?numero_doc=like.' + encodeURIComponent(numDoc) + '%' + emisorQ() + '&select=id_cxp,estado,saldo_usd');
    if (cxps && cxps.length > 0) {
      // Pagado si TODAS las cuotas están PAGADA o saldo = 0
      estaPagado = cxps.every(function(c) {
        return c.estado === 'PAGADA' || parseFloat(c.saldo_usd || 0) <= 0;
      });
    }
  } catch(e) { console.warn('verFichaEntradaStock CxP check:', e.message); }

  _editMovEstaPagado = estaPagado;
  await editarMovimiento('ENTRADA', id_entrada, id_articulo,
    estaPagado || (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')));
}

function _aplicarSoloLecturaMovimiento(tipo, soloLectura) {
  const campos = tipo === 'ENTRADA' ? CAMPOS_EDIT_ENTRADA : CAMPOS_EDIT_SALIDA;
  campos.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = !!soloLectura;
  });
  // Área Receptora y Empleado que Recibe: en modo lectura se ven como texto
  // plano (un select deshabilitado ignora el color que se le ponga y el
  // navegador lo pinta gris apagado, además de recortar nombres largos) --
  // el select real solo se muestra al entrar en modo Editar.
  if (tipo === 'SALIDA') {
    const areaSel = document.getElementById('edit-sal-area');
    const areaDisplay = document.getElementById('edit-sal-area-display');
    if (areaSel && areaDisplay) {
      areaSel.style.display = soloLectura ? 'none' : '';
      areaDisplay.style.display = soloLectura ? '' : 'none';
    }
    const empSel = document.getElementById('edit-sal-empleado');
    const empDisplay = document.getElementById('edit-sal-empleado-display');
    if (empSel && empDisplay) {
      empSel.style.display = soloLectura ? 'none' : '';
      empDisplay.style.display = soloLectura ? '' : 'none';
    }
    // Moneda: mismo tratamiento -- texto plano en modo lectura, select real
    // solo al Editar.
    const monSel = document.getElementById('edit-sal-moneda-venta');
    const monDisplay = document.getElementById('edit-sal-moneda-venta-display');
    if (monSel && monDisplay) {
      monSel.style.display = soloLectura ? 'none' : '';
      monDisplay.style.display = soloLectura ? '' : 'none';
      if (soloLectura) {
        monDisplay.textContent = monSel.value === 'VES' ? 'VES — Bolívar' : 'USD — Dólar';
      }
    }
    // Precio de Venta: en modo lectura se ve el valor histórico guardado,
    // tal cual quedó. Al entrar a Editar, se recalcula fresco (CPP ÷
    // Margen vigente) por si el Costo o el Margen cambiaron desde que se
    // guardó -- salvo que el Usuario ya lo esté ajustando manualmente.
    window._editSalPrecioManual = false;
    // Se libera la Moneda también aquí (por si había quedado bloqueada de
    // un ajuste manual anterior) -- este bloque corre tanto al abrir la
    // ficha como al entrar a modo Editar.
    const monedaSelLibEd = document.getElementById('edit-sal-moneda-venta');
    if (monedaSelLibEd) monedaSelLibEd.disabled = false;
    const pvDisplayEd = document.getElementById('edit-sal-precio-venta-display');
    const pvInputEd = document.getElementById('edit-sal-precio-venta');
    const pvAjustarBtnEd = document.getElementById('edit-sal-precio-venta-ajustar-btn');
    if (pvDisplayEd) pvDisplayEd.style.display = '';
    if (pvInputEd) pvInputEd.style.display = 'none';
    if (pvAjustarBtnEd) pvAjustarBtnEd.style.display = (!soloLectura && (sesionActual?.administrador || (puedo('INVENTARIO','VER_PRECIOS_VENTA') && puedo('INVENTARIO','AJUSTAR_PRECIO_VENTA')))) ? '' : 'none';
    if (soloLectura) {
      // Vista de solo lectura: mostrar el valor histórico tal cual, sin
      // recalcular -- salvo que el Usuario no tenga permiso, ahí candado.
      if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_PRECIOS_VENTA')) {
        if (pvDisplayEd) pvDisplayEd.textContent = '🔒';
      } else {
        const pvGuardado = pvInputEd ? pvInputEd.value : '';
        const monGuardada = document.getElementById('edit-sal-moneda-venta')?.value || 'USD';
        if (pvDisplayEd) pvDisplayEd.textContent = pvGuardado
          ? (monGuardada === 'VES' ? 'Bs ' : '$ ') + fmtUSD(parseFloat(pvGuardado))
          : '—';
      }
    } else {
      recalcularPrecioVentaEditSalida();
    }
  }
  const claveBox   = tipo === 'ENTRADA' ? document.getElementById('edit-mov-clave-cont') : document.getElementById('edit-sal-clave-cont');
  const btnGuardar  = document.getElementById('btn-guardar-movimiento');
  const btnEditar   = document.getElementById('btn-editar-movimiento');
  const badgePago   = document.getElementById('edit-mov-badge-pago');
  if (soloLectura) {
    if (claveBox)   claveBox.style.display   = 'none';
    if (btnGuardar) btnGuardar.style.display = 'none';
    if (btnEditar)  btnEditar.style.display  = _editMovPuedeEditar ? '' : 'none';
  } else {
    if (claveBox)   claveBox.style.display   = '';
    if (btnGuardar) btnGuardar.style.display = '';
    if (btnEditar)  btnEditar.style.display  = 'none';
    const claveEl = tipo === 'ENTRADA' ? document.getElementById('edit-mov-clave') : document.getElementById('edit-sal-clave');
    if (claveEl) claveEl.value = '';
  }
  const modoLbl = document.getElementById('edit-mov-titulo');
  const idMov = document.getElementById('edit-mov-id')?.value;
  const refMov = idMov ? ' — Ref: ' + (tipo === 'ENTRADA' ? 'ENT-' : 'SAL-') + idMov : '';
  // Un Ajuste de Inventario (Sobrante o Faltante) no es una Entrada/Salida normal —
  // usa el mismo modal por reutilización de campos, pero con su propio título.
  const esAjusteSobrante = tipo === 'ENTRADA' && m?.motivo === 'ajuste';
  const esAjusteFaltante = tipo === 'SALIDA'  && (m?.observaciones || '').indexOf('FALTANTE (Ajuste de Inventario)') === 0;
  const esTransferenciaFicha = (m?.observaciones || '').indexOf('[TRANSFERENCIA]') === 0;
  let tituloMov;
  if (esAjusteSobrante || esAjusteFaltante) {
    tituloMov = (soloLectura ? '👁 FICHA ' : '✏ EDITAR ') + 'AJUSTE DE INVENTARIO — ' + (esAjusteSobrante ? 'Sobrante' : 'Faltante') + refMov;
  } else if (esTransferenciaFicha) {
    tituloMov = (soloLectura ? '👁 FICHA ' : '✏ EDITAR ') + 'TRANSFERENCIA' + refMov;
  } else {
    // Si se está viendo desde el Área receptora (Taller), esta misma Salida
    // se lee como una Entrada para quien la recibió -- solo cambia la
    // palabra en el título; la referencia real (Ref: SAL-X) no cambia,
    // porque es el dato real de auditoría del movimiento.
    const esEntradaTitulo = tipo === 'ENTRADA' || _editMovVistaComoEntrada;
    tituloMov = (soloLectura ? '👁 FICHA ' : '✏ EDITAR ') + (esEntradaTitulo ? 'ENTRADA' : 'SALIDA') + ' DE STOCK' + refMov;
    const fechaLblMov = document.getElementById('edit-sal-fecha-label');
    if (fechaLblMov) fechaLblMov.textContent = 'Fecha de ' + (esEntradaTitulo ? 'Entrada' : 'Salida');
  }
  if (modoLbl) modoLbl.textContent = tituloMov;
}

function habilitarEdicionMovimiento() {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')) {
    alert('No tiene permiso para editar movimientos de stock.');
    return;
  }
  if (!_editMovPuedeEditar || !_editMovTipoActual) return;
  _aplicarSoloLecturaMovimiento(_editMovTipoActual, false);
}

async function editarMovimiento(tipo, idMovimiento, id_articulo, soloLectura, vistaComoEntrada) {
  if (tipo === 'ENTRADA') await cargarTasaIVAGlobal(); // refresca IVA vigente -- solo Entrada tiene IVA
  try {
  try {
    if (tipo === 'ENTRADA') {
      const res = await api('stock_entradas', 'GET', null,
        '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo)');
      m = res[0];
    } else {
      const res = await api('stock_salidas', 'GET', null,
        '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),empleado_entrega:id_empleado_entrega(nombre_completo,id_area,param_areas:id_area(nombre,codigo))');
      m = res[0];
    }
  } catch(err) { alert('Error cargando movimiento: ' + err.message); return; }
  if (!m) return;

  // Cargar áreas y proveedores
  let areas = [], proveedores = [];
  try { areas      = await api('param_areas', 'GET', null, '?order=codigo.asc,nombre.asc'); } catch(e) {}
  try { proveedores = await api('proveedores', 'GET', null, '?order=nombre.asc&select=id_proveedor,nombre,rif'); } catch(e) {}

  // Cargar datos según tipo
  const esEntrada = tipo === 'ENTRADA';
  if (!esEntrada) _editMovEstaPagado = false; // el concepto "pagado" no aplica a salidas

  // Mostrar/ocultar secciones ANTES de cargar datos
  const salidaCont   = document.getElementById('edit-sal-cont');
  const entradaCont2 = document.getElementById('edit-mov-ent-cont');
  if (salidaCont)   salidaCont.style.display   = esEntrada ? 'none' : '';
  if (entradaCont2) entradaCont2.style.display  = esEntrada ? '' : 'none';

  // El modal SIEMPRE abre en modo lectura; solo se habilita si el usuario
  // presiona el botón "✏ EDITAR" explícito (ver habilitarEdicionMovimiento()).
  _editMovTipoActual  = tipo;
  _editMovPuedeEditar = !soloLectura;
  _editMovVistaComoEntrada = !!vistaComoEntrada;

  // Si es una SALIDA con Empleado que Recibe, tiene una Notificación de
  // Recepción asociada -- el stock del Área destino se acredita recién
  // cuando esa notificación se CONFIRMA (ver notifConfirmar() en core.js),
  // no al crear la Salida. Mientras esté PENDIENTE, se puede editar todo
  // libremente. Si ya está APROBADA (confirmada por el receptor), la
  // Salida queda bloqueada para editar -- el receptor ya dio por buena
  // esa cantidad/información, y el stock destino ya se acreditó con ella.
  _editMovNotifSalida = null;
  if (!esEntrada && m.id_empleado) {
    try {
      const notifRes = await api('notificaciones', 'GET', null,
        '?tipo=eq.RECEPCION_ARTICULO&id_salida=eq.' + idMovimiento + '&order=id.desc&limit=1&select=id,estado');
      if (notifRes && notifRes[0]) _editMovNotifSalida = notifRes[0];
    } catch(eNotifChk) { console.warn('Error verificando notificación de la Salida:', eNotifChk); }
  }
  const notifBloqueaEdicion = _editMovNotifSalida && _editMovNotifSalida.estado === 'APROBADO';
  if (notifBloqueaEdicion) _editMovPuedeEditar = false;
  const avisoBloqueoEl = document.getElementById('edit-sal-bloqueado-confirmado');
  if (avisoBloqueoEl) avisoBloqueoEl.style.display = notifBloqueaEdicion ? '' : 'none';

  // Ancho del modal: ENTRADA = 780px, SALIDA = 580px
  const modalDiv = document.querySelector('#modal-edit-movimiento .modal');
  if (modalDiv) modalDiv.style.maxWidth = esEntrada ? '780px' : '580px';

  if (!esEntrada) {
    // SALIDA
    const artNomEl2 = document.getElementById('edit-sal-art-nombre');
    const artStEl2  = document.getElementById('edit-sal-stock');
    try {
      const artData2 = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+id_articulo+'&select=nombre_articulo,unidad&limit=1');
      if (artData2 && artData2[0]) {
        if (artNomEl2) artNomEl2.textContent = artData2[0].nombre_articulo || '—';
        await calcularInvSaldoArea();
        const stockMostrarSal = stockMostrarArticulo(id_articulo);
        if (artStEl2)  artStEl2.textContent  = (function(v){ return v % 1 === 0 ? parseInt(v) : v.toFixed(2); })(stockMostrarSal) + ' UND';
        const unidadSal = artData2[0].unidad || 'UND';
        const lblUnidSal = document.getElementById('edit-sal-label-unidad');
        if (lblUnidSal) lblUnidSal.textContent = unidadSal;
      }
    } catch(e) {}

    // Fecha y cantidad
    const salFechaEl = document.getElementById('edit-sal-fecha');
    const salCantEl  = document.getElementById('edit-sal-cantidad');
    const salObsEl   = document.getElementById('edit-sal-observaciones');
    if (salFechaEl) salFechaEl.value = m.fecha_salida?.slice(0,10) || getHoyVzla();
    if (salCantEl)  salCantEl.value  = parseFloat(m.cantidad || 0) % 1 === 0 ? parseInt(m.cantidad || 0) : parseFloat(m.cantidad || 0).toFixed(2);
    if (salObsEl)   salObsEl.value   = m.observaciones || '';
    // Tasa BCV -- NO es la de hoy, es la que existía a la fecha de ESA
    // Salida (histórico, para que la ficha refleje lo que realmente pasó
    // en ese momento, no lo que vale hoy). Se busca la más reciente cuya
    // fecha_valor sea <= la fecha de la Salida (mismo criterio de
    // "vigencia a una fecha" que ya usamos en Margen Bruto).
    const tasaDispEd = document.getElementById('edit-sal-tasa-bcv-display');
    if (tasaDispEd) {
      tasaDispEd.textContent = '—';
      try {
        const fechaParaTasa = (m.fecha_salida || '').slice(0,10) || getHoyVzla();
        const tasaHistRows = await api('tasas','GET',null,
          '?moneda_origen=eq.USD&fecha_valor=lte.'+fechaParaTasa
          +'&order=fecha_valor.desc&limit=1&select=tipo_cambio');
        const tasaHist = tasaHistRows && tasaHistRows[0] ? parseFloat(tasaHistRows[0].tipo_cambio) : null;
        tasaDispEd.textContent = tasaHist ? 'Bs ' + fmtBs(tasaHist) : '—';
      } catch(eTasaHist) { console.warn('Error obteniendo Tasa BCV histórica:', eTasaHist); }
    }
    const salPvEl = document.getElementById('edit-sal-precio-venta');
    if (salPvEl) salPvEl.value = m.precio_venta_moneda ? parseFloat(m.precio_venta_moneda).toFixed(2) : '';
    const salMonEl = document.getElementById('edit-sal-moneda-venta');
    if (salMonEl) salMonEl.value = m.moneda_venta || 'USD';
    // Un Faltante (Ajuste de Inventario) no tiene Precio de Venta — se identifica
    // por el prefijo que se guarda en observaciones al registrarlo.
    const esFaltanteEdit = (m.observaciones || '').indexOf('FALTANTE (Ajuste de Inventario)') === 0;
    const salPvCont = document.getElementById('edit-sal-precio-venta-cont');
    if (salPvCont) salPvCont.style.display = esFaltanteEdit ? 'none' : '';
    const salMonCont = document.getElementById('edit-sal-moneda-venta-cont');
    if (salMonCont) salMonCont.style.display = esFaltanteEdit ? 'none' : '';

    // Área receptora -- si m.id_area es null, esta Salida es una venta
    // directa a Cliente (generada automáticamente al facturar una OS), no
    // una entrega entre Áreas. Se muestra así explícitamente en vez de
    // dejar un select vacío que parece un dato perdido.
    const areaRecCont = document.getElementById('edit-sal-area-cont');
    const ventaClienteCont = document.getElementById('edit-sal-venta-cliente-cont');
    const selArea2 = document.getElementById('edit-sal-area');
    const areaDisplay2 = document.getElementById('edit-sal-area-display');
    if (m.id_area) {
      if (areaRecCont) areaRecCont.style.display = '';
      if (ventaClienteCont) ventaClienteCont.style.display = 'none';
      if (selArea2) {
        selArea2.innerHTML = '<option value="">— Seleccionar Área —</option>'
          + (areas||[]).map(function(a) {
            return '<option value="'+a.id+'"'+(m.id_area==a.id?' selected':'')+'>'+a.nombre+(a.codigo?' ('+a.codigo+')':'')+'</option>';
          }).join('');
      }
      if (areaDisplay2) areaDisplay2.textContent = m.area_receptora?.nombre || '—';
      const emps2 = await api('empleados','GET',null,'?id_area=eq.'+m.id_area+'&select=id_empleado,nombre_completo&order=nombre_completo.asc');
      const selEmp2 = document.getElementById('edit-sal-empleado');
      if (selEmp2) {
        selEmp2.innerHTML = '<option value="">— Seleccionar empleado —</option>'
          + (emps2||[]).map(function(e) {
            return '<option value="'+e.id_empleado+'"'+(m.id_empleado==e.id_empleado?' selected':'')+'>'+e.nombre_completo+'</option>';
          }).join('');
      }
      const empDisplay2 = document.getElementById('edit-sal-empleado-display');
      if (empDisplay2) {
        const empSeleccionado = (emps2||[]).find(function(e){ return m.id_empleado == e.id_empleado; });
        empDisplay2.textContent = empSeleccionado ? empSeleccionado.nombre_completo : (m.empleado_recibe?.nombre_completo || '—');
      }
    } else {
      if (areaRecCont) areaRecCont.style.display = 'none';
      if (ventaClienteCont) {
        ventaClienteCont.style.display = '';
        ventaClienteCont.textContent = '🧾 Venta directa a Cliente'
          + ((m.observaciones||'').indexOf('Factura FAC-') === 0 ? ' — ' + m.observaciones : '');
      }
    }

    // Usuario entrega -- Área de Origen · Nombre del empleado, ambos con el
    // dato histórico real guardado en el movimiento, no quien tenga la
    // sesión abierta ahora mismo viendo la ficha.
    const entNomEl = document.getElementById('edit-sal-entrega-nombre');
    const entAreaEl = document.getElementById('edit-sal-entrega-area');
    if (entNomEl)  entNomEl.textContent  = m.empleado_entrega?.nombre_completo || sesionActual?.nombre || '—';
    if (entAreaEl) entAreaEl.textContent = m.empleado_entrega?.param_areas
      ? m.empleado_entrega.param_areas.nombre + (m.empleado_entrega.param_areas.codigo ? ' (' + m.empleado_entrega.param_areas.codigo + ')' : '')
      : (sesionActual?.nombre_area || '—');

    // Limpiar clave
    const salClaveEl = document.getElementById('edit-sal-clave');
    if (salClaveEl) salClaveEl.value = '';

    // Guardar id del movimiento, tipo y del artículo en los campos ocultos
    // compartidos (los mismos que usa guardarEdicionMovimiento/anularDesdeEdicion)
    document.getElementById('edit-mov-tipo').value        = 'SALIDA';
    document.getElementById('edit-mov-id').value          = idMovimiento;
    document.getElementById('edit-mov-id-articulo').value = id_articulo;

    // Siempre abre en modo lectura (bloquea campos, oculta clave y GUARDAR;
    // muestra el botón EDITAR solo si el usuario tiene permiso y no está pagado/anulado)
    _aplicarSoloLecturaMovimiento('SALIDA', true);

    // Botón Anular — visible si no está anulada y tiene permiso, PERO NO
    // para entregas Área↔Área (m.id_area = área receptora real). Esas ya
    // no se "anulan": si hace falta revertirlas, se hace con una
    // Transferencia explícita (Entrada de Stock, Área de Origen = la
    // receptora), que sí ajusta correctamente el stock de AMBAS áreas y
    // queda registrada como una Salida real, no como una anulación que
    // solo cambia el estado en el Historial sin mover el stock del área
    // receptora.
    const esEntregaAreaASal = !!m.id_area;
    const btnAnularSal = document.getElementById('btn-anular-movimiento');
    if (btnAnularSal) {
      const permAnularSal = sesionActual?.administrador || puedo('INVENTARIO','ANULAR_SALIDA');
      btnAnularSal.style.display = (!m.anulada && permAnularSal && !esEntregaAreaASal) ? '' : 'none';
    }
    const avisoTransfSal = document.getElementById('edit-sal-aviso-transferencia');
    if (avisoTransfSal) avisoTransfSal.style.display = (!m.anulada && esEntregaAreaASal) ? '' : 'none';

    // Abrir modal — al final después de cargar todos los datos
    const modalHist2 = document.getElementById('modal-historial-stock');
    if (modalHist2) { modalHist2.classList.remove('abierto'); modalHist2.style.display = 'none'; }
    console.log('[SYD] abriendo modal SALIDA');
    abrirModal('modal-edit-movimiento');
    return;
  }
  document.getElementById('edit-mov-tipo').value        = 'ENTRADA';
  document.getElementById('edit-mov-id').value          = idMovimiento;
  document.getElementById('edit-mov-id-articulo').value = id_articulo;
  document.getElementById('edit-mov-cantidad').value    = parseFloat(m.cantidad || 0) % 1 === 0 ? parseInt(m.cantidad || 0) : parseFloat(m.cantidad || 0).toFixed(2);
  const obsEl = document.getElementById('edit-mov-observaciones') || document.getElementById('edit-mov-obs');
  if (obsEl) obsEl.value = m.observaciones || '';
  const okEl  = document.getElementById('alerta-edit-mov-ok')  || document.getElementById('alerta-es-ok');
  const errEl = document.getElementById('alerta-edit-mov-err') || document.getElementById('alerta-es-err');
  if (okEl)  okEl.style.display  = 'none';
  if (errEl) errEl.style.display = 'none';

  // Artículo y Stock
  const artNombreEl = document.getElementById('edit-mov-art-nombre');
  const artStockEl  = document.getElementById('edit-mov-stock-actual');
  try {
    const artData = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+id_articulo+'&select=nombre_articulo,unidad&limit=1');
    if (artData && artData[0]) {
      if (artNombreEl) artNombreEl.textContent = artData[0].nombre_articulo || '—';
      await calcularInvSaldoArea();
      const stockMostrarEnt = stockMostrarArticulo(id_articulo);
      if (artStockEl)  artStockEl.textContent  = (function(v){ return v % 1 === 0 ? parseInt(v) : v.toFixed(2); })(stockMostrarEnt) + ' UND';
      const unidadArt = artData[0].unidad || 'UND';
      const lblUnidEnt = document.getElementById('edit-mov-label-unidad');
      if (lblUnidEnt) lblUnidEnt.textContent = unidadArt;
    }
  } catch(e) {}

  // Tasa BCV y montos calculados (solo para ENTRADA)
  if (tipo === 'ENTRADA') {
    const tasaEl = document.getElementById('edit-mov-tasa-bcv');
    const tasa   = parseFloat(m.tasa_bcv_usada || m.tasa_bcv || 0);
    if (tasaEl) tasaEl.value = tasa > 0 ? tasa.toFixed(4) : '';
    const precio   = parseFloat(m.precio_compra_original ?? m.precio_costo_moneda ?? 0);
    const cantidad = parseFloat(m.cantidad || 0);
    const montoTotal = precio * cantidad;
    const montoTotalEl = document.getElementById('edit-mov-monto-total');
    if (montoTotalEl) montoTotalEl.value = fmtBs(montoTotal);
    const moneda = m.moneda_compra || 'USD';
    const lblMontoTotal = document.getElementById('edit-mov-label-monto-total');
    if (lblMontoTotal) lblMontoTotal.textContent = 'Monto en ' + moneda;
    const calcEl = document.getElementById('edit-mov-precio-usd-calc');
    if (calcEl && tasa > 0) {
      calcEl.value = moneda === 'VES' ? fmtBs(montoTotal / tasa) : fmtBs(montoTotal * tasa);
    }
    // Tasa cont y tributos
    const tasaCont = document.getElementById('edit-mov-tasa-cont');
    if (tasaCont) tasaCont.style.display = '';
  }

  // Usuario confirmación
  const recNombreEl = document.getElementById('edit-mov-receptor-nombre');
  const recAreaEl   = document.getElementById('edit-mov-receptor-area');
  if (recNombreEl) recNombreEl.textContent = sesionActual?.nombre || sesionActual?.correo_usuario || '—';
  if (recAreaEl)   recAreaEl.textContent   = sesionActual?.nombre_area || '';

  // Mostrar sección correcta según tipo — ya aplicado arriba
  const entradaCont = document.querySelector('#modal-edit-movimiento .form-grid');

  // Título
  const modoLabel = soloLectura ? '👁 FICHA ENTRADA' : (tipo === 'ENTRADA' ? '✏ EDITAR ENTRADA' : '✏ EDITAR SALIDA');
  document.getElementById('edit-mov-titulo').textContent = modoLabel + ' DE STOCK';

  // Mostrar/ocultar campos según tipo
  const camposEntrada = ['edit-mov-moneda-cont','edit-mov-motivo-cont','edit-mov-precios-cont',
                         'edit-mov-precio-cont','edit-mov-tasa-cont','edit-mov-pago-cont'];
  camposEntrada.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = tipo === 'ENTRADA' ? '' : 'none';
  });

  // Botón Anular — visible si no está anulada y tiene permiso
  const btnAnular = document.getElementById('btn-anular-movimiento');
  if (btnAnular) {
    const permAnular = tipo === 'ENTRADA'
      ? (sesionActual?.administrador || puedo('INVENTARIO','ANULAR_ENTRADA'))
      : (sesionActual?.administrador || puedo('INVENTARIO','ANULAR_SALIDA'));
    btnAnular.style.display = (!m.anulada && permAnular) ? '' : 'none';
  }

  // Fecha — siempre visible para ENTRADA y SALIDA
  const fechaNeg = document.getElementById('edit-mov-fecha-negociacion');
  const fechaLbl = document.getElementById('edit-mov-fecha-label');
  if (tipo === 'ENTRADA') {
    if (fechaLbl) fechaLbl.textContent = 'Fecha Negociación *';
    if (fechaNeg) fechaNeg.value = m.fecha_negociacion || m.fecha_entrada?.slice(0,10) || getHoyVzla();
  } else {
    if (fechaLbl) fechaLbl.textContent = 'Fecha de Salida *';
    if (fechaNeg) fechaNeg.value = m.fecha_salida?.slice(0,10) || getHoyVzla();
  }

  // Campos solo para ENTRADA
  // esEntrada ya declarado arriba === 'ENTRADA';
  document.getElementById('edit-mov-precios-cont').style.display   = esEntrada ? '' : 'none';
  document.getElementById('edit-mov-pago-cont').style.display      = esEntrada ? '' : 'none';

  if (esEntrada) {
    // Moneda
    const selMoneda = document.getElementById('edit-mov-moneda');
    if (selMoneda) selMoneda.value = m.moneda_compra || 'USD';
    const lblMoneda = document.getElementById('edit-mov-label-moneda');
    if (lblMoneda) lblMoneda.textContent = '(' + (m.moneda_compra || 'USD') + ')';

    // Precio — usar el precio ORIGINAL negociado (antes de descontar IVA),
    // no el costo ya neto guardado en precio_costo_moneda. Si el registro es
    // anterior a que existiera esta columna, se cae al costo neto como antes.
    const precioEl = document.getElementById('edit-mov-precio');
    const precioParaMostrar = (m.precio_compra_original !== null && m.precio_compra_original !== undefined)
      ? m.precio_compra_original
      : m.precio_costo_moneda;
    if (precioEl) precioEl.value = precioParaMostrar ? fmtBs(precioParaMostrar) : '';
    // Precio Venta

    // Transacción (motivo) — inferir si es null en registros anteriores
    let motivoInferido = m.motivo || '';
    if (!motivoInferido) {
      if (m.id_proveedor)   motivoInferido = 'compra';
      else if (m.cliente_nombre) motivoInferido = 'devolucion';
      else if (m.id_area_origen) motivoInferido = 'transferencia';
    }
    const selMotivo = document.getElementById('edit-mov-motivo');
    if (selMotivo) selMotivo.value = motivoInferido;
    onCambiarMotivoEdit(); // aplica también el ocultamiento de Moneda/Precio/Tasa BCV/Pago

    // Mostrar campo dinámico según motivo
    const motivo = motivoInferido;
    const provContEl = document.getElementById('edit-mov-proveedor-cont');
    const cliContEl  = document.getElementById('edit-mov-cliente-cont');
    const aoContEl   = document.getElementById('edit-mov-area-origen-cont');
    if (provContEl) provContEl.style.display = motivo === 'compra'        ? '' : 'none';
    if (cliContEl)  cliContEl.style.display  = motivo === 'devolucion'    ? '' : 'none';
    if (aoContEl)   aoContEl.style.display   = motivo === 'transferencia' ? '' : 'none';

    // Tributos IVA — cargar valores guardados
    const tribuCont = document.getElementById('edit-mov-tributos-cont');
    if (tribuCont) tribuCont.style.display = motivo === 'compra' ? '' : 'none';
    if (motivo === 'compra') {
      const exentoVal   = document.getElementById('edit-mov-exento-iva-val');
      const incluyeVal  = document.getElementById('edit-mov-incluye-iva-val');
      const ivaContEl2  = document.getElementById('edit-mov-incluye-iva-cont');
      const exentoSi    = document.getElementById('edit-exento-iva-si');
      const exentoNo    = document.getElementById('edit-exento-iva-no');
      const incluyeSi   = document.getElementById('edit-incluye-iva-si');
      const incluyeNo   = document.getElementById('edit-incluye-iva-no');

      const exento  = m.exento_iva  === true;
      const incluye = m.incluye_iva === true;

      if (exentoVal)  exentoVal.value  = exento  ? 'SI' : (m.exento_iva === false ? 'NO' : '');
      if (incluyeVal) incluyeVal.value = incluye ? 'SI' : (m.incluye_iva === false ? 'NO' : '');

      if (exentoSi)  exentoSi.checked  = exento;
      if (exentoNo)  exentoNo.checked  = m.exento_iva === false;
      if (ivaContEl2) ivaContEl2.style.display = exento ? 'none' : '';
      if (incluyeSi) incluyeSi.checked = incluye;
      if (incluyeNo) incluyeNo.checked = m.incluye_iva === false;

      calcularTributosEdit();
    }

    // Proveedor
    const selProv = document.getElementById('edit-mov-proveedor');
    if (selProv) {
      selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
        + proveedores.map(function(p) {
            return '<option value="' + p.id_proveedor + '"' + (m.id_proveedor == p.id_proveedor ? ' selected' : '') + '>'
              + p.nombre + (p.rif ? ' (' + p.rif + ')' : '') + '</option>';
          }).join('');
    }
    // Cliente
    const clienteEl = document.getElementById('edit-mov-cliente');
    if (clienteEl) clienteEl.value = m.cliente_nombre || '';
    // Área origen
    const selOrig = document.getElementById('edit-mov-area-origen');
    if (selOrig) {
      selOrig.innerHTML = '<option value="">— Seleccionar área —</option>'
        + areas.map(function(a) {
            return '<option value="' + a.id + '"' + (m.id_area_origen == a.id ? ' selected' : '') + '>'
              + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
          }).join('');
    }
    // Precio Venta
    // Modalidad de Pago — inferir desde CxP si es null
    let esquemaPago = m.esquema_pago || '';
    if (!esquemaPago) {
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&select=id_cxp&limit=2');
        esquemaPago = (cxps && cxps.length > 1) ? 'CREDITO' : (cxps && cxps.length === 1 ? 'CONTADO' : '');
      } catch(e) {}
    }
    const selPago = document.getElementById('edit-mov-esquema-pago');
    if (selPago) selPago.value = esquemaPago;

    // Mostrar Condiciones de Crédito si aplica
    const creditoCont = document.getElementById('edit-mov-credito-cont');
    // Limpiar siempre los campos de crédito antes de cargar
    const numElC  = document.getElementById('edit-mov-cuotas-num');
    const fechaElC = document.getElementById('edit-mov-cuotas-fecha');
    const montoElC = document.getElementById('edit-mov-cuotas-monto');
    const intElC  = document.getElementById('edit-mov-cuotas-intervalo');
    const prevElC = document.getElementById('edit-mov-cuotas-preview');
    if (numElC)   numElC.value   = '';
    if (fechaElC) fechaElC.value = '';
    if (montoElC) montoElC.value = '';
    if (intElC)   intElC.value   = '30';
    if (prevElC)  prevElC.innerHTML = '';

    if (creditoCont) creditoCont.style.display = esquemaPago === 'CREDITO' ? '' : 'none';
    if (esquemaPago === 'CREDITO') {
      try {
        const _urlCuotas = '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&order=fecha_vencimiento.asc&select=monto_usd,fecha_vencimiento';
        console.log('[SYD] buscando cuotas URL:', _urlCuotas);
        const cuotasExist = await api('cont_cxp', 'GET', null, _urlCuotas);
        console.log('[SYD] cuotasExist:', JSON.stringify(cuotasExist));
        if (cuotasExist && cuotasExist.length > 0) {
          const numEl   = document.getElementById('edit-mov-cuotas-num');
          const fechaEl = document.getElementById('edit-mov-cuotas-fecha');
          const montoEl = document.getElementById('edit-mov-cuotas-monto');
          if (numEl)   numEl.value   = cuotasExist.length;
          if (fechaEl) fechaEl.value = cuotasExist[0].fecha_vencimiento?.slice(0,10) || '';
          if (montoEl) montoEl.value = parseFloat(cuotasExist[0].monto_usd || 0).toFixed(2);
          // Intervalo: calcular desde fechas si hay más de una cuota
          if (cuotasExist.length > 1) {
            const f1 = new Date(cuotasExist[0].fecha_vencimiento + 'T00:00:00');
            const f2 = new Date(cuotasExist[1].fecha_vencimiento + 'T00:00:00');
            const diff = Math.round((f2 - f1) / (1000*60*60*24));
            const intEl = document.getElementById('edit-mov-cuotas-intervalo');
            if (intEl && diff > 0) intEl.value = diff;
          }
          setTimeout(calcularCuotasEdit, 150);
        }
      } catch(e) {}
    }
  }  // fin if (esEntrada)

  // Área receptora
  const selArea = document.getElementById('edit-mov-area');
  if (selArea) {
    selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
      + areas.map(function(a) {
          return '<option value="' + a.id + '"' + (m.id_area == a.id ? ' selected' : '') + '>'
            + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
        }).join('');
  }

  // Empleado receptor
  if (m.id_area) {
    await cargarEmpleadosPorArea(m.id_area, 'edit-mov-empleado');
    const empEl = document.getElementById('edit-mov-empleado'); if (empEl) empEl.value = m.id_empleado || '';
  } else {
    const empEl2 = document.getElementById('edit-mov-empleado'); if (empEl2) empEl2.innerHTML = '<option value="">— Seleccionar área primero —</option>';
  }

  // Siempre abre en modo lectura; solo se habilita con el botón EDITAR explícito
  _aplicarSoloLecturaMovimiento('ENTRADA', true);

  // Badge "PAGADO" — solo informativo, independiente del permiso de edición
  const badgePago = document.getElementById('edit-mov-badge-pago');
  if (badgePago) {
    if (soloLectura && _editMovEstaPagado) {
      badgePago.textContent = '✅ PAGADO';
      badgePago.style.cssText = 'display:inline-block;color:#22c55e;background:rgba(34,197,94,0.12);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:700';
    } else {
      badgePago.style.display = 'none';
    }
  }
  const claveEl = document.getElementById('edit-mov-clave');
  if (claveEl) claveEl.value = '';

  const modalHist = document.getElementById('modal-historial-stock');
  if (modalHist) { modalHist.classList.remove('abierto'); modalHist.style.display = 'none'; }
  console.log('[SYD] abriendo modal ENTRADA');
  abrirModal('modal-edit-movimiento');
  } catch(e) { console.error('[SYD] editarMovimiento ERROR:', e.message, e.stack); }
}

async function anularDesdeEdicion() {
  const tipo        = document.getElementById('edit-mov-tipo').value;
  const id          = parseInt(document.getElementById('edit-mov-id').value);
  const id_articulo = parseInt(document.getElementById('edit-mov-id-articulo').value);
  const cantidad    = parseFloat(document.getElementById(tipo === 'SALIDA' ? 'edit-sal-cantidad' : 'edit-mov-cantidad').value) || 0;

  if (!confirm('¿Anular este movimiento? Esta acción revertirá el stock y los asientos contables.')) return;

  // Cerrar modal de edición antes de abrir modal de anulación
  cerrarModal('modal-edit-movimiento');

  if (tipo === 'ENTRADA') {
    await anularMovimiento('ENTRADA', id, cantidad, id_articulo);
  } else {
    await anularSalidaStock(id, id_articulo, cantidad);
  }
}

async function guardarEdicionMovimiento() {
  // Guardia de permiso — independiente de que la UI oculte/deshabilite los campos.
  // Evita que se pueda invocar esta función directamente (p.ej. desde la consola
  // del navegador) sin tener el permiso EDITAR_STOCK.
  if (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')) {
    alert('No tiene permiso para editar movimientos de stock.');
    return;
  }
  // Protección contra doble clic / doble ejecución -- sin esto, un doble
  // clic (o una red lenta) podía duplicar el asiento contable y la CxP.
  if (window._guardandoEdicionMov) return;
  window._guardandoEdicionMov = true;
  const btnGuardarEdicion = document.getElementById('btn-guardar-movimiento');
  const textoOriginalBtnEdicion = btnGuardarEdicion ? btnGuardarEdicion.textContent : 'GUARDAR';
  if (btnGuardarEdicion) { btnGuardarEdicion.disabled = true; btnGuardarEdicion.textContent = 'Procesando...'; }
  try {
    await _guardarEdicionMovimientoInterno();
  } finally {
    window._guardandoEdicionMov = false;
    if (btnGuardarEdicion) { btnGuardarEdicion.disabled = false; btnGuardarEdicion.textContent = textoOriginalBtnEdicion; }
  }
}

async function _guardarEdicionMovimientoInterno() {
  const tipo        = document.getElementById('edit-mov-tipo').value;
  const id          = parseInt(document.getElementById('edit-mov-id').value);
  const id_articulo = parseInt(document.getElementById('edit-mov-id-articulo').value);
  const esSalida    = tipo === 'SALIDA';
  const id_area     = parseInt((esSalida ? document.getElementById('edit-sal-area') : document.getElementById('edit-mov-area'))?.value) || null;
  const idEmp       = parseInt((esSalida ? document.getElementById('edit-sal-empleado') : document.getElementById('edit-mov-empleado'))?.value) || null;
  const obs         = (esSalida ? document.getElementById('edit-sal-observaciones') : (document.getElementById('edit-mov-observaciones') || document.getElementById('edit-mov-obs')))?.value?.trim() || '';
  const clave       = (esSalida ? document.getElementById('edit-sal-clave') : document.getElementById('edit-mov-clave'))?.value || '';
  const cantidad    = parseFloat((esSalida ? document.getElementById('edit-sal-cantidad') : document.getElementById('edit-mov-cantidad'))?.value) || 0;
  const okEl        = document.getElementById('alerta-edit-mov-ok');
  const errEl       = document.getElementById('alerta-edit-mov-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const mostrarError = function(msg, focusId) {
    errEl.textContent = msg; errEl.style.display = 'block';
    // Sin esto el mensaje queda arriba del modal, fuera de la vista si el
    // Usuario está viendo campos más abajo (p.ej. la Contraseña) -- parecía
    // que el botón GUARDAR "no hacía nada" cuando en realidad sí mostraba
    // el error, solo que no se veía sin desplazarse manualmente hacia arriba.
    // IMPORTANTE: el focus() de abajo, si no se le indica preventScroll,
    // hace su propio scroll automático hacia el campo -- eso le "ganaba" a
    // este scroll hacia el mensaje y el Usuario terminaba viendo el campo
    // pero nunca el mensaje rojo. Por eso el focus usa preventScroll:true.
    setTimeout(function() { errEl.scrollIntoView({behavior:'smooth', block:'start'}); }, 30);
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({preventScroll:true}); }
  };

  // ── Validaciones en orden de pantalla ──
  if (tipo === 'SALIDA') {
    // Revalidación fresca (no confiar solo en lo cargado al abrir la ficha):
    // si el receptor ya confirmó la recepción mientras se tenía la ficha
    // abierta, bloquear el guardado -- el stock destino ya se acreditó con
    // la información original, no se puede alterar por debajo.
    try {
      const notifFresca = await api('notificaciones', 'GET', null,
        '?tipo=eq.RECEPCION_ARTICULO&id_salida=eq.' + id + '&order=id.desc&limit=1&select=id,estado');
      if (notifFresca && notifFresca[0] && notifFresca[0].estado === 'APROBADO') {
        return mostrarError('El receptor ya confirmó la recepción de esta Salida. No se puede editar.');
      }
    } catch(eNotifFresh) { console.warn('Error revalidando notificación:', eNotifFresh); }
    const salFecha = document.getElementById('edit-sal-fecha')?.value;
    if (!salFecha) return mostrarError('Seleccione la Fecha de Salida.', 'edit-sal-fecha');
    // El Área Receptora ahora SÍ es editable (mientras la notificación siga
    // PENDIENTE -- ya se revalidó arriba) -- pero solo aplica a entregas
    // Área↔Área. Si el recuadro "Quien Recibe" está oculto, es porque esta
    // Salida es una Venta directa a Cliente (id_area null desde su origen,
    // generada automática al facturar una OS) -- ahí no hay Área que exigir.
    const areaRecVisible = document.getElementById('edit-sal-area-cont')?.style.display !== 'none';
    if (areaRecVisible && !id_area) return mostrarError('Seleccione el Área Receptora.', 'edit-sal-area');
  }
  if (tipo === 'ENTRADA') {
    const fechaNeg = document.getElementById('edit-mov-fecha-negociacion')?.value;
    const hoy      = getHoyVzla();
    if (!fechaNeg)         return mostrarError('Seleccione la Fecha Negociación.', 'edit-mov-fecha-negociacion');
    if (fechaNeg > hoy)    return mostrarError('La Fecha Negociación no puede ser mayor al día de hoy.', 'edit-mov-fecha-negociacion');
    const monedaSel = document.getElementById('edit-mov-moneda')?.value;
    if (!monedaSel)        return mostrarError('Seleccione la Moneda Negociación.', 'edit-mov-moneda');
  }
  if (!cantidad || cantidad <= 0) return mostrarError('La cantidad debe ser mayor a cero.', esSalida ? 'edit-sal-cantidad' : 'edit-mov-cantidad');
  if (tipo === 'ENTRADA') {
    const precioVal = parseMontoVE(document.getElementById('edit-mov-precio')?.value);
    if (precioVal <= 0)    return mostrarError('Ingrese el Precio Negociación.', 'edit-mov-precio');
    const motivoSel = document.getElementById('edit-mov-motivo')?.value;
    if (!motivoSel)        return mostrarError('Seleccione la Transacción.', 'edit-mov-motivo');
    if (motivoSel === 'compra' && !document.getElementById('edit-mov-proveedor')?.value)
                           return mostrarError('Seleccione el Proveedor.', 'edit-mov-proveedor');
    if (motivoSel === 'devolucion' && !document.getElementById('edit-mov-cliente')?.value?.trim())
                           return mostrarError('Ingrese el nombre del cliente.', 'edit-mov-cliente');
    if (motivoSel === 'transferencia' && !document.getElementById('edit-mov-area-origen')?.value)
                           return mostrarError('Seleccione el Área de Origen.', 'edit-mov-area-origen');
    const pagoSel = document.getElementById('edit-mov-esquema-pago')?.value;
    if (!pagoSel) return mostrarError('Seleccione la Modalidad de Pago.', 'edit-mov-esquema-pago');
    if (pagoSel === 'CREDITO') {
      const numCuotasVal  = parseInt(document.getElementById('edit-mov-cuotas-num')?.value) || 0;
      const fechaCuotaVal = document.getElementById('edit-mov-cuotas-fecha')?.value || '';
      if (!numCuotasVal || numCuotasVal < 1) return mostrarError('Ingrese el número de cuotas.', 'edit-mov-cuotas-num');
      if (!fechaCuotaVal) return mostrarError('Ingrese la Fecha de la Primera Cuota.', 'edit-mov-cuotas-fecha');
      if (fechaCuotaVal <= getHoyVzla()) return mostrarError('La Fecha de la Primera Cuota tiene que ser mayor que el día de hoy.', 'edit-mov-cuotas-fecha');
    }
    if (motivoSel === 'compra') {
      try {
        const cxpsBloqueo = await api('cont_cxp','GET',null,
          '?numero_doc=ilike.'+encodeURIComponent('ENT-'+id+'*')+emisorQ()+'&select=numero_doc,estado');
        const bloqueante = (cxpsBloqueo||[]).find(function(cx){ return cx.estado === 'PAGADA' || cx.estado === 'PARCIAL'; });
        if (bloqueante) {
          return mostrarError('No se puede editar: la CxP "'+bloqueante.numero_doc+'" ya está '+bloqueante.estado+'. Anule el pago primero (Pagos → esa CxP → botón "🗑 Anular Pago Ejecutado") antes de corregir este movimiento.');
        }
      } catch(eChkCxp) { console.warn('Error verificando estado de CxP:', eChkCxp); }
    }
  }
  if (!clave) return mostrarError('El empleado que modifica debe ingresar su contraseña.', esSalida ? 'edit-sal-clave' : 'edit-mov-clave');

  const btnGuardar = document.getElementById('btn-guardar-movimiento');
  const textoOriginalBtn = btnGuardar ? btnGuardar.textContent : 'GUARDAR';
  if (btnGuardar) { btnGuardar.textContent = 'GUARDANDO...'; btnGuardar.disabled = true; }

  try {
    // ── Verificar contraseña ──
    try {
      const verifEdit = await verificarContrasena(sesionActual.correo_usuario, clave);
      if (!verifEdit.ok) return mostrarError('Contraseña incorrecta.', 'edit-mov-clave');
    } catch(eV) { return mostrarError('Error verificando contraseña: ' + eV.message); }

    try {
      const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });

    const datos = {
      cantidad:             cantidad,
      id_area:              id_area,
      id_empleado:          idEmp,
      observaciones:        obs || null,
    };

    // Campos específicos de SALIDA
    if (tipo === 'SALIDA') {
      const salFechaVal = document.getElementById('edit-sal-fecha')?.value;
      if (salFechaVal) datos.fecha_salida = salFechaVal;
      const pvSalEl = document.getElementById('edit-sal-precio-venta');
      const pvSal   = (pvSalEl?.value !== '' && pvSalEl?.value != null) ? parseFloat(pvSalEl.value) : null;
      const monSalEl = document.getElementById('edit-sal-moneda-venta');
      const monSal   = monSalEl?.value || 'USD';
      if (pvSal !== null) {
        datos.precio_venta_moneda = pvSal;
        datos.moneda_venta        = monSal;
        try { await api('inventario_almacen','PATCH',{ precio_venta_moneda: pvSal, moneda_venta: monSal },'?id_articulo=eq.'+id_articulo); } catch(e) {}
      }
    }

    if (tipo === 'ENTRADA') {
      const precioRaw  = document.getElementById('edit-mov-precio').value;
      const precioParseado = parseMontoVE(precioRaw);
      const precioNegociado = precioRaw !== '' && precioParseado > 0 ? precioParseado : null;
      const exentoEdit  = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
      const incluyeEdit = document.getElementById('edit-mov-incluye-iva-val')?.value === 'SI';
      // precioNegociado es el precio TAL COMO se negoció (puede traer IVA
      // incluido); precio_costo_moneda debe guardar siempre la BASE sin IVA
      // — misma conversión que se aplica al crear la entrada (inventario2.js)
      const precio = (precioNegociado !== null && !exentoEdit && incluyeEdit)
        ? parseFloat((precioNegociado / (1+tasaIVAActual())).toFixed(4))
        : precioNegociado;
      // Monto TOTAL (con IVA si aplica) — se calcula UNA sola vez aquí, a
      // partir del precio NEGOCIADO original (sin redondeos intermedios),
      // y se reutiliza tanto para reconstruir el asiento como la CxP
      const montoTotalConIVAEdit = precioNegociado === null ? null : (exentoEdit
        ? parseFloat((precioNegociado * cantidad).toFixed(2))
        : parseFloat((precioNegociado * cantidad * (incluyeEdit ? 1 : (1+tasaIVAActual()))).toFixed(2)));
      const monedaEdit = document.getElementById('edit-mov-moneda')?.value || 'USD';
      const fechaNeg   = document.getElementById('edit-mov-fecha-negociacion')?.value || getHoyVzla();
      const motivoEdit = document.getElementById('edit-mov-motivo')?.value || '';
      const provEdit   = parseInt(document.getElementById('edit-mov-proveedor')?.value) || null;
      const clienteEdit = document.getElementById('edit-mov-cliente')?.value?.trim() || null;
      const areaOrig   = parseInt(document.getElementById('edit-mov-area-origen')?.value) || null;
      const pagoEdit   = document.getElementById('edit-mov-esquema-pago')?.value || '';
      const pvEdit     = parseFloat(document.getElementById('edit-mov-precio-venta')?.value) || null;

      if (precio !== null) datos.precio_costo_moneda = precio;
      if (precioNegociado !== null) datos.precio_compra_original = precioNegociado;
      datos.exento_iva          = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI' ? true
                                   : (document.getElementById('edit-mov-exento-iva-val')?.value === 'NO' ? false : null);
      datos.incluye_iva         = exentoEdit ? null
                                   : (document.getElementById('edit-mov-incluye-iva-val')?.value === 'SI' ? true
                                   : (document.getElementById('edit-mov-incluye-iva-val')?.value === 'NO' ? false : null));
      datos.moneda_compra       = monedaEdit;
      datos.fecha_negociacion   = fechaNeg;
      datos.fecha_entrada       = fechaNeg;
      datos.motivo              = motivoEdit;
      datos.id_proveedor        = provEdit;
      datos.cliente_nombre      = clienteEdit;
      datos.id_area_origen      = areaOrig;
      datos.esquema_pago        = pagoEdit;

      // ── Leer cantidad original ANTES de parchear ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_entradas', 'GET', null, '?id_entrada=eq.' + id + '&select=cantidad'),
        api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=precio_costo_moneda'),
      ]);
      const cantOriginal = parseFloat(movOrigArr[0]?.cantidad || cantidad);
      const art = artArr[0];

      // ── PATCH a stock_entradas ──
      await api('stock_entradas', 'PATCH', datos, '?id_entrada=eq.' + id);

      // ── Ajustar el stock del ÁREA por la diferencia (delta), NO recalcular
      // un total global desde cero — el stock real vive en inventario_stock_area,
      // repartido por área, así que no existe un "total" único que reconstruir. ──
      const deltaCantidad = cantidad - cantOriginal;
      if (id_area && deltaCantidad !== 0) {
        await upsertStockArea(id_articulo, id_area, deltaCantidad);
      }

      // ── Recalcular el CPP del artículo desde CERO, reproduciendo toda su
      // historia de Entradas en orden cronológico (con el precio YA
      // corregido de esta que se acaba de editar). No se puede "restar" la
      // contribución de esta transacción del CPP actual, porque el CPP
      // actual YA incluye esa contribución original (posiblemente
      // equivocada) -- sería una referencia circular. El CPP es global por
      // artículo (no por área), así que sí se recalcula completo.
      let cppEditado = null;
      if (art) {
        const entradasHist = await api('stock_entradas', 'GET', null,
            '?id_articulo=eq.' + id_articulo + '&or=(anulada.eq.false,anulada.is.null)&order=fecha_registro.asc&select=cantidad,precio_costo_moneda');
        let stockRepro = 0, cppRepro = 0;
        (entradasHist || []).forEach(function(e) {
          const cantE = parseFloat(e.cantidad) || 0;
          const precE = parseFloat(e.precio_costo_moneda) || 0;
          const nuevoStockRepro = stockRepro + cantE;
          cppRepro = nuevoStockRepro > 0 ? ((stockRepro * cppRepro) + (cantE * precE)) / nuevoStockRepro : precE;
          stockRepro = nuevoStockRepro;
        });
        cppEditado = parseFloat(cppRepro.toFixed(4));
        const patchInv = { precio_costo_moneda: cppEditado };
        if (precio !== null && !isNaN(precio)) patchInv.precio_costo_ultimo_moneda = precio;
        await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);
      }

      // ── Reconstruir asiento contable desde cero ──
      // (antes esto "corregía" el asiento sobreescribiendo cualquier línea
      // con monto > 0 al mismo valor total, sin distinguir Inventario de
      // IVA — dañaba el asiento en vez de corregirlo. Ahora se borra el
      // asiento viejo y se regenera con la misma función que se usa al
      // crear una entrada nueva, ya con los fixes de IVA aplicados)
      if (true) try {
        const ref = 'ENT-' + id;
        const asientosViejos = await api('cont_asientos', 'GET', null,
          '?referencia=eq.' + ref + emisorQ() + '&estado=neq.ANULADO&select=id_asiento,tasa_bcv');
        let tasaParaAsiento = null;
        if (asientosViejos && asientosViejos.length) {
          const idAstViejo = asientosViejos[0].id_asiento;
          tasaParaAsiento = parseFloat(asientosViejos[0].tasa_bcv) || null;
          await api('cont_asiento_lineas', 'DELETE', null, '?id_asiento=eq.' + idAstViejo);
          await api('cont_asientos', 'DELETE', null, '?id_asiento=eq.' + idAstViejo);
        }
        if (motivoEdit !== 'transferencia' && montoTotalConIVAEdit !== null) {
          const tipoAstEdit = motivoEdit === 'compra' ? 'ENTRADA_COMPRA'
                            : motivoEdit === 'devolucion' ? 'ENTRADA_DEVOLUCION'
                            : 'ENTRADA_AJUSTE';
          const areaNombreEdit = document.getElementById('edit-mov-area')?.selectedOptions?.[0]?.textContent
                                  || document.getElementById('edit-mov-area')?.selectedOptions?.[0]?.text || 'Área';
          await generarAsientoInventario(tipoAstEdit, {
            articulo:   r?.nombre_articulo || r?.codigo_articulo || ('Art#' + id_articulo),
            cantidad:   cantidad,
            montoUSD:   montoTotalConIVAEdit,
            areaId:     id_area,
            areaNombre: areaNombreEdit,
            referencia: ref,
            id_cuentaInventario: r?.id_cuenta_contable || null,
            fecha:      fechaNeg,
            tasa:       tasaParaAsiento,
            incluyeIVA: true,
            exentoIVA:  exentoEdit,
            // Base EXACTA = el mismo CPP ya recalculado y guardado en
            // inventario_almacen, para que coincida con lo que la SALIDA
            // usará después
            baseExactaUSD: cppEditado > 0 ? parseFloat((cantidad * cppEditado).toFixed(4)) : null,
            baseExactaBs:  (cppEditado > 0 && tasaParaAsiento) ? parseFloat((cantidad * cppEditado * tasaParaAsiento).toFixed(2)) : null
          });
        }
      } catch(eAstEdit) { console.warn('Error reconstruyendo asiento:', eAstEdit); }

      // ── Actualizar CxP asociada ──
      try {
        const numDocBase = 'ENT-' + id;
        const artNom = r?.nombre_articulo || ('Art#' + id_articulo);
        // Reutilizar el mismo total ya calculado arriba (montoTotalConIVAEdit),
        // para que la CxP siempre coincida exactamente con el asiento
        const nuevoMontoUSD = montoTotalConIVAEdit !== null ? montoTotalConIVAEdit
          : parseFloat((cantidad * parseFloat(art?.precio_costo_moneda || 0) * (1+tasaIVAActual())).toFixed(2));

        // Eliminar CxP existentes PENDIENTES o RECHAZADAS para esta entrada
        // (si venía RECHAZADA, hay que limpiarla igual antes de crear la
        // nueva -- de lo contrario queda huérfana y se duplica la obligación)
        const cxpsExist = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent(numDocBase + '*') + emisorQ() + '&estado=in.(PENDIENTE,RECHAZADA)&select=id_cxp');
        for (const cx of (cxpsExist || [])) {
          await api('cont_cxp', 'DELETE', null, '?id_cxp=eq.' + cx.id_cxp);
        }

        const idProvEdit = provEdit || null;
        let tasaEdit = parseFloat(art?.tasa_bcv || 0);
        if (!tasaEdit) {
          try {
            const tasaRowsEdit = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaNeg+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
            if (tasaRowsEdit && tasaRowsEdit[0]) tasaEdit = parseFloat(tasaRowsEdit[0].tipo_cambio);
          } catch(e) {}
        }
        if (!tasaEdit) tasaEdit = _tasaVigente || 0;
        // Si aun así no hay tasa válida, DETENER -- de lo contrario el
        // monto_ves quedaría igual al monto_usd (tasa 1:1), como pasó con
        // una CxP real de $30 USD que se guardó como Bs 30.
        if (!tasaEdit || tasaEdit <= 1) {
          errEl.textContent = 'No se encontró una Tasa BCV válida para la Fecha de Negociación. Registre la tasa del día en Parámetros → Tasas de Cambio antes de continuar.';
          errEl.style.display = 'block';
          return;
        }

        if (pagoEdit === 'CREDITO') {
          // Crear cuotas desde el preview
          const prevEl = document.getElementById('edit-mov-cuotas-preview');
          const cuotasData = prevEl?.dataset?.cuotas ? JSON.parse(prevEl.dataset.cuotas) : [];
          if (cuotasData.length) {
            const totalVesCuotasEdit = parseFloat((nuevoMontoUSD * tasaEdit).toFixed(2));
            let acumVesCuotasEdit = 0;
            for (let iCuota = 0; iCuota < cuotasData.length; iCuota++) {
              const c = cuotasData[iCuota];
              const esUltimaCuotaEdit = iCuota === cuotasData.length - 1;
              // La última cuota absorbe el residuo de redondeo en Bs
              const montoVesCuotaEdit = esUltimaCuotaEdit
                ? parseFloat((totalVesCuotasEdit - acumVesCuotasEdit).toFixed(2))
                : parseFloat((c.monto * tasaEdit).toFixed(2));
              acumVesCuotasEdit = parseFloat((acumVesCuotasEdit + montoVesCuotaEdit).toFixed(2));
              const cxpCuotaEditCreada = await api('cont_cxp', 'POST', {
                id_proveedor:    idProvEdit,
                id_empresa:      _empresaActiva?.id_empresa || null,
                id_cuenta_gasto: r?.id_cuenta_costo_gasto || null,
                tipo:            'COMPRA_ARTICULO_CREDITO',
                numero_doc:      numDocBase + '-C' + c.num,
                fecha_emision:   fechaNeg,
                fecha_vencimiento: c.fecha,
                moneda_pago:     monedaEdit || 'USD',
                estado:          'PENDIENTE',
                monto_usd:       parseFloat(c.monto.toFixed(2)),
                monto_ves:       montoVesCuotaEdit,
                tasa_bcv:        tasaEdit,
                tasa_bcv_compra: tasaEdit,
                pagado_usd:      0,
                saldo_usd:       parseFloat(c.monto.toFixed(2)),
                observaciones:   artNom + ' x ' + cantidad + ' uds.',
                esquema_pago:    'CREDITO',
                id_usuario:      sesionActual?.correo_usuario || null
              });
              // Agregar el id_cxp real al numero_doc para que nunca se repita
              if (cxpCuotaEditCreada && cxpCuotaEditCreada[0]) {
                await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-C' + c.num + '-' + cxpCuotaEditCreada[0].id_cxp }, '?id_cxp=eq.' + cxpCuotaEditCreada[0].id_cxp);
                // Reenviar a aprobación -- la corrección debe volver a pasar
                // por el Aprobador, igual que cuando se creó la Entrada
                if (c.fecha <= getHoyVzla()) {
                  enrutarAprobacionCxP(cxpCuotaEditCreada[0].id_cxp, numDocBase + '-C' + c.num + '-' + cxpCuotaEditCreada[0].id_cxp, c.monto);
                } else {
                  api('cont_cxp','PATCH',{ sin_firma_notificado: true }, '?id_cxp=eq.'+cxpCuotaEditCreada[0].id_cxp).catch(function(){});
                }
              }
            }
          }
        } else {
          // CONTADO — una sola CxP
          const cxpEditContadoCreada = await api('cont_cxp', 'POST', {
            id_proveedor:    idProvEdit,
            id_empresa:      _empresaActiva?.id_empresa || null,
            id_cuenta_gasto: r?.id_cuenta_costo_gasto || null,
            tipo:            'COMPRA_ARTICULO',
            numero_doc:      numDocBase,
            fecha_emision:   fechaNeg,
            fecha_vencimiento: fechaNeg,
            moneda_pago:     monedaEdit || 'USD',
            estado:          'PENDIENTE',
            monto_usd:       nuevoMontoUSD,
            monto_ves:       parseFloat((nuevoMontoUSD * tasaEdit).toFixed(2)),
            tasa_bcv:        tasaEdit,
            tasa_bcv_compra: tasaEdit,
            pagado_usd:      0,
            saldo_usd:       nuevoMontoUSD,
            observaciones:   artNom + ' x ' + cantidad + ' uds.',
            esquema_pago:    'CONTADO',
            id_usuario:      sesionActual?.correo_usuario || null
          });
          // Agregar el id_cxp real al numero_doc para que nunca se repita
          if (cxpEditContadoCreada && cxpEditContadoCreada[0]) {
            await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-' + cxpEditContadoCreada[0].id_cxp }, '?id_cxp=eq.' + cxpEditContadoCreada[0].id_cxp);
            // Reenviar a aprobación -- la corrección debe volver a pasar
            // por el Aprobador, igual que cuando se creó la Entrada
            enrutarAprobacionCxP(cxpEditContadoCreada[0].id_cxp, numDocBase + '-' + cxpEditContadoCreada[0].id_cxp, nuevoMontoUSD);
          }
        }
      } catch(eCxPEdit) { console.warn('Error actualizando CxP:', eCxPEdit); }

      // ── Si esta Entrada estaba EN_REVISION (CxP rechazada), la corrección
      // recién guardada la resuelve -- limpiar el estado y marcar como
      // resueltas las notificaciones pendientes asociadas (tanto la de
      // rechazo al Operador como una posible escalada al Superior), para
      // que dejen de reaparecer.
      try {
        await api('stock_entradas','PATCH',{ estado_revision: null },'?id_entrada=eq.'+id);
        const notifsRevRes = await api('notificaciones','GET',null,
          '?estado=eq.PENDIENTE&datos_extra=ilike.*%22id_entrada%22%3A'+id+'*&select=id');
        for (const nRes of (notifsRevRes||[])) {
          await api('notificaciones','PATCH',{ estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },'?id=eq.'+nRes.id);
        }
      } catch(eResRev) { console.warn('Error resolviendo notificaciones de revisión:', eResRev); }

    } else {
      // ── SALIDA ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_salidas',     'GET', null, '?id_salida=eq.'    + id          + '&select=cantidad,id_area,id_area_entrega,id_empleado'),
        api('inventario_almacen','GET', null, '?id_articulo=eq.'  + id_articulo + '&select=id_cuenta_contable,nombre_articulo,codigo_articulo'),
      ]);
      const movOrig = movOrigArr[0] || {};
      const cantOriginal = parseFloat(movOrig?.cantidad || cantidad);
      const art = artArr[0];
      await api('stock_salidas', 'PATCH', datos, '?id_salida=eq.' + id);

      // Ajustar el stock por ÁREA según la diferencia (delta) — no un total
      // global. El área que entregó (Compras) siempre se ajusta de inmediato
      // (su stock sale al crear la Salida, sin esperar confirmación alguna).
      const deltaCantSal = cantidad - cantOriginal;
      if (deltaCantSal !== 0 && movOrig.id_area_entrega) {
        await upsertStockArea(id_articulo, movOrig.id_area_entrega, -deltaCantSal);
      }

      let esMercanciaEdit = false;
      if (art?.id_cuenta_contable) {
        const ctaEdit = (await obtenerCuentasContables()).find(function(c){ return c.id_cuenta === art.id_cuenta_contable; });
        esMercanciaEdit = !!(ctaEdit && ctaEdit.codigo === '1.1.03.001');
      }

      if (movOrig.id_empleado) {
        // Esta Salida pasó (y sigue pasando) por el flujo de Notificación de
        // Recepción -- el Área destino NO ha recibido nada todavía (se
        // acredita recién al Confirmar, ver notifConfirmar() en core.js). Ya
        // se revalidó arriba que sigue PENDIENTE, así que en vez de tocar el
        // stock del Área destino ahora, se anulan TODAS las notificaciones
        // pendientes que queden de esta Salida y se genera una nueva con los
        // datos ya actualizados -- cuando el receptor confirme, se
        // acreditará la cantidad CORRECTA.
        //
        // IMPORTANTE: se anulan TODAS (no solo la más reciente) porque de
        // ediciones anteriores (antes de este fix) pudieron quedar varias
        // huérfanas en PENDIENTE sin anular -- si solo se anula la última,
        // las demás sobreviven y el receptor puede terminar confirmando una
        // vieja con datos obsoletos, acreditando stock de más.
        try {
          const notifsViejas = await api('notificaciones', 'GET', null,
            '?tipo=eq.RECEPCION_ARTICULO&id_salida=eq.' + id + '&estado=eq.PENDIENTE&order=id.desc&select=id,correo_destino');
          if (notifsViejas && notifsViejas.length) {
            // 1. Anular TODAS las pendientes -- esto es lo CRÍTICO, tiene que
            // pasar sí o sí. Va en su propio try separado de los nombres de
            // Área (solo cosméticos para el texto del mensaje) para que un
            // fallo ahí no tumbe lo esencial, como pasó con el bug de
            // "param_areas.id_area does not exist" (la columna real es "id").
            await api('notificaciones', 'PATCH',
              { estado: 'ANULADO', fecha_respuesta: new Date().toISOString() },
              '?id=in.(' + notifsViejas.map(function(n){ return n.id; }).join(',') + ')');
            const correoDestViejo = notifsViejas[0].correo_destino;

            // 2. Nombres de Área para el texto del mensaje -- si esto falla,
            // se sigue igual con nombres genéricos, no se aborta la creación
            // de la notificación nueva (eso sí sería grave: dejaría la vieja
            // anulada sin ninguna PENDIENTE que la reemplace).
            let nombreOrigen = 'Almacén', nombreDest = 'Área';
            try {
              const [areaOrigenRow, areaDestRow] = await Promise.all([
                movOrig.id_area_entrega ? api('param_areas','GET',null,'?id=eq.'+movOrig.id_area_entrega+'&select=nombre') : Promise.resolve(null),
                id_area                 ? api('param_areas','GET',null,'?id=eq.'+id_area+'&select=nombre')                 : Promise.resolve(null),
              ]);
              nombreOrigen = areaOrigenRow?.[0]?.nombre || nombreOrigen;
              nombreDest   = areaDestRow?.[0]?.nombre   || nombreDest;
            } catch(eNombresArea) { console.warn('No se pudieron obtener nombres de Área (se usan genéricos):', eNombresArea); }

            // 3. Crear la nueva notificación PENDIENTE con los datos ya
            // corregidos -- el correo destino se recalcula con el Empleado
            // ACTUAL del formulario (idEmp), no el de la notificación vieja:
            // si se cambió el Empleado (o el Área), tiene que notificarse al
            // correcto, no reenviarle al anterior.
            const artNomEdit = art?.nombre_articulo || art?.codigo_articulo || ('Art#' + id_articulo);
            let correoDestNuevo = correoDestViejo;
            try {
              if (idEmp) {
                const empNuevo = await api('empleados','GET',null,
                  '?id_empleado=eq.'+idEmp+'&select=correo,usuarios(correo_usuario)');
                correoDestNuevo = empNuevo?.[0]?.correo || empNuevo?.[0]?.usuarios?.correo_usuario || correoDestNuevo;
              }
            } catch(eCorreoNuevo) { console.warn('No se pudo obtener el correo del Empleado actual (se reutiliza el anterior):', eCorreoNuevo); }
            await api('notificaciones', 'POST', {
              tipo:           'RECEPCION_ARTICULO',
              id_empresa:      _empresaActiva?.id_empresa || null,
              correo_destino: correoDestNuevo,
              titulo:         'Solicitud de Recepción de Artículo (actualizada)',
              mensaje:        cantidad + ' unid. de "' + artNomEdit + '" enviadas desde ' + nombreOrigen + ' hacia ' + nombreDest + '. Información corregida -- por favor confirme la recepción.',
              estado:         'PENDIENTE',
              id_salida:      id,
              datos_extra:    JSON.stringify({ id_articulo: id_articulo, cantidad: cantidad, id_area_origen: movOrig.id_area_entrega, id_area_destino: id_area })
            }, '', true);
          }
        } catch(eNotifEdit) { console.warn('Error anulando/recreando notificación de la Salida editada:', eNotifEdit); }
      } else if (esMercanciaEdit && deltaCantSal !== 0 && movOrig.id_area) {
        // Sin Empleado que Recibe -- el Área destino se acreditó de inmediato
        // al crear la Salida (no hubo notificación de por medio), así que el
        // delta se aplica directo, como siempre.
        await upsertStockArea(id_articulo, movOrig.id_area, deltaCantSal);
      }
    }

    // ── Actualizar cache ──
    try {
      const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
      if (fresh && fresh[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
        if (i !== -1) inventarioCache[i] = fresh[0];
      }
    } catch(e) {}

    okEl.textContent = '✓ Movimiento actualizado correctamente.';
    okEl.style.display = 'block';
    if (document.getElementById('edit-mov-clave')) document.getElementById('edit-mov-clave').value = '';

    setTimeout(async function() {
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      cerrarModal('modal-edit-movimiento');
      if (_fichaInvActual && _fichaInvActual.id) verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
    }, 900);

  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
  }

  } finally {
    if (btnGuardar) { btnGuardar.textContent = textoOriginalBtn; btnGuardar.disabled = false; }
  }
}

function onCambioEsquemaPagoEdit() {
  const esquema = document.getElementById('edit-mov-esquema-pago')?.value;
  const cont    = document.getElementById('edit-mov-credito-cont');
  if (cont) cont.style.display = esquema === 'CREDITO' ? '' : 'none';
  if (esquema === 'CREDITO') calcularCuotasEdit();
}

function calcularCuotasEdit() {
  const numCuotas   = parseInt(document.getElementById('edit-mov-cuotas-num')?.value) || 0;
  const fechaInicio = document.getElementById('edit-mov-cuotas-fecha')?.value || '';
  const intervalo   = parseInt(document.getElementById('edit-mov-cuotas-intervalo')?.value) || 30;
  const precioRawEdit  = parseMontoVE(document.getElementById('edit-mov-precio')?.value);
  const monedaEditC    = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const tasaEditC      = parseFloat(document.getElementById('edit-mov-tasa-bcv')?.value) || 0;
  // El precio se ingresa en la Moneda Negociación (puede ser VES) -- convertir
  // siempre a USD antes de calcular, igual que en Entrada de Stock, para que
  // el total repartido en cuotas coincida con el total realmente guardado
  const precio = monedaEditC === 'VES'
    ? (tasaEditC > 0 ? parseFloat((precioRawEdit / tasaEditC).toFixed(4)) : parseMontoVE(document.getElementById('edit-mov-precio-usd-calc')?.value))
    : precioRawEdit;
  const cantidad    = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const montoCuotaInput = parseFloat(document.getElementById('edit-mov-cuotas-monto')?.value) || 0;
  // precio es el precio NEGOCIADO (puede traer IVA incluido o no, según la
  // bandera) — reconstruir el TOTAL con IVA correctamente antes de repartir
  const exentoCuotas  = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
  const incluyeCuotas = document.getElementById('edit-mov-incluye-iva-val')?.value === 'SI';
  const montoBase = precio * cantidad;
  let totalUSD = parseFloat((exentoCuotas || incluyeCuotas ? montoBase : montoBase * (1+tasaIVAActual())).toFixed(2));
  if (!totalUSD && montoCuotaInput && numCuotas) totalUSD = parseFloat((montoCuotaInput * numCuotas).toFixed(2));
  const preview = document.getElementById('edit-mov-cuotas-preview');
  if (!preview) return;

  if (!numCuotas || !fechaInicio) { preview.innerHTML = ''; return; }

  const montoCuota = montoCuotaInput > 0 ? montoCuotaInput : parseFloat((totalUSD / numCuotas).toFixed(2));

  const montoEl = document.getElementById('edit-mov-cuotas-monto');
  if (montoEl && !montoEl.value && totalUSD > 0) montoEl.value = montoCuota;

  function ajustarHabilLunes(d) {
    var dia = d.getDay();
    if (dia === 6) d.setDate(d.getDate() + 2);
    if (dia === 0) d.setDate(d.getDate() + 1);
    return d;
  }

  const cuotas = [];
  let fecha = ajustarHabilLunes(new Date(fechaInicio + 'T00:00:00'));
  for (let i = 0; i < numCuotas; i++) {
    if (i > 0) {
      fecha = ajustarHabilLunes(new Date(new Date(cuotas[i-1].fecha + 'T00:00:00').setDate(
        new Date(cuotas[i-1].fecha + 'T00:00:00').getDate() + intervalo
      )));
    }
    cuotas.push({
      num:   i + 1,
      fecha: fecha.toISOString().split('T')[0],
      monto: i === numCuotas - 1
        ? parseFloat((totalUSD - montoCuota * (numCuotas - 1)).toFixed(2))
        : montoCuota
    });
  }

  const total = cuotas.reduce(function(s,c){ return s + c.monto; }, 0);
  const diff  = parseFloat((totalUSD - total).toFixed(2));

  preview.innerHTML =
    '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">Vista previa — Total: $ '+fmtUSD(total)
    +(diff !== 0 ? ' <span style="color:#fc8181">(diferencia: $ '+fmtUSD(Math.abs(diff))+')</span>' : ' <span style="color:#22c55e">✓</span>')+'</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Cuota</th>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Fecha Vencimiento</th>'
    +'<th style="padding:6px 8px;text-align:right;color:var(--suave);font-size:10px">Monto USD</th>'
    +'</tr></thead><tbody>'
    + cuotas.map(function(c) {
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:6px 8px;font-weight:600">Cuota '+c.num+'</td>'
          +'<td style="padding:6px 8px;font-family:var(--font-mono)">'+c.fecha+'</td>'
          +'<td style="padding:6px 8px;text-align:right;font-family:var(--font-mono)">$ '+fmtUSD(c.monto)+'</td>'
          +'</tr>';
      }).join('')
    +'</tbody></table></div>';

  // Guardar cuotas en dataset para usarlas al guardar
  preview.dataset.cuotas = JSON.stringify(cuotas);
}

async function anularMovimiento(tipo, idMovimiento, cantidad, id_articulo) {
  // Verificar permiso
  const permiso = tipo === 'ENTRADA' ? 'ANULAR_ENTRADA' : 'ANULAR_SALIDA';
  if (!sesionActual?.administrador && !puedo('INVENTARIO', permiso)) {
    alert('No tiene permiso para anular ' + (tipo === 'ENTRADA' ? 'entradas' : 'salidas') + ' de stock.');
    return;
  }

  // Cargar datos del movimiento para mostrar en el modal
  let movOrig = null;
  try {
    if (tipo === 'ENTRADA') {
      const rows = await api('stock_entradas', 'GET', null,
        '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].anulada) { alert('Este movimiento ya fue anulado.'); return; }
      movOrig = rows[0];
    } else {
      const rows = await api('stock_salidas', 'GET', null,
        '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].anulada) { alert('Este movimiento ya fue anulado.'); return; }
      if (rows[0].id_area) {
        alert('Esta es una entrega entre Áreas -- no se puede anular desde aquí. Si hay que revertirla, use una Transferencia (Entrada de Stock, Área de Origen = el Área que la recibió).');
        return;
      }
      movOrig = rows[0];
    }
  } catch(e) { alert('Error cargando movimiento: ' + e.message); return; }

  // Rellenar modal
  const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
  document.getElementById('anulacion-tipo').value          = tipo;
  document.getElementById('anulacion-id-movimiento').value = idMovimiento;
  document.getElementById('anulacion-id-articulo').value   = id_articulo;
  document.getElementById('anulacion-cantidad').value      = cantidad;
  document.getElementById('anulacion-titulo').textContent  = '⚠ ANULAR ' + tipo + ' DE STOCK';
  document.getElementById('anulacion-info-tipo').textContent     = tipo;
  document.getElementById('anulacion-info-cantidad').textContent = cantidad + ' ' + (r?.unidad || 'UND');
  document.getElementById('anulacion-info-articulo').textContent = r?.nombre_articulo || '—';
  const areaInfo = movOrig.area_receptora
    ? movOrig.area_receptora.nombre + (movOrig.area_receptora.codigo ? ' (' + movOrig.area_receptora.codigo + ')' : '')
    : '—';
  document.getElementById('anulacion-info-area').textContent  = areaInfo;
  const fecha = tipo === 'ENTRADA' ? (movOrig.fecha_entrada || movOrig.fecha_registro) : (movOrig.fecha_salida || movOrig.fecha_registro);
  document.getElementById('anulacion-info-fecha').textContent = fecha ? fecha.slice(0,10).split('-').reverse().join('/') : '—';
  document.getElementById('anulacion-clave').value = '';
  document.getElementById('alerta-anulacion-ok').style.display  = 'none';
  document.getElementById('alerta-anulacion-err').style.display = 'none';

  abrirModal('modal-anulacion-stock');
}

async function confirmarAnulacion() {
  const okEl   = document.getElementById('alerta-anulacion-ok');
  const errEl  = document.getElementById('alerta-anulacion-err');
  okEl.style.display = errEl.style.display = 'none';

  const tipo          = document.getElementById('anulacion-tipo').value;
  const idMovimiento  = parseInt(document.getElementById('anulacion-id-movimiento').value);
  const id_articulo   = parseInt(document.getElementById('anulacion-id-articulo').value);
  const cantidad      = parseFloat(document.getElementById('anulacion-cantidad').value);
  const clave         = document.getElementById('anulacion-clave').value;

  if (!clave) { errEl.textContent = 'Ingrese su contraseña para autorizar.'; errEl.style.display = 'block'; return; }

  const btnConfirmar = document.querySelector('#modal-anulacion-stock .btn-peligro');
  const resetBtn = function() { if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = '⚠ CONFIRMAR ANULACIÓN'; } };
  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = 'Procesando...'; }

  try {
    // 1. Validar contraseña usando bcrypt via RPC
    const verifAnulacion = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verifAnulacion.ok) throw new Error('Contraseña incorrecta.');

    // 2. Leer artículo fresco
    const artArr = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
    const art = artArr[0];
    if (!art) throw new Error('Artículo no encontrado.');

    // 3. Leer movimiento original
    let movOrig = null;
    if (tipo === 'ENTRADA') {
      const rows = await api('stock_entradas', 'GET', null, '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) throw new Error('Movimiento no encontrado.');
      if (rows[0].anulada) throw new Error('Este movimiento ya fue anulado.');
      movOrig = rows[0];

      // ── Validar que la CxP no esté pagada ──
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&select=id_cxp,estado,numero_doc');
        if (cxps && cxps.length) {
          const pagadas = cxps.filter(function(c) { return c.estado === 'PAGADA' || c.estado === 'PARCIAL'; });
          if (pagadas.length > 0) {
            throw new Error('No se puede anular esta entrada porque la CxP "' + pagadas[0].numero_doc + '" tiene estado ' + pagadas[0].estado + '. Anule el pago primero: vaya a Pagos → abra esa Cuenta por Pagar → botón "🗑 Anular Pago Ejecutado". Luego vuelva aquí a anular la Entrada.');
          }
        }
      } catch(eCxPCheck) {
        if (eCxPCheck.message.includes('No se puede anular')) throw eCxPCheck;
        console.warn('Error verificando CxP:', eCxPCheck);
      }
    } else {
      const rows = await api('stock_salidas', 'GET', null, '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo,correo,id_area,param_areas:id_area(nombre))');
      if (!rows || !rows[0]) throw new Error('Movimiento no encontrado.');
      if (rows[0].anulada) throw new Error('Este movimiento ya fue anulado.');
      if (rows[0].id_area) {
        throw new Error('Esta es una entrega entre Áreas -- no se puede anular desde aquí. Si hay que revertirla, use una Transferencia (Entrada de Stock, Área de Origen = el Área que la recibió).');
      }
      movOrig = rows[0];
    }

    // 4. Validar que anular no deje el área en negativo
    if (tipo === 'ENTRADA' && movOrig.id_area) {
      const stockAreaActual = await obtenerStockArea(id_articulo, movOrig.id_area);
      if (stockAreaActual - cantidad < 0) {
        throw new Error('Stock resultante negativo en el área (' + (stockAreaActual - cantidad).toFixed(2) + '). No se puede anular porque ya se realizaron salidas de este inventario.');
      }
    }

    // 5. Actualizar CPP (global) y el stock del ÁREA correspondiente
    const patchInv = {};

    // Recalcular CPP desde entradas activas
    const entradasActivasCPP = await api('stock_entradas','GET',null,
      '?id_articulo=eq.'+id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada,cantidad,precio_costo_moneda');
    let sumaCantidadCPP = 0;
    let sumaValorCPP    = 0;
    (entradasActivasCPP||[]).forEach(function(e) {
      // Excluir la entrada que se está anulando
      if (tipo === 'ENTRADA' && parseInt(e.id_entrada||0) === idMovimiento) return;
      const cant   = parseFloat(e.cantidad || 0);
      const precio = parseFloat(e.precio_costo_moneda || 0);
      sumaCantidadCPP += cant;
      sumaValorCPP    += cant * precio;
    });
    if (sumaCantidadCPP > 0) {
      patchInv.precio_costo_moneda = parseFloat((sumaValorCPP / sumaCantidadCPP).toFixed(4));
    } else {
      patchInv.precio_costo_moneda        = 0;
      patchInv.precio_costo_ultimo_moneda = 0;
    }
    await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);

    // Ajustar el stock del área afectada (esquema por área — inventario_stock_area)
    if (tipo === 'ENTRADA') {
      // Se anula una Entrada: retirar la cantidad del área que la había recibido
      // (movOrig.id_area — en la práctica, siempre Compras)
      if (movOrig.id_area) await upsertStockArea(id_articulo, movOrig.id_area, -cantidad);
    } else {
      // Se anula una Salida: devolver la cantidad al área que la entregó
      // (movOrig.id_area_entrega). Este bloque ya solo se alcanza para
      // Salidas de venta a Cliente (id_area = null, ver más arriba) --
      // las entregas Área↔Área (id_area = área receptora real) se
      // bloquean antes de llegar aquí; su reverso correcto es una
      // Transferencia explícita, que ajusta ambas áreas correctamente.
      if (movOrig.id_area_entrega) await upsertStockArea(id_articulo, movOrig.id_area_entrega, cantidad);
    }


    // 6. Marcar movimiento como anulado
    if (tipo === 'ENTRADA') {
      await api('stock_entradas', 'PATCH',
        { anulada: true, id_usuario_reversa: sesionActual.correo_usuario, estado_revision: null },
        '?id_entrada=eq.' + idMovimiento);
      // Si estaba EN_REVISION (CxP rechazada), anularla también la resuelve
      // -- marcar como resueltas las notificaciones pendientes asociadas.
      try {
        const notifsRevAnul = await api('notificaciones','GET',null,
          '?estado=eq.PENDIENTE&datos_extra=ilike.*%22id_entrada%22%3A'+idMovimiento+'*&select=id');
        for (const nAnul of (notifsRevAnul||[])) {
          await api('notificaciones','PATCH',{ estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },'?id=eq.'+nAnul.id);
        }
      } catch(eResAnul) { console.warn('Error resolviendo notificaciones de revisión:', eResAnul); }
    } else {
      await api('stock_salidas', 'PATCH',
        { anulada: true, id_usuario_reversa: sesionActual.correo_usuario },
        '?id_salida=eq.' + idMovimiento);
    }

    // 7. Anular asiento contable original
    try {
      const ref = tipo === 'ENTRADA' ? 'ENT-' + idMovimiento : 'SAL-' + idMovimiento;
      const asientos = await api('cont_asientos', 'GET', null,
        '?referencia=eq.' + ref + emisorQ() + '&select=id_asiento,descripcion&estado=neq.ANULADO');
      if (asientos && asientos.length) {
        await api('cont_asientos', 'PATCH',
          { estado: 'ANULADO', descripcion: '[ANULADO] ' + (asientos[0].descripcion || '') },
          '?id_asiento=eq.' + asientos[0].id_asiento);
      }
    } catch(eAst) { console.warn('Error anulando asiento:', eAst); }

    // 8. Anular CxP si es entrada por compra
    if (tipo === 'ENTRADA') {
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=eq.' + encodeURIComponent('ENT-' + idMovimiento) + emisorQ() + '&estado=eq.PENDIENTE&select=id_cxp');
        if (cxps && cxps.length) {
          await api('cont_cxp', 'PATCH',
            { estado: 'ANULADA', observaciones: '[ANULADO] Entrada de stock anulada.' },
            '?id_cxp=eq.' + cxps[0].id_cxp);
        }
      } catch(eCxP) { console.warn('Error anulando CxP:', eCxP); }
    }

    // 9. Notificaciones para SALIDAS
    if (tipo === 'SALIDA') {
      const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
      const nomArt = r ? r.nombre_articulo : 'Artículo #' + id_articulo;

      // 9a. Notificación interna al empleado que recibió
      if (movOrig.id_empleado) {
        try {
          await api('notificaciones', 'POST', {
            id_empresa:   _empresaActiva?.id_empresa,
            id_empleado:  movOrig.id_empleado,
            tipo:         'ANULACION_SALIDA',
            titulo:       '⚠ Anulación de Salida de Inventario',
            mensaje:      'La salida de ' + cantidad + ' unidades de "' + nomArt + '" registrada a su nombre ha sido anulada. El inventario debe retornar al almacén.',
            leida:        false,
            id_usuario:   sesionActual.correo_usuario,
            fecha_registro: new Date().toISOString()
          });
        } catch(eNot) { console.warn('Error creando notificación interna:', eNot); }
      }

      // 9b. Correo al responsable del área receptora
      if (movOrig.id_area) {
        try {
          // Buscar responsable del área (empleado con nivel jerárquico más alto del área)
          const responsables = await api('empleados', 'GET', null,
            '?id_area=eq.' + movOrig.id_area + '&id_nivel_jerarquico=not.is.null&order=id_nivel_jerarquico.asc&select=correo,nombre_completo&limit=1'
            + (_empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : ''));
          if (responsables && responsables[0] && responsables[0].correo) {
            const resp = responsables[0];
            const areaName = movOrig.area_receptora ? movOrig.area_receptora.nombre : 'Área #' + movOrig.id_area;
            await fetch(SUPABASE_URL + '/functions/v1/send-email', {
              method: 'POST',
              headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to:      resp.correo,
                subject: '⚠ Anulación de Salida de Inventario — ' + areaName,
                html:    '<p>Estimado/a <strong>' + resp.nombre_completo + '</strong>,</p>'
                       + '<p>Se ha anulado una salida de inventario registrada para su área.</p>'
                       + '<table style="border-collapse:collapse;width:100%">'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Artículo</strong></td><td style="padding:6px;border:1px solid #ddd">' + nomArt + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Cantidad</strong></td><td style="padding:6px;border:1px solid #ddd">' + cantidad + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Área</strong></td><td style="padding:6px;border:1px solid #ddd">' + areaName + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Anulado por</strong></td><td style="padding:6px;border:1px solid #ddd">' + sesionActual.correo_usuario + '</td></tr>'
                       + '</table>'
                       + '<p>El inventario debe retornar al almacén. Por favor coordine la devolución.</p>'
              })
            });
          }
        } catch(eEmail) { console.warn('Error enviando correo responsable:', eEmail); }
      }
    }

    // 10. Actualizar cache y vistas
    try {
      const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
      if (fresh && fresh[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
        if (i !== -1) inventarioCache[i] = fresh[0];
      }
    } catch(e) {}

    okEl.textContent = '✓ Movimiento anulado correctamente. Stock actualizado.';
    okEl.style.display = 'block';
    resetBtn();

    setTimeout(async function() {
      cerrarModal('modal-anulacion-stock');
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      if (_fichaInvActual && _fichaInvActual.id) {
        await recargarHistorial(id_articulo);
        verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
      }
    }, 1500);

  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
    resetBtn();
  }
}

async function anularSalidaStock(id_salida, id_articulo, cantidad) {
  await anularMovimiento('SALIDA', id_salida, cantidad, id_articulo);
}

async function onCambiarFechaNegEdit() {
  const fecha  = document.getElementById('edit-mov-fecha-negociacion')?.value;
  const moneda = document.getElementById('edit-mov-moneda')?.value || 'USD';
  if (!fecha || moneda === 'VES') return;
  try {
    const tasas = await api('tasas','GET',null,'?fecha_valor=lte.'+fecha+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
    if (tasas && tasas[0]) {
      document.getElementById('edit-mov-tasa-bcv').value = parseFloat(tasas[0].tipo_cambio).toFixed(4);
      onCambiarPrecioEdit();
    }
  } catch(e) {}
}

async function onCambiarMonedaEdit() {
  const moneda = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const lblMoneda = document.getElementById('edit-mov-label-moneda');
  if (lblMoneda) lblMoneda.textContent = '(' + moneda + ')';
  const lblMonto = document.getElementById('edit-mov-label-monto-total');
  if (lblMonto) lblMonto.textContent = 'Monto en ' + moneda;
  const lblUSD = document.getElementById('edit-mov-label-precio-usd');
  if (lblUSD) lblUSD.textContent = moneda === 'VES' ? 'Monto en USD' : 'Monto en VES';
  await onCambiarFechaNegEdit();
  onCambiarPrecioEdit();
}

function onCambiarPrecioEdit() {
  const moneda   = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const precio   = parseMontoVE(document.getElementById('edit-mov-precio')?.value);
  const cantidad = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const tasa     = parseFloat(document.getElementById('edit-mov-tasa-bcv')?.value) || 0;
  const elMonto  = document.getElementById('edit-mov-monto-total');
  const elCalc   = document.getElementById('edit-mov-precio-usd-calc');
  const lblMontoTotal = document.getElementById('edit-mov-label-monto-total');
  if (lblMontoTotal) lblMontoTotal.textContent = 'Monto en ' + moneda;
  const montoTotal = precio * cantidad;
  if (elMonto) elMonto.value = fmtBs(montoTotal);
  if (elCalc && tasa > 0) {
    elCalc.value = moneda === 'VES' ? fmtBs(montoTotal / tasa) : fmtBs(montoTotal * tasa);
  }
  calcularTributosEdit();
  const cuotaMontoEditEl = document.getElementById('edit-mov-cuotas-monto');
  if (cuotaMontoEditEl) cuotaMontoEditEl.value = '';
  calcularCuotasEdit();
}

function onCambiarMotivoEdit() {
  const motivo = document.getElementById('edit-mov-motivo')?.value;
  const esCompra = motivo === 'compra';
  const tribuCont = document.getElementById('edit-mov-tributos-cont');
  if (tribuCont) tribuCont.style.display = esCompra ? '' : 'none';
  document.querySelectorAll('input[name="edit-exento-iva"]').forEach(function(r){ r.checked = false; });
  document.querySelectorAll('input[name="edit-incluye-iva"]').forEach(function(r){ r.checked = false; });
  document.getElementById('edit-mov-exento-iva-val').value = '';
  document.getElementById('edit-mov-incluye-iva-val').value = '';
  const ivaContEl = document.getElementById('edit-mov-incluye-iva-cont');
  if (ivaContEl) ivaContEl.style.display = 'none';
  const prev = document.getElementById('edit-mov-tributos-preview');
  if (prev) prev.style.display = 'none';
  // Mostrar/ocultar proveedor
  const provCont = document.getElementById('edit-mov-proveedor-cont');
  if (provCont) provCont.style.display = esCompra ? '' : 'none';

  // Campos de Negociación (Moneda/Precio/Monto/Tasa BCV) y Modalidad de Pago
  // solo aplican a Compra — igual que en el modal de creación. Un Ajuste,
  // Devolución o Transferencia no tiene precio negociado ni esquema de pago.
  const monedaCont = document.getElementById('edit-mov-moneda-cont');
  const precioCont = document.getElementById('edit-mov-precio-cont');
  const preciosCont = document.getElementById('edit-mov-precios-cont');
  const tasaCont   = document.getElementById('edit-mov-tasa-cont');
  const pagoCont   = document.getElementById('edit-mov-pago-cont');
  const creditoCont = document.getElementById('edit-mov-credito-cont');
  [monedaCont, precioCont, preciosCont, tasaCont, pagoCont].forEach(function(el) {
    if (el) el.style.display = (esCompra && (sesionActual?.administrador || puedo('INVENTARIO','VER_COSTOS'))) ? '' : 'none';
  });
  if (!esCompra && creditoCont) creditoCont.style.display = 'none';
}

function onCambioExentoIVAEdit() {
  const exento = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
  const ivaContEl = document.getElementById('edit-mov-incluye-iva-cont');
  if (ivaContEl) ivaContEl.style.display = exento ? 'none' : '';
  document.getElementById('edit-mov-incluye-iva-val').value = '';
  document.querySelectorAll('input[name="edit-incluye-iva"]').forEach(function(r){ r.checked = false; });
  const prev = document.getElementById('edit-mov-tributos-preview');
  if (prev) prev.style.display = 'none';
  calcularTributosEdit();
  const cme3 = document.getElementById('edit-mov-cuotas-monto');
  if (cme3) cme3.value = '';
  calcularCuotasEdit();
}

function calcularTributosEdit() {
  const pctIVAEdit = Math.round(tasaIVAActual()*100);
  const pctLblEdit = document.getElementById('edit-iva-pct-label');
  if (pctLblEdit) pctLblEdit.textContent = 'IVA (' + pctIVAEdit + '%)';
  const pctSpanEdit = document.getElementById('edit-trib-iva-pct');
  if (pctSpanEdit) pctSpanEdit.textContent = pctIVAEdit;
  const exento    = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
  const ivaVal    = document.getElementById('edit-mov-incluye-iva-val')?.value;
  const prev      = document.getElementById('edit-mov-tributos-preview');
  const moneda    = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const tasa      = parseFloat(document.getElementById('edit-mov-tasa-bcv')?.value) || 0;
  const precio    = parseMontoVE(document.getElementById('edit-mov-precio')?.value);
  const cantidad  = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const montoTotal = precio * cantidad;
  const sim = moneda === 'VES' ? 'Bs.' : '$';
  const IVA_RATE = tasaIVAActual();

  if (!montoTotal) { if (prev) prev.style.display = 'none'; return; }

  let base, iva, total;
  if (exento) {
    base = montoTotal; iva = 0; total = montoTotal;
  } else if (!ivaVal) {
    if (prev) prev.style.display = 'none'; return;
  } else if (ivaVal === 'SI') {
    base  = parseFloat((montoTotal / (1 + IVA_RATE)).toFixed(4));
    iva   = parseFloat((montoTotal - base).toFixed(4));
    total = montoTotal;
  } else {
    base  = montoTotal;
    iva   = parseFloat((montoTotal * IVA_RATE).toFixed(4));
    total = parseFloat((montoTotal + iva).toFixed(4));
  }

  document.getElementById('edit-trib-base').textContent  = sim + ' ' + fmtBs(base);
  document.getElementById('edit-trib-iva').textContent   = iva > 0 ? sim + ' ' + fmtBs(iva) : '—';
  document.getElementById('edit-trib-total').textContent = sim + ' ' + fmtBs(total);
  if (tasa > 0 && moneda !== 'VES') {
    const baseVesEdit  = parseFloat((base * tasa).toFixed(2));
    const totalVesEdit = parseFloat((total * tasa).toFixed(2));
    const ivaVesEdit   = parseFloat((totalVesEdit - baseVesEdit).toFixed(2));
    document.getElementById('edit-trib-base-ves').textContent  = 'Bs. ' + fmtBs(baseVesEdit);
    document.getElementById('edit-trib-iva-ves').textContent   = iva > 0 ? 'Bs. ' + fmtBs(ivaVesEdit) : '—';
    document.getElementById('edit-trib-total-ves').textContent = 'Bs. ' + fmtBs(totalVesEdit);
  } else {
    document.getElementById('edit-trib-base-ves').textContent  = moneda === 'VES' && tasa > 0 ? '$ ' + fmtBs(base / tasa) : '—';
    document.getElementById('edit-trib-iva-ves').textContent   = moneda === 'VES' && iva > 0 && tasa > 0 ? '$ ' + fmtBs(iva / tasa) : '—';
    document.getElementById('edit-trib-total-ves').textContent = moneda === 'VES' && tasa > 0 ? '$ ' + fmtBs(total / tasa) : '—';
  }
  if (prev) prev.style.display = '';
}

async function onCambioAreaEditSalida() {
  // Al cambiar el Área Receptora en modo Editar, la lista de Empleados debe
  // recargarse -- los empleados pertenecen a un Área específica, no tendría
  // sentido dejar seleccionado uno de la Área anterior.
  const idArea = document.getElementById('edit-sal-area')?.value;
  const selEmp = document.getElementById('edit-sal-empleado');
  if (!selEmp) return;
  if (!idArea) { selEmp.innerHTML = '<option value="">— Seleccionar Área primero —</option>'; return; }
  try {
    const emps = await api('empleados','GET',null,'?id_area=eq.'+idArea+'&select=id_empleado,nombre_completo&order=nombre_completo.asc');
    selEmp.innerHTML = '<option value="">— Seleccionar empleado —</option>'
      + (emps||[]).map(function(e){
        return '<option value="'+e.id_empleado+'">'+e.nombre_completo+'</option>';
      }).join('');
  } catch(e) { console.warn('Error cargando empleados del Área:', e); }
}

// ═══ SECCION: Salida de Stock, Ajuste/Faltante de Inventario, soporte Entrada (ex facturacion.js) ═══
async function abrirStockArticulo(id, nombre) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER')) {
    alert('No tiene permiso.'); return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  _fichaInvActual = { id: r.id_articulo, nombre: r.nombre_articulo };

  // Refrescar el caché de stock por área/consolidado y leer CPP/Venta fresco
  await calcularInvSaldoArea();
  var stockActual = stockMostrarArticulo(id);
  var cppActual   = parseFloat(r.precio_costo_moneda)   || 0;
  var ventaActual = parseFloat(r.precio_venta_moneda)   || 0;
  var monedaVentaActual = r.moneda_venta || 'USD';
  try {
    var qs = '?id_articulo=eq.' + id + '&select=precio_costo_moneda,precio_venta_moneda,moneda_venta,unidad,estado';
    if (_empresaActiva && _empresaActiva.id_empresa) qs += '&id_empresa=eq.' + _empresaActiva.id_empresa;
    var fresh = await api('inventario_almacen', 'GET', null, qs);
    if (fresh && fresh[0]) {
      if (fresh[0].precio_costo_moneda   != null) cppActual   = parseFloat(fresh[0].precio_costo_moneda);
      if (fresh[0].precio_venta_moneda   != null) ventaActual = parseFloat(fresh[0].precio_venta_moneda);
      monedaVentaActual = fresh[0].moneda_venta || 'USD';
      r.precio_costo_moneda   = cppActual;
      r.precio_venta_moneda   = ventaActual;
      r.moneda_venta           = monedaVentaActual;
      r.estado = fresh[0].estado;
    }
  } catch(e) { console.warn('abrirStockArticulo GET fresco:', e.message); }
  if (stockActual === 0) { cppActual = 0; } // sin stock, sin costo que mostrar
  await refrescarMargenesVigentes();
    await refrescarTasasHistoricasCPP();

  const inactivoArt = r.estado === 'INACTIVO';
  document.getElementById('stock-art-nombre').textContent = r.nombre_articulo + (inactivoArt ? ' (INACTIVO)' : '');
  document.getElementById('stock-art-stock').textContent  = stockActual + ' ' + (r.unidad || 'UND');

  const ventaCont = document.getElementById('stock-art-venta-cont');
  if (puedo('INVENTARIO','VER_PRECIOS_VENTA')) {
    const dualVentaModal = stockActual === 0 ? {usd:0} : precioVentaEnVivo(r);
    document.getElementById('stock-art-venta').textContent = '$ ' + fmtUSD(dualVentaModal.usd);
    if (ventaCont) ventaCont.style.display = '';
  } else {
    if (ventaCont) ventaCont.style.display = 'none';
  }

  const costoCont = document.getElementById('stock-art-costo-cont');
  const costoEl   = document.getElementById('stock-art-costo');
  if (puedo('INVENTARIO','VER_COSTOS')) {
    if (costoEl)   costoEl.textContent = '$ ' + fmtUSD(cppActual);
    if (costoCont) costoCont.style.display = '';
  } else {
    if (costoCont) costoCont.style.display = 'none';
  }

  // Si está Inactivo, ocultar Entrada/Salida sin importar el permiso --
  // el Historial se mantiene siempre disponible.
  document.getElementById('stock-btn-entrada').style.display  = (puedo('INVENTARIO','ENTRADA_STOCK') && !inactivoArt) ? '' : 'none';
  document.getElementById('stock-btn-salida').style.display   = (puedo('INVENTARIO','SALIDA_STOCK')  && !inactivoArt) ? '' : 'none';
  document.getElementById('stock-btn-faltante').style.display = puedo('INVENTARIO','AJUSTE_INCIDENCIA') ? '' : 'none';
  document.getElementById('stock-btn-historial').style.display = puedo('INVENTARIO','VER')          ? '' : 'none';

  abrirModal('modal-stock-articulo');
  focusFirstField('modal-stock-articulo');
}

async function abrirSalidaStock(id, nombre) {
  if (!puedo('INVENTARIO','SALIDA_STOCK')) { alert('No tiene permiso para registrar salidas de stock.'); return; }

  // Bloquear si el artículo está Inactivo -- mismo criterio que Entrada.
  try {
    const estRows = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+id+'&select=estado');
    if (estRows && estRows[0] && estRows[0].estado === 'INACTIVO') {
      alert('Este artículo está Inactivo. Reactívelo desde Editar antes de registrar una Salida.');
      return;
    }
  } catch(eEstSal) { console.warn('Error verificando estado del artículo:', eEstSal); }

  // Cargar áreas
  let areas = [];
  try { areas = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}

  document.getElementById('salida-art-nombre').textContent = nombre;
  document.getElementById('salida-id-articulo').value      = id;
  document.getElementById('salida-cantidad').value         = '';
  // Al reabrir el modal desde cero, la Moneda queda liberada de nuevo (por
  // si en un uso anterior se había bloqueado al ajustar el Precio a mano).
  const monedaSelLib = document.getElementById('salida-moneda-venta');
  if (monedaSelLib) monedaSelLib.disabled = false;
  // Tasa BCV vigente -- solo informativa, ya cargada globalmente al iniciar
  // sesión (_tasaVigente); no depende de ninguna selección de este modal.
  const tasaDispEl = document.getElementById('salida-tasa-bcv-display');
  if (tasaDispEl) tasaDispEl.textContent = _tasaVigente ? 'Bs ' + fmtBs(_tasaVigente) : '—';
  // Cargar stock disponible para validación en tiempo real (referencial —
  // la validación real al guardar usa obtenerStockArea contra el área que entrega)
  const stockDisp = document.getElementById('salida-stock-disp');
  if (stockDisp) {
    try {
      await calcularInvSaldoArea();
      stockDisp.dataset.stock = stockMostrarArticulo(id);
    } catch(e) { stockDisp.dataset.stock = 0; }
  }
  document.getElementById('salida-fecha').value            = getHoyVzla();
  document.getElementById('salida-observaciones').value    = '';
  const salPvEl = document.getElementById('salida-precio-venta');
  if (salPvEl) salPvEl.value = '';
  // Moneda: sin preseleccionar -- el Usuario debe elegirla explícitamente
  // cada vez (mismo criterio que "Moneda Negociación" en Entrada de Stock).
  const salMonEl = document.getElementById('salida-moneda-venta');
  if (salMonEl) salMonEl.value = '';
  document.getElementById('alerta-salida-ok').style.display  = 'none';
  document.getElementById('alerta-salida-err').style.display = 'none';
  // Limpiar campos de contraseña
  var claveEnt = document.getElementById('salida-clave-entrega');
  if (claveEnt) { claveEnt.value = ''; claveEnt.type = 'password'; }

  // Llenar áreas
  const selArea = document.getElementById('salida-area');
  selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
    + areas.map(function(a) {
        return '<option value="' + a.id + '">'
          + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
      }).join('');
  document.getElementById('salida-empleado').innerHTML = '<option value="">— Seleccionar área primero —</option>';
  // Auto-cargar datos del usuario actual como quien entrega
  await cargarUsuarioEntregaSalida();




  // Mostrar stock por area
  await calcularInvSaldoArea();
  const art = inventarioCache.find(function(x) { return x.id_articulo === id; });
  const stockSalida = art ? stockMostrarArticulo(art.id_articulo) : 0;
  document.getElementById('salida-stock-actual').textContent = art ? stockSalida + ' ' + (art.unidad || 'UND') : '—';
  const salLblUnidad = document.getElementById('salida-label-unidad');
  if (salLblUnidad) salLblUnidad.textContent = art?.unidad || 'UND';

  const pvLabel = document.getElementById('salida-precio-venta-label');
  if (pvLabel) pvLabel.textContent = 'Precio de Venta';

  // El Precio de Venta ahora se CALCULA (CPP ÷ (1 − Margen/100), según el
  // Margen Bruto vigente del Tipo de Artículo) -- ya no se escribe a mano.
  // Solo Usuarios con AJUSTAR_PRECIO_VENTA pueden desbloquearlo y sobre-
  // escribirlo manualmente.
  window._salidaPrecioManual = false;
  const ajustarBtn = document.getElementById('salida-precio-venta-ajustar-btn');
  if (ajustarBtn) ajustarBtn.style.display = (sesionActual?.administrador || (puedo('INVENTARIO','VER_PRECIOS_VENTA') && puedo('INVENTARIO','AJUSTAR_PRECIO_VENTA'))) ? '' : 'none';
  const pvDisplay = document.getElementById('salida-precio-venta-display');
  if (pvDisplay) pvDisplay.style.display = '';
  const pvInputEl = document.getElementById('salida-precio-venta');
  if (pvInputEl) pvInputEl.style.display = 'none';
  await recalcularPrecioVentaSalida();

    abrirModal('modal-salida-stock');
  focusFirstField('modal-salida-stock');
  setTimeout(function() { document.getElementById('salida-cantidad')?.focus(); }, 100);
}

// Margen Bruto % vigente hoy para un Tipo de Artículo -- null si no hay
// ninguno definido (equivale a "Precio de Venta = 0", regla de negocio).
async function obtenerMargenVigentePorTipo(id_tipo_articulo) {
  if (!id_tipo_articulo) return null;
  try {
    const hoy = new Date().toISOString().slice(0,10);
    const rows = await api('param_margen_bruto','GET',null,
      '?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&id_tipo_articulo=eq.'+id_tipo_articulo
      +'&estado=neq.ANULADO&fecha_vigencia_desde=lte.'+hoy
      +'&order=fecha_vigencia_desde.desc,id.desc&limit=1&select=margen_pct');
    if (rows && rows[0]) return parseFloat(rows[0].margen_pct);
  } catch(e) { console.warn('Error obteniendo margen vigente:', e); }
  return null;
}

// Recalcula el Precio de Venta mostrado en el modal de Salida de Stock:
// CPP (convertido a la Moneda elegida) ÷ (1 − Margen/100). Si no hay
// Moneda elegida, o no hay Margen definido para el Tipo del Artículo, el
// resultado es 0 -- regla de negocio confirmada explícitamente.
async function recalcularPrecioVentaSalida() {
  const displayEl = document.getElementById('salida-precio-venta-display');
  const hiddenInput = document.getElementById('salida-precio-venta');
  if (!displayEl || !hiddenInput) return;
  if (window._salidaPrecioManual) return; // el Usuario lo está ajustando a mano -- no pisar su valor
  const monedaSel = document.getElementById('salida-moneda-venta')?.value;
  const idArt = parseInt(document.getElementById('salida-id-articulo')?.value) || null;
  const art = idArt ? inventarioCache.find(function(x){ return x.id_articulo === idArt; }) : null;
  if (!monedaSel || !art) {
    displayEl.textContent = '—';
    hiddenInput.value = '';
    return;
  }
  let cpp = parseFloat(art.precio_costo_moneda || 0); // siempre guardado en USD
  if (monedaSel === 'VES') cpp = cpp * (_tasaVigente || 0);
  const margen = await obtenerMargenVigentePorTipo(art.id_tipo_articulo);
  let venta = 0;
  if (margen !== null && margen < 100) venta = cpp / (1 - margen/100);
  hiddenInput.value = venta.toFixed(2);
  // El valor SIEMPRE se calcula y se guarda en hiddenInput (la Salida tiene
  // que poder ejecutarse igual, con el precio correcto) -- lo que se
  // OCULTA sin el permiso es solo lo que el Usuario ve en pantalla, mismo
  // candado que ya usa el resto del sistema (Inventario General, Ficha del
  // Artículo, ABC).
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_PRECIOS_VENTA')) {
    displayEl.textContent = '🔒';
    displayEl.title = '';
    return;
  }
  const simb = monedaSel === 'VES' ? 'Bs ' : '$ ';
  const detalleTxt = margen === null
    ? 'sin Margen definido'
    : 'Margen ' + margen.toFixed(1) + '%';
  displayEl.textContent = simb + fmtUSD(venta) + ' · ' + detalleTxt;
  displayEl.title = simb + fmtUSD(venta) + ' (' + detalleTxt + ')';
}

// Desbloquea el Precio de Venta para ajuste manual -- solo Usuarios con
// AJUSTAR_PRECIO_VENTA llegan a ver este botón en primer lugar, pero se
// revalida el permiso aquí también (defensa en profundidad).
function habilitarAjustePrecioVentaSalida() {
  if (!sesionActual?.administrador && !(puedo('INVENTARIO','VER_PRECIOS_VENTA') && puedo('INVENTARIO','AJUSTAR_PRECIO_VENTA'))) {
    alert('No tiene permiso para ajustar manualmente el Precio de Venta.'); return;
  }
  if (!document.getElementById('salida-moneda-venta')?.value) {
    alert('Seleccione primero la Moneda -- el ajuste manual del Precio de Venta necesita saber en qué Moneda se está escribiendo.');
    document.getElementById('salida-moneda-venta')?.focus();
    return;
  }
  window._salidaPrecioManual = true;
  const pvDisplay = document.getElementById('salida-precio-venta-display');
  const pvInputEl = document.getElementById('salida-precio-venta');
  const ajustarBtn = document.getElementById('salida-precio-venta-ajustar-btn');
  if (pvDisplay) pvDisplay.style.display = 'none';
  if (pvInputEl) { pvInputEl.style.display = ''; pvInputEl.focus(); }
  if (ajustarBtn) ajustarBtn.style.display = 'none';
  // Al ajustar el Precio manualmente, la Moneda queda bloqueada -- si se
  // pudiera seguir cambiando, el valor escrito a mano quedaría desfasado
  // (fue calculado/pensado para una Moneda específica). Se libera de nuevo
  // recién al volver a abrir el modal desde cero (ver abrirSalidaStock()).
  const monedaSelBloq = document.getElementById('salida-moneda-venta');
  if (monedaSelBloq) monedaSelBloq.disabled = true;
}

// Mismo mecanismo (CPP ÷ (1 − Margen/100)) pero para la Ficha de Editar
// Salida de Stock -- usa el Artículo/Moneda de ESA ficha, no la de Nueva
// Salida (son modales/IDs de campo distintos).
async function recalcularPrecioVentaEditSalida() {
  const displayEl = document.getElementById('edit-sal-precio-venta-display');
  const hiddenInput = document.getElementById('edit-sal-precio-venta');
  if (!displayEl || !hiddenInput) return;
  if (window._editSalPrecioManual) return;
  const monedaSel = document.getElementById('edit-sal-moneda-venta')?.value;
  const idArt = parseInt(document.getElementById('edit-mov-id-articulo')?.value) || null;
  const art = idArt ? inventarioCache.find(function(x){ return x.id_articulo === idArt; }) : null;
  if (!monedaSel || !art) {
    displayEl.textContent = '—';
    hiddenInput.value = '';
    return;
  }
  let cpp = parseFloat(art.precio_costo_moneda || 0);
  if (monedaSel === 'VES') cpp = cpp * (_tasaVigente || 0);
  const margen = await obtenerMargenVigentePorTipo(art.id_tipo_articulo);
  let venta = 0;
  if (margen !== null && margen < 100) venta = cpp / (1 - margen/100);
  hiddenInput.value = venta.toFixed(2);
  // Mismo candado que en Nueva Salida: se calcula y guarda igual, solo se
  // oculta lo que ve el Usuario en pantalla.
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_PRECIOS_VENTA')) {
    displayEl.textContent = '🔒';
    displayEl.title = '';
    return;
  }
  const simb = monedaSel === 'VES' ? 'Bs ' : '$ ';
  const detalleTxt = margen === null
    ? 'sin Margen definido'
    : 'Margen ' + margen.toFixed(1) + '%';
  displayEl.textContent = simb + fmtUSD(venta) + ' · ' + detalleTxt;
  displayEl.title = simb + fmtUSD(venta) + ' (' + detalleTxt + ')';
}

function habilitarAjustePrecioVentaEditSalida() {
  if (!sesionActual?.administrador && !(puedo('INVENTARIO','VER_PRECIOS_VENTA') && puedo('INVENTARIO','AJUSTAR_PRECIO_VENTA'))) {
    alert('No tiene permiso para ajustar manualmente el Precio de Venta.'); return;
  }
  window._editSalPrecioManual = true;
  const pvDisplay = document.getElementById('edit-sal-precio-venta-display');
  const pvInputEl = document.getElementById('edit-sal-precio-venta');
  const ajustarBtn = document.getElementById('edit-sal-precio-venta-ajustar-btn');
  if (pvDisplay) pvDisplay.style.display = 'none';
  if (pvInputEl) { pvInputEl.style.display = ''; pvInputEl.focus(); }
  if (ajustarBtn) ajustarBtn.style.display = 'none';
  // Mismo bloqueo que en Nueva Salida: Moneda queda fija mientras el
  // Precio esté en ajuste manual -- se libera al volver a entrar en modo
  // Editar (ver _aplicarSoloLecturaMovimiento()).
  const monedaSelBloqEd = document.getElementById('edit-sal-moneda-venta');
  if (monedaSelBloqEd) monedaSelBloqEd.disabled = true;
}


async function guardarSalidaStock() {
  if (!puedo('INVENTARIO','SALIDA_STOCK')) { alert('No tiene permiso.'); return; }
  if (window._guardandoSalida) return;
  window._guardandoSalida = true;
  const btnGuardarSal = document.querySelector('#modal-salida-stock .btn-primario');
  const resetBtnSal = function() {
    window._guardandoSalida = false;
    if (btnGuardarSal) { btnGuardarSal.disabled = false; btnGuardarSal.textContent = 'Registrar Salida'; }
  };
  if (btnGuardarSal) { btnGuardarSal.disabled = true; btnGuardarSal.textContent = 'Procesando...'; }
  try {
    await _guardarSalidaStockInterno();
  } finally {
    resetBtnSal();
  }
}

async function _guardarSalidaStockInterno() {
  const btnGuardarSal = null; // no needed here
  const resetBtnSal = function() {}; // no-op — handled by wrapper

  const idRep   = parseInt(document.getElementById('salida-id-articulo').value);
  const id_area  = parseInt(document.getElementById('salida-area').value) || null;
  const cantidad = parseFloat(document.getElementById('salida-cantidad').value);
  const fecha   = document.getElementById('salida-fecha').value;
  const obs     = document.getElementById('salida-observaciones').value.trim();
  const pvSalidaRaw = document.getElementById('salida-precio-venta')?.value;
  const pvSalida = (pvSalidaRaw !== '' && pvSalidaRaw != null) ? parseFloat(pvSalidaRaw) : null;
  const monedaVentaSalRaw = document.getElementById('salida-moneda-venta')?.value || '';
  const okEl    = document.getElementById('alerta-salida-ok');
  const errEl   = document.getElementById('alerta-salida-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const art = inventarioCache.find(function(x) { return x.id_articulo === idRep; });

  // ── Clasificar el artículo por su cuenta contable de Inventario ──
  // 1.1.03.001 = Mercancías (sigue como inventario en el área destino, se
  // gasta al facturar -- por eso necesita Precio de Venta ya definido).
  // 1.1.03.002 = Consumibles (se gasta de inmediato al salir de Compras,
  // el Precio de Venta sigue siendo opcional para ellos).
  let esMercancia = false;
  if (art && art.id_cuenta_contable) {
    const ctaArtSal = (await obtenerCuentasContables()).find(function(c){ return c.id_cuenta === art.id_cuenta_contable; });
    esMercancia = !!(ctaArtSal && ctaArtSal.codigo === '1.1.03.001');
  }

  if (!fecha)           { errEl.textContent = 'La fecha es obligatoria.'; errEl.style.display = 'block'; document.getElementById('salida-fecha')?.focus(); return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor a cero.'; errEl.style.display = 'block'; document.getElementById('salida-cantidad')?.focus(); return; }
  // El Precio de Venta ahora se calcula solo (CPP ÷ Margen) -- ya no hace
  // falta exigirlo como "obligatorio para Mercancía"; siempre trae un
  // valor (0 si el Tipo no tiene Margen definido, por regla de negocio).
  // Lo que sí sigue siendo obligatorio es la Moneda, porque sin ella no
  // hay con qué calcular el precio en primer lugar.
  if (!monedaVentaSalRaw) {
    errEl.textContent = 'Seleccione la Moneda.';
    errEl.style.display = 'block';
    document.getElementById('salida-moneda-venta')?.focus(); return;
  }
  const monedaVentaSal = monedaVentaSalRaw;
  if (!id_area)          { errEl.textContent = 'Debe seleccionar el Área receptora.'; errEl.style.display = 'block'; document.getElementById('salida-area')?.focus(); return; }

  // Validar contraseña del empleado que ENTREGA
  const idEmpEntrega  = parseInt(document.getElementById('salida-empleado-entrega')?.value) || null;
  const claveEntrega  = document.getElementById('salida-clave-entrega')?.value || '';
  if (!idEmpEntrega) {
    errEl.textContent = 'Debe seleccionar el empleado que entrega.';
    errEl.style.display = 'block'; return;
  }
  if (!claveEntrega) {
    errEl.textContent = 'El empleado que entrega debe ingresar su contraseña.';
    errEl.style.display = 'block';
    document.getElementById('salida-clave-entrega')?.focus(); return;
  }
  const validEntrega = await validarClaveReceptor(idEmpEntrega, claveEntrega);
  if (!validEntrega.ok) {
    errEl.textContent = validEntrega.msg;
    errEl.style.display = 'block';
    document.getElementById('salida-clave-entrega')?.focus(); return;
  }

  // Validar stock disponible — contra el ÁREA QUE ENTREGA (Compras), no el global
  const id_areaEntregaVal = parseInt(document.getElementById('salida-area-entrega')?.value) || null;
  if (id_areaEntregaVal) {
    const stockDisponibleArea = await obtenerStockArea(idRep, id_areaEntregaVal);
    if (cantidad > stockDisponibleArea) {
      errEl.textContent = 'La cantidad supera el stock disponible en Compras (' + stockDisponibleArea + ' ' + (art?.unidad||'UND') + ').';
      errEl.style.display = 'block'; return;
    }
  }

  try {
    // Registrar salida
    const idEmpRecibe    = parseInt(document.getElementById('salida-empleado')?.value) || null;
    const id_areaEntrega  = parseInt(document.getElementById('salida-area-entrega')?.value) || null;
    const salidaRes = await api('stock_salidas', 'POST', {
      id_articulo:          idRep,
      id_area:              id_area,
      id_empleado:          idEmpRecibe,
      id_area_entrega:      id_areaEntrega,
      id_empleado_entrega:  idEmpEntrega,
      cantidad:             cantidad,
      fecha_salida:         fecha,
      observaciones:        obs || null,
      precio_venta_moneda:  pvSalida,
      moneda_venta:         monedaVentaSal,
      id_usuario:           sesionActual.correo_usuario
    });
    const id_salida = salidaRes && salidaRes[0] ? salidaRes[0].id_salida : null;

    // esMercancia ya se determinó arriba (antes de validar), se reutiliza
    // aquí para decidir cómo se mueve el stock/costo de esta Salida.
    if (esMercancia) {
      // ── MERCANCÍA: se mueve el stock por área, SIN gasto ──
      // (el costo se reconocerá contablemente cuando se facture al cliente)
      if (id_areaEntrega) await upsertStockArea(idRep, id_areaEntrega, -cantidad);
      // El crédito al área DESTINO se hace de inmediato solo si no hay un
      // empleado receptor designado (no habrá confirmación que lo dispare
      // después). Si sí hay receptor, el stock se suma cuando confirme la
      // notificación de recepción (notifConfirmar en core.js) — sumarlo
      // ambas veces le quitaría sentido al paso de "Confirmar Recepción".
      if (!idEmpRecibe) await upsertStockArea(idRep, id_area, cantidad);
      if (pvSalida !== null) await api('inventario_almacen', 'PATCH', { precio_venta_moneda: pvSalida, moneda_venta: monedaVentaSal }, '?id_articulo=eq.' + idRep);
      if (art && pvSalida !== null) { art.precio_venta_moneda = pvSalida; art.moneda_venta = monedaVentaSal; }
    } else {
    // Consumible: descontar del área que entrega (Compras) y actualizar precio venta si se ingresó
    if (id_areaEntrega) await upsertStockArea(idRep, id_areaEntrega, -cantidad);
    if (pvSalida !== null) await api('inventario_almacen', 'PATCH', { precio_venta_moneda: pvSalida, moneda_venta: monedaVentaSal }, '?id_articulo=eq.' + idRep);
    if (art && pvSalida !== null) { art.precio_venta_moneda = pvSalida; art.moneda_venta = monedaVentaSal; }

    // Salidas de CONSUMIBLES generan asiento: DEBE gasto / HABER inventario
    if (art && art.id_cuenta_contable && art.id_cuenta_costo_gasto) {
      try {
        // CPP en USD ya esta en art.precio_costo_moneda
        // Calcular tasa BCV promedio ponderada de TODAS las entradas con tasa registrada
        const entradasC = await api('stock_entradas','GET',null,'?id_articulo=eq.'+idRep+'&select=cantidad,tasa_bcv,moneda_compra') || [];
        var sumQT = 0; var sumQ2 = 0;
        entradasC.forEach(function(e) {
          var q = parseFloat(e.cantidad||0);
          var t = parseFloat(e.tasa_bcv||0);
          if (q > 0 && t > 0) { sumQT += q*t; sumQ2 += q; }
        });
        var tasaProm = sumQ2 > 0 ? sumQT/sumQ2 : (_tasaVigente||1);
        var cppUSD   = parseFloat(art.precio_costo_moneda||0);
        var montoVES = parseFloat((cantidad * cppUSD * tasaProm).toFixed(2));

        var anioS = new Date().getFullYear();
        var ultsS = await api('cont_asientos','GET',null,'?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
        var seqS = 1;
        if (ultsS[0]?.numero_asiento) { var mmS = ultsS[0].numero_asiento.match(/(\d+)$/); if (mmS) seqS = parseInt(mmS[1])+1; }
        var numAstS = 'AST-' + anioS + '-' + String(seqS).padStart(4,'0');
        var areaDest = document.getElementById('salida-area')?.selectedOptions[0]?.text || 'Area';

        var astS = await api('cont_asientos','POST',{
          id_empresa: _empresaActiva?.id_empresa||0, numero_asiento: numAstS,
          tipo: 'CONSUMO_INVENTARIO', fecha: fecha,
          descripcion: 'Consumo: '+(art.nombre_articulo||'')+ ' x'+cantidad+' -> '+areaDest,
          referencia: id_salida ? 'SAL-'+id_salida : 'SAL-INV-'+idRep,
          estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaProm,
          id_usuario: sesionActual?.correo_usuario||null
        });
        var arS = Array.isArray(astS) ? astS[0] : astS;
        var montoUSD_sal = parseFloat((cantidad * cppUSD).toFixed(4));
        if (arS?.id_asiento) {
          await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:art.id_cuenta_costo_gasto, orden:1,
            descripcion:'Consumo: '+(art.nombre_articulo||'')+' x'+cantidad+' (CPP $'+cppUSD.toFixed(2)+' x T/C '+tasaProm.toFixed(2)+')',
            debe_usd:montoUSD_sal, haber_usd:0, debe_ves:montoVES, haber_ves:0, tasa_bcv:tasaProm });
          await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:art.id_cuenta_contable, orden:2,
            descripcion:'Salida inventario consumible: '+(art.nombre_articulo||'')+' x'+cantidad,
            debe_usd:0, haber_usd:montoUSD_sal, debe_ves:0, haber_ves:montoVES, tasa_bcv:tasaProm });

          // ── Si el stock quedó en 0, cerrar cualquier residuo de redondeo ──
          // (la cuenta de Inventario puede ser compartida por varios artículos
          // de la misma categoría, así que se aíslan solo los asientos ligados
          // a las entradas/salidas DE ESTE artículo, vía su referencia)
          const stockRestanteArea = id_areaEntrega ? await obtenerStockArea(idRep, id_areaEntrega) : 0;
          if (Math.abs(stockRestanteArea) < 0.0001 && art.id_cuenta_contable) try {
            const [entradasRef, salidasRef] = await Promise.all([
              api('stock_entradas','GET',null,'?id_articulo=eq.'+idRep+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada'),
              api('stock_salidas','GET',null,'?id_articulo=eq.'+idRep+'&or=(anulada.eq.false,anulada.is.null)&select=id_salida'),
            ]);
            const refs = []
              .concat((entradasRef||[]).map(function(e){ return 'ENT-'+e.id_entrada; }))
              .concat((salidasRef||[]).map(function(s){ return 'SAL-'+s.id_salida; }));
            if (refs.length) {
              const asientosArt = await api('cont_asientos','GET',null,
                '?referencia=in.(' + refs.join(',') + ')&estado=neq.ANULADO&select=id_asiento');
              const idsAst = (asientosArt||[]).map(function(a){ return a.id_asiento; });
              if (idsAst.length) {
                const lineasInv = await api('cont_asiento_lineas','GET',null,
                  '?id_asiento=in.(' + idsAst.join(',') + ')&id_cuenta=eq.' + art.id_cuenta_contable + '&select=debe_ves,haber_ves');
                let totalDebe = 0, totalHaber = 0;
                (lineasInv||[]).forEach(function(l) {
                  totalDebe  += parseFloat(l.debe_ves  || 0);
                  totalHaber += parseFloat(l.haber_ves || 0);
                });
                const residuo = parseFloat((totalDebe - totalHaber).toFixed(2));
                if (Math.abs(residuo) >= 0.01) {
                  const _todasCtasRedondeo = await obtenerCuentasContables();
                  const ctaGastoRes    = _todasCtasRedondeo.find(function(c){ return c.codigo === '6.2.02.001'; }) || null;
                  const ctaIngresoRes  = _todasCtasRedondeo.find(function(c){ return c.codigo === '4.2.02.001'; }) || null;
                  const montoAjuste = Math.abs(residuo);
                  if (residuo > 0) {
                    // Inventario quedó DEUDOR (sobró valor) -> Gasto (debe) / Inventario (haber)
                    const idCtaGasto = ctaGastoRes ? ctaGastoRes.id_cuenta : null;
                    if (idCtaGasto) {
                      await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:idCtaGasto, orden:3,
                        descripcion:'Ajuste por redondeo de inventario: '+(art.nombre_articulo||''),
                        debe_usd:0, haber_usd:0, debe_ves:montoAjuste, haber_ves:0, tasa_bcv:tasaProm });
                      await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:art.id_cuenta_contable, orden:4,
                        descripcion:'Ajuste por redondeo de inventario: '+(art.nombre_articulo||''),
                        debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjuste, tasa_bcv:tasaProm });
                    }
                  } else {
                    // Inventario quedó ACREEDOR (faltó valor) -> Inventario (debe) / Ingreso (haber)
                    const idCtaIngreso = ctaIngresoRes ? ctaIngresoRes.id_cuenta : null;
                    if (idCtaIngreso) {
                      await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:art.id_cuenta_contable, orden:3,
                        descripcion:'Ajuste por redondeo de inventario: '+(art.nombre_articulo||''),
                        debe_usd:0, haber_usd:0, debe_ves:montoAjuste, haber_ves:0, tasa_bcv:tasaProm });
                      await api('cont_asiento_lineas','POST',{ id_asiento:arS.id_asiento, id_cuenta:idCtaIngreso, orden:4,
                        descripcion:'Ajuste por redondeo de inventario: '+(art.nombre_articulo||''),
                        debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjuste, tasa_bcv:tasaProm });
                    }
                  }
                }
              }
            }
          } catch(eAjusteRedondeo) { console.warn('Error generando ajuste por redondeo de inventario:', eAjusteRedondeo); }
        }
      } catch(eAstSal) { console.warn('Error asiento salida consumible:', eAstSal); }
    }
    } // fin rama Consumible

    // ── Crear notificación de recepción para el empleado remitente ──
    if (idEmpRecibe && id_salida) {
      try {
        // Obtener correo del empleado remitente
        const empReceptor = await api('empleados','GET',null,'?id_empleado=eq.'+idEmpRecibe+'&select=correo,nombre_completo,id_usuario,usuarios(correo_usuario)');
        const correoReceptor = empReceptor?.[0]?.correo || empReceptor?.[0]?.usuarios?.correo_usuario || null;
        if (empReceptor && empReceptor[0] && correoReceptor) {
          const artNom   = art ? art.nombre_articulo : 'Artículo #'+idRep;
          // salida-area-entrega es ahora hidden — obtener nombre del área desde el span
          const areaOrig = document.getElementById('salida-entrega-area')?.textContent
            || document.getElementById('salida-area-entrega')?.value || 'Almacén';
          const areaDest = document.getElementById('salida-area')?.selectedOptions[0]?.text || 'Área';
          await api('notificaciones','POST',{
            tipo:           'RECEPCION_ARTICULO',
            id_empresa:      _empresaActiva?.id_empresa || null,
            correo_destino: correoReceptor,
            titulo:         'Solicitud de Recepción de Artículo',
            mensaje:        cantidad + ' unid. de "' + artNom + '" enviadas desde ' + areaOrig + ' hacia ' + areaDest + '. Por favor confirme la recepción.',
            estado:         'PENDIENTE',
            id_salida:      id_salida,
            datos_extra:    JSON.stringify({ id_articulo: idRep, cantidad: cantidad, id_area_origen: id_areaEntrega, id_area_destino: id_area })
          }, '', true);
        }
      } catch(eNot) { console.warn('Error creando notificación:', eNot); }
    }

    okEl.textContent = '✓ Salida de ' + cantidad + ' unidades registrada. Se notificó al receptor.';
    okEl.style.display = 'block';
    resetBtnSal();
    setTimeout(async function() {
      cerrarModal('modal-salida-stock');
      cerrarModal('modal-stock-articulo');
      if (typeof calcularInvSaldoArea === 'function') await calcularInvSaldoArea();
      renderInventario();
    }, 1500);
  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
  }
}

function onSelAreaSalida() {
  const id_area = document.getElementById('salida-area')?.value;
  cargarEmpleadosPorArea(parseInt(id_area)||null, 'salida-empleado', false);
}

async function cargarUsuarioEntregaSalida() {
  // El usuario actual ES quien entrega — traer su empleado y área automáticamente
  try {
    const correo = sesionActual?.correo_usuario;
    if (!correo) return;
    const emps = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(correo)+'&select=id_empleado,nombre_completo,id_area,param_areas(nombre,codigo)');
    const emp = emps && emps[0] ? emps[0] : null;

    const nomEl  = document.getElementById('salida-entrega-nombre');
    const areaEl = document.getElementById('salida-entrega-area');
    const hidEmp  = document.getElementById('salida-empleado-entrega');
    const hid_area = document.getElementById('salida-area-entrega');

    if (emp) {
      if (nomEl)  nomEl.textContent  = emp.nombre_completo;
      if (areaEl) areaEl.textContent = emp.param_areas
        ? emp.param_areas.nombre + (emp.param_areas.codigo ? ' (' + emp.param_areas.codigo + ')' : '')
        : '—';
      if (hidEmp)  hidEmp.value  = emp.id_empleado;
      if (hid_area) hid_area.value = emp.id_area || '';
    } else {
      // Usuario sin empleado asociado — mostrar correo
      if (nomEl)  nomEl.textContent  = correo;
      if (areaEl) areaEl.textContent = '';
    }
  } catch(e) { console.warn('cargarUsuarioEntregaSalida:', e); }
}

function _aplicarModoFaltante(modo, anulada) {
  document.getElementById('falt-modo').value = modo;
  const soloLectura = modo === 'ver';
  ['falt-area','falt-tipo','falt-cantidad'].forEach(function(id) {
    document.getElementById(id).disabled = true; // Área/Tipo/Cantidad nunca se editan una vez creado (definen el asiento ya generado)
  });
  if (modo === 'crear') {
    ['falt-area','falt-tipo','falt-cantidad'].forEach(function(id) { document.getElementById(id).disabled = false; });
  }
  document.getElementById('falt-empleado').disabled = soloLectura;
  document.getElementById('falt-observaciones').disabled = soloLectura;
  document.getElementById('falt-confirmacion-cont').style.display = soloLectura ? 'none' : '';
  document.getElementById('falt-badge-anulada').style.display = anulada ? '' : 'none';

  document.getElementById('falt-btn-retornar').style.display = ''; // Retornar siempre visible, en cualquier modo
  document.getElementById('falt-btn-guardar').style.display  = (modo === 'crear' || modo === 'editar') ? '' : 'none';
  document.getElementById('falt-btn-guardar').textContent    = modo === 'editar' ? '💾 Guardar Cambios' : '⚠ Realizar Ajuste';
  const puedeGestionar = sesionActual?.administrador || puedo('INVENTARIO','AJUSTE_INCIDENCIA');
  document.getElementById('falt-btn-editar').style.display = (modo === 'ver' && !anulada && puedeGestionar) ? '' : 'none';
  document.getElementById('falt-btn-anular').style.display = (modo === 'ver' && !anulada && puedeGestionar) ? '' : 'none';

  const titEl = document.getElementById('falt-titulo');
  const descEl = document.getElementById('falt-descripcion');
  if (modo === 'crear') {
    titEl.textContent = '⚠ Ajuste por Diferencia en Inventario';
    descEl.style.display = '';
  } else {
    const tipoTxt = document.getElementById('falt-tipo').value === 'sobrante' ? 'Sobrante' : 'Faltante';
    titEl.textContent = (modo === 'editar' ? '✏ EDITAR' : '👁 FICHA') + ' AJUSTE DE INVENTARIO — ' + tipoTxt;
    descEl.style.display = 'none';
  }
}

async function verFichaAjuste(tipoRegistro, idMovimiento, id_articulo) {
  // Ver la ficha requiere el mismo permiso mínimo que ya se necesitó para
  // abrir el Historial de Movimientos (VER) — el tipo de ficha que se muestra
  // es un hecho sobre el dato (es un Ajuste), no algo que dependa de si el
  // usuario puede además editarlo o anularlo. Ese control de acción
  // (Editar/Anular) vive aparte, en _aplicarModoFaltante().
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER')) {
    alert('No tiene permiso para ver esta ficha.'); return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
  let m;
  try {
    if (tipoRegistro === 'ENTRADA') {
      const res = await api('stock_entradas','GET',null,'?id_entrada=eq.'+idMovimiento+'&select=*');
      m = res && res[0];
    } else {
      const res = await api('stock_salidas','GET',null,'?id_salida=eq.'+idMovimiento+'&select=*');
      m = res && res[0];
    }
  } catch(e) { alert('Error cargando el ajuste: ' + e.message); return; }
  if (!m) { alert('No se encontró el registro.'); return; }

  document.getElementById('falt-id-articulo').value = id_articulo;
  document.getElementById('falt-id-movimiento').value = idMovimiento;
  document.getElementById('falt-tipo-registro').value = tipoRegistro;
  document.getElementById('falt-tipo').value = tipoRegistro === 'ENTRADA' ? 'sobrante' : 'faltante';
  onCambiarTipoFaltante();
  document.getElementById('falt-cantidad').value = m.cantidad;
  document.getElementById('falt-observaciones').value = (m.observaciones || '').replace(/^(FALTANTE|SOBRANTE) \(Ajuste de Inventario\):\s*/,'');
  document.getElementById('falt-clave').value = '';
  document.getElementById('alerta-falt-ok').style.display = 'none';
  document.getElementById('alerta-falt-err').style.display = 'none';

  const id_area = m.id_area;
  let areas = [];
  try { areas = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}
  const selArea = document.getElementById('falt-area');
  selArea.innerHTML = areas.map(function(a) { return '<option value="'+a.id+'"'+(a.id==id_area?' selected':'')+'>'+a.nombre+(a.codigo?' ('+a.codigo+')':'')+'</option>'; }).join('');
  document.getElementById('falt-stock-disponible').textContent = id_area && r ? ('Stock disponible en esta área: ' + await obtenerStockArea(id_articulo, id_area) + ' ' + (r.unidad||'UND')) : '';

  const idEmpleadoReporta = tipoRegistro === 'ENTRADA' ? m.id_empleado : m.id_empleado_entrega;
  const empleados = id_area ? await api('empleados','GET',null,'?estatus=eq.ACTIVO&id_area=eq.'+id_area+'&order=nombre_completo.asc&select=id_empleado,nombre_completo').catch(function(){ return []; }) : [];
  const selEmp = document.getElementById('falt-empleado');
  selEmp.innerHTML = empleados.map(function(e) { return '<option value="'+e.id_empleado+'"'+(e.id_empleado==idEmpleadoReporta?' selected':'')+'>'+e.nombre_completo+'</option>'; }).join('');

  await cargarUsuarioConfirmacionFaltante();
  _aplicarModoFaltante('ver', !!m.anulada);
  abrirModal('modal-faltante-inventario');
}

function habilitarEdicionFaltante() {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','AJUSTE_INCIDENCIA')) {
    alert('No tiene permiso para editar Ajustes de Inventario.'); return;
  }
  _aplicarModoFaltante('editar', false);
}

async function anularFichaAjuste() {
  const tipoRegistro = document.getElementById('falt-tipo-registro').value;
  const idMovimiento = parseInt(document.getElementById('falt-id-movimiento').value);
  const id_articulo  = parseInt(document.getElementById('falt-id-articulo').value);
  const cantidad     = parseFloat(document.getElementById('falt-cantidad').value) || 0;
  if (!confirm('¿Anular este Ajuste de Inventario? Esta acción revertirá el stock y el asiento contable.')) return;
  cerrarModal('modal-faltante-inventario');
  if (tipoRegistro === 'ENTRADA') {
    await anularMovimiento('ENTRADA', idMovimiento, cantidad, id_articulo);
  } else {
    await anularSalidaStock(idMovimiento, id_articulo, cantidad);
  }
}

async function abrirFaltanteInventario(id) {
  if (!puedo('INVENTARIO','AJUSTE_INCIDENCIA')) { alert('No tiene permiso para realizar Ajustes por diferencia en Inventario.'); return; }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  document.getElementById('falt-id-articulo').value = id;
  document.getElementById('falt-id-movimiento').value = '';
  document.getElementById('falt-tipo-registro').value = '';
  document.getElementById('falt-cantidad').value = '';
  document.getElementById('falt-observaciones').value = '';
  document.getElementById('falt-clave').value = '';
  document.getElementById('falt-stock-disponible').textContent = '';
  document.getElementById('alerta-falt-ok').style.display = 'none';
  document.getElementById('alerta-falt-err').style.display = 'none';

  const selArea = document.getElementById('falt-area');
  const selTipo = document.getElementById('falt-tipo');
  let areas = [];
  try { areas = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}
  selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
    + areas.map(function(a) { return '<option value="'+a.id+'">'+a.nombre+(a.codigo?' ('+a.codigo+')':'')+'</option>'; }).join('');
  selArea.value = '';   // sin preselección — es una decisión del usuario
  selTipo.value = '';   // sin preselección — es una decisión del usuario
  onCambiarTipoFaltante();
  document.getElementById('falt-empleado').innerHTML = '<option value="">— Seleccione primero el área —</option>';

  // Confirmación de Usuario — SIEMPRE el usuario logueado (igual que Entrada de Stock),
  // no el "Empleado que reporta" (que es solo informativo, filtrado por área).
  await cargarUsuarioConfirmacionFaltante();

  _aplicarModoFaltante('crear');
  cerrarModal('modal-stock-articulo');
  abrirModal('modal-faltante-inventario');
  focusFirstField('modal-faltante-inventario');
}

async function cargarUsuarioConfirmacionFaltante() {
  const nomEl = document.getElementById('falt-usuario-nombre');
  try {
    const correo = sesionActual?.correo_usuario;
    if (!correo) { if (nomEl) nomEl.textContent = '—'; return; }
    const emps = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(correo)+'&select=nombre_completo');
    const emp = emps && emps[0] ? emps[0] : null;
    if (nomEl) nomEl.textContent = emp ? emp.nombre_completo : correo;
  } catch(e) {
    if (nomEl) nomEl.textContent = sesionActual?.correo_usuario || '—';
  }
}

async function onCambiarAreaFaltante() {
  const id_articulo = parseInt(document.getElementById('falt-id-articulo').value);
  const id_area = parseInt(document.getElementById('falt-area').value) || null;
  const selEmp = document.getElementById('falt-empleado');
  const infoEl = document.getElementById('falt-stock-disponible');
  if (!id_area) {
    selEmp.innerHTML = '<option value="">— Seleccione primero el área —</option>';
    infoEl.textContent = '';
    return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
  const [empleados, stockDisp] = await Promise.all([
    api('empleados', 'GET', null, '?estatus=eq.ACTIVO&id_area=eq.'+id_area+'&order=nombre_completo.asc&select=id_empleado,nombre_completo').catch(function(){ return []; }),
    obtenerStockArea(id_articulo, id_area)
  ]);
  selEmp.innerHTML = empleados.length
    ? '<option value="">— Seleccionar empleado —</option>' + empleados.map(function(e) { return '<option value="'+e.id_empleado+'">'+e.nombre_completo+'</option>'; }).join('')
    : '<option value="">— Esta área no tiene empleados activos —</option>';
  infoEl.textContent = 'Stock disponible en esta área: ' + stockDisp + ' ' + (r?.unidad || 'UND');
}

function onCambiarTipoFaltante() {
  const tipo = document.getElementById('falt-tipo').value;
  const descEl = document.getElementById('falt-descripcion');
  if (!tipo) {
    document.getElementById('falt-label-cantidad').textContent = 'Cantidad *';
    descEl.innerHTML = 'Selecciona si el conteo físico encontró <b>menos</b> (Faltante) o <b>más</b> (Sobrante) unidades de las que el sistema tiene registradas.';
    return;
  }
  const esFaltante = tipo === 'faltante';
  document.getElementById('falt-label-cantidad').textContent = esFaltante ? 'Cantidad Faltante *' : 'Cantidad Sobrante *';
  descEl.innerHTML = esFaltante
    ? 'No es un reverso de ninguna operación — genera una <b>Pérdida por Ajuste de Inventario</b> y descuenta el stock del área seleccionada.'
    : 'No es un reverso de ninguna operación — genera una <b>Ganancia por Ajuste de Inventario</b> y suma el stock al área seleccionada.';
}

async function guardarFaltanteInventario() {
  const modo = document.getElementById('falt-modo').value;
  if (modo === 'editar') return guardarEdicionFaltante();
  if (!puedo('INVENTARIO','AJUSTE_INCIDENCIA')) { alert('No tiene permiso.'); return; }
  const errEl = document.getElementById('alerta-falt-err');
  const okEl  = document.getElementById('alerta-falt-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  const id_articulo = parseInt(document.getElementById('falt-id-articulo').value);
  const id_area      = parseInt(document.getElementById('falt-area').value) || null;
  const tipo         = document.getElementById('falt-tipo').value; // 'faltante' | 'sobrante'
  const esFaltante   = tipo === 'faltante';
  const cantidad     = parseFloat(document.getElementById('falt-cantidad').value);
  const idEmpleado   = parseInt(document.getElementById('falt-empleado').value) || null; // informativo
  const clave        = document.getElementById('falt-clave').value || '';
  const obs          = document.getElementById('falt-observaciones').value.trim();

  if (!id_area)              { errEl.textContent = 'Debe seleccionar el área afectada.'; errEl.style.display = 'block'; return; }
  if (!tipo)                 { errEl.textContent = 'Debe seleccionar el Tipo de Ajuste (Faltante o Sobrante).'; errEl.style.display = 'block'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor a cero.'; errEl.style.display = 'block'; return; }

  // El artículo debe haber tenido al menos una Entrada real antes de poder
  // ajustarlo -- si nunca entró por Compras, no hay costo con el que
  // valorarlo, y el asiento contable terminaba omitiéndose en silencio
  // (el monto daba 0, ver guardarFaltanteInventario más abajo).
  let tieneEntradasFalt = false;
  try {
    const entradasFalt = await api('stock_entradas','GET',null,'?id_articulo=eq.'+id_articulo+'&select=id_entrada&limit=1');
    tieneEntradasFalt = entradasFalt && entradasFalt.length > 0;
  } catch(eEntFalt) { tieneEntradasFalt = false; /* por seguridad, bloquear si no se pudo confirmar */ }
  if (!tieneEntradasFalt) {
    errEl.textContent = 'Este artículo nunca ha tenido una Entrada registrada. No se puede hacer un Ajuste de Discrepancia sin un costo real con el cual valorarlo -- registre primero una Entrada de Compra.';
    errEl.style.display = 'block';
    return;
  }

  if (!idEmpleado)           { errEl.textContent = 'Debe seleccionar el empleado que reporta.'; errEl.style.display = 'block'; return; }
  if (!clave)                { errEl.textContent = 'Debe ingresar su contraseña para confirmar.'; errEl.style.display = 'block'; return; }
  const valid = await validarClaveUsuarioActual(clave);
  if (!valid.ok)             { errEl.textContent = valid.msg; errEl.style.display = 'block'; return; }

  if (esFaltante) {
    const stockDisponible = await obtenerStockArea(id_articulo, id_area);
    if (cantidad > stockDisponible) {
      errEl.textContent = 'La cantidad supera el stock disponible en esa área (' + stockDisponible + ').';
      errEl.style.display = 'block'; return;
    }
  }

  try {
    const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
    const cpp = parseFloat(r?.precio_costo_moneda || 0);
    const montoUSD = parseFloat((cantidad * cpp).toFixed(4));
    const areaNombre = document.getElementById('falt-area')?.selectedOptions[0]?.text || 'Área';

    if (esFaltante) {
      // ── FALTANTE: descuenta stock + Pérdida por Ajuste ──
      await upsertStockArea(id_articulo, id_area, -cantidad);
      const sal = await api('stock_salidas','POST',{
        id_articulo: id_articulo, id_area: id_area, cantidad: cantidad,
        id_empleado_entrega: idEmpleado, fecha_salida: getHoyVzla(),
        observaciones: 'FALTANTE (Ajuste de Inventario): ' + (obs || 'Conteo físico'),
        id_usuario: sesionActual.correo_usuario
      });
      const id_salida = sal && sal[0] ? sal[0].id_salida : null;
      if (montoUSD > 0 && r) {
        await generarAsientoInventario('SALIDA_AJUSTE', {
          articulo: r.nombre_articulo || r.codigo_articulo || ('Art#' + id_articulo),
          cantidad: cantidad, montoUSD: montoUSD, areaNombre: areaNombre,
          referencia: id_salida ? 'SAL-' + id_salida : 'FALT-' + id_articulo,
          id_cuentaInventario: r.id_cuenta_contable || null,
          fecha: getHoyVzla(), tasa: _tasaVigente || null
        });
      }
    } else {
      // ── SOBRANTE: suma stock + Ganancia por Ajuste ──
      await upsertStockArea(id_articulo, id_area, cantidad);
      const ent = await api('stock_entradas','POST',{
        id_articulo: id_articulo, cantidad: cantidad, precio_costo_moneda: cpp,
        fecha_entrada: getHoyVzla(), fecha_negociacion: getHoyVzla(),
        id_area: id_area, id_empleado: idEmpleado, motivo: 'ajuste',
        observaciones: 'SOBRANTE (Ajuste de Inventario): ' + (obs || 'Conteo físico'),
        id_usuario: sesionActual.correo_usuario
      });
      const id_entrada = ent && ent[0] ? ent[0].id_entrada : null;
      if (montoUSD > 0 && r) {
        await generarAsientoInventario('ENTRADA_AJUSTE', {
          articulo: r.nombre_articulo || r.codigo_articulo || ('Art#' + id_articulo),
          cantidad: cantidad, montoUSD: montoUSD, areaId: id_area, areaNombre: areaNombre,
          referencia: id_entrada ? 'ENT-' + id_entrada : 'SOBR-' + id_articulo,
          id_cuentaInventario: r.id_cuenta_contable || null,
          fecha: getHoyVzla(), tasa: _tasaVigente || null
        });
      }
    }

    okEl.textContent = '✓ Ajuste realizado: ' + (esFaltante ? '-' : '+') + cantidad + ' ' + (r?.unidad || 'UND') + ' en ' + areaNombre + '.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-faltante-inventario');
      renderInventario();
    }, 1200);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function guardarEdicionFaltante() {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','AJUSTE_INCIDENCIA')) { alert('No tiene permiso.'); return; }
  const errEl = document.getElementById('alerta-falt-err');
  const okEl  = document.getElementById('alerta-falt-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  const tipoRegistro = document.getElementById('falt-tipo-registro').value;
  const idMovimiento = parseInt(document.getElementById('falt-id-movimiento').value);
  const idEmpleado   = parseInt(document.getElementById('falt-empleado').value) || null;
  const clave        = document.getElementById('falt-clave').value || '';
  const obsBase      = document.getElementById('falt-observaciones').value.trim();
  const prefijo      = tipoRegistro === 'ENTRADA' ? 'SOBRANTE (Ajuste de Inventario): ' : 'FALTANTE (Ajuste de Inventario): ';

  if (!idEmpleado) { errEl.textContent = 'Debe seleccionar el empleado que reporta.'; errEl.style.display = 'block'; return; }
  if (!clave)      { errEl.textContent = 'Debe ingresar su contraseña para confirmar.'; errEl.style.display = 'block'; return; }
  const valid = await validarClaveUsuarioActual(clave);
  if (!valid.ok)   { errEl.textContent = valid.msg; errEl.style.display = 'block'; return; }

  try {
    if (tipoRegistro === 'ENTRADA') {
      await api('stock_entradas','PATCH',{ id_empleado: idEmpleado, observaciones: prefijo + (obsBase || 'Conteo físico') }, '?id_entrada=eq.'+idMovimiento);
    } else {
      await api('stock_salidas','PATCH',{ id_empleado_entrega: idEmpleado, observaciones: prefijo + (obsBase || 'Conteo físico') }, '?id_salida=eq.'+idMovimiento);
    }
    okEl.textContent = '✓ Cambios guardados.';
    okEl.style.display = 'block';
    setTimeout(function() {
      _aplicarModoFaltante('ver', false);
    }, 900);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function regresarAFichaInv() {
  // Cerrar modales y volver a tabla principal con cache actualizado
  cerrarModal('modal-stock-articulo');
  cerrarModal('modal-ficha-inv');
  try {
    if (_fichaInvActual && _fichaInvActual.id) {
      const res = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + _fichaInvActual.id + '&select=*');
      if (res && res[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === _fichaInvActual.id; });
        if (i !== -1) inventarioCache[i] = res[0];
      }
    }
  } catch(e) {}
  if (typeof calcularInvSaldoArea === 'function') await calcularInvSaldoArea();
  if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
}

function onSelAreaEntrada() {
  const id_area = document.getElementById('es-area')?.value;
  cargarEmpleadosPorArea(parseInt(id_area)||null, 'es-empleado', true);
}

async function buscarTasaBCVNegociacion() {
  const moneda = document.getElementById('es-moneda-compra')?.value || 'USD';
  const esVES  = moneda === 'VES';
  const fecha  = document.getElementById('es-fecha-negociacion')?.value || getHoyVzla();
  console.log('[SYD] fecha:', fecha, 'moneda:', moneda);
  try {
    const tasas = await api('tasas', 'GET', null,
      '?fecha_valor=lte.' + fecha + '&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
    if (tasas && tasas.length) {
      document.getElementById('es-tasa-bcv').value = parseFloat(tasas[0].tipo_cambio).toFixed(4);
      if (esVES) {
        document.getElementById('es-ref-cpp').textContent = 'Tasa BCV: ' + parseFloat(tasas[0].tipo_cambio).toFixed(4) + ' Bs/$ (' + tasas[0].fecha_valor + ')';
      }
    } else if (esVES) {
      document.getElementById('es-tasa-bcv').value = '';
      document.getElementById('es-ref-cpp').textContent = 'No se encontró tasa BCV para esta fecha';
    }
  } catch(e) { console.error('[SYD] buscarTasaBCVNegociacion error:', e.message); }
  if (esVES) onCambiarPrecioEntrada();
}

async function onCambiarFechaNegociacionEntrada() {
  console.log('[SYD] onCambiarFechaNegociacionEntrada llamada');
  await buscarTasaBCVNegociacion();
}

async function onCambiarMonedaEntrada() {
  const moneda   = document.getElementById('es-moneda-compra')?.value || 'USD';
  // Actualizar labels de moneda
  const lblCompra = document.getElementById('es-label-moneda-compra');
  const lblVenta  = document.getElementById('es-label-moneda-venta');
  if (lblCompra) lblCompra.textContent = '(' + moneda + ')';
  if (lblVenta)  lblVenta.textContent  = '(' + moneda + ')';
  const tasaCont = document.getElementById('es-tasa-cont');
  const usdCont  = document.getElementById('es-precio-usd-cont');
  const esVES    = moneda === 'VES';

  if (tasaCont) tasaCont.style.display  = ''; // Siempre visible como referencia
  if (usdCont)  usdCont.style.display   = ''; // Siempre visible — VES si moneda VES, VES calculado si USD

  // Actualizar label del campo de precio VES calculado
  const lblUSD = document.getElementById('es-label-precio-usd');
  if (lblUSD) lblUSD.textContent = esVES ? 'Monto en USD' : 'Monto en VES';

  await buscarTasaBCVNegociacion();
  onCambiarPrecioEntrada();
}

function onCambioExentoIVAEntrada() {
  const exento = document.getElementById('es-exento-iva-val')?.value === 'SI';
  const ivaContEl = document.getElementById('es-incluye-iva-cont');
  if (ivaContEl) ivaContEl.style.display = exento ? 'none' : '';
  // Limpiar selección de incluye IVA al cambiar
  document.getElementById('es-incluye-iva-val').value = '';
  document.querySelectorAll('input[name="es-entrada-incluye-iva"]').forEach(function(r){ r.checked = false; });
  const prev = document.getElementById('es-tributos-preview');
  if (prev) prev.style.display = 'none';
  calcularTributosEntrada();
  const cme2 = document.getElementById('es-cuotas-monto');
  if (cme2) cme2.value = '';
  calcularCuotasEntrada();
}

function calcularTributosEntrada() {
  const pctIVAEnt = Math.round(tasaIVAActual()*100);
  const pctLblEnt = document.getElementById('es-iva-pct-label');
  if (pctLblEnt) pctLblEnt.textContent = 'IVA (' + pctIVAEnt + '%)';
  const pctSpanEnt = document.getElementById('es-trib-iva-pct');
  if (pctSpanEnt) pctSpanEnt.textContent = pctIVAEnt;
  const exento     = document.getElementById('es-exento-iva-val')?.value === 'SI';
  const ivaVal     = document.getElementById('es-incluye-iva-val')?.value;
  const prev = document.getElementById('es-tributos-preview');

  // Si exento — no hay IVA, mostrar solo base
  if (exento) {
    const montoTotal = parseMontoVE(document.getElementById('es-precio-costo')?.value)
                     * parseFloat(document.getElementById('es-cantidad')?.value || 0);
    if (!montoTotal) { if (prev) prev.style.display = 'none'; return; }
    const moneda = document.getElementById('es-moneda-compra')?.value || 'USD';
    const tasa   = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
    const sim    = moneda === 'VES' ? 'Bs.' : '$';
    document.getElementById('es-trib-base').textContent  = sim + ' ' + fmtBs(montoTotal);
    document.getElementById('es-trib-iva').textContent   = '—';
    document.getElementById('es-trib-total').textContent = sim + ' ' + fmtBs(montoTotal);
    document.getElementById('es-trib-base-ves').textContent  = tasa > 0 && moneda !== 'VES' ? 'Bs. ' + fmtBs(montoTotal * tasa) : '—';
    document.getElementById('es-trib-iva-ves').textContent   = '—';
    document.getElementById('es-trib-total-ves').textContent = tasa > 0 && moneda !== 'VES' ? 'Bs. ' + fmtBs(montoTotal * tasa) : '—';
    if (prev) prev.style.display = '';
    return;
  }

  // Si no ha seleccionado IVA — no calcular
  if (!ivaVal) { if (prev) prev.style.display = 'none'; return; }

  const incluyeIVA = ivaVal === 'SI';
  const montoTotal2 = parseMontoVE(document.getElementById('es-precio-costo')?.value)
                   * parseFloat(document.getElementById('es-cantidad')?.value || 0);
  if (!montoTotal2) { if (prev) prev.style.display = 'none'; return; }

  const IVA_RATE = tasaIVAActual();
  let base, iva, total;
  if (false) { // exento ya manejado arriba
  } else if (incluyeIVA) {
    base  = parseFloat((montoTotal2 / (1 + IVA_RATE)).toFixed(4));
    iva   = parseFloat((montoTotal2 - base).toFixed(4));
    total = montoTotal2;
  } else {
    base  = montoTotal2;
    iva   = parseFloat((montoTotal2 * IVA_RATE).toFixed(4));
    total = parseFloat((montoTotal2 + iva).toFixed(4));
  }

  const moneda = document.getElementById('es-moneda-compra')?.value || 'USD';
  const tasa   = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
  const sim    = moneda === 'VES' ? 'Bs.' : '$';

  document.getElementById('es-trib-base').textContent  = sim + ' ' + fmtBs(base);
  document.getElementById('es-trib-iva').textContent   = iva > 0 ? sim + ' ' + fmtBs(iva) : '—';
  document.getElementById('es-trib-total').textContent = sim + ' ' + fmtBs(total);

  // Columna VES
  if (tasa > 0 && moneda !== 'VES') {
    const baseVesEnt  = parseFloat((base * tasa).toFixed(2));
    const totalVesEnt = parseFloat((total * tasa).toFixed(2));
    const ivaVesEnt   = parseFloat((totalVesEnt - baseVesEnt).toFixed(2));
    document.getElementById('es-trib-base-ves').textContent  = 'Bs. ' + fmtBs(baseVesEnt);
    document.getElementById('es-trib-iva-ves').textContent   = iva > 0 ? 'Bs. ' + fmtBs(ivaVesEnt) : '—';
    document.getElementById('es-trib-total-ves').textContent = 'Bs. ' + fmtBs(totalVesEnt);
  } else {
    document.getElementById('es-trib-base-ves').textContent  = moneda === 'VES' && tasa > 0 ? '$ ' + fmtBs(base / tasa) : '—';
    document.getElementById('es-trib-iva-ves').textContent   = moneda === 'VES' && iva > 0 && tasa > 0 ? '$ ' + fmtBs(iva / tasa) : '—';
    document.getElementById('es-trib-total-ves').textContent = moneda === 'VES' && tasa > 0 ? '$ ' + fmtBs(total / tasa) : '—';
  }
  if (prev) prev.style.display = '';
}

function onCambiarPrecioEntrada() {
  const moneda   = document.getElementById('es-moneda-compra')?.value || 'USD';
  const precio   = parseMontoVE(document.getElementById('es-precio-costo')?.value);
  const cantidad = parseFloat(document.getElementById('es-cantidad')?.value) || 0;
  const tasa     = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
  const elCalc   = document.getElementById('es-precio-usd-calc');
  const elMonto  = document.getElementById('es-monto-total');
  const lblMonto = document.getElementById('es-label-monto-total');

  // Monto = Cantidad × Precio (en la moneda de negociación)
  const montoTotal = precio * cantidad;
  if (elMonto) elMonto.value = fmtBs(montoTotal);
  if (lblMonto) lblMonto.innerHTML = 'Monto en ' + moneda;

  // Precio VES calculado
  if (!elCalc || !tasa) { calcularTributosEntrada(); const cme = document.getElementById('es-cuotas-monto'); if (cme) cme.value=''; calcularCuotasEntrada(); return; }
  if (moneda === 'VES') {
    elCalc.value = tasa > 0 ? fmtBs(montoTotal / tasa) : '';
  } else {
    elCalc.value = fmtBs(montoTotal * tasa);
  }
  calcularTributosEntrada();
  const cuotaMontoEl = document.getElementById('es-cuotas-monto');
  if (cuotaMontoEl) cuotaMontoEl.value = '';
  calcularCuotasEntrada();
}

function onCambiarFacturaDevolucion() {
  const idFact = document.getElementById('es-factura-devolucion')?.value;
  const infoEl = document.getElementById('es-factura-devolucion-info');
  const cantEl = document.getElementById('es-cantidad');
  if (!idFact || !infoEl) { if (infoEl) infoEl.style.display = 'none'; return; }
  const f = (window._facturasDevolucionArt || []).find(function(x) { return String(x.id_factura) === String(idFact); });
  if (!f) { infoEl.style.display = 'none'; return; }
  infoEl.innerHTML = 'Facturado: <b>' + f.cantidad_facturada + ' unid.</b> — Subtotal línea: $' + f.subtotal_usd_linea.toFixed(2)
    + (f.aplica_iva ? ' — Factura con IVA' : '') + (f.aplica_igtf ? ' — Factura con IGTF' : '')
    + '<br>La cantidad que ingreses abajo se prorrateará sobre este monto para reversar el asiento de venta y de costo.';
  infoEl.style.display = 'block';
  if (cantEl) cantEl.max = f.cantidad_facturada;
}

function onCambiarMotivoEntrada() {
  const motivo = document.getElementById('es-motivo')?.value;
  const esCompra = motivo === 'compra';
  const tribuCont = document.getElementById('es-tributos-cont');
  if (tribuCont) tribuCont.style.display = esCompra ? '' : 'none';

  // Campos de Negociación (Moneda/Precio/Monto/Tasa BCV) y Modalidad de Pago
  // solo aplican a Compra — el CPP de Devolución/Ajuste/Transferencia se toma
  // tal cual está, sin promediar un precio inventado.
  const negCont  = document.getElementById('es-negociacion-cont');
  const pagoCont = document.getElementById('es-pago-cont');
  if (negCont)  negCont.style.display  = esCompra ? 'contents' : 'none';
  if (pagoCont) pagoCont.style.display = esCompra ? 'contents' : 'none';
  if (!esCompra) {
    // Limpiar valores para que no queden datos viejos de una Compra anterior
    if (document.getElementById('es-moneda-compra')) document.getElementById('es-moneda-compra').selectedIndex = 0;
    if (document.getElementById('es-precio-costo'))  document.getElementById('es-precio-costo').value = '';
    if (document.getElementById('es-monto-total'))   document.getElementById('es-monto-total').value = '0,00';
    if (document.getElementById('es-tasa-bcv'))      document.getElementById('es-tasa-bcv').value = '';
    if (document.getElementById('es-precio-usd-calc')) document.getElementById('es-precio-usd-calc').value = '';
    if (document.getElementById('es-esquema-pago'))  document.getElementById('es-esquema-pago').selectedIndex = 0;
    if (document.getElementById('es-fecha-pago-cont')) document.getElementById('es-fecha-pago-cont').style.display = 'none';
    if (document.getElementById('es-credito-cont'))  document.getElementById('es-credito-cont').style.display = 'none';
  }

  // Resetear IVA — sin preselección
  document.querySelectorAll('input[name="es-entrada-incluye-iva"]').forEach(function(r){ r.checked = false; });
  const prev = document.getElementById('es-tributos-preview');
  if (prev) prev.style.display = 'none';
  const contProv    = document.getElementById('es-campo-proveedor-cont');
  const contCliente = document.getElementById('es-campo-cliente-cont');
  const contTransf  = document.getElementById('es-campo-transferencia-cont');
  if (!contProv) return;

  // Ocultar todos los campos adicionales
  contProv.style.display    = 'none';
  contCliente.style.display = 'none';
  contTransf.style.display  = 'none';

  // Mostrar el correspondiente
  if (motivo === 'compra') {
    contProv.style.display = '';
    contProv.querySelector('label').textContent = 'Proveedor *';
  } else if (motivo === 'devolucion') {
    contCliente.style.display = '';
  } else if (motivo === 'transferencia') {
    contTransf.style.display = '';
  }

  // Restricción de moneda:
  // Solo compra con proveedor puede ser en moneda distinta a la Funcional.
  // Transferencias, devoluciones y ajustes = solo Moneda Funcional.
  const selMoneda = document.getElementById('es-moneda-compra');
  const monedaFunc = ((_empresaActiva?.moneda_principal) || 'VES').toUpperCase();
  if (selMoneda) {
    if (!motivo) {
      // Sin transacción seleccionada — habilitar moneda y mostrar placeholder
      Array.from(selMoneda.options).forEach(function(o) { o.disabled = false; });
      selMoneda.disabled = false;
      selMoneda.selectedIndex = 0;
    } else if (motivo === 'compra') {
      // Habilitar todas las opciones
      Array.from(selMoneda.options).forEach(function(o) { o.disabled = false; });
      selMoneda.disabled = false;
    } else {
      // Forzar Moneda Funcional y deshabilitar el select
      selMoneda.value    = monedaFunc;
      selMoneda.disabled = true;
      // Disparar el cambio para actualizar labels de tasa/precio
      selMoneda.dispatchEvent(new Event('change'));
    }
  }
}

async function cargarUsuarioReceptorEntrada() {
  try {
    const correo = sesionActual?.correo_usuario;
    if (!correo) return;
    const emps = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(correo)+'&select=id_empleado,nombre_completo,id_area,param_areas(nombre,codigo)');
    const emp = emps && emps[0] ? emps[0] : null;

    const nomEl    = document.getElementById('es-receptor-nombre');
    const areaEl   = document.getElementById('es-receptor-area');
    const hidEmp   = document.getElementById('es-empleado');
    const hid_area  = document.getElementById('es-area');
    const areaDisp = document.getElementById('es-area-display');

    if (emp) {
      const areaNom = emp.param_areas
        ? emp.param_areas.nombre + (emp.param_areas.codigo ? ' (' + emp.param_areas.codigo + ')' : '')
        : '—';
      if (nomEl)    nomEl.textContent    = emp.nombre_completo;
      if (areaEl)   areaEl.textContent   = areaNom;
      if (areaDisp) areaDisp.textContent = areaNom;
      if (hidEmp)   hidEmp.value         = emp.id_empleado;
      if (hid_area)  hid_area.value        = emp.id_area || '';
    } else {
      if (nomEl)    nomEl.textContent    = correo;
      if (areaDisp) areaDisp.textContent = '—';
    }
  } catch(e) { console.warn('cargarUsuarioReceptorEntrada:', e); }
}

function onSelAreaEntrega() {
  const id_area = document.getElementById('salida-area-entrega')?.value;
  cargarEmpleadosPorArea(parseInt(id_area)||null, 'salida-empleado-entrega', false);
}
