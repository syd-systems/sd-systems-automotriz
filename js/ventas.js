// ─── S&D Systems — Módulo: VENTAS (mostrador / venta directa) ───
// Creado el 2026-08-26. Una Venta pasa por 3 estados:
//   BORRADOR ("Presupuesto", armando/editable, con la reserva de stock ya
//   viva desde que se ingresa Cantidad) -> FACTURADA (genera factura + CxC
//   + asiento + descuenta stock real, vía generarCxCyAsientoFactura() en
//   ingresos.js) -> ANULADA
//
// El paso "Confirmar" (estado CONFIRMADA) se eliminó el 2026-08-27 -- no
// aportaba ninguna protección real: la reserva de stock ya vive desde el
// Presupuesto, y no hay un segundo revisor distinto al que arma la Venta
// en este nivel de operación (a diferencia de Órdenes de Servicio, donde
// sí puede haber un flujo de aprobación por Nivel de Firma).
//
// El stock NO se descuenta hasta que la Venta se FACTURA -- antes de eso es
// solo un "carrito" en memoria/BD, sin efecto real en Inventario/Contabilidad.
//
// NOTA: el valor interno 'BORRADOR' se muestra en la interfaz como
// "Presupuesto" (ver ESTADO_LABEL) -- es más claro para el operador, ya que
// en esta etapa aún no hay ningún compromiso real de stock ni contabilidad.
const ESTADO_LABEL_VENTA = { BORRADOR: 'Presupuesto', FACTURADA: 'Facturada', ANULADA: 'Anulada' };

let _ventaLineas = []; // líneas en edición del modal (en memoria, no se guardan hasta "Guardar Borrador")
let _ventaLineasOriginales = []; // snapshot de las líneas YA GUARDADAS al abrir el modal -- para poder revertir la reserva en vivo si se cierra sin guardar (Retornar / ✕)
let _idAreaAlmacenVentas = null; // id de "Gerencia de Compras" (código 2300) -- Ventas siempre descuenta de ahí, sin pedirle al operador que elija Área
let _articulosMercanciaVentas = []; // artículos filtrados (solo Mercancías, cuenta 1.1.03.001) con su stock en el Almacén
let _invTiposCacheVentas = []; // catálogo de Tipos de Artículo (inv_articulos_tipo) -- para el filtro por Tipo
let _vtaFiltroCategoria = '';
let _vtaFiltroTipo = '';
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
  return _articulosMercanciaVentas.filter(function(a) {
    if (idArticuloActual && a.id_articulo === idArticuloActual) return true;
    if (_vtaFiltroCategoria && String(a.id_categoria_articulo) !== String(_vtaFiltroCategoria)) return false;
    if (_vtaFiltroTipo && String(a.id_tipo_articulo) !== String(_vtaFiltroTipo)) return false;
    if (_vtaFiltroSoloStock && a.stockAlmacen <= 0) return false;
    return true;
  });
}

function _filtrarArticulosVenta() {
  _vtaFiltroCategoria  = document.getElementById('vta-filtro-categoria')?.value || '';
  _vtaFiltroTipo       = document.getElementById('vta-filtro-tipo')?.value || '';
  _vtaFiltroSoloStock  = document.getElementById('vta-filtro-solo-stock')?.checked || false;
  _renderLineasVenta();
}

let _ventaVista = 'ventas'; // 'ventas' | 'entregas'
let _entregaSubVista = 'pendientes'; // 'pendientes' | 'historico'

