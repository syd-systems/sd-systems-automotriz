// ─── S&D Systems — Módulo: PAGOS ───
// ══════════════════════════════════════════════════════════════
//  MÓDULO DE PAGOS
// ══════════════════════════════════════════════════════════════

var pagosCache = [];
var _pagoEditando = null;

const TIPOS_PAGO = [
  { value: 'NOMINA',          label: '👷 Nómina',          cuentaGasto: '6.1.01.001' },
  { value: 'PROVEEDOR',       label: '🏭 Proveedor',        cuentaGasto: '2.1.01.001' },
  { value: 'SERVICIO_BASICO', label: '💡 Servicio Básico',  cuentaGasto: '6.1.02.002' },
  { value: 'ALQUILER',        label: '🏠 Alquiler',         cuentaGasto: '6.1.02.001' },
  { value: 'SUSCRIPCION',     label: '📱 Suscripción',      cuentaGasto: '6.1.02.003' },
  { value: 'IMPUESTO',        label: '📋 Impuesto/Tributo', cuentaGasto: '6.1.04.001' },
  { value: 'OTRO',            label: '💰 Otro',             cuentaGasto: null },
];

const METODOS_PAGO_PAGOS = [
  { value: 'EFECTIVO_VES',      label: 'Efectivo Bs',        cuenta: '1.1.01.001' },
  { value: 'EFECTIVO_USD',      label: 'Efectivo USD',       cuenta: '1.1.01.002' },
  { value: 'TRANSFERENCIA_VES', label: 'Transferencia Bs',   cuenta: '1.1.01.003' },
  { value: 'TRANSFERENCIA_USD', label: 'Transferencia USD',  cuenta: '1.1.01.004' },
  { value: 'PAGO_MOVIL',        label: 'Pago Móvil',         cuenta: '1.1.01.003' },
  { value: 'ZELLE',             label: 'Zelle',              cuenta: '1.1.01.004' },
  { value: 'DIVISAS',           label: 'Divisas',            cuenta: '1.1.01.005' },
];

