// ─── S&D Systems — Módulo: VENTAS (mostrador / venta directa) ───
// Creado el 2026-08-26. Una Venta pasa por 4 estados:
//   BORRADOR (armando, editable) -> CONFIRMADA (lista, aún sin tocar stock/contabilidad)
//   -> FACTURADA (genera factura + CxC + asiento + descuenta stock real, vía
//      generarCxCyAsientoFactura() en ingresos.js) -> ANULADA
//
// El stock NO se descuenta hasta que la Venta se FACTURA -- antes de eso es
// solo un "carrito" en memoria/BD, sin efecto real en Inventario/Contabilidad.
//
// NOTA: el valor interno 'BORRADOR' se muestra en la interfaz como
// "Presupuesto" (ver ESTADO_LABEL) -- es más claro para el operador, ya que
// en esta etapa aún no hay ningún compromiso real de stock ni contabilidad.
const ESTADO_LABEL_VENTA = { BORRADOR: 'Presupuesto', CONFIRMADA: 'Confirmada', FACTURADA: 'Facturada', ANULADA: 'Anulada' };

let _ventaLineas = []; // líneas en edición del modal (en memoria, no se guardan hasta "Guardar Borrador")
let _ventaLineasOriginales = []; // snapshot de las líneas YA GUARDADAS al abrir el modal -- para poder revertir la reserva en vivo si se cierra sin guardar (Retornar / ✕)
let _idAreaAlmacenVentas = null; // id de "Gerencia de Compras" (código 2300) -- Ventas siempre descuenta de ahí, sin pedirle al operador que elija Área
let _articulosMercanciaVentas = []; // artículos filtrados (solo Mercancías, cuenta 1.1.03.001) con su stock en el Almacén
let _invTiposCacheVentas = []; // catálogo de Tipos de Artículo (inv_articulos_tipo) -- para el filtro por Tipo
let _vtaFiltroCategoria = '';
let _vtaFiltroTipo = '';
let _vtaFiltroTexto = '';
let _vtaFiltroSoloStock = false;

async function _obtenerAreaAlmacenVentas() {
  if (_idAreaAlmacenVentas) return _idAreaAlmacenVentas;
  try {
    const r = await api('param_areas','GET',null,'?codigo=eq.2300&select=id&limit=1');
    _idAreaAlmacenVentas = (r && r[0]) ? r[0].id : null;
  } catch(e) { _idAreaAlmacenVentas = null; }
  return _idAreaAlmacenVentas;
}

// Ventas solo puede vender artículos catalogados como Mercancías (cuenta
// contable 1.1.03.001 — Inventario de Mercancías), no Repuestos ni
// Consumibles de Taller. Se recalcula cada vez que se abre el modal, para
// que el stock mostrado entre paréntesis esté siempre al día.
async function _cargarArticulosMercanciaVentas() {
  const idArea = await _obtenerAreaAlmacenVentas();
  let idCuentaMercancias = null;
  try {
    const cuentas = await obtenerCuentasContables();
    const ctaMercancias = cuentas.find(function(c) { return c.codigo === '1.1.03.001'; });
    idCuentaMercancias = ctaMercancias ? ctaMercancias.id_cuenta : null;
  } catch(e) {}

  const soloMercancias = idCuentaMercancias
    ? inventarioCache.filter(function(a) { return a.id_cuenta_contable === idCuentaMercancias; })
    : [];

  let mapaStock = {};
  if (idArea) {
    try {
      const filas = await api('inventario_stock_area','GET',null,'?id_area=eq.'+idArea+'&select=id_articulo,stock_actual,reservado');
      (filas||[]).forEach(function(f) { mapaStock[f.id_articulo] = parseFloat(f.stock_actual||0) - parseFloat(f.reservado||0); });
    } catch(e) {}
  }

  _articulosMercanciaVentas = soloMercancias.map(function(a) {
    return {
      id_articulo: a.id_articulo, nombre_articulo: a.nombre_articulo, codigo_articulo: a.codigo_articulo,
      id_categoria_articulo: a.id_categoria_articulo || null, id_tipo_articulo: a.id_tipo_articulo || null,
      stockAlmacen: mapaStock[a.id_articulo] || 0
    };
  }).sort(function(a,b) { return a.nombre_articulo.localeCompare(b.nombre_articulo); });
}

// Aplica los 4 filtros (Categoría, Tipo de Artículo, texto, Solo con
// stock) sobre la lista base -- usado para poblar las opciones del select
// de cada línea. `idArticuloActual` (si viene) siempre se incluye aunque
// no cumpla el filtro, para no "perder" la selección ya hecha en esa línea.
function _articulosFiltradosVenta(idArticuloActual) {
  const texto = (_vtaFiltroTexto||'').toLowerCase().trim();
  return _articulosMercanciaVentas.filter(function(a) {
    if (idArticuloActual && a.id_articulo === idArticuloActual) return true;
    if (_vtaFiltroCategoria && String(a.id_categoria_articulo) !== String(_vtaFiltroCategoria)) return false;
    if (_vtaFiltroTipo && String(a.id_tipo_articulo) !== String(_vtaFiltroTipo)) return false;
    if (_vtaFiltroSoloStock && a.stockAlmacen <= 0) return false;
    if (texto && !(a.nombre_articulo.toLowerCase().includes(texto) || (a.codigo_articulo||'').toLowerCase().includes(texto))) return false;
    return true;
  });
}