async function renderVentas() {
  const accesoCompleto = sesionActual?.administrador || puedo('VENTAS','VER') || puedo('VENTAS','CREAR') || puedo('VENTAS','EDITAR');
  const accesoEntregas  = accesoCompleto || puedo('VENTAS','VER_ENTREGAS');
  if (!accesoEntregas) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  // Quien solo tiene el permiso granular de Entregas (ej. Almacén, sin
  // acceso al resto de Ventas) entra directo a esa pestaña, y ni siquiera
  // ve la pestaña "Ventas" (listado general).
  if (!accesoCompleto) _ventaVista = 'entregas';

  const c = document.getElementById('contenido-principal');
  const tabsHtml = '<div style="display:flex;gap:3px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:3px;margin-bottom:14px;width:fit-content">'
    + (accesoCompleto ? '<button onclick="_ventaCambiarVista(\'ventas\')" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:'+(_ventaVista==='ventas'?'var(--naranja)':'transparent')+';color:'+(_ventaVista==='ventas'?'#fff':'var(--suave)')+'">Ventas</button>' : '')
    + '<button onclick="_ventaCambiarVista(\'entregas\')" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:'+(_ventaVista==='entregas'?'var(--naranja)':'transparent')+';color:'+(_ventaVista==='entregas'?'#fff':'var(--suave)')+'">📦 Entregas</button>'
    + '</div>';

  c.innerHTML = tabsHtml + '<div id="ventas-contenido-tab"><div class="loading"><div class="spinner"></div> Cargando...</div></div>';

  if (_ventaVista === 'entregas') { await renderVentasEntregas(); return; }
  await renderVentasListado();
}

function _ventaCambiarVista(v) {
  _ventaVista = v;
  renderVentas();
}

