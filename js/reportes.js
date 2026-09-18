// ═══════════════════════════════════════════════════════════════
//   MÓDULO REPORTES -- vive bajo Administración en el menú, con su
//   propio permiso (REPORTES→VER) como cualquier otro módulo. Pensado
//   para alojar reportes de distintas áreas -- el primero es el de
//   Inventario; los siguientes se agregan como nuevas opciones del
//   selector, cada uno con su propia función de render.
// ═══════════════════════════════════════════════════════════════

const REPORTES_DISPONIBLES = [
  { id: 'inventario', nombre: '📦 Reporte de Inventario', render: repInventarioRender },
];

let _reporteActual = 'inventario';

async function renderReportes() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('REPORTES')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="panel" id="panel-reportes" style="margin-top:-16px">'
    + '<div class="panel-header" style="padding:14px 24px">'
    + '<select id="rep-selector" onchange="_reporteActual=this.value; renderReportes()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;cursor:pointer">'
    + REPORTES_DISPONIBLES.map(function(r){ return '<option value="'+r.id+'"' + (r.id === _reporteActual ? ' selected' : '') + '>' + r.nombre + '</option>'; }).join('')
    + '</select>'
    + '</div>'
    + '<div id="reportes-contenido"></div>'
    + '</div>';

  const reporte = REPORTES_DISPONIBLES.find(function(r){ return r.id === _reporteActual; });
  if (reporte) await reporte.render(document.getElementById('reportes-contenido'));
}