function _filtrarArticulosVenta() {
  _vtaFiltroCategoria  = document.getElementById('vta-filtro-categoria')?.value || '';
  _vtaFiltroTipo       = document.getElementById('vta-filtro-tipo')?.value || '';
  _vtaFiltroTexto      = document.getElementById('vta-filtro-buscar')?.value || '';
  _vtaFiltroSoloStock  = document.getElementById('vta-filtro-solo-stock')?.checked || false;
  _renderLineasVenta();
}

async function renderVentas() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('VENTAS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando ventas...</div>';
  try {
    const filtroEmpresa = _empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : '';
    const ventas = await api('ventas', 'GET', null,
      '?order=fecha_registro.desc&select=*,clientes(nombre_apellido,condicion_legal,identificacion),facturas(numero_factura)' + filtroEmpresa);
    ventasCache = ventas;

    const stats = { BORRADOR: 0, CONFIRMADA: 0, FACTURADA: 0, ANULADA: 0 };
    ventas.forEach(function(v) { if (stats[v.estado] !== undefined) stats[v.estado]++; });

    const ESTADO_BADGE = { BORRADOR: 'badge-gris', CONFIRMADA: 'badge-naranja', FACTURADA: 'badge-verde', ANULADA: 'badge-rojo' };

    const filas = ventas.map(function(v) {
      const cli = v.clientes;
      return '<tr data-id="' + v.id_venta + '">'
        + '<td style="font-family:var(--font-mono);font-size:12px">' + (v.facturas?.numero_factura || 'V-' + v.id_venta) + '</td>'
        + '<td>' + (cli ? cli.nombre_apellido : '—') + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (cli ? cli.condicion_legal + '-' + cli.identificacion : '') + '</div></td>'
        + '<td style="font-size:12px">' + fmtFecha(v.fecha_venta) + '</td>'
        + '<td style="text-align:right;font-family:var(--font-mono)">$ ' + fmtUSD(v.total_usd || 0) + '</td>'
        + '<td><span class="badge ' + (ESTADO_BADGE[v.estado] || 'badge-gris') + '">' + (ESTADO_LABEL_VENTA[v.estado] || v.estado) + '</span></td>'
        + '<td><button class="btn-naranja" onclick="verFichaVenta(' + v.id_venta + ')">Ver</button></td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:12px">'
      + ['BORRADOR','CONFIRMADA','FACTURADA','ANULADA'].map(function(e) {
          return '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">' + ESTADO_LABEL_VENTA[e] + '</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + stats[e] + '</div></div>';
        }).join('')
      + '</div>'
      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Ventas</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<select id="vta-filtro-estado" onchange="filtrarTablaVentas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + '<option value="BORRADOR">Presupuesto</option><option value="CONFIRMADA">Confirmada</option>'
      + '<option value="FACTURADA">Facturada</option><option value="ANULADA">Anulada</option>'
      + '</select>'
      + '<input type="text" id="vta-buscar" placeholder="Buscar cliente..." oninput="filtrarTablaVentas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + (puedo('VENTAS','CREAR') ? '<button class="btn-primario" onclick="abrirVenta(null)">+ Nueva Venta</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 355px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th>N° Factura</th><th>Cliente</th><th>Fecha</th><th style="text-align:right">Total</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody id="vta-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay ventas registradas</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function filtrarTablaVentas() {
  const estado = document.getElementById('vta-filtro-estado')?.value || '';
  const buscar = (document.getElementById('vta-buscar')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('vta-tbody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(function(tr) {
    const vId = parseInt(tr.dataset.id);
    const v   = ventasCache.find(function(x) { return x.id_venta === vId; });
    if (!v) { tr.style.display = 'none'; return; }
    const matchEstado = !estado || v.estado === estado;
    const nomCli = (v.clientes?.nombre_apellido || '').toLowerCase();
    const matchBuscar = !buscar || nomCli.includes(buscar);
    tr.style.display = matchEstado && matchBuscar ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════
// ARMAR VENTA (crear / editar mientras está en BORRADOR)
// ═══════════════════════════════════════════════
async function abrirVenta(id) {
  if (id && !puedo('VENTAS','EDITAR')) { alert('No tiene permiso para editar ventas.'); return; }
  if (!id && !puedo('VENTAS','CREAR'))  { alert('No tiene permiso para crear ventas.'); return; }

  const v = id ? ventasCache.find(function(x) { return x.id_venta === id; }) : null;
  if (id && v && v.estado !== 'BORRADOR') { alert('Solo se puede editar una Venta mientras está en estado Presupuesto.'); return; }

  // Cargar clientes si no están en cache
  if (!clientesCache || !clientesCache.length) {
    try { clientesCache = await api('clientes','GET',null,'?estado=eq.ACTIVO&order=nombre_apellido.asc'); } catch(e) { clientesCache = []; }
  }
  if (!inventarioCache || !inventarioCache.length) {
    try { inventarioCache = await api('inventario_almacen','GET',null,'?order=nombre_articulo.asc&select=*' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')); } catch(e) { inventarioCache = []; }
  }
  // Refrescar Márgenes Vigentes antes de calcular precios -- si nunca se
  // abrió Inventario en esta sesión, _margenesVigentesMap queda vacío y
  // precioVentaEnVivo() siempre da 0, aunque el artículo sí tenga margen.
  try { await refrescarMargenesVigentes(); } catch(e) {}
  await _cargarArticulosMercanciaVentas();

  // Catálogos para los filtros de Categoría y Tipo de Artículo -- se
  // reutiliza _invCategoriasCache si Inventario ya la cargó en esta
  // sesión; Tipos se carga siempre fresco (propio de Ventas).
  if (!_invCategoriasCache || !_invCategoriasCache.length) {
    try { _invCategoriasCache = await api('inv_categorias','GET',null,'?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || []; } catch(e) { _invCategoriasCache = []; }
  }
  try { _invTiposCacheVentas = await api('inv_articulos_tipo','GET',null,'?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || []; } catch(e) { _invTiposCacheVentas = []; }

  _vtaFiltroCategoria = ''; _vtaFiltroTipo = ''; _vtaFiltroTexto = ''; _vtaFiltroSoloStock = true;
  document.getElementById('vta-filtro-categoria').innerHTML =
    '<option value="">Todas las categorías</option>'
    + _invCategoriasCache.map(function(c) { return '<option value="'+c.id_categoria+'">'+c.nombre+'</option>'; }).join('');
  document.getElementById('vta-filtro-tipo').innerHTML =
    '<option value="">Todos los tipos</option>'
    + _invTiposCacheVentas.map(function(t) { return '<option value="'+t.id_tipo+'">'+t.nombre+'</option>'; }).join('');
  document.getElementById('vta-filtro-buscar').value = '';
  document.getElementById('vta-filtro-solo-stock').checked = true;

  document.getElementById('vta-modal-titulo').textContent = id ? 'EDITAR VENTA' : 'NUEVA VENTA';
  document.getElementById('vta-id').value = id || '';
  // La fecha SIEMPRE es la del día -- no se le permite al operador elegir
  // otra, para no someter el Inventario a ventas registradas a destiempo.
  document.getElementById('vta-fecha-display').textContent =
    'Fecha: ' + fmtFecha(getHoyVzla()) + '   ·   Tasa BCV: ' + fmtBs(_tasaVigente || 0) + ' Bs/$';

  document.getElementById('vta-select-cliente').innerHTML =
    '<option value="">Seleccione un cliente...</option>'
    + clientesCache.map(function(cl) { return '<option value="'+cl.id_cliente+'"'+(v && v.id_cliente===cl.id_cliente?' selected':'')+'>'+cl.nombre_apellido+' ('+cl.condicion_legal+'-'+cl.identificacion+')</option>'; }).join('');

  // Área fija de Almacén (Gerencia de Compras, código 2300) -- no se le
  // pregunta al operador, la Venta siempre descuenta stock de ahí.
  document.getElementById('vta-id-area').value = v ? v.id_area : await _obtenerAreaAlmacenVentas();

  document.getElementById('vta-moneda').value = (v && v.moneda_cobro) || 'VES';
  document.getElementById('vta-aplica-iva').checked = v ? (v.iva_usd > 0) : true;

  _ventaLineas = [];
  if (id) {
    try {
      const detalle = await api('venta_detalle','GET',null,'?id_venta=eq.'+id);
      _ventaLineas = (detalle||[]).map(function(d) {
        const cant = parseFloat(d.cantidad);
        return { id_articulo: d.id_articulo, cantidad: cant, precio_unitario: parseFloat(d.precio_unitario), reservadoActual: cant };
      });
    } catch(e) {}
  }
  // Snapshot de cómo estaban las líneas YA GUARDADAS antes de tocar nada en
  // esta sesión de edición -- si se cierra el modal sin guardar, se usa
  // para devolver la reserva en vivo exactamente a este estado.
  _ventaLineasOriginales = _ventaLineas.map(function(l) { return { id_articulo: l.id_articulo, cantidad: l.cantidad }; });

  document.getElementById('alerta-vta-ok').style.display = 'none';
  document.getElementById('alerta-vta-err').style.display = 'none';
  _renderLineasVenta();
  abrirModal('modal-venta');
  focusFirstField('modal-venta');
}

// Se llama al cerrar el modal SIN guardar (Retornar / ✕) -- revierte toda
// la reserva en vivo hecha durante esta sesión de edición, dejando la BD
// exactamente como estaba antes de abrir el modal (en 0 si era una Venta
// nueva, o con la reserva original si se estaba editando una ya guardada).
async function cerrarModalVentaSinGuardar() {
  const idArea = parseInt(document.getElementById('vta-id-area')?.value) || null;
  if (idArea) {
    // 1. Liberar TODO lo que quedó reservado por las líneas actuales
    for (const lin of _ventaLineas) {
      if (lin.id_articulo && lin.reservadoActual > 0) {
        try { await ajustarReservaArea(lin.id_articulo, idArea, -lin.reservadoActual); } catch(e) {}
      }
    }
    // 2. Restaurar la reserva que ya existía antes de abrir el modal
    for (const linOrig of _ventaLineasOriginales) {
      if (linOrig.id_articulo && linOrig.cantidad > 0) {
        try { await ajustarReservaArea(linOrig.id_articulo, idArea, linOrig.cantidad); } catch(e) {}
      }
    }
  }
  cerrarModal('modal-venta');
}

function agregarLineaVenta() {
  const yaHayVacia = _ventaLineas.some(function(l) { return !l.id_articulo; });
  if (yaHayVacia) {
    const errEl = document.getElementById('alerta-vta-err');
    if (errEl) { errEl.textContent = 'Seleccione un Artículo en la línea vacía antes de agregar otra.'; errEl.style.display = 'block'; }
    return;
  }
  // Cantidad inicia en 0 -- obliga al operador a ingresarla explícitamente
  // (si iniciara en 1, pasaría la validación sin que la tocara).
  _ventaLineas.push({ id_articulo: null, cantidad: 0, precio_unitario: 0, reservadoActual: 0 });
  _renderLineasVenta();
}

async function quitarLineaVenta(idx) {
  const lin = _ventaLineas[idx];
  const idArea = parseInt(document.getElementById('vta-id-area')?.value) || null;
  if (lin.id_articulo && lin.reservadoActual > 0 && idArea) {
    try { await ajustarReservaArea(lin.id_articulo, idArea, -lin.reservadoActual); } catch(e) {}
  }
  _ventaLineas.splice(idx, 1);
  await _cargarArticulosMercanciaVentas(); // refrescar el stock mostrado en los demás select
  _renderLineasVenta();
}

async function _onCambioArticuloVenta(idx, idArticulo) {
  const lin = _ventaLineas[idx];
  const idArea = parseInt(document.getElementById('vta-id-area')?.value) || null;

  // Liberar la reserva del artículo ANTERIOR de esta línea, si tenía
  if (lin.id_articulo && lin.reservadoActual > 0 && idArea) {
    try { await ajustarReservaArea(lin.id_articulo, idArea, -lin.reservadoActual); } catch(e) {}
  }

  const art = inventarioCache.find(function(a) { return a.id_articulo === parseInt(idArticulo); });
  lin.errorDuplicado = null;

  if (art) {
    const yaExiste = _ventaLineas.some(function(l, i) { return i !== idx && l.id_articulo === art.id_articulo; });
    if (yaExiste) {
      lin.id_articulo = null;
      lin.precio_unitario = 0;
      lin.cantidad = 0;
      lin.reservadoActual = 0;
      lin.errorDuplicado = 'Ese artículo ya está en la lista';
      _renderLineasVenta();
      return;
    }
  }

  lin.id_articulo = art ? art.id_articulo : null;
  // El precio SIEMPRE se toma del Inventario (precio de venta en vivo,
  // calculado a partir del CPP + Margen vigente) -- no es editable por el
  // operador. Se guarda internamente en USD, igual que el resto del
  // sistema; la Moneda de Cobro solo afecta cómo se MUESTRA.
  lin.precio_unitario = art ? (precioVentaEnVivo(art).usd || 0) : 0;
  // Cantidad vuelve a 0 -- es un artículo distinto, sin reserva todavía;
  // se obliga a reingresar la Cantidad para este artículo nuevo.
  lin.cantidad = 0;
  lin.reservadoActual = 0;
  lin.errorStock = null;

  // Refrescar el stock mostrado en TODOS los select -- puede haber
  // cambiado por reservas hechas en esta misma sesión o por otros
  // operadores mientras el modal estaba abierto.
  await _cargarArticulosMercanciaVentas();
  _renderLineasVenta();

  // Posicionar el cursor directo en Cantidad, para no obligar al operador
  // a hacer clic ahí manualmente después de elegir el Artículo.
  if (art) { document.getElementById('vta-cant-'+idx)?.focus(); }
}

function _onCambioCantidadVenta(idx, valor) {
  _ventaLineas[idx].cantidad = parseFloat(valor) || 0;
  _ajustarReservaLineaVenta(idx);
}

// Reserva EN VIVO en la base de datos -- se ajusta apenas el operador
// ingresa la Cantidad, sin esperar a "Guardar Presupuesto". Calcula el
// delta contra lo que esta línea YA tiene reservado (reservadoActual) para
// no sumar de más, y valida disponibilidad real antes de aumentar la
// reserva (obtenerStockArea ya resta las reservas de TODOS, incluida la
// propia, así que comparar el delta contra ese disponible es correcto).
async function _ajustarReservaLineaVenta(idx) {
  const lin = _ventaLineas[idx];
  lin.errorStock = null;
  const idArea = parseInt(document.getElementById('vta-id-area')?.value) || null;
  if (!lin.id_articulo || !idArea) { _renderLineasVenta(); return; }

  const cantidadNueva = lin.cantidad || 0;
  const reservadoActual = lin.reservadoActual || 0;
  const delta = parseFloat((cantidadNueva - reservadoActual).toFixed(4));
  if (delta === 0) { _renderLineasVenta(); return; }

  if (delta > 0) {
    try {
      const disponible = await obtenerStockArea(lin.id_articulo, idArea);
      if (delta > disponible) {
        lin.errorStock = 'Supera el stock';
        _renderLineasVenta();
        return; // no se reserva de más -- la Cantidad queda tal cual la escribió, pero sin aplicar en BD
      }
    } catch(e) {}
  }

  try {
    await ajustarReservaArea(lin.id_articulo, idArea, delta);
    lin.reservadoActual = cantidadNueva;
    await _cargarArticulosMercanciaVentas(); // refrescar el stock mostrado en los select
  } catch(e) {
    lin.errorStock = 'Error al reservar el stock';
  }
  _renderLineasVenta();
}

// Formatea un monto (guardado internamente en USD) en la Moneda de Cobro
// que el operador tenga elegida en ese momento -- Bs si es VES (convertido
// a la tasa BCV vigente), o USD directo. Siempre con 2 decimales.
function _fmtMonedaVenta(usdValue) {
  const moneda = document.getElementById('vta-moneda')?.value || 'VES';
  if (moneda === 'VES') return fmtBs((usdValue||0) * (_tasaVigente||0)) + ' Bs';
  return '$ ' + fmtUSD(usdValue||0);
}

function _renderLineasVenta() {
  const cont = document.getElementById('vta-lineas-cuerpo');
  if (!cont) return;
  const errEl = document.getElementById('alerta-vta-err');
  if (errEl) errEl.style.display = 'none';

  cont.innerHTML = _ventaLineas.map(function(lin, idx) {
    const opciones = '<option value="">Seleccione...</option>'
      + _articulosFiltradosVenta(lin.id_articulo).map(function(a) { return '<option value="'+a.id_articulo+'"'+(lin.id_articulo===a.id_articulo?' selected':'')+'>'+a.nombre_articulo+' ('+a.codigo_articulo+') — '+a.stockAlmacen+' en stock</option>'; }).join('');
    const subtotal = (lin.cantidad || 0) * (lin.precio_unitario || 0);
    const borderCant = lin.errorStock ? 'border:1px solid #e57373' : 'border:1px solid var(--borde)';
    return '<tr>'
      + '<td style="padding:4px"><select onchange="_onCambioArticuloVenta('+idx+', this.value)" style="width:100%;background:var(--gris2);border:1px solid '+(lin.errorDuplicado?'#e57373':'var(--borde)')+';color:var(--texto);font-size:12px;padding:6px 8px;border-radius:4px;outline:none">'+opciones+'</select>'
        + (lin.errorDuplicado ? '<div style="font-size:10px;color:#e57373;margin-top:2px">'+lin.errorDuplicado+'</div>' : '')
        + '</td>'
      + '<td style="padding:4px;width:90px"><input id="vta-cant-'+idx+'" type="number" min="0" step="any" value="'+(lin.cantidad||'')+'" oninput="_onCambioCantidadVenta('+idx+', this.value)" style="width:100%;background:var(--gris2);'+borderCant+';color:var(--texto);font-size:12px;padding:6px 8px;border-radius:4px;outline:none;font-family:var(--font-mono)">'
        + (lin.errorStock ? '<div style="font-size:10px;color:#e57373;margin-top:2px">'+lin.errorStock+'</div>' : '')
        + '</td>'
      + '<td style="padding:4px 8px;width:120px;text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--suave)">'+_fmtMonedaVenta(lin.precio_unitario)+'</td>'
      + '<td style="padding:4px 8px;width:120px;text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">'+_fmtMonedaVenta(subtotal)+'</td>'
      + '<td style="padding:4px;width:36px;text-align:center"><button onclick="quitarLineaVenta('+idx+')" style="background:none;border:none;color:var(--rojo,#e57373);cursor:pointer;font-size:16px">✕</button></td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--suave);padding:16px;font-size:12px">Sin artículos agregados</td></tr>';

  _calcularTotalesVenta();
}

function _calcularTotalesVenta() {
  const errElCalc = document.getElementById('alerta-vta-err');
  if (errElCalc) errElCalc.style.display = 'none';
  const subtotal = _ventaLineas.reduce(function(a, l) { return a + (l.cantidad||0)*(l.precio_unitario||0); }, 0);
  const aplIVA  = document.getElementById('vta-aplica-iva')?.checked;
  const iva  = aplIVA  ? subtotal * tasaIVAActual() : 0;
  // El IGTF NO se decide aquí -- depende de en qué moneda decida pagar el
  // Cliente y de si la Empresa es Contribuyente Especial, algo que solo se
  // sabe con certeza al momento del Cobro (igual que ya funciona para
  // Órdenes de Servicio). El asiento inicial de la Factura sale sin IGTF.
  const total = subtotal + iva;

  const el = document.getElementById('vta-totales');
  if (el) {
    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;padding:10px 0">'
      + '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--suave)">Subtotal</span><span style="font-family:var(--font-mono)">'+_fmtMonedaVenta(subtotal)+'</span></div>'
      + (aplIVA  ? '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--suave)">IVA ('+Math.round(tasaIVAActual()*100)+'%)</span><span style="font-family:var(--font-mono)">'+_fmtMonedaVenta(iva)+'</span></div>' : '')
      + '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--borde);padding-top:6px;margin-top:2px">'
      + '<span style="font-family:var(--font-display);font-size:15px;letter-spacing:1px">TOTAL</span>'
      + '<span style="font-family:var(--font-mono);font-size:17px;color:var(--naranja)">'+_fmtMonedaVenta(total)+'</span></div></div>';
  }
  window._vtaTotales = { subtotal: subtotal, iva: iva, igtf: 0, total: total };
}

async function guardarVentaBorrador() {
  const okEl  = document.getElementById('alerta-vta-ok');
  const errEl = document.getElementById('alerta-vta-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const id       = document.getElementById('vta-id').value;
  const idCliente = parseInt(document.getElementById('vta-select-cliente').value) || null;
  const idArea    = parseInt(document.getElementById('vta-id-area').value) || null;
  // La fecha SIEMPRE es la del día -- no es un campo que el operador elija.
  const fecha     = getHoyVzla();
  const moneda    = document.getElementById('vta-moneda').value;

  if (!idCliente) { errEl.textContent = 'Debe seleccionar un Cliente.'; errEl.style.display = 'block'; return; }
  if (!idArea)    { errEl.textContent = 'No se pudo determinar el Área de Almacén (Gerencia de Compras, código 2300). Verifique que esa Área exista en Parámetros.'; errEl.style.display = 'block'; return; }
  if (!_ventaLineas.length) { errEl.textContent = 'Debe agregar al menos un artículo.'; errEl.style.display = 'block'; return; }

  // Validar CADA línea agregada -- ya no se descartan en silencio las
  // incompletas; se indica exactamente qué falta o qué está mal, con el
  // número de línea, para que el operador sepa qué corregir.
  for (let i = 0; i < _ventaLineas.length; i++) {
    const lin = _ventaLineas[i];
    const nLinea = i + 1;
    if (!lin.id_articulo)          { errEl.textContent = 'Línea '+nLinea+': debe seleccionar un Artículo.'; errEl.style.display = 'block'; return; }
    if (!lin.cantidad || lin.cantidad <= 0) { errEl.textContent = 'Línea '+nLinea+': la Cantidad debe ser mayor a 0.'; errEl.style.display = 'block'; return; }
    if (!lin.precio_unitario || lin.precio_unitario <= 0) { errEl.textContent = 'Línea '+nLinea+': el Precio Unitario debe ser mayor a 0.'; errEl.style.display = 'block'; return; }
    if (lin.errorStock) { errEl.textContent = 'Línea '+nLinea+': '+lin.errorStock+'.'; errEl.style.display = 'block'; return; }
    const duplicada = _ventaLineas.some(function(l2, i2) { return i2 !== i && l2.id_articulo === lin.id_articulo; });
    if (duplicada) { errEl.textContent = 'Línea '+nLinea+': ese artículo ya está agregado en otra línea.'; errEl.style.display = 'block'; return; }
  }
  const lineasValidas = _ventaLineas;

  _calcularTotalesVenta();
  const tot = window._vtaTotales || { subtotal:0, iva:0, igtf:0, total:0 };

  const datosVenta = {
    id_empresa:   _empresaActiva?.id_empresa || null,
    id_cliente:   idCliente,
    id_area:      idArea,
    fecha_venta:  fecha,
    moneda_cobro: moneda,
    subtotal_usd: tot.subtotal, iva_usd: tot.iva, igtf_usd: tot.igtf, total_usd: tot.total,
    tasa_bcv:     _tasaVigente || 1,
    id_usuario:   sesionActual.correo_usuario
  };

  try {
    let idVentaFinal = id ? parseInt(id) : null;
    if (id) {
      await api('ventas','PATCH',datosVenta,'?id_venta=eq.'+id);
      // Reemplazar por completo las líneas (más simple y confiable que hacer un diff)
      await api('venta_detalle','DELETE',null,'?id_venta=eq.'+id);
    } else {
      datosVenta.estado = 'BORRADOR';
      const nueva = await api('ventas','POST',datosVenta);
      idVentaFinal = nueva && nueva[0] ? nueva[0].id_venta : null;
    }
    if (!idVentaFinal) throw new Error('No se pudo obtener el ID de la Venta.');

    for (const lin of lineasValidas) {
      await api('venta_detalle','POST',{
        id_venta: idVentaFinal, id_articulo: lin.id_articulo,
        cantidad: lin.cantidad, precio_unitario: lin.precio_unitario,
        subtotal: parseFloat((lin.cantidad*lin.precio_unitario).toFixed(2))
      });
    }

    okEl.textContent = '✓ Presupuesto guardado.';
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-venta'); renderVentas(); }, 1000);
  } catch(err) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
}

// ═══════════════════════════════════════════════
// FICHA DE VENTA + TRANSICIONES DE ESTADO
// ═══════════════════════════════════════════════
async function verFichaVenta(id) {
  const v = ventasCache.find(function(x) { return x.id_venta === id; });
  if (!v) return;
  let lineas = [];
  try { lineas = await api('venta_detalle','GET',null,'?id_venta=eq.'+id+'&select=*,inventario_almacen(nombre_articulo,codigo_articulo)'); } catch(e) {}

  const filasLin = lineas.map(function(l) {
    return '<tr><td style="padding:5px 0;font-size:12px">'+(l.inventario_almacen?.nombre_articulo||'Art#'+l.id_articulo)+'</td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-size:12px">'+l.cantidad+'</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px">$ '+fmtUSD(l.precio_unitario)+'</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">$ '+fmtUSD(l.subtotal)+'</td></tr>';
  }).join('');

  const ESTADO_BADGE = { BORRADOR: 'badge-gris', CONFIRMADA: 'badge-naranja', FACTURADA: 'badge-verde', ANULADA: 'badge-rojo' };
  document.getElementById('ficha-venta-contenido').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">'
    + '<div><div style="font-weight:600;font-size:15px">'+(v.clientes?.nombre_apellido||'—')+'</div>'
    + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">'+(v.clientes?'V-'+v.id_venta:'')+(v.facturas?.numero_factura?' — '+v.facturas.numero_factura:'')+'</div></div>'
    + '<span class="badge '+(ESTADO_BADGE[v.estado]||'badge-gris')+'">'+(ESTADO_LABEL_VENTA[v.estado]||v.estado)+'</span>'
    + '</div>'
    + '<table style="width:100%;margin-bottom:14px"><thead><tr>'
    + '<th style="font-size:11px;text-align:left;color:var(--suave)">Artículo</th><th style="font-size:11px;color:var(--suave)">Cant.</th><th style="font-size:11px;color:var(--suave)">P. Unit.</th><th style="font-size:11px;color:var(--suave)">Subtotal</th>'
    + '</tr></thead><tbody>'+(filasLin || '<tr><td colspan="4" style="text-align:center;color:var(--suave);padding:12px;font-size:12px">Sin líneas</td></tr>')+'</tbody></table>'
    + '<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--borde);padding-top:10px">'
    + '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--suave)">Subtotal</span><span style="font-family:var(--font-mono)">$ '+fmtUSD(v.subtotal_usd||0)+'</span></div>'
    + (v.iva_usd > 0 ? '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--suave)">IVA</span><span style="font-family:var(--font-mono)">$ '+fmtUSD(v.iva_usd)+'</span></div>' : '')
    + (v.igtf_usd > 0 ? '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--suave)">IGTF</span><span style="font-family:var(--font-mono)">$ '+fmtUSD(v.igtf_usd)+'</span></div>' : '')
    + '<div style="display:flex;justify-content:space-between;font-family:var(--font-display);font-size:15px;padding-top:4px"><span>TOTAL</span><span style="color:var(--naranja)">$ '+fmtUSD(v.total_usd||0)+'</span></div>'
    + '</div>';

  const btnEditar    = document.getElementById('ficha-venta-btn-editar');
  const btnConfirmar = document.getElementById('ficha-venta-btn-confirmar');
  const btnFacturar  = document.getElementById('ficha-venta-btn-facturar');
  const btnAnular    = document.getElementById('ficha-venta-btn-anular');
  const btnEliminar  = document.getElementById('ficha-venta-btn-eliminar');

  btnEditar.style.display    = (v.estado === 'BORRADOR' && puedo('VENTAS','EDITAR'))   ? '' : 'none';
  btnConfirmar.style.display = (v.estado === 'BORRADOR' && puedo('VENTAS','EDITAR'))   ? '' : 'none';
  btnFacturar.style.display  = (v.estado === 'CONFIRMADA' && puedo('VENTAS','CREAR'))  ? '' : 'none';
  btnAnular.style.display    = ((v.estado === 'BORRADOR' || v.estado === 'CONFIRMADA') && puedo('VENTAS','ELIMINAR')) ? '' : 'none';
  btnEliminar.style.display  = (v.estado === 'BORRADOR' && puedo('VENTAS','ELIMINAR')) ? '' : 'none';

  btnEditar.onclick    = function() { cerrarModal('modal-ficha-venta'); abrirVenta(v.id_venta); };
  btnConfirmar.onclick = function() { confirmarVenta(v.id_venta); };
  btnFacturar.onclick  = function() { facturarVenta(v.id_venta); };
  btnAnular.onclick    = function() { anularVenta(v.id_venta); };
  btnEliminar.onclick  = function() { eliminarVenta(v.id_venta); };

  abrirModal('modal-ficha-venta');
}

async function confirmarVenta(id) {
  if (!confirm('¿Confirmar esta Venta? Ya no podrá editarse, pero el stock aún no se descuenta hasta que se facture.')) return;
  try {
    await api('ventas','PATCH',{ estado:'CONFIRMADA' },'?id_venta=eq.'+id);
    cerrarModal('modal-ficha-venta');
    renderVentas();
  } catch(err) { alert('Error: ' + err.message); }
}

async function facturarVenta(id) {
  if (!confirm('¿Facturar esta Venta? Esto generará la Factura, descontará el stock real, y creará la Cuenta por Cobrar y el asiento contable. Esta acción no se puede deshacer directamente.')) return;
  try {
    const vRows = await api('ventas','GET',null,'?id_venta=eq.'+id+'&select=*,clientes(*)');
    const v = vRows && vRows[0];
    if (!v) throw new Error('Venta no encontrada.');
    if (v.estado !== 'CONFIRMADA') throw new Error('Solo se puede facturar una Venta en estado CONFIRMADA.');

    const cli = v.clientes;
    const anio = new Date().getFullYear();
    const existentes = await api('facturas','GET',null,'?select=numero_factura&numero_factura=like.FAC-'+anio+'-*&order=numero_factura.desc&limit=1');
    let seq = 1;
    if (existentes.length) { const p = existentes[0].numero_factura.split('-'); seq = parseInt(p[p.length-1])+1; }
    const numeroFactura = 'FAC-'+anio+'-'+String(seq).padStart(4,'0');

    const datosFactura = {
      id_orden: null, id_empresa: v.id_empresa, id_propietario: null, id_cliente: v.id_cliente,
      numero_factura: numeroFactura,
      receptor_nombre: cli?.nombre_apellido || 'Cliente sin nombre',
      receptor_rif: cli ? (cli.condicion_legal + '-' + cli.identificacion) : null,
      receptor_direccion: cli?.direccion || null,
      receptor_tipo_contribuyente: null,
      moneda_cobro: v.moneda_cobro || 'USD',
      fecha_emision: v.fecha_venta || getHoyVzla(),
      estado: 'EMITIDA',
      // El IGTF NUNCA se fija aquí -- depende de en qué moneda decida
      // pagar el Cliente y de si la Empresa es Contribuyente Especial,
      // algo que solo se sabe con certeza al momento del Cobro (mismo
      // criterio ya usado para Órdenes de Servicio vía
      // onCambiarMetodoCobroCxc, en contabilidad.js).
      aplica_iva: v.iva_usd > 0, aplica_igtf: false,
      subtotal_usd: v.subtotal_usd, iva_usd: v.iva_usd, igtf_usd: 0,
      total_usd: v.total_usd, total_ves: (v.total_usd||0) * (v.tasa_bcv||1), tasa_bcv: v.tasa_bcv || 1,
      id_usuario: sesionActual.correo_usuario
    };

    const nuevaFactura = await api('facturas','POST',datosFactura);
    const idFacturaFinal = nuevaFactura && nuevaFactura[0] ? nuevaFactura[0].id_factura : null;
    if (!idFacturaFinal) throw new Error('No se pudo crear la Factura.');

    await api('ventas','PATCH',{ estado:'FACTURADA', id_factura: idFacturaFinal },'?id_venta=eq.'+id);

    // Reutiliza el motor de CxC + Asiento Contable + Salida de Inventario +
    // Costo de Venta ya probado en producción (ver ingresos.js)
    await generarCxCyAsientoFactura(idFacturaFinal);

    cerrarModal('modal-ficha-venta');
    renderVentas();
    alert('✓ Venta facturada correctamente: ' + numeroFactura);
  } catch(err) { alert('Error al facturar: ' + err.message); }
}

async function anularVenta(id) {
  const v = ventasCache.find(function(x) { return x.id_venta === id; });
  if (v && v.estado === 'FACTURADA') { alert('Esta Venta ya fue facturada. Para anularla, hágalo desde el módulo de Facturas (Ingresos), donde se reversa correctamente la Factura, la CxC y el asiento contable.'); return; }
  if (!confirm('¿Anular esta Venta?')) return;
  try {
    if (v && v.id_area) {
      try {
        const lineas = await api('venta_detalle','GET',null,'?id_venta=eq.'+id+'&select=id_articulo,cantidad');
        for (const lin of (lineas||[])) {
          if (lin.id_articulo && parseFloat(lin.cantidad) > 0) {
            await ajustarReservaArea(lin.id_articulo, v.id_area, -parseFloat(lin.cantidad));
          }
        }
      } catch(eLibRes) { console.warn('Error liberando reserva al anular:', eLibRes); }
    }
    await api('ventas','PATCH',{ estado:'ANULADA' },'?id_venta=eq.'+id);
    cerrarModal('modal-ficha-venta');
    renderVentas();
  } catch(err) { alert('Error: ' + err.message); }
}

async function eliminarVenta(id) {
  if (!confirm('¿Eliminar esta Venta en Borrador? Esta acción no se puede deshacer.')) return;
  try {
    const v = ventasCache.find(function(x) { return x.id_venta === id; });
    if (v && v.id_area) {
      try {
        const lineas = await api('venta_detalle','GET',null,'?id_venta=eq.'+id+'&select=id_articulo,cantidad');
        for (const lin of (lineas||[])) {
          if (lin.id_articulo && parseFloat(lin.cantidad) > 0) {
            await ajustarReservaArea(lin.id_articulo, v.id_area, -parseFloat(lin.cantidad));
          }
        }
      } catch(eLibRes) { console.warn('Error liberando reserva al eliminar:', eLibRes); }
    }
    await api('venta_detalle','DELETE',null,'?id_venta=eq.'+id);
    await api('ventas','DELETE',null,'?id_venta=eq.'+id);
    cerrarModal('modal-ficha-venta');
    renderVentas();
  } catch(err) { alert('Error: ' + err.message); }
}
