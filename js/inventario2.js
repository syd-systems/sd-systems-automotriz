// ─── S&D Systems — Módulo: INVENTARIO2 ───
// ══════════════════════════════════════════════════════════════
//  FASE 3 — INVENTARIO GENERAL
// ══════════════════════════════════════════════════════════════
let inventarioCache = [];

// ─── CLASIFICACIÓN ABC ───
function clasificarABC(items) {
  if (!items.length) return items;
  const conValor = items.map(function(r) {
    return Object.assign({}, r, { valor_inventario: parseFloat(r.precio_venta_usd || 0) * parseFloat(r.stock_actual || 0) });
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
function calcularEOQ(demandaAnual, costoPedido, costoMantenimiento) {
  if (!demandaAnual || !costoPedido || !costoMantenimiento) return null;
  return Math.sqrt((2 * demandaAnual * costoPedido) / costoMantenimiento);
}
function calcularPuntoReorden(r) {
  var lead = parseFloat(r.lead_time_dias || 7);
  var demanda = parseFloat(r.demanda_diaria || (r.demanda_anual ? r.demanda_anual / 365 : 0));
  var stockSeg = parseFloat(r.stock_seguridad || r.stock_minimo || 0);
  return Math.ceil(demanda * lead + stockSeg);
}
function calcularMargen(r) {
  var venta = parseFloat(r.precio_venta_usd || 0);
  if (!venta) return 0;
  return ((venta - parseFloat(r.precio_costo_usd || 0)) / venta * 100);
}
var _invVista = 'tabla';

async function renderInventario(filtro) {
  if (!sesionActual?.administrador && !modulosAcceso.includes('INVENTARIO')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  const panelYaExiste = !!document.getElementById('buscar-inv');
  if (!panelYaExiste) {
    c.innerHTML = '<div class="panel" id="panel-inventario">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 id="inv-contador" style="white-space:nowrap">Inventario General</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<div style="display:flex;gap:3px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:3px">'
      + '<button id="inv-tab-tabla"   onclick="invCambiarVista(\'tabla\')"   class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:var(--naranja);color:#fff">Inventario</button>'
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-abc"     onclick="invCambiarVista(\'abc\')"     class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">Análisis ABC</button>' : '')
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-reorden" onclick="invCambiarVista(\'reorden\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">Reorden</button>' : '')
      + (puedo('INVENTARIO','VER_EOQ_ABC') ? '<button id="inv-tab-eoq"     onclick="invCambiarVista(\'eoq\')"     class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">EOQ</button>' : '')
      + '</div>'
      + '<select id="inv-filtro-cat" onchange="invFiltrarCategoria()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todas las categorías</option>'
      + '<option value="limpieza">🧹 Limpieza</option>'
      + '<option value="oficina">📎 Oficina</option>'
      + '<option value="otro">📦 Otro</option>'
      + '<option value="repuesto">🔧 Artículo</option>'
      + '<option value="venta">🛒 Venta</option>'
      + '</select>'
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
  const tablaCont = document.getElementById('tabla-inv-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    // Por defecto muestra todos — el checkbox "Solo con stock" activa el filtro
    const soloConStock = document.getElementById('inv-mostrar-todos')?.checked || false;
    const itemsTodos = await api('inventario', 'GET', null, '?order=nombre.asc&select=*' + emisorQ());
    const items = itemsTodos.filter(function(r) { return r.activo !== false; });
    const itemsFiltradosBase = soloConStock ? items.filter(function(r) { return parseFloat(r.stock_actual||0) > 0; }) : items;
    inventarioCache = items;
    const catFiltro = document.getElementById('inv-filtro-cat') ? document.getElementById('inv-filtro-cat').value : '';
  var itemsFiltrados = catFiltro
    ? itemsFiltradosBase.filter(function(r) { return (r.categoria || 'repuesto') === catFiltro; })
    : itemsFiltradosBase;
  if (filtro && filtro.trim()) {
    const t = filtro.toLowerCase();
    itemsFiltrados = itemsFiltrados.filter(function(r) {
      return r.nombre.toLowerCase().includes(t) || (r.codigo || '').toLowerCase().includes(t) || (r.descripcion || '').toLowerCase().includes(t);
    });
  }
    const stockBajos = items.filter(function(r) { return parseFloat(r.stock_minimo||0) > 0 && r.stock_actual <= r.stock_minimo; }).length;
    const alertaDiv = document.getElementById('alerta-stock-bajo');
    if (alertaDiv) {
      if (stockBajos > 0) {
        alertaDiv.innerHTML = '<div class="alerta alerta-error" style="display:block;margin:0;border-radius:0">⚠ ' + stockBajos + ' artículo(s) con stock bajo o agotado. Revisar pestaña Reorden.</div>';
        alertaDiv.style.display = 'block';
      } else { alertaDiv.style.display = 'none'; }
    }
    const contador = document.getElementById('inv-contador');
    if (contador) contador.textContent = 'Inventario General (' + itemsFiltrados.length + ')';
    invRenderVista(itemsFiltrados, _invVista);
  } catch(e) {
    const tabla = document.getElementById('tabla-inv-cont');
    if (tabla) tabla.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function invFiltrarCategoria() {
  var cat = document.getElementById('inv-filtro-cat').value;
  var items = cat
    ? inventarioCache.filter(function(r) { return (r.categoria || 'repuesto') === cat; })
    : inventarioCache;
  // Aplicar también filtro de búsqueda si existe
  var buscar = document.getElementById('buscar-inv');
  if (buscar && buscar.value.trim()) {
    var t = buscar.value.toLowerCase();
    items = items.filter(function(r) {
      return r.nombre.toLowerCase().includes(t) || (r.codigo || '').toLowerCase().includes(t);
    });
  }
  var contador = document.getElementById('inv-contador');
  if (contador) contador.textContent = 'Inventario General (' + items.length + ')';
  invRenderVista(items, _invVista);
}

function invCambiarVista(vista) {
  _invVista = vista;
  document.querySelectorAll('.inv-tab').forEach(function(btn) {
    var activo = btn.id === 'inv-tab-' + vista;
    btn.style.background = activo ? 'var(--naranja)' : 'transparent';
    btn.style.color = activo ? '#fff' : 'var(--suave)';
  });
  invRenderVista(inventarioCache, vista);
}

function invRenderVista(items, vista) {
  const cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  if (vista === 'tabla') invRenderTabla(items, cont);
  else if (vista === 'abc') invRenderABC(items, cont);
  else if (vista === 'reorden') invRenderReorden(items, cont);
  else if (vista === 'eoq') invRenderEOQ(items, cont);
}

function invRenderTabla(items, cont) {
  const abcMap = {};
  clasificarABC(inventarioCache).forEach(function(r) { abcMap[r.id_articulo] = r.clase_abc; });
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const filas = items.map(function(r) {
    const stockBajo = parseFloat(r.stock_minimo||0) > 0 && r.stock_actual <= r.stock_minimo;
    const abc = abcMap[r.id_articulo] || '—';
    const margen = calcularMargen(r);
    return '<tr>'
      + '<td><div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:10px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:2px 6px;border-radius:3px">' + abc + '</span>'
      + '<div><div style="font-family:var(--font-mono);font-size:11px;color:var(--suave)">' + (r.codigo || '—')
      + ' · <span style="color:var(--suave)">' + ({'repuesto':'🔧 Artículo','venta':'🛒 Venta','oficina':'📎 Oficina','limpieza':'🧹 Limpieza','otro':'📦 Otro'}[r.categoria] || r.categoria || '🔧 Artículo') + '</span></div>'
      + '<div style="font-weight:500">' + r.nombre + '</div>'
      + (r.descripcion ? '<div style="font-size:11px;color:var(--suave)">' + r.descripcion + '</div>' : '') + '</div></div></td>'
      + '<td><span class="badge ' + (stockBajo ? 'badge-rojo' : 'badge-verde') + '">' + r.stock_actual + ' ' + (r.unidad || 'UND') + '</span>'
      + (stockBajo ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo + ')</div>' : '') + '</td>'
      + (puedo('INVENTARIO','VER_COSTOS')
          ? '<td style="font-family:var(--font-mono);font-size:12px">'
            + '<div style="color:var(--suave);font-size:9px;letter-spacing:1px">COSTO PROM. (CPP)</div>'
            + '<div>$ ' + (parseInt(r.stock_actual) === 0 ? '0.00' : fmtUSD(r.precio_costo_usd)) + '</div>'
            + (r.precio_costo_ultimo_usd
                ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Última compra: $ ' + fmtUSD(r.precio_costo_ultimo_usd) + '</div>'
                : '')
            + '</td>'
          : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
      + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
          ? '<td style="font-family:var(--font-mono);font-size:12px"><div style="color:var(--suave);font-size:10px">Venta</div>'
            + '<span style="color:var(--naranja)">' + fmtBs(parseFloat(r.precio_venta_usd||0) * _tasaVigente) + ' Bs</span>'
            + '<div style="font-size:10px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(r.precio_venta_usd) + '</div>'
            + '<div style="font-size:10px;color:var(--suave);margin-top:2px">Margen: ' + margen.toFixed(1) + '%</div></td>'
          : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
      + '<td><div style="display:flex;gap:8px">'
      + '<button class="btn-secundario" onclick="verFichaInventario(' + r.id_articulo + ')">Ver</button>'
      + '<button class="btn-secundario" style="border-color:rgba(255,107,0,0.4);color:var(--naranja)" onclick="abrirStockArticulo(' + r.id_articulo + ',\'' + r.nombre.replace(/'/g,"\\'"  ) + '\')" >Stock</button>'

      + '</div></td></tr>';
  }).join('');
  cont.innerHTML = '<div class="tabla-container"><table><thead><tr>'
    + '<th>Artículo</th><th>Stock</th><th>Precio Costo</th><th>Precio Venta</th><th>Acción</th>'
    + '</tr></thead><tbody>' + (filas || '<tr><td colspan="5" style="text-align:center;color:var(--suave);padding:32px">Sin artículos registrados</td></tr>') + '</tbody></table></div>';
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
        + '<td style="font-weight:500">' + r.nombre + '</td>'
        + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_actual + ' ' + (r.unidad||'UND') + '</td>'
        + '<td style="font-family:var(--font-mono)">$ ' + fmtUSD(r.precio_venta_usd) + '</td>'
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
    + '<b style="color:var(--naranja)">FIFO / PEPS:</b> El stock existente (ingresado primero) se consume antes que el nuevo. Los items Clase A deben rotarse con mayor control. Registra la fecha de ingreso al editar cada repuesto.</div>'
    + '<div class="tabla-container"><table><thead><tr><th>Clase</th><th>Artículo</th><th style="text-align:center">Stock</th><th>P. Venta</th><th>Valor Inventario</th><th>% Total</th></tr></thead><tbody>'
    + filasHTML + '</tbody></table></div>';
}

function invRenderReorden(items, cont) {
  const filas = items.map(function(r) {
    const pr = calcularPuntoReorden(r);
    const critico = r.stock_actual <= r.stock_minimo;
    const enReorden = !critico && r.stock_actual <= pr;
    const demanda = r.demanda_diaria || (r.demanda_anual ? (r.demanda_anual/365).toFixed(2) : null);
    return '<tr>'
      + '<td><div style="font-weight:500">' + r.nombre + '</div><div style="font-size:10px;color:var(--suave)">' + (r.codigo||'') + '</div></td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_actual + '</td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_minimo + '</td>'
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
    + 'JIT: Pedir solo lo necesario al alcanzar el punto de reorden. Configura Demanda Anual y Lead Time en cada repuesto.</div>'
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Artículo</th><th style="text-align:center">Stock</th><th style="text-align:center">Mínimo</th><th style="text-align:center">Dem./Día</th><th style="text-align:center">Lead Time</th><th style="text-align:center">Punto Reorden</th><th style="text-align:center">Estado</th>'
    + '</tr></thead><tbody>'
    + (filas || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">Sin repuestos</td></tr>')
    + '</tbody></table></div>';
}

function invRenderEOQ(items, cont) {
  const filas = items.map(function(r) {
    var D = parseFloat(r.demanda_anual || 0);
    var S = parseFloat(r.costo_pedido_usd || 25);
    var H = parseFloat(r.precio_costo_usd || 0) * 0.20;
    var eoq = (D && H) ? Math.round(calcularEOQ(D, S, H)) : null;
    var nPed = (eoq && D) ? Math.ceil(D / eoq) : null;
    var ciclo = (nPed && nPed > 0) ? Math.round(365 / nPed) : null;
    return '<tr>'
      + '<td><div style="font-weight:500">' + r.nombre + '</div></td>'
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
    + (filas || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">Sin repuestos</td></tr>')
    + '</tbody></table></div>';
}

function verFichaInventario(id) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER')) {
    alert('No tiene permiso para ver la ficha del artículo.'); return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  _fichaInvActual = { id: r.id_articulo, nombre: r.nombre };

  const abcMap = {};
  clasificarABC(inventarioCache).forEach(function(x) { abcMap[x.id_articulo] = x.clase_abc; });
  const abc = abcMap[r.id_articulo] || '—';
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const margen = ((parseFloat(r.precio_venta_usd||0) - parseFloat(r.precio_costo_usd||0)) / (parseFloat(r.precio_venta_usd||0)||1) * 100).toFixed(1);
  const stockBajo = r.stock_actual <= r.stock_minimo;

  document.getElementById('ficha-inv-contenido').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">'
    + '<span style="font-size:11px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:4px 10px;border-radius:4px">Clase ' + abc + '</span>'
    + '<div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + r.nombre + '</div>'
    + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (r.codigo || 'Sin código') + ' · ' + (r.unidad || 'UND') + '</div>'
    + '</div></div>'
    + (r.descripcion ? '<div style="background:var(--gris2);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--suave)">' + r.descripcion + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Actual</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px;color:' + (stockBajo ? '#fc8181' : 'var(--naranja)') + '">' + r.stock_actual + ' ' + (r.unidad||'UND') + '</div>'
    + (stockBajo ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo + ')</div>' : '') + '</div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Mínimo</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px">' + r.stock_minimo + ' ' + (r.unidad||'UND') + '</div></div>'
    + (puedo('INVENTARIO','VER_COSTOS') ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Costo Prom. (CPP)</div><div style="font-family:var(--font-mono)">$ ' + fmtUSD(r.precio_costo_usd) + '</div></div>' : '')
    + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
        ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio Venta</div>'
          + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + fmtBs(parseFloat(r.precio_venta_usd||0) * _tasaVigente) + ' Bs</div>'
          + '<div style="font-size:11px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(r.precio_venta_usd) + '</div>'
          + '<div style="font-size:10px;color:var(--suave);margin-top:2px">Margen: ' + margen + '%</div></div>'
        : '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio Venta</div>'
          + '<div style="font-size:13px;color:#555">🔒</div></div>')
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Categoría</div>'
    + '<div style="font-size:13px">' + (({'repuesto':'🔧 Artículo','venta':'🛒 Venta','oficina':'📎 Oficina','limpieza':'🧹 Limpieza','otro':'📦 Otro'}[r.categoria]) || r.categoria || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Valor Inventario</div>'
    + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + fmtBs(parseFloat(r.precio_venta_usd||0)*parseFloat(r.stock_actual||0)*_tasaVigente) + ' Bs</div>'
    + '<div style="font-size:11px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(parseFloat(r.precio_venta_usd||0)*parseFloat(r.stock_actual||0)) + '</div></div>'
    + '</div>';

  // Botones de acción en el footer
  var btnEditar = document.getElementById('ficha-inv-btn-editar');
  var btnEliminar = document.getElementById('ficha-inv-btn-eliminar');
  if (btnEditar)  { btnEditar._id = r.id_articulo;  btnEditar.onclick = function() { cerrarModal('modal-ficha-inv'); abrirEditarInventario(this._id); }; btnEditar.style.display = puedo('INVENTARIO','EDITAR') ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = r.id_articulo; btnEliminar._nombre = r.nombre; btnEliminar.onclick = function() { cerrarModal('modal-ficha-inv'); eliminarInventario(this._id, this._nombre); }; btnEliminar.style.display = puedo('INVENTARIO','ELIMINAR') ? '' : 'none'; }

  abrirModal('modal-ficha-inv');
  focusFirstField('modal-ficha-inv');

  // Cargar historial de entradas
  verHistorialEntradas(r.id_articulo);
}

function abrirEntradaStock(id) {
  let r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  // Si no está en caché, usar _fichaInvActual
  if (!r && _fichaInvActual && _fichaInvActual.id === id) {
    r = _fichaInvActual;
    r.id_articulo = id;
  }
  if (!r) { alert('Error: artículo no encontrado. Intente recargar el inventario.'); return; }
  document.getElementById('es-id').value = id;
  document.getElementById('es-nombre').textContent = r.nombre;
  document.getElementById('es-stock-actual').textContent = r.stock_actual + ' ' + (r.unidad || 'UND');
  document.getElementById('es-cantidad').value = '';
  document.getElementById('es-precio-costo').value = '0.00';
  document.getElementById('es-motivo').value = 'compra';
  document.getElementById('es-referencia').value = '';
  // Precio Compra siempre inicia en 0
  document.getElementById('es-precio-costo').value = '0.00';
  document.getElementById('es-precio-venta').value = r.precio_venta_usd || '';
  // Ocultar precio venta si no tiene permiso
  var esVentaCont = document.getElementById('es-precio-venta-cont');
  if (esVentaCont) esVentaCont.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  // Mostrar CPP actual como referencia
  const refCPP = document.getElementById('es-ref-cpp');
  if (refCPP) refCPP.textContent = '$ ' + fmtUSD(r.precio_costo_usd) + ' (CPP actual)';
  document.getElementById('alerta-es-ok').style.display = 'none';
  document.getElementById('alerta-es-err').style.display = 'none';
  // Resetear área, empleado, proveedor y contraseña
  document.getElementById('es-area').value = '';
  if (document.getElementById('es-clave-receptor')) document.getElementById('es-clave-receptor').value = '';
  if (document.getElementById('es-cliente-nombre')) document.getElementById('es-cliente-nombre').value = '';
  if (document.getElementById('es-area-origen'))    document.getElementById('es-area-origen').value = '';
  // Resetear moneda y tasa
  if (document.getElementById('es-moneda-compra'))  document.getElementById('es-moneda-compra').value = 'USD';
  if (document.getElementById('es-tasa-cont'))      document.getElementById('es-tasa-cont').style.display  = 'none';
  if (document.getElementById('es-precio-usd-cont'))document.getElementById('es-precio-usd-cont').style.display = 'none';
  if (document.getElementById('es-tasa-bcv'))       document.getElementById('es-tasa-bcv').value = '';
  if (document.getElementById('es-precio-usd-calc'))document.getElementById('es-precio-usd-calc').value = '';
  document.getElementById('es-empleado').innerHTML = '<option value="">— Seleccionar área primero —</option>';
  document.getElementById('es-proveedor').innerHTML = '<option value="">— Seleccionar proveedor (opcional) —</option>';
  // Cargar áreas y proveedores en paralelo
  Promise.all([
    api('param_areas',  'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
    api('proveedores',  'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif'),
  ]).then(function(res) {
    var areas = res[0], provs = res[1];
    var selArea = document.getElementById('es-area');
    selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
      + areas.map(function(a) { return '<option value="' + a.id + '">' + (a.codigo ? a.codigo + ' — ' : '') + a.nombre + '</option>'; }).join('');
    var selProv = document.getElementById('es-proveedor');
    selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
      + provs.map(function(p) { return '<option value="' + p.id_proveedor + '">' + p.nombre + (p.rif ? ' (' + p.rif + ')' : '') + '</option>'; }).join('');
    // Cargar áreas para transferencia
    var selOrigen = document.getElementById('es-area-origen');
    if (selOrigen) {
      selOrigen.innerHTML = '<option value="">— Seleccionar área de origen —</option>'
        + areas.map(function(a) { return '<option value="' + a.id + '">' + (a.codigo ? a.codigo + ' — ' : '') + a.nombre + '</option>'; }).join('');
    }
    // Inicializar vista según motivo actual
    onCambiarMotivoEntrada();
  }).catch(function(){});
  abrirModal('modal-entrada-stock');
  focusFirstField('modal-entrada-stock');
  setTimeout(function() { document.getElementById('es-cantidad').focus(); }, 100);
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

  const resetBtn = function() {
    window._guardandoEntrada = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'INGRESAR STOCK'; }
  };

  if (cantidad <= 0) {
    errEl.textContent = 'Ingresa una cantidad mayor a 0.';
    errEl.style.display = 'block';
    document.getElementById('es-cantidad')?.focus();
    resetBtn(); return;
  }

  try {
    const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
    const precioIngresado  = parseFloat(document.getElementById('es-precio-costo').value) || 0;
    const monedaCompra     = document.getElementById('es-moneda-compra')?.value || 'USD';
    const tasaBCVVal       = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
    const nuevoPrecioCosto = monedaCompra === 'VES'
      ? (tasaBCVVal > 0 ? parseFloat((precioIngresado / tasaBCVVal).toFixed(4)) : (parseFloat(document.getElementById('es-precio-usd-calc')?.value) || 0))
      : precioIngresado;
    if (monedaCompra === 'VES' && precioIngresado > 0 && nuevoPrecioCosto <= 0) {
      errEl.textContent = 'No se encontró tasa BCV para convertir el precio.';
      errEl.style.display = 'block';
      document.getElementById('es-precio-costo')?.focus();
      resetBtn(); return;
    }
    const moneda_compra_val      = monedaCompra;
    const precio_compra_original = precioIngresado;
    const tasa_bcv_usada         = monedaCompra === 'VES' ? (tasaBCVVal || null) : null;
    const nuevoPrecioVenta       = parseFloat(document.getElementById('es-precio-venta').value) || null;

    // ── FASE 1: Todas las validaciones ANTES de tocar BD ──
    const motivoEnt = document.getElementById('es-motivo')?.value;
    if (motivoEnt === 'compra') {
      const idProvVal = document.getElementById('es-proveedor')?.value;
      if (!idProvVal) { errEl.textContent = 'Debe seleccionar el proveedor.'; errEl.style.display = 'block'; document.getElementById('es-proveedor')?.focus(); resetBtn(); return; }
    } else if (motivoEnt === 'devolucion') {
      const clienteNom = document.getElementById('es-cliente-nombre')?.value.trim();
      if (!clienteNom) { errEl.textContent = 'Debe ingresar el nombre del cliente.'; errEl.style.display = 'block'; document.getElementById('es-cliente-nombre')?.focus(); resetBtn(); return; }
    } else if (motivoEnt === 'transferencia') {
      const idOrigenVal = document.getElementById('es-area-origen')?.value;
      if (!idOrigenVal) { errEl.textContent = 'Debe seleccionar el área de origen.'; errEl.style.display = 'block'; document.getElementById('es-area-origen')?.focus(); resetBtn(); return; }
    }
    const idAreaEntVal = document.getElementById('es-area')?.value;
    if (!idAreaEntVal) { errEl.textContent = 'Debe seleccionar el Área Receptora.'; errEl.style.display = 'block'; document.getElementById('es-area')?.focus(); resetBtn(); return; }
    const idEmpEntVal = parseInt(document.getElementById('es-empleado')?.value) || null;
    if (!idEmpEntVal) { errEl.textContent = 'Debe seleccionar el empleado receptor.'; errEl.style.display = 'block'; document.getElementById('es-empleado')?.focus(); resetBtn(); return; }
    const claveEnt = document.getElementById('es-clave-receptor')?.value || '';
    if (!claveEnt) { errEl.textContent = 'El empleado receptor debe ingresar su contraseña.'; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }
    const validEnt = await validarClaveReceptor(idEmpEntVal, claveEnt);
    if (!validEnt.ok) { errEl.textContent = validEnt.msg; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }

    // ── FASE 2: Leer stock fresco de BD (única fuente de verdad) ──
    let stockActual = parseFloat(r?.stock_actual || 0);
    let costoActual = parseFloat(r?.precio_costo_usd || 0);
    const artFresh = await api('inventario', 'GET', null, '?id_articulo=eq.' + id + '&select=stock_actual,precio_costo_usd');
    if (artFresh && artFresh[0]) {
      stockActual = parseFloat(artFresh[0].stock_actual || 0);
      costoActual = parseFloat(artFresh[0].precio_costo_usd || 0);
    }
    const nuevoStock = stockActual + cantidad;

    // CPP
    var cpp = costoActual;
    if (nuevoPrecioCosto > 0) {
      cpp = nuevoStock > 0
        ? ((stockActual * costoActual) + (cantidad * nuevoPrecioCosto)) / nuevoStock
        : nuevoPrecioCosto;
    }

    // ── FASE 3: Registrar entrada en historial ──
    const idAreaEnt  = parseInt(idAreaEntVal) || null;
    const idProvEnt  = (motivoEnt === 'compra') ? (parseInt(document.getElementById('es-proveedor')?.value) || null) : null;
    const clienteNomH  = (motivoEnt === 'devolucion') ? (document.getElementById('es-cliente-nombre')?.value.trim() || null) : null;
    const idAreaOrigenH = (motivoEnt === 'transferencia') ? (parseInt(document.getElementById('es-area-origen')?.value) || null) : null;

    let idEntrada = null;
    const entradaRes = await api('stock_entradas', 'POST', {
      id_articulo:            id,
      cantidad:               cantidad,
      precio_costo_usd:       nuevoPrecioCosto || null,
      precio_compra_original: precio_compra_original || null,
      moneda_compra:          moneda_compra_val,
      tasa_bcv:               tasa_bcv_usada,
      fecha_entrada:          getHoyVzla(),
      id_area:                idAreaEnt,
      id_empleado:            idEmpEntVal,
      id_proveedor:           idProvEnt,
      cliente_nombre:         clienteNomH,
      id_area_origen:         idAreaOrigenH,
      observaciones:          document.getElementById('es-observaciones')?.value.trim() || null,
      id_usuario:             sesionActual.correo_usuario
    });
    idEntrada = entradaRes && entradaRes[0] ? entradaRes[0].id_entrada : null;

    // ── FASE 4: Actualizar stock e inventario DESPUÉS del INSERT exitoso ──
    const patch = { stock_actual: nuevoStock, precio_costo_usd: parseFloat(cpp.toFixed(4)) };
    if (nuevoPrecioCosto > 0) patch.precio_costo_ultimo_usd = nuevoPrecioCosto;
    if (nuevoPrecioVenta && nuevoPrecioVenta > 0 && puedo('INVENTARIO','VER_PRECIOS_VENTA')) patch.precio_venta_usd = nuevoPrecioVenta;
    await api('inventario', 'PATCH', patch, '?id_articulo=eq.' + id);

    // ── FASE 5: Asiento contable ──
    try {
      const areaNombreEnt = document.getElementById('es-area')?.selectedOptions[0]?.text || 'Área';
      const tipoAst = motivoEnt === 'compra' ? 'ENTRADA_COMPRA'
                    : motivoEnt === 'devolucion' ? 'ENTRADA_DEVOLUCION'
                    : 'ENTRADA_AJUSTE';
      await generarAsientoInventario(tipoAst, {
        articulo:   r.nombre || r.codigo || ('Art#' + id),
        cantidad:   cantidad,
        montoUSD:   nuevoPrecioCosto * cantidad,
        areaId:     idAreaEnt,
        areaNombre: areaNombreEnt,
        referencia: idEntrada ? 'ENT-' + idEntrada : ('ENT-INV-' + id)
      });
    } catch(eAstInv) { console.warn('Error asiento entrada inventario:', eAstInv); }

    // ── FASE 6: Actualizar cache y cerrar ──
    if (r) r.stock_actual = nuevoStock;
    okEl.textContent = 'Stock actualizado: ' + stockActual + ' → ' + nuevoStock + ' ' + (r?.unidad || 'UND');
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-entrada-stock');
      regresarAFichaInv();
      resetBtn();
    }, 1200);

  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    resetBtn();
  }
}

function abrirNuevoInventario() {
  document.getElementById('inv-categoria').value = 'repuesto';
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) infoEl.style.display = 'none';
  setTimeout(function() {
    const body = document.querySelector('#modal-inventario .modal-body');
    if (body) { body.scrollTop = 0; }
    const overlay = document.getElementById('modal-inventario');
    if (overlay) overlay.scrollTop = 0;
  }, 80);
  ['inv-id','inv-codigo','inv-nombre','inv-descripcion','inv-stock','inv-stock-min','inv-costo','inv-venta','inv-demanda-anual','inv-lead-time','inv-costo-pedido','inv-stock-seg'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('inv-unidad').value = 'UND';
  var invVentaContN = document.getElementById('inv-venta-cont');
  if (invVentaContN) invVentaContN.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  document.getElementById('modal-inv-titulo').textContent = 'NUEVO ARTÍCULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';
  abrirModal('modal-inventario');
  focusFirstField('modal-inventario');
}

function abrirEditarInventario(id) {
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  document.getElementById('inv-id').value = r.id_articulo;
  document.getElementById('inv-codigo').value = r.codigo || '';
  document.getElementById('inv-nombre').value = r.nombre;
  document.getElementById('inv-descripcion').value = r.descripcion || '';
  document.getElementById('inv-stock').value = r.stock_actual;
  document.getElementById('inv-stock-min').value = r.stock_minimo;
  document.getElementById('inv-costo').value = r.precio_costo_usd || '';
  document.getElementById('inv-venta').value = r.precio_venta_usd || '';
  var invVentaCont = document.getElementById('inv-venta-cont');
  if (invVentaCont) invVentaCont.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  document.getElementById('inv-unidad').value = r.unidad || 'UND';
  document.getElementById('inv-categoria').value = r.categoria || 'repuesto';
  document.getElementById('inv-demanda-anual').value = r.demanda_anual || '';
  document.getElementById('inv-lead-time').value = r.lead_time_dias || '';
  document.getElementById('inv-costo-pedido').value = r.costo_pedido_usd || '';
  document.getElementById('inv-stock-seg').value = r.stock_seguridad || '';
  document.getElementById('modal-inv-titulo').textContent = 'EDITAR ARTÍCULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';
  // En edición mostrar stock actual y precio costo como info (solo lectura)
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) {
    infoEl.style.display = '';
    document.getElementById('inv-info-stock-val').textContent = r.stock_actual + ' ' + (r.unidad || 'UND');
    document.getElementById('inv-info-costo-val').textContent = '$ ' + parseFloat(r.precio_costo_usd || 0).toFixed(2) + ' (CPP)';
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
  const nombre   = document.getElementById('inv-nombre').value.trim();
  const desc     = document.getElementById('inv-descripcion').value.trim();
  const stock    = parseInt(document.getElementById('inv-stock').value) || 0;
  const stockMin = parseInt(document.getElementById('inv-stock-min').value) || 0;
  const costo    = parseFloat(document.getElementById('inv-costo').value) || 0;
  const venta    = parseFloat(document.getElementById('inv-venta').value) || 0;
  const unidad   = document.getElementById('inv-unidad').value;
  const okEl     = document.getElementById('alerta-inv-ok');
  const errEl    = document.getElementById('alerta-inv-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }

  try {
    const demandaAnual = parseInt(document.getElementById('inv-demanda-anual').value) || null;
    const leadTime     = parseInt(document.getElementById('inv-lead-time').value) || null;
    const costoPedido  = parseFloat(document.getElementById('inv-costo-pedido').value) || null;
    const stockSeg     = parseInt(document.getElementById('inv-stock-seg').value) || 0;
    const categoria = document.getElementById('inv-categoria').value || 'repuesto';
    const ventaFinal = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? venta : undefined;
    const datos = { nombre, descripcion: desc || null, codigo: codigo || null, stock_actual: stock,
      stock_minimo: stockMin, precio_costo_usd: costo, activo: true,
      id_emisor: _empresaActiva ? _empresaActiva.id_emisor : null, ...(ventaFinal !== undefined ? { precio_venta_usd: ventaFinal } : {}), unidad, categoria,
      demanda_anual: demandaAnual, lead_time_dias: leadTime, costo_pedido_usd: costoPedido, stock_seguridad: stockSeg,
      id_usuario: sesionActual.correo_usuario };
    if (id) {
      await api('inventario', 'PATCH', datos, '?id_articulo=eq.' + id);
    } else {
      await api('inventario', 'POST', datos);
    }
    okEl.textContent = '✓ Artículo guardado.'; okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-inventario'); document.getElementById('contenido-principal').innerHTML=''; renderInventario(); }, 1000);
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
}

async function eliminarInventario(id, nombre) {
  if (!puedo('INVENTARIO','ELIMINAR')) { alert('No tiene permiso para eliminar artículos.'); return; }
  try {
    const [entradas, salidas] = await Promise.all([
      api('stock_entradas', 'GET', null, '?id_articulo=eq.' + id + '&select=id_entrada&limit=1'),
      api('os_repuestos',   'GET', null, '?id_articulo=eq.' + id + '&select=id_os_rep&limit=1')
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
    await api('inventario', 'DELETE', null, '?id_articulo=eq.' + id);
    document.getElementById('contenido-principal').innerHTML = '';
    renderInventario();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── HISTORIAL DE ENTRADAS ───
async function verHistorialEntradas(idArticulo) {
  const cont = document.getElementById('ficha-inv-historial');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--suave);font-size:12px">Cargando...</div>';
  try {
    const entradas = await api('stock_entradas', 'GET', null,
      '?id_articulo=eq.' + idArticulo + '&order=fecha_entrada.desc&select=*');
    if (!entradas || !entradas.length) {
      cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:8px 0">Sin entradas registradas.</div>';
      return;
    }
    const motivoLabel = { compra:'Compra', devolucion:'Devolución', transferencia:'Transferencia', ajuste:'Ajuste' };
    cont.innerHTML = '<div style="margin-top:16px;border-top:1px solid var(--borde);padding-top:12px">'
      + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;margin-bottom:8px">HISTORIAL DE ENTRADAS</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr style="border-bottom:1px solid var(--borde)">'
      + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">FECHA</th>'
      + '<th style="text-align:right;padding:6px 4px;color:var(--suave);font-size:10px">CANT</th>'
      + '<th style="text-align:right;padding:6px 4px;color:var(--suave);font-size:10px">PRECIO</th>'
      + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">MOTIVO</th>'
      + '<th style="text-align:center;padding:6px 4px;color:var(--suave);font-size:10px">ESTADO</th>'
      + '<th style="padding:6px 4px"></th>'
      + '</tr></thead><tbody>'
      + entradas.map(function(e) {
          const mon  = (e.moneda_compra || 'USD').toUpperCase();
          const prec = parseFloat(e.precio_compra_original || e.precio_costo_usd || 0);
          const precFmt = mon === 'VES' ? fmtBs(prec) + ' Bs' : '$ ' + fmtUSD(prec) + ' ' + mon;
          const estado = e.reversada
            ? '<span style="color:#fc8181;font-size:10px">Reversada</span>'
            : '<span style="color:#22c55e;font-size:10px">Activa</span>';
          const btnRev = !e.reversada && puedo('INVENTARIO','ELIMINAR')
            ? '<button onclick="reversarEntrada(' + e.id_entrada + ',' + idArticulo + ',' + e.cantidad + ')" '
              + 'style="background:rgba(252,129,129,0.1);border:1px solid rgba(252,129,129,0.3);color:#fc8181;'
              + 'border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">Reversar</button>'
            : '';
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">'
            + '<td style="padding:6px 4px">' + fmtFecha(e.fecha_entrada) + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + e.cantidad + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + precFmt + '</td>'
            + '<td style="padding:6px 4px">' + (motivoLabel[e.motivo] || e.motivo || '—') + '</td>'
            + '<td style="text-align:center;padding:6px 4px">' + estado + '</td>'
            + '<td style="padding:6px 4px">' + btnRev + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch(e) {
    cont.innerHTML = '<div style="color:#fc8181;font-size:12px">Error: ' + e.message + '</div>';
  }
}

// ─── REVERSAR ENTRADA ───
async function reversarEntrada(idEntrada, idArticulo, cantidad) {
  if (!confirm('¿Reversar esta entrada?\n\nSe restarán ' + cantidad + ' unidades del stock y se anulará el asiento contable.\nEsta acción no se puede deshacer.')) return;
  try {
    // 1. Stock actual fresco
    const artFresh = await api('inventario', 'GET', null, '?id_articulo=eq.' + idArticulo + '&select=stock_actual');
    const stockActual = artFresh && artFresh[0] ? parseFloat(artFresh[0].stock_actual) : 0;
    const nuevoStock  = Math.max(0, stockActual - parseFloat(cantidad));
    // 2. Rebajar stock y limpiar precios si queda en 0
    const patchDatos = { stock_actual: nuevoStock };
    if (nuevoStock === 0) {
      patchDatos.precio_costo_usd  = 0;
      patchDatos.precio_venta_usd  = 0;
    }
    await api('inventario', 'PATCH', patchDatos, '?id_articulo=eq.' + idArticulo);
    // 3. Marcar entrada como reversada
    await api('stock_entradas', 'PATCH',
      { reversada: true, id_usuario_reversa: sesionActual.correo_usuario },
      '?id_entrada=eq.' + idEntrada);
    // 4. Anular asiento contable vinculado (soporta formato ENT-{id} y ENT-INV-{id_articulo})
    try {
      // Buscar por formato nuevo ENT-{idEntrada}
      let asientos = await api('cont_asientos', 'GET', null,
        '?referencia=eq.ENT-' + idEntrada + emisorQ() + '&select=id_asiento,numero_asiento');
      // Fallback: formato antiguo ENT-INV-{idArticulo}
      if (!asientos || !asientos.length) {
        asientos = await api('cont_asientos', 'GET', null,
          '?referencia=eq.ENT-INV-' + idArticulo + emisorQ() + '&select=id_asiento,numero_asiento');
      }
      for (var i = 0; i < asientos.length; i++) {
        await api('cont_asientos', 'PATCH',
          { estado: 'ANULADO', descripcion: '[REVERSADO] ' + (asientos[i].numero_asiento || '') },
          '?id_asiento=eq.' + asientos[i].id_asiento);
      }
      if (!asientos || !asientos.length) console.warn('No se encontró asiento para reversar. idEntrada:', idEntrada);
    } catch(eAst) { console.warn('Error anulando asiento:', eAst); }
    // 5. Actualizar cache
    const cached = inventarioCache.find(function(x) { return x.id_articulo === idArticulo; });
    if (cached) cached.stock_actual = nuevoStock;
    alert('Entrada reversada. Stock: ' + stockActual + ' → ' + nuevoStock);
    verHistorialEntradas(idArticulo);
    verFichaInventario(idArticulo);
  } catch(e) { alert('Error al reversar: ' + e.message); }
}