async function renderVentasListado() {
  const c = document.getElementById('ventas-contenido-tab');
  if (!c) return;
  try {
    const filtroEmpresa = _empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : '';
    const ventas = await api('ventas', 'GET', null,
      '?order=fecha_registro.desc&select=*,clientes(nombre_apellido,condicion_legal,identificacion),facturas(numero_factura)' + filtroEmpresa);
    ventasCache = ventas;

    const stats = { BORRADOR: 0, FACTURADA: 0, ANULADA: 0 };
    ventas.forEach(function(v) { if (stats[v.estado] !== undefined) stats[v.estado]++; });

    const ESTADO_BADGE = { BORRADOR: 'badge-gris', FACTURADA: 'badge-verde', ANULADA: 'badge-rojo' };

    const filas = ventas.map(function(v) {
      const cli = v.clientes;
      const tasa = v.tasa_bcv || 1;
      const esVES = v.moneda_cobro === 'VES';
      const ves = (v.total_usd||0) * tasa;
      const totalDual = '<div style="' + (esVES?'color:var(--suave)':'color:var(--naranja)') + '">$ ' + fmtUSD(v.total_usd||0) + '</div>'
        + '<div style="' + (esVES?'color:var(--naranja)':'color:var(--suave)') + ';font-size:11px">Bs ' + fmtBs(ves) + '</div>';
      const botonLabel = v.estado === 'BORRADOR' ? 'Editar / Facturar' : 'Ver';
      return '<tr data-id="' + v.id_venta + '">'
        + '<td style="font-family:var(--font-mono);font-size:12px">' + (v.facturas?.numero_factura || 'V-' + v.id_venta) + '</td>'
        + '<td>' + (cli ? cli.nombre_apellido : '—') + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (cli ? cli.condicion_legal + '-' + cli.identificacion : '') + '</div></td>'
        + '<td style="font-size:12px">' + fmtFecha(v.fecha_venta) + '</td>'
        + '<td style="text-align:right;font-family:var(--font-mono)">' + totalDual + '</td>'
        + '<td><span class="badge ' + (ESTADO_BADGE[v.estado] || 'badge-gris') + '">' + (ESTADO_LABEL_VENTA[v.estado] || v.estado) + '</span></td>'
        + '<td><button class="btn-naranja" onclick="verFichaVenta(' + v.id_venta + ')">' + botonLabel + '</button></td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:12px">'
      + ['BORRADOR','FACTURADA','ANULADA'].map(function(e) {
          return '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">' + ESTADO_LABEL_VENTA[e] + '</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + stats[e] + '</div></div>';
        }).join('')
      + '</div>'
      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Ventas</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<select id="vta-filtro-estado" onchange="filtrarTablaVentas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + '<option value="BORRADOR">Presupuesto</option>'
      + '<option value="FACTURADA">Facturada</option><option value="ANULADA">Anulada</option>'
      + '</select>'
      + '<input type="text" id="vta-buscar" placeholder="Buscar cliente..." oninput="filtrarTablaVentas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + (puedo('VENTAS','CREAR') ? '<button class="btn-primario" onclick="abrirVenta(null)">+ Nueva Venta</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 400px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th>N° Factura</th><th>Cliente</th><th>Fecha</th><th style="text-align:right">Total</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody id="vta-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay ventas registradas</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

async function renderVentasEntregas() {
  const c = document.getElementById('ventas-contenido-tab');
  if (!c) return;
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  const subTabsHtml = '<div style="display:flex;gap:3px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:3px;margin-bottom:14px;width:fit-content">'
    + '<button onclick="_entregaCambiarSubVista(\'pendientes\')" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:'+(_entregaSubVista==='pendientes'?'var(--naranja)':'transparent')+';color:'+(_entregaSubVista==='pendientes'?'#fff':'var(--suave)')+'">Pendientes de Entrega</button>'
    + '<button onclick="_entregaCambiarSubVista(\'historico\')" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:'+(_entregaSubVista==='historico'?'var(--naranja)':'transparent')+';color:'+(_entregaSubVista==='historico'?'#fff':'var(--suave)')+'">Histórico de Entregas</button>'
    + '</div>';

  try {
    // Pendientes: Venta Facturada, aún no entregada, y su Factura ya
    // PAGADA (join !inner filtrando por el estado de la Factura, mismo
    // patrón ya usado en contabilidad.js para cont_asientos).
    let ventas;
    if (_entregaSubVista === 'pendientes') {
      ventas = await api('ventas','GET',null,
        '?estado=eq.FACTURADA&entregado=eq.false&select=*,clientes(nombre_apellido,condicion_legal,identificacion,telefono_movil),facturas!inner(numero_factura,estado,fecha_emision)&facturas.estado=eq.PAGADA&order=fecha_venta.asc');
    } else {
      ventas = await api('ventas','GET',null,
        '?entregado=eq.true&select=*,clientes(nombre_apellido,condicion_legal,identificacion),facturas(numero_factura,fecha_emision)&order=fecha_entrega.desc');
    }

    // Líneas de TODAS las Ventas de esta lista en una sola consulta (evita
    // N llamadas, una por fila).
    const idsVentas = ventas.map(function(v){ return v.id_venta; });
    let lineasPorVenta = {};
    if (idsVentas.length) {
      const lineas = await api('venta_detalle','GET',null,
        '?id_venta=in.('+idsVentas.join(',')+')&select=id_venta,cantidad,inventario_almacen(nombre_articulo)');
      (lineas||[]).forEach(function(l) {
        if (!lineasPorVenta[l.id_venta]) lineasPorVenta[l.id_venta] = [];
        lineasPorVenta[l.id_venta].push((l.inventario_almacen?.nombre_articulo||'Artículo')+' x'+l.cantidad);
      });
    }

    const puedeMarcar = sesionActual?.administrador || puedo('VENTAS','MARCAR_ENTREGA');

    const filas = ventas.map(function(v) {
      const cli = v.clientes;
      const arts = (lineasPorVenta[v.id_venta]||[]).join(', ') || '—';
      return '<tr>'
        + '<td style="font-family:var(--font-mono);font-size:12px">'+(v.facturas?.numero_factura||'—')+'</td>'
        + '<td style="font-size:12px">'+(cli?cli.nombre_apellido:'—')+'<div style="font-size:10px;color:var(--suave);font-family:var(--font-mono)">'+(cli?cli.condicion_legal+'-'+cli.identificacion:'')+(cli?.telefono_movil?' · '+cli.telefono_movil:'')+'</div></td>'
        + '<td style="font-size:12px">'+arts+'</td>'
        + '<td style="text-align:right;font-family:var(--font-mono)">$ '+fmtUSD(v.total_usd||0)+'</td>'
        + (_entregaSubVista==='pendientes'
            ? '<td style="font-size:12px">'+(v.facturas?.fecha_emision?fmtFecha(v.facturas.fecha_emision):'—')+'</td>'
              + '<td>'+(puedeMarcar ? '<button class="btn-primario" onclick="marcarVentaEntregada('+v.id_venta+')">✓ Marcar Entregado</button>' : '')+'</td>'
            : '<td style="font-size:12px">'+(v.fecha_entrega?fmtFecha(v.fecha_entrega):'—')+'</td>'
              + '<td style="font-size:12px">'+(v.entregado_por||'—')+'</td>')
        + '</tr>';
    }).join('');

    c.innerHTML = subTabsHtml
      + '<div class="panel">'
      + '<div class="panel-header"><h3>'+(_entregaSubVista==='pendientes'?'Pendientes de Entrega':'Histórico de Entregas')+'</h3></div>'
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 400px))"><table style="width:100%"><thead><tr>'
      + '<th>N° Factura</th><th>Cliente</th><th>Artículos</th><th style="text-align:right">Total</th>'
      + (_entregaSubVista==='pendientes' ? '<th>Fecha Cobro</th><th>Acción</th>' : '<th>Fecha Entrega</th><th>Entregado por</th>')
      + '</tr></thead><tbody>'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">'+(_entregaSubVista==='pendientes'?'No hay Ventas pendientes de entrega.':'Sin entregas registradas todavía.')+'</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = subTabsHtml + '<div class="alerta alerta-error" style="display:block">Error: '+err.message+'</div>';
  }
}

function _entregaCambiarSubVista(v) {
  _entregaSubVista = v;
  renderVentasEntregas();
}

async function marcarVentaEntregada(id) {
  if (!confirm('¿Confirmar que esta Venta ya fue entregada al Cliente?')) return;
  try {
    await api('ventas','PATCH',{
      entregado: true,
      fecha_entrega: new Date().toISOString(),
      entregado_por: sesionActual.correo_usuario
    },'?id_venta=eq.'+id);
    renderVentasEntregas();
  } catch(err) { alert('Error: ' + err.message); }
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

  _vtaFiltroCategoria = ''; _vtaFiltroTipo = ''; _vtaFiltroSoloStock = true;
  document.getElementById('vta-filtro-categoria').innerHTML =
    '<option value="">Todas las categorías</option>'
    + _invCategoriasCache.map(function(c) { return '<option value="'+c.id_categoria+'">'+c.nombre+'</option>'; }).join('');
  document.getElementById('vta-filtro-tipo').innerHTML =
    '<option value="">Todos los tipos</option>'
    + _invTiposCacheVentas.map(function(t) { return '<option value="'+t.id_tipo+'">'+t.nombre+'</option>'; }).join('');
  document.getElementById('vta-filtro-solo-stock').checked = true;

  document.getElementById('vta-modal-titulo').textContent = id ? 'EDITAR VENTA' : 'NUEVA VENTA';
  document.getElementById('vta-id').value = id || '';
  // La fecha SIEMPRE es la del día -- no se le permite al operador elegir
  // otra, para no someter el Inventario a ventas registradas a destiempo.
  document.getElementById('vta-fecha-display').textContent =
    'Fecha: ' + fmtFecha(getHoyVzla()) + '   ·   Tasa BCV: ' + fmtBs(_tasaVigente || 0) + ' Bs/$';

  window._vtaClienteSeleccionadoId = v ? v.id_cliente : null;
  const clienteActual = v ? clientesCache.find(function(cl) { return cl.id_cliente === v.id_cliente; }) : null;
  document.getElementById('vta-cliente-input').value = clienteActual ? _textoOpcionCliente(clienteActual) : '';

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
  // focusFirstField enfoca automáticamente el primer campo visible del
  // modal (Cliente), lo que dispara su propio onfocus y abre la lista de
  // sugerencias sin que el operador haya interactuado -- se le quita el
  // foco después de que corra (mismo delay + margen), dejando intacta la
  // navegación por Enter que esa función configura para el resto de campos.
  setTimeout(function() {
    const inputCliente = document.getElementById('vta-cliente-input');
    if (document.activeElement === inputCliente) {
      inputCliente.blur();
      const opciones = document.getElementById('vta-cliente-opciones');
      if (opciones) opciones.style.display = 'none';
    }
  }, 250);
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

// Texto que se muestra (y se busca) por cada Cliente en el buscador.
function _textoOpcionCliente(cl) {
  return cl.nombre_apellido + ' (' + cl.condicion_legal + '-' + cl.identificacion + ')';
}

// Renderiza las coincidencias (por nombre o identificación, en cualquier
// parte del texto) en el contenedor propio bajo el input -- reemplaza al
// <datalist> nativo, que resultó con soporte inconsistente entre
// navegadores (no mostraba sugerencias incluso coincidiendo desde el inicio).
function _renderOpcionesCliente(texto) {
  const t = (texto || '').toLowerCase().trim();
  const cont = document.getElementById('vta-cliente-opciones');
  const matches = clientesCache.filter(function(cl) {
    return !t || cl.nombre_apellido.toLowerCase().includes(t) || (cl.identificacion || '').toLowerCase().includes(t);
  }).slice(0, 30);
  if (!matches.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  cont.innerHTML = matches.map(function(cl) {
    return '<div onmousedown="_elegirCliente(' + cl.id_cliente + ')" style="padding:7px 9px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--borde)" onmouseover="this.style.background=\'rgba(255,255,255,0.06)\'" onmouseout="this.style.background=\'\'">' + _textoOpcionCliente(cl) + '</div>';
  }).join('');
  cont.style.display = 'block';
}

// Se llama al hacer clic (mousedown, para que dispare ANTES del blur del
// input) sobre una opción de la lista -- ahí sí queda resuelto el Cliente.
function _elegirCliente(idCliente) {
  const cl = clientesCache.find(function(c) { return c.id_cliente === idCliente; });
  if (!cl) return;
  window._vtaClienteSeleccionadoId = idCliente;
  document.getElementById('vta-cliente-input').value = _textoOpcionCliente(cl);
  document.getElementById('vta-cliente-opciones').style.display = 'none';
  document.getElementById('alerta-vta-err').style.display = 'none';
}

// Se llama desde el modal de Cliente Rápido cuando se crea uno nuevo --
// lo deja seleccionado directamente, sin pasar por la lista.
function _onClienteRapidoCreadoVenta(cli) {
  if (!cli) return;
  window._vtaClienteSeleccionadoId = cli.id_cliente;
  document.getElementById('vta-cliente-input').value = _textoOpcionCliente(cli);
}

function agregarLineaVenta() {
  const lineaIncompleta = _ventaLineas.some(function(l) { return !l.id_articulo || !l.cantidad || l.cantidad <= 0; });
  if (lineaIncompleta) {
    const errEl = document.getElementById('alerta-vta-err');
    if (errEl) { errEl.textContent = 'Complete el Artículo y la Cantidad de la línea vacía antes de agregar otra.'; errEl.style.display = 'block'; }
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

// Texto que se muestra (y se busca) por cada Artículo en el buscador.
function _textoOpcionArticulo(a) {
  return a.nombre_articulo + ' (' + a.codigo_articulo + ') — ' + a.stockAlmacen + ' en stock';
}

// Muestra el contenedor flotante compartido de sugerencias de Artículo,
// posicionado justo debajo del input de la línea `idx` que tiene el foco.
// Es un único elemento con position:fixed (fuera del scroll de la tabla
// de líneas) para que nunca se recorte, sin importar en qué fila esté.
function _mostrarOpcionesArticulo(idx, inputEl, texto) {
  window._vtaArticuloIdxActivo = idx;
  const cont = document.getElementById('vta-art-opciones-flotante');
  const t = (texto || '').toLowerCase().trim();
  const matches = _articulosFiltradosVenta(null).filter(function(a) {
    return !t || a.nombre_articulo.toLowerCase().includes(t) || (a.codigo_articulo || '').toLowerCase().includes(t);
  }).slice(0, 30);
  if (!matches.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  const r = inputEl.getBoundingClientRect();
  cont.style.left  = r.left + 'px';
  cont.style.top   = (r.bottom + 2) + 'px';
  cont.style.width = r.width + 'px';
  cont.innerHTML = matches.map(function(a) {
    return '<div onmousedown="_elegirArticuloVenta(' + idx + ',' + a.id_articulo + ')" style="padding:7px 9px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--borde)" onmouseover="this.style.background=\'rgba(255,255,255,0.06)\'" onmouseout="this.style.background=\'\'">' + _textoOpcionArticulo(a) + '</div>';
  }).join('');
  cont.style.display = 'block';
}

function _ocultarOpcionesArticulo() {
  document.getElementById('vta-art-opciones-flotante').style.display = 'none';
}

// Se llama al hacer clic (mousedown, para que dispare ANTES del blur del
// input) sobre una opción de la lista -- reutiliza toda la lógica ya
// existente de cambio de Artículo (libera reserva anterior, valida
// duplicado, calcula precio, refresca stock, enfoca Cantidad).
function _elegirArticuloVenta(idx, idArticulo) {
  _ocultarOpcionesArticulo();
  _onCambioArticuloVenta(idx, idArticulo);
}

function _renderLineasVenta() {
  const cont = document.getElementById('vta-lineas-cuerpo');
  if (!cont) return;
  const errEl = document.getElementById('alerta-vta-err');
  if (errEl) errEl.style.display = 'none';

  cont.innerHTML = _ventaLineas.map(function(lin, idx) {
    const artActual = lin.id_articulo ? _articulosMercanciaVentas.find(function(a) { return a.id_articulo === lin.id_articulo; }) : null;
    const textoActual = artActual ? _textoOpcionArticulo(artActual) : '';
    const subtotal = (lin.cantidad || 0) * (lin.precio_unitario || 0);
    const borderCant = lin.errorStock ? 'border:1px solid #e57373' : 'border:1px solid var(--borde)';
    return '<tr>'
      + '<td style="padding:4px"><input type="text" autocomplete="off" value="'+textoActual.replace(/"/g,'&quot;')+'" oninput="_mostrarOpcionesArticulo('+idx+', this, this.value)" onfocus="_mostrarOpcionesArticulo('+idx+', this, this.value)" onblur="setTimeout(_ocultarOpcionesArticulo, 150)" placeholder="Buscar artículo o código..." style="width:100%;background:var(--gris2);border:1px solid '+(lin.errorDuplicado?'#e57373':'var(--borde)')+';color:var(--texto);font-size:13px;padding:6px 8px;border-radius:4px;outline:none">'
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
  const idCliente = window._vtaClienteSeleccionadoId || null;
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

  const ESTADO_BADGE = { BORRADOR: 'badge-gris', FACTURADA: 'badge-verde', ANULADA: 'badge-rojo' };
  const tasa = v.tasa_bcv || 1;
  document.getElementById('ficha-venta-fecha-display').textContent = 'Fecha: ' + fmtFecha(v.fecha_venta);
  const esVES = v.moneda_cobro === 'VES';
  // Resalta en naranja la cifra en la Moneda de Facturación real de esta
  // Venta, arriba; la otra moneda se muestra atenuada, más pequeña, debajo.
  const fmtDual = function(usd) {
    const ves = (usd||0) * tasa;
    const principal = esVES ? 'Bs ' + fmtBs(ves) : '$ ' + fmtUSD(usd||0);
    const secundaria = esVES ? '$ ' + fmtUSD(usd||0) : 'Bs ' + fmtBs(ves);
    return '<div style="color:var(--naranja)">'+principal+'</div>'
      + '<div style="color:var(--suave);font-size:11px">'+secundaria+'</div>';
  };
  document.getElementById('ficha-venta-contenido').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">'
    + '<div><div style="font-weight:600;font-size:15px">'+(v.clientes?.nombre_apellido||'—')+'</div>'
    + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">'+(v.clientes?'V-'+v.id_venta:'')+(v.facturas?.numero_factura?' — '+v.facturas.numero_factura:'')+'</div></div>'
    + '<span class="badge '+(ESTADO_BADGE[v.estado]||'badge-gris')+'">'+(ESTADO_LABEL_VENTA[v.estado]||v.estado)+'</span>'
    + '</div>'
    + '<table style="width:100%;margin-bottom:14px"><thead><tr>'
    + '<th style="font-size:11px;text-align:left;color:var(--suave)">Artículo</th><th style="font-size:11px;color:var(--suave)">Cant.</th><th style="font-size:11px;color:var(--suave)">P. Unit.</th><th style="font-size:11px;color:var(--suave)">Subtotal</th>'
    + '</tr></thead><tbody>'+(filasLin || '<tr><td colspan="4" style="text-align:center;color:var(--suave);padding:12px;font-size:12px">Sin líneas</td></tr>')+'</tbody></table>'
    + '<div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--borde);padding-top:10px;font-family:var(--font-mono)">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:12px"><span style="color:var(--suave);font-family:var(--font-body);padding-top:1px">Subtotal</span><div style="text-align:right">'+fmtDual(v.subtotal_usd)+'</div></div>'
    + (v.iva_usd > 0 ? '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:12px"><span style="color:var(--suave);font-family:var(--font-body);padding-top:1px">IVA</span><div style="text-align:right">'+fmtDual(v.iva_usd)+'</div></div>' : '')
    + (v.igtf_usd > 0 ? '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:12px"><span style="color:var(--suave);font-family:var(--font-body);padding-top:1px">IGTF</span><div style="text-align:right">'+fmtDual(v.igtf_usd)+'</div></div>' : '')
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:15px;padding-top:4px"><span style="font-family:var(--font-display);padding-top:2px">TOTAL</span><div style="text-align:right">'+fmtDual(v.total_usd)+'</div></div>'
    + '</div>'
    + '<div style="font-size:10px;color:var(--suave);margin-top:4px;text-align:right">Moneda de Facturación: '+(esVES?'VES':'USD')+' · Tasa BCV: '+fmtBs(tasa)+' Bs/$</div>'
    + (v.estado === 'FACTURADA'
        ? '<div style="margin-top:10px;font-size:11px;color:var(--suave)">'
          + (v.entregado ? '📦 Entregado el ' + fmtFecha(v.fecha_entrega) + (v.entregado_por ? ' por ' + v.entregado_por : '') : '📦 Pendiente de entrega')
          + '</div>'
        : '');

  const btnEditar    = document.getElementById('ficha-venta-btn-editar');
  const btnFacturar  = document.getElementById('ficha-venta-btn-facturar');
  const btnAnular    = document.getElementById('ficha-venta-btn-anular');
  const btnEliminar  = document.getElementById('ficha-venta-btn-eliminar');

  btnEditar.style.display    = (v.estado === 'BORRADOR' && puedo('VENTAS','EDITAR'))   ? '' : 'none';
  btnFacturar.style.display  = (v.estado === 'BORRADOR' && puedo('VENTAS','CREAR'))    ? '' : 'none';
  btnAnular.style.display    = (v.estado === 'BORRADOR' && puedo('VENTAS','ELIMINAR')) ? '' : 'none';
  btnEliminar.style.display  = (v.estado === 'BORRADOR' && puedo('VENTAS','ELIMINAR')) ? '' : 'none';

  btnEditar.onclick    = function() { cerrarModal('modal-ficha-venta'); abrirVenta(v.id_venta); };
  btnFacturar.onclick  = function() { facturarVenta(v.id_venta); };
  btnAnular.onclick    = function() { anularVenta(v.id_venta); };
  btnEliminar.onclick  = function() { eliminarVenta(v.id_venta); };

  abrirModal('modal-ficha-venta');
}

async function facturarVenta(id) {
  if (!confirm('¿Facturar esta Venta?')) return;
  try {
    const vRows = await api('ventas','GET',null,'?id_venta=eq.'+id+'&select=*,clientes(*)');
    const v = vRows && vRows[0];
    if (!v) throw new Error('Venta no encontrada.');
    if (v.estado !== 'BORRADOR') throw new Error('Solo se puede facturar una Venta en estado Presupuesto.');

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