async function renderPagos() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('PAGOS')) {
    document.getElementById('contenido-principal').innerHTML =
      '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando pagos...</div>';
  try {
    await cargarPagos();
  } catch(e) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

async function cargarPagos(filtroEstado, filtroTipo, busqueda, filtroRef, filtroDesde, filtroHasta) {
  const c = document.getElementById('contenido-principal');
  const panelExiste = !!document.getElementById('panel-pagos');

  if (!panelExiste) {
    c.innerHTML =
      '<div class="panel" id="panel-pagos">' +
      '<div class="panel-header">' +
      '<h3 id="pagos-contador">Obligaciones de Pago (0)</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (puedo('PAGOS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoPago()">+ Nuevo Pago</button>' : '') +
      '</div></div>' +
      '<div style="padding:12px 24px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--borde)">' +
      '<input id="pagos-buscar" placeholder="🔍 Buscar beneficiario o N° doc..." style="' + inputStyle() + ';flex:1;min-width:160px" oninput="cargarPagosDesdeUI()">' +
      '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Desde</span>' +
      '<input type="date" id="pagos-fecha-desde" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()"></div>' +
      '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Hasta</span>' +
      '<input type="date" id="pagos-fecha-hasta" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()"></div>' +
      '<select id="pagos-estado" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()">' +
      '<option value="">Todos los estados</option>' +
      '<option value="PENDIENTE">Pendiente</option>' +
      '<option value="PARCIAL">Parcial</option>' +
      '<option value="PAGADA">Pagado</option>' +
      '<option value="ANULADA">Anulado</option>' +
      '</select>' +
      '<select id="pagos-categoria" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()">' +
      '<option value="">Todas las categorías</option>' +
      '</select>' +
      '</div>' +
      '<div id="pagos-tabla-cont" style="padding:0"></div>' +
      '</div>';
  }

  // Restaurar filtros
  const elEstado = document.getElementById('pagos-estado');
  if (filtroEstado !== undefined && elEstado) elEstado.value = filtroEstado || '';

  const fEstado = document.getElementById('pagos-estado')?.value || '';
  const fBuscar = (busqueda || document.getElementById('pagos-buscar')?.value || '').toLowerCase();
  const fDesde  = filtroDesde || document.getElementById('pagos-fecha-desde')?.value || '';
  const fHasta  = filtroHasta || document.getElementById('pagos-fecha-hasta')?.value || '';

  const idEmisor = _empresaActiva?.id_emisor || 0;

  // ── Cargar todas las fuentes de obligaciones ──
  // Cargar categorías para el filtro
  try {
    const cats = await api('param_categorias_proveedor','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre') || [];
    const selCat = document.getElementById('pagos-categoria');
    if (selCat && selCat.options.length <= 1) {
      cats.forEach(function(c){
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.nombre;
        selCat.appendChild(opt);
      });
    }
  } catch(e) {}
  const fCategoria = document.getElementById('pagos-categoria')?.value || '';

  const [pagos, cxps] = await Promise.all([
    api('pagos','GET',null,'?order=fecha_registro.desc&select=*' + emisorQ()),
    api('cont_cxp','GET',null,'?id_emisor=eq.'+idEmisor+'&order=numero_doc.asc&select=*,proveedores:id_proveedor(nombre,id_categoria)')
  ]);
  pagosCache = pagos || [];

  // ── Normalizar en un solo formato unificado ──
  const estadoMapPagos = { BORRADOR:'PENDIENTE', APROBADO:'PENDIENTE', PAGADO:'PAGADA', ANULADO:'ANULADA', EJECUTADO:'PAGADA' };

  const itemsPagos = (pagos||[]).map(function(p) {
    return {
      _src:        'pago',
      _id:         p.id_pago,
      numero:      p.numero_pago || '—',
      beneficiario: p.nombre_beneficiario || '—',
      fecha:       p.fecha_pago || p.fecha_registro || '',
      tipo:        (p.tipo_pago || '').replace(/_/g,' '),
      origen:      'Manual',
      monto_usd:   parseFloat(p.monto_usd || 0),
      pagado_usd:  parseFloat(p.monto_pagado_usd || 0),
      saldo_usd:   parseFloat(p.saldo_usd || p.monto_usd || 0),
      estado:      estadoMapPagos[p.estado] || p.estado || 'PENDIENTE',
      _raw:        p
    };
  });

  // Calcular total cuotas por prefijo para display
  const cxpMap = {};
  (cxps||[]).forEach(function(c) {
    const m = (c.numero_doc||'').match(/^(.*)-C(\d+)$/);
    if (m) {
      const prefix = m[1];
      if (!cxpMap[prefix]) cxpMap[prefix] = 0;
      cxpMap[prefix]++;
    }
  });

  const itemsCxP = (cxps||[]).map(function(c) {
    const m = (c.numero_doc||'').match(/^(.*)-C(\d+)$/);
    let tipoDisplay = 'CONTADO';
    if (m) {
      const prefix = m[1];
      const num    = parseInt(m[2]);
      const total  = cxpMap[prefix] || 1;
      tipoDisplay  = 'Crédito ' + num + '/' + total;
    }
    const montoVES = parseFloat(c.monto_usd || 0) * parseFloat(c.tasa_bcv || 1);
    return {
      _src:        'cxp',
      _id:         c.id_cxp,
      numero:      c.numero_doc || '—',
      beneficiario: c.proveedores?.nombre || '—',
      fecha:       c.fecha_emision || '',
      tipo:        tipoDisplay,
      origen:      'Automático',
      monto_usd:   parseFloat(c.monto_usd || 0),
      monto_ves:   montoVES,
      estado:      c.estado || 'PENDIENTE',
      _raw:        c
    };
  });

  // ── Unificar y ordenar por fecha desc ──
  let todos = itemsPagos.concat(
    fCategoria
      ? itemsCxP.filter(function(item){
          return String(item._raw?.proveedores?.id_categoria||'') === String(fCategoria);
        })
      : itemsCxP
  );
  todos.sort(function(a,b){ return (b.fecha||'').localeCompare(a.fecha||''); });

  // ── Filtrar ──
  todos = todos.filter(function(item) {
    if (fEstado && item.estado !== fEstado) return false;
    if (fBuscar) {
      if (!item.beneficiario.toLowerCase().includes(fBuscar)
        && !item.numero.toLowerCase().includes(fBuscar)
        && !item.tipo.toLowerCase().includes(fBuscar)) return false;
    }
    if (fDesde && item.fecha.substring(0,10) < fDesde) return false;
    if (fHasta && item.fecha.substring(0,10) > fHasta) return false;
    return true;
  });

  document.getElementById('pagos-contador').textContent = 'Obligaciones de Pago (' + todos.length + ')';

  const cont = document.getElementById('pagos-tabla-cont');
  if (!cont) return;

  const estCol = { PENDIENTE:'#f59e0b', PARCIAL:'#60a5fa', PAGADA:'#22c55e', ANULADA:'#6b7280' };

  if (!todos.length) {
    cont.innerHTML = '<div style="text-align:center;padding:40px;color:var(--suave)">Sin obligaciones de pago registradas.</div>';
    return;
  }

  const estCol2 = { PENDIENTE:'#f59e0b', PAGADA:'#22c55e', ANULADA:'#6b7280' };
  const filas = todos.map(function(item) {
    // Normalizar estado — eliminar PARCIAL
    const est = item.estado === 'PARCIAL' ? 'PAGADA' : (item.estado || 'PENDIENTE');
    const col = estCol2[est] || '#888';
    const badge = '<span style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600">'+est+'</span>';

    let acciones = '';
    if (est === 'PENDIENTE' && item._src === 'cxp') {
      const esManual = !item.tipo.toUpperCase().includes('CREDITO') && !item.tipo.toUpperCase().includes('CONTADO') && item.origen !== 'Automático';
      acciones = '<button onclick="pagarCxP('+item._id+')" style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#22c55e;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">💳 Pagar</button>';
      if (esManual) acciones += ' <button onclick="anularPagoCxP('+item._id+')" style="background:rgba(252,129,129,0.1);border:1px solid rgba(252,129,129,0.3);color:#fc8181;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">🗑 Anular</button>';
    } else if (est === 'PAGADA' && item._src === 'cxp') {
      acciones = '<button onclick="verPagoCxP('+item._id+')" style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">👁 Ver</button>';
    }

    const origenBadge = item.origen === 'Automático'
      ? '<span style="background:rgba(96,165,250,0.15);color:#60a5fa;border-radius:4px;padding:1px 6px;font-size:10px">Auto</span>'
      : '<span style="background:rgba(255,255,255,0.06);color:var(--suave);border-radius:4px;padding:1px 6px;font-size:10px">Manual</span>';

    const montoVES = item.monto_ves ? fmtBs(item.monto_ves) : (item.monto_usd ? fmtBs(item.monto_usd) : '—');

    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
      +'<td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--naranja)">'+item.numero+'</td>'
      +'<td style="padding:8px;font-size:12px">'+item.beneficiario+'</td>'
      +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+fmtFecha(item.fecha)+'</td>'
      +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+item.tipo+'</td>'
      +'<td style="padding:8px;text-align:center">'+origenBadge+'</td>'
      +'<td style="text-align:right;padding:8px;font-family:var(--font-mono)">$ '+fmtUSD(item.monto_usd)+'</td>'
      +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:var(--suave)">'+montoVES+'</td>'
      +'<td style="padding:8px;text-align:center">'+badge+'</td>'
      +'<td style="padding:8px;text-align:center">'+acciones+'</td>'
      +'</tr>';
  }).join('');

  cont.innerHTML =
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">N° Doc</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Beneficiario</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Fecha</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Tipo</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:center">Origen</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:right">Monto USD</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:right">Monto Bs</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:center">Estado</th>'
    +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:center">Acción</th>'
    +'</tr></thead><tbody>'+filas+'</tbody></table></div>';
}


async function abrirNuevoPago() {
  _pagoEditando = null;
  const errEl = document.getElementById('alerta-pago-err');
  const okEl  = document.getElementById('alerta-pago-ok');
  if (errEl) errEl.style.display = 'none';
  if (okEl)  okEl.style.display  = 'none';
  document.getElementById('pago-modal-titulo').textContent = 'NUEVA CUENTA POR PAGAR';

  // Reset campos
  ['pago-descripcion','pago-monto','pago-vencimiento','pago-rif','pago-observaciones','pago-manual-cuenta'].forEach(function(id){
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('pago-moneda').value = 'VES';
  document.getElementById('pago-id').value = '';
  document.getElementById('pago-monto-equiv').textContent = '';
  document.getElementById('pago-tasa-cont').style.display = 'none';
  ['pago-banco-info','pago-pm-info','pago-manual-info'].forEach(function(id){
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  document.getElementById('pago-metodo-display').textContent = '—';

  // Cargar tasas
  try {
    const hoy = new Date(new Date().getTime()-4*60*60*1000).toISOString().split('T')[0];
    const tasas = await api('tasas','GET',null,'?order=fecha_valor.desc&limit=20&select=*') || [];
    const getTasa = function(mon) {
      const reg = tasas.filter(function(t){ return t.moneda_origen===mon && String(t.fecha_valor||'').substring(0,10)<=hoy; })
        .sort(function(a,b){ return String(b.fecha_valor||'').localeCompare(String(a.fecha_valor||'')); });
      return reg.length ? parseFloat(reg[0].tipo_cambio) : 1;
    };
    window._pagoTasaUSD = getTasa('USD');
    window._pagoTasaEUR = getTasa('EUR');
  } catch(e) { window._pagoTasaUSD = _tasaVigente||1; window._pagoTasaEUR = 1; }

  // Cargar categorías de proveedor
  try {
    const cats = await api('param_categorias_proveedor','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre') || [];
    const sel = document.getElementById('pago-categoria-prov');
    if (sel) {
      sel.innerHTML = '<option value="">— Seleccionar —</option>'
        + cats.map(function(c){ return '<option value="'+c.id+'">'+c.nombre+'</option>'; }).join('');
    }
  } catch(e) {}

  // Cargar cuentas de gasto
  try {
    const cuentas = await api('cont_cuentas','GET',null,'?tipo=eq.GASTO&order=codigo.asc&select=id_cuenta,codigo,nombre') || [];
    const selC = document.getElementById('pago-cuenta-gasto');
    if (selC) {
      selC.innerHTML = '<option value="">— Seleccionar cuenta —</option>'
        + cuentas.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
    }
  } catch(e) {}

  // Reset proveedor
  const selProv = document.getElementById('pago-proveedor');
  if (selProv) selProv.innerHTML = '<option value="">— Seleccionar categoría primero —</option>';

  abrirModal('modal-pago');
}

async function onCambioCategoriaPago() {
  const idCat  = document.getElementById('pago-categoria-prov')?.value || '';
  const selProv = document.getElementById('pago-proveedor');
  if (!selProv) return;

  if (!idCat) {
    selProv.innerHTML = '<option value="">— Seleccionar categoría primero —</option>';
    return;
  }

  try {
    const provs = await api('proveedores','GET',null,
      '?estado=eq.ACTIVO&id_categoria=eq.'+idCat+'&order=nombre.asc&select=id_proveedor,nombre,rif,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)') || [];
    selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
      + provs.map(function(p){ return '<option value="'+p.id_proveedor+'">'+p.nombre+'</option>'; }).join('');
    // Store proveedor data for quick access
    window._pagoProveedores = provs;
  } catch(e) { console.warn('onCambioCategoriaPago:', e); }
}

function onCambioMonedaPago() {
  const moneda   = document.getElementById('pago-moneda')?.value || 'VES';
  const tasaCont = document.getElementById('pago-tasa-cont');
  const tasaPar  = document.getElementById('pago-tasa-par');
  const tasaVal  = document.getElementById('pago-tasa-val');
  const montoLabel = document.getElementById('pago-monto-label');

  if (moneda === 'VES') {
    if (tasaCont) tasaCont.style.display = 'none';
    if (montoLabel) montoLabel.textContent = 'Monto Bs *';
  } else if (moneda === 'USD') {
    if (tasaCont) tasaCont.style.display = '';
    if (tasaPar)  tasaPar.textContent = 'USD/VES';
    if (tasaVal)  tasaVal.textContent = fmtUSD(window._pagoTasaUSD||1);
    if (montoLabel) montoLabel.textContent = 'Monto USD *';
  } else if (moneda === 'EUR') {
    if (tasaCont) tasaCont.style.display = '';
    if (tasaPar)  tasaPar.textContent = 'EUR/VES';
    if (tasaVal)  tasaVal.textContent = fmtUSD(window._pagoTasaEUR||1);
    if (montoLabel) montoLabel.textContent = 'Monto EUR *';
  }
  onCambioMontoPago();
}

function onCambioMontoPago() {
  const moneda = document.getElementById('pago-moneda')?.value || 'VES';
  const monto  = parseFloat(document.getElementById('pago-monto')?.value) || 0;
  const equiv  = document.getElementById('pago-monto-equiv');
  if (!equiv) return;
  if (moneda === 'VES' || !monto) { equiv.textContent = ''; return; }
  const tasa = moneda === 'USD' ? (window._pagoTasaUSD||1) : (window._pagoTasaEUR||1);
  equiv.textContent = '≡ ' + fmtBs(monto * tasa) + ' Bs';
}


async function abrirFichaPago(id) {
  const p = pagosCache.find(function(x){ return x.id_pago === id; });
  if (!p) return;
  if (!window._nombresUsuarios) {
    window._nombresUsuarios = {};
    try {
      const users = await api('usuarios','GET',null,'?select=correo_usuario,nombre');
      users.forEach(function(u){ _nombresUsuarios[u.correo_usuario] = u.nombre; });
    } catch(e) {}
  }
  const tipo = TIPOS_PAGO.find(function(t){ return t.value === p.tipo_pago; });
  const metodo = METODOS_PAGO_PAGOS.find(function(m){ return m.value === p.metodo_pago; });
  const estadoColor = { BORRADOR:'var(--suave)', APROBADO:'var(--naranja)', PAGADO:'#22c55e', ANULADO:'#fc8181' };

  // Botones de acción según estado
  const idp = p.id_pago;
  const btnEditar  = (p.estado==='BORRADOR' && puedo('PAGOS','EDITAR'))
    ? '<button class="btn-secundario" onclick="cerrarModal(&#39;modal-ficha-pago&#39;);abrirEditarPago('+idp+')">✏ Editar</button>' : '';
  const btnAprobar = (p.estado==='BORRADOR' && puedo('PAGOS','APROBAR'))
    ? '<button class="btn-primario" onclick="aprobarPagoFicha('+idp+')">✓ Aprobar</button>' : '';
  const btnPagar   = (p.estado==='APROBADO' && puedo('PAGOS','PAGAR'))
    ? '<button class="btn-primario" style="background:#22c55e;border-color:#22c55e" onclick="cerrarModal(&#39;modal-ficha-pago&#39;);ejecutarPago('+idp+')">💳 Pagar</button>' : '';
  const btnAnular  = (p.estado!=='ANULADO' && p.estado!=='PAGADO' && puedo('PAGOS','ANULAR'))
    ? '<button class="btn-secundario" style="color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="anularPagoFicha('+idp+')">Anular</button>' : '';
  const botonesAccion = btnEditar + btnAprobar + btnPagar + btnAnular;

  document.getElementById('ficha-pago-cont').innerHTML =
    '<div style="padding:24px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">' +
    '<div>' +
    '<div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + (p.numero_pago||'—') + '</div>' +
    '<div style="font-size:13px;color:var(--suave);margin-top:4px">' + (tipo ? tipo.label : p.tipo_pago) + '</div>' +
    '</div>' +
    '<span style="font-size:14px;font-weight:700;color:'+estadoColor[p.estado]+'">● '+p.estado+'</span>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
    '<div><div style="font-size:10px;color:var(--suave)">DESCRIPCIÓN</div><div>'+p.descripcion+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">BENEFICIARIO</div><div>'+(p.nombre_beneficiario||'—')+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">MONTO BS</div><div style="font-family:var(--font-mono);color:var(--naranja)">'+(p.monto_ves?'Bs '+fmtVES(p.monto_ves):'—')+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">MONTO USD</div><div style="font-family:var(--font-mono)">'+(p.monto_usd?'$ '+fmtUSD(p.monto_usd):'—')+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">MÉTODO</div><div>'+(metodo?metodo.label:(p.metodo_pago||'—'))+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">CANCELADO</div><div>'+(p.fecha_pago?fmtFecha(p.fecha_pago):'—')+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">VENCIMIENTO</div><div>'+(p.fecha_vencimiento?fmtFecha(p.fecha_vencimiento):'—')+'</div></div>' +
    '<div><div style="font-size:10px;color:var(--suave)">RECURRENTE</div><div>'+(p.es_recurrente?'Sí — '+p.frecuencia+(p.fecha_proxima?' (próximo: '+fmtFecha(p.fecha_proxima)+')':''):'No')+'</div></div>' +
    (p.referencia ? '<div><div style="font-size:10px;color:var(--suave)">REFERENCIA</div><div>'+p.referencia+'</div></div>' : '') +
    (p.observaciones ? '<div style="grid-column:1/-1"><div style="font-size:10px;color:var(--suave)">OBSERVACIONES</div><div>'+p.observaciones+'</div></div>' : '') +
    (p.aprobado_por ? '<div><div style="font-size:10px;color:var(--suave)">APROBADO POR</div><div>'+(_nombresUsuarios[p.aprobado_por]||p.aprobado_por)+'</div></div>' : '') +
    '</div></div>';

  // Actualizar footer con botones de acción
  const footer = document.querySelector('#modal-ficha-pago .modal-footer');
  if (footer) footer.innerHTML = botonesAccion + '<button class="btn-secundario" onclick="cerrarModal(&#39;modal-ficha-pago&#39;)">Retornar</button>';

  abrirModal('modal-ficha-pago');
}

function inputStyle() {
  return 'background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 12px;border-radius:5px;outline:none';
}
// ─── PRÓXIMO MÓDULO ───
function renderProximo(icono, nombre) {
  document.getElementById('contenido-principal').innerHTML = `
    <div class="prox-modulo">
      <div class="icono">${icono}</div>
      <h3>${nombre.toUpperCase()}</h3>
      <p>Este módulo estará disponible en la próxima fase de desarrollo.</p>
    </div>
  `;
}

// ─── MODALES ───
function abrirModal(id) {
  const el = document.getElementById(id);
  el.style.display = ''; // quitar display:none inline si lo puso cerrarTodosLosModales
  el.classList.add('abierto');
  setTimeout(function() {
    const body = el.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
  }, 30);
}

function cerrarModal(id) {
  document.getElementById(id).classList.remove('abierto');
}

// Cerrar modal al hacer clic fuera
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('abierto');
  });
});




// ─── POLÍTICA DE CONTRASEÑAS ───

// Valida que la clave cumpla la política de seguridad
function validarPoliticaClave(clave) {
  const errores = [];
  if (clave.length < 8)                    errores.push('Mínimo 8 caracteres');
  if (!/[A-Za-z]/.test(clave))             errores.push('Debe contener al menos una letra');
  if (!/[0-9]/.test(clave))               errores.push('Debe contener al menos un número');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(clave))
                                            errores.push('Debe contener al menos un carácter especial (!@#$%...)');
  return errores;
}


