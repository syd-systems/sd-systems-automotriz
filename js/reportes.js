// ═══════════════════════════════════════════════════════════════
//   MÓDULO REPORTES -- vive bajo Administración en el menú, con su
//   propio permiso (REPORTES→VER) como cualquier otro módulo. Pensado
//   para alojar reportes de distintas áreas -- el primero es el de
//   Inventario; los siguientes se agregan como nuevas opciones del
//   selector, cada uno con su propia función de render.
// ═══════════════════════════════════════════════════════════════

const REPORTES_DISPONIBLES = [
  { id: 'inventario', nombre: '📦 Reporte de Inventario', render: repInventarioRender, permiso: 'VER_INVENTARIO' },
  { id: 'compras',    nombre: '🛒 Reporte de Compras',    render: repComprasRender,    permiso: 'VER_COMPRAS' },
  { id: 'ventas',     nombre: '💰 Reporte de Ventas',     render: repVentasRender,     permiso: 'VER_VENTAS' },
  { id: 'servicios',  nombre: '🔧 Reporte por Servicios', render: repServiciosRender,  permiso: 'VER_SERVICIOS' },
  { id: 'ingresos',   nombre: '💳 Reporte de Ingresos',   render: repIngresosRender,   permiso: 'VER_INGRESOS' },
  { id: 'puntoventa', nombre: '🏬 Reporte por Punto de Venta', render: repPuntoVentaRender, permiso: 'VER_PUNTO_VENTA' },
  { id: 'notascredito', nombre: '🧾 Reporte de Notas de Crédito', render: repNotasCreditoRender, permiso: 'VER_NOTAS_CREDITO' },
  { id: 'egresos',    nombre: '💸 Reporte de Egresos',    render: repEgresosRender,    permiso: 'VER_EGRESOS' },
];
function _reportesPermitidos() {
  if (sesionActual?.administrador) return REPORTES_DISPONIBLES;
  return REPORTES_DISPONIBLES.filter(function(r){ return puedo('REPORTES', r.permiso); });
}

let _reporteActual = 'inventario';
let _repFiltrosVisibles = false;
function repToggleFiltros() {
  _repFiltrosVisibles = !_repFiltrosVisibles;
  const el = document.getElementById('rep-filtros-extra');
  if (el) el.style.display = _repFiltrosVisibles ? 'flex' : 'none';
  const btn = document.getElementById('rep-filtros-toggle-btn');
  if (btn) btn.textContent = _repFiltrosVisibles ? 'Ocultar' : 'Mostrar';
}

async function renderReportes() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('REPORTES')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const reportesOK = _reportesPermitidos();
  if (!reportesOK.length) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">No tiene permiso para ver ningún Reporte.</div>';
    return;
  }
  // Precarga del catálogo de Monedas (síncrono para las funciones que
  // generan HTML directamente, sin volverse todas async).
  if (!_monedasCache) { try { _monedasCache = await api('param_monedas','GET',null,'?estado=eq.ACTIVO&order=codigo.asc&select=*') || []; } catch(e) { _monedasCache = []; } }
  if (!reportesOK.find(function(r){ return r.id === _reporteActual; })) _reporteActual = reportesOK[0].id;
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="panel" id="panel-reportes" style="margin-top:-16px">'
    + '<div class="panel-header" style="padding:14px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
    + '<select id="rep-selector" onchange="_reporteActual=this.value; renderReportes()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;cursor:pointer;height:35px;box-sizing:border-box">'
    + reportesOK.map(function(r){ return '<option value="'+r.id+'"' + (r.id === _reporteActual ? ' selected' : '') + '>' + escapeHtml(r.nombre) + '</option>'; }).join('')
    + '</select>'
    + '<div id="reportes-topbar-extra" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"></div>'
    + '<span id="rep-inv-tasa-info" style="font-size:12px;color:var(--suave);font-family:var(--font-mono)"></span>'
    + '</div>'
    + '<div id="reportes-contenido"></div>'
    + '</div>';

  const reporte = REPORTES_DISPONIBLES.find(function(r){ return r.id === _reporteActual; });
  if (reporte) await reporte.render(document.getElementById('reportes-contenido'));
}

// ═══════════════════ REPORTE DE INVENTARIO ═══════════════════
function repInventarioLimpiarFiltros() {
  const fecha = document.getElementById('rep-inv-fecha');       if (fecha) fecha.value = getHoyVzla();
  const moneda = document.getElementById('rep-inv-moneda');     if (moneda) moneda.value = 'VES';
  const area = document.getElementById('rep-inv-area');         if (area) area.value = '';
  const categoria = document.getElementById('rep-inv-categoria'); if (categoria) categoria.value = '';
  const tipo = document.getElementById('rep-inv-tipo');         if (tipo) tipo.value = '';
  const filtroStock = document.getElementById('rep-inv-filtro-stock'); if (filtroStock) filtroStock.value = 'todos';
  repInventarioRender(document.getElementById('reportes-contenido'));
}

