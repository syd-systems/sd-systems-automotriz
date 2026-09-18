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
  const monedaVal = document.getElementById('rep-inv-moneda')?.value || 'VES';

  cont.innerHTML =
    '<div style="padding:16px 24px">'
    + '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--borde)">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Fecha de Corte</label>'
    + '<input type="date" id="rep-inv-fecha" value="' + fechaCorteVal + '" max="' + getHoyVzla() + '" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none"></div>'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Moneda</label>'
    + '<select id="rep-inv-moneda" onchange="repInventarioRender(document.getElementById(\'reportes-contenido\'))" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none">'
    + '<option value="VES"' + (monedaVal==='VES'?' selected':'') + '>VES</option>'
    + '<option value="USD"' + (monedaVal==='USD'?' selected':'') + '>USD</option>'
    + '</select></div>'
    + '<div id="rep-inv-tasa-info" style="font-size:12px;color:var(--suave);font-family:var(--font-mono)">Cargando tasa...</div>'
    + '<div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end">'
    + '<div><label style="display:block;font-size:11px;color:var(--suave);margin-bottom:4px">Formato</label>'
    + '<select id="rep-inv-formato" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none">'
    + '<option value="csv">CSV</option>'
    + '<option value="excel">Excel (.xlsx)</option>'
    + '<option value="pdf">PDF</option>'
    + '</select></div>'
    + '<button class="btn-secundario" onclick="repInventarioExportar()">⬇ Exportar</button>'
    + '</div>'
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
    + '<thead><tr id="rep-inv-thead-row">'
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

  let totalUnidades = 0, totalValor = 0;
  const filas = items.map(function(a) {
    const stock = stockPorArticulo[a.id_articulo] || 0;
    const stockMin = parseFloat(a.stock_minimo_articulo||0);
    const costoUsd = parseFloat(a.precio_costo_moneda||0);
    const precioPromMostrar = monedaVal === 'VES' ? costoUsd * tasaCorte : costoUsd;
    const valorLinea = stock * precioPromMostrar;
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
      valorLinea: valorLinea, margen: margen
    };
  });

  document.getElementById('rep-inv-total-unidades').textContent = totalUnidades.toLocaleString('es-VE');
  document.getElementById('rep-inv-total-valor').textContent = (monedaVal==='VES' ? fmtBs(totalValor) + ' Bs' : '$ ' + fmtUSD(totalValor));

  window._reporteInvActual = { items, monedaVal, tasaCorte, fechaCorteVal, catNombrePorId, consumoPorArticulo, stockPorArticulo, filas };
  _repInvOrdenCol = _repInvOrdenCol || null;
  _repInvOrdenAsc = _repInvOrdenAsc !== false;
  _repInvRenderTabla();
}