// Indicador de fortaleza para modal de usuario

function validarFortalezaRec(clave) {
  const fill = document.getElementById('fortaleza-fill-rec');
  if (!fill) return;
  const largo    = clave.length >= 8;
  const numero   = /[0-9]/.test(clave);
  const letra    = /[A-Za-z]/.test(clave);
  const especial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(clave);
  const cumple   = [largo, numero, letra, especial].filter(Boolean).length;
  const colores  = ['#e53e3e','#e53e3e','#FF6B00','#38a169'];
  fill.style.width      = `${cumple * 25}%`;
  fill.style.background = colores[cumple - 1] || '#e53e3e';
  const reqs = [
    { key: 'largo',    ok: largo },
    { key: 'letra',    ok: letra },
    { key: 'numero',   ok: numero },
    { key: 'especial', ok: especial }
  ];
  reqs.forEach(r => {
    const icon = document.getElementById(`r-req-${r.key}-icon`);
    const text = document.getElementById(`r-req-${r.key}`);
    if (icon) { icon.textContent = r.ok ? '✓' : '✗'; icon.style.color = r.ok ? '#68d391' : '#444'; }
    if (text) { text.style.color = r.ok ? '#68d391' : '#888'; }
  });
}

function validarFortalezaUsuario(clave) {
  const fill = document.getElementById('fortaleza-fill-u');
  if (!fill) return;
  const largo    = clave.length >= 8;
  const numero   = /[0-9]/.test(clave);
  const letra    = /[A-Za-z]/.test(clave);
  const especial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(clave);
  const cumple   = [largo, numero, letra, especial].filter(Boolean).length;
  const colores  = ['#e53e3e','#e53e3e','#FF6B00','#38a169'];
  fill.style.width      = `${cumple * 25}%`;
  fill.style.background = colores[cumple - 1] || '#e53e3e';
  const reqs = [
    { key: 'largo',    ok: largo,    texto: 'Mínimo 8 caracteres' },
    { key: 'letra',    ok: letra,    texto: 'Al menos una letra' },
    { key: 'numero',   ok: numero,   texto: 'Al menos un número' },
    { key: 'especial', ok: especial, texto: 'Al menos un carácter especial (!@#$%...)' }
  ];
  reqs.forEach(r => {
    const icon = document.getElementById(`u-req-${r.key}-icon`);
    const text = document.getElementById(`u-req-${r.key}`);
    if (icon) { icon.textContent = r.ok ? '✓' : '✗'; icon.style.color = r.ok ? '#68d391' : '#444'; }
    if (text) { text.style.color = r.ok ? '#68d391' : '#888'; }
  });
}

// Mostrar requisitos al enfocar el campo
function mostrarRequisitos() {
  const bar = document.getElementById('fortaleza-bar');
  if (bar) bar.style.display = 'block';
}

// Indicador visual de fortaleza
function validarFortaleza(clave) {
  const fill = document.getElementById('fortaleza-fill');
  if (!fill) return;

  const largo    = clave.length >= 8;
  const numero   = /[0-9]/.test(clave);
  const letra    = /[A-Za-z]/.test(clave);
  const especial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(clave);

  const cumple = [largo, numero, letra, especial].filter(Boolean).length;

  const colores = ['#e53e3e','#e53e3e','#FF6B00','#38a169'];
  fill.style.width   = `${cumple * 25}%`;
  fill.style.background = colores[cumple - 1] || '#e53e3e';

  const reqs = [
    { key: 'largo',    ok: largo,    texto: 'Mínimo 8 caracteres' },
    { key: 'letra',    ok: letra,    texto: 'Al menos una letra' },
    { key: 'numero',   ok: numero,   texto: 'Al menos un número' },
    { key: 'especial', ok: especial, texto: 'Al menos un carácter especial (!@#$%...)' }
  ];
  reqs.forEach(r => {
    const icon = document.getElementById(`req-${r.key}-icon`);
    const text = document.getElementById(`req-${r.key}`);
    if (icon) { icon.textContent = r.ok ? '✓' : '✗'; icon.style.color = r.ok ? '#68d391' : '#444'; }
    if (text) { text.style.color = r.ok ? '#68d391' : '#888'; }
  });
}

// Verificar si la clave ya fue usada antes (historial completo, nunca se puede repetir)
async function claveYaUsada(correo, nuevaClave) {
  try {
    const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY) };
    const res = await fetch(SUPABASE_URL + '/rest/v1/historial_claves?correo_usuario=eq.' + encodeURIComponent(correo) + '&select=contrasena', { headers: hdrs });
    const historial = await res.json();
    // Con bcrypt no se puede comparar directamente — verificar cada hash
    for (const h of historial) {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/verificar_clave', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_clave: nuevaClave, p_hash: h.contrasena })
      });
      if (await r.json()) return true;
    }
    return false;
  } catch(e) { return false; }
}

// Guardar nueva clave en historial
async function guardarEnHistorial(correo, clave) {
  try {
    const claveHash = await hashearClave(clave);
    await api('historial_claves', 'POST', { correo_usuario: correo, contrasena: claveHash });
  } catch(e) { console.error('Error guardando historial:', e); }
}

// Verificar vencimiento de clave al hacer login
function verificarVencimientoClave(usuario) {
  if (!usuario.fecha_clave) return false;
  const fechaClave = new Date(usuario.fecha_clave);
  const hoy = new Date();
  const diasTranscurridos = Math.floor((hoy - fechaClave) / (1000 * 60 * 60 * 24));
  return diasTranscurridos >= 180;
}

function diasRestantesClave(usuario) {
  if (!usuario.fecha_clave) return 180;
  const fechaClave = new Date(usuario.fecha_clave);
  const hoy = new Date();
  const diasTranscurridos = Math.floor((hoy - fechaClave) / (1000 * 60 * 60 * 24));
  return Math.max(0, 180 - diasTranscurridos);
}