async function repInventarioRender(cont) {
  if (!cont) return;
  const fechaCorteVal = document.getElementById('rep-inv-fecha')?.value || getHoyVzla();
  const monedaVal = document.getElementById('rep-inv-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-inv-formato')?.value || 'pdf';
  const filtroStockVal = document.getElementById('rep-inv-filtro-stock')?.value || 'todos';
  const areaVal = document.getElementById('rep-inv-area')?.value || '';
  const categoriaVal = document.getElementById('rep-inv-categoria')?.value || '';
  const tipoVal = document.getElementById('rep-inv-tipo')?.value || '';

  let areas = [];
  try {
    areas = await api('param_areas','GET',null,
      '?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
  } catch(eAreasRep) { console.warn('Error cargando Áreas para el Reporte:', eAreasRep); }

  let categorias = [];
  try {
    categorias = await api('inv_categorias','GET',null,
      '?select=id_categoria,nombre,codigo&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(eCatRep) { console.warn('Error cargando Categorías para el Reporte:', eCatRep); }

  let tipos = [];
  try {
    tipos = await api('inv_articulos_tipo','GET',null,
      '?select=id_tipo,nombre,codigo&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(eTipoRep) { console.warn('Error cargando Tipos de Artículo para el Reporte:', eTipoRep); }

  const catNombrePorId = {};
  (categorias||[]).forEach(function(c){ catNombrePorId[c.id_categoria] = c.nombre; });

  // Fecha de Corte y Moneda van en la barra superior (junto al selector
  // de Reporte); el resto de los filtros quedan en un panel plegable.
  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Fecha de Corte</label>'
    + '<input type="date" id="rep-inv-fecha" value="' + fechaCorteVal + '" max="' + getHoyVzla() + '" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-inv-moneda" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + ((_monedasCache && _monedasCache.length) ? _monedasCache.map(function(m){ return '<option value="'+m.codigo+'"' + (monedaVal===m.codigo?' selected':'') + '>'+m.codigo+'</option>'; }).join('') : '<option value="VES">VES</option><option value="USD">USD</option>')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;height:35px;box-sizing:border-box">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-inv-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repInventarioExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Área</label>'
    + '<select id="rep-inv-area" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (areaVal===''?' selected':'') + '>Todas las Áreas</option>'
    + areas.map(function(a){ return '<option value="'+a.id+'"' + (String(areaVal)===String(a.id)?' selected':'') + '>' + escapeHtml(a.nombre) + (a.codigo ? ' (' + escapeHtml(a.codigo) + ')' : '') + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Categoría</label>'
    + '<select id="rep-inv-categoria" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (categoriaVal===''?' selected':'') + '>Todas</option>'
    + categorias.map(function(c){ return '<option value="'+c.id_categoria+'"' + (String(categoriaVal)===String(c.id_categoria)?' selected':'') + '>' + escapeHtml(c.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Tipo de Artículo</label>'
    + '<select id="rep-inv-tipo" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (tipoVal===''?' selected':'') + '>Todos</option>'
    + tipos.map(function(t){ return '<option value="'+t.id_tipo+'"' + (String(tipoVal)===String(t.id_tipo)?' selected':'') + '>' + escapeHtml(t.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Stock</label>'
    + '<select id="rep-inv-filtro-stock" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="todos"' + (filtroStockVal==='todos'?' selected':'') + '>Todos</option>'
    + '<option value="con"' + (filtroStockVal==='con'?' selected':'') + '>En Stock</option>'
    + '<option value="sin"' + (filtroStockVal==='sin'?' selected':'') + '>Sin Stock</option>'
    + '</select></div>'
    + '<button onclick="repInventarioLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div id="rep-inv-resumen" style="display:flex;gap:16px;margin-bottom:20px">'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Unidades en Stock</div>'
    + '<div id="rep-inv-total-unidades" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Valor Total del Inventario</div>'
    + '<div id="rep-inv-total-valor" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Valor a Tasa BCV del Día</div>'
    + '<div id="rep-inv-total-valor-dia" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="min-width:900px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr id="rep-inv-thead-row">'
    + '</tr></thead><tbody id="rep-inv-tbody"><tr><td colspan="9" style="text-align:center;color:var(--suave);padding:32px">Cargando...</td></tr></tbody>'
    + '</table></div>'
    + '</div>';

  // Tasa BCV vigente A la fecha de corte (nunca una posterior, aunque ya
  // esté publicada -- mismo criterio legal usado en el resto de la app).
  let tasaCorte = 1;
  {
    try {
      const tasaRows = await api('tasas','GET',null,
        '?moneda_origen=eq.USD&fecha_valor=lte.'+fechaCorteVal+'&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
      if (tasaRows && tasaRows[0]) {
        tasaCorte = parseFloat(tasaRows[0].tipo_cambio);
        document.getElementById('rep-inv-tasa-info').textContent = 'Tasa BCV Bs/Usd al ' + fmtFecha(tasaRows[0].fecha_valor) + ': ' + formatearTasaVE(tasaCorte);
      } else {
        document.getElementById('rep-inv-tasa-info').textContent = 'Sin tasa BCV registrada a esa fecha.';
      }
    } catch(eTasaRep) { document.getElementById('rep-inv-tasa-info').textContent = 'Error obteniendo la tasa.'; }
  }

  // Tasa histórica del CPP -- la de la última Entrada de cada Artículo
  // hasta la fecha de corte (la que quedó congelada en esa Entrada). Es el
  // MISMO criterio de Inventario General, para que ambos muestren el mismo
  // Costo Prom. en Bs. Si el Artículo no tiene Entradas, se usa la de corte.
  let tasaCppPorArticulo = {};
  try {
    const entTasaRows = await api('stock_entradas','GET',null,
      '?fecha_entrada=lte.'+fechaCorteVal+'&or=(anulada.eq.false,anulada.is.null)&order=fecha_entrada.desc&select=id_articulo,tasa_bcv');
    (entTasaRows||[]).forEach(function(e) {
      if (tasaCppPorArticulo[e.id_articulo] === undefined && e.tasa_bcv) tasaCppPorArticulo[e.id_articulo] = parseFloat(e.tasa_bcv);
    });
  } catch(eTasaCppRep) { console.warn('Error trayendo tasas históricas del CPP:', eTasaCppRep); }

  // Consumo de los últimos 90 días (hasta la fecha de corte), por Artículo
  // -- base para calcular la Rotación (Días de Cobertura).
  const fechaDesde90 = new Date(fechaCorteVal + 'T00:00:00Z');
  fechaDesde90.setDate(fechaDesde90.getDate() - 90);
  const fechaDesde90Str = fechaDesde90.toISOString().slice(0,10);
  let consumoPorArticulo = {};
  try {
    const salidasRows = await api('stock_salidas','GET',null,
      '?fecha_salida=gte.'+fechaDesde90Str+'&fecha_salida=lte.'+fechaCorteVal+'&anulada=eq.false&select=id_articulo,cantidad');
    (salidasRows||[]).forEach(function(s) {
      consumoPorArticulo[s.id_articulo] = (consumoPorArticulo[s.id_articulo]||0) + parseFloat(s.cantidad||0);
    });
  } catch(eConsumoRep) { console.warn('Error calculando consumo para Rotación:', eConsumoRep); }

  // Este Reporte vive fuera de Inventario, así que trae sus propios datos
  // (no depende de que el módulo Inventario ya esté cargado/cacheado).
  let items = [];
  try {
    let qItems = '?estado=eq.ACTIVO&select=*' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    if (categoriaVal) qItems += '&id_categoria_articulo=eq.'+categoriaVal;
    if (tipoVal) qItems += '&id_tipo_articulo=eq.'+tipoVal;
    items = await api('inventario_almacen','GET',null, qItems);
  } catch(eItemsRep) { console.warn('Error cargando Artículos para el Reporte:', eItemsRep); }

  // El stock real vive por Área en "inventario_stock_area" -- la columna
  // stock_actual_articulo de inventario_almacen queda desactualizada (no
  // refleja las Entradas certificadas). Si se eligió un Área específica,
  // se suma SOLO esa; si no, se suma el total de todas.
  let stockPorArticulo = {};
  try {
    const qStockArea = '?select=id_articulo,stock_actual' + (areaVal ? '&id_area=eq.'+areaVal : '');
    const stockAreaRows = await api('inventario_stock_area','GET',null,qStockArea);
    (stockAreaRows||[]).forEach(function(s) {
      stockPorArticulo[s.id_articulo] = (stockPorArticulo[s.id_articulo]||0) + parseFloat(s.stock_actual||0);
    });
  } catch(eStockAreaRep) { console.warn('Error trayendo stock por Área:', eStockAreaRep); }

  // El Margen real vigente vive por Tipo de Artículo en "param_margen_bruto"
  // -- inventario_almacen.precio_venta_moneda es solo el histórico de la
  // última Venta (queda en 0 si nunca se vendió), NUNCA el Margen
  // establecido. Se toma el vigente A LA FECHA DE CORTE del reporte (no
  // "hoy"), igual criterio legal que con la Tasa BCV.
  let margenPorTipo = {};
  try {
    const margenRows = await api('param_margen_bruto','GET',null,
      '?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)
      +'&estado=neq.ANULADO&fecha_vigencia_desde=lte.'+fechaCorteVal
      +'&order=fecha_vigencia_desde.desc,id.desc&select=id_tipo_articulo,margen_pct');
    (margenRows||[]).forEach(function(m) {
      if (margenPorTipo[m.id_tipo_articulo] === undefined) margenPorTipo[m.id_tipo_articulo] = parseFloat(m.margen_pct);
    });
  } catch(eMargenRep) { console.warn('Error trayendo Márgenes vigentes:', eMargenRep); }

  const itemsFiltrados = filtroStockVal === 'con'
    ? items.filter(function(a){ return (stockPorArticulo[a.id_articulo] || 0) > 0; })
    : filtroStockVal === 'sin'
      ? items.filter(function(a){ return (stockPorArticulo[a.id_articulo] || 0) === 0; })
      : items;

  let totalUnidades = 0, totalValor = 0, totalValorDia = 0;
  const filas = itemsFiltrados.map(function(a) {
    const stock = stockPorArticulo[a.id_articulo] || 0;
    const stockMin = parseFloat(a.stock_minimo_articulo||0);
    // Igual que Inventario General: sin stock, el CPP se muestra en 0
    const costoUsd = stock === 0 ? 0 : parseFloat(a.precio_costo_moneda||0);
    const costoBs = costoUsd * (tasaCppPorArticulo[a.id_articulo] || tasaCorte);
    const precioPromMostrar = monedaVal === 'VES' ? costoBs : costoUsd;
    const valorLinea = stock * precioPromMostrar;
    const valorDia = stock * costoUsd * tasaCorte;
    totalValorDia += valorDia;
    const margen = (a.id_tipo_articulo !== null && a.id_tipo_articulo !== undefined && margenPorTipo[a.id_tipo_articulo] !== undefined)
      ? margenPorTipo[a.id_tipo_articulo] : null;
    totalUnidades += stock;
    totalValor += valorLinea;

    const consumo90 = consumoPorArticulo[a.id_articulo] || 0;
    const consumoDiario = consumo90 / 90;
    const diasCobertura = consumo90 > 0 && consumoDiario > 0 ? Math.round(stock / consumoDiario) : null;

    return {
      codigo: a.codigo_articulo||'', nombre: a.nombre_articulo||'', categoria: catNombrePorId[a.id_categoria_articulo]||'',
      stock: stock, stockMin: stockMin, diasCobertura: diasCobertura, precioProm: precioPromMostrar,
      precioPromBs: costoBs, precioPromUsd: costoUsd,
      valorLinea: valorLinea, valorDia: valorDia, margen: margen
    };
  });

  document.getElementById('rep-inv-total-unidades').textContent = totalUnidades.toLocaleString('es-VE');
  document.getElementById('rep-inv-total-valor').textContent = (monedaVal==='VES' ? fmtBs(totalValor) + ' Bs' : '$ ' + fmtUSD(totalValor));
  const elValorDia = document.getElementById('rep-inv-total-valor-dia');
  if (elValorDia) elValorDia.textContent = fmtBs(totalValorDia) + ' Bs';

  // Filtros activos, en texto legible -- para que quede explícito en los
  // reportes exportados (no basta con que los datos YA vengan filtrados;
  // quien lo lea después debe poder ver bajo qué criterio se generó).
  const filtrosActivos = [];
  if (areaVal) { const a = areas.find(function(x){ return String(x.id)===String(areaVal); }); if (a) filtrosActivos.push('Área: ' + a.nombre); }
  if (categoriaVal) { const c = categorias.find(function(x){ return String(x.id_categoria)===String(categoriaVal); }); if (c) filtrosActivos.push('Categoría: ' + c.nombre); }
  if (tipoVal) { const t = tipos.find(function(x){ return String(x.id_tipo)===String(tipoVal); }); if (t) filtrosActivos.push('Tipo: ' + t.nombre); }
  if (filtroStockVal === 'con') filtrosActivos.push('Solo Artículos en Stock');
  if (filtroStockVal === 'sin') filtrosActivos.push('Solo Artículos sin Stock');
  const filtrosTexto = filtrosActivos.length ? filtrosActivos.join('   |   ') : 'Sin filtros adicionales (todos los Artículos, todas las Áreas)';

  window._reporteInvActual = { items, monedaVal, tasaCorte, fechaCorteVal, catNombrePorId, consumoPorArticulo, stockPorArticulo, filas, filtrosTexto };
  _repInvOrdenCol = _repInvOrdenCol || null;
  _repInvOrdenAsc = _repInvOrdenAsc !== false;
  _repInvRenderTabla();
}

// ── Ordenamiento de columnas (clic en el encabezado) ──
let _repInvOrdenCol = null;
let _repInvOrdenAsc = true;
const REP_INV_COLUMNAS = [
  { campo: 'codigo',        tipo: 'texto',  label: 'Código',       ancho: '9%'  },
  { campo: 'nombre',        tipo: 'texto',  label: 'Artículo',     ancho: '20%' },
  { campo: 'stock',         tipo: 'numero', label: 'Stock',        ancho: '7%'  },
  { campo: 'stockMin',      tipo: 'numero', label: 'Stock Mín.',   ancho: '8%'  },
  { campo: 'diasCobertura', tipo: 'numero', label: 'Rotación',     ancho: '12%' },
  { campo: 'precioPromUsd', tipo: 'numero', label: 'Costo Prom. (CPP)', ancho: '13%' },
  { campo: 'valorLinea',    tipo: 'numero', label: 'Valor Total',  ancho: '11%' },
  { campo: 'valorDia',      tipo: 'numero', label: 'Valor Tasa del Día', ancho: '12%' },
  { campo: 'margen',        tipo: 'numero', label: 'Margen',       ancho: '8%'  },
];

function repInventarioOrdenar(campo) {
  if (_repInvOrdenCol === campo) { _repInvOrdenAsc = !_repInvOrdenAsc; }
  else { _repInvOrdenCol = campo; _repInvOrdenAsc = true; }
  _repInvRenderTabla();
}

function _repInvRenderTabla() {
  const d = window._reporteInvActual;
  if (!d) return;
  const monedaVal = d.monedaVal;

  // Encabezados con flechita de orden
  const theadRow = REP_INV_COLUMNAS.map(function(c, i) {
    const alinear = (c.tipo === 'numero') ? 'text-align:right' : (i===4 ? 'text-align:center' : 'text-align:left');
    const flecha = _repInvOrdenCol === c.campo ? (_repInvOrdenAsc ? ' ▲' : ' ▼') : '';
    return '<th style="width:'+c.ancho+';'+alinear+';cursor:pointer;user-select:none" onclick="repInventarioOrdenar(\''+c.campo+'\')" title="Ordenar">' + c.label + flecha + '</th>';
  }).join('');
  const theadEl = document.getElementById('rep-inv-thead-row');
  if (theadEl) theadEl.innerHTML = theadRow;

  // Ordenar (null/'' siempre al final, sin importar la dirección)
  let filasOrd = d.filas.slice();
  if (_repInvOrdenCol) {
    const colDef = REP_INV_COLUMNAS.find(function(c){ return c.campo === _repInvOrdenCol; });
    filasOrd.sort(function(a, b) {
      let va = a[_repInvOrdenCol], vb = b[_repInvOrdenCol];
      const vaVacio = (va === null || va === undefined || va === '');
      const vbVacio = (vb === null || vb === undefined || vb === '');
      if (vaVacio && vbVacio) return 0;
      if (vaVacio) return 1;
      if (vbVacio) return -1;
      let cmp;
      if (colDef.tipo === 'texto') cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
      else cmp = va - vb;
      return _repInvOrdenAsc ? cmp : -cmp;
    });
  }

  const filasHtml = filasOrd.map(function(f) {
    let rotacionHtml;
    if (f.diasCobertura === null) {
      rotacionHtml = '<span style="color:var(--suave)">⚪ Sin movimiento</span>';
    } else {
      const color = f.diasCobertura < 15 ? '#fc8181' : f.diasCobertura <= 45 ? '#facc15' : '#22c55e';
      const emoji = f.diasCobertura < 15 ? '🔴' : f.diasCobertura <= 45 ? '🟡' : '🟢';
      rotacionHtml = '<span style="color:'+color+'">' + emoji + ' ' + f.diasCobertura + ' días</span>';
    }
    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:15px;color:var(--naranja)">' + escapeHtml(f.codigo||'—') + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.nombre) + (f.categoria ? '<div style="font-size:11px;color:var(--suave)">' + escapeHtml(f.categoria) + '</div>' : '') + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.stock + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--suave);font-size:15px">' + f.stockMin + '</td>'
      + '<td style="text-align:center;font-size:15px">' + rotacionHtml + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:13px">'
        + '<div style="color:var(--suave);font-size:9px">COSTO PROM. (CPP)</div>'
        + '<div style="font-size:15px">' + fmtBs(f.precioPromBs) + ' Bs</div>'
        + '<div style="color:var(--suave);font-size:11px">$ ' + fmtUSD(f.precioPromUsd) + '</div></td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (monedaVal==='VES' ? fmtBs(f.valorLinea) : fmtUSD(f.valorLinea)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + fmtBs(f.valorDia) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + (f.margen !== null ? f.margen.toFixed(1) + '%' : '—') + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-inv-tbody').innerHTML = filasHtml || '<tr><td colspan="9" style="text-align:center;color:var(--suave);padding:32px">No hay Artículos activos</td></tr>';
}

async function repInventarioExportar() {
  // Se refresca el reporte justo antes de exportar (no basta con confiar
  // en lo que quedó de la última vez que se renderizó) -- así el archivo
  // siempre sale con la Moneda y los datos que están seleccionados en
  // pantalla EN ESE MOMENTO, nunca desactualizados.
  await repInventarioRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-inv-formato')?.value || 'csv';
  if (formato === 'excel') _repInvExportarExcel();
  else if (formato === 'pdf') _repInvExportarPDF();
  else _repInvExportarCSV();
}

// Encabezados y filas -- compartido entre los 3 formatos. Devuelve los
// montos como NÚMEROS crudos (filasNumericas, para Excel -- así Excel
// puede sumarlos/filtrarlos, y los muestra con el separador decimal que
// tenga configurado el propio Excel de quien lo abra) y también ya
// formateados en texto con coma decimal (filasTexto, para CSV y PDF, que
// que no tienen un tipo "numérico" real, son solo texto/imagen).
function _repInvDatosExportar() {
  const d = window._reporteInvActual;
  if (!d) return null;
  const encabezados = ['Código','Artículo','Stock','Stock Mínimo','Rotación (días)','Costo Prom. (CPP) Bs','Costo Prom. (CPP) $',
    'Valor Total (' + (d.monedaVal === 'VES' ? 'Bs' : '$') + ')','Valor Tasa del Día (Bs)','Margen %'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filasNumericas = d.filas.map(function(f) {
    return [
      f.codigo, f.nombre, f.stock, f.stockMin,
      f.diasCobertura !== null ? f.diasCobertura : 0, f.precioPromBs, f.precioPromUsd, f.valorLinea, f.valorDia,
      f.margen !== null ? f.margen : 0
    ];
  });
  const filasTexto = d.filas.map(function(f) {
    return [
      f.codigo, f.nombre, f.stock, f.stockMin,
      f.diasCobertura !== null ? f.diasCobertura : 0, fmtBs(f.precioPromBs), fmtUSD(f.precioPromUsd),
      fmtMoneda(f.valorLinea), fmtBs(f.valorDia),
      (f.margen !== null ? f.margen : 0).toFixed(1) + '%'
    ];
  });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repInvExportarCSV() {
  const dat = _repInvDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Fecha de Corte: ' + dat.d.fechaCorteVal + '   |   Moneda: ' + dat.d.monedaVal + '   |   Tasa BCV Bs/Usd del día: ' + formatearTasaVE(dat.d.tasaCorte)],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_inventario_' + dat.d.fechaCorteVal + '_' + dat.d.monedaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repInvExportarExcel() {
  const dat = _repInvDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 4, FILA_DATOS_DESDE = 5;
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Reporte de Inventario'],
    ['Fecha de Corte: ' + dat.d.fechaCorteVal + '   |   Moneda: ' + dat.d.monedaVal + '   |   Tasa BCV Bs/Usd del día: ' + formatearTasaVE(dat.d.tasaCorte)],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasNumericas));
  hoja['!cols'] = [ {wch:14}, {wch:38}, {wch:10}, {wch:12}, {wch:14}, {wch:18}, {wch:16}, {wch:16}, {wch:20}, {wch:10} ];

  // Encabezados centrados; columnas numéricas (2 a 7) con formato de
  // celda -- el valor sigue siendo un número real (se puede sumar/
  // filtrar en Excel), solo cambia cómo se ve. El código del formato usa
  // la sintaxis estándar de Excel (coma miles, punto decimal); Excel lo
  // traduce solo a "1.000,00" según el idioma/región configurado en el
  // Excel de quien lo abre -- esa traducción automática es de Excel, no
  // de este archivo. Stock/Stock Mínimo/Rotación sin decimales.
  const NUM_FILAS = dat.filasNumericas.length;
  for (let col = 0; col < 10; col++) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
    if (col < 2) continue; // Código y Artículo: texto, sin formato numérico
    const formatoNum = (col >= 5 && col <= 8) ? '#,##0.00' : (col === 9 ? '0.0"%"' : '#,##0');
    for (let i = 0; i < NUM_FILAS; i++) {
      const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: col });
      if (hoja[ref]) {
        hoja[ref].z = formatoNum;
        hoja[ref].t = 'n';
        hoja[ref].s = { alignment: { horizontal: 'right' } };
      }
    }
  }

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Inventario');
  XLSX.writeFile(libro, 'reporte_inventario_' + dat.d.fechaCorteVal + '_' + dat.d.monedaVal + '.xlsx', { cellStyles: true });
}

function _repInvExportarPDF() {
  const dat = _repInvDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Reporte de Inventario', 14, 15);
  doc.setFontSize(9);
  doc.text('Fecha de Corte: ' + dat.d.fechaCorteVal + '   |   Moneda: ' + dat.d.monedaVal
    + '   |   Tasa BCV Bs/Usd del día: ' + formatearTasaVE(dat.d.tasaCorte), 14, 21);
  doc.text('Filtros: ' + dat.d.filtrosTexto, 14, 26);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 31,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    // Columnas numéricas (Stock en adelante) alineadas a la derecha;
    // Código y Artículo (0 y 1) se quedan como vienen (izquierda).
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      8: { halign: 'right' }, 9: { halign: 'right' },
    },
  });
  doc.save('reporte_inventario_' + dat.d.fechaCorteVal + '_' + dat.d.monedaVal + '.pdf');
}

// ═══════════════════ REPORTE DE COMPRAS ═══════════════════
// Fuente: stock_entradas con motivo='compra' y estado_aprobacion='APROBADA'
// (compras reales, no propuestas pendientes ni rechazadas). A diferencia
// de Inventario (una foto a una fecha), esto es un LISTADO de
// transacciones en un Rango de Fechas -- cada línea usa SU PROPIA tasa_bcv
// (la vigente el día de esa compra en particular), no una tasa única de
// corte, porque cada compra ocurrió en un día distinto.
function repComprasLimpiarFiltros() {
  const hoy = getHoyVzla();
  const desde = document.getElementById('rep-com-desde'); if (desde) desde.value = hoy;
  const hasta = document.getElementById('rep-com-hasta'); if (hasta) hasta.value = hoy;
  const moneda = document.getElementById('rep-com-moneda'); if (moneda) moneda.value = 'VES';
  const categoria = document.getElementById('rep-com-categoria'); if (categoria) categoria.value = '';
  const tipo = document.getElementById('rep-com-tipo'); if (tipo) tipo.value = '';
  const proveedor = document.getElementById('rep-com-proveedor'); if (proveedor) proveedor.value = '';
  repComprasRender(document.getElementById('reportes-contenido'));
}

async function repComprasRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-com-desde')?.value || hoy;
  const hastaVal = document.getElementById('rep-com-hasta')?.value || hoy;
  const monedaVal = document.getElementById('rep-com-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-com-formato')?.value || 'pdf';
  const areaVal = document.getElementById('rep-com-area')?.value || '';
  const categoriaVal = document.getElementById('rep-com-categoria')?.value || '';
  const tipoVal = document.getElementById('rep-com-tipo')?.value || '';
  const proveedorVal = document.getElementById('rep-com-proveedor')?.value || '';

  let areas = [], categorias = [], tipos = [], proveedores = [];
  try {
    areas = await api('param_areas','GET',null,
      '?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
  } catch(e) { console.warn('Error cargando Áreas:', e); }
  try {
    categorias = await api('inv_categorias','GET',null,
      '?select=id_categoria,nombre&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(e) { console.warn('Error cargando Categorías:', e); }
  try {
    tipos = await api('inv_articulos_tipo','GET',null,
      '?select=id_tipo,nombre&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(e) { console.warn('Error cargando Tipos de Artículo:', e); }
  try {
    proveedores = await rpc('obtener_proveedores_activos', { p_id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null }) || [];
  } catch(e) { console.warn('Error cargando Proveedores:', e); }

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-com-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-com-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-com-moneda" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + ((_monedasCache && _monedasCache.length) ? _monedasCache.map(function(m){ return '<option value="'+m.codigo+'"' + (monedaVal===m.codigo?' selected':'') + '>'+m.codigo+'</option>'; }).join('') : '<option value="VES">VES</option><option value="USD">USD</option>')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;height:35px;box-sizing:border-box">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-com-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repComprasExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Categoría</label>'
    + '<select id="rep-com-categoria" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (categoriaVal===''?' selected':'') + '>Todas</option>'
    + categorias.map(function(c){ return '<option value="'+c.id_categoria+'"' + (String(categoriaVal)===String(c.id_categoria)?' selected':'') + '>' + escapeHtml(c.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Tipo de Artículo</label>'
    + '<select id="rep-com-tipo" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (tipoVal===''?' selected':'') + '>Todos</option>'
    + tipos.map(function(t){ return '<option value="'+t.id_tipo+'"' + (String(tipoVal)===String(t.id_tipo)?' selected':'') + '>' + escapeHtml(t.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Proveedor</label>'
    + '<select id="rep-com-proveedor" onchange="repComprasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (proveedorVal===''?' selected':'') + '>Todos</option>'
    + proveedores.map(function(p){ return '<option value="'+p.id_proveedor+'"' + (String(proveedorVal)===String(p.id_proveedor)?' selected':'') + '>' + escapeHtml(p.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<button onclick="repComprasLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div id="rep-com-resumen" style="display:flex;gap:16px;margin-bottom:20px">'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Compras</div>'
    + '<div id="rep-com-total-compras" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Monto Total</div>'
    + '<div id="rep-com-total-monto" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="min-width:900px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr id="rep-com-thead-row"></tr></thead>'
    + '<tbody id="rep-com-tbody"><tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">Cargando...</td></tr></tbody>'
    + '</table></div>'
    + '</div>';

  // Artículos activos, para resolver Nombre/Categoría/Tipo por id_articulo
  // (stock_entradas solo guarda el id) y para poder filtrar por
  // Categoría/Tipo (stock_entradas no los tiene directamente).
  let itemsMap = {};
  try {
    let qItems = '?estado=eq.ACTIVO&select=id_articulo,nombre_articulo,id_categoria_articulo,id_tipo_articulo' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    if (categoriaVal) qItems += '&id_categoria_articulo=eq.'+categoriaVal;
    if (tipoVal) qItems += '&id_tipo_articulo=eq.'+tipoVal;
    const itemsRows = await api('inventario_almacen','GET',null, qItems);
    (itemsRows||[]).forEach(function(a){ itemsMap[a.id_articulo] = a; });
  } catch(e) { console.warn('Error cargando Artículos:', e); }

  const proveedorNombrePorId = {};
  proveedores.forEach(function(p){ proveedorNombrePorId[p.id_proveedor] = p.nombre; });
  const areaNombrePorId = {};
  areas.forEach(function(a){ areaNombrePorId[a.id] = a.nombre + (a.codigo ? ' (' + a.codigo + ')' : ''); });

  let entradas = [];
  try {
    let qEnt = '?motivo=eq.compra&estado_aprobacion=eq.APROBADA&anulada=eq.false'
      + '&fecha_entrada=gte.'+desdeVal+'&fecha_entrada=lte.'+hastaVal
      + '&select=id_entrada,id_articulo,cantidad,precio_costo_moneda,fecha_entrada,id_proveedor,id_area,tasa_bcv,certificado_almacen';
    if (areaVal) qEnt += '&id_area=eq.'+areaVal;
    if (proveedorVal) qEnt += '&id_proveedor=eq.'+proveedorVal;
    entradas = await api('stock_entradas','GET',null, qEnt);
  } catch(e) { console.warn('Error cargando Compras:', e); }

  // Filtro por Categoría/Tipo -- se aplica aquí (client-side) porque
  // stock_entradas no tiene esas columnas directamente, solo id_articulo.
  if (categoriaVal || tipoVal) {
    entradas = entradas.filter(function(en){ return itemsMap[en.id_articulo] !== undefined; });
  }

  let totalCompras = 0, totalMonto = 0;
  const filas = entradas.map(function(en) {
    const art = itemsMap[en.id_articulo];
    const costoUsd = parseFloat(en.precio_costo_moneda||0);
    const tasaEnt = parseFloat(en.tasa_bcv||1);
    const precioMostrar = monedaVal === 'VES' ? costoUsd * tasaEnt : costoUsd;
    const montoLinea = parseFloat(en.cantidad||0) * precioMostrar;
    totalCompras++;
    totalMonto += montoLinea;
    return {
      fecha: en.fecha_entrada, proveedor: proveedorNombrePorId[en.id_proveedor]||'—',
      articulo: art ? art.nombre_articulo : '(Artículo eliminado)', area: areaNombrePorId[en.id_area]||'',
      cantidad: parseFloat(en.cantidad||0), precio: precioMostrar, montoLinea: montoLinea,
      referencia: 'CPRA-' + en.id_entrada,
      // Recibida = el almacén ya certificó la Entrada de Inventario
      estado: en.certificado_almacen ? 'Recibida' : 'Por Recibir'
    };
  });

  document.getElementById('rep-com-total-compras').textContent = totalCompras.toLocaleString('es-VE');
  document.getElementById('rep-com-total-monto').textContent = (monedaVal==='VES' ? fmtBs(totalMonto) + ' Bs' : '$ ' + fmtUSD(totalMonto));

  const filtrosActivos = [];
  if (areaVal) filtrosActivos.push('Área: ' + (areaNombrePorId[areaVal]||areaVal));
  if (categoriaVal) { const c = categorias.find(function(x){ return String(x.id_categoria)===String(categoriaVal); }); if (c) filtrosActivos.push('Categoría: ' + c.nombre); }
  if (tipoVal) { const t = tipos.find(function(x){ return String(x.id_tipo)===String(tipoVal); }); if (t) filtrosActivos.push('Tipo: ' + t.nombre); }
  if (proveedorVal) filtrosActivos.push('Proveedor: ' + (proveedorNombrePorId[proveedorVal]||proveedorVal));
  const filtrosTexto = filtrosActivos.length ? filtrosActivos.join('   |   ') : 'Sin filtros adicionales (todos los Artículos, todas las Áreas)';

  window._reporteComprasActual = { monedaVal, desdeVal, hastaVal, filas, filtrosTexto };
  _repComOrdenCol = _repComOrdenCol || null;
  _repComOrdenAsc = _repComOrdenAsc !== false;
  _repComRenderTabla();
}

let _repComOrdenCol = null;
let _repComOrdenAsc = true;
const REP_COM_COLUMNAS = [
  { campo: 'fecha',       tipo: 'texto',  label: 'Fecha Compra', ancho: '12%' },
  { campo: 'referencia',  tipo: 'texto',  label: 'Referencia',   ancho: '11%' },
  { campo: 'proveedor',   tipo: 'texto',  label: 'Proveedor',    ancho: '20%' },
  { campo: 'articulo',    tipo: 'texto',  label: 'Artículo',     ancho: '20%' },
  { campo: 'cantidad',    tipo: 'numero', label: 'Cantidad',     ancho: '10%' },
  { campo: 'precio',      tipo: 'numero', label: 'Precio',       ancho: '14%' },
  { campo: 'estado',      tipo: 'texto',  label: 'Estado',       ancho: '13%' },
];

function repComprasOrdenar(campo) {
  if (_repComOrdenCol === campo) { _repComOrdenAsc = !_repComOrdenAsc; }
  else { _repComOrdenCol = campo; _repComOrdenAsc = true; }
  _repComRenderTabla();
}

function _repComRenderTabla() {
  const d = window._reporteComprasActual;
  if (!d) return;
  const monedaVal = d.monedaVal;

  const theadRow = REP_COM_COLUMNAS.map(function(c) {
    const alinear = (c.tipo === 'numero') ? 'text-align:right' : (c.campo === 'estado' ? 'text-align:center' : 'text-align:left');
    const flecha = _repComOrdenCol === c.campo ? (_repComOrdenAsc ? ' ▲' : ' ▼') : '';
    return '<th style="width:'+c.ancho+';'+alinear+';cursor:pointer;user-select:none" onclick="repComprasOrdenar(\''+c.campo+'\')" title="Ordenar">' + c.label + flecha + '</th>';
  }).join('');
  const theadEl = document.getElementById('rep-com-thead-row');
  if (theadEl) theadEl.innerHTML = theadRow;

  let filasOrd = d.filas.slice();
  if (_repComOrdenCol) {
    const colDef = REP_COM_COLUMNAS.find(function(c){ return c.campo === _repComOrdenCol; });
    filasOrd.sort(function(a, b) {
      let va = a[_repComOrdenCol], vb = b[_repComOrdenCol];
      let cmp = colDef.tipo === 'texto' ? String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' }) : va - vb;
      return _repComOrdenAsc ? cmp : -cmp;
    });
  }

  const filasHtml = filasOrd.map(function(f) {
    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:15px">' + fmtFecha(f.fecha) + '</td>'
      + '<td style="font-family:var(--font-mono);font-size:13px;color:var(--suave)">' + escapeHtml(f.referencia) + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.proveedor) + (f.area ? '<div style="font-size:11px;color:var(--suave)">' + escapeHtml(f.area) + '</div>' : '') + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.articulo) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.cantidad + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (monedaVal==='VES' ? fmtBs(f.precio) : fmtUSD(f.precio)) + '</td>'
      + '<td style="text-align:center"><span class="badge ' + (f.estado === 'Recibida' ? 'badge-verde' : 'badge-naranja') + '">' + f.estado + '</span></td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-com-tbody').innerHTML = filasHtml || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">No hay Compras en el rango seleccionado</td></tr>';
}

async function repComprasExportar() {
  await repComprasRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-com-formato')?.value || 'pdf';
  if (formato === 'excel') _repComExportarExcel();
  else if (formato === 'pdf') _repComExportarPDF();
  else _repComExportarCSV();
}

function _repComDatosExportar() {
  const d = window._reporteComprasActual;
  if (!d) return null;
  const encabezados = ['Fecha Compra','Referencia','Proveedor','Artículo','Cantidad','Precio','Estado'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filasNumericas = d.filas.map(function(f) {
    return [fmtFecha(f.fecha), f.referencia, f.proveedor, f.articulo, f.cantidad, f.precio, f.estado];
  });
  const filasTexto = d.filas.map(function(f) {
    return [fmtFecha(f.fecha), f.referencia, f.proveedor, f.articulo, f.cantidad, fmtMoneda(f.precio), f.estado];
  });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repComExportarCSV() {
  const dat = _repComDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Compras del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_compras_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repComExportarExcel() {
  const dat = _repComDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 4, FILA_DATOS_DESDE = 5;
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Reporte de Compras'],
    ['Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasNumericas));
  hoja['!cols'] = [ {wch:14}, {wch:12}, {wch:26}, {wch:32}, {wch:12}, {wch:16}, {wch:14} ];
  const NUM_FILAS = dat.filasNumericas.length;
  for (let col = 0; col < 7; col++) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
    if (col < 4 || col === 6) continue; // Fecha/Referencia/Proveedor/Artículo/Estado: texto
    const formatoNum = col === 5 ? '#,##0.00' : '#,##0';
    for (let i = 0; i < NUM_FILAS; i++) {
      const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: col });
      if (hoja[ref]) { hoja[ref].z = formatoNum; hoja[ref].t = 'n'; hoja[ref].s = { alignment: { horizontal: 'right' } }; }
    }
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Compras');
  XLSX.writeFile(libro, 'reporte_compras_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.xlsx', { cellStyles: true });
}

function _repComExportarPDF() {
  const dat = _repComDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Reporte de Compras', 14, 15);
  doc.setFontSize(9);
  doc.text('Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal, 14, 21);
  doc.text('Filtros: ' + dat.d.filtrosTexto, 14, 26);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 31,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' } },
  });
  doc.save('reporte_compras_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.pdf');
}

// ═══════════════════ REPORTE DE VENTAS ═══════════════════
function repVentasLimpiarFiltros() {
  const hoy = getHoyVzla();
  const desde = document.getElementById('rep-ven-desde'); if (desde) desde.value = hoy;
  const hasta = document.getElementById('rep-ven-hasta'); if (hasta) hasta.value = hoy;
  const moneda = document.getElementById('rep-ven-moneda'); if (moneda) moneda.value = 'VES';
  const area = document.getElementById('rep-ven-area'); if (area) area.value = '';
  const categoria = document.getElementById('rep-ven-categoria'); if (categoria) categoria.value = '';
  const tipo = document.getElementById('rep-ven-tipo'); if (tipo) tipo.value = '';
  const cliente = document.getElementById('rep-ven-cliente'); if (cliente) cliente.value = '';
  const formaPago = document.getElementById('rep-ven-forma-pago'); if (formaPago) formaPago.value = '';
  repVentasRender(document.getElementById('reportes-contenido'));
}

async function repVentasRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-ven-desde')?.value || hoy;
  const hastaVal = document.getElementById('rep-ven-hasta')?.value || hoy;
  const monedaVal = document.getElementById('rep-ven-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-ven-formato')?.value || 'pdf';
  const areaVal = document.getElementById('rep-ven-area')?.value || '';
  const categoriaVal = document.getElementById('rep-ven-categoria')?.value || '';
  const tipoVal = document.getElementById('rep-ven-tipo')?.value || '';
  const clienteVal = document.getElementById('rep-ven-cliente')?.value || '';
  const formaPagoVal = document.getElementById('rep-ven-forma-pago')?.value || '';

  let areas = [], categorias = [], tipos = [], clientes = [], formasPago = [];
  try {
    formasPago = await api('param_tipos_pago','GET',null, '?estado=eq.ACTIVO&select=id_tipo,nombre&order=nombre.asc');
    formasPago = [...new Map(formasPago.map(function(m){ return [m.nombre, m]; })).values()]; // deduplicar (un mismo Nombre puede repetirse por Moneda)
  } catch(e) { console.warn('Error cargando Formas de Pago:', e); }
  try {
    areas = await api('param_areas','GET',null, '?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
    // Solo Áreas de Ventas -- códigos del grupo 5000 y 6000
    areas = areas.filter(function(a) {
      const cod = parseInt(a.codigo, 10);
      return cod >= 5000 && cod < 7000;
    });
  } catch(e) { console.warn('Error cargando Áreas:', e); }
  try {
    categorias = await api('inv_categorias','GET',null,
      '?select=id_categoria,nombre&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(e) { console.warn('Error cargando Categorías:', e); }
  try {
    tipos = await api('inv_articulos_tipo','GET',null,
      '?select=id_tipo,nombre&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(e) { console.warn('Error cargando Tipos de Artículo:', e); }
  try {
    clientes = await rpc('obtener_clientes_activos', {}) || [];
  } catch(e) { console.warn('Error cargando Clientes:', e); }

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-ven-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-ven-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-ven-moneda" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + ((_monedasCache && _monedasCache.length) ? _monedasCache.map(function(m){ return '<option value="'+m.codigo+'"' + (monedaVal===m.codigo?' selected':'') + '>'+m.codigo+'</option>'; }).join('') : '<option value="VES">VES</option><option value="USD">USD</option>')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;height:35px;box-sizing:border-box">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-ven-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repVentasExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Área</label>'
    + '<select id="rep-ven-area" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (areaVal===''?' selected':'') + '>Todas las Áreas</option>'
    + areas.map(function(a){ return '<option value="'+a.id+'"' + (String(areaVal)===String(a.id)?' selected':'') + '>' + escapeHtml(a.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Categoría</label>'
    + '<select id="rep-ven-categoria" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (categoriaVal===''?' selected':'') + '>Todas</option>'
    + categorias.map(function(c){ return '<option value="'+c.id_categoria+'"' + (String(categoriaVal)===String(c.id_categoria)?' selected':'') + '>' + escapeHtml(c.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Tipo de Artículo</label>'
    + '<select id="rep-ven-tipo" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (tipoVal===''?' selected':'') + '>Todos</option>'
    + tipos.map(function(t){ return '<option value="'+t.id_tipo+'"' + (String(tipoVal)===String(t.id_tipo)?' selected':'') + '>' + escapeHtml(t.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Cliente</label>'
    + '<select id="rep-ven-cliente" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (clienteVal===''?' selected':'') + '>Todos</option>'
    + clientes.map(function(c){ return '<option value="'+c.id_cliente+'"' + (String(clienteVal)===String(c.id_cliente)?' selected':'') + '>' + escapeHtml(c.nombre_completo) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Forma de Pago</label>'
    + '<select id="rep-ven-forma-pago" onchange="repVentasRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (formaPagoVal===''?' selected':'') + '>Todas</option>'
    + formasPago.map(function(m){ return '<option value="'+escapeHtml(m.nombre)+'"' + (formaPagoVal===m.nombre?' selected':'') + '>' + escapeHtml(m.nombre) + '</option>'; }).join('')
    + '<option value="Pendiente de cobro"' + (formaPagoVal==='Pendiente de cobro'?' selected':'') + '>Pendiente de cobro</option>'
    + '</select></div>'
    + '<button onclick="repVentasLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div id="rep-ven-resumen" style="display:flex;gap:16px;margin-bottom:20px">'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Ventas</div>'
    + '<div id="rep-ven-total-ventas" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Monto Total</div>'
    + '<div id="rep-ven-total-monto" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Devoluciones (Notas de Crédito)</div>'
    + '<div id="rep-ven-devol" style="font-family:var(--font-display);font-size:18px;color:#e53e3e">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Ventas Netas</div>'
    + '<div id="rep-ven-neto" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="min-width:900px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr id="rep-ven-thead-row"></tr></thead>'
    + '<tbody id="rep-ven-tbody"><tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px">Cargando...</td></tr></tbody>'
    + '</table></div>'
    + '</div>';

  let itemsMap = {};
  try {
    let qItems = '?estado=eq.ACTIVO&select=id_articulo,nombre_articulo,id_categoria_articulo,id_tipo_articulo' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    if (categoriaVal) qItems += '&id_categoria_articulo=eq.'+categoriaVal;
    if (tipoVal) qItems += '&id_tipo_articulo=eq.'+tipoVal;
    const itemsRows = await api('inventario_almacen','GET',null, qItems);
    (itemsRows||[]).forEach(function(a){ itemsMap[a.id_articulo] = a; });
  } catch(e) { console.warn('Error cargando Artículos:', e); }

  const clienteNombrePorId = {};
  clientes.forEach(function(c){ clienteNombrePorId[c.id_cliente] = c.nombre_completo; });
  const areaNombrePorId = {};
  areas.forEach(function(a){ areaNombrePorId[a.id] = a.nombre + (a.codigo ? ' (' + a.codigo + ')' : ''); });

  // Cabecera de la Venta (fecha, cliente, área, moneda de cobro, estado,
  // tasa, factura) -- luego se cruza con venta_detalle para las líneas por
  // Artículo, y con cont_cxc (por id_factura) para la Forma de Pago real
  // (Efectivo/Transferencia/Pago Móvil, etc.) con la que se cobró.
  let ventasHead = {};
  try {
    let qVen = '?estado=eq.FACTURADA&fecha_venta=gte.'+desdeVal+'&fecha_venta=lte.'+hastaVal
      + '&select=id_venta,fecha_venta,id_cliente,id_area,moneda_cobro,estado,tasa_bcv,id_factura,entregado,facturas(numero_factura)'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    if (areaVal) qVen += '&id_area=eq.'+areaVal;
    if (clienteVal) qVen += '&id_cliente=eq.'+clienteVal;
    const ventasRows = await api('ventas','GET',null, qVen);
    (ventasRows||[]).forEach(function(v){ ventasHead[v.id_venta] = v; });
  } catch(e) { console.warn('Error cargando Ventas:', e); }

  const idsFactura = Object.values(ventasHead).map(function(v){ return v.id_factura; }).filter(Boolean);
  let metodoPorFactura = {};
  if (idsFactura.length) {
    try {
      const cxcRows = await api('cont_cxc','GET',null,
        '?id_factura=in.(' + idsFactura.join(',') + ')&select=id_factura,metodo_pago');
      (cxcRows||[]).forEach(function(c){ if (c.metodo_pago) metodoPorFactura[c.id_factura] = c.metodo_pago; });
    } catch(e) { console.warn('Error cargando Forma de Pago (cont_cxc):', e); }
  }

  let detalle = [];
  const idsVenta = Object.keys(ventasHead);
  if (idsVenta.length) {
    try {
      detalle = await api('venta_detalle','GET',null,
        '?id_venta=in.(' + idsVenta.join(',') + ')&select=id_venta,id_articulo,cantidad,precio_unitario');
    } catch(e) { console.warn('Error cargando Detalle de Ventas:', e); }
  }

  if (categoriaVal || tipoVal) {
    detalle = detalle.filter(function(d){ return itemsMap[d.id_articulo] !== undefined; });
  }

  let filas = detalle.map(function(d) {
    const v = ventasHead[d.id_venta];
    const art = itemsMap[d.id_articulo];
    const precioUsd = parseFloat(d.precio_unitario||0);
    const tasaVen = parseFloat(v?.tasa_bcv||1);
    const precioMostrar = monedaVal === 'VES' ? precioUsd * tasaVen : precioUsd;
    const montoLinea = parseFloat(d.cantidad||0) * precioMostrar;
    return {
      idVenta: 'V'+d.id_venta, fecha: v?.fecha_venta, cliente: clienteNombrePorId[v?.id_cliente]||'—',
      articulo: art ? art.nombre_articulo : '(Artículo eliminado)', area: areaNombrePorId[v?.id_area]||'—',
      cantidad: parseFloat(d.cantidad||0), precio: precioMostrar, montoLinea: montoLinea,
      pago: v?.id_factura && metodoPorFactura[v.id_factura] ? metodoPorFactura[v.id_factura] : 'Pendiente de cobro',
      referencia: v?.facturas?.numero_factura || '',
      // Entregada = el almacén confirmó la entrega en "Salida por Ventas"
      estado: v?.entregado ? 'Entregada' : 'Por Entregar',
      origen: 'Venta directa'
    };
  });

  // Artículos vendidos a través de una Orden de Servicio (os_mercancias) --
  // son también "ventas" de mercancía, solo que canalizadas por Taller en
  // vez de mostrador. Se combinan aquí para que el Reporte de Ventas dé el
  // total real de lo vendido, sin importar por cuál Área se despachó.
  try {
    let qOrd = '?estado=neq.ANULADA&fecha_entrada=gte.'+desdeVal+'&fecha_entrada=lte.'+hastaVal
      + '&select=id_orden,fecha_entrada,id_cliente,id_area,tasa_bcv';
    if (areaVal) qOrd += '&id_area=eq.'+areaVal;
    if (clienteVal) qOrd += '&id_cliente=eq.'+clienteVal;
    const ordenesRows = await api('ordenes_servicio','GET',null, qOrd);
    const ordenesHead = {};
    (ordenesRows||[]).forEach(function(o){ ordenesHead[o.id_orden] = o; });

    const idsOrden = Object.keys(ordenesHead);
    let mercRows = [];
    if (idsOrden.length) {
      mercRows = await api('os_mercancias','GET',null,
        '?id_orden=in.(' + idsOrden.join(',') + ')&select=id_orden,id_articulo,cantidad,precio_usd');
    }
    if (categoriaVal || tipoVal) {
      mercRows = mercRows.filter(function(m){ return itemsMap[m.id_articulo] !== undefined; });
    }

    // El vínculo con la Factura es al revés: facturas.id_orden -> aquí, no
    // una columna id_factura en ordenes_servicio (esa no existe).
    let idFacturaPorOrden = {};
    let numeroFacturaPorOrdenVta = {};
    if (idsOrden.length) {
      const facRowsOS = await api('facturas','GET',null,
        '?id_orden=in.(' + idsOrden.join(',') + ')&estado=not.in.(ANULADA,REVERSADA,ACREDITADA_TOTAL,BORRADOR,POR_APROBAR)&select=id_factura,id_orden,numero_factura');
      (facRowsOS||[]).forEach(function(f){ idFacturaPorOrden[f.id_orden] = f.id_factura; numeroFacturaPorOrdenVta[f.id_orden] = f.numero_factura; });
    }
    // Solo cuenta como "Venta" lo ya Facturado -- lo que sigue en Taller
    // sin facturar todavía no es una venta confirmada.
    mercRows = mercRows.filter(function(m){ return !!idFacturaPorOrden[m.id_orden]; });

    const idsFacturaOS = Object.values(idFacturaPorOrden);
    let metodoPorFacturaOS = {};
    if (idsFacturaOS.length) {
      const cxcRowsOS = await api('cont_cxc','GET',null,
        '?id_factura=in.(' + idsFacturaOS.join(',') + ')&select=id_factura,metodo_pago');
      (cxcRowsOS||[]).forEach(function(c){ if (c.metodo_pago) metodoPorFacturaOS[c.id_factura] = c.metodo_pago; });
    }

    const filasOS = mercRows.map(function(m) {
      const o = ordenesHead[m.id_orden];
      const art = itemsMap[m.id_articulo];
      const precioUsd = parseFloat(m.precio_usd||0);
      const tasaOS = parseFloat(o?.tasa_bcv||1);
      const precioMostrar = monedaVal === 'VES' ? precioUsd * tasaOS : precioUsd;
      const montoLinea = parseFloat(m.cantidad||0) * precioMostrar;
      const idFacturaDeEstaOS = idFacturaPorOrden[m.id_orden];
      return {
        idVenta: 'OS'+m.id_orden, fecha: o?.fecha_entrada, cliente: clienteNombrePorId[o?.id_cliente]||'—',
        articulo: art ? art.nombre_articulo : '(Artículo eliminado)', area: areaNombrePorId[o?.id_area]||'—',
        cantidad: parseFloat(m.cantidad||0), precio: precioMostrar, montoLinea: montoLinea,
        pago: idFacturaDeEstaOS && metodoPorFacturaOS[idFacturaDeEstaOS] ? metodoPorFacturaOS[idFacturaDeEstaOS] : 'Pendiente de cobro',
        referencia: numeroFacturaPorOrdenVta[m.id_orden] || '',
        // Vía OS: el artículo se instaló en el vehículo durante el servicio
        estado: 'Entregada',
        origen: 'Vía OS'
      };
    });
    filas = filas.concat(filasOS);
  } catch(eOS) { console.warn('Error cargando Artículos vendidos vía OS:', eOS); }

  if (formaPagoVal) filas = filas.filter(function(f){ return f.pago === formaPagoVal; });

  let totalVentasSet = new Set(), totalMonto = 0;
  filas.forEach(function(f){ totalVentasSet.add(f.idVenta); totalMonto += f.montoLinea; });

  document.getElementById('rep-ven-total-ventas').textContent = totalVentasSet.size.toLocaleString('es-VE');
  document.getElementById('rep-ven-total-monto').textContent = (monedaVal==='VES' ? fmtBs(totalMonto) + ' Bs' : '$ ' + fmtUSD(totalMonto));

  // Devoluciones de mercancía por Nota de Crédito aprobada en el período.
  // Solo tipo DEVOLUCION: el reverso y el error en la factura devuelven la
  // Venta a Presupuesto (ya no aparece arriba), así que restarlos de nuevo
  // los contaría dos veces. Mismo criterio para la OS acreditada total
  // (sus artículos ya quedan fuera del reporte).
  let totalDevol = 0;
  try {
    let qNC = '?estado=eq.APROBADA&tipo=eq.DEVOLUCION&fecha_emision=gte.'+desdeVal+'&fecha_emision=lte.'+hastaVal
      + '&select=id_nc,tasa_bcv,id_cliente,facturas(estado,id_orden),notas_credito_detalle(origen,id_articulo,cantidad,subtotal_usd)'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    if (clienteVal) qNC += '&id_cliente=eq.'+clienteVal;
    const ncsDev = await api('notas_credito','GET',null, qNC) || [];
    ncsDev.forEach(function(n) {
      const fac = n.facturas || {};
      (n.notas_credito_detalle || []).forEach(function(l) {
        if (l.origen !== 'VENTA_DETALLE' && l.origen !== 'OS_MERCANCIA') return;
        if (l.origen === 'OS_MERCANCIA' && fac.estado === 'ACREDITADA_TOTAL') return;
        if ((categoriaVal || tipoVal) && itemsMap[l.id_articulo] === undefined) return;
        const usd = parseFloat(l.subtotal_usd || 0);
        totalDevol += monedaVal === 'VES' ? usd * parseFloat(n.tasa_bcv || 1) : usd;
      });
    });
  } catch(eDev) { console.warn('Error cargando Devoluciones (NC):', eDev); }
  const fmtMon = function(v) { return monedaVal==='VES' ? fmtBs(v) + ' Bs' : '$ ' + fmtUSD(v); };
  const devolTexto = (areaVal || formaPagoVal) ? 'n/d' : (totalDevol > 0 ? '- ' : '') + fmtMon(totalDevol);
  const netoTexto = (areaVal || formaPagoVal) ? 'n/d' : fmtMon(totalMonto - totalDevol);
  document.getElementById('rep-ven-devol').textContent = devolTexto;
  document.getElementById('rep-ven-neto').textContent = netoTexto;

  const filtrosActivos = [];
  if (areaVal) filtrosActivos.push('Área: ' + (areaNombrePorId[areaVal]||areaVal));
  if (categoriaVal) { const c = categorias.find(function(x){ return String(x.id_categoria)===String(categoriaVal); }); if (c) filtrosActivos.push('Categoría: ' + c.nombre); }
  if (tipoVal) { const t = tipos.find(function(x){ return String(x.id_tipo)===String(tipoVal); }); if (t) filtrosActivos.push('Tipo: ' + t.nombre); }
  if (clienteVal) filtrosActivos.push('Cliente: ' + (clienteNombrePorId[clienteVal]||clienteVal));
  if (formaPagoVal) filtrosActivos.push('Forma de Pago: ' + formaPagoVal);
  const filtrosTexto = filtrosActivos.length ? filtrosActivos.join('   |   ') : 'Sin filtros adicionales (todos los Artículos, todas las Áreas)';

  window._reporteVentasActual = { monedaVal, desdeVal, hastaVal, filas, filtrosTexto,
    resumenNC: 'Ventas: ' + fmtMon(totalMonto) + '   |   Devoluciones (NC): ' + devolTexto + '   |   Ventas Netas: ' + netoTexto };
  _repVenOrdenCol = _repVenOrdenCol || null;
  _repVenOrdenAsc = _repVenOrdenAsc !== false;
  _repVenRenderTabla();
}

let _repVenOrdenCol = null;
let _repVenOrdenAsc = true;
const REP_VEN_COLUMNAS = [
  { campo: 'fecha',       tipo: 'texto',  label: 'Fecha Venta', ancho: '10%' },
  { campo: 'cliente',     tipo: 'texto',  label: 'Cliente',     ancho: '15%' },
  { campo: 'articulo',    tipo: 'texto',  label: 'Artículo',    ancho: '15%' },
  { campo: 'area',        tipo: 'texto',  label: 'Área',        ancho: '12%' },
  { campo: 'cantidad',    tipo: 'numero', label: 'Cantidad',    ancho: '7%' },
  { campo: 'precio',      tipo: 'numero', label: 'Precio',      ancho: '11%' },
  { campo: 'referencia',  tipo: 'texto',  label: 'Factura',     ancho: '10%' },
  { campo: 'pago',        tipo: 'texto',  label: 'Pago',        ancho: '10%' },
  { campo: 'estado',      tipo: 'texto',  label: 'Estado',      ancho: '10%' },
];

function repVentasOrdenar(campo) {
  if (_repVenOrdenCol === campo) { _repVenOrdenAsc = !_repVenOrdenAsc; }
  else { _repVenOrdenCol = campo; _repVenOrdenAsc = true; }
  _repVenRenderTabla();
}

function _repVenRenderTabla() {
  const d = window._reporteVentasActual;
  if (!d) return;
  const monedaVal = d.monedaVal;

  const theadRow = REP_VEN_COLUMNAS.map(function(c) {
    const alinear = (c.tipo === 'numero') ? 'text-align:right' : ((c.campo === 'pago' || c.campo === 'estado') ? 'text-align:center' : 'text-align:left');
    const flecha = _repVenOrdenCol === c.campo ? (_repVenOrdenAsc ? ' ▲' : ' ▼') : '';
    return '<th style="width:'+c.ancho+';'+alinear+';cursor:pointer;user-select:none" onclick="repVentasOrdenar(\''+c.campo+'\')" title="Ordenar">' + c.label + flecha + '</th>';
  }).join('');
  const theadEl = document.getElementById('rep-ven-thead-row');
  if (theadEl) theadEl.innerHTML = theadRow;

  let filasOrd = d.filas.slice();
  if (_repVenOrdenCol) {
    const colDef = REP_VEN_COLUMNAS.find(function(c){ return c.campo === _repVenOrdenCol; });
    filasOrd.sort(function(a, b) {
      let va = a[_repVenOrdenCol], vb = b[_repVenOrdenCol];
      let cmp = colDef.tipo === 'texto' ? String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' }) : va - vb;
      return _repVenOrdenAsc ? cmp : -cmp;
    });
  }

  const filasHtml = filasOrd.map(function(f) {
    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:15px">' + fmtFecha(f.fecha) + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.cliente) + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.articulo) + '</td>'
      + '<td style="font-size:13px;color:var(--suave)">' + escapeHtml(f.area) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.cantidad + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (monedaVal==='VES' ? fmtBs(f.precio) : fmtUSD(f.precio)) + '</td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-size:13px;color:var(--suave)">' + escapeHtml(f.referencia || '—') + '</td>'
      + '<td style="text-align:center;font-size:13px;color:var(--suave)">' + escapeHtml(f.pago) + '</td>'
      + '<td style="text-align:center"><span class="badge ' + (f.estado === 'Entregada' ? 'badge-verde' : 'badge-naranja') + '">' + f.estado + '</span></td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-ven-tbody').innerHTML = filasHtml || '<tr><td colspan="9" style="text-align:center;color:var(--suave);padding:32px">No hay Ventas en el rango seleccionado</td></tr>';
}

async function repVentasExportar() {
  await repVentasRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-ven-formato')?.value || 'pdf';
  if (formato === 'excel') _repVenExportarExcel();
  else if (formato === 'pdf') _repVenExportarPDF();
  else _repVenExportarCSV();
}

function _repVenDatosExportar() {
  const d = window._reporteVentasActual;
  if (!d) return null;
  const encabezados = ['Fecha Venta','Cliente','Artículo','Área','Cantidad','Precio','Factura','Pago','Estado'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filasNumericas = d.filas.map(function(f) {
    return [fmtFecha(f.fecha), f.cliente, f.articulo, f.area, f.cantidad, f.precio, f.referencia, f.pago, f.estado];
  });
  const filasTexto = d.filas.map(function(f) {
    return [fmtFecha(f.fecha), f.cliente, f.articulo, f.area, f.cantidad, fmtMoneda(f.precio), f.referencia, f.pago, f.estado];
  });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repVenExportarCSV() {
  const dat = _repVenDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Ventas del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [dat.d.resumenNC || ''],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_ventas_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repVenExportarExcel() {
  const dat = _repVenDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 4, FILA_DATOS_DESDE = 5;
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Reporte de Ventas'],
    ['Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [dat.d.resumenNC || ''],
    dat.encabezados,
  ].concat(dat.filasNumericas));
  hoja['!cols'] = [ {wch:14}, {wch:26}, {wch:30}, {wch:20}, {wch:12}, {wch:16}, {wch:14}, {wch:18}, {wch:14} ];
  const NUM_FILAS = dat.filasNumericas.length;
  for (let col = 0; col < 9; col++) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
    if (col === 4 || col === 5) {
      const formatoNum = col === 5 ? '#,##0.00' : '#,##0';
      for (let i = 0; i < NUM_FILAS; i++) {
        const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: col });
        if (hoja[ref]) { hoja[ref].z = formatoNum; hoja[ref].t = 'n'; hoja[ref].s = { alignment: { horizontal: 'right' } }; }
      }
    }
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Ventas');
  XLSX.writeFile(libro, 'reporte_ventas_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.xlsx', { cellStyles: true });
}

function _repVenExportarPDF() {
  const dat = _repVenDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Reporte de Ventas', 14, 15);
  doc.setFontSize(9);
  doc.text('Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal, 14, 21);
  doc.text('Filtros: ' + dat.d.filtrosTexto, 14, 26);
  doc.text(dat.d.resumenNC || '', 14, 31);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 36,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 7: { halign: 'center' }, 8: { halign: 'center' } },
  });
  doc.save('reporte_ventas_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.pdf');
}

// ═══════════════════ REPORTE POR SERVICIOS ═══════════════════
// Fuente: os_servicios (líneas de servicio de cada Orden), cruzado con
// ordenes_servicio (fecha/cliente/vehículo), vehiculos (marca/modelo/
// carrocería) y servicios_catalogo (grupo/nombre). La Forma de Pago sale
// igual que en Ventas: ordenes_servicio → facturas (por id_orden) →
// cont_cxc (por id_factura) → metodo_pago.
function repServiciosLimpiarFiltros() {
  const hoy = getHoyVzla();
  const desde = document.getElementById('rep-ser-desde'); if (desde) desde.value = hoy;
  const hasta = document.getElementById('rep-ser-hasta'); if (hasta) hasta.value = hoy;
  const moneda = document.getElementById('rep-ser-moneda'); if (moneda) moneda.value = 'VES';
  const grupo = document.getElementById('rep-ser-grupo'); if (grupo) grupo.value = '';
  const servicio = document.getElementById('rep-ser-servicio'); if (servicio) servicio.value = '';
  const carroceria = document.getElementById('rep-ser-carroceria'); if (carroceria) carroceria.value = '';
  const marca = document.getElementById('rep-ser-marca'); if (marca) marca.value = '';
  const modelo = document.getElementById('rep-ser-modelo'); if (modelo) modelo.value = '';
  const formaPago = document.getElementById('rep-ser-forma-pago'); if (formaPago) formaPago.value = '';
  repServiciosRender(document.getElementById('reportes-contenido'));
}

async function repServiciosRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-ser-desde')?.value || hoy;
  const hastaVal = document.getElementById('rep-ser-hasta')?.value || hoy;
  const monedaVal = document.getElementById('rep-ser-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-ser-formato')?.value || 'pdf';
  const grupoVal = document.getElementById('rep-ser-grupo')?.value || '';
  const servicioVal = document.getElementById('rep-ser-servicio')?.value || '';
  const carroceriaVal = document.getElementById('rep-ser-carroceria')?.value || '';
  const marcaVal = document.getElementById('rep-ser-marca')?.value || '';
  const modeloVal = document.getElementById('rep-ser-modelo')?.value || '';
  const formaPagoVal = document.getElementById('rep-ser-forma-pago')?.value || '';

  let catalogo = [], carrocerias = [], marcas = [], modelos = [], formasPago = [];
  try {
    formasPago = await api('param_tipos_pago','GET',null, '?estado=eq.ACTIVO&select=id_tipo,nombre&order=nombre.asc');
    formasPago = [...new Map(formasPago.map(function(m){ return [m.nombre, m]; })).values()]; // deduplicar (un mismo Nombre puede repetirse por Moneda)
  } catch(e) { console.warn('Error cargando Formas de Pago:', e); }
  try {
    catalogo = await api('servicios_catalogo','GET',null,
      '?activo=eq.true&select=id_servicio,nombre,grupo&order=grupo.asc,nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(e) { console.warn('Error cargando Catálogo de Servicios:', e); }
  try {
    const vehRows = await api('vehiculos','GET',null, '?activo=eq.true&select=tipo_carroceria,marca,modelo');
    carrocerias = [...new Set((vehRows||[]).map(function(v){ return v.tipo_carroceria; }).filter(Boolean))].sort();
    marcas = [...new Set((vehRows||[]).map(function(v){ return v.marca; }).filter(Boolean))].sort();
    modelos = [...new Set((vehRows||[])
      .filter(function(v){ return !marcaVal || v.marca === marcaVal; })
      .map(function(v){ return v.modelo; }).filter(Boolean))].sort();
  } catch(e) { console.warn('Error cargando Vehículos:', e); }

  const gruposUnicos = [...new Set(catalogo.map(function(s){ return s.grupo; }).filter(Boolean))].sort();
  const serviciosDelGrupo = grupoVal ? catalogo.filter(function(s){ return s.grupo === grupoVal; }) : catalogo;

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-ser-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-ser-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-ser-moneda" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + ((_monedasCache && _monedasCache.length) ? _monedasCache.map(function(m){ return '<option value="'+m.codigo+'"' + (monedaVal===m.codigo?' selected':'') + '>'+m.codigo+'</option>'; }).join('') : '<option value="VES">VES</option><option value="USD">USD</option>')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:8px 14px;border-radius:5px;cursor:pointer;font-size:13px;height:35px;box-sizing:border-box">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-ser-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repServiciosExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Grupo</label>'
    + '<select id="rep-ser-grupo" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (grupoVal===''?' selected':'') + '>Todos</option>'
    + gruposUnicos.map(function(g){ return '<option value="'+escapeHtml(g)+'"' + (grupoVal===g?' selected':'') + '>' + escapeHtml(g) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Servicio</label>'
    + '<select id="rep-ser-servicio" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (servicioVal===''?' selected':'') + '>Todos</option>'
    + serviciosDelGrupo.map(function(s){ return '<option value="'+s.id_servicio+'"' + (String(servicioVal)===String(s.id_servicio)?' selected':'') + '>' + escapeHtml(s.nombre) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Carrocería</label>'
    + '<select id="rep-ser-carroceria" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (carroceriaVal===''?' selected':'') + '>Todas</option>'
    + carrocerias.map(function(c){ return '<option value="'+escapeHtml(c)+'"' + (carroceriaVal===c?' selected':'') + '>' + escapeHtml(c) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Marca</label>'
    + '<select id="rep-ser-marca" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (marcaVal===''?' selected':'') + '>Todas</option>'
    + marcas.map(function(m){ return '<option value="'+escapeHtml(m)+'"' + (marcaVal===m?' selected':'') + '>' + escapeHtml(m) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Modelo</label>'
    + '<select id="rep-ser-modelo" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (modeloVal===''?' selected':'') + '>Todos</option>'
    + modelos.map(function(m){ return '<option value="'+escapeHtml(m)+'"' + (modeloVal===m?' selected':'') + '>' + escapeHtml(m) + '</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Forma de Pago</label>'
    + '<select id="rep-ser-forma-pago" onchange="repServiciosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value=""' + (formaPagoVal===''?' selected':'') + '>Todas</option>'
    + formasPago.map(function(m){ return '<option value="'+escapeHtml(m.nombre)+'"' + (formaPagoVal===m.nombre?' selected':'') + '>' + escapeHtml(m.nombre) + '</option>'; }).join('')
    + '<option value="Pendiente de cobro"' + (formaPagoVal==='Pendiente de cobro'?' selected':'') + '>Pendiente de cobro</option>'
    + '</select></div>'
    + '<button onclick="repServiciosLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div id="rep-ser-resumen" style="display:flex;gap:16px;margin-bottom:20px">'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Servicios</div>'
    + '<div id="rep-ser-total-servicios" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Monto Total</div>'
    + '<div id="rep-ser-total-monto" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="min-width:900px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr id="rep-ser-thead-row"></tr></thead>'
    + '<tbody id="rep-ser-tbody"><tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px;white-space:normal">Cargando...</td></tr></tbody>'
    + '</table></div>'
    + '</div>';

  const catalogoPorId = {};
  catalogo.forEach(function(s){ catalogoPorId[s.id_servicio] = s; });

  let ordenesHead = {};
  try {
    let qOrd = '?estado=neq.ANULADA&fecha_entrada=gte.'+desdeVal+'&fecha_entrada=lte.'+hastaVal
      + '&select=id_orden,numero_os,fecha_entrada,id_cliente,id_vehiculo,tasa_bcv,vehiculos(placa,marca,modelo,tipo_carroceria)'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '');
    const ordenesRows = await api('ordenes_servicio','GET',null, qOrd);
    (ordenesRows||[]).forEach(function(o){
      const veh = o.vehiculos;
      if (marcaVal && (!veh || veh.marca !== marcaVal)) return;
      if (modeloVal && (!veh || veh.modelo !== modeloVal)) return;
      if (carroceriaVal && (!veh || veh.tipo_carroceria !== carroceriaVal)) return;
      ordenesHead[o.id_orden] = o;
    });
  } catch(e) { console.warn('Error cargando Órdenes de Servicio:', e); }

  // Nombres de Cliente vía RPC (no unión directa con "clientes", bloqueada
  // por RLS para quien tenga REPORTES→VER_SERVICIOS pero no CLIENTES/VENTAS
  // -- el permiso del Reporte debe bastar para ver estos datos agregados).
  const clienteNombrePorIdOS = {};
  try {
    const idsClienteOS = [...new Set(Object.values(ordenesHead).map(function(o){ return o.id_cliente; }).filter(Boolean))];
    if (idsClienteOS.length) {
      const nombresRows = await rpc('obtener_nombres_clientes', { p_ids: idsClienteOS });
      (nombresRows||[]).forEach(function(c){ clienteNombrePorIdOS[c.id_cliente] = c.nombre_completo; });
    }
  } catch(e) { console.warn('Error resolviendo nombres de Clientes:', e); }

  const idsOrden = Object.keys(ordenesHead);
  let lineas = [];
  if (idsOrden.length) {
    try {
      let qSer = '?id_orden=in.(' + idsOrden.join(',') + ')&select=id_orden,id_servicio,descripcion,precio_usd';
      if (servicioVal) qSer += '&id_servicio=eq.'+servicioVal;
      lineas = await api('os_servicios','GET',null, qSer);
    } catch(e) { console.warn('Error cargando líneas de Servicio:', e); }
  }
  if (grupoVal && !servicioVal) {
    lineas = lineas.filter(function(l){ return l.id_servicio && catalogoPorId[l.id_servicio] && catalogoPorId[l.id_servicio].grupo === grupoVal; });
  }

  let idsFacturaOrden = {};
  let numeroFacturaPorOrden = {};
  try {
    const facRows = await api('facturas','GET',null,
      '?id_orden=in.(' + (idsOrden.length ? idsOrden.join(',') : '0') + ')&estado=not.in.(ANULADA,REVERSADA,ACREDITADA_TOTAL,BORRADOR,POR_APROBAR)&select=id_factura,id_orden,numero_factura');
    (facRows||[]).forEach(function(f){ idsFacturaOrden[f.id_orden] = f.id_factura; numeroFacturaPorOrden[f.id_orden] = f.numero_factura; });
  } catch(e) { console.warn('Error cargando Facturas de Servicio:', e); }
  const idsFacturaSer = Object.values(idsFacturaOrden);
  let metodoPorFactura = {};
  if (idsFacturaSer.length) {
    try {
      const cxcRows = await api('cont_cxc','GET',null,
        '?id_factura=in.(' + idsFacturaSer.join(',') + ')&select=id_factura,metodo_pago');
      (cxcRows||[]).forEach(function(c){ if (c.metodo_pago) metodoPorFactura[c.id_factura] = c.metodo_pago; });
    } catch(e) { console.warn('Error cargando Forma de Pago (cont_cxc):', e); }
  }

  let filas = lineas.map(function(l) {
    const o = ordenesHead[l.id_orden];
    const idFact = idsFacturaOrden[l.id_orden];
    const precioUsd = parseFloat(l.precio_usd||0);
    const tasaOrden = parseFloat(o?.tasa_bcv||1);
    const precio = monedaVal === 'VES' ? precioUsd * tasaOrden : precioUsd;
    return {
      fecha: o?.fecha_entrada, numeroOS: o?.numero_os || ('OS-'+l.id_orden),
      cliente: clienteNombrePorIdOS[o?.id_cliente] || '—',
      vehiculo: o?.vehiculos ? (o.vehiculos.placa||'—') : '—',
      vehiculoDesc: o?.vehiculos ? (o.vehiculos.marca||'') + ' ' + (o.vehiculos.modelo||'') : '',
      servicio: l.id_servicio && catalogoPorId[l.id_servicio] ? catalogoPorId[l.id_servicio].nombre : (l.descripcion||'(Servicio libre)'),
      precio: precio,
      pago: idFact && metodoPorFactura[idFact] ? metodoPorFactura[idFact] : 'Pendiente de cobro',
      facturaRef: numeroFacturaPorOrden[l.id_orden] || ''
    };
  });
  if (formaPagoVal) filas = filas.filter(function(f){ return f.pago === formaPagoVal; });

  let totalMonto = 0;
  filas.forEach(function(f){ totalMonto += f.precio; });

  document.getElementById('rep-ser-total-servicios').textContent = filas.length.toLocaleString('es-VE');
  document.getElementById('rep-ser-total-monto').textContent = (monedaVal==='VES' ? fmtBs(totalMonto) + ' Bs' : '$ ' + fmtUSD(totalMonto));

  const filtrosActivos = [];
  if (formaPagoVal) filtrosActivos.push('Forma de Pago: ' + formaPagoVal);
  if (grupoVal) filtrosActivos.push('Grupo: ' + grupoVal);
  if (servicioVal) { const s = catalogo.find(function(x){ return String(x.id_servicio)===String(servicioVal); }); if (s) filtrosActivos.push('Servicio: ' + s.nombre); }
  if (carroceriaVal) filtrosActivos.push('Carrocería: ' + carroceriaVal);
  if (marcaVal) filtrosActivos.push('Marca: ' + marcaVal);
  if (modeloVal) filtrosActivos.push('Modelo: ' + modeloVal);
  const filtrosTexto = filtrosActivos.length ? filtrosActivos.join('   |   ') : 'Sin filtros adicionales';

  window._reporteServiciosActual = { desdeVal, hastaVal, monedaVal, filas, filtrosTexto };
  _repSerOrdenCol = _repSerOrdenCol || null;
  _repSerOrdenAsc = _repSerOrdenAsc !== false;
  _repSerRenderTabla();
}

let _repSerOrdenCol = null;
let _repSerOrdenAsc = true;
const REP_SER_COLUMNAS = [
  { campo: 'numeroOS',   tipo: 'texto',  label: 'N° OS',      ancho: '13%' },
  { campo: 'fecha',      tipo: 'texto',  label: 'Fecha',      ancho: '10%' },
  { campo: 'cliente',    tipo: 'texto',  label: 'Cliente',    ancho: '15%' },
  { campo: 'vehiculo',   tipo: 'texto',  label: 'Vehículo',   ancho: '13%' },
  { campo: 'servicio',   tipo: 'texto',  label: 'Servicio',   ancho: '15%' },
  { campo: 'precio',     tipo: 'numero', label: 'Precio',     ancho: '11%' },
  { campo: 'referencia', tipo: 'texto',  label: 'Factura',    ancho: '11%' },
  { campo: 'pago',       tipo: 'texto',  label: 'Pago',       ancho: '12%' },
];

function repServiciosOrdenar(campo) {
  if (_repSerOrdenCol === campo) { _repSerOrdenAsc = !_repSerOrdenAsc; }
  else { _repSerOrdenCol = campo; _repSerOrdenAsc = true; }
  _repSerRenderTabla();
}

function _repSerRenderTabla() {
  const d = window._reporteServiciosActual;
  if (!d) return;

  const theadRow = REP_SER_COLUMNAS.map(function(c) {
    const alinear = (c.tipo === 'numero') ? 'text-align:right' : (c.campo === 'pago' ? 'text-align:center' : 'text-align:left');
    const flecha = _repSerOrdenCol === c.campo ? (_repSerOrdenAsc ? ' ▲' : ' ▼') : '';
    return '<th style="width:'+c.ancho+';'+alinear+';cursor:pointer;user-select:none" onclick="repServiciosOrdenar(\''+c.campo+'\')" title="Ordenar">' + c.label + flecha + '</th>';
  }).join('');
  const theadEl = document.getElementById('rep-ser-thead-row');
  if (theadEl) theadEl.innerHTML = theadRow;

  let filasOrd = d.filas.slice();
  if (_repSerOrdenCol) {
    const colDef = REP_SER_COLUMNAS.find(function(c){ return c.campo === _repSerOrdenCol; });
    filasOrd.sort(function(a, b) {
      let va = a[_repSerOrdenCol], vb = b[_repSerOrdenCol];
      let cmp = colDef.tipo === 'texto' ? String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' }) : va - vb;
      return _repSerOrdenAsc ? cmp : -cmp;
    });
  }

  const filasHtml = filasOrd.map(function(f) {
    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:13px">' + escapeHtml(f.numeroOS) + '</td>'
      + '<td style="font-family:var(--font-mono);font-size:13px">' + fmtFecha(f.fecha) + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(f.cliente) + '</td>'
      + '<td style="font-family:var(--font-mono);font-size:13px">' + escapeHtml(f.vehiculo) + '<div style="font-size:11px;color:var(--suave)">' + escapeHtml(f.vehiculoDesc) + '</div></td>'
      + '<td style="font-size:15px">' + escapeHtml(f.servicio) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (d.monedaVal==='VES' ? fmtBs(f.precio) : fmtUSD(f.precio)) + '</td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-size:13px;color:var(--suave)">' + escapeHtml(f.facturaRef || '—') + '</td>'
      + '<td style="text-align:center;font-size:13px;color:var(--suave)">' + escapeHtml(f.pago) + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-ser-tbody').innerHTML = filasHtml || '<tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px">No hay Servicios en el rango seleccionado</td></tr>';
}

async function repServiciosExportar() {
  await repServiciosRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-ser-formato')?.value || 'pdf';
  if (formato === 'excel') _repSerExportarExcel();
  else if (formato === 'pdf') _repSerExportarPDF();
  else _repSerExportarCSV();
}

function _repSerDatosExportar() {
  const d = window._reporteServiciosActual;
  if (!d) return null;
  const encabezados = ['N° OS','Fecha','Cliente','Vehículo','Servicio','Precio','Factura','Pago'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filasNumericas = d.filas.map(function(f) { return [f.numeroOS, fmtFecha(f.fecha), f.cliente, (f.vehiculo+' '+f.vehiculoDesc).trim(), f.servicio, f.precio, f.facturaRef||'—', f.pago]; });
  const filasTexto = d.filas.map(function(f) { return [f.numeroOS, fmtFecha(f.fecha), f.cliente, (f.vehiculo+' '+f.vehiculoDesc).trim(), f.servicio, fmtMoneda(f.precio), f.facturaRef||'—', f.pago]; });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repSerExportarCSV() {
  const dat = _repSerDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Servicios del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_servicios_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repSerExportarExcel() {
  const dat = _repSerDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 4, FILA_DATOS_DESDE = 5;
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Reporte por Servicios'],
    ['Moneda: ' + dat.d.monedaVal],
    ['Filtros: ' + dat.d.filtrosTexto],
    [],
    dat.encabezados,
  ].concat(dat.filasNumericas));
  hoja['!cols'] = [ {wch:14}, {wch:12}, {wch:24}, {wch:22}, {wch:24}, {wch:14}, {wch:14}, {wch:18} ];
  const NUM_FILAS = dat.filasNumericas.length;
  for (let col = 0; col < 8; col++) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
    if (col === 5) {
      for (let i = 0; i < NUM_FILAS; i++) {
        const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: col });
        if (hoja[ref]) { hoja[ref].z = '#,##0.00'; hoja[ref].t = 'n'; hoja[ref].s = { alignment: { horizontal: 'right' } }; }
      }
    }
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Servicios');
  XLSX.writeFile(libro, 'reporte_servicios_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.xlsx', { cellStyles: true });
}

function _repSerExportarPDF() {
  const dat = _repSerDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Reporte por Servicios', 14, 15);
  doc.setFontSize(9);
  doc.text('Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + '   |   Moneda: ' + dat.d.monedaVal, 14, 21);
  doc.text('Filtros: ' + dat.d.filtrosTexto, 14, 26);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 31,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'center' } },
  });
  doc.save('reporte_servicios_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '_' + dat.d.monedaVal + '.pdf');
}

// ═══════════════════ REPORTE DE INGRESOS POR MÉTODO DE PAGO ═══════════════════
// Fuente: cont_cxc (cobros ya recibidos, pagado_usd > 0) -- vía RPC porque
// esa tabla depende de permisos de Contabilidad/Facturas/Ventas/Servicios,
// no de Reportes; el permiso REPORTES→VER_INGRESOS debe bastar por sí solo.
function repIngresosLimpiarFiltros() {
  const hoy = getHoyVzla();
  const desde = document.getElementById('rep-ing-desde'); if (desde) desde.value = hoy;
  const hasta = document.getElementById('rep-ing-hasta'); if (hasta) hasta.value = hoy;
  const mon = document.getElementById('rep-ing-moneda'); if (mon) mon.value = 'TODAS';
  repIngresosRender(document.getElementById('reportes-contenido'));
}

async function repIngresosRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-ing-desde')?.value || hoy;
  const hastaVal = document.getElementById('rep-ing-hasta')?.value || hoy;
  const formatoVal = document.getElementById('rep-ing-formato')?.value || 'pdf';
  const monedaVal = document.getElementById('rep-ing-moneda')?.value || 'TODAS';

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-ing-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="repIngresosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-ing-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="repIngresosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda de Cobro</label>'
    + '<select id="rep-ing-moneda" onchange="repIngresosRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="TODAS"' + (monedaVal==='TODAS'?' selected':'') + '>Todas</option>'
    + '<option value="VES"' + (monedaVal==='VES'?' selected':'') + '>Bolívares (Bs)</option>'
    + '<option value="USD"' + (monedaVal==='USD'?' selected':'') + '>Dólares (US$)</option>'
    + '</select></div>'
    + '<button onclick="repIngresosLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-ing-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<button class="btn-secundario" onclick="repIngresosExportar()">⬇ Exportar</button>';

  let rows = [];
  try {
    rows = await rpc('obtener_ingresos_por_metodo_pago', {
      p_desde: desdeVal, p_hasta: hastaVal,
      p_id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null
    }) || [];
  } catch(e) { console.warn('Error cargando Ingresos por Método de Pago:', e); }
  if (monedaVal !== 'TODAS') rows = rows.filter(function(r) { return r.moneda_cobro === monedaVal; });

  // Cada línea se muestra en la Moneda en la que REALMENTE se cobró
  // (moneda_cobro) -- nunca se convierte una operación en USD a VES ni
  // viceversa. "pagado_usd" sirve solo como referencia interna para la
  // ALTURA proporcional de las barras del gráfico, nunca como el monto
  // que se le muestra al Usuario.
  const porMetodo = {};
  rows.forEach(function(r) {
    const esVES = r.moneda_cobro === 'VES';
    const montoReal = esVES ? parseFloat(r.pagado_usd||0) * parseFloat(r.tasa_bcv||1) : parseFloat(r.pagado_usd||0);
    // La clave de agrupación combina método + moneda -- el mismo nombre de
    // método (ej. "Efectivo") se usa tanto en VES como en USD, y son dos
    // grupos distintos que no se pueden mezclar ni sumar entre sí.
    const clave = r.metodo_pago + '||' + r.moneda_cobro;
    if (!porMetodo[clave]) porMetodo[clave] = { metodo: r.metodo_pago, monto: 0, transacciones: 0, moneda: r.moneda_cobro, refUsd: 0 };
    porMetodo[clave].monto += montoReal;
    porMetodo[clave].refUsd += parseFloat(r.pagado_usd||0);
    porMetodo[clave].transacciones++;
  });

  const filas = Object.keys(porMetodo).map(function(clave) {
    const d = porMetodo[clave];
    const yaDistingue = d.metodo.toUpperCase().includes('USD') || d.metodo.toUpperCase().includes('VES');
    const label = yaDistingue ? d.metodo : d.metodo + ' (' + d.moneda + ')';
    return { metodo: label, moneda: d.moneda, monto: d.monto, transacciones: d.transacciones, refUsd: d.refUsd };
  }).sort(function(a,b){ return b.refUsd - a.refUsd; });

  const totalVES = filas.filter(function(f){ return f.moneda === 'VES'; }).reduce(function(s,f){ return s + f.monto; }, 0);
  const totalUSD = filas.filter(function(f){ return f.moneda === 'USD'; }).reduce(function(s,f){ return s + f.monto; }, 0);
  const totalTrans = filas.reduce(function(s,f){ return s + f.transacciones; }, 0);

  cont.innerHTML = '<div style="padding:16px 24px">'
    + '<div id="rep-ing-grafico" style="margin-bottom:24px"></div>'
    + '<div id="rep-ing-resumen" style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total en VES</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + fmtBs(totalVES) + ' Bs</div>'
    + '</div>'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total en USD</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">$ ' + fmtUSD(totalUSD) + '</div>'
    + '</div>'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Transacciones</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + totalTrans.toLocaleString('es-VE') + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="min-width:600px;max-height:max(200px, calc(100vh - 560px))"><table style="width:100%;border-collapse:collapse">'
    + '<thead><tr id="rep-ing-thead-row"></tr></thead>'
    + '<tbody id="rep-ing-tbody"></tbody>'
    + '</table></div>'
    + '</div>';

  // ── Gráfico de barras (SVG simple, sin librerías externas) -- la altura
  // de cada barra es solo una referencia visual proporcional (usa el valor
  // normalizado en USD internamente), pero la CIFRA que se muestra en cada
  // barra siempre es el monto real en su propia Moneda de cobro.
  const maxRef = Math.max.apply(null, filas.map(function(f){ return f.refUsd; }).concat([1]));
  const anchoBarra = 100, espacio = 30, altoMax = 220, margenSup = 30, margenInf = 55;
  const anchoSvg = Math.max(500, filas.length * (anchoBarra + espacio) + espacio);
  const altoSvg = altoMax + margenSup + margenInf;
  let barrasSvg = filas.map(function(f, i) {
    const alturaBarra = maxRef > 0 ? (f.refUsd / maxRef) * altoMax : 0;
    const x = espacio + i * (anchoBarra + espacio);
    const y = margenSup + (altoMax - alturaBarra);
    const etiqueta = (f.moneda === 'VES' ? fmtBs(f.monto) + ' Bs' : '$ ' + fmtUSD(f.monto));
    return '<g>'
      + '<rect x="' + x + '" y="' + y + '" width="' + anchoBarra + '" height="' + alturaBarra + '" rx="6" fill="#ff6b00" opacity="0.9">'
      + '<title>' + escapeHtml(f.metodo) + ': ' + etiqueta + ' — ' + f.transacciones + ' transacciones</title>'
      + '</rect>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (y - 8) + '" text-anchor="middle" font-size="11" fill="var(--texto)" font-family="var(--font-mono)">' + etiqueta + '</text>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (margenSup + altoMax + 18) + '" text-anchor="middle" font-size="11" fill="var(--suave)">' + escapeHtml(f.metodo) + '</text>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (margenSup + altoMax + 33) + '" text-anchor="middle" font-size="10" fill="var(--suave)">' + f.transacciones + ' trans.</text>'
      + '</g>';
  }).join('');
  document.getElementById('rep-ing-grafico').innerHTML = filas.length
    ? '<div style="overflow-x:auto"><svg width="' + anchoSvg + '" height="' + altoSvg + '" viewBox="0 0 ' + anchoSvg + ' ' + altoSvg + '">' + barrasSvg + '</svg></div>'
    : '<div style="text-align:center;color:var(--suave);padding:24px">Sin Ingresos en el rango seleccionado</div>';

  window._reporteIngresosActual = { desdeVal, hastaVal, monedaVal, filas };
  _repIngRenderTabla();
}

function _repIngRenderTabla() {
  const d = window._reporteIngresosActual;
  if (!d) return;
  document.getElementById('rep-ing-thead-row').innerHTML =
    '<th style="text-align:left">Método de Pago</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Transacciones</th>';
  const filasHtml = d.filas.map(function(f) {
    return '<tr>'
      + '<td style="font-size:15px">' + escapeHtml(f.metodo) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (f.moneda==='VES' ? fmtBs(f.monto) + ' Bs' : '$ ' + fmtUSD(f.monto)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.transacciones + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('rep-ing-tbody').innerHTML = filasHtml || '<tr><td colspan="3" style="text-align:center;color:var(--suave);padding:32px">No hay Ingresos en el rango seleccionado</td></tr>';
}

async function repIngresosExportar() {
  await repIngresosRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-ing-formato')?.value || 'pdf';
  if (formato === 'excel') _repIngExportarExcel();
  else if (formato === 'pdf') _repIngExportarPDF();
  else _repIngExportarCSV();
}

function _repIngDatosExportar() {
  const d = window._reporteIngresosActual;
  if (!d) return null;
  const encabezados = ['Método de Pago','Ingresos','Transacciones'];
  const montoTxt = function(f){ return f.moneda==='VES' ? fmtBs(f.monto)+' Bs' : '$ '+fmtUSD(f.monto); };
  const filasNumericas = d.filas.map(function(f) { return [f.metodo, f.monto, f.transacciones]; });
  const filasTexto = d.filas.map(function(f) { return [f.metodo, montoTxt(f), f.transacciones]; });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repIngExportarCSV() {
  const dat = _repIngDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Ingresos por Método de Pago del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro'],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_ingresos_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repIngExportarExcel() {
  const dat = _repIngDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 2, FILA_DATOS_DESDE = 3;
  // En Excel el monto va como texto (ya trae Bs/$ y su propia Moneda) --
  // mezclar VES y USD en una sola columna numérica sumaría cifras que no
  // se pueden sumar entre sí.
  const filasExcel = dat.d.filas.map(function(f) {
    return [f.metodo, (f.moneda==='VES' ? fmtBs(f.monto)+' Bs' : '$ '+fmtUSD(f.monto)), f.transacciones];
  });
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Ingresos por Método de Pago'],
    ['Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro'],
    dat.encabezados,
  ].concat(filasExcel));
  hoja['!cols'] = [ {wch:24}, {wch:20}, {wch:16} ];
  const refEncabF = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: 0 });
  [0,1,2].forEach(function(col) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
  });
  const NUM_FILAS = filasExcel.length;
  for (let i = 0; i < NUM_FILAS; i++) {
    const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: 2 });
    if (hoja[ref]) { hoja[ref].z = '#,##0'; hoja[ref].t = 'n'; hoja[ref].s = { alignment: { horizontal: 'right' } }; }
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Ingresos');
  XLSX.writeFile(libro, 'reporte_ingresos_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.xlsx', { cellStyles: true });
}

function _repIngExportarPDF() {
  const dat = _repIngDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(14);
  doc.text('Ingresos por Método de Pago', 14, 15);
  doc.setFontSize(9);
  doc.text('Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro', 14, 21);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 27,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });
  doc.save('reporte_ingresos_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.pdf');
}

// ═══════════════════ REPORTE POR PUNTO DE VENTA ═══════════════════
// Agrupa las Ventas FACTURADAS por el Área que las realizó -- mismo
// diseño que el Reporte de Ingresos (gráfico + tabla + resumen por
// Moneda), pero agrupando por Área en vez de Método de Pago.

async function repPuntoVentaRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-pv-desde')?.value || hoy;
  const hastaVal = document.getElementById('rep-pv-hasta')?.value || hoy;
  const formatoVal = document.getElementById('rep-pv-formato')?.value || 'pdf';
  const monedaVal = document.getElementById('rep-pv-moneda')?.value || 'TODAS';

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-pv-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="repPuntoVentaRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-pv-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="repPuntoVentaRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda de Facturación</label>'
    + '<select id="rep-pv-moneda" onchange="repPuntoVentaRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="TODAS"' + (monedaVal==='TODAS'?' selected':'') + '>Todas</option>'
    + '<option value="VES"' + (monedaVal==='VES'?' selected':'') + '>Bolívares (Bs)</option>'
    + '<option value="USD"' + (monedaVal==='USD'?' selected':'') + '>Dólares (US$)</option>'
    + '</select></div>'
    + '<button onclick="repPuntoVentaLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(220,38,38,0.4);height:35px;box-sizing:border-box">🗑</button>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-pv-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<button class="btn-secundario" onclick="repPuntoVentaExportar()">⬇ Exportar</button>';

  let rows = [];
  try {
    rows = await rpc('obtener_ventas_por_area', {
      p_desde: desdeVal, p_hasta: hastaVal,
      p_id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null
    }) || [];
  } catch(e) { console.warn('Error cargando Ventas por Área:', e); }
  if (monedaVal !== 'TODAS') rows = rows.filter(function(r) { return r.moneda_cobro === monedaVal; });

  // Cada línea se muestra en la Moneda en la que REALMENTE se cobró
  // (moneda_cobro), igual que el Reporte de Ingresos -- nunca se convierte
  // una operación en USD a VES ni viceversa. "total_usd" sirve solo como
  // referencia interna para la ALTURA proporcional de las barras.
  const porArea = {};
  rows.forEach(function(r) {
    const esVES = r.moneda_cobro === 'VES';
    const montoReal = esVES ? parseFloat(r.total_usd||0) * parseFloat(r.tasa_bcv||1) : parseFloat(r.total_usd||0);
    const nombreArea = r.area_nombre ? (r.area_codigo ? r.area_nombre + ' (' + r.area_codigo + ')' : r.area_nombre) : '— Sin Área —';
    const clave = nombreArea + '||' + r.moneda_cobro;
    if (!porArea[clave]) porArea[clave] = { area: nombreArea, monto: 0, transacciones: 0, moneda: r.moneda_cobro, refUsd: 0, articulos: 0, piezas: 0 };
    porArea[clave].monto += montoReal;
    porArea[clave].refUsd += parseFloat(r.total_usd||0);
    porArea[clave].transacciones++;
    porArea[clave].articulos += parseInt(r.num_articulos||0);
    porArea[clave].piezas += parseFloat(r.num_piezas||0);
  });

  const filas = Object.keys(porArea).map(function(clave) {
    const d = porArea[clave];
    return { area: d.area, moneda: d.moneda, monto: d.monto, transacciones: d.transacciones, refUsd: d.refUsd, articulos: d.articulos, piezas: d.piezas };
  }).sort(function(a,b){ return b.refUsd - a.refUsd; });

  const totalVES = filas.filter(function(f){ return f.moneda === 'VES'; }).reduce(function(s,f){ return s + f.monto; }, 0);
  const totalUSD = filas.filter(function(f){ return f.moneda === 'USD'; }).reduce(function(s,f){ return s + f.monto; }, 0);
  const totalTrans = filas.reduce(function(s,f){ return s + f.transacciones; }, 0);

  cont.innerHTML = '<div style="padding:16px 24px">'
    + '<div id="rep-pv-grafico" style="margin-bottom:24px"></div>'
    + '<div id="rep-pv-resumen" style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total en VES</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + fmtBs(totalVES) + ' Bs</div>'
    + '</div>'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total en USD</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">$ ' + fmtUSD(totalUSD) + '</div>'
    + '</div>'
    + '<div style="flex:1;min-width:150px;background:var(--gris2);border-radius:8px;padding:10px 16px">'
    + '<div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Ventas</div>'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + totalTrans.toLocaleString('es-VE') + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="min-width:600px;max-height:max(200px, calc(100vh - 560px))"><table style="width:100%;border-collapse:collapse">'
    + '<thead><tr id="rep-pv-thead-row"></tr></thead>'
    + '<tbody id="rep-pv-tbody"></tbody>'
    + '</table></div>'
    + '</div>';

  const maxRef = Math.max.apply(null, filas.map(function(f){ return f.refUsd; }).concat([1]));
  const anchoBarra = 100, espacio = 30, altoMax = 220, margenSup = 30, margenInf = 55;
  const anchoSvg = Math.max(500, filas.length * (anchoBarra + espacio) + espacio);
  const altoSvg = altoMax + margenSup + margenInf;
  let barrasSvg = filas.map(function(f, i) {
    const alturaBarra = maxRef > 0 ? (f.refUsd / maxRef) * altoMax : 0;
    const x = espacio + i * (anchoBarra + espacio);
    const y = margenSup + (altoMax - alturaBarra);
    const etiqueta = (f.moneda === 'VES' ? fmtBs(f.monto) + ' Bs' : '$ ' + fmtUSD(f.monto));
    return '<g>'
      + '<rect x="' + x + '" y="' + y + '" width="' + anchoBarra + '" height="' + alturaBarra + '" rx="6" fill="#ff6b00" opacity="0.9">'
      + '<title>' + escapeHtml(f.area) + ': ' + etiqueta + ' — ' + f.transacciones + ' ventas</title>'
      + '</rect>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (y - 8) + '" text-anchor="middle" font-size="11" fill="var(--texto)" font-family="var(--font-mono)">' + etiqueta + '</text>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (margenSup + altoMax + 18) + '" text-anchor="middle" font-size="11" fill="var(--suave)">' + escapeHtml(f.area) + '</text>'
      + '<text x="' + (x + anchoBarra/2) + '" y="' + (margenSup + altoMax + 33) + '" text-anchor="middle" font-size="10" fill="var(--suave)">' + f.transacciones + ' ventas</text>'
      + '</g>';
  }).join('');
  document.getElementById('rep-pv-grafico').innerHTML = filas.length
    ? '<div style="overflow-x:auto"><svg width="' + anchoSvg + '" height="' + altoSvg + '" viewBox="0 0 ' + anchoSvg + ' ' + altoSvg + '">' + barrasSvg + '</svg></div>'
    : '<div style="text-align:center;color:var(--suave);padding:24px">Sin Ventas en el rango seleccionado</div>';

  window._reportePuntoVentaActual = { desdeVal, hastaVal, monedaVal, filas };
  _repPVRenderTabla();
}

function _repPVRenderTabla() {
  const d = window._reportePuntoVentaActual;
  if (!d) return;
  document.getElementById('rep-pv-thead-row').innerHTML =
    '<th style="text-align:left">Área (Punto de Venta)</th><th style="text-align:right">Ventas</th><th style="text-align:right">Cantidad</th><th style="text-align:right">No. Artículos</th><th style="text-align:right">No. Piezas</th>';
  const filasHtml = d.filas.map(function(f) {
    return '<tr>'
      + '<td style="font-size:15px">' + escapeHtml(f.area) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (f.moneda==='VES' ? fmtBs(f.monto) + ' Bs' : '$ ' + fmtUSD(f.monto)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.transacciones + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.articulos.toLocaleString('es-VE') + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + f.piezas.toLocaleString('es-VE') + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('rep-pv-tbody').innerHTML = filasHtml || '<tr><td colspan="5" style="text-align:center;color:var(--suave);padding:32px">No hay Ventas en el rango seleccionado</td></tr>';
}

function repPuntoVentaLimpiarFiltros() {
  const hoy = getHoyVzla();
  const elD = document.getElementById('rep-pv-desde'); if (elD) elD.value = hoy;
  const elH = document.getElementById('rep-pv-hasta'); if (elH) elH.value = hoy;
  const elM = document.getElementById('rep-pv-moneda'); if (elM) elM.value = 'TODAS';
  repPuntoVentaRender(document.getElementById('reportes-contenido'));
}

async function repPuntoVentaExportar() {
  await repPuntoVentaRender(document.getElementById('reportes-contenido'));
  const formato = document.getElementById('rep-pv-formato')?.value || 'pdf';
  if (formato === 'excel') _repPVExportarExcel();
  else if (formato === 'pdf') _repPVExportarPDF();
  else _repPVExportarCSV();
}

function _repPVDatosExportar() {
  const d = window._reportePuntoVentaActual;
  if (!d) return null;
  const encabezados = ['Área (Punto de Venta)','Ventas','Cantidad','No. Artículos','No. Piezas'];
  const montoTxt = function(f){ return f.moneda==='VES' ? fmtBs(f.monto)+' Bs' : '$ '+fmtUSD(f.monto); };
  const filasNumericas = d.filas.map(function(f) { return [f.area, f.monto, f.transacciones, f.articulos, f.piezas]; });
  const filasTexto = d.filas.map(function(f) { return [f.area, montoTxt(f), f.transacciones, f.articulos, f.piezas]; });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repPVExportarCSV() {
  const dat = _repPVDatosExportar();
  if (!dat) return;
  const filasCsv = [
    ['Ventas por Punto de Venta del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro'],
    [],
    dat.encabezados,
  ].concat(dat.filasTexto);
  const csv = filasCsv.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_punto_venta_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function _repPVExportarExcel() {
  const dat = _repPVDatosExportar();
  if (!dat || typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
  const FILA_ENCAB = 2, FILA_DATOS_DESDE = 3;
  const filasExcel = dat.d.filas.map(function(f) {
    return [f.area, (f.moneda==='VES' ? fmtBs(f.monto)+' Bs' : '$ '+fmtUSD(f.monto)), f.transacciones, f.articulos, f.piezas];
  });
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Ventas por Punto de Venta'],
    ['Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro'],
    dat.encabezados,
  ].concat(filasExcel));
  hoja['!cols'] = [ {wch:28}, {wch:20}, {wch:14}, {wch:14}, {wch:12} ];
  const refEncabF = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: 0 });
  [0,1,2,3,4].forEach(function(col) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
  });
  const NUM_FILAS = filasExcel.length;
  for (let i = 0; i < NUM_FILAS; i++) {
    [2,3,4].forEach(function(col) {
      const ref = XLSX.utils.encode_cell({ r: FILA_DATOS_DESDE + i, c: col });
      if (hoja[ref]) { hoja[ref].z = '#,##0'; hoja[ref].t = 'n'; hoja[ref].s = { alignment: { horizontal: 'right' } }; }
    });
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Punto de Venta');
  XLSX.writeFile(libro, 'reporte_punto_venta_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.xlsx', { cellStyles: true });
}

function _repPVExportarPDF() {
  const dat = _repPVDatosExportar();
  if (!dat || typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(14);
  doc.text('Ventas por Punto de Venta', 14, 15);
  doc.setFontSize(9);
  doc.text('Del ' + dat.d.desdeVal + ' al ' + dat.d.hastaVal + (dat.d.monedaVal && dat.d.monedaVal !== 'TODAS' ? '   |   Solo ' + (dat.d.monedaVal === 'VES' ? 'Bolívares' : 'Dólares') : '') + '   |   Cada monto en su Moneda real de cobro', 14, 21);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 27,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  doc.save('reporte_punto_venta_' + dat.d.desdeVal + '_a_' + dat.d.hastaVal + '.pdf');
}

// ═══════════════════ REPORTE DE NOTAS DE CRÉDITO ═══════════════════
// Fuente: notas_credito (+ factura afectada). Montos a la tasa de la
// factura original (la misma con la que se registró la NC).
const _REP_NC_SEL = 'background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 10px;border-radius:5px;outline:none;height:35px;box-sizing:border-box';
function repNotasCreditoLimpiarFiltros() {
  const hoy = getHoyVzla();
  ['rep-nc-desde','rep-nc-hasta'].forEach(function(id){ const el = document.getElementById(id); if (el) el.value = hoy; });
  ['rep-nc-estado','rep-nc-tipo','rep-nc-destino'].forEach(function(id){ const el = document.getElementById(id); if (el) el.value = ''; });
  repNotasCreditoRender(document.getElementById('reportes-contenido'));
}

async function repNotasCreditoRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-nc-desde')?.value || (hoy.substring(0, 8) + '01');
  const hastaVal = document.getElementById('rep-nc-hasta')?.value || hoy;
  const monedaVal = document.getElementById('rep-nc-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-nc-formato')?.value || 'pdf';
  const estadoVal = document.getElementById('rep-nc-estado')?.value || '';
  const tipoVal = document.getElementById('rep-nc-tipo')?.value || '';
  const destinoVal = document.getElementById('rep-nc-destino')?.value || '';
  const re = "repNotasCreditoRender(document.getElementById('reportes-contenido'))";

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-nc-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="' + re + '" style="' + _REP_NC_SEL + '"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-nc-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="' + re + '" style="' + _REP_NC_SEL + '"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-nc-moneda" onchange="' + re + '" style="' + _REP_NC_SEL + '">'
    + ['VES','USD'].map(function(m){ return '<option value="'+m+'"' + (monedaVal===m?' selected':'') + '>'+m+'</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="' + _REP_NC_SEL + ';cursor:pointer">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-nc-formato" style="' + _REP_NC_SEL + '">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repNotasCreditoExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  const opt = function(v, lbl, sel) { return '<option value="' + v + '"' + (sel===v?' selected':'') + '>' + lbl + '</option>'; };
  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Estado</label><select id="rep-nc-estado" onchange="' + re + '" style="' + _REP_NC_SEL + '">'
      + opt('', 'Todos', estadoVal) + opt('APROBADA', 'Aprobada', estadoVal) + opt('PENDIENTE', 'Pendiente', estadoVal) + opt('RECHAZADA', 'Rechazada', estadoVal) + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Tipo</label><select id="rep-nc-tipo" onchange="' + re + '" style="' + _REP_NC_SEL + '">'
      + opt('', 'Todos', tipoVal) + opt('REVERSO', 'Reverso', tipoVal) + opt('DEVOLUCION', 'Devolución de mercancía', tipoVal) + opt('ERROR_FACTURA', 'Error en la factura', tipoVal) + opt('GARANTIA_SERVICIO', 'Garantía de servicio', tipoVal) + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Destino</label><select id="rep-nc-destino" onchange="' + re + '" style="' + _REP_NC_SEL + '">'
      + opt('', 'Todos', destinoVal) + opt('REBAJA_CXC', 'Rebaja de la deuda', destinoVal) + opt('REEMBOLSO', 'Reembolso al cliente', destinoVal) + opt('SALDO_FAVOR', 'Saldo a favor', destinoVal) + '</select></div>'
    + '<button onclick="repNotasCreditoLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">'
    + ['Notas de Crédito|rep-nc-cant', 'Monto Aprobado|rep-nc-aprob', 'Monto Pendiente|rep-nc-pend', 'Reembolsos|rep-nc-reemb'].map(function(x) {
        const p = x.split('|');
        return '<div style="flex:1;min-width:160px;background:var(--gris2);border-radius:8px;padding:10px 16px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">' + p[0] + '</div>'
          + '<div id="' + p[1] + '" style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">0</div></div>';
      }).join('')
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="min-width:1000px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr id="rep-nc-thead-row"></tr></thead>'
    + '<tbody id="rep-nc-tbody"><tr><td colspan="9" style="text-align:center;color:var(--suave);padding:32px">Cargando...</td></tr></tbody>'
    + '</table></div></div>';

  let ncs = [];
  try {
    let q = '?fecha_emision=gte.' + desdeVal + '&fecha_emision=lte.' + hastaVal + '&order=fecha_emision.asc,id_nc.asc'
      + '&select=id_nc,numero_nc,fecha_emision,tipo,destino,total_usd,total_ves,tasa_bcv,estado,motivo,id_usuario,aprobado_por,numero_factura_ref,facturas(receptor_nombre)'
      + (_empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : '');
    if (estadoVal) q += '&estado=eq.' + estadoVal;
    if (tipoVal) q += '&tipo=eq.' + tipoVal;
    if (destinoVal) q += '&destino=eq.' + destinoVal + '&tipo=neq.REVERSO';
    ncs = await api('notas_credito','GET',null, q) || [];
  } catch(e) { console.warn('Error cargando Notas de Crédito:', e); }

  const TIPO_TXT = { REVERSO: 'Reverso', DEVOLUCION: 'Devolución', ERROR_FACTURA: 'Error en factura', GARANTIA_SERVICIO: 'Garantía servicio' };
  const DEST_TXT = { REBAJA_CXC: 'Rebaja deuda', REEMBOLSO: 'Reembolso', SALDO_FAVOR: 'Saldo a favor' };
  const EST_TXT = { APROBADA: 'Aprobada', PENDIENTE: 'Pendiente', RECHAZADA: 'Rechazada' };
  let aprob = 0, pend = 0, reemb = 0;
  const filas = ncs.map(function(n) {
    const monto = monedaVal === 'VES' ? parseFloat(n.total_ves || (n.total_usd * n.tasa_bcv) || 0) : parseFloat(n.total_usd || 0);
    if (n.estado === 'APROBADA') { aprob += monto; if (n.destino === 'REEMBOLSO' && n.tipo !== 'REVERSO') reemb += monto; }
    if (n.estado === 'PENDIENTE') pend += monto;
    return {
      fecha: n.fecha_emision, numero: n.numero_nc, factura: n.numero_factura_ref || '',
      cliente: (n.facturas && n.facturas.receptor_nombre) || '—',
      tipo: TIPO_TXT[n.tipo] || n.tipo, destino: n.tipo === 'REVERSO' ? '—' : (DEST_TXT[n.destino] || n.destino || ''),
      motivo: n.motivo || '', monto: monto, estado: EST_TXT[n.estado] || n.estado, aprobadoPor: n.aprobado_por || ''
    };
  });
  const fmtM = function(v) { return monedaVal === 'VES' ? fmtBs(v) + ' Bs' : '$ ' + fmtUSD(v); };
  document.getElementById('rep-nc-cant').textContent = filas.length.toLocaleString('es-VE');
  document.getElementById('rep-nc-aprob').textContent = fmtM(aprob);
  document.getElementById('rep-nc-pend').textContent = fmtM(pend);
  document.getElementById('rep-nc-reemb').textContent = fmtM(reemb);

  const fil = [];
  if (estadoVal) fil.push('Estado: ' + (EST_TXT[estadoVal] || estadoVal));
  if (tipoVal) fil.push('Tipo: ' + (TIPO_TXT[tipoVal] || tipoVal));
  if (destinoVal) fil.push('Destino: ' + (DEST_TXT[destinoVal] || destinoVal));
  window._reporteNCActual = { monedaVal, desdeVal, hastaVal, filas,
    filtrosTexto: fil.length ? fil.join('   |   ') : 'Sin filtros adicionales',
    resumen: 'Notas de Crédito: ' + filas.length + '   |   Aprobado: ' + fmtM(aprob) + '   |   Pendiente: ' + fmtM(pend) + '   |   Reembolsos: ' + fmtM(reemb) };
  _repNCRenderTabla();
}

let _repNCOrdenCol = null, _repNCOrdenAsc = true;
const REP_NC_COLUMNAS = [
  { campo: 'fecha',    tipo: 'texto',  label: 'Fecha' },
  { campo: 'numero',   tipo: 'texto',  label: 'N° NC' },
  { campo: 'factura',  tipo: 'texto',  label: 'Factura' },
  { campo: 'cliente',  tipo: 'texto',  label: 'Cliente' },
  { campo: 'tipo',     tipo: 'texto',  label: 'Tipo' },
  { campo: 'destino',  tipo: 'texto',  label: 'Destino' },
  { campo: 'monto',    tipo: 'numero', label: 'Monto' },
  { campo: 'estado',   tipo: 'texto',  label: 'Estado' },
  { campo: 'aprobadoPor', tipo: 'texto', label: 'Aprobada / Rechazada por' },
];
function repNotasCreditoOrdenar(campo) {
  if (_repNCOrdenCol === campo) _repNCOrdenAsc = !_repNCOrdenAsc; else { _repNCOrdenCol = campo; _repNCOrdenAsc = true; }
  _repNCRenderTabla();
}
function _repNCRenderTabla() {
  const d = window._reporteNCActual; if (!d) return;
  document.getElementById('rep-nc-thead-row').innerHTML = REP_NC_COLUMNAS.map(function(c) {
    const al = c.tipo === 'numero' ? 'text-align:right' : (c.campo === 'estado' ? 'text-align:center' : 'text-align:left');
    const fl = _repNCOrdenCol === c.campo ? (_repNCOrdenAsc ? ' ▲' : ' ▼') : '';
    return '<th style="' + al + ';cursor:pointer;user-select:none" onclick="repNotasCreditoOrdenar(\'' + c.campo + '\')" title="Ordenar">' + c.label + fl + '</th>';
  }).join('');
  let filas = d.filas.slice();
  if (_repNCOrdenCol) {
    const cd = REP_NC_COLUMNAS.find(function(c){ return c.campo === _repNCOrdenCol; });
    filas.sort(function(a, b) {
      const va = a[_repNCOrdenCol], vb = b[_repNCOrdenCol];
      const cmp = cd.tipo === 'texto' ? String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' }) : va - vb;
      return _repNCOrdenAsc ? cmp : -cmp;
    });
  }
  const badge = { Aprobada: 'badge-verde', Pendiente: 'badge-naranja', Rechazada: 'badge-rojo' };
  document.getElementById('rep-nc-tbody').innerHTML = filas.map(function(f) {
    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:14px">' + fmtFecha(f.fecha) + '</td>'
      + '<td style="font-family:var(--font-mono);font-size:13px;color:var(--naranja)">' + escapeHtml(f.numero) + '</td>'
      + '<td style="font-family:var(--font-mono);font-size:13px;color:var(--suave)">' + escapeHtml(f.factura) + '</td>'
      + '<td style="font-size:14px">' + escapeHtml(f.cliente) + '</td>'
      + '<td style="font-size:13px">' + escapeHtml(f.tipo) + '</td>'
      + '<td style="font-size:13px;color:var(--suave)">' + escapeHtml(f.destino) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:14px">' + (d.monedaVal === 'VES' ? fmtBs(f.monto) : fmtUSD(f.monto)) + '</td>'
      + '<td style="text-align:center"><span class="badge ' + (badge[f.estado] || 'badge-gris') + '">' + escapeHtml(f.estado) + '</span></td>'
      + '<td style="font-size:12px;color:var(--suave)">' + escapeHtml(f.aprobadoPor) + '</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--suave);padding:32px">No hay Notas de Crédito en el rango seleccionado</td></tr>';
}

async function repNotasCreditoExportar() {
  await repNotasCreditoRender(document.getElementById('reportes-contenido'));
  const d = window._reporteNCActual; if (!d) return;
  const formato = document.getElementById('rep-nc-formato')?.value || 'pdf';
  const enc = ['Fecha','N° NC','Factura','Cliente','Tipo','Destino','Monto (' + d.monedaVal + ')','Estado','Aprobada / Rechazada por','Motivo'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filaBase = function(f, monto) { return [fmtFecha(f.fecha), f.numero, f.factura, f.cliente, f.tipo, f.destino, monto, f.estado, f.aprobadoPor, f.motivo]; };
  const nombre = 'reporte_notas_credito_' + d.desdeVal + '_a_' + d.hastaVal + '_' + d.monedaVal;
  const cab = [['Reporte de Notas de Crédito'], ['Del ' + d.desdeVal + ' al ' + d.hastaVal + '   |   Moneda: ' + d.monedaVal], ['Filtros: ' + d.filtrosTexto], [d.resumen]];
  if (formato === 'csv') {
    const filas = cab.concat([[], enc]).concat(d.filas.map(function(f){ return filaBase(f, fmtMoneda(f.monto)); }));
    const csv = filas.map(function(r){ return r.map(function(v){ return '"' + String(v).replace(/"/g,'""') + '"'; }).join(','); }).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre + '.csv'; a.click(); URL.revokeObjectURL(url);
  } else if (formato === 'excel') {
    if (typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
    const hoja = XLSX.utils.aoa_to_sheet(cab.concat([enc]).concat(d.filas.map(function(f){ return filaBase(f, f.monto); })));
    hoja['!cols'] = [ {wch:12}, {wch:10}, {wch:16}, {wch:28}, {wch:16}, {wch:14}, {wch:16}, {wch:12}, {wch:26}, {wch:40} ];
    for (let i = 0; i < d.filas.length; i++) {
      const ref = XLSX.utils.encode_cell({ r: cab.length + 1 + i, c: 6 });
      if (hoja[ref]) { hoja[ref].z = '#,##0.00'; hoja[ref].t = 'n'; }
    }
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Notas de Crédito');
    XLSX.writeFile(libro, nombre + '.xlsx', { cellStyles: true });
  } else {
    if (typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14); doc.text('Reporte de Notas de Crédito', 14, 15);
    doc.setFontSize(9);
    doc.text(cab[1][0], 14, 21); doc.text(cab[2][0], 14, 26); doc.text(d.resumen, 14, 31);
    doc.autoTable({ head: [enc.slice(0, 9)], body: d.filas.map(function(f){ return filaBase(f, fmtMoneda(f.monto)).slice(0, 9); }), startY: 36,
      styles: { fontSize: 8 }, headStyles: { fillColor: [255, 107, 0], halign: 'center' }, columnStyles: { 6: { halign: 'right' }, 7: { halign: 'center' } } });
    doc.save(nombre + '.pdf');
  }
}


// ═══════════════════ REPORTE DE EGRESOS ═══════════════════
// Fuente: Obligaciones de Pago (cont_cxp) por su Fecha de emisión, vía
// RPC obtener_egresos_reporte (basta el permiso REPORTES→VER_EGRESOS).
// Incluye Pagadas, Por Pagar (Pendiente / Parcial) y Anuladas. El Área es
// la de quien generó la Obligación (Empleados), igual que la aprobación.
function repEgresosLimpiarFiltros() {
  const hoy = getHoyVzla();
  const d = document.getElementById('rep-egr-desde'); if (d) d.value = hoy.substring(0, 8) + '01';
  const h = document.getElementById('rep-egr-hasta'); if (h) h.value = hoy;
  ['rep-egr-area','rep-egr-estado'].forEach(function(id){ const el = document.getElementById(id); if (el) el.value = ''; });
  repEgresosRender(document.getElementById('reportes-contenido'));
}

// Grupo de estado del reporte
function _repEgrGrupo(c) {
  const e = String(c.estado || '').toUpperCase();
  if (e === 'ANULADA' || e === 'RECHAZADA' || e === 'REVERSADA' || String(c.estado_aprobacion || '').toUpperCase() === 'RECHAZADA') return 'ANULADA';
  if (e === 'PAGADA') return 'PAGADA';
  return 'POR_PAGAR';
}
function _repEgrConcepto(c) {
  const t = String(c.tipo || '').toUpperCase();
  if (t.indexOf('COMPRA') === 0) return 'Compra de Inventario';
  if (t === 'REEMBOLSO_CLIENTE') return 'Reembolso a Cliente';
  return c.categoria_nombre || 'Pago a Proveedor';
}

async function repEgresosRender(cont) {
  if (!cont) return;
  const hoy = getHoyVzla();
  const desdeVal = document.getElementById('rep-egr-desde')?.value || (hoy.substring(0, 8) + '01');
  const hastaVal = document.getElementById('rep-egr-hasta')?.value || hoy;
  const monedaVal = document.getElementById('rep-egr-moneda')?.value || 'VES';
  const formatoVal = document.getElementById('rep-egr-formato')?.value || 'pdf';
  const areaVal = document.getElementById('rep-egr-area')?.value || '';
  const estadoVal = document.getElementById('rep-egr-estado')?.value || '';
  const re = "repEgresosRender(document.getElementById('reportes-contenido'))";
  const S = _REP_NC_SEL;

  document.getElementById('reportes-topbar-extra').innerHTML =
    '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Desde</label>'
    + '<input type="date" id="rep-egr-desde" value="' + desdeVal + '" max="' + hoy + '" onchange="' + re + '" style="' + S + '"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Hasta</label>'
    + '<input type="date" id="rep-egr-hasta" value="' + hastaVal + '" max="' + hoy + '" onchange="' + re + '" style="' + S + '"></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Moneda</label>'
    + '<select id="rep-egr-moneda" onchange="' + re + '" style="' + S + '">'
    + ['VES','USD'].map(function(m){ return '<option value="'+m+'"' + (monedaVal===m?' selected':'') + '>'+m+'</option>'; }).join('')
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Filtro</label>'
    + '<button id="rep-filtros-toggle-btn" onclick="repToggleFiltros()" style="' + S + ';cursor:pointer">' + (_repFiltrosVisibles?'Ocultar':'Mostrar') + '</button></div>'
    + '<div><label style="display:block;font-size:10px;color:var(--suave);margin-bottom:2px">Formato</label>'
    + '<select id="rep-egr-formato" style="' + S + '">'
    + '<option value="pdf"' + (formatoVal==='pdf'?' selected':'') + '>PDF</option>'
    + '<option value="excel"' + (formatoVal==='excel'?' selected':'') + '>Excel (.xlsx)</option>'
    + '<option value="csv"' + (formatoVal==='csv'?' selected':'') + '>CSV</option>'
    + '</select></div>'
    + '<div><label style="display:block;font-size:10px;color:transparent;margin-bottom:2px">.</label>'
    + '<button class="btn-secundario" onclick="repEgresosExportar()" style="height:35px;box-sizing:border-box">⬇ Exportar</button></div>';

  cont.innerHTML = '<div style="padding:16px 24px"><div style="text-align:center;color:var(--suave);padding:32px">Cargando...</div></div>';
  let rows = [];
  try {
    rows = await api('rpc/obtener_egresos_reporte','POST',{ p_desde: desdeVal, p_hasta: hastaVal,
      p_id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null }) || [];
  } catch(e) {
    cont.innerHTML = '<div style="padding:16px 24px"><div class="alerta alerta-error" style="display:block">Error cargando los Egresos: ' + escapeHtml(msgErr(e)) + '</div></div>';
    return;
  }

  // Monto en la moneda elegida (Bs a la tasa de la Obligación)
  const enMoneda = function(usd, c) {
    if (monedaVal === 'USD') return usd;
    const tasa = parseFloat(c.tasa_bcv || 0);
    const mUsd = parseFloat(c.monto_usd || 0), mVes = parseFloat(c.monto_ves || 0);
    if (mUsd > 0 && mVes > 0) return usd * (mVes / mUsd);
    return usd * (tasa || 1);
  };
  const areaDe = function(c) { return c.area_nombre ? c.area_nombre + (c.area_codigo ? ' (' + c.area_codigo + ')' : '') : 'Sin Área asignada'; };
  const areasDisp = {};
  rows.forEach(function(c) { areasDisp[areaDe(c)] = true; });

  const det = [];
  const porArea = {};
  let tPag = 0, tPor = 0, tAnu = 0;
  rows.forEach(function(c) {
    const area = areaDe(c);
    const grupo = _repEgrGrupo(c);
    if (areaVal && area !== areaVal) return;
    if (estadoVal && grupo !== estadoVal) return;
    const total = enMoneda(parseFloat(c.monto_usd || 0), c);
    let pag = 0, por = 0, anu = 0;
    if (grupo === 'ANULADA') anu = total;
    else if (grupo === 'PAGADA') pag = total;
    else { pag = Math.min(enMoneda(parseFloat(c.pagado_usd || 0), c), total); por = total - pag; }
    tPag += pag; tPor += por; tAnu += anu;
    if (!porArea[area]) porArea[area] = { area: area, pagado: 0, porPagar: 0, anulado: 0, n: 0 };
    porArea[area].pagado += pag; porArea[area].porPagar += por; porArea[area].anulado += anu; porArea[area].n++;
    det.push({
      fecha: c.fecha_emision, documento: fmtNumeroDoc(c.numero_doc) || ('#' + c.id_cxp), area: area,
      proveedor: c.proveedor_nombre || '—', concepto: _repEgrConcepto(c),
      descripcion: c.concepto || c.observaciones || '', estado: grupo === 'PAGADA' ? 'Pagada' : grupo === 'ANULADA' ? 'Anulada' : (String(c.estado).toUpperCase() === 'PARCIAL' ? 'Parcial' : 'Por Pagar'),
      fechaPago: c.fecha_pago || '', metodo: c.metodo_pago || '', monto: total, pagado: pag, usuario: c.id_usuario || ''
    });
  });
  const resumen = Object.keys(porArea).map(function(k){ return porArea[k]; })
    .sort(function(a, b){ return (b.pagado + b.porPagar) - (a.pagado + a.porPagar); });

  const fmtM = function(v) { return monedaVal === 'VES' ? fmtBs(v) + ' Bs' : '$ ' + fmtUSD(v); };
  const num = function(v) { return monedaVal === 'VES' ? fmtBs(v) : fmtUSD(v); };
  const opt = function(v, lbl, sel) { return '<option value="' + escapeHtml(v) + '"' + (sel===v?' selected':'') + '>' + escapeHtml(lbl) + '</option>'; };
  const card = function(lbl, val) {
    return '<div style="flex:1;min-width:160px;background:var(--gris2);border-radius:8px;padding:10px 16px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">' + lbl + '</div>'
      + '<div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + val + '</div></div>';
  };
  const badge = { 'Pagada': 'badge-verde', 'Por Pagar': 'badge-naranja', 'Parcial': 'badge-naranja', 'Anulada': 'badge-rojo' };
  const th = function(t, al) { return '<th style="text-align:' + (al || 'left') + '">' + t + '</th>'; };

  cont.innerHTML = '<div style="padding:16px 24px">'
    + '<div id="rep-filtros-extra" style="display:' + (_repFiltrosVisibles?'flex':'none') + ';gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Área</label><select id="rep-egr-area" onchange="' + re + '" style="' + S + '">'
      + opt('', 'Todas', areaVal) + Object.keys(areasDisp).sort().map(function(a){ return opt(a, a, areaVal); }).join('') + '</select></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Estado</label><select id="rep-egr-estado" onchange="' + re + '" style="' + S + '">'
      + opt('', 'Todos', estadoVal) + opt('PAGADA', 'Pagadas', estadoVal) + opt('POR_PAGAR', 'Por Pagar', estadoVal) + opt('ANULADA', 'Anuladas', estadoVal) + '</select></div>'
    + '<button onclick="repEgresosLimpiarFiltros()" title="Limpiar filtros" style="background:#dc2626;border:1px solid #dc2626;color:#fff;padding:8px 12px;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;height:35px;box-sizing:border-box">🗑</button>'
    + '</div>'
    + '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">'
    + card('Obligaciones', det.length.toLocaleString('es-VE')) + card('Pagado', fmtM(tPag)) + card('Por Pagar', fmtM(tPor)) + card('Anulado', fmtM(tAnu))
    + '</div>'
    + '<div style="font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px">Egresos por Área</div>'
    + '<div class="tabla-container" style="margin-bottom:20px"><table style="width:100%;border-collapse:collapse">'
    + '<thead><tr>' + th('Área') + th('Pagado','right') + th('Por Pagar','right') + th('Total (sin anulado)','right') + th('Anulado','right') + th('Obligaciones','right') + '</tr></thead><tbody>'
    + (resumen.map(function(r) {
        return '<tr style="cursor:pointer" title="Ver solo esta Área" onclick="document.getElementById(\'rep-egr-area\').value=' + escapeHtml(JSON.stringify(r.area)) + ';' + re + '">'
          + '<td style="font-size:14px;font-weight:600">' + escapeHtml(r.area) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;color:#22c55e">' + num(r.pagado) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;color:var(--naranja)">' + num(r.porPagar) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700">' + num(r.pagado + r.porPagar) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;color:#fc8181">' + num(r.anulado) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono)">' + r.n + '</td></tr>';
      }).join('')
      + (resumen.length ? '<tr style="border-top:2px solid var(--borde)"><td style="font-weight:700">TOTAL</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700">' + num(tPag) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700">' + num(tPor) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--naranja)">' + num(tPag + tPor) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700">' + num(tAnu) + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:700">' + det.length + '</td></tr>'
        : '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:24px">No hay Egresos en el rango seleccionado</td></tr>'))
    + '</tbody></table></div>'
    + '<div style="font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px">Detalle de Obligaciones</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 520px))"><table style="min-width:1100px;border-collapse:collapse;white-space:nowrap">'
    + '<thead><tr>' + th('Fecha') + th('N° Documento') + th('Área') + th('Proveedor / Beneficiario') + th('Concepto') + th('Estado','center') + th('Fecha Pago') + th('Método') + th('Monto (' + monedaVal + ')','right') + '</tr></thead><tbody>'
    + (det.map(function(f) {
        return '<tr>'
          + '<td style="font-family:var(--font-mono);font-size:13px">' + fmtFecha(f.fecha) + '</td>'
          + '<td style="font-family:var(--font-mono);font-size:12px;color:var(--naranja)">' + escapeHtml(f.documento) + '</td>'
          + '<td style="font-size:12px">' + escapeHtml(f.area) + '</td>'
          + '<td style="font-size:13px">' + escapeHtml(f.proveedor) + '</td>'
          + '<td style="font-size:12px">' + escapeHtml(f.concepto) + (f.descripcion ? '<div style="font-size:10px;color:var(--suave);max-width:260px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(f.descripcion) + '</div>' : '') + '</td>'
          + '<td style="text-align:center"><span class="badge ' + (badge[f.estado] || 'badge-gris') + '">' + escapeHtml(f.estado) + '</span></td>'
          + '<td style="font-family:var(--font-mono);font-size:12px">' + (f.fechaPago ? fmtFecha(f.fechaPago) : '—') + '</td>'
          + '<td style="font-size:12px">' + escapeHtml(f.metodo || '—') + '</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:14px;font-weight:600;color:' + (f.estado === 'Anulada' ? '#fc8181;text-decoration:line-through' : 'var(--naranja)') + '">' + num(f.monto) + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--suave);padding:24px">Sin Obligaciones</td></tr>')
    + '</tbody></table></div></div>';

  const fil = [];
  if (areaVal) fil.push('Área: ' + areaVal);
  if (estadoVal) fil.push('Estado: ' + ({ PAGADA: 'Pagadas', POR_PAGAR: 'Por Pagar', ANULADA: 'Anuladas' }[estadoVal]));
  window._reporteEgrActual = { monedaVal, desdeVal, hastaVal, resumen, det, tPag, tPor, tAnu,
    filtrosTexto: fil.length ? fil.join('   |   ') : 'Sin filtros adicionales (todas las Áreas y estados)',
    resumenTexto: 'Obligaciones: ' + det.length + '   |   Pagado: ' + fmtM(tPag) + '   |   Por Pagar: ' + fmtM(tPor) + '   |   Anulado: ' + fmtM(tAnu) };
}

async function repEgresosExportar() {
  await repEgresosRender(document.getElementById('reportes-contenido'));
  const d = window._reporteEgrActual; if (!d) return;
  const formato = document.getElementById('rep-egr-formato')?.value || 'pdf';
  const fmtMon = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const nombre = 'reporte_egresos_' + d.desdeVal + '_a_' + d.hastaVal + '_' + d.monedaVal;
  const cab = [['Reporte de Egresos'], ['Del ' + d.desdeVal + ' al ' + d.hastaVal + '   |   Moneda: ' + d.monedaVal], ['Filtros: ' + d.filtrosTexto], [d.resumenTexto]];
  const encRes = ['Área', 'Pagado', 'Por Pagar', 'Total (sin anulado)', 'Anulado', 'Obligaciones'];
  const filaRes = function(r, f) { return [r.area, f(r.pagado), f(r.porPagar), f(r.pagado + r.porPagar), f(r.anulado), r.n]; };
  const totRes = function(f) { return ['TOTAL', f(d.tPag), f(d.tPor), f(d.tPag + d.tPor), f(d.tAnu), d.det.length]; };
  const encDet = ['Fecha', 'N° Documento', 'Área', 'Proveedor / Beneficiario', 'Concepto', 'Descripción', 'Estado', 'Fecha Pago', 'Método', 'Monto (' + d.monedaVal + ')', 'Creada por'];
  const filaDet = function(x, f) { return [fmtFecha(x.fecha), x.documento, x.area, x.proveedor, x.concepto, x.descripcion, x.estado, x.fechaPago ? fmtFecha(x.fechaPago) : '', x.metodo, f(x.monto), x.usuario]; };
  if (formato === 'csv') {
    const filas = cab.concat([[], ['EGRESOS POR ÁREA'], encRes]).concat(d.resumen.map(function(r){ return filaRes(r, fmtMon); })).concat([totRes(fmtMon)])
      .concat([[], ['DETALLE DE OBLIGACIONES'], encDet]).concat(d.det.map(function(x){ return filaDet(x, fmtMon); }));
    const csv = filas.map(function(r){ return r.map(function(v){ return '"' + String(v).replace(/"/g,'""') + '"'; }).join(','); }).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre + '.csv'; a.click(); URL.revokeObjectURL(url);
  } else if (formato === 'excel') {
    if (typeof XLSX === 'undefined') { alert('No se pudo cargar el generador de Excel. Verifica tu conexión e intenta de nuevo.'); return; }
    const ident = function(v) { return Math.round(v * 100) / 100; };
    const libro = XLSX.utils.book_new();
    const h1 = XLSX.utils.aoa_to_sheet(cab.concat([[], encRes]).concat(d.resumen.map(function(r){ return filaRes(r, ident); })).concat([totRes(ident)]));
    h1['!cols'] = [ {wch:32}, {wch:16}, {wch:16}, {wch:20}, {wch:16}, {wch:14} ];
    XLSX.utils.book_append_sheet(libro, h1, 'Por Área');
    const h2 = XLSX.utils.aoa_to_sheet(cab.concat([[], encDet]).concat(d.det.map(function(x){ return filaDet(x, ident); })));
    h2['!cols'] = [ {wch:12}, {wch:18}, {wch:28}, {wch:30}, {wch:22}, {wch:40}, {wch:12}, {wch:12}, {wch:18}, {wch:16}, {wch:28} ];
    XLSX.utils.book_append_sheet(libro, h2, 'Detalle');
    XLSX.writeFile(libro, nombre + '.xlsx', { cellStyles: true });
  } else {
    if (typeof window.jspdf === 'undefined') { alert('No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14); doc.text('Reporte de Egresos', 14, 15);
    doc.setFontSize(9);
    doc.text(cab[1][0], 14, 21); doc.text(cab[2][0], 14, 26); doc.text(d.resumenTexto, 14, 31);
    doc.setFontSize(11); doc.text('Egresos por Área', 14, 39);
    doc.autoTable({ head: [encRes], body: d.resumen.map(function(r){ return filaRes(r, fmtMon); }).concat([totRes(fmtMon)]), startY: 42,
      styles: { fontSize: 8 }, headStyles: { fillColor: [255, 107, 0], halign: 'center' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      didParseCell: function(h) { if (h.section === 'body' && h.row.index === d.resumen.length) h.cell.styles.fontStyle = 'bold'; } });
    const y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11); doc.text('Detalle de Obligaciones', 14, y);
    const sinDesc = function(x) { const r = filaDet(x, fmtMon); r.splice(5, 1); r.pop(); return r; };
    const encPdf = encDet.slice(); encPdf.splice(5, 1); encPdf.pop();
    doc.autoTable({ head: [encPdf], body: d.det.map(sinDesc), startY: y + 3,
      styles: { fontSize: 7.5 }, headStyles: { fillColor: [255, 107, 0], halign: 'center' },
      columnStyles: { 5: { halign: 'center' }, 8: { halign: 'right' } } });
    doc.save(nombre + '.pdf');
  }
}
