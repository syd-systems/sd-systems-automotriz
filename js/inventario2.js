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
  var stockSeg = parseFloat(r.stock_seguridad || r.stock_minimo || 0);
  return Math.ceil(demanda * lead + stockSeg);
}
function calcularMargen(r) {
  var venta = parseFloat(r.precio_venta_usd || 0);
  if (!venta) return 0;
  return ((venta - parseFloat(r.precio_costo_usd || 0)) / venta * 100);
}
var _invVista = 'tabla';


// ── Calcular saldo por área del usuario actual ──
async function calcularInvSaldoArea() {
  if (sesionActual?.administrador || puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) {
    _invSaldoArea = null; // Admins ven todo
    return;
  }
  try {
    const correo = sesionActual?.correo_usuario;
    if (!correo) { _invSaldoArea = null; return; }

    const empRes = await Promise.race([
      api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(correo)+'&select=id_area&limit=1'),
      new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); }, 4000); })
    ]).catch(function(){ return []; });

    const idAreaUsuario = empRes?.[0]?.id_area || null;
    if (!idAreaUsuario) { _invSaldoArea = {}; return; }

    // Obtener todos los artículos del emisor
    const arts = inventarioCache.length > 0 ? inventarioCache
      : await api('inventario','GET',null,'?order=nombre.asc&select=id_articulo' + emisorQ()) || [];
    if (!arts.length) { _invSaldoArea = {}; return; }

    const inClause = arts.map(function(r){ return r.id_articulo; }).join(',');
    const t4s = function(){ return new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); },4000); }); };

    const [entsDirectas, salsRecibidas, salsEnviadas] = await Promise.all([
      Promise.race([api('stock_entradas','GET',null,'?id_area=eq.'+idAreaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
      Promise.race([api('stock_salidas','GET',null,'?id_area_entrega=eq.'+idAreaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
      Promise.race([api('stock_salidas','GET',null,'?id_area=eq.'+idAreaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; })
    ]);

    const saldo = {};
    (entsDirectas||[]).forEach(function(e){ saldo[e.id_articulo] = (saldo[e.id_articulo]||0) + parseFloat(e.cantidad||0); });
    // salsRecibidas: transferencias donde mi área es el ORIGEN (id_area_entrega=yo) → son salidas de mi stock
    (salsRecibidas||[]).forEach(function(s){ saldo[s.id_articulo] = (saldo[s.id_articulo]||0) - parseFloat(s.cantidad||0); });
    // salsEnviadas: transferencias donde mi área es el DESTINO (id_area=yo) → son entradas a mi stock
    (salsEnviadas||[]).forEach(function(s){ saldo[s.id_articulo] = (saldo[s.id_articulo]||0) + parseFloat(s.cantidad||0); });
    _invSaldoArea = saldo;
  } catch(e) {
    console.warn('calcularInvSaldoArea error:', e);
    _invSaldoArea = null;
  }
}

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
      + (puedo('INVENTARIO','VER_MOVIMIENTOS') ? '<button id="inv-tab-movimientos" onclick="invCambiarVista(\'movimientos\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">📋 Movimientos</button>' : '')
      + (puedo('INVENTARIO','VER_CATEGORIAS') ? '<button id="inv-tab-categorias" onclick="invCambiarVista(\'categorias\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">📦 Categorías</button>' : '')
      + (puedo('INVENTARIO','VER_TIPOS') ? '<button id="inv-tab-tipos" onclick="invCambiarVista(\'tipos\')" class="inv-tab" style="font-size:11px;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:var(--suave)">🔩 Tipos</button>' : '')
      + '</div>'
      + '<select id="inv-filtro-cat" onchange="invFiltrarCategoria()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todas las categorías</option>'
      + (_invCategoriasCache.map ? _invCategoriasCache.map(function(c){ return '<option value="'+c.id+'">'+c.nombre+'</option>'; }).join('') : '')
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
  // Si estamos en vista movimientos, no recargar la tabla
  if (_invVista === 'movimientos' || _invVista === 'categorias' || _invVista === 'tipos') return;

  try {
    // Por defecto muestra todos — el checkbox "Solo con stock" activa el filtro
    const soloConStock = document.getElementById('inv-mostrar-todos')?.checked || false;
    // Cargar cache de categorías si está vacío (para filtro y tabla)
    if (!_invCategoriasCache || !_invCategoriasCache.length) {
      try {
        _invCategoriasCache = await api('inv_categorias','GET',null,
          '?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_emisor=eq.'+_empresaActiva.id_emisor : '')) || [];
        // Actualizar opciones del filtro si ya existe
        const selCat = document.getElementById('inv-filtro-cat');
        if (selCat && _invCategoriasCache.length) {
          const optsExtra = _invCategoriasCache.map(function(c){
            return '<option value="'+c.id+'">'+c.nombre+'</option>';
          }).join('');
          if (!selCat.innerHTML.includes(optsExtra)) {
            selCat.innerHTML = '<option value="">Todas las categorías</option>' + optsExtra;
          }
        }
      } catch(e) {}
    }
    const itemsTodos = await api('inventario', 'GET', null, '?order=nombre.asc&select=*' + emisorQ()) || [];
    const items = itemsTodos.filter(function(r) { return r.activo !== false; });
    const itemsFiltradosBase = soloConStock ? items.filter(function(r) { return parseFloat(r.stock_actual||0) > 0; }) : items;
    inventarioCache = items;

    // ── Filtro por área si no tiene VER_INVENTARIO_GENERAL ──
    let itemsFiltradosBase2 = itemsFiltradosBase;
    // Calcular saldo por área (función centralizada)
    await calcularInvSaldoArea();
    if (_invSaldoArea) {
      itemsFiltradosBase2 = itemsFiltradosBase.filter(function(r) {
        return (_invSaldoArea[r.id_articulo]||0) > 0;
      });
    }

    const catFiltro = document.getElementById('inv-filtro-cat') ? document.getElementById('inv-filtro-cat').value : '';
  var itemsFiltrados = catFiltro
    ? itemsFiltradosBase2.filter(function(r) { return String(r.id_categoria) === String(catFiltro); })
    : itemsFiltradosBase2;
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
    ? inventarioCache.filter(function(r) { return String(r.id_categoria) === String(catId); })
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
    btnNuevo.style.display = (vista === 'categorias' || vista === 'tipos') ? 'none' : '';
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
      + (r.id_categoria ? ' · <span style="color:var(--suave)">' + (_invCategoriasCache.find(function(c){return c.id===r.id_categoria;})?.nombre || '') + '</span>' : '')
      + '</div>'
      + '<div style="font-weight:500">' + r.nombre + '</div>'
      + (r.descripcion ? '<div style="font-size:11px;color:var(--suave)">' + r.descripcion + '</div>' : '') + '</div></div></td>'
      + (function() {
          const stockMostrar = _invSaldoArea ? (_invSaldoArea[r.id_articulo]||0) : r.stock_actual;
          const stockBajoArea = parseFloat(r.stock_minimo||0) > 0 && stockMostrar <= r.stock_minimo;
          return '<td><span class="badge ' + (stockBajoArea ? 'badge-rojo' : 'badge-verde') + '">' + stockMostrar + ' ' + (r.unidad || 'UND') + '</span>'
            + (_invSaldoArea ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Stock área</div>' : '')
            + (stockBajoArea ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo + ')</div>' : '') + '</td>';
        })()
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
      + '<td><div style="display:flex;gap:6px">'
      + '<button class="btn-secundario" onclick="verFichaInventario(' + r.id_articulo + ')">Ver</button>'
      + (puedo('INVENTARIO','ENTRADA_STOCK') ? '<button class="btn-secundario" style="border-color:rgba(255,107,0,0.4);color:var(--naranja)" onclick="abrirStockArticulo(' + r.id_articulo + ',\'' + r.nombre.replace(/'/g,"\\'"  ) + '\')" >Stock</button>' : '')
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
    + '<div style="font-family:var(--font-mono);font-size:18px;color:' + (stockBajo ? '#fc8181' : 'var(--naranja)') + '">' + (_invSaldoArea ? (_invSaldoArea[r.id_articulo]||0) : r.stock_actual) + ' ' + (r.unidad||'UND') + '</div>'
    + (_invSaldoArea ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Stock en tu área</div>' : '')
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
    + '<div style="font-size:13px">' + (_invCategoriasCache.find(function(c){return c.id===r.id_categoria;})?.nombre || r.categoria || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Valor Inventario</div>'
    + '</div>';

  // Botones de acción en el footer
  var btnEditar = document.getElementById('ficha-inv-btn-editar');
  var btnEliminar = document.getElementById('ficha-inv-btn-eliminar');
  if (btnEditar)  { btnEditar._id = r.id_articulo;  btnEditar.onclick = function() { cerrarModal('modal-ficha-inv'); abrirEditarInventario(this._id); }; btnEditar.style.display = puedo('INVENTARIO','EDITAR') ? '' : 'none'; }
  if (btnEliminar) {
    btnEliminar._id = r.id_articulo; btnEliminar._nombre = r.nombre;
    btnEliminar.onclick = function() { cerrarModal('modal-ficha-inv'); eliminarInventario(this._id, this._nombre); };
    btnEliminar.style.display = 'none'; // oculto por defecto, se muestra solo si no tiene entradas
    if (puedo('INVENTARIO','ELIMINAR')) {
      api('stock_entradas','GET',null,'?id_articulo=eq.'+r.id_articulo+'&select=id_entrada&limit=1').then(function(ents) {
        if (!ents || !ents.length) {
          btnEliminar.style.display = '';
          btnEliminar.title = '';
        } else {
          // Mostrar mensaje explicativo debajo del historial
          const msgEl = document.getElementById('ficha-inv-msg-eliminar');
          if (msgEl) {
            msgEl.textContent = '⚠ Este artículo no puede eliminarse porque tiene movimientos de stock registrados. Para darlo de baja, márquelo como inactivo desde Editar.';
            msgEl.style.display = 'block';
          }
        }
      });
    }
  }

  abrirModal('modal-ficha-inv');
  focusFirstField('modal-ficha-inv');

  // Cargar historial de entradas y salidas
  verHistorialEntradas(r.id_articulo);
  verHistorialSalidas(r.id_articulo);
}

async function abrirEntradaStock(id) {
  let r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  // Si no está en caché, usar _fichaInvActual
  if (!r && _fichaInvActual && _fichaInvActual.id === id) {
    r = _fichaInvActual;
    r.id_articulo = id;
  }
  if (!r) { alert('Error: artículo no encontrado. Intente recargar el inventario.'); return; }
  document.getElementById('es-id').value = id;
  document.getElementById('es-nombre').textContent = r.nombre;
  await calcularInvSaldoArea();
  const stockEntrada = _invSaldoArea ? (_invSaldoArea[r.id_articulo]||0) : r.stock_actual;
  document.getElementById('es-stock-actual').textContent = stockEntrada + ' ' + (r.unidad || 'UND');
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
  // es-area es hidden — se llena por cargarUsuarioReceptorEntrada
  if (document.getElementById('es-clave-receptor')) document.getElementById('es-clave-receptor').value = '';
  if (document.getElementById('es-cliente-nombre')) document.getElementById('es-cliente-nombre').value = '';
  if (document.getElementById('es-area-origen'))    document.getElementById('es-area-origen').value = '';
  // Resetear moneda y tasa
  if (document.getElementById('es-moneda-compra'))  document.getElementById('es-moneda-compra').value = 'USD';
  if (document.getElementById('es-tasa-cont'))      document.getElementById('es-tasa-cont').style.display  = 'none';
  if (document.getElementById('es-precio-usd-cont'))document.getElementById('es-precio-usd-cont').style.display = 'none';
  if (document.getElementById('es-tasa-bcv'))       document.getElementById('es-tasa-bcv').value = '';
  if (document.getElementById('es-precio-usd-calc'))document.getElementById('es-precio-usd-calc').value = '';
  // Resetear esquema de pago
  const esquemaEl = document.getElementById('es-esquema-pago');
  if (esquemaEl) esquemaEl.value = 'CONTADO';
  const creditoCont = document.getElementById('es-credito-cont');
  if (creditoCont) creditoCont.style.display = 'none';
  const prevEl = document.getElementById('es-cuotas-preview');
  if (prevEl) { prevEl.innerHTML = ''; delete prevEl.dataset.cuotas; }
  // Auto-cargar usuario actual como receptor
  if (typeof cargarUsuarioReceptorEntrada === 'function') cargarUsuarioReceptorEntrada();
  document.getElementById('es-proveedor').innerHTML = '<option value="">— Seleccionar proveedor (opcional) —</option>';
  // Cargar áreas y proveedores en paralelo
  Promise.all([
    api('param_areas',  'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
    api('proveedores',  'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif,id_categoria,param_categorias_proveedor:id_categoria(nombre)'),
    api('param_categorias_proveedor','GET',null,'?nombre=ilike.*Artículo*&select=id&limit=1'),
  ]).then(function(res) {
    var areas = res[0], provs = res[1];
    var catArtículo = res[2] && res[2][0] ? res[2][0].id : null;
    // Filtrar solo proveedores con categoría Artículos
    if (catArtículo) {
      provs = provs.filter(function(p){ return p.id_categoria === catArtículo; });
    }
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


// ── Esquema de Pago — Entrada de Stock ──
function onCambioEsquemaPago() {
  const esquema = document.getElementById('es-esquema-pago')?.value;
  const cont    = document.getElementById('es-credito-cont');
  if (cont) cont.style.display = esquema === 'CREDITO' ? '' : 'none';
  if (esquema === 'CREDITO') calcularCuotasEntrada();
}

function calcularCuotasEntrada() {
  const numCuotas  = parseInt(document.getElementById('es-cuotas-num')?.value) || 0;
  const fechaInicio = document.getElementById('es-cuotas-fecha-inicio')?.value || '';
  const intervalo  = parseInt(document.getElementById('es-cuotas-intervalo')?.value) || 30;
  const montoTotal = parseFloat(document.getElementById('es-precio-costo')?.value || document.getElementById('es-precio-usd-calc')?.value) || 0;
  const cantidad   = parseFloat(document.getElementById('es-cantidad')?.value) || 0;
  const totalUSD   = montoTotal * cantidad;
  const preview    = document.getElementById('es-cuotas-preview');
  if (!preview) return;

  if (!numCuotas || !fechaInicio) {
    preview.innerHTML = '';
    return;
  }

  // Calcular monto por cuota
  const montoCuotaInput = parseFloat(document.getElementById('es-cuotas-monto')?.value) || 0;
  const montoCuota = montoCuotaInput > 0 ? montoCuotaInput : parseFloat((totalUSD / numCuotas).toFixed(2));

  // Auto-llenar monto si está vacío
  const montoEl = document.getElementById('es-cuotas-monto');
  if (montoEl && !montoEl.value && totalUSD > 0) montoEl.value = montoCuota;

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
        ? parseFloat((totalUSD - montoCuota * (numCuotas - 1)).toFixed(2))
        : montoCuota
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

    // ── FASE 4.5: Registrar salida en área origen si es transferencia ──
    if (motivoEnt === 'transferencia' && idAreaOrigenH) {
      const idEmpEntregaH = parseInt(document.getElementById('es-empleado-entrega')?.value) || null;
      await api('stock_salidas', 'POST', {
        id_articulo:       id,
        cantidad:          cantidad,
        fecha_salida:      getHoyVzla(),
        id_area:           idAreaEnt,          // destino (receptor)
        id_area_entrega:   idAreaOrigenH,       // origen (quien entrega)
        id_empleado:       idEmpEntVal,         // receptor
        id_empleado_entrega: idEmpEntregaH,
        observaciones:     document.getElementById('es-observaciones')?.value.trim() || null,
        id_usuario:        sesionActual.correo_usuario
      });
      // Actualizar stock_actual del área origen — decrementar
      const artOrigen = await api('inventario','GET',null,'?id_articulo=eq.'+id+'&select=stock_actual');
      const stockOrigen = parseFloat(artOrigen?.[0]?.stock_actual || 0);
      // stock_actual ya fue actualizado con nuevoStock (que sumó la entrada)
      // necesitamos decrementar adicionalmente por la salida del origen
      // stock_actual = (stock antes de transferencia) - cantidad + cantidad = sin cambio neto
      // Corrección: el stock_actual debe bajar solo si es una salida sin entrada (diferente área)
      // Para transferencia: stock_actual no cambia (entra en una área, sale de otra, mismo artículo)
    }

    // ── FASE 5: Asiento contable ──
    // Transferencias internas NO generan asiento
    if (motivoEnt !== "transferencia") try {
      const areaNombreEnt = document.getElementById('es-area-display')?.textContent || 'Área';
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

    // ── FASE 5B: Crear CxP según esquema de pago ──
    if (motivoEnt === 'compra') {
      try {
        const idProveedor = parseInt(document.getElementById('es-proveedor')?.value) || null;
        const montoUSD    = parseFloat((nuevoPrecioCosto * cantidad).toFixed(2));
        const montoVES    = parseFloat((montoUSD * _tasaVigente).toFixed(2));
        const esquema     = document.getElementById('es-esquema-pago')?.value || 'CONTADO';
        const numDocBase  = idEntrada ? 'ENT-' + idEntrada : ('ENT-INV-' + id);
        const artNomCxP   = r.nombre || r.codigo || 'Art#'+id;
        const hoy         = new Date().toISOString().split('T')[0];

        if (esquema === 'CONTADO') {
          // Una sola CxP — contado
          await api('cont_cxp','POST',{
            id_proveedor:  idProveedor,
            id_emisor:     _empresaActiva?.id_emisor || null,
            tipo:          'COMPRA_ARTICULO',
            numero_doc:    numDocBase,
            fecha_emision: hoy,
            fecha_vencimiento: hoy,
            moneda_pago:   monedaCompra || 'USD',
            estado:        'PENDIENTE',
            monto_usd:     montoUSD,
            monto_ves:     montoVES,
            tasa_bcv:      _tasaVigente || 1,
            pagado_usd:    0,
            saldo_usd:     montoUSD,
            observaciones: 'Contado — ' + artNomCxP + ' x ' + cantidad + ' uds.',
            id_usuario:    sesionActual?.correo_usuario || null
          });
        } else {
          // Crédito — múltiples CxP, una por cuota
          const preview = document.getElementById('es-cuotas-preview');
          const cuotas  = preview?.dataset.cuotas ? JSON.parse(preview.dataset.cuotas) : [];
          if (!cuotas.length) throw new Error('No se calcularon las cuotas. Complete los campos de crédito.');
          for (let i = 0; i < cuotas.length; i++) {
            const c = cuotas[i];
            await api('cont_cxp','POST',{
              id_proveedor:     idProveedor,
              id_emisor:        _empresaActiva?.id_emisor || null,
              tipo:             'COMPRA_ARTICULO_CREDITO',
              numero_doc:       numDocBase + '-C' + c.num,
              fecha_emision:    hoy,
              fecha_vencimiento: c.fecha,
              moneda_pago:      monedaCompra || 'USD',
              estado:           'PENDIENTE',
              monto_usd:        parseFloat(c.monto.toFixed(2)),
              monto_ves:        parseFloat((c.monto * _tasaVigente).toFixed(2)),
              tasa_bcv:         _tasaVigente || 1,
              pagado_usd:       0,
              saldo_usd:        parseFloat(c.monto.toFixed(2)),
              observaciones:    'Cuota ' + c.num + '/' + cuotas.length + ' — ' + artNomCxP + ' x ' + cantidad + ' uds.',
              id_usuario:       sesionActual?.correo_usuario || null
            });
          }
        }
      } catch(eCxP) { console.warn('Error creando CxP:', eCxP.message); }
    }

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

// ─── CATEGORÍAS Y TIPOS DE ARTICULO ───
let _invCategoriasCache = [];
let _invSaldoArea = null; // Saldo por área del usuario — null = mostrar stock global

async function invCargarCategorias(selCatId) {
  const sel = document.getElementById('inv-categoria');
  if (!sel) return;
  try {
    if (!_invCategoriasCache.length) {
      _invCategoriasCache = await api('inv_categorias','GET',null,
        '?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_emisor=eq.'+_empresaActiva.id_emisor : '')) || [];
    }
    sel.innerHTML = '<option value="">— Seleccionar categoría —</option>'
      + _invCategoriasCache.map(function(c) {
          return '<option value="'+c.id+'"'+(selCatId && selCatId==c.id?' selected':'')+'>'+
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
          return '<option value="'+t.id+'"'+(selTipoId && selTipoId==t.id?' selected':'')+'>'+
            (t.codigo?t.codigo+' — ':'')+t.nombre+'</option>';
        }).join('');
  } catch(e) { console.warn('invCargarTiposArticulo:', e); }
}

async function abrirNuevoInventario() {
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) infoEl.style.display = 'none';
  ['inv-id','inv-codigo','inv-nombre','inv-descripcion','inv-stock','inv-stock-min','inv-costo','inv-venta','inv-demanda-anual','inv-lead-time','inv-costo-pedido','inv-stock-seg'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('inv-unidad').value = 'UND';
  var invVentaContN = document.getElementById('inv-venta-cont');
  if (invVentaContN) invVentaContN.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  // Asegurar que todos los campos estén habilitados al crear nuevo
  ['inv-categoria','inv-tipo-articulo','inv-codigo','inv-nombre','inv-descripcion','inv-unidad'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  document.getElementById('modal-inv-titulo').textContent = 'NUEVO ARTICULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';
  _invCategoriasCache = []; // Forzar recarga
  await invCargarCategorias(null);
  abrirModal('modal-inventario');
  setTimeout(function() {
    const body = document.querySelector('#modal-inventario .modal-body');
    if (body) body.scrollTop = 0;
    document.getElementById('inv-codigo')?.focus();
  }, 80);
}

async function abrirEditarInventario(id) {
  // Asegurar que _invSaldoArea esté calculado para mostrar stock correcto del área
  await calcularInvSaldoArea();
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
  await invCargarCategorias(r.id_categoria || null);
  await invCargarTiposArticulo(r.id_tipo_articulo || null);
  document.getElementById('inv-demanda-anual').value = r.demanda_anual || '';
  document.getElementById('inv-lead-time').value = r.lead_time_dias || '';
  document.getElementById('inv-costo-pedido').value = r.costo_pedido_usd || '';
  document.getElementById('inv-stock-seg').value = r.stock_seguridad || '';
  document.getElementById('modal-inv-titulo').textContent = 'EDITAR ARTICULO';
  document.getElementById('alerta-inv-ok').style.display = 'none';
  document.getElementById('alerta-inv-err').style.display = 'none';

  // Bloquear todos los campos excepto Parámetros de Gestión (EOQ/Reorden/JIT)
  ['inv-categoria','inv-tipo-articulo','inv-codigo','inv-nombre','inv-descripcion','inv-unidad'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = true;
  });

  // En edición mostrar stock actual y precio costo como info (solo lectura)
  var infoEl = document.getElementById('inv-info-stock-costo');
  if (infoEl) {
    infoEl.style.display = '';
    const stockFicha = _invSaldoArea ? (_invSaldoArea[r.id_articulo] || 0) : r.stock_actual;
    document.getElementById('inv-info-stock-val').textContent = stockFicha + ' ' + (r.unidad || 'UND');
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
    // Validar código duplicado
    if (codigo) {
      let qDup = '?codigo=eq.' + encodeURIComponent(codigo) + emisorQ();
      if (id) qDup += '&id_articulo=neq.' + id; // excluir el propio al editar
      const dup = await api('inventario','GET',null,qDup + '&select=id_articulo&limit=1');
      if (dup && dup.length) {
        errEl.textContent = 'Ya existe un artículo con el código "' + codigo + '". Usa un código diferente.';
        errEl.style.display = 'block';
        document.getElementById('inv-codigo')?.focus();
        return;
      }
    }
    const demandaAnual = parseInt(document.getElementById('inv-demanda-anual').value) || null;
    const leadTime     = parseInt(document.getElementById('inv-lead-time').value) || null;
    const costoPedido  = parseFloat(document.getElementById('inv-costo-pedido').value) || null;
    const stockSeg     = parseInt(document.getElementById('inv-stock-seg').value) || 0;
    const idCategoria    = parseInt(document.getElementById('inv-categoria')?.value) || null;
    const idTipoArticulo = parseInt(document.getElementById('inv-tipo-articulo')?.value) || null;
    const ventaFinal     = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? venta : undefined;
    const datos = { nombre, descripcion: desc || null, codigo: codigo || null, stock_actual: stock,
      stock_minimo: stockMin, precio_costo_usd: costo, activo: true,
      id_emisor: _empresaActiva ? _empresaActiva.id_emisor : null,
      ...(ventaFinal !== undefined ? { precio_venta_usd: ventaFinal } : {}),
      unidad, id_categoria: idCategoria, id_tipo_articulo: idTipoArticulo,
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
    // Si el usuario solo ve su área, filtrar historial por área
    const idAreaFiltro = _invSaldoArea && sesionActual?.correo_usuario
      ? await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').then(function(r){ return r&&r[0]?r[0].id_area:null; }).catch(function(){ return null; })
      : null;
    let filas = [];

    if (idAreaFiltro) {
      // Para operador de área: sus "entradas" son las salidas del almacén hacia su área
      const salsRecibidas = await api('stock_salidas','GET',null,
        '?id_articulo=eq.'+idArticulo+'&id_area=eq.'+idAreaFiltro+'&order=fecha_salida.desc&select=*,area_origen:id_area_entrega(nombre,codigo)');
      if (!salsRecibidas || !salsRecibidas.length) {
        cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:8px 0">Sin entradas en tu área.</div>';
        return;
      }
      filas = salsRecibidas.map(function(s) {
        const origen = s.area_origen ? (s.area_origen.codigo?s.area_origen.codigo+' — ':'')+s.area_origen.nombre : 'Almacén';
        const estado = s.reversada
          ? '<span style="color:#fc8181;font-size:10px">Reversada</span>'
          : '<span style="color:#22c55e;font-size:10px">Activa</span>';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">'
          + '<td style="padding:6px 4px">' + fmtFecha(s.fecha_salida) + '</td>'
          + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + s.cantidad + '</td>'
          + '<td style="padding:6px 4px">' + origen + '</td>'
          + '<td style="text-align:center;padding:6px 4px">' + estado + '</td>'
          + '</tr>';
      });
      cont.innerHTML = '<div style="margin-top:16px;border-top:1px solid var(--borde);padding-top:12px">'
        + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;margin-bottom:8px">ENTRADAS A TU ÁREA</div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr style="border-bottom:1px solid var(--borde)">'
        + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">FECHA</th>'
        + '<th style="text-align:right;padding:6px 4px;color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">ORIGEN</th>'
        + '<th style="text-align:center;padding:6px 4px;color:var(--suave);font-size:10px">ESTADO</th>'
        + '</tr></thead><tbody>' + filas.join('') + '</tbody></table></div>';
      return;
    }

    // Administrador: ver todas las entradas directas
    const qEntradas = '?id_articulo=eq.' + idArticulo + '&order=fecha_entrada.desc&select=*';
    const entradas = await api('stock_entradas', 'GET', null, qEntradas);
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

// ─── CATEGORÍAS DE INVENTARIO ───
async function invRenderCategorias(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const idEmisor = _empresaActiva?.id_emisor || 0;
    const cats = await api('inv_categorias','GET',null,'?id_emisor=eq.'+idEmisor+'&order=nombre.asc&select=*') || [];
    const filas = cats.map(function(c) {
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-family:var(--font-mono);color:var(--naranja);font-size:12px">'+(c.codigo||'—')+'</td>'
        +'<td style="padding:8px;font-size:13px;font-weight:500">'+c.nombre+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+(c.descripcion||'')+'</td>'
        +'<td style="padding:8px"><span class="badge '+(c.estado==='ACTIVO'?'badge-verde':'badge-rojo')+'">'+c.estado+'</span></td>'
        +'<td style="padding:8px"><button class="btn-secundario" onclick="invAbrirCategoria('+c.id+')" style="font-size:11px;padding:4px 10px">Ver</button></td>'
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
  if (id) { const r = await api('inv_categorias','GET',null,'?id=eq.'+id)||[]; item=r[0]||null; }
  const html = '<div class="form-grid">'
    +'<div class="form-campo"><label>Código</label><input type="text" id="icat-codigo" value="'+(item?.codigo||'')+'" placeholder="Ej: CAT-01" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Nombre *</label><input type="text" id="icat-nombre" value="'+(item?.nombre||'')+'" placeholder="Nombre de la categoría"></div>'
    +'<div class="form-campo form-full"><label>Descripción</label><textarea id="icat-desc" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;resize:vertical;min-height:60px;width:100%">'+(item?.descripcion||'')+'</textarea></div>'
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
  setTimeout(function(){ document.getElementById('icat-nombre')?.focus(); }, 100);
}

async function invGuardarCategoria() {
  const id=document.getElementById('icat-id').value, nombre=document.getElementById('icat-nombre')?.value.trim();
  const okEl=document.getElementById('icat-ok'), errEl=document.getElementById('icat-err');
  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl.style.display='block'; return; }
  const datos = { nombre, estado:document.getElementById('icat-estado')?.value||'ACTIVO',
    codigo:document.getElementById('icat-codigo')?.value.trim().toUpperCase()||null,
    descripcion:document.getElementById('icat-desc')?.value.trim()||null, id_emisor:_empresaActiva?.id_emisor||null };
  try {
    if (id) await api('inv_categorias','PATCH',datos,'?id=eq.'+id);
    else    await api('inv_categorias','POST',datos);
    _invCategoriasCache=[];
    okEl.textContent='✓ Categoría '+(id?'actualizada':'creada')+'.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-param'); invRenderCategorias(); }, 900);
  } catch(e) { errEl.textContent='Error: '+e.message; errEl.style.display='block'; }
}

// ─── TIPOS DE ARTICULO ───
async function invRenderTipos(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const idEmisor = _empresaActiva?.id_emisor || 0;
    const [tipos, cats] = await Promise.all([
      api('inv_articulos_tipo','GET',null,'?id_emisor=eq.'+idEmisor+'&order=nombre.asc&select=*'),
      api('inv_categorias','GET',null,'?id_emisor=eq.'+idEmisor+'&select=id,nombre,codigo'),
    ]);
    const catsMap = {}; (cats||[]).forEach(function(c){ catsMap[c.id]=c; });
    const filas = (tipos||[]).map(function(t) {
      const cat=catsMap[t.id_categoria];
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-family:var(--font-mono);color:var(--naranja);font-size:12px">'+(t.codigo||'—')+'</td>'
        +'<td style="padding:8px;font-size:13px;font-weight:500">'+t.nombre+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+(cat?(cat.codigo?cat.codigo+' — ':'')+cat.nombre:'—')+'</td>'
        +'<td style="padding:8px"><span class="badge '+(t.estado==='ACTIVO'?'badge-verde':'badge-rojo')+'">'+t.estado+'</span></td>'
        +'<td style="padding:8px"><button class="btn-secundario" onclick="invAbrirTipo('+t.id+')" style="font-size:11px;padding:4px 10px">Ver</button></td>'
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

async function invAbrirTipo(id) {
  const idEmisor = _empresaActiva?.id_emisor || 0;
  let item = null;
  if (id) { const r=await api('inv_articulos_tipo','GET',null,'?id=eq.'+id)||[]; item=r[0]||null; }
  const cats = await api('inv_categorias','GET',null,'?estado=eq.ACTIVO&id_emisor=eq.'+idEmisor+'&order=nombre.asc')||[];
  const opcCats = cats.map(function(c) {
    return '<option value="'+c.id+'"'+(item?.id_categoria===c.id?' selected':'')+'>'+
      (c.codigo?c.codigo+' — ':'')+c.nombre+'</option>';
  }).join('');
  const html = '<div class="form-grid">'
    +'<div class="form-campo"><label>Código</label><input type="text" id="itipo-codigo" value="'+(item?.codigo||'')+'" placeholder="Ej: TIPO-01" style="text-transform:uppercase"></div>'
    +'<div class="form-campo form-full"><label>Nombre *</label><input type="text" id="itipo-nombre" value="'+(item?.nombre||'')+'" placeholder="Nombre del tipo"></div>'
    +'<div class="form-campo form-full"><label>Categoría *</label><select id="itipo-categoria" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="">— Seleccionar —</option>'+opcCats+'</select></div>'
    +'<div class="form-campo form-full"><label>Descripción</label><textarea id="itipo-desc" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;resize:vertical;min-height:60px;width:100%">'+(item?.descripcion||'')+'</textarea></div>'
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
  setTimeout(function(){ document.getElementById('itipo-nombre')?.focus(); }, 100);
}

async function invGuardarTipo() {
  const id=document.getElementById('itipo-id').value, nombre=document.getElementById('itipo-nombre')?.value.trim();
  const catId=parseInt(document.getElementById('itipo-categoria')?.value)||null;
  const okEl=document.getElementById('itipo-ok'), errEl=document.getElementById('itipo-err');
  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl.style.display='block'; return; }
  if (!catId)  { errEl.textContent='Debe seleccionar una categoría.'; errEl.style.display='block'; return; }
  const datos = { nombre, id_categoria:catId, estado:document.getElementById('itipo-estado')?.value||'ACTIVO',
    codigo:document.getElementById('itipo-codigo')?.value.trim().toUpperCase()||null,
    descripcion:document.getElementById('itipo-desc')?.value.trim()||null, id_emisor:_empresaActiva?.id_emisor||null };
  try {
    if (id) await api('inv_articulos_tipo','PATCH',datos,'?id=eq.'+id);
    else    await api('inv_articulos_tipo','POST',datos);
    okEl.textContent='✓ Tipo '+(id?'actualizado':'creado')+'.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-param'); invRenderTipos(); }, 900);
  } catch(e) { errEl.textContent='Error: '+e.message; errEl.style.display='block'; }
}

// ─── REVERSAR ENTRADA ───
async function reversarEntrada(idEntrada, idArticulo, cantidad) {
  await reversarMovimiento('ENTRADA', idEntrada, cantidad, idArticulo);
  // Retornar a inventario general después del reverso
  cerrarTodosLosModales();
  renderInventario();
}
// ─── HISTORIAL DE SALIDAS ───
async function verHistorialSalidas(idArticulo) {
  const cont = document.getElementById('ficha-inv-historial-salidas');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--suave);font-size:12px">Cargando...</div>';
  try {
    const idAreaFiltro = _invSaldoArea && sesionActual?.correo_usuario
      ? await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').then(function(r){ return r&&r[0]?r[0].id_area:null; }).catch(function(){ return null; })
      : null;
    // Para operador: solo salidas enviadas DESDE su área (id_area_entrega)
    // Las recibidas ya se muestran en "Entradas a tu área"
    const qSalidas = '?id_articulo=eq.' + idArticulo + '&order=fecha_salida.desc&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo)'
      + (idAreaFiltro ? '&id_area_entrega=eq.'+idAreaFiltro : '');
    const salidas = await api('stock_salidas', 'GET', null, qSalidas);
    if (!salidas || !salidas.length) {
      cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:8px 0">Sin salidas registradas.</div>';
      return;
    }
    cont.innerHTML = '<div style="margin-top:16px;border-top:1px solid var(--borde);padding-top:12px">'
      + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;margin-bottom:8px">HISTORIAL DE SALIDAS</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr style="border-bottom:1px solid var(--borde)">'
      + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">FECHA</th>'
      + '<th style="text-align:right;padding:6px 4px;color:var(--suave);font-size:10px">CANT</th>'
      + '<th style="text-align:left;padding:6px 4px;color:var(--suave);font-size:10px">ÁREA</th>'
      + '<th style="text-align:center;padding:6px 4px;color:var(--suave);font-size:10px">ESTADO</th>'
      + '<th style="padding:6px 4px"></th>'
      + '</tr></thead><tbody>'
      + salidas.map(function(s) {
          const area = s.area_receptora ? (s.area_receptora.codigo ? s.area_receptora.codigo + ' — ' : '') + s.area_receptora.nombre : '—';
          const estado = s.reversada
            ? '<span style="color:#fc8181;font-size:10px">Reversada</span>'
            : '<span style="color:#22c55e;font-size:10px">Activa</span>';
          const btnRev = !s.reversada && puedo('INVENTARIO','ELIMINAR')
            ? '<button onclick="reversarSalida(' + s.id_salida + ',' + idArticulo + ',' + s.cantidad + ')" '
              + 'style="background:rgba(252,129,129,0.1);border:1px solid rgba(252,129,129,0.3);color:#fc8181;'
              + 'border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">Reversar</button>'
            : '';
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">'
            + '<td style="padding:6px 4px">' + fmtFecha(s.fecha_salida) + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + s.cantidad + '</td>'
            + '<td style="padding:6px 4px">' + area + '</td>'
            + '<td style="text-align:center;padding:6px 4px">' + estado + '</td>'
            + '<td style="padding:6px 4px">' + btnRev + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch(e) {
    cont.innerHTML = '<div style="color:#fc8181;font-size:12px">Error: ' + e.message + '</div>';
  }
}


// ─── MOVIMIENTOS DE INVENTARIO ───
async function invRenderMovimientos(cont) {
  if (!cont) cont = document.getElementById('tabla-inv-cont');
  if (!cont) return;

  const hoy = new Date();
  const primerDia = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0') + '-01';
  const ultimoDia = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0') + '-' + String(new Date(hoy.getFullYear(),hoy.getMonth()+1,0).getDate()).padStart(2,'0');
  const INP = 'background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:7px 10px;border-radius:5px;font-size:12px';

  cont.innerHTML =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Desde</label>'
    + '<input type="date" id="mov-desde" value="' + primerDia + '" onchange="invCargarMovimientos()" style="' + INP + '"></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Hasta</label>'
    + '<input type="date" id="mov-hasta" value="' + ultimoDia + '" onchange="invCargarMovimientos()" style="' + INP + '"></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Agrupar por</label>'
    + '<select id="mov-agrup" onchange="invCargarMovimientos()" style="' + INP + '">'
    + '<option value="movimientos">Movimientos</option>'
    + '<option value="categoria">Por Categoría</option>'
    + '<option value="area">Por Área</option>'
    + '<option value="articulo">Por Artículo</option>'
    + '<option value="proveedor">Por Proveedor</option>'
    + '<option value="rotacion">Rotación</option>'
    + '<option value="saldo_area">Saldo por Área</option>'
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
    const idEmisor = _empresaActiva?.id_emisor || 0;
    const monedaRef = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const simRef    = monedaRef === 'USD' ? '$' : monedaRef;

    // Cargar cache si está vacío
    if (!inventarioCache || !inventarioCache.length) {
      const arts = await api('inventario','GET',null,'?activo=eq.true&id_emisor=eq.'+idEmisor+'&select=*&order=nombre.asc');
      if (arts) inventarioCache = arts;
    }
    const idsArticulos = inventarioCache.map(function(x){ return x.id_articulo; });
    if (!idsArticulos.length) { res.innerHTML = '<div style="text-align:center;color:var(--suave);padding:40px">Sin artículos registrados.</div>'; return; }
    const inClause = idsArticulos.join(',');

    // Cargar entradas y salidas según filtro
    // Filtrar por área si el usuario no tiene VER_INVENTARIO_GENERAL
    let idAreaMovs = null;
    if (!sesionActual?.administrador && !puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) {
      try {
        const correo = sesionActual?.correo_usuario;
        const empRes = correo ? await api('empleados','GET',null,
          '?correo=eq.'+encodeURIComponent(correo)+'&select=id_area&limit=1') : [];
        idAreaMovs = empRes?.[0]?.id_area || null;
      } catch(e) {}
    }

    let entradas = [], salidas = [];
    if (!tipo || tipo === 'ENTRADA') {
      let qE = '?id_articulo=in.('+inClause+')&order=fecha_entrada.desc&select=*,area_receptora:id_area(nombre,codigo),area_origen:id_area_origen(nombre,codigo),proveedor:id_proveedor(nombre)';
      if (desde) qE += '&fecha_entrada=gte.'+desde;
      if (hasta) qE += '&fecha_entrada=lte.'+hasta;
      // Para operador de área: entradas directas a su área + salidas recibidas
      if (idAreaMovs) qE += '&id_area=eq.'+idAreaMovs;
      entradas = await api('stock_entradas','GET',null,qE) || [];
    }
    if (!tipo || tipo === 'SALIDA') {
      let qS = '?id_articulo=in.('+inClause+')&order=fecha_salida.desc&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo)';
      if (desde) qS += '&fecha_salida=gte.'+desde;
      if (hasta) qS += '&fecha_salida=lte.'+hasta;
      // Para operador de área: salidas recibidas O enviadas desde su área
      if (idAreaMovs) qS += '&or=(id_area.eq.'+idAreaMovs+',id_area_entrega.eq.'+idAreaMovs+')';
      salidas = await api('stock_salidas','GET',null,qS) || [];
    }

    // Helper para obtener artículo del cache
    const getArt = function(id) { return inventarioCache.find(function(x){ return x.id_articulo === id; }); };
    const artNom = function(a)  { return a ? (a.codigo ? a.codigo+' — ':'')+a.nombre : '—'; };

    // ── VISTAS ────────────────────────────────────────────────
    if (agrup === 'movimientos') {
      // Lista cronológica
      const movs = [];
      entradas.forEach(function(e) {
        const art = getArt(e.id_articulo);
        if (busq && !artNom(art).toLowerCase().includes(busq)) return;
        const motivo = e.id_proveedor ? 'Compra' : (e.id_area_origen ? 'Transferencia' : (e.cliente_nombre ? 'Devolución' : 'Ajuste'));
        movs.push({ tipo:'ENTRADA', fecha:e.fecha_entrada, art:artNom(art),
          origen: e.area_origen ? (e.area_origen.codigo?e.area_origen.codigo+' ':'')+e.area_origen.nombre : (e.proveedor?e.proveedor.nombre:(e.cliente_nombre||'—')),
          destino: e.area_receptora ? (e.area_receptora.codigo?e.area_receptora.codigo+' ':'')+e.area_receptora.nombre : '—',
          motivo:motivo, cant:e.cantidad, costo:e.precio_costo_usd||0, moneda:e.moneda_compra||monedaRef, rev:e.reversada });
      });
      salidas.forEach(function(s) {
        const art = getArt(s.id_articulo);
        if (busq && !artNom(art).toLowerCase().includes(busq)) return;
        movs.push({ tipo:'SALIDA', fecha:s.fecha_salida, art:artNom(art),
          origen: s.area_entrega ? (s.area_entrega.codigo?s.area_entrega.codigo+' ':'')+s.area_entrega.nombre : '—',
          destino: s.area_receptora ? (s.area_receptora.codigo?s.area_receptora.codigo+' ':'')+s.area_receptora.nombre : '—',
          motivo:'Salida interna', cant:s.cantidad, costo:0, moneda:'', rev:s.reversada });
      });
      movs.sort(function(a,b){ return b.fecha>a.fecha?1:b.fecha<a.fecha?-1:0; });
      if (!movs.length) { res.innerHTML='<div style="text-align:center;color:var(--suave);padding:40px">Sin movimientos en el período.</div>'; return; }
      const colC = puedo('INVENTARIO','VER_COSTOS') ? '<th style="text-align:right;padding:7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Costo</th>' : '';
      res.innerHTML = '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">'+movs.length+' movimientos</div>'
        + '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Fecha</th>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Tipo</th>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Artículo</th>'
        + '<th style="text-align:right;padding:7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Cant.</th>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Origen</th>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Destino</th>'
        + '<th style="padding:7px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Motivo</th>'
        + colC + '</tr></thead><tbody>'
        + movs.map(function(m) {
            const eE=m.tipo==='ENTRADA', c=eE?'#22c55e':'#fc8181';
            const badge='<span style="background:'+(eE?'rgba(34,197,94,0.1)':'rgba(252,129,129,0.1)')+';color:'+c+';border:1px solid '+c+';border-radius:4px;padding:2px 6px;font-size:10px">'+m.tipo+'</span>'+(m.rev?'<span style="color:#fc8181;font-size:10px;margin-left:4px">REV</span>':'');
            const costoTd = puedo('INVENTARIO','VER_COSTOS') ? '<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-size:12px;color:var(--suave)">'+(eE&&m.costo>0?(m.moneda==='VES'?'Bs ':simRef+' ')+fmtUSD(m.costo):'—')+'</td>' : '';
            return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)'+(m.rev?';opacity:0.5':'')+'">'
              +'<td style="padding:7px;font-size:12px">'+fmtFecha(m.fecha)+'</td>'
              +'<td style="padding:7px">'+badge+'</td>'
              +'<td style="padding:7px;font-size:12px">'+m.art+'</td>'
              +'<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-size:12px">'+m.cant+'</td>'
              +'<td style="padding:7px;font-size:12px">'+m.origen+'</td>'
              +'<td style="padding:7px;font-size:12px">'+m.destino+'</td>'
              +'<td style="padding:7px;font-size:11px;color:var(--suave)">'+m.motivo+'</td>'
              +costoTd+'</tr>';
          }).join('')
        + '</tbody></table></div>';

    } else if (agrup === 'categoria') {
      const cats = {};
      // Helper para obtener nombre de categoría desde cache
      const getCatNom = function(art) {
        if (art.id_categoria) {
          const c = _invCategoriasCache.find(function(c){ return c.id === art.id_categoria; });
          if (c) return (c.codigo ? c.codigo + ' — ' : '') + c.nombre.toUpperCase();
        }
        return (art.categoria || 'SIN CATEGORÍA').toUpperCase();
      };
      entradas.forEach(function(e) {
        const art = getArt(e.id_articulo); if (!art) return;
        const cat = getCatNom(art);
        if (!cats[cat]) cats[cat] = { entradas:0, salidas:0, costo:0 };
        cats[cat].entradas += parseFloat(e.cantidad||0);
        cats[cat].costo    += parseFloat(e.precio_costo_usd||0) * parseFloat(e.cantidad||0);
      });
      salidas.forEach(function(s) {
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
      const areas = {};
      entradas.forEach(function(e) {
        const nom = e.area_receptora ? (e.area_receptora.codigo?e.area_receptora.codigo+' ':'')+e.area_receptora.nombre : 'Sin área';
        if (!areas[nom]) areas[nom] = { entradas:0, salidas:0 };
        areas[nom].entradas += parseFloat(e.cantidad||0);
      });
      salidas.forEach(function(s) {
        // La salida descuenta del área que entrega, no del área que recibe
        const nomOrigen  = s.area_entrega   ? (s.area_entrega.codigo?s.area_entrega.codigo+' ':'')+s.area_entrega.nombre   : 'Sin área';
        const nomDestino = s.area_receptora ? (s.area_receptora.codigo?s.area_receptora.codigo+' ':'')+s.area_receptora.nombre : null;
        // Resta del área origen
        if (!areas[nomOrigen]) areas[nomOrigen] = { entradas:0, salidas:0 };
        areas[nomOrigen].salidas += parseFloat(s.cantidad||0);
        // Suma al área destino (la recibe como entrada interna)
        if (nomDestino) {
          if (!areas[nomDestino]) areas[nomDestino] = { entradas:0, salidas:0 };
          areas[nomDestino].entradas += parseFloat(s.cantidad||0);
        }
      });
      const filas = Object.keys(areas).sort().map(function(a) {
        const v=areas[a], saldo=v.entradas-v.salidas;
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:8px;font-size:12px">'+a+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+v.entradas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+v.salidas+'</td>'
          +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:'+(saldo>=0?'var(--naranja)':'#fc8181')+'">'+saldo+'</td></tr>';
      });
      res.innerHTML = '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
        +'<th style="padding:8px;text-align:left;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Área</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Entradas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Salidas</th>'
        +'<th style="text-align:right;padding:8px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo Neto</th>'
        +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';

    } else if (agrup === 'articulo') {
      const arts = {};
      entradas.forEach(function(e) {
        const art=getArt(e.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_usd||0, stock:art.stock_actual||0, hist:[] };
        arts[nom].entradas += parseFloat(e.cantidad||0);
        arts[nom].hist.push({ fecha:e.fecha_entrada, tipo:'E', cant:e.cantidad, cpp:e.precio_costo_usd||0 });
      });
      salidas.forEach(function(s) {
        const art=getArt(s.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_usd||0, stock:art.stock_actual||0, hist:[] };
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
      entradas.filter(function(e){ return e.id_proveedor; }).forEach(function(e) {
        const nom = e.proveedor ? e.proveedor.nombre : 'Prov #'+e.id_proveedor;
        if (!provs[nom]) provs[nom] = { cant:0, monto:0, items:0 };
        provs[nom].cant   += parseFloat(e.cantidad||0);
        provs[nom].monto  += (parseFloat(e.precio_costo_usd||0)*parseFloat(e.cantidad||0));
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
      const rot = {};
      entradas.forEach(function(e) {
        const art=getArt(e.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!rot[nom]) rot[nom] = { entradas:0, salidas:0, movs:0 };
        rot[nom].entradas += parseFloat(e.cantidad||0);
        rot[nom].movs++;
      });
      salidas.forEach(function(s) {
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
      // Saldo actual por área: stock que entró a cada área menos lo que salió
      const saldos = {};
      entradas.forEach(function(e) {
        const nom = e.area_receptora ? (e.area_receptora.codigo?e.area_receptora.codigo+' ':'')+e.area_receptora.nombre : 'Sin área';
        const art = getArt(e.id_articulo); if(!art) return;
        if (!saldos[nom]) saldos[nom] = {};
        if (!saldos[nom][artNom(art)]) saldos[nom][artNom(art)] = 0;
        saldos[nom][artNom(art)] += parseFloat(e.cantidad||0);
      });
      salidas.forEach(function(s) {
        const art = getArt(s.id_articulo); if(!art) return;
        const cant = parseFloat(s.cantidad||0);
        // Descuenta del área que entrega
        const nomOrigen = s.area_entrega ? (s.area_entrega.codigo?s.area_entrega.codigo+' ':'')+s.area_entrega.nombre : 'Sin área';
        if (!saldos[nomOrigen]) saldos[nomOrigen] = {};
        if (!saldos[nomOrigen][artNom(art)]) saldos[nomOrigen][artNom(art)] = 0;
        saldos[nomOrigen][artNom(art)] -= cant;
        // Suma al área que recibe
        if (s.area_receptora) {
          const nomDestino = (s.area_receptora.codigo?s.area_receptora.codigo+' ':'')+s.area_receptora.nombre;
          if (!saldos[nomDestino]) saldos[nomDestino] = {};
          if (!saldos[nomDestino][artNom(art)]) saldos[nomDestino][artNom(art)] = 0;
          saldos[nomDestino][artNom(art)] += cant;
        }
      });
      let html = '';
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
          +'<th style="text-align:right;padding:7px;font-size:11px;color:var(--suave);border-bottom:1px solid var(--borde)">Saldo</th>'
          +'</tr></thead><tbody>'+filas.join('')+'</tbody></table></div>';
      });
      res.innerHTML = html || '<div style="text-align:center;color:var(--suave);padding:40px">Sin datos en el período.</div>';
    }

  } catch(e) {
    res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>';
    console.error('invCargarMovimientos:', e);
  }
}