// ═══════════════════ REPORTE DE INVENTARIO ═══════════════════
async function repInventarioRender(cont) {
  if (!cont) return;
  const fechaCorteVal = document.getElementById('rep-inv-fecha')?.value || getHoyVzla();
  const monedaVal = document.getElementById('rep-inv-moneda')?.value || 'USD';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Fecha de Corte</label>'
    + '<input type="date" id="rep-inv-fecha" value="' + fechaCorteVal + '" max="' + getHoyVzla() + '" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none"></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Moneda</label>'
    + '<select id="rep-inv-moneda" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none">'
    + '<option value="USD"' + (monedaVal==='USD'?' selected':'') + '>USD</option>'
    + '<option value="VES"' + (monedaVal==='VES'?' selected':'') + '>VES</option>'
    + '</select></div>'
    + '<div id="rep-inv-tasa-info" style="font-size:12px;color:var(--suave);font-family:var(--font-mono)">Cargando tasa...</div>'
    + '<button class="btn-secundario" onclick="repInventarioExportar()" style="margin-left:auto">⬇ Exportar CSV</button>'
    + '</div>'
    + '<div id="rep-inv-resumen" style="display:flex;gap:20px;margin-bottom:20px">'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:16px 20px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Total de Unidades en Stock</div>'
    + '<div id="rep-inv-total-unidades" style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">0</div>'
    + '</div>'
    + '<div style="flex:1;background:var(--gris2);border-radius:8px;padding:16px 20px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Valor Total del Inventario</div>'
    + '<div id="rep-inv-total-valor" style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">0</div>'
    + '</div>'
    + '</div>'
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 420px))"><table style="width:100%;border-collapse:collapse;table-layout:fixed">'
    + '<thead><tr>'
    + '<th style="width:11%">Código</th><th style="width:22%">Artículo</th><th style="width:9%;text-align:right">Stock</th><th style="width:10%;text-align:right">Stock Mín.</th>'
    + '<th style="width:14%;text-align:center">Rotación</th><th style="width:12%;text-align:right">Precio Prom.</th><th style="width:12%;text-align:right">Valor Total</th><th style="width:10%;text-align:right">Margen</th>'
    + '</tr></thead><tbody id="rep-inv-tbody"><tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px">Cargando...</td></tr></tbody>'
    + '</table></div>'
    + '</div>';

  // Tasa BCV vigente A la fecha de corte (nunca una posterior, aunque ya
  // esté publicada -- mismo criterio legal usado en el resto de la app).
  let tasaCorte = 1;
  if (monedaVal === 'VES') {
    try {
      const tasaRows = await api('tasas','GET',null,
        '?moneda_origen=eq.USD&fecha_valor=lte.'+fechaCorteVal+'&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
      if (tasaRows && tasaRows[0]) {
        tasaCorte = parseFloat(tasaRows[0].tipo_cambio);
        document.getElementById('rep-inv-tasa-info').textContent = 'Tasa BCV (VES/USD) al ' + fmtFecha(tasaRows[0].fecha_valor) + ': ' + fmtBs(tasaCorte);
      } else {
        document.getElementById('rep-inv-tasa-info').textContent = 'Sin tasa BCV registrada a esa fecha.';
      }
    } catch(eTasaRep) { document.getElementById('rep-inv-tasa-info').textContent = 'Error obteniendo la tasa.'; }
  } else {
    document.getElementById('rep-inv-tasa-info').textContent = '';
  }

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
    items = await api('inventario_almacen','GET',null,
      '?estado=eq.ACTIVO&select=*' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(eItemsRep) { console.warn('Error cargando Artículos para el Reporte:', eItemsRep); }

  let categorias = [];
  try {
    categorias = await api('inv_categorias','GET',null,
      '?select=id_categoria,nombre' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
  } catch(eCatRep) {}
  const catNombrePorId = {};
  (categorias||[]).forEach(function(c){ catNombrePorId[c.id_categoria] = c.nombre; });

  // El stock real vive por Área en "inventario_stock_area" -- la columna
  // stock_actual_articulo de inventario_almacen queda desactualizada (no
  // refleja las Entradas certificadas), así que se suma el stock real de
  // todas las Áreas por Artículo.
  let stockPorArticulo = {};
  try {
    const stockAreaRows = await api('inventario_stock_area','GET',null,'?select=id_articulo,stock_actual');
    (stockAreaRows||[]).forEach(function(s) {
      stockPorArticulo[s.id_articulo] = (stockPorArticulo[s.id_articulo]||0) + parseFloat(s.stock_actual||0);
    });
  } catch(eStockAreaRep) { console.warn('Error trayendo stock por Área:', eStockAreaRep); }

  let totalUnidades = 0, totalValor = 0;
  const filasHtml = items.map(function(a) {
    const stock = stockPorArticulo[a.id_articulo] || 0;
    const stockMin = parseFloat(a.stock_minimo_articulo||0);
    const costoUsd = parseFloat(a.precio_costo_moneda||0);
    const ventaUsd = parseFloat(a.precio_venta_moneda||0);
    const precioPromMostrar = monedaVal === 'VES' ? costoUsd * tasaCorte : costoUsd;
    const valorLinea = stock * precioPromMostrar;
    const margen = costoUsd > 0 ? ((ventaUsd - costoUsd) / costoUsd * 100) : null;
    totalUnidades += stock;
    totalValor += valorLinea;

    const consumo90 = consumoPorArticulo[a.id_articulo] || 0;
    const consumoDiario = consumo90 / 90;
    let rotacionHtml;
    if (consumo90 <= 0) {
      rotacionHtml = '<span style="color:var(--suave)">⚪ Sin movimiento</span>';
    } else {
      const diasCobertura = consumoDiario > 0 ? Math.round(stock / consumoDiario) : Infinity;
      const color = diasCobertura < 15 ? '#fc8181' : diasCobertura <= 45 ? '#facc15' : '#22c55e';
      const emoji = diasCobertura < 15 ? '🔴' : diasCobertura <= 45 ? '🟡' : '🟢';
      rotacionHtml = '<span style="color:'+color+'">' + emoji + ' ' + diasCobertura + ' días</span>';
    }

    return '<tr>'
      + '<td style="font-family:var(--font-mono);font-size:15px;color:var(--naranja)">' + escapeHtml(a.codigo_articulo||'—') + '</td>'
      + '<td style="font-size:15px">' + escapeHtml(a.nombre_articulo) + (catNombrePorId[a.id_categoria_articulo] ? '<div style="font-size:11px;color:var(--suave)">' + escapeHtml(catNombrePorId[a.id_categoria_articulo]) + '</div>' : '') + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + stock + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--suave);font-size:15px">' + stockMin + '</td>'
      + '<td style="text-align:center;font-size:15px">' + rotacionHtml + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + (monedaVal==='VES' ? fmtBs(precioPromMostrar) : fmtUSD(precioPromMostrar)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (monedaVal==='VES' ? fmtBs(valorLinea) : fmtUSD(valorLinea)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + (margen !== null ? margen.toFixed(1) + '%' : '—') + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-inv-tbody').innerHTML = filasHtml || '<tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px">No hay Artículos activos</td></tr>';
  document.getElementById('rep-inv-total-unidades').textContent = totalUnidades.toLocaleString('es-VE');
  document.getElementById('rep-inv-total-valor').textContent = (monedaVal==='VES' ? fmtBs(totalValor) + ' Bs' : '$ ' + fmtUSD(totalValor));

  window._reporteInvActual = { items, monedaVal, tasaCorte, fechaCorteVal, catNombrePorId, consumoPorArticulo, stockPorArticulo };
}

function repInventarioExportar() {
  const d = window._reporteInvActual;
  if (!d) return;
  const filas = [['Código','Artículo','Stock','Stock Mínimo','Consumo 90 días','Precio Promedio ('+d.monedaVal+')','Valor Total ('+d.monedaVal+')','Margen %']];
  d.items.forEach(function(a) {
    const stock = d.stockPorArticulo[a.id_articulo] || 0;
    const costoUsd = parseFloat(a.precio_costo_moneda||0);
    const ventaUsd = parseFloat(a.precio_venta_moneda||0);
    const precioProm = d.monedaVal === 'VES' ? costoUsd * d.tasaCorte : costoUsd;
    const margen = costoUsd > 0 ? ((ventaUsd - costoUsd) / costoUsd * 100).toFixed(1) : '';
    filas.push([
      a.codigo_articulo||'', a.nombre_articulo||'', stock, a.stock_minimo_articulo||0,
      d.consumoPorArticulo[a.id_articulo]||0, precioProm.toFixed(2), (stock*precioProm).toFixed(2), margen
    ]);
  });
  const csv = filas.map(function(f){ return f.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reporte_inventario_' + d.fechaCorteVal + '_' + d.monedaVal + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
