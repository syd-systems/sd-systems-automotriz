// ─── S&D Systems — Módulo: INVENTARIO2 ───
// ══════════════════════════════════════════════════════════════
//  FASE 3 — INVENTARIO GENERAL
// ══════════════════════════════════════════════════════════════
let inventarioCache = [];

// ─── CLASIFICACIÓN ABC ───
function clasificarABC(items) {
  if (!items.length) return items;
  const conValor = items.map(function(r) {
    return Object.assign({}, r, { valor_inventario: parseFloat(r.precio_venta_moneda || 0) * parseFloat(r.stock_actual_articulo || 0) });
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
  var stockSeg = parseFloat(r.stock_seguridad || r.stock_minimo_articulo || 0);
  return Math.ceil(demanda * lead + stockSeg);
}
function calcularMargen(r) {
  var venta = parseFloat(r.precio_venta_moneda || 0);
  if (!venta) return 0;
  return ((venta - parseFloat(r.precio_costo_moneda || 0)) / venta * 100);
}
var _invVista = 'tabla';


// ── Validar contraseña de un empleado por su id ──
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

    const id_areaUsuario = empRes?.[0]?.id_area || null;
    if (!id_areaUsuario) { _invSaldoArea = {}; return; }

    // Obtener todos los artículos del emisor
    const arts = inventarioCache.length > 0 ? inventarioCache
      : await api('inventario_almacen','GET',null,'?order=nombre_articulo.asc&select=id_articulo' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || [];
    if (!arts.length) { _invSaldoArea = {}; return; }

    const inClause = arts.map(function(r){ return r.id_articulo; }).join(',');
    const t4s = function(){ return new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); },4000); }); };

    const [entsDirectas, salsRecibidas, salsEnviadas] = await Promise.all([
      Promise.race([api('stock_entradas','GET',null,'?id_area=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
      Promise.race([api('stock_salidas','GET',null,'?id_area_entrega=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
      Promise.race([api('stock_salidas','GET',null,'?id_area=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; })
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
      + (_invCategoriasCache.map ? _invCategoriasCache.map(function(c){ return '<option value="'+c.id_categoria+'">'+c.nombre+'</option>'; }).join('') : '')
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
    const itemsTodos = await api('inventario_almacen', 'GET', null, '?order=nombre_articulo.asc&select=*' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : '')) || [];
    const items = itemsTodos.filter(function(r) { return r.estado !== 'INACTIVO'; });
    const itemsFiltradosBase = soloConStock ? items.filter(function(r) { return parseFloat(r.stock_actual_articulo||0) > 0; }) : items;
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
    ? itemsFiltradosBase2.filter(function(r) { return String(r.id_categoria_articulo) === String(catFiltro); })
    : itemsFiltradosBase2;
  if (filtro && filtro.trim()) {
    const t = filtro.toLowerCase();
    itemsFiltrados = itemsFiltrados.filter(function(r) {
      return r.nombre_articulo.toLowerCase().includes(t) || (r.codigo_articulo || '').toLowerCase().includes(t) || (r.descripcion || '').toLowerCase().includes(t);
    });
  }
    const stockBajos = items.filter(function(r) { return parseFloat(r.stock_minimo_articulo||0) > 0 && r.stock_actual_articulo <= r.stock_minimo_articulo; }).length;
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
    const stockBajo = parseFloat(r.stock_minimo_articulo||0) > 0 && r.stock_actual_articulo <= r.stock_minimo_articulo;
    const abc = abcMap[r.id_articulo] || '—';
    const margen = calcularMargen(r);
    return '<tr>'
      + '<td><div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:10px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:2px 6px;border-radius:3px">' + abc + '</span>'
      + '<div><div style="font-family:var(--font-mono);font-size:11px;color:var(--suave)">' + (r.codigo_articulo || '—')
      + (r.id_categoria_articulo ? ' · <span style="color:var(--suave)">' + (_invCategoriasCache.find(function(c){return c.id_categoria===r.id_categoria_articulo;})?.nombre || '') + '</span>' : '')
      + '</div>'
      + '<div style="font-weight:500">' + r.nombre_articulo + '</div>'
      + (r.descripcion ? '<div style="font-size:11px;color:var(--suave)">' + r.descripcion + '</div>' : '') + '</div></div></td>'
      + (function() {
          const stockMostrar = _invSaldoArea ? (_invSaldoArea[r.id_articulo]||0) : r.stock_actual_articulo;
          const stockBajoArea = parseFloat(r.stock_minimo_articulo||0) > 0 && stockMostrar <= r.stock_minimo_articulo;
          return '<td><span class="badge ' + (stockBajoArea ? 'badge-rojo' : 'badge-verde') + '">' + stockMostrar + ' ' + (r.unidad || 'UND') + '</span>'
            + (_invSaldoArea ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Stock área</div>' : '')
            + (stockBajoArea ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo_articulo + ')</div>' : '') + '</td>';
        })()
      + (puedo('INVENTARIO','VER_COSTOS')
          ? '<td style="font-family:var(--font-mono);font-size:12px">'
            + '<div style="color:var(--suave);font-size:9px;letter-spacing:1px">COSTO PROM. (CPP)</div>'
            + '<div>$ ' + (parseInt(r.stock_actual_articulo) === 0 ? '0.00' : fmtUSD(r.precio_costo_moneda)) + '</div>'
            + (r.precio_costo_ultimo_moneda
                ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Última compra: $ ' + fmtUSD(r.precio_costo_ultimo_moneda) + '</div>'
                : '')
            + '</td>'
          : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
      + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
          ? '<td style="font-family:var(--font-mono);font-size:12px"><div style="color:var(--suave);font-size:10px">Venta</div>'
            + '<span style="color:var(--naranja)">' + fmtBs(parseFloat(r.precio_venta_moneda||0) * _tasaVigente) + ' Bs</span>'
            + '<div style="font-size:10px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(r.precio_venta_moneda) + '</div>'
            + '<div style="font-size:10px;color:var(--suave);margin-top:2px">Margen: ' + margen.toFixed(1) + '%</div></td>'
          : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
      + '<td><div style="display:flex;gap:6px">'
      + '<button class="btn-naranja" onclick="verFichaInventario(' + r.id_articulo + ')">Ver</button>'
      + (puedo('INVENTARIO','ENTRADA_STOCK') ? '<button class="btn-secundario" style="border-color:rgba(255,107,0,0.4);color:var(--naranja)" onclick="abrirStockArticulo(' + r.id_articulo + ',\'' + r.nombre_articulo.replace(/'/g,"\\'"  ) + '\')" >Stock</button>' : '')
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
        + '<td style="font-weight:500">' + r.nombre_articulo + '</td>'
        + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_actual_articulo + ' ' + (r.unidad||'UND') + '</td>'
        + '<td style="font-family:var(--font-mono)">$ ' + fmtUSD(r.precio_venta_moneda) + '</td>'
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
    const pr = calcularPuntoReorden(r);
    const critico = r.stock_actual_articulo <= r.stock_minimo_articulo;
    const enReorden = !critico && r.stock_actual_articulo <= pr;
    const demanda = r.demanda_diaria || (r.demanda_anual ? (r.demanda_anual/365).toFixed(2) : null);
    return '<tr>'
      + '<td><div style="font-weight:500">' + r.nombre_articulo + '</div><div style="font-size:10px;color:var(--suave)">' + (r.codigo_articulo||'') + '</div></td>'
      + '<td style="font-family:var(--font-mono);text-align:center">' + r.stock_actual_articulo + '</td>'
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

  // ── GET fresco de BD para stock y costos actualizados ──
  try {
    var qs = '?id_articulo=eq.' + id + '&select=stock_actual_articulo,precio_costo_moneda,precio_costo_ultimo_moneda,precio_venta_moneda';
    if (_empresaActiva && _empresaActiva.id_empresa) qs += '&id_empresa=eq.' + _empresaActiva.id_empresa;
    var fresh = await api('inventario_almacen', 'GET', null, qs);
    if (fresh && fresh[0]) {
      r.stock_actual_articulo      = parseFloat(fresh[0].stock_actual_articulo)      || 0;
      r.precio_costo_moneda        = parseFloat(fresh[0].precio_costo_moneda)        || 0;
      r.precio_costo_ultimo_moneda = parseFloat(fresh[0].precio_costo_ultimo_moneda) || 0;
      r.precio_venta_moneda        = parseFloat(fresh[0].precio_venta_moneda)        || 0;
    }
  } catch(e) { console.warn('verFichaInventario GET fresco:', e.message); }

  const abcMap = {};
  clasificarABC(inventarioCache).forEach(function(x) { abcMap[x.id_articulo] = x.clase_abc; });
  const abc = abcMap[r.id_articulo] || '—';
  const abcColor = { A: '#22c55e', B: '#f59e0b', C: '#94a3b8' };
  const margen = ((parseFloat(r.precio_venta_moneda||0) - parseFloat(r.precio_costo_moneda||0)) / (parseFloat(r.precio_venta_moneda||0)||1) * 100).toFixed(1);
  const stockBajo = r.stock_actual_articulo <= r.stock_minimo_articulo;

  document.getElementById('ficha-inv-contenido').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">'
    + '<span style="font-size:11px;font-weight:700;color:' + (abcColor[abc]||'#888') + ';background:' + (abcColor[abc]||'#888') + '22;padding:4px 10px;border-radius:4px">Clase ' + abc + '</span>'
    + '<div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + r.nombre_articulo + '</div>'
    + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (r.codigo_articulo || 'Sin código') + ' · ' + (r.unidad || 'UND') + '</div>'
    + '</div></div>'
    + (r.descripcion ? '<div style="background:var(--gris2);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--suave)">' + r.descripcion + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Actual</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px;color:' + (stockBajo ? '#fc8181' : 'var(--naranja)') + '">' + (_invSaldoArea ? (_invSaldoArea[r.id_articulo]||0) : r.stock_actual_articulo) + ' ' + (r.unidad||'UND') + '</div>'
    + (_invSaldoArea ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Stock en tu área</div>' : '')
    + (stockBajo ? '<div style="font-size:10px;color:#fc8181;margin-top:3px">⚠ Bajo mínimo (' + r.stock_minimo_articulo + ')</div>' : '') + '</div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Mínimo</div>'
    + '<div style="font-family:var(--font-mono);font-size:18px">' + r.stock_minimo_articulo + ' ' + (r.unidad||'UND') + '</div></div>'
    + (puedo('INVENTARIO','VER_COSTOS') ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Costo Prom. (CPP)</div><div style="font-family:var(--font-mono)">$ ' + fmtUSD(r.precio_costo_moneda) + '</div></div>' : '')
    + (puedo('INVENTARIO','VER_PRECIOS_VENTA')
        ? '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio Venta</div>'
          + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + fmtBs(parseFloat(r.precio_venta_moneda||0) * _tasaVigente) + ' Bs</div>'
          + '<div style="font-size:11px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(r.precio_venta_moneda) + '</div>'
          + '<div style="font-size:10px;color:var(--suave);margin-top:2px">Margen: ' + margen + '%</div></div>'
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

  // Cargar nombres de cuentas contables
  var _idsC = [r.id_cuenta_contable, r.id_cuenta_costo_gasto].filter(Boolean).join(',');
  if (_idsC) {
    api('cont_cuentas','GET',null,'?id_cuenta=in.('+_idsC+')&select=id_cuenta,codigo,nombre').then(function(ctas) {
      var ctaInv = ctas ? ctas.find(function(c){ return c.id_cuenta === r.id_cuenta_contable; }) : null;
      var ctaCG  = ctas ? ctas.find(function(c){ return c.id_cuenta === r.id_cuenta_costo_gasto; }) : null;
      var elInv  = document.getElementById('ficha-inv-cta-inventario');
      var elCG   = document.getElementById('ficha-inv-cta-costo');
      if (elInv) elInv.textContent = ctaInv ? ctaInv.codigo + ' — ' + ctaInv.nombre : '—';
      if (elCG)  elCG.textContent  = ctaCG  ? ctaCG.codigo  + ' — ' + ctaCG.nombre  : '—';
    });
  }

  // Cargar historial de entradas y salidas
  verHistorialEntradas(r.id_articulo);
  verHistorialSalidas(r.id_articulo);
}

function regresarAFichaInv() {
  // Cierra cualquier modal secundario (historial, edición) y reabre la ficha del artículo actual
  cerrarModal('modal-historial-stock');
  cerrarModal('modal-edit-movimiento');
  cerrarModal('modal-entrada-stock');
  if (_fichaInvActual && _fichaInvActual.id) {
    verFichaInventario(_fichaInvActual.id);
  }
}

async function abrirEntradaStock(id) {
  let r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r && _fichaInvActual && _fichaInvActual.id === id) {
    r = _fichaInvActual;
    r.id_articulo = id;
  }
  if (!r) { alert('Error: artículo no encontrado. Intente recargar el inventario.'); return; }

  // GET fresco de BD
  try {
    var qs = '?id_articulo=eq.' + id + '&select=stock_actual_articulo,precio_costo_moneda,precio_venta_moneda,unidad';
    if (_empresaActiva && _empresaActiva.id_empresa) qs += '&id_empresa=eq.' + _empresaActiva.id_empresa;
    const fresh = await api('inventario_almacen', 'GET', null, qs);
    if (fresh && fresh[0]) {
      if (fresh[0].stock_actual_articulo != null) r.stock_actual_articulo = parseFloat(fresh[0].stock_actual_articulo);
      if (fresh[0].precio_costo_moneda   != null) r.precio_costo_moneda   = parseFloat(fresh[0].precio_costo_moneda);
      if (fresh[0].precio_venta_moneda   != null) r.precio_venta_moneda   = parseFloat(fresh[0].precio_venta_moneda);
    }
  } catch(e) { console.warn('abrirEntradaStock GET fresco:', e.message); }

  document.getElementById('es-id').value = id;
  document.getElementById('es-nombre').textContent = r.nombre_articulo;
  document.getElementById('es-stock-actual').textContent = (r.stock_actual_articulo || 0) + ' ' + (r.unidad || 'UND');
  document.getElementById('es-cantidad').value = '';
  var selMoneda = document.getElementById('es-moneda-compra');
  if (selMoneda) selMoneda.selectedIndex = 0;
  document.getElementById('es-precio-costo').value = '0.00';
  var selMotivo = document.getElementById('es-motivo');
  if (selMotivo) selMotivo.selectedIndex = 0;
  var selPago = document.getElementById('es-esquema-pago');
  if (selPago) selPago.selectedIndex = 0;
  if (document.getElementById('es-fecha-negociacion')) document.getElementById('es-fecha-negociacion').value = getHoyVzla();
  document.getElementById('es-precio-venta').value = r.precio_venta_moneda || '';
  var esVentaCont = document.getElementById('es-precio-venta-cont');
  if (esVentaCont) esVentaCont.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  const refCPP = document.getElementById('es-ref-cpp');
  if (refCPP) refCPP.textContent = '$ ' + fmtUSD(r.precio_costo_moneda) + ' (CPP actual)';
  document.getElementById('alerta-es-ok').style.display = 'none';
  document.getElementById('alerta-es-err').style.display = 'none';
  if (document.getElementById('es-clave-receptor'))  document.getElementById('es-clave-receptor').value = '';
  if (document.getElementById('es-cliente-nombre')) document.getElementById('es-cliente-nombre').value = '';
  if (document.getElementById('es-area-origen'))    document.getElementById('es-area-origen').value = '';
  if (document.getElementById('es-moneda-compra'))  { var sm = document.getElementById('es-moneda-compra'); sm.selectedIndex = 0; }
  if (document.getElementById('es-tasa-cont'))      document.getElementById('es-tasa-cont').style.display = 'none';
  if (document.getElementById('es-precio-usd-cont'))document.getElementById('es-precio-usd-cont').style.display = 'none';
  if (document.getElementById('es-tasa-bcv'))       document.getElementById('es-tasa-bcv').value = '';
  if (document.getElementById('es-precio-usd-calc'))document.getElementById('es-precio-usd-calc').value = '';
  const esquemaEl = document.getElementById('es-esquema-pago');
  if (esquemaEl) esquemaEl.selectedIndex = 0;
  const creditoCont = document.getElementById('es-credito-cont');
  if (creditoCont) creditoCont.style.display = 'none';
  const prevEl = document.getElementById('es-cuotas-preview');
  if (prevEl) { prevEl.innerHTML = ''; delete prevEl.dataset.cuotas; }
  // Setear área y empleado desde el usuario logueado (hidden fields)
  await cargarUsuarioReceptorEntrada();
  document.getElementById('es-proveedor').innerHTML = '<option value="">— Seleccionar proveedor (opcional) —</option>';
  Promise.all([
    api('proveedores', 'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif,id_categoria,param_categorias_proveedor:id_categoria(nombre)'),
    api('param_categorias_proveedor','GET',null,'?nombre=ilike.*Artículo*&select=id&limit=1'),
    api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
  ]).then(function(res) {
    var provs = res[0], areas = res[2];
    var catArticulo = res[1] && res[1][0] ? res[1][0].id : null;
    if (catArticulo) provs = provs.filter(function(p){ return p.id_categoria === catArticulo; });
    var selProv = document.getElementById('es-proveedor');
    selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
      + provs.map(function(p) { return '<option value="' + p.id_proveedor + '">' + p.nombre + (p.rif ? ' (' + p.rif + ')' : '') + '</option>'; }).join('');
    var selOrigen = document.getElementById('es-area-origen');
    if (selOrigen) {
      selOrigen.innerHTML = '<option value="">— Seleccionar área de origen —</option>'
        + areas.map(function(a) { return '<option value="' + a.id + '">' + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>'; }).join('');
    }
    onCambiarMotivoEntrada();
    if (typeof buscarTasaBCVNegociacion === 'function') buscarTasaBCVNegociacion();
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
  const fechaNeg  = document.getElementById('es-fecha-negociacion')?.value;
  const hoy       = getHoyVzla();
  if (!fechaNeg)                    return mostrarError('Seleccione la Fecha Negociación.', 'es-fecha-negociacion');
  if (fechaNeg > hoy)               return mostrarError('La Fecha Negociación no puede ser mayor al día de hoy.', 'es-fecha-negociacion');
  const monedaSel = document.getElementById('es-moneda-compra')?.value;
  if (!monedaSel)                   return mostrarError('Seleccione la Moneda Negociación.', 'es-moneda-compra');
  if (cantidad <= 0)                return mostrarError('Ingrese una cantidad mayor a 0.', 'es-cantidad');
  const precioVal = parseFloat(document.getElementById('es-precio-costo')?.value) || 0;
  if (precioVal <= 0)               return mostrarError('Ingrese el Precio Negociación.', 'es-precio-costo');
  // Precio Venta — opcional, no se valida
  const motivoSel = document.getElementById('es-motivo')?.value;
  if (!motivoSel)                   return mostrarError('Seleccione la Transacción.', 'es-motivo');
  // Proveedor o área origen — obligatorio según motivo
  if (motivoSel === 'compra') {
    const provSel = document.getElementById('es-proveedor')?.value;
    if (!provSel)                   return mostrarError('Seleccione el Proveedor.', 'es-proveedor');
  } else if (motivoSel === 'transferencia') {
    const areaOrig = document.getElementById('es-area-origen')?.value;
    if (!areaOrig)                  return mostrarError('Seleccione el Área de Origen.', 'es-area-origen');
  } else if (motivoSel === 'devolucion') {
    const clienteNom = document.getElementById('es-cliente-nombre')?.value?.trim();
    if (!clienteNom)                return mostrarError('Ingrese el nombre del cliente.', 'es-cliente-nombre');
  }
  const pagoDSel  = document.getElementById('es-esquema-pago')?.value;
  if (!pagoDSel) return mostrarError('Seleccione la Modalidad de Pago.', 'es-esquema-pago');
  if (pagoDSel === 'CREDITO') {
    const numCuotasVal  = parseInt(document.getElementById('es-cuotas-num')?.value) || 0;
    const fechaCuotaVal = document.getElementById('es-cuotas-fecha-inicio')?.value || '';
    if (!numCuotasVal || numCuotasVal < 1) return mostrarError('Ingrese el número de cuotas.', 'es-cuotas-num');
    if (!fechaCuotaVal) return mostrarError('Ingrese la Fecha de la Primera Cuota.', 'es-cuotas-fecha-inicio');
    if (fechaCuotaVal <= getHoyVzla()) return mostrarError('La Fecha de la Primera Cuota tiene que ser mayor que el día de hoy.', 'es-cuotas-fecha-inicio');
  }
  // Observaciones — opcional, no se valida

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
    let tasa_bcv_usada           = tasaBCVVal > 0 ? tasaBCVVal : null;
    // Si no hay tasa, buscarla de la fecha de negociación
    if (!tasa_bcv_usada) {
      const fechaNeg = document.getElementById('es-fecha-negociacion')?.value || getHoyVzla();
      try {
        const tasaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaNeg+'&order=fecha_valor.desc&limit=1&select=tipo_cambio');
        if (tasaRows && tasaRows[0]) tasa_bcv_usada = parseFloat(tasaRows[0].tipo_cambio);
      } catch(e) {}
    }
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
    const id_areaEntVal = document.getElementById('es-area')?.value || 
      (_empresaActiva?.id_area_principal || null);
    const idEmpEntVal = parseInt(document.getElementById('es-empleado')?.value) || null;
    const claveEnt = document.getElementById('es-clave-receptor')?.value || '';
    if (!claveEnt) { errEl.textContent = 'El empleado remitente debe ingresar su contraseña.'; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }
    const validEnt = await validarClaveReceptor(idEmpEntVal, claveEnt);
    if (!validEnt.ok) { errEl.textContent = validEnt.msg; errEl.style.display = 'block'; document.getElementById('es-clave-receptor')?.focus(); resetBtn(); return; }

    // ── FASE 2: Leer stock fresco de BD (única fuente de verdad) ──
    let stockActual = parseFloat(r?.stock_actual_articulo || 0);
    let costoActual = parseFloat(r?.precio_costo_moneda || 0);
    const artFresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id + '&select=stock_actual_articulo,precio_costo_moneda');
    if (artFresh && artFresh[0]) {
      stockActual = parseFloat(artFresh[0].stock_actual_articulo || 0);
      costoActual = parseFloat(artFresh[0].precio_costo_moneda || 0);
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
    const id_areaEnt  = parseInt(id_areaEntVal) || null;
    const idProvEnt  = (motivoEnt === 'compra') ? (parseInt(document.getElementById('es-proveedor')?.value) || null) : null;
    const clienteNomH  = (motivoEnt === 'devolucion') ? (document.getElementById('es-cliente-nombre')?.value.trim() || null) : null;
    const id_areaOrigenH = (motivoEnt === 'transferencia') ? (parseInt(document.getElementById('es-area-origen')?.value) || null) : null;

    let id_entrada = null;
    const entradaRes = await api('stock_entradas', 'POST', {
      id_articulo:            id,
      cantidad:               cantidad,
      precio_costo_moneda:    nuevoPrecioCosto || null,
      precio_compra_original: precio_compra_original || null,
      precio_venta_moneda:    nuevoPrecioVenta || null,
      moneda_compra:          moneda_compra_val,
      tasa_bcv:               tasa_bcv_usada,
      fecha_entrada:          getHoyVzla(),
      fecha_negociacion:      document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
      id_area:                id_areaEnt,
      id_empleado:            idEmpEntVal,
      id_proveedor:           idProvEnt,
      cliente_nombre:         clienteNomH,
      id_area_origen:         id_areaOrigenH,
      motivo:                 motivoEnt || null,
      esquema_pago:           document.getElementById('es-esquema-pago')?.value || null,
      observaciones:          document.getElementById('es-observaciones')?.value.trim() || null,
      id_usuario:             sesionActual.correo_usuario
    });
    id_entrada = entradaRes && entradaRes[0] ? entradaRes[0].id_entrada : null;

    // ── FASE 4: Actualizar stock e inventario DESPUÉS del INSERT exitoso ──
    const patch = { stock_actual_articulo: nuevoStock, precio_costo_moneda: parseFloat(cpp.toFixed(4)) };
    if (nuevoPrecioCosto > 0) patch.precio_costo_ultimo_moneda = nuevoPrecioCosto;
    if (nuevoPrecioVenta && nuevoPrecioVenta > 0 && puedo('INVENTARIO','VER_PRECIOS_VENTA')) patch.precio_venta_moneda = nuevoPrecioVenta;
    await api('inventario_almacen', 'PATCH', patch, '?id_articulo=eq.' + id);

    // ── FASE 4.5: Registrar salida en área origen si es transferencia ──
    if (motivoEnt === 'transferencia' && id_areaOrigenH) {
      const idEmpEntregaH = parseInt(document.getElementById('es-empleado-entrega')?.value) || null;
      await api('stock_salidas', 'POST', {
        id_articulo:       id,
        cantidad:          cantidad,
        fecha_salida:      getHoyVzla(),
        id_area:           id_areaEnt,          // destino (receptor)
        id_area_entrega:   id_areaOrigenH,       // origen (quien entrega)
        id_empleado:       idEmpEntVal,         // receptor
        id_empleado_entrega: idEmpEntregaH,
        observaciones:     document.getElementById('es-observaciones')?.value.trim() || null,
        id_usuario:        sesionActual.correo_usuario
      });
      // Actualizar stock_actual del área origen — decrementar
      const artOrigen = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+id+'&select=stock_actual_articulo');
      const stockOrigen = parseFloat(artOrigen?.[0]?.stock_actual_articulo || 0);
      // stock_actual ya fue actualizado con nuevoStock (que sumó la entrada)
      // necesitamos decrementar adicionalmente por la salida del origen
      // stock_actual = (stock antes de transferencia) - cantidad + cantidad = sin cambio neto
      // Corrección: el stock_actual debe bajar solo si es una salida sin entrada (diferente área)
      // Para transferencia: stock_actual no cambia (entra en una área, sale de otra, mismo artículo)
    }

    // ── FASE 5: Asiento contable ──
    // Transferencias de CONSUMIBLES generan asiento: DEBE gasto / HABER inventario
    if (motivoEnt === 'transferencia' && r.id_cuenta_contable && r.id_cuenta_costo_gasto) {
      try {
        // Calcular CPP_VES promedio ponderado (solo entradas en USD)
        const entradasArt = await api('stock_entradas','GET',null,'?id_articulo=eq.'+id+'&select=cantidad,precio_costo_usd,tasa_bcv,moneda_compra&order=fecha_entrada.asc') || [];
        var sumQxTasa = 0; var sumQ = 0;
        entradasArt.forEach(function(e) {
          var q = parseFloat(e.cantidad||0);
          var t = parseFloat(e.tasa_bcv||0);
          if (q > 0 && t > 0 && (e.moneda_compra||'USD') === 'USD') {
            sumQxTasa += q * t;
            sumQ += q;
          }
        });
        var tasaPromedio = sumQ > 0 ? sumQxTasa / sumQ : (_tasaVigente || 1);
        var cppUSD = parseFloat(r.precio_costo_moneda || 0);
        var montoVESTransf = parseFloat((cantidad * cppUSD * tasaPromedio).toFixed(2));

        // Numero asiento
        var anioT = new Date().getFullYear();
        var ultsT = await api('cont_asientos','GET',null,'?id_empresa=eq.'+(sesionActual?.id_empresa||_empresaActiva?.id_empresa||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
        var seqT = 1;
        if (ultsT[0]?.numero_asiento) { var mmT = ultsT[0].numero_asiento.match(/(\d+)$/); if (mmT) seqT = parseInt(mmT[1])+1; }
        var numAstT = 'AST-' + anioT + '-' + String(seqT).padStart(4,'0');

        var astT = await api('cont_asientos','POST',{
          id_empresa: sesionActual?.id_empresa||_empresaActiva?.id_empresa||0,
          numero_asiento: numAstT, tipo: 'CONSUMO_INVENTARIO',
          fecha: document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
          descripcion: 'Consumo inventario: ' + (r.nombre_articulo||'') + ' x' + cantidad + ' — Transfer a: ' + (document.getElementById('es-area-display')?.textContent||''),
          referencia: id_entrada ? 'ENT-' + id_entrada : 'TRANSF-'+id,
          estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaPromedio,
          id_usuario: sesionActual?.correo_usuario || null
        });
        var arT = Array.isArray(astT) ? astT[0] : astT;
        if (arT?.id_asiento) {
          // DEBE: Cuenta Costo/Gasto (6.1.02.004)
          await api('cont_asiento_lineas','POST',{ id_asiento:arT.id_asiento, id_cuenta:r.id_cuenta_costo_gasto, orden:1,
            descripcion:'Consumo: '+(r.nombre_articulo||'')+' x'+cantidad+' (CPP $'+cppUSD.toFixed(2)+' x T/C '+tasaPromedio.toFixed(2)+')',
            debe_usd:0, haber_usd:0, debe_ves:montoVESTransf, haber_ves:0, tasa_bcv:tasaPromedio });
          // HABER: Cuenta Inventario (1.1.03.xxx)
          await api('cont_asiento_lineas','POST',{ id_asiento:arT.id_asiento, id_cuenta:r.id_cuenta_contable, orden:2,
            descripcion:'Salida inventario consumible: '+(r.nombre_articulo||'')+' x'+cantidad,
            debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoVESTransf, tasa_bcv:tasaPromedio });
        }
      } catch(eAstTransf) { console.warn('Error asiento transferencia consumible:', eAstTransf); }
    }

    // Transferencias de otros articulos (Mercancias) NO generan asiento aqui
    if (motivoEnt !== "transferencia") try {
      const areaNombreEnt = document.getElementById('es-area-display')?.textContent || 'Área';
      const tipoAst = motivoEnt === 'compra' ? 'ENTRADA_COMPRA'
                    : motivoEnt === 'devolucion' ? 'ENTRADA_DEVOLUCION'
                    : 'ENTRADA_AJUSTE';
      await generarAsientoInventario(tipoAst, {
        articulo:   r.nombre_articulo || r.codigo_articulo || ('Art#' + id),
        cantidad:   cantidad,
        montoUSD:   nuevoPrecioCosto * cantidad,
        areaId:     id_areaEnt,
        areaNombre: areaNombreEnt,
        referencia: id_entrada ? 'ENT-' + id_entrada : ('ENT-INV-' + id),
        id_cuentaInventario: r.id_cuenta_contable || null,
        fecha:      document.getElementById('es-fecha-negociacion')?.value || getHoyVzla(),
        tasa:       tasa_bcv_usada || null
      });
    } catch(eAstInv) { console.warn('Error asiento entrada inventario:', eAstInv); }

    // ── FASE 5B: Crear CxP según esquema de pago ──
    console.log('[SYD] fase5b motivo=' + motivoEnt + ' id_entrada=' + id_entrada + ' esquema=' + document.getElementById('es-esquema-pago')?.value);
    if (motivoEnt === 'compra') {
      try {
        const id_proveedor = parseInt(document.getElementById('es-proveedor')?.value) || null;
        const montoUSD    = parseFloat((nuevoPrecioCosto * cantidad).toFixed(2));
        const montoVES    = parseFloat((montoUSD * _tasaVigente).toFixed(2));
        const esquema     = document.getElementById('es-esquema-pago')?.value || 'CONTADO';
        const numDocBase  = id_entrada ? 'ENT-' + id_entrada : ('ENT-INV-' + id);
        const artNomCxP   = r.nombre_articulo || r.codigo_articulo || 'Art#'+id;
        const fechaNegCxP = document.getElementById('es-fecha-negociacion')?.value || getHoyVzla();

        if (esquema === 'CONTADO') {
          // Una sola CxP — contado
          await api('cont_cxp','POST',{
            id_proveedor:    id_proveedor,
            id_empresa:      _empresaActiva?.id_empresa || null,
            id_cuenta_gasto: r.id_cuenta_costo_gasto || null,
            tipo:            'COMPRA_ARTICULO',
            numero_doc:      numDocBase,
            fecha_emision:   fechaNegCxP,
            fecha_vencimiento: fechaNegCxP,
            moneda_pago:     monedaCompra || 'USD',
            estado:          'PENDIENTE',
            monto_usd:       montoUSD,
            monto_ves:       montoVES,
            tasa_bcv:        tasa_bcv_usada || 1,
            tasa_bcv_compra: tasa_bcv_usada || 1,
            pagado_usd:      0,
            saldo_usd:       montoUSD,
            observaciones:   artNomCxP + ' x ' + cantidad + ' uds.',
            esquema_pago:    'CONTADO',
            id_usuario:      sesionActual?.correo_usuario || null
          });
        } else {
          // Crédito — múltiples CxP, una por cuota
          const preview = document.getElementById('es-cuotas-preview');
          const cuotas  = preview?.dataset.cuotas ? JSON.parse(preview.dataset.cuotas) : [];
          if (!cuotas.length) throw new Error('No se calcularon las cuotas. Complete los campos de crédito.');
          for (let i = 0; i < cuotas.length; i++) {
            const c = cuotas[i];
            await api('cont_cxp','POST',{
              id_proveedor:     id_proveedor,
              id_empresa:       _empresaActiva?.id_empresa || null,
              id_cuenta_gasto:  r.id_cuenta_costo_gasto || null,
              tipo:             'COMPRA_ARTICULO_CREDITO',
              numero_doc:       numDocBase + '-C' + c.num,
              fecha_emision:    fechaNegCxP,
              fecha_vencimiento: c.fecha,
              moneda_pago:      monedaCompra || 'USD',
              estado:           'PENDIENTE',
              monto_usd:        parseFloat(c.monto.toFixed(2)),
              monto_ves:        parseFloat((c.monto * (tasa_bcv_usada||1)).toFixed(2)),
              tasa_bcv:         tasa_bcv_usada || 1,
              tasa_bcv_compra:  tasa_bcv_usada || 1,
              pagado_usd:       0,
              saldo_usd:        parseFloat(c.monto.toFixed(2)),
              observaciones:    artNomCxP + ' x ' + cantidad + ' uds.',
              esquema_pago:     'CREDITO',
              id_usuario:       sesionActual?.correo_usuario || null
            });
          }
        }
      } catch(eCxP) { console.warn('Error creando CxP:', eCxP.message); }
    }

    // ── FASE 6: Actualizar cache y cerrar ──
    if (r) {
      r.stock_actual_articulo     = nuevoStock;
      r.precio_costo_moneda       = parseFloat(cpp.toFixed(4));
      if (nuevoPrecioCosto > 0) r.precio_costo_ultimo_moneda = nuevoPrecioCosto;
      if (nuevoPrecioVenta && nuevoPrecioVenta > 0) r.precio_venta_moneda = nuevoPrecioVenta;
    }
    okEl.textContent = 'Stock actualizado: ' + stockActual + ' → ' + nuevoStock + ' ' + (r?.unidad || 'UND');
    okEl.style.display = 'block';
    setTimeout(async function() {
      cerrarModal('modal-entrada-stock');
      cerrarModal('modal-stock-articulo');
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      // Flujo 1: ir a Ficha ARTÍCULO
      if (_fichaInvActual && _fichaInvActual.id) verFichaInventario(_fichaInvActual.id);
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
  // Cargar cuentas del grupo 1.1.03 para nuevo artículo
  try {
    const ctas113 = await api('cont_cuentas','GET',null,'?codigo=like.1.1.03*&estado=eq.ACTIVA&permite_movimiento=eq.true&order=codigo.asc&select=id_cuenta,codigo,nombre') || [];
    const selCta = document.getElementById('inv-cuenta-contable');
    if (selCta) selCta.innerHTML = '<option value="">— Seleccionar cuenta 1.1.03.xxx —</option>' + ctas113.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
    const ctasCGn = await api('cont_cuentas','GET',null,'?tipo=in.(EGRESO,COSTO)&estado=eq.ACTIVA&permite_movimiento=eq.true&order=codigo.asc&select=id_cuenta,codigo,nombre') || [];
    const selCGn = document.getElementById('inv-cuenta-costo-gasto');
    if (selCGn) { selCGn.innerHTML = '<option value="">— Seleccionar cuenta —</option>' + ctasCGn.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join(''); selCGn.value = ''; }
  } catch(e2) {}
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
    document.getElementById('inv-categoria')?.focus();
  }, 80);
}

async function abrirEditarInventario(id) {
  // Asegurar que _invSaldoArea esté calculado para mostrar stock correcto del área
  await calcularInvSaldoArea();
  try {
    const ctas113e = await api('cont_cuentas','GET',null,'?codigo=like.1.1.03*&estado=eq.ACTIVA&permite_movimiento=eq.true&order=codigo.asc&select=id_cuenta,codigo,nombre') || [];
    const selCtaE = document.getElementById('inv-cuenta-contable');
    if (selCtaE) { selCtaE.innerHTML = '<option value="">— Seleccionar —</option>' + ctas113e.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join(''); }
    const ctasCGe = await api('cont_cuentas','GET',null,'?tipo=in.(EGRESO,COSTO)&estado=eq.ACTIVA&permite_movimiento=eq.true&order=codigo.asc&select=id_cuenta,codigo,nombre') || [];
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
  document.getElementById('inv-nombre').value = r.nombre_articulo;
  document.getElementById('inv-descripcion').value = r.descripcion || '';
  document.getElementById('inv-stock').value = r.stock_actual_articulo;
  document.getElementById('inv-stock-min').value = r.stock_minimo_articulo;
  document.getElementById('inv-costo').value = r.precio_costo_moneda || '';
  document.getElementById('inv-venta').value = r.precio_venta_moneda || '';
  var invVentaCont = document.getElementById('inv-venta-cont');
  if (invVentaCont) invVentaCont.style.display = puedo('INVENTARIO','VER_PRECIOS_VENTA') ? '' : 'none';
  document.getElementById('inv-unidad').value = r.unidad || 'UND';
  await invCargarCategorias(r.id_categoria_articulo || null);
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
    const stockFicha = _invSaldoArea ? (_invSaldoArea[r.id_articulo] || 0) : r.stock_actual_articulo;
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
    const datos = { nombre_articulo: nombre, descripcion_articulo: desc || null, codigo_articulo: codigo || null, stock_actual_articulo: stock,
      stock_minimo_articulo: stockMin, precio_costo_moneda: costo,
      id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null,
      ...(ventaFinal !== undefined ? { precio_venta_moneda: ventaFinal } : {}),
      unidad, id_categoria_articulo: id_categoria, id_tipo_articulo: id_tipo_articulo,
      id_cuenta_contable: parseInt(document.getElementById('inv-cuenta-contable')?.value) || null,
      id_cuenta_costo_gasto: parseInt(document.getElementById('inv-cuenta-costo-gasto')?.value) || null,
      demanda_anual: demandaAnual, lead_time_dias: leadTime, costo_pedido_usd: costoPedido, stock_seguridad: stockSeg,
      id_usuario: sesionActual.correo_usuario };
    if (id) {
      await api('inventario_almacen', 'PATCH', datos, '?id_articulo=eq.' + id);
    } else {
      await api('inventario_almacen', 'POST', datos);
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
      api('os_mercancias',   'GET', null, '?id_articulo=eq.' + id + '&select=id_os_rep&limit=1')
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

// ─── HISTORIAL DE ENTRADAS ───
async function verHistorialEntradas(id_articulo) {
  const cont = document.getElementById('ficha-inv-historial');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--suave);font-size:12px">Cargando...</div>';
  try {
    // Si el usuario solo ve su área, filtrar historial por área
    const id_areaFiltro = _invSaldoArea && sesionActual?.correo_usuario
      ? await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').then(function(r){ return r&&r[0]?r[0].id_area:null; }).catch(function(){ return null; })
      : null;
    let filas = [];

    if (id_areaFiltro) {
      // Para operador de área: sus "entradas" son las salidas del almacén hacia su área
      const salsRecibidas = await api('stock_salidas','GET',null,
        '?id_articulo=eq.'+id_articulo+'&id_area=eq.'+id_areaFiltro+'&order=fecha_salida.desc&select=*,area_origen:id_area_entrega(nombre,codigo)');
      if (!salsRecibidas || !salsRecibidas.length) {
        cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:8px 0">Sin entradas en tu área.</div>';
        return;
      }
      filas = salsRecibidas.map(function(s) {
        const origen = s.area_origen ? s.area_origen.nombre+(s.area_origen.codigo?' ('+s.area_origen.codigo+')':'') : 'Almacén';
        const estado = s.anulada
          ? '<span style="color:#fc8181;font-size:10px">Anulada</span>'
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
    const qEntradas = '?id_articulo=eq.' + id_articulo + '&order=fecha_entrada.desc&select=*';
    const entradas = await api('stock_entradas', 'GET', null, qEntradas);
    if (!entradas || !entradas.length) {
      cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:8px 0">Sin entradas registradas.</div>';
      return;
    }
    const motivoLabel = { compra:'Compra', devolucion:'Devolución', transferencia:'Transferencia', ajuste:'Ajuste' };
    cont.innerHTML = '<div style="margin-top:16px;border-top:1px solid var(--borde);padding-top:12px">'
      + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;margin-bottom:8px">HISTORIAL DE ENTRADAS</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">'
      + '<colgroup><col style="width:88px"><col style="width:52px"><col style="width:108px"><col style="width:80px"><col style="width:65px"><col style="width:75px"></colgroup>'
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
          const prec = parseFloat(e.precio_compra_original || e.precio_costo_moneda || 0);
          const precFmt = mon === 'VES' ? fmtBs(prec) + ' Bs' : '$ ' + fmtUSD(prec) + ' ' + mon;
          const estado = e.anulada
            ? '<span style="color:#fc8181;font-size:10px">Anulada</span>'
            : '<span style="color:#22c55e;font-size:10px">Activa</span>';
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">'
            + '<td style="padding:6px 4px">' + fmtFecha(e.fecha_entrada) + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + e.cantidad + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + precFmt + '</td>'
            + '<td style="padding:6px 4px">' + (motivoLabel[e.motivo] || e.motivo || '—') + '</td>'
            + '<td style="text-align:center;padding:6px 4px">' + estado + '</td>'
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
    descripcion:document.getElementById('icat-desc')?.value.trim()||null, id_empresa:_empresaActiva?.id_empresa||null };
  try {
    if (id) await api('inv_categorias','PATCH',datos,'?id_categoria=eq.'+id);
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
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const [tipos, cats] = await Promise.all([
      api('inv_articulos_tipo','GET',null,'?id_empresa=eq.'+id_emisor+'&order=nombre.asc&select=*'),
      api('inv_categorias','GET',null,'?id_empresa=eq.'+id_emisor+'&select=id_categoria,nombre,codigo'),
    ]);
    const catsMap = {}; (cats||[]).forEach(function(c){ catsMap[c.id]=c; });
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
    descripcion:document.getElementById('itipo-desc')?.value.trim()||null, id_empresa:_empresaActiva?.id_empresa||null };
  try {
    if (id) await api('inv_articulos_tipo','PATCH',datos,'?id_tipo=eq.'+id);
    else    await api('inv_articulos_tipo','POST',datos);
    okEl.textContent='✓ Tipo '+(id?'actualizado':'creado')+'.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-param'); invRenderTipos(); }, 900);
  } catch(e) { errEl.textContent='Error: '+e.message; errEl.style.display='block'; }
}

// ─── ANULAR ENTRADA ───
async function reversarEntrada(id_entrada, id_articulo, cantidad) {
  await reversarMovimiento('ENTRADA', id_entrada, cantidad, id_articulo);
  // Retornar a inventario general después del reverso
  cerrarTodosLosModales();
  renderInventario();
}
// ─── HISTORIAL DE SALIDAS ───
async function verHistorialSalidas(id_articulo) {
  const cont = document.getElementById('ficha-inv-historial-salidas');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--suave);font-size:12px">Cargando...</div>';
  try {
    const id_areaFiltro = _invSaldoArea && sesionActual?.correo_usuario
      ? await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').then(function(r){ return r&&r[0]?r[0].id_area:null; }).catch(function(){ return null; })
      : null;
    // Para operador: solo salidas enviadas DESDE su área (id_area_entrega)
    // Las recibidas ya se muestran en "Entradas a tu área"
    const qSalidas = '?id_articulo=eq.' + id_articulo + '&order=fecha_salida.desc&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo)'
      + (id_areaFiltro ? '&id_area_entrega=eq.'+id_areaFiltro : '');
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
          const area = s.area_receptora ? s.area_receptora.nombre + (s.area_receptora.codigo ? ' (' + s.area_receptora.codigo + ')' : '') : '—';
          const estado = s.anulada
            ? '<span style="color:#fc8181;font-size:10px">Anulada</span>'
            : '<span style="color:#22c55e;font-size:10px">Activa</span>';
          return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">'
            + '<td style="padding:6px 4px">' + fmtFecha(s.fecha_salida) + '</td>'
            + '<td style="text-align:right;padding:6px 4px;font-family:var(--font-mono)">' + s.cantidad + '</td>'
            + '<td style="padding:6px 4px">' + area + '</td>'
            + '<td style="text-align:center;padding:6px 4px">' + estado + '</td>'
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
        if (art.id_categoria_articulo) {
          const c = _invCategoriasCache.find(function(c){ return c.id_categoria === art.id_categoria_articulo; });
          if (c) return (c.codigo ? c.codigo + ' — ' : '') + c.nombre.toUpperCase();
        }
        var _catG = _invCategoriasCache.find(function(c){ return c.id_categoria === art.id_categoria_articulo; }); return (_catG ? _catG.nombre : 'SIN CATEGORÍA').toUpperCase();
      };
      entradas.forEach(function(e) {
        const art = getArt(e.id_articulo); if (!art) return;
        const cat = getCatNom(art);
        if (!cats[cat]) cats[cat] = { entradas:0, salidas:0, costo:0 };
        cats[cat].entradas += parseFloat(e.cantidad||0);
        cats[cat].costo    += parseFloat(e.precio_costo_moneda||0) * parseFloat(e.cantidad||0);
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
      const areas = {}; // key: areaNom||artNom
      // ENTRADAS directas (compras, ajustes) - excluir transferencias para no contar doble
      entradas.forEach(function(e) {
        if (e.motivo === 'transferencia') return; // Las transferencias se manejan desde salidas
        const art = getArt(e.id_articulo);
        const areaNom = e.area_receptora ? e.area_receptora.nombre+(e.area_receptora.codigo?' ('+e.area_receptora.codigo+')':'') : 'Sin área';
        const artNom  = art ? art.nombre_articulo : ('Art #'+e.id_articulo);
        const key = areaNom+'||'+artNom;
        if (!areas[key]) areas[key] = { area:areaNom, art:artNom, entradas:0, salidas:0 };
        areas[key].entradas += parseFloat(e.cantidad||0);
      });
      // SALIDAS = SALIDA del area origen + ENTRADA del area receptora
      salidas.forEach(function(s) {
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
      entradas.forEach(function(e) {
        const art=getArt(e.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_moneda||0, stock:art.stock_actual_articulo||0, hist:[] };
        arts[nom].entradas += parseFloat(e.cantidad||0);
        arts[nom].hist.push({ fecha:e.fecha_entrada, tipo:'E', cant:e.cantidad, cpp:e.precio_costo_moneda||0 });
      });
      salidas.forEach(function(s) {
        const art=getArt(s.id_articulo); if(!art) return;
        const nom=artNom(art);
        if (!arts[nom]) arts[nom] = { entradas:0, salidas:0, cpp:art.precio_costo_moneda||0, stock:art.stock_actual_articulo||0, hist:[] };
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
        const nom = e.area_receptora ? e.area_receptora.nombre+(e.area_receptora.codigo?' ('+e.area_receptora.codigo+')':'') : 'Sin área';
        const art = getArt(e.id_articulo); if(!art) return;
        if (!saldos[nom]) saldos[nom] = {};
        if (!saldos[nom][artNom(art)]) saldos[nom][artNom(art)] = 0;
        saldos[nom][artNom(art)] += parseFloat(e.cantidad||0);
      });
      salidas.forEach(function(s) {
        const art = getArt(s.id_articulo); if(!art) return;
        const cant = parseFloat(s.cantidad||0);
        // Descuenta del área que entrega
        const nomOrigen = s.area_entrega ? s.area_entrega.nombre+(s.area_entrega.codigo?' ('+s.area_entrega.codigo+')':'') : 'Sin área';
        if (!saldos[nomOrigen]) saldos[nomOrigen] = {};
        if (!saldos[nomOrigen][artNom(art)]) saldos[nomOrigen][artNom(art)] = 0;
        saldos[nomOrigen][artNom(art)] -= cant;
        // Suma al área que recibe
        if (s.area_receptora) {
          const nomDestino = s.area_receptora.nombre+(s.area_receptora.codigo?' ('+s.area_receptora.codigo+')':'');
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