// Mostrar modal de cambio obligatorio
function mostrarCambioObligatorio(vencida = false) {
  const modal = document.getElementById('modal-cambio-clave');
  const aviso = document.getElementById('cambio-aviso');
  const titulo = document.getElementById('cambio-titulo');
  modal.style.display = 'flex';
  if (vencida) {
    aviso.style.display = 'block';
    titulo.textContent = 'CONTRASEÑA VENCIDA';
  } else {
    aviso.style.display = 'none';
    titulo.textContent = 'CAMBIAR CONTRASEÑA';
  }
  document.getElementById('cambio-nueva').value = '';
  document.getElementById('cambio-confirmar').value = '';
  document.getElementById('cambio-error').style.display = 'none';
  document.getElementById('cambio-exito').style.display = 'none';
}

// Procesar el cambio de clave
async function procesarCambioClave() {
  const nueva     = document.getElementById('cambio-nueva').value;
  const confirmar = document.getElementById('cambio-confirmar').value;
  const errEl     = document.getElementById('cambio-error');
  const okEl      = document.getElementById('cambio-exito');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!nueva) { errEl.textContent = 'Ingresa la nueva contraseña.'; errEl.style.display = 'block'; return; }
  if (!confirmar) { errEl.textContent = 'Confirma la nueva contraseña.'; errEl.style.display = 'block'; return; }

  // Validar política
  const errores = validarPoliticaClave(nueva);
  if (errores.length > 0) {
    errEl.textContent = errores[0];
    errEl.style.display = 'block';
    return;
  }

  if (nueva !== confirmar) {
    errEl.textContent = 'Las contraseñas no coinciden.';
    errEl.style.display = 'block';
    return;
  }

  // Usar correo de sesión activa o del login temporal
  const correoActivo = (sesionActual && sesionActual.correo_usuario)
    ? sesionActual.correo_usuario
    : (window._cambioClaveCorreo || '');
  if (!correoActivo) { errEl.textContent = 'Error: no se pudo identificar el usuario.'; errEl.style.display = 'block'; return; }

  // Verificar que no sea igual a la anterior
  const yaUsada = await claveYaUsada(correoActivo, nueva);
  if (yaUsada) {
    errEl.textContent = 'La nueva contraseña no puede ser igual a una contraseña anterior.';
    errEl.style.display = 'block';
    return;
  }

  try {
    // Actualizar contraseña, fecha y limpiar flag cambio obligatorio
    const nuevaHash = await hashearClave(nueva);

    // Usar fetch directo para no depender de JWT (aún no hay sesión)
    const hdrs = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    const patchRes = await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' + encodeURIComponent(correoActivo), {
      method: 'PATCH',
      headers: hdrs,
      body: JSON.stringify({
        contrasena:    nuevaHash,
        fecha_clave:   new Date().toISOString().split('T')[0],
        cambiar_clave: false
      })
    });
    if (!patchRes.ok) throw new Error('Error al actualizar la contraseña.');

    // Guardar en historial (solo si hay sesión activa)
    if (sesionActual) await guardarEnHistorial(correoActivo, nueva);

    // Si viene del login, completar el acceso al sistema
    if (!sesionActual && window._cambioClaveCorreo) {
      okEl.textContent = '✓ Contraseña actualizada. Ingresando al sistema...';
      okEl.style.display = 'block';
      setTimeout(async function() {
        document.getElementById('modal-cambio-clave').style.display = 'none';
        // Continuar con el login normal
        document.getElementById('login-clave').value = nueva;
        await iniciarSesion();
      }, 1200);
      return;
    }

    // Actualizar sesión local
    if (sesionActual) sesionActual.contrasena = nueva;
    if (sesionActual) sesionActual.fecha_clave = new Date().toISOString().split('T')[0];
    if (sesionActual) sessionStorage.setItem('sd_sesion', JSON.stringify({ usuario: sesionActual, accesos: modulosAcceso }));

    okEl.textContent = '✓ Contraseña actualizada correctamente.';
    okEl.style.display = 'block';

    setTimeout(() => {
      document.getElementById('modal-cambio-clave').style.display = 'none';
    }, 1500);

  } catch(e) {
    errEl.textContent = 'Error al actualizar. Intente nuevamente.';
    errEl.style.display = 'block';
  }
}

// ─── SINCRONIZAR TASAS BCV MANUAL ───
// ─── GUARDAR TASA BCV MANUAL ───
async function guardarTasaBCVManual() {
  if (!puedo('TASAS','CREAR')) { alert('No tiene permiso para registrar tasas.'); return; }
  const fecha = document.getElementById('bcv-fecha').value;
  const usd   = parseFloat(document.getElementById('bcv-usd').value);
  const eur   = parseFloat(document.getElementById('bcv-eur').value);
  const msg   = document.getElementById('bcv-manual-msg');

  msg.style.display = 'none';

  if (!fecha)           { msg.innerHTML = '<div class="alerta alerta-error" style="display:block">La fecha es obligatoria.</div>'; msg.style.display='block'; return; }
  if (!usd || usd <= 0) { msg.innerHTML = '<div class="alerta alerta-error" style="display:block">Ingresa un valor válido para USD.</div>'; msg.style.display='block'; return; }
  if (!eur || eur <= 0) { msg.innerHTML = '<div class="alerta alerta-error" style="display:block">Ingresa un valor válido para EUR.</div>'; msg.style.display='block'; return; }

  try {
    const hoyISO = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    const usuario = sesionActual?.correo_usuario || 'sistema@bcv.auto';
    await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/tasas', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ moneda_origen: 'USD', moneda_destino: 'VES', tipo_cambio: usd,
          fecha_valor: fecha, fecha_registro: hoyISO, id_usuario: usuario })
      }),
      fetch(SUPABASE_URL + '/rest/v1/tasas', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ moneda_origen: 'EUR', moneda_destino: 'VES', tipo_cambio: eur,
          fecha_valor: fecha, fecha_registro: hoyISO, id_usuario: usuario })
      })
    ]);

    const pFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-VE', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const pCap = pFmt.charAt(0).toUpperCase() + pFmt.slice(1);

    msg.innerHTML = '<div class="alerta alerta-exito" style="display:block">✓ Tasas BCV guardadas para <strong>' + pCap + '</strong> — USD: ' + usd.toFixed(8) + ' · EUR: ' + eur.toFixed(8) + '</div>';
    msg.style.display = 'block';

    // Actualizar sección FECHA VALOR visualmente
    const seccion = document.getElementById('seccion-proxima-tasa');
    if (seccion) {
      seccion.innerHTML =
        '<div style="margin-bottom:16px">'
        + '<div style="font-family:var(--font-display);font-size:13px;letter-spacing:3px;color:var(--naranja);text-transform:uppercase">FECHA VALOR : ' + pCap + '</div>'
        + '<div style="font-size:12px;color:var(--suave);margin-top:3px">Ingresado manualmente desde BCV oficial</div>'
        + '</div>'
        + '<div style="display:flex;gap:32px;flex-wrap:wrap">'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇺🇸 USD</div>'
        + '<div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#FF6B00">' + usd.toFixed(4) + ' <span style="font-size:11px;color:#555">Bs</span></div></div>'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇪🇺 EUR</div>'
        + '<div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#4299e1">' + eur.toFixed(4) + ' <span style="font-size:11px;color:#555">Bs</span></div></div>'
        + '</div>';
    }

    document.getElementById('bcv-usd').value = '';
    document.getElementById('bcv-eur').value = '';

  } catch(e) {
    msg.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
    msg.style.display = 'block';
  }
}

async function sincronizarTasasBCV(btn) {
  const texto = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;animation:spin 0.8s linear infinite">↻</span> Sincronizando...';

  try {
    // Llamar función RPC en Supabase
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/insertar_tasas_bcv', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!resp.ok) {
      const err = await resp.json().catch(function() { return {}; });
      throw new Error(err.message || 'Error ' + resp.status);
    }

    const data = await resp.json();
    if (!data || !data.ok) throw new Error(data.mensaje || 'La tasa del próximo día hábil aún no está publicada. Intente más tarde.');

    const tasaUsd  = parseFloat(data.usd);
    const tasaEur  = parseFloat(data.eur);
    const fechaVal = data.fecha; // YYYY-MM-DD

    // Formatear fecha
    const pFmt = new Date(fechaVal + 'T12:00:00').toLocaleDateString('es-VE', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const pCap = pFmt.charAt(0).toUpperCase() + pFmt.slice(1);

    // Actualizar sección FECHA VALOR visualmente
    const seccion = document.getElementById('seccion-proxima-tasa');
    if (seccion) {
      seccion.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
        + '<div>'
        + '<div style="font-family:var(--font-display);font-size:13px;letter-spacing:3px;color:var(--naranja);text-transform:uppercase">FECHA VALOR : ' + pCap + '</div>'
        + '<div style="font-size:12px;color:var(--suave);margin-top:3px">Sincronizado desde dolarapi.com / BCV</div>'
        + '</div></div>'
        + '<div style="display:flex;gap:32px;flex-wrap:wrap">'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇺🇸 USD</div>'
        + '<div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#FF6B00">' + tasaUsd.toFixed(4) + ' <span style="font-size:11px;color:#555;font-weight:400">Bs</span></div></div>'
        + '<div><div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">🇪🇺 EUR</div>'
        + '<div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#4299e1">' + tasaEur.toFixed(4) + ' <span style="font-size:11px;color:#555;font-weight:400">Bs</span></div></div>'
        + '</div>';
    }

    btn.innerHTML = '✓ USD ' + tasaUsd.toFixed(4) + ' · EUR ' + tasaEur.toFixed(4);
    btn.style.background = '#48bb78';
    setTimeout(function() {
      btn.innerHTML = texto;
      btn.style.background = '';
      btn.disabled = false;
    }, 2500);

  } catch(e) {
    btn.innerHTML = '✗ ' + e.message;
    btn.style.background = '#e53e3e';
    setTimeout(function() {
      btn.innerHTML = texto;
      btn.style.background = '';
      btn.disabled = false;
    }, 3500);
  }
}
const GMAIL_USER = 'syd.systems2001@gmail.com';
const GMAIL_PASS = 'xmuhiofyfvcxvskx';