// ── Ordenamiento de columnas (clic en el encabezado) ──
let _repInvOrdenCol = null;
let _repInvOrdenAsc = true;
const REP_INV_COLUMNAS = [
  { campo: 'codigo',        tipo: 'texto',  label: 'Código',       ancho: '11%' },
  { campo: 'nombre',        tipo: 'texto',  label: 'Artículo',     ancho: '22%' },
  { campo: 'stock',         tipo: 'numero', label: 'Stock',        ancho: '9%'  },
  { campo: 'stockMin',      tipo: 'numero', label: 'Stock Mín.',   ancho: '10%' },
  { campo: 'diasCobertura', tipo: 'numero', label: 'Rotación',     ancho: '14%' },
  { campo: 'precioProm',    tipo: 'numero', label: 'Precio Prom.', ancho: '12%' },
  { campo: 'valorLinea',    tipo: 'numero', label: 'Valor Total',  ancho: '12%' },
  { campo: 'margen',        tipo: 'numero', label: 'Margen',       ancho: '10%' },
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
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + (monedaVal==='VES' ? fmtBs(f.precioProm) : fmtUSD(f.precioProm)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);color:var(--naranja);font-weight:600;font-size:15px">' + (monedaVal==='VES' ? fmtBs(f.valorLinea) : fmtUSD(f.valorLinea)) + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:15px">' + (f.margen !== null ? f.margen.toFixed(1) + '%' : '—') + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('rep-inv-tbody').innerHTML = filasHtml || '<tr><td colspan="8" style="text-align:center;color:var(--suave);padding:32px">No hay Artículos activos</td></tr>';
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
  const encabezados = ['Código','Artículo','Stock','Stock Mínimo','Rotación (días)','Precio Promedio','Valor Total','Margen %'];
  const fmtMoneda = d.monedaVal === 'VES' ? fmtBs : fmtUSD;
  const filasNumericas = d.filas.map(function(f) {
    return [
      f.codigo, f.nombre, f.stock, f.stockMin,
      f.diasCobertura !== null ? f.diasCobertura : 0, f.precioProm, f.valorLinea,
      f.margen !== null ? f.margen : 0
    ];
  });
  const filasTexto = d.filas.map(function(f) {
    return [
      f.codigo, f.nombre, f.stock, f.stockMin,
      f.diasCobertura !== null ? f.diasCobertura : 0, fmtMoneda(f.precioProm), fmtMoneda(f.valorLinea),
      (f.margen !== null ? f.margen : 0).toFixed(1) + '%'
    ];
  });
  return { d, encabezados, filasNumericas, filasTexto };
}

function _repInvExportarCSV() {
  const dat = _repInvDatosExportar();
  if (!dat) return;
  const filasCsv = [dat.encabezados].concat(dat.filasTexto);
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
  const FILA_ENCAB = 3, FILA_DATOS_DESDE = 4;
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Reporte de Inventario'],
    ['Fecha de Corte: ' + dat.d.fechaCorteVal + '   |   Moneda: ' + dat.d.monedaVal + (dat.d.monedaVal === 'VES' ? '   |   Tasa BCV: ' + dat.d.tasaCorte : '')],
    [],
    dat.encabezados,
  ].concat(dat.filasNumericas));
  hoja['!cols'] = [ {wch:14}, {wch:38}, {wch:10}, {wch:12}, {wch:14}, {wch:16}, {wch:16}, {wch:10} ];

  // Encabezados centrados; columnas numéricas (2 a 7) con formato de
  // celda -- el valor sigue siendo un número real (se puede sumar/
  // filtrar en Excel), solo cambia cómo se ve. El código del formato usa
  // la sintaxis estándar de Excel (coma miles, punto decimal); Excel lo
  // traduce solo a "1.000,00" según el idioma/región configurado en el
  // Excel de quien lo abre -- esa traducción automática es de Excel, no
  // de este archivo. Stock/Stock Mínimo/Rotación sin decimales.
  const NUM_FILAS = dat.filasNumericas.length;
  for (let col = 0; col < 8; col++) {
    const refEncab = XLSX.utils.encode_cell({ r: FILA_ENCAB, c: col });
    if (hoja[refEncab]) hoja[refEncab].s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true } };
    if (col < 2) continue; // Código y Artículo: texto, sin formato numérico
    const formatoNum = (col === 5 || col === 6) ? '#,##0.00' : (col === 7 ? '0.0"%"' : '#,##0');
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
    + (dat.d.monedaVal === 'VES' ? '   |   Tasa BCV: ' + dat.d.tasaCorte : ''), 14, 21);
  doc.autoTable({
    head: [dat.encabezados],
    body: dat.filasTexto,
    startY: 26,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [255, 107, 0], halign: 'center' },
    // Columnas numéricas (Stock en adelante) alineadas a la derecha;
    // Código y Artículo (0 y 1) se quedan como vienen (izquierda).
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
    },
  });
  doc.save('reporte_inventario_' + dat.d.fechaCorteVal + '_' + dat.d.monedaVal + '.pdf');
}