function mostrarRecuperar() {
  document.querySelector('.login-form-box').style.display = 'none';
  document.getElementById('form-recuperar').style.display = 'block';
  document.getElementById('form-nueva-clave').style.display = 'none';
  document.getElementById('rec-correo').value = '';
  document.getElementById('rec-error').style.display = 'none';
  document.getElementById('rec-exito').style.display = 'none';
}

function mostrarLogin() {
  document.querySelector('.login-form-box').style.display = 'block';
  document.getElementById('form-recuperar').style.display = 'none';
  document.getElementById('form-nueva-clave').style.display = 'none';
}

function generarToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36) + Math.random().toString(36).substring(2);
}

async function enviarCorreoRecuperacion(destinatario, nombre, enlace, esAdmin = false) {
  const asunto = esAdmin
    ? 'Restablecimiento de contraseña — S&D Systems Automotriz'
    : 'Recuperación de contraseña — S&D Systems Automotriz';

  const intro = esAdmin
    ? 'El administrador del sistema ha solicitado restablecer tu contraseña de acceso.'
    : 'Recibimos una solicitud para restablecer la contraseña de tu cuenta.';

  const btnTexto = esAdmin ? 'CREAR NUEVA CONTRASEÑA' : 'RESTABLECER CONTRASEÑA';

  const htmlCorreo = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0a0a;color:#e8e8e8;padding:40px;border-radius:10px">
      <div style="text-align:center;margin-bottom:30px">
        <h1 style="color:#FF6B00;font-size:36px;letter-spacing:4px;margin:0">S&D</h1>
        <p style="color:#888;font-size:11px;letter-spacing:4px;margin:4px 0 0">SYSTEMS AUTOMOTRIZ</p>
      </div>
      <h2 style="color:#e8e8e8;font-size:18px">Hola, ${nombre}</h2>
      <p style="color:#888;font-size:14px;line-height:1.6">${intro}</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${enlace}" style="background:#FF6B00;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:2px">${btnTexto}</a>
      </div>
      <p style="color:#555;font-size:12px">Este enlace es válido por <strong style="color:#888">30 minutos</strong>.<br>Si no solicitaste este cambio, ignora este correo.</p>
      <hr style="border:none;border-top:1px solid #333;margin:24px 0">
      <p style="color:#444;font-size:11px;text-align:center">S&D Systems Automotriz · Sistema de Gestión</p>
    </div>`;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/resend-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to: destinatario, subject: asunto, html: htmlCorreo })
  });

  if (!resp.ok) throw new Error('No se pudo enviar el correo');
  return true;
}

async function enviarRecuperacion() {
  const correo = document.getElementById('rec-correo').value.trim();
  const errEl  = document.getElementById('rec-error');
  const okEl   = document.getElementById('rec-exito');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!correo) {
    errEl.textContent = 'Ingrese su correo electrónico.';
    errEl.style.display = 'block';
    return;
  }

  try {
    // Verificar que el correo existe
    const usuarios = await api('usuarios', 'GET', null,
      `?correo_usuario=eq.${encodeURIComponent(correo)}&select=correo_usuario,nombre,estado_usuario`);

    if (!usuarios || usuarios.length === 0) {
      errEl.textContent = 'No existe ningún usuario con ese correo.';
      errEl.style.display = 'block';
      return;
    }

    if (usuarios[0].estado_usuario !== 'ACTIVO') {
      errEl.textContent = 'Usuario inactivo. Contacte al administrador.';
      errEl.style.display = 'block';
      return;
    }

    const nombre = usuarios[0].nombre;

    // Invalidar tokens anteriores del mismo correo
    await api('tokens_recuperacion', 'PATCH', { usado: true },
      `?correo=eq.${encodeURIComponent(correo)}&usado=eq.false`);

    // Generar y guardar token en Supabase
    const token = generarToken();
    const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await api('tokens_recuperacion', 'POST', { token, correo, expira, usado: false });

    const enlace = `${window.location.origin}${window.location.pathname}?reset=${token}`;

    await enviarCorreoRecuperacion(correo, nombre, enlace, false);

    okEl.textContent = `✓ Enlace enviado a ${correo}. Revisa tu bandeja de entrada.`;
    okEl.style.display = 'block';

  } catch(e) {
    errEl.textContent = 'Error al enviar el correo. Intente nuevamente.';
    errEl.style.display = 'block';
    console.error(e);
  }
}

async function guardarNuevaClave() {
  const clave1 = document.getElementById('nueva-clave').value;
  const clave2 = document.getElementById('confirmar-clave').value;
  const errEl  = document.getElementById('nueva-error');
  const okEl   = document.getElementById('nueva-exito');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  // Validar política de contraseñas
  const erroresPol = validarPoliticaClave(clave1);
  if (erroresPol.length > 0) {
    errEl.textContent = erroresPol[0];
    errEl.style.display = 'block';
    return;
  }

  if (clave1 !== clave2) {
    errEl.textContent = 'Las contraseñas no coinciden.';
    errEl.style.display = 'block';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const token  = params.get('reset');

  if (!token) {
    errEl.textContent = 'Enlace inválido. Solicita uno nuevo.';
    errEl.style.display = 'block';
    return;
  }

  try {
    // Verificar token en Supabase
    const tokens = await api('tokens_recuperacion', 'GET', null,
      `?token=eq.${token}&usado=eq.false&select=*`);

    if (!tokens || tokens.length === 0) {
      errEl.textContent = 'Enlace inválido o ya fue usado. Solicita uno nuevo.';
      errEl.style.display = 'block';
      return;
    }

    const datos = tokens[0];

    if (new Date() > new Date(datos.expira)) {
      errEl.textContent = 'El enlace ha expirado. Solicita uno nuevo.';
      errEl.style.display = 'block';
      await api('tokens_recuperacion', 'PATCH', { usado: true }, `?token=eq.${token}`);
      return;
    }

    // Verificar que no sea igual a una anterior
    const yaUsada = await claveYaUsada(datos.correo, clave1);
    if (yaUsada) {
      errEl.textContent = 'La nueva contraseña no puede ser igual a una contraseña anterior.';
      errEl.style.display = 'block';
      return;
    }

    // Actualizar contraseña y fecha (hasheada)
    const clave1Hash = await hashearClave(clave1);
    await api('usuarios', 'PATCH', {
      contrasena: clave1Hash,
      fecha_clave: new Date().toISOString().split('T')[0]
    }, `?correo_usuario=eq.${encodeURIComponent(datos.correo)}`);

    // Guardar en historial
    await guardarEnHistorial(datos.correo, clave1);

    // Marcar token como usado
    await api('tokens_recuperacion', 'PATCH', { usado: true }, `?token=eq.${token}`);

    okEl.textContent = '✓ Contraseña actualizada. Puedes iniciar sesión.';
    okEl.style.display = 'block';

    setTimeout(() => {
      window.history.replaceState({}, '', window.location.pathname);
      mostrarLogin();
    }, 2500);

  } catch(e) {
    errEl.textContent = 'Error al actualizar la contraseña. Intente nuevamente.';
    errEl.style.display = 'block';
    console.error(e);
  }
}

// ─── RESET DESDE PANEL ADMIN ───
async function resetearClave(correo, nombre) {
  if (!confirm(`¿Enviar correo de recuperación a ${nombre} (${correo})?`)) return;

  try {
    // Invalidar tokens anteriores
    await api('tokens_recuperacion', 'PATCH', { usado: true },
      `?correo=eq.${encodeURIComponent(correo)}&usado=eq.false`);

    const token  = generarToken();
    const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await api('tokens_recuperacion', 'POST', { token, correo, expira, usado: false });

    const enlace = `${window.location.origin}${window.location.pathname}?reset=${token}`;

    await enviarCorreoRecuperacion(correo, nombre, enlace, true);

    alert(`✓ Correo de recuperación enviado a ${correo}`);
  } catch(e) {
    alert('Error al enviar el correo: ' + e.message);
    console.error(e);
  }
}

// ─── DETECTAR TOKEN EN URL ───
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('reset');
  if (token) {
    document.querySelector('.login-form-box').style.display = 'none';
    document.getElementById('form-recuperar').style.display = 'none';
    document.getElementById('form-nueva-clave').style.display = 'block';
  }
});

// Marcar desconexión si cierra el navegador
window.addEventListener('beforeunload', async () => {
  if (sesionActual) {
    navigator.sendBeacon(
      `${SUPABASE_URL}/rest/v1/usuarios?correo_usuario=eq.${encodeURIComponent(sesionActual.correo_usuario)}`,
      JSON.stringify({ sesion_activa: false, ultima_desconexion: new Date().toISOString() })
    );
  }
});




async function pagarCxP(idCxP) {
  try {
    // 1. Cargar CxP con datos del proveedor
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+idCxP+'&select=*,proveedores:id_proveedor(nombre,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre))');
    if (!rows || !rows[0]) return;
    const c    = rows[0];
    const prov = c.proveedores || {};
    const esCuota = (c.tipo||'').includes('CREDITO');

    // 2. Cargar tasas de la tabla
    let tasaUSD = _tasaVigente || 1;
    let tasaEUR = 1;
    try {
      const hoy = new Date(new Date().getTime()-4*60*60*1000).toISOString().split('T')[0];
      const tasas = await api('tasas','GET',null,'?order=fecha_valor.desc&limit=20&select=*');
      const getTasa = function(mon) {
        const reg = (tasas||[]).filter(function(t){
          return t.moneda_origen===mon && String(t.fecha_valor||'').substring(0,10)<=hoy;
        }).sort(function(a,b){ return String(b.fecha_valor||'').localeCompare(String(a.fecha_valor||'')); });
        return reg.length ? parseFloat(reg[0].tipo_cambio) : 1;
      };
      tasaUSD = getTasa('USD');
      tasaEUR = getTasa('EUR');
    } catch(e) {}

    // Guardar tasas en el modal para uso en cálculos
    const modal = document.getElementById('modal-cont-pago-cxp');
    if (modal) { modal.dataset.tasaUSD = tasaUSD; modal.dataset.tasaEUR = tasaEUR; }

    // 3. Llenar datos básicos
    document.getElementById('cont-pago-cxp-id').value    = idCxP;
    document.getElementById('cont-pago-cxp-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('cont-pago-cxp-ref').value   = ''; // siempre vacío — usuario debe ingresar referencia
    const archivoInput = document.getElementById('cont-pago-cxp-archivo');
    if (archivoInput) archivoInput.value = '';
    const previewEl = document.getElementById('cont-pago-cxp-archivo-preview');
    if (previewEl) previewEl.textContent = '';
    document.getElementById('alerta-pago-cxp-ok').style.display  = 'none';
    document.getElementById('alerta-pago-cxp-err').style.display = 'none';

    // Monto a cancelar — cuota o saldo total
    const saldoUSD = parseFloat(esCuota ? c.saldo_usd : c.monto_usd) || 0;
    const saldoEl  = document.getElementById('cont-pago-cxp-saldo');
    if (saldoEl) saldoEl.textContent = '$ ' + fmtUSD(saldoUSD) + ' USD';

    // Guardar datos para cálculos de conversión
    const monedaCxP  = c.moneda_pago || 'USD'; // moneda en que se pactó la CxP
    const saldoOrig  = parseFloat(esCuota ? c.saldo_usd : c.monto_usd) || 0;
    if (modal) {
      modal.dataset.saldoUSD  = saldoOrig; // mantener por compatibilidad
      modal.dataset.saldoOrig = saldoOrig;
      modal.dataset.monedaCxP = monedaCxP;
    }
    // Actualizar texto Monto a Cancelar con moneda correcta
    if (saldoEl) saldoEl.textContent = fmtUSD(saldoOrig) + ' ' + monedaCxP;

    // 4. Cargar métodos de pago
    const metodos = await api('param_metodos_pago','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*') || [];
    const selMet  = document.getElementById('cont-pago-cxp-metodo');
    if (selMet) {
      selMet.innerHTML = '<option value="">— Seleccionar —</option>'
        + metodos.map(function(m){ return '<option value="'+m.id+'">'+m.nombre+'</option>'; }).join('');
    }

    // 5. Datos bancarios del proveedor (readonly)
    const bancoInfo = document.getElementById('cont-pago-banco-info');
    const bancoDatos = document.getElementById('cont-pago-banco-datos');
    const pmInfo   = document.getElementById('cont-pago-pm-info');
    const pmDatos  = document.getElementById('cont-pago-pm-datos');
    const manualInfo = document.getElementById('cont-pago-manual-info');

    const tieneBanco = !!prov.id_banco;
    const tienePM    = !!prov.pm_id_banco;

    if (tieneBanco && bancoDatos) {
      bancoDatos.innerHTML =
        dato('Institución', prov.banco_prov?.nombre || '—')
        + dato('Tipo Cuenta', prov.tipo_cuenta || '—')
        + dato('N° Cuenta', prov.numero_cuenta || '—');
      if (bancoInfo) bancoInfo.style.display = '';
    } else if (bancoInfo) bancoInfo.style.display = 'none';

    if (tienePM && pmDatos) {
      pmDatos.innerHTML =
        dato('Banco', prov.banco_pm?.nombre || '—')
        + dato('C.I./R.I.F', prov.pm_ci || '—')
        + dato('Celular', prov.pm_celular || '—');
      if (pmInfo) pmInfo.style.display = '';
    } else if (pmInfo) pmInfo.style.display = 'none';

    // 6. Establecer Método de Pago automáticamente
    const metodoDisplay = document.getElementById('cont-pago-metodo-display');
    const metodoHidden  = document.getElementById('cont-pago-cxp-metodo');
    const metodoCont    = document.getElementById('cont-pago-metodo-cont');

    if (tieneBanco && tienePM) {
      // Tiene ambos — selector entre Transferencia y Pago Móvil
      if (metodoCont) metodoCont.innerHTML =
        '<label>Método de Pago</label>'
        +'<select id="cont-pago-cxp-metodo" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
        +'<option value="TRANSFERENCIA">🏦 Transferencia Bancaria</option>'
        +'<option value="PAGO_MOVIL">📱 Pago Móvil</option>'
        +'</select>';
    } else if (tieneBanco) {
      if (metodoDisplay) metodoDisplay.textContent = '🏦 Transferencia Bancaria';
      if (metodoHidden)  metodoHidden.value = 'TRANSFERENCIA';
    } else if (tienePM) {
      if (metodoDisplay) metodoDisplay.textContent = '📱 Pago Móvil';
      if (metodoHidden)  metodoHidden.value = 'PAGO_MOVIL';
    } else {
      // Sin datos — selector manual
      if (metodoCont) metodoCont.innerHTML =
        '<label>Método de Pago *</label>'
        +'<select id="cont-pago-cxp-metodo" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
        +'<option value="">— Seleccionar —</option>'
        +'<option value="TRANSFERENCIA">Transferencia Bancaria</option>'
        +'<option value="PAGO_MOVIL">Pago Móvil</option>'
        +'<option value="EFECTIVO">Efectivo</option>'
        +'<option value="CHEQUE">Cheque</option>'
        +'</select>';
    }

    // Mostrar campos manuales si no tiene ninguno
    if (manualInfo) manualInfo.style.display = (!tieneBanco && !tienePM) ? '' : 'none';

    // 7. Moneda por defecto y calcular
    const monedaEl = document.getElementById('cont-pago-cxp-moneda');
    if (monedaEl) monedaEl.value = _empresaActiva?.moneda_principal || 'VES';
    if (monedaEl) monedaEl.disabled = false;

    // Restaurar footer con botones de pago
    const footerPago = document.querySelector('#modal-cont-pago-cxp .modal-footer');
    if (footerPago) {
      footerPago.innerHTML =
        '<button class="btn-secundario" onclick="cerrarModal(&quot;modal-cont-pago-cxp&quot;)">Retornar</button>'
        + '<button class="btn-primario" onclick="contGuardarPagoCxp()">&#x1F4B8; Registrar Pago</button>';
    }

    abrirModal('modal-cont-pago-cxp');
    // Calcular monto DESPUÉS de abrir el modal para que el DOM esté listo
    setTimeout(onCambioPagoMoneda, 50);
  } catch(e) { alert('Error: '+e.message); console.error(e); }
}


function dato(label, val) {
  return '<div><div style="font-size:10px;color:var(--suave);margin-bottom:3px">'+label+'</div>'
    +'<div style="font-size:13px;font-family:var(--font-mono)">'+val+'</div></div>';
}

function onCambioMetodoPago() {
  // Mostrar/ocultar info bancaria según método seleccionado
  // (ya está visible si el proveedor tiene datos)
}

function onCambioPagoMoneda() {
  const monedaPago = document.getElementById('cont-pago-cxp-moneda')?.value || 'VES';
  const modal      = document.getElementById('modal-cont-pago-cxp');
  const tasaUSD    = parseFloat(modal?.dataset.tasaUSD) || _tasaVigente || 1; // Bs/USD
  const tasaEUR    = parseFloat(modal?.dataset.tasaEUR) || 1;                 // Bs/EUR
  const monedaCxP  = modal?.dataset.monedaCxP || 'USD';
  const saldoOrig  = parseFloat(modal?.dataset.saldoOrig) || 0;
  const tasaEl     = document.getElementById('cont-pago-cxp-tasa');    // span
  const monRefEl   = document.getElementById('cont-pago-cxp-moneda-ref'); // span
  const montoEl    = document.getElementById('cont-pago-cxp-monto');
  const tasaCont   = document.getElementById('cont-pago-cxp-tasa-cont');
  const tasaLabel  = document.getElementById('cont-pago-cxp-tasa-label');

  let montoPago   = saldoOrig;
  let tasaMostrar = null;
  let monRef      = '';
  let labelTasa   = 'Tipo de Cambio';

  if (monedaCxP === monedaPago) {
    // Misma moneda — sin conversión
    montoPago = saldoOrig;
  } else if (monedaCxP === 'USD' && monedaPago === 'VES') {
    tasaMostrar = tasaUSD; monRef = 'USD/VES';
    labelTasa   = '1 USD = ' + fmtUSD(tasaUSD) + ' Bs';
    montoPago   = parseFloat((saldoOrig * tasaUSD).toFixed(2));
  } else if (monedaCxP === 'EUR' && monedaPago === 'VES') {
    tasaMostrar = tasaEUR; monRef = 'EUR/VES';
    labelTasa   = '1 EUR = ' + fmtUSD(tasaEUR) + ' Bs';
    montoPago   = parseFloat((saldoOrig * tasaEUR).toFixed(2));
  } else if (monedaCxP === 'VES' && monedaPago === 'USD') {
    tasaMostrar = tasaUSD; monRef = 'USD/VES';
    labelTasa   = '1 USD = ' + fmtUSD(tasaUSD) + ' Bs';
    montoPago   = parseFloat((saldoOrig / tasaUSD).toFixed(4));
  } else if (monedaCxP === 'VES' && monedaPago === 'EUR') {
    tasaMostrar = tasaEUR; monRef = 'EUR/VES';
    labelTasa   = '1 EUR = ' + fmtUSD(tasaEUR) + ' Bs';
    montoPago   = parseFloat((saldoOrig / tasaEUR).toFixed(4));
  } else if (monedaCxP === 'USD' && monedaPago === 'EUR') {
    const cruce = parseFloat((tasaUSD / tasaEUR).toFixed(6));
    tasaMostrar = cruce; monRef = 'USD/EUR';
    labelTasa   = '1 USD = ' + cruce + ' EUR';
    montoPago   = parseFloat((saldoOrig * cruce).toFixed(4));
  } else if (monedaCxP === 'EUR' && monedaPago === 'USD') {
    const cruce = parseFloat((tasaEUR / tasaUSD).toFixed(6));
    tasaMostrar = cruce; monRef = 'EUR/USD';
    labelTasa   = '1 EUR = ' + cruce + ' USD';
    montoPago   = parseFloat((saldoOrig * cruce).toFixed(4));
  }

  // Mostrar/ocultar bloque de tasa
  if (tasaCont) tasaCont.style.display = tasaMostrar !== null ? '' : 'none';
  if (tasaLabel) tasaLabel.textContent = labelTasa;
  // Los spans muestran el par y el valor
  if (monRefEl) monRefEl.textContent = monRef;
  if (tasaEl)   tasaEl.textContent   = tasaMostrar !== null ? fmtUSD(tasaMostrar) : '';
  // Formatear según moneda de pago
  if (montoEl) {
    if (monedaPago === 'VES') {
      montoEl.value = fmtBs(montoPago);
    } else {
      montoEl.value = fmtUSD(montoPago) + ' ' + monedaPago;
    }
    montoEl.dataset.valor = montoPago; // guardar valor numérico para cálculos
  }
  onCambioPagoMonto();
}

function onCambioPagoMonto() {
  // Monto es calculado (readonly) — solo actualiza la etiqueta informativa
  const monedaPago = document.getElementById('cont-pago-cxp-moneda')?.value || 'VES';
  const monto      = parseFloat(document.getElementById('cont-pago-cxp-monto')?.value) || 0;
  const modal      = document.getElementById('modal-cont-pago-cxp');
  const tasaUSD    = parseFloat(modal?.dataset.tasaUSD) || _tasaVigente || 1;
  const tasaEUR    = parseFloat(modal?.dataset.tasaEUR) || 1;
  const monedaCxP  = modal?.dataset.monedaCxP || 'USD';
  const saldoOrig  = parseFloat(modal?.dataset.saldoOrig) || 0;
  const label      = document.getElementById('cont-pago-cxp-equiv-label');
  if (!label) return;
  // Mostrar equivalente en la moneda de la CxP
  if (monedaCxP === monedaPago) {
    label.textContent = '';
  } else {
    label.textContent = '≡ ' + fmtUSD(saldoOrig) + ' ' + monedaCxP;
  }
}

async function contGuardarPagoCxp() {
  const idCxP   = parseInt(document.getElementById('cont-pago-cxp-id')?.value) || null;
  const moneda  = document.getElementById('cont-pago-cxp-moneda')?.value || 'VES';
  const montoEl2 = document.getElementById('cont-pago-cxp-monto');
  const monto   = parseFloat(montoEl2?.dataset.valor) || 0; // usar valor numérico exacto sin formato
  const tasa    = parseFloat(document.getElementById('cont-pago-cxp-tasa')?.value) || _tasaVigente || 1;
  const fecha   = document.getElementById('cont-pago-cxp-fecha')?.value || '';
  const metodo  = document.getElementById('cont-pago-cxp-metodo')?.value || '';
  const ref     = document.getElementById('cont-pago-cxp-ref')?.value || '';
  const okEl  = document.getElementById('alerta-pago-cxp-ok');
  const errEl = document.getElementById('alerta-pago-cxp-err');
  if (okEl)  okEl.style.display  = 'none';
  if (errEl) errEl.style.display = 'none';

  const mostrarError = function(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else { alert(msg); }
  };

  if (!idCxP || !monto || !fecha || !metodo) {
    mostrarError('Complete monto, fecha y método de pago.');
    return;
  }
  if (!ref.trim()) {
    mostrarError('Debe ingresar el número de referencia o comprobante.');
    document.getElementById('cont-pago-cxp-ref')?.focus();
    return;
  }

  // Calcular equivalente en USD usando tasa del día de pago
  const modal2   = document.getElementById('modal-cont-pago-cxp');
  const tasaDia  = parseFloat(modal2?.dataset.tasaUSD) || parseFloat(tasa) || _tasaVigente || 1;
  const tasaEurD = parseFloat(modal2?.dataset.tasaEUR) || 1;
  let montoUSD   = monto;
  if (moneda === 'VES')      montoUSD = parseFloat((monto / tasaDia).toFixed(4));
  else if (moneda === 'EUR') montoUSD = parseFloat((monto * tasaEurD / tasaDia).toFixed(4));
  console.log('[PAGO] moneda:', moneda, 'monto:', monto, 'tasaDia:', tasaDia, 'montoUSD:', montoUSD);

  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+idCxP+'&select=*');
    if (!rows || !rows[0]) return;
    const c = rows[0];
    const nuevoPagado = parseFloat((parseFloat(c.pagado_usd||0) + montoUSD).toFixed(4));
    const nuevoSaldo  = parseFloat(Math.max(0, parseFloat(c.monto_usd||0) - nuevoPagado).toFixed(4));
    const nuevoEstado = nuevoSaldo <= 0 ? 'PAGADA' : 'PARCIAL';

    // Subir comprobante si se adjuntó archivo
    let urlComprobante = null;
    const archivoEl = document.getElementById('cont-pago-cxp-archivo');
    if (archivoEl && archivoEl.files && archivoEl.files[0]) {
      try {
        urlComprobante = await subirFoto(archivoEl.files[0], 'comprobantes/' + idCxP);
      } catch(eFile) { console.warn('Error subiendo comprobante:', eFile); }
    }

    const patchData = {
      pagado_usd: nuevoPagado,
      saldo_usd:  nuevoSaldo,
      estado:     nuevoEstado
    };
    if (urlComprobante) patchData.url_comprobante = urlComprobante;

    await api('cont_cxp','PATCH', patchData, '?id_cxp=eq.'+idCxP);

    // ── Generar asiento contable del pago ──
    try {
      const idEmisor = _empresaActiva?.id_emisor || 0;
      const tasaVig  = _tasaVigente || 1;
      const hoy      = fecha;

      // Buscar cuentas
      const cuentas = await api('cont_cuentas','GET',null,
        '?codigo=in.(2.1.01.001,1.1.01.003,1.1.01.004)&select=id_cuenta,codigo');
      const cCxP    = cuentas?.find(function(c){ return c.codigo==='2.1.01.001'; });
      const cBanVES = cuentas?.find(function(c){ return c.codigo==='1.1.01.003'; });
      const cBanUSD = cuentas?.find(function(c){ return c.codigo==='1.1.01.004'; });

      // Cuenta banco según moneda de pago
      const cBanco = (moneda === 'USD') ? cBanUSD : cBanVES;

      if (cCxP && cBanco) {
        // Monto en USD para el asiento
        let montoAstUSD = montoUSD;
        // Monto en VES — si pagó en VES usar el monto directo, si no calcular
        let montoAstVES = moneda === 'VES' ? monto : parseFloat((montoUSD * tasaDia).toFixed(2));

        // Crear asiento
        // Generar numero_asiento correlativo
        const anioAst  = new Date(hoy).getFullYear();
        const ultAsts  = await api('cont_asientos','GET',null,
          '?id_emisor=eq.'+idEmisor+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
        let ultNum = 0;
        if (ultAsts[0]?.numero_asiento) {
          const m = ultAsts[0].numero_asiento.match(/(\d+)$/);
          if (m) ultNum = parseInt(m[1]);
        }
        const numAst = 'AST-' + anioAst + '-' + String(ultNum + 1).padStart(4,'0');

        const ast = await api('cont_asientos','POST',{
          id_emisor:      idEmisor,
          numero_asiento: numAst,
          tipo:           'PAGO_PROVEEDOR',
          fecha:          hoy,
          descripcion:    'Pago proveedor — ' + (c.numero_doc||'') + ' — ' + ref,
          referencia:     c.numero_doc || ('CXP-'+idCxP),
          estado:         'APROBADO',
          moneda_base:    moneda,
          tasa_bcv:       tasaDia,
          id_usuario:     sesionActual?.correo_usuario || null
        });

        const astRec = Array.isArray(ast) ? ast[0] : ast;
        if (astRec && astRec.id_asiento) {
          // Línea 1: DÉBITO a CxP Proveedores
          await api('cont_asiento_lineas','POST',{
            id_asiento:  astRec.id_asiento,
            id_cuenta:   cCxP.id_cuenta,
            orden:       1,
            descripcion: 'Cancelación CxP — ' + (c.numero_doc||''),
            debe_usd:    montoAstUSD,
            haber_usd:   0,
            debe_ves:    montoAstVES,
            haber_ves:   0,
            tasa_bcv:    tasaDia
          });
          // Línea 2: CRÉDITO a Banco
          await api('cont_asiento_lineas','POST',{
            id_asiento:  astRec.id_asiento,
            id_cuenta:   cBanco.id_cuenta,
            orden:       2,
            descripcion: 'Salida banco — ' + ref,
            debe_usd:    0,
            haber_usd:   montoAstUSD,
            debe_ves:    0,
            haber_ves:   montoAstVES,
            tasa_bcv:    tasaDia
          });
        }
      }
    } catch(eAst) { console.warn('Error generando asiento pago:', eAst); }

    okEl.textContent = '✓ Pago registrado correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-cont-pago-cxp');
      cargarPagos();
    }, 1000);
  } catch(e) {
    errEl.textContent = 'Error: '+e.message;
    errEl.style.display = 'block';
  }
}


async function anularPagoCxP(idCxP) {
  if (!confirm('¿Anular esta CxP? Se revertirán los asientos contables asociados.')) return;
  try {
    // 1. Anular la CxP
    await api('cont_cxp','PATCH',
      { estado: 'ANULADA', observaciones: '[ANULADA] ' },
      '?id_cxp=eq.'+idCxP);

    // 2. Reversar asientos contables asociados
    const numDoc = await api('cont_cxp','GET',null,'?id_cxp=eq.'+idCxP+'&select=numero_doc');
    if (numDoc && numDoc[0]) {
      const ref = numDoc[0].numero_doc;
      const asientos = await api('cont_asientos','GET',null,
        '?referencia=eq.'+encodeURIComponent(ref)+emisorQ()+'&estado=neq.ANULADO&select=id_asiento,descripcion');
      for (const a of (asientos||[])) {
        await api('cont_asientos','PATCH',
          { estado: 'ANULADO', descripcion: '[ANULADO] ' + (a.descripcion||'') },
          '?id_asiento=eq.'+a.id_asiento);
      }
    }

    cargarPagos();
  } catch(e) { alert('Error al anular: '+e.message); }
}

async function onSelProveedorCxP() {
  const idProv = parseInt(document.getElementById('cont-cxp-prov')?.value) || null;
  const bancoInfo  = document.getElementById('cxp-banco-info');
  const bancoDatos = document.getElementById('cxp-banco-datos');
  const pmInfo     = document.getElementById('cxp-pm-info');
  const pmDatos    = document.getElementById('cxp-pm-datos');
  const manualInfo = document.getElementById('cxp-manual-info');

  // Reset
  if (bancoInfo)  bancoInfo.style.display  = 'none';
  if (pmInfo)     pmInfo.style.display     = 'none';
  if (manualInfo) manualInfo.style.display = 'none';

  if (!idProv) return;

  try {
    const rows = await api('proveedores','GET',null,
      '?id_proveedor=eq.'+idProv+'&select=id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)');
    if (!rows || !rows[0]) { if (manualInfo) manualInfo.style.display = ''; return; }
    const p = rows[0];
    const tieneBanco = !!p.id_banco;
    const tienePM    = !!p.pm_id_banco;

    if (tieneBanco && bancoDatos) {
      bancoDatos.innerHTML =
        dato('Institución', p.banco_prov?.nombre || '—')
        + dato('Tipo Cuenta', p.tipo_cuenta || '—')
        + dato('N° Cuenta', p.numero_cuenta || '—');
      if (bancoInfo) bancoInfo.style.display = '';
    }
    if (tienePM && pmDatos) {
      pmDatos.innerHTML =
        dato('Banco', p.banco_pm?.nombre || '—')
        + dato('C.I./R.I.F', p.pm_ci || '—')
        + dato('Celular', p.pm_celular || '—');
      if (pmInfo) pmInfo.style.display = '';
    }
    if (!tieneBanco && !tienePM) {
      if (manualInfo) manualInfo.style.display = '';
    }
  } catch(e) { console.warn('onSelProveedorCxP:', e); }
}

async function onSelProveedorPago() {
  const idProv     = parseInt(document.getElementById('pago-proveedor')?.value) || null;
  const bancoInfo  = document.getElementById('pago-banco-info');
  const bancoDatos = document.getElementById('pago-banco-datos');
  const pmInfo     = document.getElementById('pago-pm-info');
  const pmDatos    = document.getElementById('pago-pm-datos');
  const manualInfo = document.getElementById('pago-manual-info');
  const rifEl      = document.getElementById('pago-rif');
  const metodoCont = document.getElementById('pago-metodo-cont');
  const metodoDisp = document.getElementById('pago-metodo-display');
  const metodoHid  = document.getElementById('pago-metodo-hidden');

  // Reset
  [bancoInfo, pmInfo, manualInfo].forEach(function(el){ if (el) el.style.display = 'none'; });
  if (rifEl)     rifEl.value = '';
  if (metodoDisp) metodoDisp.textContent = '—';

  if (!idProv) return;

  // Use cached data if available, else fetch
  let p = (window._pagoProveedores||[]).find(function(x){ return x.id_proveedor === idProv; });
  if (!p) {
    try {
      const rows = await api('proveedores','GET',null,
        '?id_proveedor=eq.'+idProv+'&select=nombre,rif,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)');
      p = rows?.[0];
    } catch(e) {}
  }
  if (!p) { if (manualInfo) manualInfo.style.display = ''; return; }

  // RIF
  if (rifEl) rifEl.value = p.rif || '';

  const tieneBanco = !!p.id_banco;
  const tienePM    = !!p.pm_id_banco;

  if (tieneBanco && bancoDatos) {
    bancoDatos.innerHTML =
      dato('Institución', p.banco_prov?.nombre || '—')
      + dato('Tipo Cuenta', p.tipo_cuenta || '—')
      + dato('N° Cuenta', p.numero_cuenta || '—');
    if (bancoInfo) bancoInfo.style.display = '';
  }
  if (tienePM && pmDatos) {
    pmDatos.innerHTML =
      dato('Banco', p.banco_pm?.nombre || '—')
      + dato('C.I./R.I.F', p.pm_ci || '—')
      + dato('Celular', p.pm_celular || '—');
    if (pmInfo) pmInfo.style.display = '';
  }

  // Método de pago automático
  if (tieneBanco && tienePM) {
    if (metodoCont) metodoCont.innerHTML =
      '<label>Método de Pago</label>'
      +'<select id="pago-metodo-hidden" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
      +'<option value="TRANSFERENCIA">🏦 Transferencia Bancaria</option>'
      +'<option value="PAGO_MOVIL">📱 Pago Móvil</option>'
      +'</select>';
  } else if (tieneBanco) {
    if (metodoDisp) metodoDisp.textContent = '🏦 Transferencia Bancaria';
    if (metodoHid)  metodoHid.value = 'TRANSFERENCIA';
  } else if (tienePM) {
    if (metodoDisp) metodoDisp.textContent = '📱 Pago Móvil';
    if (metodoHid)  metodoHid.value = 'PAGO_MOVIL';
  } else {
    if (manualInfo) manualInfo.style.display = '';
  }
}

async function verPagoCxP(idCxP) {
  try {
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+idCxP+'&select=*,proveedores:id_proveedor(nombre,rif,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre))');
    if (!rows || !rows[0]) return;
    const c    = rows[0];
    const prov = c.proveedores || {};
    const esManual = !(c.tipo||'').includes('COMPRA_CONSUMIBLE');

    // Llenar modal en modo solo lectura
    document.getElementById('cont-pago-cxp-id').value    = idCxP;
    document.getElementById('cont-pago-cxp-fecha').value = c.fecha_emision || '';
    document.getElementById('cont-pago-cxp-ref').value   = ''; // ref vacío en VER — no es la referencia de pago
    document.getElementById('alerta-pago-cxp-ok').style.display  = 'none';
    document.getElementById('alerta-pago-cxp-err').style.display = 'none';

    const saldoEl = document.getElementById('cont-pago-cxp-saldo');
    if (saldoEl) saldoEl.textContent = fmtUSD(c.monto_usd) + ' ' + (c.moneda_pago||'USD');

    // Ocultar campos de pago — modo VER
    const tasaCont = document.getElementById('cont-pago-cxp-tasa-cont');
    if (tasaCont) tasaCont.style.display = 'none';
    const monedaEl = document.getElementById('cont-pago-cxp-moneda');
    if (monedaEl) monedaEl.disabled = true;
    const montoEl = document.getElementById('cont-pago-cxp-monto');
    if (montoEl) { montoEl.value = fmtBs(c.monto_ves || c.monto_usd); montoEl.readOnly = true; }

    // Datos bancarios
    const bancoInfo  = document.getElementById('cont-pago-banco-info');
    const bancoDatos = document.getElementById('cont-pago-banco-datos');
    const pmInfo     = document.getElementById('cont-pago-pm-info');
    const pmDatos    = document.getElementById('cont-pago-pm-datos');
    const manualInfo = document.getElementById('cont-pago-manual-info');
    [bancoInfo, pmInfo, manualInfo].forEach(function(el){ if (el) el.style.display = 'none'; });
    if (prov.id_banco && bancoDatos) {
      bancoDatos.innerHTML = dato('Institución', prov.banco_prov?.nombre||'—') + dato('Tipo', prov.tipo_cuenta||'—') + dato('N° Cuenta', prov.numero_cuenta||'—');
      if (bancoInfo) bancoInfo.style.display = '';
    }
    if (prov.pm_id_banco && pmDatos) {
      pmDatos.innerHTML = dato('Banco', prov.banco_pm?.nombre||'—') + dato('C.I./R.I.F', prov.pm_ci||'—') + dato('Celular', prov.pm_celular||'—');
      if (pmInfo) pmInfo.style.display = '';
    }

    // Cambiar botones del modal — solo Anular (si manual) y Retornar
    const footer = document.querySelector('#modal-cont-pago-cxp .modal-footer');
    if (footer) {
      footer.innerHTML =
        (esManual ? '<button class="btn-peligro" onclick="anularPagoCxP('+idCxP+');cerrarModal(&quot;modal-cont-pago-cxp&quot;)">&#x1F5D1; Anular</button>' : '')
        + '<button class="btn-secundario" onclick="cerrarModal(&quot;modal-cont-pago-cxp&quot;);cargarPagos()">Retornar</button>';
    }

    abrirModal('modal-cont-pago-cxp');
  } catch(e) { alert('Error: '+e.message); }
}
