// ─── S&D Systems — Módulo: CONTABILIDAD ───
// ══════════════════════════════════════════════════════════════
//  MÓDULO CONTABILIDAD — VEN-NIF / SENIAT — BIMONEDA USD/VES
// ══════════════════════════════════════════════════════════════
let contCuentasCache   = [];
let contPeriodosCache  = [];
let contAsientosCache  = [];
let contCxcCache       = [];
let contCxpCache       = [];
let _contVista         = 'diario';  // diario | mayor | balance | cxc | cxp | conciliacion | cuentas | periodos

const TIPOS_CUENTA   = ['ACTIVO','PASIVO','PATRIMONIO','INGRESO','EGRESO'];
const NATURALE_CUENTA = { ACTIVO:'DEUDORA', PASIVO:'ACREEDORA', PATRIMONIO:'ACREEDORA', INGRESO:'ACREEDORA', EGRESO:'DEUDORA' };
const METODOS_PAGO   = ['EFECTIVO_VES','EFECTIVO_USD','TRANSFERENCIA_VES','TRANSFERENCIA_USD','ZELLE','PAGO_MOVIL','DIVISAS','OTRO'];
const ESTADOS_ASIENTO = { PENDIENTE:{clase:'badge-gris',label:'Pendiente'}, APROBADO:{clase:'badge-verde',label:'Aprobado'}, ANULADO:{clase:'badge-rojo',label:'Anulado'} };

// ─── RENDER PRINCIPAL ───
async function renderContabilidad() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('CONTABILIDAD')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando módulo contable...</div>';
  try {
    let emisores = [];
    if (sesionActual?.administrador) {
      emisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*');
    } else {
      emisores = _empresasUsuario.length ? _empresasUsuario : [];
    }
    window._contEmisoresList = emisores;
    if (_empresaActiva) window._contEmisorActivo = _empresaActiva.id_empresa;
    else if (emisores.length) window._contEmisorActivo = emisores[0].id_empresa;
    await Promise.all([contCargarCuentas(), contCargarPeriodos()]);
  } catch(e) { console.warn('Error cargando contabilidad:', e); }
  // Volver a tomar la Moneda Principal de la ficha cada vez que se ENTRA al
  // módulo (no en cada cambio de pestaña interna, para no perder tu
  // elección si estás comparando en USD mientras navegas Diario/Mayor/CxP).
  _contMoneda = null;
  _contVista = 'diario';
  contRenderShell();
  // Esperar un frame para que el DOM procese el innerHTML
  await new Promise(function(r){ requestAnimationFrame(r); });
  await contCambiarVista('diario');
}

function contRenderShell() {
  const c = document.getElementById('contenido-principal');
  const emisores = window._contEmisoresList || [];
  const selectorEmpresa = emisores.length > 1
    ? '<select onchange="window._contEmisorActivo=parseInt(this.value);contCambiarVista(_contVista,true)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:6px 10px;border-radius:5px;outline:none">'
      + emisores.map(function(e){ return '<option value="'+e.id_empresa+'"'+(window._contEmisorActivo===e.id_empresa?' selected':'')+'>🏢 '+e.nombre+'</option>'; }).join('')
      + '</select>'
    : (emisores.length===1 ? '<span style="font-size:12px;color:var(--suave)">🏢 '+emisores[0].nombre+'</span>' : '');

  c.innerHTML =
    '<div class="panel" style="padding:0">'
    + '<div style="display:flex;gap:3px;align-items:center;background:var(--gris2);border-bottom:1px solid var(--borde);padding:10px 16px;flex-wrap:wrap;gap:6px">'
    + selectorEmpresa
    + contTabBtn('diario',       '📓 Libro Diario',   'VER')
    + contTabBtn('mayor',        '📊 Libro Mayor',    'VER_MAYOR')
    + contTabBtn('balance',      '⚖ Balance',         'VER_BALANCE')
    + contTabBtn('cxc',          '💰 CxC',            'CXC')
    + contTabBtn('cxp',          '💳 CxP',            'CXP')
    + contTabBtn('conciliacion', '🔄 Conciliación',   'CONCILIACION')
    + contTabBtn('asientos',     '📝 Asientos',       'CREAR')
    + contTabBtn('cuentas',      '📋 Cuentas',        'PLAN_CUENTAS')
    + contTabBtn('periodos',     '📅 Períodos',       'PERIODOS')
    + '</div>'
    + '<div id="cont-vista-cont" style="padding:16px"></div>'
    + '</div>';
}
function contTabBtn(vista, label, permiso) {
  if (!sesionActual?.administrador && !puedo('CONTABILIDAD', permiso)) return '';
  const activo = _contVista === vista;
  return '<button onclick="contCambiarVista(\''+vista+'\')" '
    + 'style="font-size:12px;padding:7px 14px;border-radius:5px;border:none;cursor:pointer;font-family:var(--font-body);'
    + 'background:' + (activo ? 'var(--naranja)' : 'transparent') + ';'
    + 'color:' + (activo ? '#fff' : 'var(--suave)') + '">'
    + label + '</button>';
}

async function contCambiarVista(vista, forzar) {
  _contVista = vista;
  // Actualizar tabs
  const shell = document.getElementById('contenido-principal');
  if (shell) {
    const btns = shell.querySelectorAll('button[onclick^="contCambiarVista"]');
    btns.forEach(function(btn) {
      const v = btn.getAttribute('onclick').match(/'(\w+)'/)[1];
      btn.style.background = v === vista ? 'var(--naranja)' : 'var(--gris3)';
      btn.style.color      = v === vista ? '#fff' : 'var(--suave)';
    });
  }
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) { console.warn('cont-vista-cont no encontrado'); return; }
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  if      (vista === 'diario')       await contRenderDiario();
  else if (vista === 'mayor')        await contRenderMayor();
  else if (vista === 'balance')      await contRenderBalance();
  else if (vista === 'cxc')          await contRenderCxc();
  else if (vista === 'cxp')          await contRenderCxp();
  else if (vista === 'conciliacion') await contRenderConciliacion();
  else if (vista === 'asientos')     { cont.innerHTML = ''; _contVista = 'diario'; await contAbrirAsiento(null); }
  else if (vista === 'cuentas')      await contRenderCuentas();
  else if (vista === 'periodos')     await contRenderPeriodos();
}

// ─── HELPERS ───
// ─── Moneda seleccionada para reportes contables ───
let _contMoneda = null; // se inicializa con la Moneda Principal de la ficha de la empresa activa

function contGetMonedaLabel() {
  return _contMoneda || ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
}

async function contGetTasa(fecha) {
  // Obtener tasa vigente para la fecha dada
  try {
    const res = await api('tasas','GET',null,
      '?fecha_valor=lte.'+fecha+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    return res.length > 0 ? parseFloat(res[0].tipo_cambio) : null;
  } catch(e) { return null; }
}

function contConvertirMonto(monto, tasa) {
  // Convierte de VES a USD usando la tasa
  if (!tasa || tasa === 0) return monto;
  return monto / tasa;
}

function contSelectorMoneda(fechaConsulta) {
  const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
  const monedaSecundaria = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
  const selVal = _contMoneda || monedaPrincipal;
  return '<div style="display:flex;align-items:center;gap:8px">'
    + '<label style="font-size:11px;color:var(--suave)">Moneda:</label>'
    + '<select id="cont-selector-moneda" onchange="_contMoneda=this.value;contCambiarVista(_contVista,true)" '
    + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-size:12px;padding:4px 8px;border-radius:4px;outline:none">'
    + '<option value="'+monedaPrincipal+'"'+(selVal===monedaPrincipal?' selected':'')+'>'+monedaPrincipal+'</option>'
    + '<option value="'+monedaSecundaria+'"'+(selVal===monedaSecundaria?' selected':'')+'>'+monedaSecundaria+' — Referencia</option>'
    + '</select>'
    + '</div>';
}

async function contCargarCuentas() {
  // Cuentas globales (id_empresa IS NULL) + cuentas de la empresa activa
  const id_emisor = _empresaActiva?.id_empresa || 0;
  contCuentasCache = await api('cont_cuentas','GET',null,
    '?estado=eq.ACTIVA&order=codigo.asc&select=*&or=(id_empresa.eq.' + id_emisor + ',id_empresa.is.null)&limit=1000');
}
async function contCargarPeriodos() {
  contPeriodosCache = await api('cont_periodos','GET',null,'?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=fecha_inicio.desc&select=*');
}
function contGetPeriodoActivo() {
  return contPeriodosCache.find(function(p){ return p.estado === 'ABIERTO'; }) || contPeriodosCache[0];
}
function contCuentasMovimiento() {
  return contCuentasCache.filter(function(c){ return c.permite_movimiento; });
}
function contBuildCuentaSelect(selectedId) {
  const ctas = contCuentasMovimiento();
  // Agrupar por nivel 1 (clase) y nivel 2 (grupo)
  let opts = '<option value="">— Seleccionar cuenta —</option>';
  let lastClase = ''; let lastGrupo = '';
  ctas.forEach(function(c) {
    const partes = c.codigo.split('.');
    const clase  = partes[0];
    const grupo  = partes.slice(0,2).join('.');

    // Separador de clase
    if (clase !== lastClase) {
      const cl = contCuentasCache.find(function(x){ return x.codigo === clase; });
      if (cl) {
        if (lastGrupo) opts += '</optgroup>';
        opts += '<optgroup label="━━ ' + cl.nombre + ' ━━" disabled style="color:var(--naranja)">';
        opts += '</optgroup>';
      }
      lastClase = clase; lastGrupo = '';
    }
    // Separador de grupo
    if (grupo !== lastGrupo) {
      const gr = contCuentasCache.find(function(x){ return x.codigo === grupo; });
      if (lastGrupo) opts += '</optgroup>';
      if (gr) opts += '<optgroup label="  ' + gr.codigo + ' — ' + gr.nombre + '">';
      lastGrupo = grupo;
    }
    opts += '<option value="' + c.id_cuenta + '"' + (c.id_cuenta == selectedId ? ' selected' : '') + '>'
      + c.codigo + ' — ' + c.nombre + '</option>';
  });
  if (lastGrupo) opts += '</optgroup>';
  return opts;
}
function contFmtMoneda(val, moneda) {
  const n = parseFloat(val||0);
  if (moneda === 'VES') return fmtBs(n) + ' Bs';
  return '$ ' + fmtUSD(n);
}

// ══════════════════════════════════════════════════════════════
//  LIBRO DIARIO
// ══════════════════════════════════════════════════════════════
async function contRenderDiario(filtroEstado, filtroPeriodo) {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  try {
    const periodoActivo = contGetPeriodoActivo();
    const qPeriodo = filtroPeriodo ? '&id_periodo=eq.' + filtroPeriodo : '';
    const qEstado  = filtroEstado  ? '&estado=eq.' + filtroEstado : '';
    const asientos = await api('cont_asientos','GET',null,
      '?id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=fecha.desc,numero_asiento.desc&select=*,cont_periodos(nombre)' + qPeriodo + qEstado);
    contAsientosCache = asientos;

    // Totales por asiento (para la columna Monto) -- se toma el total del
    // Debe, que en un asiento cuadrado es igual al Haber.
    const idsAst = asientos.map(function(a){ return a.id_asiento; });
    let totalesPorAsiento = {};
    if (idsAst.length) {
      const lineasTot = await api('cont_asiento_lineas','GET',null,
        '?id_asiento=in.('+idsAst.join(',')+')&select=id_asiento,debe_usd,debe_ves');
      lineasTot.forEach(function(l) {
        if (!totalesPorAsiento[l.id_asiento]) totalesPorAsiento[l.id_asiento] = {usd:0, ves:0};
        totalesPorAsiento[l.id_asiento].usd += parseFloat(l.debe_usd||0);
        totalesPorAsiento[l.id_asiento].ves += parseFloat(l.debe_ves||0);
      });
    }
    const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const usandoVES = (_contMoneda || monedaPrincipal) === 'VES';
    const fmtMontoAst = function(id) {
      const t = totalesPorAsiento[id] || {usd:0, ves:0};
      return usandoVES ? 'Bs ' + fmtVES(t.ves) : '$ ' + fmtUSD(t.usd);
    };

    const perSelect = contPeriodosCache.map(function(p){
      return '<option value="' + p.id_periodo + '"' + (filtroPeriodo == p.id_periodo ? ' selected':'') + '>' + p.nombre + '</option>';
    }).join('');

    const hoyDiario = new Date().toISOString().split('T')[0];
    cont.innerHTML =
      contSelectorMoneda(hoyDiario) +
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:12px 0 16px">'
      + '<h3 style="margin:0">Libro Diario</h3>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + '<select onchange="contRenderDiario(document.getElementById(\'cont-filtro-estado\').value, this.value)" style="' + contSelStyle() + '">'
      + '<option value="">Todos los períodos</option>' + perSelect + '</select>'
      + '<select id="cont-filtro-estado" onchange="contRenderDiario(this.value, document.querySelector(\'[onchange*=contRenderDiario]\').value)" style="' + contSelStyle() + '">'
      + '<option value="">Todos los estados</option>'
      + '<option value="PENDIENTE"' + (filtroEstado==='PENDIENTE'?' selected':'') + '>Pendiente</option>'
      + '<option value="APROBADO"' + (filtroEstado==='APROBADO'?' selected':'') + '>Aprobado</option>'
      + '<option value="ANULADO"'  + (filtroEstado==='ANULADO'?' selected':'')  + '>Anulado</option>'
      + '</select>'
      
      + '</div></div>'
      + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th>N° Asiento</th><th>Fecha</th><th>Descripción</th><th>Período</th><th style="text-align:right">Monto</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody>'
      + (asientos.length ? asientos.map(function(a) {
          const est = ESTADOS_ASIENTO[a.estado] || {clase:'badge-gris',label:a.estado};
          return '<tr>'
            + '<td style="font-family:var(--font-mono);font-weight:600;color:var(--naranja)">' + a.numero_asiento + '</td>'
            + '<td style="font-size:12px">' + fmtFecha(a.fecha) + '</td>'
            + '<td style="font-size:12px">' + a.descripcion
            + (a.referencia ? '<div style="font-size:10px;color:var(--suave)">Ref: ' + a.referencia + '</div>' : '')
            + '</td>'
            + '<td style="font-size:11px;color:var(--suave)">' + (a.cont_periodos ? a.cont_periodos.nombre : '—') + '</td>'
            + '<td style="text-align:right;font-size:12px;font-family:var(--font-mono);font-weight:600">' + fmtMontoAst(a.id_asiento)
            + '<div style="font-size:10px;color:var(--suave);font-weight:400">Tasa: ' + parseFloat(a.tasa_bcv||1).toFixed(2) + '</div></td>'
            + '<td><span class="badge ' + est.clase + '">' + est.label + '</span></td>'
            + '<td style="text-align:center"><button class="btn-secundario" style="font-size:11px;padding:4px 8px" onclick="contVerAsiento(' + a.id_asiento + ')">Ver</button></td></tr>';
        }).join('') : '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--suave)">Sin asientos registrados</td></tr>')
      + '</tbody></table></div>';
  } catch(e) {
    console.error('Error contRenderDiario:', e);
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando Libro Diario: ' + e.message + '</div>';
  }
}

function contSelStyle() {
  return 'background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer';
}

// ─── VER ASIENTO ───
async function contVerAsiento(id) {
  // Mostrar spinner mientras carga
  const contEl = document.getElementById('cont-asiento-contenido');
  if (contEl) contEl.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando asiento...</div>';
  abrirModal('modal-cont-asiento-ver');
  try {
    const [a, lineas] = await Promise.all([
      api('cont_asientos','GET',null,'?id_asiento=eq.' + id + '&select=*,cont_periodos(nombre)'),
      api('cont_asiento_lineas','GET',null,'?id_asiento=eq.' + id + '&order=orden.asc&select=*,cont_cuentas(codigo,nombre)'),
    ]);
    const ast = a[0]; if (!ast) return;
    const est = ESTADOS_ASIENTO[ast.estado] || {clase:'badge-gris',label:ast.estado};
    const totalDebe     = lineas.reduce(function(s,l){ return s+parseFloat(l.debe_usd||0); }, 0);
    const totalHaber    = lineas.reduce(function(s,l){ return s+parseFloat(l.haber_usd||0); }, 0);
    const totalDebeVes  = lineas.reduce(function(s,l){ return s+parseFloat(l.debe_ves||0); }, 0);
    const totalHaberVes = lineas.reduce(function(s,l){ return s+parseFloat(l.haber_ves||0); }, 0);
    const cuadra     = Math.abs(totalDebeVes - totalHaberVes) < 0.01 || Math.abs(totalDebe - totalHaber) < 0.01;
    const monLabelI   = (ast.moneda_base || ((_empresaActiva?.moneda_secundaria)||'USD')).toUpperCase();
    // Orden de columnas según la Moneda Principal de LA FICHA de la empresa
    // activa -- no fijo, porque cada empresa puede tener una principal
    // distinta (ver seleccionarEmpresa()).
    const vesPrimero = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase() === 'VES';
    const thBs  = '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">DEBE Bs</th>'
                + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">HABER Bs</th>';
    const thUsd = '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">DEBE USD</th>'
                + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">HABER USD</th>';
    const tdBs = function(l) {
      return (function(){
        const v = l.debe_ves||0;
        const txt = v>0 ? fmtBs(v) : '—';
        const fs  = txt.length > 16 ? '12px' : txt.length > 12 ? '13px' : '15px';
        return '<td style="text-align:right;padding:7px 8px;font-family:var(--font-mono);font-size:'+fs+'!important;font-weight:600;white-space:nowrap;color:' + (v>0?'#22c55e':'var(--suave)') + '">' + txt + '</td>';
      })() + (function(){
        const v = l.haber_ves||0;
        const txt = v>0 ? fmtBs(v) : '—';
        const fs  = txt.length > 16 ? '12px' : txt.length > 12 ? '13px' : '15px';
        return '<td style="text-align:right;padding:7px 8px;font-family:var(--font-mono);font-size:'+fs+'!important;font-weight:600;white-space:nowrap;color:' + (v>0?'#fc8181':'var(--suave)') + '">' + txt + '</td>';
      })();
    };
    const tdUsd = function(l) {
      return '<td style="text-align:right;padding:7px 8px;font-family:var(--font-mono);font-size:15px!important;font-weight:600;color:' + (l.debe_usd>0?'#22c55e':'var(--suave)') + '">' + (l.debe_usd>0?fmtUSD(l.debe_usd):'—') + '</td>'
           + '<td style="text-align:right;padding:7px 8px;font-family:var(--font-mono);font-size:15px!important;font-weight:600;color:' + (l.haber_usd>0?'#fc8181':'var(--suave)') + '">' + (l.haber_usd>0?fmtUSD(l.haber_usd):'—') + '</td>';
    };
    const tfBs = '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:' + (fmtBs(totalDebeVes).length>12?'12px':'15px') + '!important;font-weight:600;white-space:nowrap;color:var(--naranja)">' + fmtBs(totalDebeVes) + '</td>'
               + '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:' + (fmtBs(totalHaberVes).length>12?'12px':'15px') + '!important;font-weight:600;white-space:nowrap;color:var(--naranja)">' + fmtBs(totalHaberVes) + '</td>';
    const tfUsd = '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:15px!important;font-weight:600;color:var(--naranja)">' + fmtUSD(totalDebe) + '</td>'
                + '<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-size:15px!important;font-weight:600;color:var(--naranja)">' + fmtUSD(totalHaber) + '</td>';

    document.getElementById('cont-asiento-contenido').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">'
      + '<div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + ast.numero_asiento + '</div>'
      + '<span class="badge ' + est.clase + '">' + est.label + '</span>'
      + '<div style="font-size:12px;color:var(--suave);margin-top:4px">Fecha: ' + fmtFecha(ast.fecha) + '</div>'
      + (ast.referencia ? '<div style="font-size:11px;color:var(--suave)">Ref: ' + ast.referencia + '</div>' : '')
      + '</div>'
      + '<div style="text-align:right">'
      + '<div style="font-size:11px;color:var(--suave)">Moneda: ' + ast.moneda_base + ' · Tasa BCV: ' + parseFloat(ast.tasa_bcv||1).toFixed(2) + '</div>'
      + '<div style="font-size:11px;color:' + (cuadra ? '#22c55e' : '#fc8181') + ';margin-top:4px;font-weight:600">'
      + (cuadra ? '✓ Asiento cuadrado' : '✗ Asiento descuadrado') + '</div>'
      + '</div></div>'
      + '<div style="background:var(--gris2);border-radius:6px;padding:12px;margin-bottom:16px;font-size:13px">' + ast.descripcion + '</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CUENTA</th>'
      + (vesPrimero ? thBs + thUsd : thUsd + thBs)
      + '</tr></thead><tbody>'
      + lineas.map(function(l){
          return '<tr>'
            + '<td style="padding:7px 8px"><div style="font-size:10px;color:var(--naranja);font-family:var(--font-mono)">' + (l.cont_cuentas ? l.cont_cuentas.codigo : '') + '</div>'
            + '<div>' + (l.cont_cuentas ? l.cont_cuentas.nombre : '') + '</div>'
            + (l.descripcion ? '<div style="font-size:10px;color:var(--suave)">' + l.descripcion + '</div>' : '')
            + '</td>'
            + (vesPrimero ? tdBs(l) + tdUsd(l) : tdUsd(l) + tdBs(l))
            + '</tr>';
        }).join('')
      + '</tbody><tfoot>'
      + '<tr style="border-top:2px solid var(--borde);font-weight:700">'
      + '<td style="padding:8px">TOTALES</td>'
      + (vesPrimero ? tfBs + tfUsd : tfUsd + tfBs)
      + '</tr>'
      + '</tfoot></table></div>';

    // Botones de acción en el footer según estado
    // Orden: ELIMINAR/ANULAR | EDITAR | APROBAR | RETORNAR
    const footer = document.querySelector('#modal-cont-asiento-ver .modal-footer');
    if (footer) {
      let btns = '';
      // Eliminar — solo en PENDIENTE (asiento no contabilizado aún)
      if (puedo('CONTABILIDAD','ELIMINAR') && ast.estado === 'PENDIENTE') {
        btns += '<button class="btn-secundario" style="color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="contEliminarAsiento(' + ast.id_asiento + ')">🗑 Eliminar</button>';
      }
      // Anular — solo en APROBADO y no automático
      if (puedo('CONTABILIDAD','ANULAR') && ast.estado === 'APROBADO' && ast.tipo === 'MANUAL') {
        btns += '<button class="btn-secundario" style="color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="cerrarModal(\'modal-cont-asiento-ver\');contAnularAsiento(' + ast.id_asiento + ')">Anular</button>';
      }
      // Editar — solo en PENDIENTE
      if (puedo('CONTABILIDAD','EDITAR') && ast.estado === 'PENDIENTE') {
        btns += '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-asiento-ver\');contAbrirAsiento(' + ast.id_asiento + ')">✏ Editar</button>';
      }
      // Aprobar — solo en PENDIENTE
      if (puedo('CONTABILIDAD','APROBAR') && ast.estado === 'PENDIENTE') {
        btns += '<button class="btn-primario" onclick="cerrarModal(\'modal-cont-asiento-ver\');contAprobarAsiento(' + ast.id_asiento + ')">✓ Aprobar</button>';
      }
      // Retornar — siempre al final
      btns += '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-asiento-ver\')">Retornar</button>';
      footer.innerHTML = btns;
    }

    abrirModal('modal-cont-asiento-ver');
    focusFirstField('modal-cont-asiento-ver');
  } catch(e) {
    if (contEl) contEl.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando asiento: ' + e.message + '</div>';
    else alert('Error: ' + e.message);
  }
}

// ─── ABRIR / EDITAR ASIENTO ───
let contLineasAsiento = [];

async function contAbrirAsiento(id) {
  if (!puedo('CONTABILIDAD', id ? 'EDITAR' : 'CREAR')) { alert('Sin permiso.'); return; }
  contLineasAsiento = [];
  // Asegurar cache actualizado
  if (!contCuentasCache.length)  await contCargarCuentas();
  if (!contPeriodosCache.length) await contCargarPeriodos();
  const periodoActivo = contGetPeriodoActivo();

  if (id) {
    const [a, lineas] = await Promise.all([
      api('cont_asientos','GET',null,'?id_asiento=eq.' + id + '&select=*'),
      api('cont_asiento_lineas','GET',null,'?id_asiento=eq.' + id + '&order=orden.asc&select=*'),
    ]);
    const ast = a[0]; if (!ast) return;
    document.getElementById('cont-form-id').value          = ast.id_asiento;
    document.getElementById('cont-form-fecha').value       = ast.fecha;
    document.getElementById('cont-form-desc').value        = ast.descripcion;
    document.getElementById('cont-form-ref').value         = ast.referencia || '';
    document.getElementById('cont-form-tipo').value        = ast.tipo;
    document.getElementById('cont-form-tasa').value        = parseFloat(ast.tasa_bcv||1).toFixed(2);
    document.getElementById('cont-form-periodo').value     = ast.id_periodo || '';
    document.getElementById('modal-cont-form-titulo').textContent = 'EDITAR ASIENTO — ' + ast.numero_asiento;
    contLineasAsiento = lineas.map(function(l){ return { id_cuenta: l.id_cuenta, descripcion: l.descripcion||'', debe_usd: l.debe_usd, haber_usd: l.haber_usd, debe_ves: l.debe_ves, haber_ves: l.haber_ves, tasa: l.tasa || 1 }; });
  } else {
    document.getElementById('cont-form-id').value     = '';
    document.getElementById('cont-form-fecha').value  = getHoyVzla();
    document.getElementById('cont-form-desc').value   = '';
    document.getElementById('cont-form-ref').value    = '';
    document.getElementById('cont-form-tipo').value   = 'MANUAL';
    document.getElementById('cont-form-moneda').value = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    document.getElementById('cont-form-periodo').value = periodoActivo ? periodoActivo.id_periodo : '';
    document.getElementById('modal-cont-form-titulo').textContent = 'NUEVO ASIENTO CONTABLE';
    // Cargar tasa BCV del día
    try {
      const tasas = await api('tasas','GET',null,'?order=fecha_valor.desc&limit=1&select=tipo_cambio');
      document.getElementById('cont-form-tasa').value = tasas.length ? parseFloat(tasas[0].tipo_cambio).toFixed(2) : '1.00';
    } catch(e) { document.getElementById('cont-form-tasa').value = '1.00'; }
  }

  // Llenar select de períodos
  document.getElementById('cont-form-periodo').innerHTML =
    '<option value="">— Sin período —</option>'
    + contPeriodosCache.map(function(p){
      return '<option value="' + p.id_periodo + '"' + (p.estado==='ABIERTO' ? '':' style="color:#fc8181"')+'>' + p.nombre + (p.estado!=='ABIERTO'?' (Cerrado)':'') + '</option>';
    }).join('');

  document.getElementById('alerta-cont-form-ok').style.display  = 'none';
  document.getElementById('alerta-cont-form-err').style.display = 'none';
  contRenderLineasForm();
  // Poblar select de moneda con monedas de la empresa
  const selMoneda = document.getElementById('cont-form-moneda');
  const mpEmisor = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  const msEmisor = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
  const monedaLabels = { VES:'Bolívar', USD:'Dólar', EUR:'Euro', COP:'Peso Col.' };
  selMoneda.innerHTML =
    '<option value="'+mpEmisor+'">'+mpEmisor+' — '+(monedaLabels[mpEmisor]||mpEmisor)+'</option>' +
    (msEmisor !== mpEmisor ? '<option value="'+msEmisor+'">'+msEmisor+' — '+(monedaLabels[msEmisor]||msEmisor)+'</option>' : '');
  selMoneda.value = id ? (document.getElementById('cont-form-moneda').value||mpEmisor) : mpEmisor;
  abrirModal('modal-cont-asiento-form');
  focusFirstField('modal-cont-asiento-form');
}

async function contSetLinea(idx, tipo, montoRef, tasaLinea) {
  // montoRef = monto en Moneda de Referencia (lo que escribe el usuario)
  // tasaLinea = tasa de esa línea específica
  const tasa = tasaLinea > 0 ? tasaLinea : 1;
  const montoFunc = montoRef * tasa; // equivalente en Moneda Funcional
  contLineasAsiento[idx].tasa       = tasa;
  if (tipo === 'debe') {
    contLineasAsiento[idx].debe_usd  = montoRef;   // monto ref
    contLineasAsiento[idx].debe_ves  = montoFunc;  // equivalente funcional
    contLineasAsiento[idx].haber_usd = 0;
    contLineasAsiento[idx].haber_ves = 0;
  } else {
    contLineasAsiento[idx].haber_usd = montoRef;
    contLineasAsiento[idx].haber_ves = montoFunc;
    contLineasAsiento[idx].debe_usd  = 0;
    contLineasAsiento[idx].debe_ves  = 0;
  }
  contRenderLineasForm();
}

function contSetTasaLinea(idx) {
  const tasa = parseFloat(document.getElementById('cont-tl-' + idx)?.value) || 1;
  const tipo = (contLineasAsiento[idx].debe_usd || 0) > 0 ? 'debe' : 'haber';
  const montoRef = tipo === 'debe'
    ? parseFloat(contLineasAsiento[idx].debe_usd || 0)
    : parseFloat(contLineasAsiento[idx].haber_usd || 0);
  contSetLinea(idx, tipo, montoRef, tasa);
}

function contRenderLineasForm() {
  const cont = document.getElementById('cont-lineas-form');
  if (!cont) return;

  const totalDebe  = contLineasAsiento.reduce(function(s,l){ return s+parseFloat(l.debe_usd||0); },0);
  const totalHaber = contLineasAsiento.reduce(function(s,l){ return s+parseFloat(l.haber_usd||0); },0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.01;
  const diff   = totalDebe - totalHaber;

  cont.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">'
    + '<thead><tr>'
    + '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;width:45%">CUENTA</th>'
    + '<th style="padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;width:25%">DESCRIPCIÓN</th>'
    + '<th style="text-align:center;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;width:10%">TASA</th>'
    + '<th style="text-align:right;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;width:14%">REF (' + ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase() + ')</th>'
    + '<th style="text-align:right;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;width:14%">FUNC (' + ((_empresaActiva?.moneda_principal)||'VES').toUpperCase() + ')</th>'
    + '<th style="width:40px"></th>'
    + '</tr></thead><tbody>'
    + contLineasAsiento.map(function(l, i) {
        return '<tr>'
          + '<td style="padding:4px"><select onchange="contLineasAsiento[' + i + '].id_cuenta=parseInt(this.value);contRenderLineasForm()" style="width:100%;' + contSelStyle() + ';font-size:11px">' + contBuildCuentaSelect(l.id_cuenta) + '</select></td>'
          + '<td style="padding:4px"><input type="text" value="' + (l.descripcion||'') + '" onchange="contLineasAsiento[' + i + '].descripcion=this.value" placeholder="Detalle..." style="width:100%;background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:11px;padding:6px 8px;border-radius:4px;outline:none"></td>'
          + (function() {
              const cInfo    = contCuentasCache.find(function(x){ return x.id_cuenta === l.id_cuenta; });
              const nat      = cInfo ? cInfo.naturaleza : null;
              const tasaGlob = parseFloat(document.getElementById('cont-form-tasa')?.value) || 1;
              const tasaL    = parseFloat(l.tasa || tasaGlob);
              const monedaRef  = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
              const monedaFunc = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
              if (!nat) {
                return '<td colspan="3" style="padding:4px;text-align:center;color:var(--suave);font-size:11px;font-style:italic">← seleccionar cuenta</td>';
              }
              const esDebe    = nat === 'DEUDORA';
              const montoRef  = esDebe ? parseFloat(l.debe_usd||0)  : parseFloat(l.haber_usd||0);
              const montoFunc = (esDebe ? parseFloat(l.debe_ves||0) : parseFloat(l.haber_ves||0)) || (montoRef * tasaL);
              const colorB    = esDebe ? 'rgba(34,197,94,0.4)' : 'rgba(248,113,113,0.4)';
              const colorT    = esDebe ? '#22c55e' : '#f87171';
              const tipoStr   = esDebe ? 'debe' : 'haber';
              return '<td style="padding:4px"><input id="cont-tl-' + i + '" type="number" value="' + tasaL.toFixed(4) + '" min="0" step="0.0001" placeholder="Tasa"'
                + ' onchange="contSetTasaLinea(' + i + ')"'
                + ' style="width:100%;background:var(--gris2);border:1px solid var(--borde);color:var(--suave);font-family:var(--font-mono);font-size:11px;padding:5px 6px;border-radius:4px;outline:none;text-align:right"></td>'
                + '<td style="padding:4px"><input type="number" value="' + (montoRef||'') + '" min="0" step="0.01" placeholder="0.00 ' + monedaRef + '"'
                + ' onchange="contSetLinea(' + i + ',\'' + tipoStr + '\',parseFloat(this.value)||0,parseFloat(document.getElementById(\'cont-tl-' + i + '\').value)||1)"'
                + ' style="width:100%;background:var(--gris2);border:1px solid ' + colorB + ';color:' + colorT + ';font-family:var(--font-mono);font-size:12px;padding:6px 8px;border-radius:4px;outline:none;text-align:right"></td>'
                + '<td style="padding:4px;text-align:right;font-family:var(--font-mono);font-size:12px;color:' + colorT + ';background:rgba(255,255,255,0.02);padding-right:10px">'
                + (montoFunc > 0 ? montoFunc.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—') + '</td>';
            })()
          + '<td style="padding:4px;text-align:center"><button onclick="contLineasAsiento.splice(' + i + ',1);contRenderLineasForm()" style="background:none;border:none;color:#fc8181;cursor:pointer;font-size:16px">✕</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">'
    + '<button onclick="contLineasAsiento.push({id_cuenta:null,descripcion:\'\',debe_usd:0,haber_usd:0});contRenderLineasForm()" style="background:none;border:1px dashed var(--borde);color:var(--suave);padding:7px 14px;border-radius:5px;cursor:pointer;font-size:12px">+ Agregar línea</button>'
    + '<div style="display:flex;gap:20px;align-items:center">'
    + '<div style="text-align:right"><div style="font-size:10px;color:var(--suave)">DEBE</div><div style="font-family:var(--font-mono);font-size:14px;color:#22c55e">' + fmtUSD(totalDebe) + '</div></div>'
    + '<div style="text-align:right"><div style="font-size:10px;color:var(--suave)">HABER</div><div style="font-family:var(--font-mono);font-size:14px;color:#fc8181">' + fmtUSD(totalHaber) + '</div></div>'
    + '<div style="text-align:right"><div style="font-size:10px;color:var(--suave)">DIFERENCIA</div>'
    + '<div style="font-family:var(--font-mono);font-size:14px;color:' + (cuadra?'#22c55e':'#fc8181') + '">' + (cuadra ? '✓ Cuadrado' : fmtUSD(Math.abs(diff))) + '</div></div>'
    + '</div></div>';
}

async function contGuardarAsiento() {
  const id      = document.getElementById('cont-form-id').value;
  const fecha   = document.getElementById('cont-form-fecha').value;
  const desc    = document.getElementById('cont-form-desc').value.trim();
  const ref     = document.getElementById('cont-form-ref').value.trim();
  const tipo    = document.getElementById('cont-form-tipo').value;
  const moneda  = document.getElementById('cont-form-moneda').value;
  const tasa    = parseFloat(document.getElementById('cont-form-tasa').value) || 1;
  const periodo = parseInt(document.getElementById('cont-form-periodo').value) || null;
  const okEl    = document.getElementById('alerta-cont-form-ok');
  const errEl   = document.getElementById('alerta-cont-form-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; errEl.style.display='block'; return; }
  if (!desc)  { errEl.textContent = 'La descripción es obligatoria.'; errEl.style.display='block'; return; }
  if (contLineasAsiento.length < 2) { errEl.textContent = 'Debe tener al menos 2 líneas.'; errEl.style.display='block'; return; }

  const totalDebe  = contLineasAsiento.reduce(function(s,l){ return s+parseFloat(l.debe_ves||l.debe_usd||0); },0);
  const totalHaber = contLineasAsiento.reduce(function(s,l){ return s+parseFloat(l.haber_ves||l.haber_usd||0); },0);
  const monedaFunc = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    errEl.textContent = 'El asiento no cuadra. Debe = ' + fmtBs(totalDebe) + ' ' + monedaFunc + ' | Haber = ' + fmtBs(totalHaber) + ' ' + monedaFunc;
    errEl.style.display='block'; return;
  }
  if (contLineasAsiento.some(function(l){ return !l.id_cuenta; })) {
    errEl.textContent = 'Todas las líneas deben tener una cuenta seleccionada.'; errEl.style.display='block'; return;
  }

  try {
    let asientoId = id;
    const datos = { fecha, descripcion: desc, referencia: ref||null, tipo, moneda_base: moneda, tasa_bcv: tasa, id_periodo: periodo || null, estado:'PENDIENTE', id_usuario: sesionActual.correo_usuario, id_empresa: _empresaActiva?.id_empresa || null };

    if (id) {
      await api('cont_asientos','PATCH',datos,'?id_asiento=eq.' + id);
      await api('cont_asiento_lineas','DELETE',null,'?id_asiento=eq.' + id);
    } else {
      // Generar número
      const anio = new Date().getFullYear();
      const exist = await api('cont_asientos','GET',null,'?numero_asiento=like.AST-'+anio+'-*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
      let seq = 1;
      if (exist.length) { const p = exist[0].numero_asiento.split('-'); seq = parseInt(p[p.length-1]) + 1; }
      datos.numero_asiento = 'AST-' + anio + '-' + String(seq).padStart(4,'0');
      const res = await api('cont_asientos','POST',datos);
      if (res && res[0]) asientoId = res[0].id_asiento;
    }

    // Insertar líneas
    for (let i = 0; i < contLineasAsiento.length; i++) {
      const l = contLineasAsiento[i];
      const tasaL = parseFloat(l.tasa || tasa);
      await api('cont_asiento_lineas','POST',{
        id_asiento:  parseInt(asientoId),
        id_cuenta:   l.id_cuenta,
        descripcion: l.descripcion||null,
        orden:       i+1,
        tasa_bcv:        tasaL,
        debe_usd:    parseFloat(l.debe_usd||0),
        haber_usd:   parseFloat(l.haber_usd||0),
        debe_ves:    parseFloat(l.debe_ves||0) || parseFloat(l.debe_usd||0) * tasaL,
        haber_ves:   parseFloat(l.haber_ves||0) || parseFloat(l.haber_usd||0) * tasaL,
      });
    }

    okEl.textContent = '✓ Asiento guardado como pendiente.';
    okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-cont-asiento-form'); contCambiarVista('diario'); }, 900);
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display='block'; }
}

async function contAprobarAsiento(id) {
  if (!confirm('¿Aprobar este asiento? Una vez aprobado no podrá editarse.')) return;
  try {
    await api('cont_asientos','PATCH',{ estado:'APROBADO', aprobado_por: sesionActual.correo_usuario, fecha_aprobacion: new Date().toISOString() },'?id_asiento=eq.' + id);
    contCambiarVista('diario');
  } catch(e) { alert('Error: ' + e.message); }
}

async function contEliminarAsiento(id) {
  if (!confirm('¿Eliminar este asiento? Esta acción no se puede deshacer.')) return;
  try {
    await api('cont_asiento_lineas', 'DELETE', null, '?id_asiento=eq.' + id);
    await api('cont_asientos', 'DELETE', null, '?id_asiento=eq.' + id);
    cerrarModal('modal-cont-asiento-ver');
    contCambiarVista('diario');
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function contAnularAsiento(id) {
  if (!confirm('¿Anular este asiento? Esta acción no puede deshacerse.')) return;
  try {
    await api('cont_asientos','PATCH',{ estado:'ANULADO' },'?id_asiento=eq.' + id);
    contCambiarVista('diario');
  } catch(e) { alert('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════
//  LIBRO MAYOR
// ══════════════════════════════════════════════════════════════
async function contRenderMayor() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  if (!_contMoneda) _contMoneda = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
  const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
  const usandoSecundaria = _contMoneda !== monedaPrincipal;
  const hoy = new Date().toISOString().split('T')[0];
  const tasa = usandoSecundaria ? await contGetTasa(hoy) : null;
  const convertir = function(m) { return usandoSecundaria && tasa ? m / tasa : m; };
  const monedaLabel = _contMoneda;
  if (!contCuentasCache.length) await contCargarCuentas();

  cont.innerHTML = contSelectorMoneda(hoy) +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
    + '<h3 style="margin:0">Libro Mayor</h3>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<select id="cont-mayor-cuenta" style="' + contSelStyle() + ';min-width:220px">' + contBuildCuentaSelect(null) + '</select>'
    + '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Desde</span>'
    + '<input type="date" id="cont-mayor-desde" style="' + contSelStyle() + '"></div>'
    + '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Hasta</span>'
    + '<input type="date" id="cont-mayor-hasta" style="' + contSelStyle() + '"></div>'
    + '<button class="btn-primario" onclick="contCargarMayor()">Consultar</button>'
    + '</div></div>'
    + '<div id="cont-mayor-resultado"><div style="text-align:center;color:var(--suave);padding:40px">Cargando...</div></div>';

  // Cargar automáticamente el mayor del mes actual
  const hoyMes = new Date();
  const primerDia = hoyMes.getFullYear() + '-' + String(hoyMes.getMonth()+1).padStart(2,'0') + '-01';
  const ultimoDia = hoyMes.getFullYear() + '-' + String(hoyMes.getMonth()+1).padStart(2,'0') + '-' + String(new Date(hoyMes.getFullYear(), hoyMes.getMonth()+1, 0).getDate()).padStart(2,'0');
  document.getElementById('cont-mayor-desde').value = primerDia;
  document.getElementById('cont-mayor-hasta').value = ultimoDia;

  // No preseleccionar cuenta — mostrar todos los movimientos
  contCargarMayor();
}

async function contCargarMayor() {
  const id_cuenta = document.getElementById('cont-mayor-cuenta').value;
  const desde    = document.getElementById('cont-mayor-desde').value;
  const hasta    = document.getElementById('cont-mayor-hasta').value;
  const res      = document.getElementById('cont-mayor-resultado');

  res.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const cuenta = contCuentasCache.find(function(c){ return c.id_cuenta == id_cuenta; });
    let q = '?id_asiento=in.(select id_asiento from cont_asientos where estado=eq.APROBADO)&id_cuenta=eq.' + id_cuenta + '&order=id_linea.asc&select=*,cont_asientos(fecha,numero_asiento,descripcion,referencia)';

    // Usar mayor si existe, sino calcular desde líneas
    // Obtener asientos aprobados en el rango de fechas
    let qAsientos = '?estado=eq.APROBADO&select=id_asiento';
    if (desde) qAsientos += '&fecha=gte.' + desde;
    if (hasta) qAsientos += '&fecha=lte.' + hasta;
    if (window._contEmisorActivo) qAsientos += '&or=(id_empresa.eq.'+window._contEmisorActivo+',id_empresa.is.null)';
    const asientosRango = await api('cont_asientos','GET',null, qAsientos+'&id_empresa=eq.'+(_empresaActiva?.id_empresa||0));
    const idsAsientos = asientosRango.map(function(a){ return a.id_asiento; });

    let lineas = [];
    if (idsAsientos.length) {
      let qLineas = '?id_asiento=in.(' + idsAsientos.join(',') + ')'
        + '&select=*,cont_asientos(fecha,numero_asiento,descripcion,referencia)'
        + '&order=id_linea.asc';
      if (id_cuenta) qLineas = '?id_cuenta=eq.' + id_cuenta
        + '&id_asiento=in.(' + idsAsientos.join(',') + ')'
        + '&select=*,cont_asientos(fecha,numero_asiento,descripcion,referencia)'
        + '&order=id_linea.asc';
      lineas = await api('cont_asiento_lineas','GET',null, qLineas);
    }

    if (!lineas.length) {
      res.innerHTML = '<div style="text-align:center;color:var(--suave);padding:40px">Sin movimientos en el período seleccionado.</div>';
      return;
    }

    // Determinar moneda a mostrar
    const monedaFunc = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const monedaRef  = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const usandoRef  = _contMoneda && _contMoneda !== monedaFunc;

    if (usandoRef) {
      // ── LIBRO AUXILIAR EN MONEDA DE REFERENCIA ──
      // Solo líneas con monto original en moneda de referencia (debe_usd > 0 o haber_usd > 0)
      const lineasRef = lineas.filter(function(l) {
        return parseFloat(l.debe_usd||0) > 0 || parseFloat(l.haber_usd||0) > 0;
      });

      if (!lineasRef.length) {
        res.innerHTML = '<div style="text-align:center;color:var(--suave);padding:40px">Sin operaciones en ' + monedaRef + ' en el período seleccionado.</div>';
        return;
      }

      const renderGrupo = function(lineasG, cInfo) {
        const esDeud = cInfo && cInfo.naturaleza === 'DEUDORA';
        let saldo = 0;
        const filas = lineasG.map(function(l) {
          const d = parseFloat(l.debe_usd||0), h = parseFloat(l.haber_usd||0);
          saldo += esDeud ? (d-h) : (h-d);
          return '<tr>'
            + '<td style="padding:7px;font-size:12px">' + fmtFecha(l.cont_asientos?.fecha||'') + '</td>'
            + '<td style="padding:7px;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">' + (l.cont_asientos?.numero_asiento||'—') + (l.cont_asientos?.referencia ? '<div style="font-size:10px;color:var(--suave)">Ref: ' + l.cont_asientos.referencia + '</div>' : '') + '</td>'
            + '<td style="padding:7px;font-size:12px">' + (l.descripcion||'') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#22c55e">' + (d>0 ? '$ '+fmtUSD(d) : '—') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#fc8181">' + (h>0 ? '$ '+fmtUSD(h) : '—') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-weight:700;color:' + (saldo>=0?'var(--naranja)':'#fc8181') + '">$ ' + fmtUSD(Math.abs(saldo)) + (saldo<0?' Cr':' Dr') + '</td>'
            + '</tr>';
        });
        const headers =
          '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Fecha</th>'
          + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Asiento</th>'
          + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Descripción</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Debe ' + monedaRef + '</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Haber ' + monedaRef + '</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Saldo ' + monedaRef + '</th>';
        return '<table style="width:100%;border-collapse:collapse"><thead><tr>' + headers + '</tr></thead>'
          + '<tbody>' + filas.join('') + '</tbody>'
          + '<tfoot><tr style="border-top:2px solid var(--borde)">'
          + '<td colspan="3" style="padding:8px;font-weight:700">SALDO FINAL</td>'
          + '<td colspan="3" style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:' + (saldo>=0?'var(--naranja)':'#fc8181') + '">$ ' + fmtUSD(Math.abs(saldo)) + (saldo<0?' Cr':' Dr') + '</td>'
          + '</tr></tfoot></table>';
      };

      if (!id_cuenta) {
        const cuentaIds = [...new Set(lineasRef.map(function(l){ return l.id_cuenta; }))];
        let html = '';
        cuentaIds.forEach(function(cid) {
          const lineasG = lineasRef.filter(function(l){ return l.id_cuenta === cid; });
          const cInfo = contCuentasCache.find(function(c){ return c.id_cuenta === cid; });
          html += '<div style="margin-bottom:24px">'
            + '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:10px 14px;margin-bottom:8px">'
            + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + (cInfo ? cInfo.codigo + ' — ' + cInfo.nombre : 'Cuenta #'+cid) + '</div>'
            + '<div style="font-size:11px;color:var(--suave)">Libro Auxiliar ' + monedaRef + '</div>'
            + '</div>'
            + renderGrupo(lineasG, cInfo)
            + '</div>';
        });
        res.innerHTML = html;
      } else {
        res.innerHTML = '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
          + '<div style="font-size:10px;color:var(--suave)">CUENTA · AUXILIAR ' + monedaRef + '</div>'
          + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + (cuenta ? cuenta.codigo + ' — ' + cuenta.nombre : '') + '</div>'
          + '</div>'
          + renderGrupo(lineasRef, cuenta);
      }
      return;
    }

    // ── LIBRO MAYOR EN MONEDA FUNCIONAL ──
    const getD = function(l) { return parseFloat(l.debe_ves||l.debe_usd||0); };
    const getH = function(l) { return parseFloat(l.haber_ves||l.haber_usd||0); };
    const fmtM = function(v) { return 'Bs ' + fmtVES(v); };

    if (!id_cuenta) {
      const cuentaIds = [...new Set(lineas.map(function(l){ return l.id_cuenta; }))];
      let html = '';
      cuentaIds.forEach(function(cid) {
        const lineasCuenta = lineas.filter(function(l){ return l.id_cuenta === cid; });
        const cInfo = contCuentasCache.find(function(c){ return c.id_cuenta === cid; });
        const esDeud = cInfo && cInfo.naturaleza === 'DEUDORA';
        let saldoCta = 0;
        const filasCta = lineasCuenta.map(function(l) {
          const d = getD(l), h = getH(l);
          saldoCta += esDeud ? (d-h) : (h-d);
          return '<tr>'
            + '<td style="padding:7px;font-size:12px">' + fmtFecha(l.cont_asientos?.fecha||'') + '</td>'
            + '<td style="padding:7px;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">' + (l.cont_asientos?.numero_asiento||'—') + (l.cont_asientos?.referencia ? '<div style="font-size:10px;color:var(--suave)">Ref: ' + l.cont_asientos.referencia + '</div>' : '') + '</td>'
            + '<td style="padding:7px;font-size:12px">' + (l.descripcion||'') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#22c55e">' + (d>0 ? fmtM(d) : '—') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#fc8181">' + (h>0 ? fmtM(h) : '—') + '</td>'
            + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-weight:700;color:' + (saldoCta>=0?'var(--naranja)':'#fc8181') + '">' + fmtM(Math.abs(saldoCta)) + (saldoCta<0?' Cr':' Dr') + '</td>'
            + '</tr>';
        });
        html += '<div style="margin-bottom:24px">'
          + '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:10px 14px;margin-bottom:8px">'
          + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + (cInfo ? cInfo.codigo + ' — ' + cInfo.nombre : 'Cuenta #'+cid) + '</div>'
          + '<div style="font-size:11px;color:var(--suave)">' + (cInfo ? cInfo.naturaleza + ' · ' + cInfo.tipo : '') + '</div>'
          + '</div>'
          + '<table style="width:100%;border-collapse:collapse"><thead><tr>'
          + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Fecha</th>'
          + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Asiento</th>'
          + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Descripción</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Debe Bs</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Haber Bs</th>'
          + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Saldo Bs</th>'
          + '</tr></thead><tbody>' + filasCta.join('') + '</tbody></table></div>';
      });
      res.innerHTML = html;
      return;
    }

    let saldo = 0;
    const esDeudora = cuenta && cuenta.naturaleza === 'DEUDORA';
    const filas = lineas.map(function(l) {
      const debe = getD(l), haber = getH(l);
      saldo += esDeudora ? (debe-haber) : (haber-debe);
      return '<tr>'
        + '<td style="padding:7px;font-size:12px">' + fmtFecha(l.cont_asientos?.fecha||'') + '</td>'
        + '<td style="padding:7px;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">' + (l.cont_asientos?.numero_asiento||'—') + (l.cont_asientos?.referencia ? '<div style="font-size:10px;color:var(--suave)">Ref: ' + l.cont_asientos.referencia + '</div>' : '') + '</td>'
        + '<td style="padding:7px;font-size:12px">' + (l.descripcion||'') + '</td>'
        + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#22c55e">' + (debe>0 ? fmtM(debe) : '—') + '</td>'
        + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);color:#fc8181">' + (haber>0 ? fmtM(haber) : '—') + '</td>'
        + '<td style="text-align:right;padding:7px;font-family:var(--font-mono);font-weight:700;color:' + (saldo>=0?'var(--naranja)':'#fc8181') + '">' + fmtM(Math.abs(saldo)) + (saldo<0?' Cr':' Dr') + '</td>'
        + '</tr>';
    });
    res.innerHTML =
      '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
      + '<div style="font-size:10px;color:var(--suave)">CUENTA</div>'
      + '<div style="font-family:var(--font-mono);color:var(--naranja)">' + (cuenta ? cuenta.codigo + ' — ' + cuenta.nombre : '') + '</div>'
      + '<div style="font-size:11px;color:var(--suave);margin-top:4px">Naturaleza: ' + (cuenta?.naturaleza||'') + ' · Tipo: ' + (cuenta?.tipo||'') + '</div>'
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse"><thead><tr>'
      + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Fecha</th>'
      + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Asiento</th>'
      + '<th style="padding:7px;text-align:left;border-bottom:1px solid var(--borde);font-size:11px">Descripción</th>'
      + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Debe Bs</th>'
      + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Haber Bs</th>'
      + '<th style="padding:7px;text-align:right;border-bottom:1px solid var(--borde);font-size:11px">Saldo Bs</th>'
      + '</tr></thead><tbody>' + filas.join('') + '</tbody>'
      + '<tfoot><tr style="border-top:2px solid var(--borde)">'
      + '<td colspan="3" style="padding:8px;font-weight:700">SALDO FINAL</td>'
      + '<td colspan="3" style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700;color:' + (saldo>=0?'var(--naranja)':'#fc8181') + '">' + fmtM(Math.abs(saldo)) + (saldo<0?' Cr':' Dr') + '</td>'
      + '</tr></tfoot></table>';

  } catch(e) { res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>'; }
}


async function contRenderBalance() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  if (!_contMoneda) _contMoneda = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
  const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase().toUpperCase();
  const usandoSecundaria = _contMoneda !== monedaPrincipal;
  const hoy = new Date().toISOString().split('T')[0];
  const tasa = usandoSecundaria ? await contGetTasa(hoy) : null;
  const convertir = function(m) { return usandoSecundaria && tasa ? m / tasa : m; };
  const monedaLabel = _contMoneda;
  cont.innerHTML = contSelectorMoneda(hoy) +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
    + '<h3 style="margin:0">Estados Financieros</h3>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Al:</span>'
    + '<input type="date" id="cont-bal-hasta" value="' + getHoyVzla() + '" style="' + contSelStyle() + '"></div>'
    + '<select id="cont-bal-tipo" style="' + contSelStyle() + '">'
    + '<option value="balance">Balance General</option>'
    + '<option value="resultados">Estado de Resultados</option>'
    + '</select>'
    + '<button class="btn-primario" onclick="contGenerarBalance()">Generar</button>'
    + '</div></div>'
    + '<div id="cont-bal-resultado"><div style="text-align:center;color:var(--suave);padding:40px">Selecciona el tipo de reporte y la fecha de corte.</div></div>';
}

async function contGenerarBalance() {
  const hasta = document.getElementById('cont-bal-hasta').value;
  const tipo  = document.getElementById('cont-bal-tipo').value;
  const res   = document.getElementById('cont-bal-resultado');
  res.innerHTML = '<div class="loading"><div class="spinner"></div> Calculando...</div>';
  try {
    // Obtener saldos de todas las cuentas con movimientos aprobados hasta la fecha
    const lineas = await api('cont_asiento_lineas','GET',null,
      '?select=id_cuenta,debe_usd,haber_usd,cont_asientos!inner(fecha,estado,id_empresa)&cont_asientos.id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+''
      + '&cont_asientos.estado=eq.APROBADO'
      + (hasta ? '&cont_asientos.fecha=lte.' + hasta : ''));

    const saldos = {};
    lineas.forEach(function(l) {
      if (!saldos[l.id_cuenta]) saldos[l.id_cuenta] = 0;
      const cta = contCuentasCache.find(function(c){ return c.id_cuenta == l.id_cuenta; });
      if (!cta) return;
      const debe  = parseFloat(l.debe_usd||0);
      const haber = parseFloat(l.haber_usd||0);
      saldos[l.id_cuenta] += cta.naturaleza === 'DEUDORA' ? (debe - haber) : (haber - debe);
    });

    if (tipo === 'balance') {
      res.innerHTML = contRenderBalanceHTML(saldos, hasta);
    } else {
      res.innerHTML = contRenderResultadosHTML(saldos, hasta);
    }
  } catch(e) { res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>'; }
}

function contSaldoGrupo(saldos, tipoCuenta, desde, hasta) {
  return contCuentasCache
    .filter(function(c){ return c.tipo === tipoCuenta && c.permite_movimiento; })
    .reduce(function(s, c) { return s + (saldos[c.id_cuenta] || 0); }, 0);
}

function contRenderGrupoBalance(saldos, tipo, titulo, color) {
  const cuentas = contCuentasCache.filter(function(c){ return c.tipo === tipo && c.nivel <= 3 && !c.permite_movimiento; });
  let html = '<div style="margin-bottom:20px">'
    + '<div style="font-size:11px;color:' + color + ';letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:8px;border-bottom:1px solid ' + color + '44;padding-bottom:4px">' + titulo + '</div>';
  let total = 0;
  cuentas.forEach(function(grp) {
    const subctas = contCuentasCache.filter(function(c){ return c.permite_movimiento && c.codigo.startsWith(grp.codigo + '.'); });
    const subtotal = subctas.reduce(function(s,c){ return s + (saldos[c.id_cuenta]||0); },0);
    if (Math.abs(subtotal) < 0.01) return;
    total += subtotal;
  html = contSelectorMoneda(hoy) + html;
    html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px">'
      + '<span style="color:var(--suave)">' + grp.nombre + '</span>'
      + '<span style="font-family:var(--font-mono)">$ ' + fmtUSD(subtotal) + '</span></div>';
  });
  html += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700;border-top:1px solid var(--borde);margin-top:4px">'
    + '<span>TOTAL ' + titulo + '</span>'
    + '<span style="font-family:var(--font-mono);color:' + color + '">$ ' + fmtUSD(total) + '</span></div></div>';
  return { html, total };
}

function contRenderBalanceHTML(saldos, hasta) {
  const activo   = contRenderGrupoBalance(saldos,'ACTIVO','ACTIVO','#22c55e');
  const pasivo   = contRenderGrupoBalance(saldos,'PASIVO','PASIVO','#fc8181');
  const patrim   = contRenderGrupoBalance(saldos,'PATRIMONIO','PATRIMONIO','#60a5fa');
  const totalPasPatrim = pasivo.total + patrim.total;

  return '<div style="max-width:700px;margin:0 auto">'
    + '<div style="text-align:center;margin-bottom:20px">'
    + '<div style="font-family:var(--font-display);font-size:20px;color:var(--naranja)">BALANCE GENERAL</div>'
    + '<div style="font-size:12px;color:var(--suave)">Al ' + hasta + '</div>'
    + (Math.abs(activo.total - totalPasPatrim) < 1
        ? '<span style="font-size:11px;color:#22c55e;font-weight:600">✓ Balance cuadrado</span>'
        : '<span style="font-size:11px;color:#fc8181;font-weight:600">✗ Diferencia: $ ' + fmtUSD(Math.abs(activo.total - totalPasPatrim)) + '</span>')
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'
    + '<div>' + activo.html + '</div>'
    + '<div>' + pasivo.html + patrim.html
    + '<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:14px;border-top:2px solid var(--borde)">'
    + '<span>TOTAL PAS + PAT</span><span style="font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(totalPasPatrim) + '</span></div>'
    + '</div></div></div>';
}

function contRenderResultadosHTML(saldos, hasta) {
  const ingresos = contRenderGrupoBalance(saldos,'INGRESO','INGRESOS','#22c55e');
  const costos   = contRenderGrupoBalance(saldos,'EGRESO','COSTOS Y GASTOS','#fc8181');
  const utilidad = ingresos.total - costos.total;

  return '<div style="max-width:500px;margin:0 auto">'
    + '<div style="text-align:center;margin-bottom:20px">'
    + '<div style="font-family:var(--font-display);font-size:20px;color:var(--naranja)">ESTADO DE RESULTADOS</div>'
    + '<div style="font-size:12px;color:var(--suave)">Al ' + hasta + '</div></div>'
    + ingresos.html + costos.html
    + '<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700;font-size:15px;border-top:2px solid var(--borde);margin-top:8px">'
    + '<span>' + (utilidad >= 0 ? 'UTILIDAD DEL EJERCICIO' : 'PÉRDIDA DEL EJERCICIO') + '</span>'
    + '<span style="font-family:var(--font-mono);color:' + (utilidad>=0?'#22c55e':'#fc8181') + '">$ ' + fmtUSD(Math.abs(utilidad)) + '</span></div>'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════
//  CUENTAS POR COBRAR
// ══════════════════════════════════════════════════════════════
async function contRenderCxc() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const facturas = await api('facturas','GET',null,'?estado=neq.ANULADA&order=fecha_emision.desc&select=*,propietarios(nombre_completo)'+emisorQ());
    const pendientes = facturas.filter(function(f){ return f.estado!=='PAGADA'&&f.estado!=='ANULADA'; });
    const cobradas   = facturas.filter(function(f){ return f.estado==='PAGADA'; });

    const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const usandoVES = (_contMoneda || monedaPrincipal) === 'VES';
    const fmtMonto = function(usd, ves) {
      if (!usandoVES) return '$ ' + fmtUSD(usd || 0);
      return 'Bs ' + fmtVES(ves || 0);
    };

    const totPend = pendientes.reduce(function(s,f){ return s+parseFloat((usandoVES?f.total_ves:f.total_usd)||0); },0);
    const totCob  = cobradas.reduce(function(s,f){ return s+parseFloat((usandoVES?f.total_ves:f.total_usd)||0); },0);

    const eb = {
      EMITIDA:'<span class="badge badge-naranja">Emitida</span>',
      PAGADA:'<span class="badge" style="background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3)">Pagada</span>',
      PARCIAL:'<span class="badge badge-gris">Parcial</span>',
    };

    const filas = facturas.map(function(f) {
      const tusd = parseFloat(f.total_usd||0);
      const tves = parseFloat(f.total_ves||0);
      const cobUSD = parseFloat(f.monto_cobrado||0);
      const saldoUSD = tusd - cobUSD;
      // El cobrado/saldo no siempre se guarda en VES por separado -- se
      // aproxima con la misma proporción del total, para no inventar una
      // tasa de conversión adicional.
      const propUSD = tusd > 0 ? cobUSD / tusd : 0;
      const cobVES  = tves * propUSD;
      const saldoVES = tves - cobVES;
      const cliente = f.propietarios ? f.propietarios.nombre_completo : '--';
      return '<tr>'
        +'<td style="padding:4px 8px;font-size:10px;font-family:var(--font-mono);color:var(--naranja)">'+(f.numero_factura||'--')+'</td>'
        +'<td style="padding:4px 8px;font-size:11px">'+fmtFecha(f.fecha_emision)+'</td>'
        +'<td style="padding:4px 8px;font-size:11px">'+cliente+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono)">'+((tusd>0||tves>0)?fmtMonto(tusd,tves):'--')+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono)">'+((cobUSD>0||cobVES>0)?fmtMonto(cobUSD,cobVES):'--')+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono);color:'+(saldoUSD>0?'#fc8181':'#22c55e')+'">'+((tusd>0||tves>0)?fmtMonto(saldoUSD,saldoVES):'--')+'</td>'
        +'<td style="padding:4px 8px">'+(f.fecha_pago?fmtFecha(f.fecha_pago):'--')+'</td>'+'<td style="padding:4px 8px">'+(eb[f.estado]||f.estado)+'</td>'
        +'</tr>';
    }).join('');

    const hoyCxc = new Date().toISOString().split('T')[0];
    cont.innerHTML =
      contSelectorMoneda(hoyCxc) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:12px 0 20px">'
      +'<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:8px;padding:14px">'
      +'<div style="font-size:10px;color:var(--suave)">PENDIENTE</div>'
      +'<div style="font-size:18px;color:var(--naranja);font-weight:700;font-family:var(--font-mono)">'+fmtMonto(totPend,totPend)+'</div>'
      +'<div style="font-size:11px;color:var(--suave)">'+pendientes.length+' facturas</div></div>'
      +'<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px">'
      +'<div style="font-size:10px;color:var(--suave)">COBRADO</div>'
      +'<div style="font-size:18px;color:#22c55e;font-weight:700;font-family:var(--font-mono)">'+fmtMonto(totCob,totCob)+'</div>'
      +'<div style="font-size:11px;color:var(--suave)">'+cobradas.length+' facturas</div></div></div>'
      +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="border-bottom:2px solid var(--borde)">'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:left">N° Factura</th>'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:left">Fecha</th>'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:left">Cliente</th>'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:right">Total</th>'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:right">Cobrado</th>'
      +'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:right">Saldo</th>'
      +'<th style="padding:6px 8px;font-size:10px;color:var(--suave);text-align:left">Cancelado</th>'+'<th style="padding:4px 8px;font-size:11px;color:var(--suave);text-align:left">Estado</th>'
      +'</tr></thead><tbody>'
      +(filas||'<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--suave)">Sin facturas registradas.</td></tr>')
      +'</tbody></table></div>';
  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>';
  }
}


async function contRenderCxp() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  // Leer filtro ANTES de destruir el DOM
  const filtroEstado = document.getElementById('cxp-filtro-estado')?.value || '';
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    let q = '?id_empresa=eq.'+id_emisor+'&order=numero_doc.desc&select=*,proveedores:id_proveedor(nombre,rif)';
    if (filtroEstado) q += '&estado=eq.'+filtroEstado;
    const cxps = await api('cont_cxp','GET',null,q) || [];
    // Ordenar por la misma fecha que se muestra (vencimiento si pendiente,
    // pago si ya se pagó), ascendente
    cxps.sort(function(a,b) {
      const fa = (a.estado === 'PAGADA' ? a.fecha_pago : a.fecha_vencimiento) || a.fecha_emision || '';
      const fb = (b.estado === 'PAGADA' ? b.fecha_pago : b.fecha_vencimiento) || b.fecha_emision || '';
      return String(fa).localeCompare(String(fb));
    });

    const monedaPrincipal = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const usandoVES = (_contMoneda || monedaPrincipal) === 'VES';
    const hoy = new Date().toISOString().split('T')[0];
    const tasaHoy = usandoVES ? await contGetTasa(hoy) : null;
    const fmtMonto = function(usd, ves) {
      if (!usandoVES) return '$ ' + fmtUSD(usd || 0);
      // Monto original: usar el VES ya guardado (exacto, a su propia tasa)
      if (ves !== undefined && ves !== null) return 'Bs ' + fmtBs(ves);
      // Pagado/Saldo: no se guarda en VES por cuota — aproximar con la tasa de hoy
      return 'Bs ' + fmtBs((usd || 0) * (tasaHoy || 1));
    };

    const estadoColor = { PENDIENTE:'#f59e0b', PAGADA:'#22c55e', ANULADA:'#6b7280', PARCIAL:'#60a5fa' };
    const filas = cxps.map(function(c) {
      const prov = c.proveedores ? c.proveedores.nombre : '—';
      const est  = c.estado || 'PENDIENTE';
      const badge = '<span style="background:'+( estadoColor[est]||'#888')+'22;color:'+(estadoColor[est]||'#888')+';border:1px solid '+(estadoColor[est]||'#888')+'44;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600">'+est+'</span>';
      const acciones = ''; // Gestión de pagos en módulo Pagos
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:8px;font-size:11px;color:var(--naranja);font-family:var(--font-mono)">'+c.numero_doc+'</td>'
        +'<td style="padding:8px;font-size:12px">'+prov+'</td>'
        +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+fmtFecha(est === 'PAGADA' ? c.fecha_pago : c.fecha_vencimiento)+'</td>'
        +'<td style="padding:8px;font-size:12px;color:var(--suave)">'+( c.tipo||'').replace('_',' ')+'</td>'
        +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#fc8181">'+fmtMonto(c.monto_usd, c.monto_ves)+'</td>'
        +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);color:#22c55e">'+fmtMonto(c.pagado_usd||0)+'</td>'
        +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);font-weight:700">'+fmtMonto(c.saldo_usd||0)+'</td>'
        +'<td style="padding:8px;text-align:center">'+badge+'</td>'
        
        +'</tr>';
    }).join('');

    const totalPendiente = cxps.filter(function(c){ return c.estado==='PENDIENTE'; })
      .reduce(function(s,c){ return s + parseFloat(c.saldo_usd||0); }, 0);

    cont.innerHTML =
      contSelectorMoneda(hoy) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
      +'<h3 style="margin:0">Cuentas por Pagar</h3>'
      +'<div style="display:flex;align-items:center;gap:10px">'
      +'<select id="cxp-filtro-estado" onchange="contRenderCxp()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:6px 10px;border-radius:5px;outline:none">'
      +'<option value="">Todos</option>'
      +'<option value="PENDIENTE"'+(filtroEstado==='PENDIENTE'?' selected':'')+'>Pendiente</option>'
      +'<option value="PAGADA"'+(filtroEstado==='PAGADA'?' selected':'')+'>Pagada</option>'
      +'<option value="PARCIAL"'+(filtroEstado==='PARCIAL'?' selected':'')+'>Parcial</option>'
      +'<option value="ANULADA"'+(filtroEstado==='ANULADA'?' selected':'')+'>Anulada</option>'
      +'</select>'
      +'<div style="font-size:12px;color:#f59e0b;font-weight:600">Saldo Pendiente: '+fmtMonto(totalPendiente)+'</div>'
      +'</div></div>'
      +(filas
        ? '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">N° Doc</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Proveedor</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Fecha</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:left">Tipo</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:right">Monto</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:right">Pagado</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:right">Saldo</th>'
          +'<th style="padding:8px;font-size:11px;color:var(--suave);text-align:center">Estado</th>'
          
          +'</tr></thead><tbody>'+filas+'</tbody></table></div>'
        : '<div style="text-align:center;color:var(--suave);padding:40px">Sin registros de CxP.</div>');
  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+e.message+'</div>';
  }
}

async function contAnularCxP(id_cxp) {
  if (!confirm('¿Anular esta Cuenta por Pagar?')) return;
  try {
    await api('cont_cxp','PATCH',{ estado: 'ANULADA' },'?id_cxp=eq.'+id_cxp);
    contRenderCxp();
  } catch(e) { alert('Error: '+e.message); }
}

async function contPagarCxP(id_cxp) {
  const montoPago = parseFloat(prompt('Ingrese el monto a pagar en USD:'));
  if (!montoPago || montoPago <= 0) return;
  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=*');
    if (!rows || !rows[0]) return;
    const c = rows[0];
    const nuevoPagado = parseFloat(c.pagado_usd||0) + montoPago;
    const nuevoSaldo  = parseFloat(c.monto_usd||0) - nuevoPagado;
    const nuevoEstado = nuevoSaldo <= 0 ? 'PAGADA' : 'PARCIAL';
    await api('cont_cxp','PATCH',{
      pagado_usd: parseFloat(nuevoPagado.toFixed(2)),
      saldo_usd:  parseFloat(Math.max(0, nuevoSaldo).toFixed(2)),
      estado:     nuevoEstado
    },'?id_cxp=eq.'+id_cxp);
    contRenderCxp();
  } catch(e) { alert('Error: '+e.message); }
}

async function contRenderConciliacion() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  const cuentasBanco = contCuentasCache.filter(function(c){ return c.permite_movimiento && (c.codigo.startsWith('1.1.01') ); });
  const hoy = new Date().toISOString().split('T')[0];
  cont.innerHTML = contSelectorMoneda(hoy) +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
    + '<h3 style="margin:0">Conciliación Bancaria</h3>'
    + '<button class="btn-primario" onclick="contNuevaConciliacion()">+ Nueva Conciliación</button>'
    + '</div>'
    + '<div style="background:var(--gris2);border-radius:8px;padding:20px;text-align:center;color:var(--suave)">'
    + '<div style="font-size:32px;margin-bottom:8px">🏦</div>'
    + '<div>Selecciona una cuenta bancaria y período para iniciar la conciliación.</div>'
    + '<div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'
    + '<select id="cont-conc-cuenta" style="' + contSelStyle() + ';width:280px">'
    + '<option value="">— Cuenta Bancaria —</option>'
    + cuentasBanco.map(function(c){ return '<option value="' + c.id_cuenta + '">' + c.codigo + ' — ' + c.nombre + '</option>'; }).join('')
    + '</select>'
    + '<input type="month" id="cont-conc-mes" value="' + getHoyVzla().substring(0,7) + '" style="' + contSelStyle() + '">'
    + '<button class="btn-primario" onclick="contIniciarConciliacion()">Iniciar</button>'
    + '</div></div>';
}

async function contIniciarConciliacion() {
  const id_cuenta = document.getElementById('cont-conc-cuenta').value;
  const mes      = document.getElementById('cont-conc-mes').value;
  if (!id_cuenta || !mes) { alert('Selecciona cuenta y período.'); return; }
  const cuenta   = contCuentasCache.find(function(c){ return c.id_cuenta == id_cuenta; });
  const desde    = mes + '-01';
  const hasta    = new Date(mes + '-01');
  hasta.setMonth(hasta.getMonth()+1); hasta.setDate(0);
  const hastaStr = hasta.toISOString().split('T')[0];

  const lineas = await api('cont_asiento_lineas','GET',null,
    '?id_cuenta=eq.' + id_cuenta
    + '&cont_asientos.id_empresa=eq.'+(_empresaActiva?.id_empresa||0)
    + '&select=*,cont_asientos!inner(fecha,numero_asiento,descripcion,estado)'
    + '&cont_asientos.estado=eq.APROBADO'
    + '&cont_asientos.fecha=gte.' + desde
    + '&cont_asientos.fecha=lte.' + hastaStr
    + '&order=id_linea.asc');

  const cont = document.getElementById('cont-vista-cont');
  let saldoLibros = 0;
  const filas = lineas.map(function(l) {
    const d = parseFloat(l.debe_usd||0); const h = parseFloat(l.haber_usd||0);
    saldoLibros += cuenta && cuenta.naturaleza==='DEUDORA' ? (d-h) : (h-d);
    return '<tr>'
      + '<td style="padding:6px;font-size:12px">' + (l.cont_asientos ? l.cont_asientos.fecha : '') + '</td>'
      + '<td style="padding:6px;font-size:12px;font-family:var(--font-mono);color:var(--naranja)">' + (l.cont_asientos ? l.cont_asientos.numero_asiento : '') + '</td>'
      + '<td style="padding:6px;font-size:12px">' + (l.descripcion || (l.cont_asientos ? l.cont_asientos.descripcion : '')) + '</td>'
      + '<td style="text-align:right;padding:6px;font-family:var(--font-mono);color:#22c55e">' + (l.debe_usd>0?fmtUSD(l.debe_usd):'—') + '</td>'
      + '<td style="text-align:right;padding:6px;font-family:var(--font-mono);color:#fc8181">' + (l.haber_usd>0?fmtUSD(l.haber_usd):'—') + '</td>'
      + '<td style="text-align:right;padding:6px;font-family:var(--font-mono)">' + (saldoLibros>=0?'':'- ') + '$ ' + fmtUSD(Math.abs(saldoLibros)) + '</td>'
      + '</tr>';
  });

  cont.querySelector('#cont-conc-cuenta') && (cont.innerHTML = cont.innerHTML); // refresh

  cont.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0">Conciliación: ' + (cuenta ? cuenta.nombre : '') + ' · ' + mes + '</h3>'
    + '<button class="btn-secundario" onclick="contRenderConciliacion()">← Volver</button></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
    + '<div style="background:var(--gris2);border-radius:8px;padding:16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Saldo en Libros</div>'
    + '<div style="font-family:var(--font-display);font-size:24px;color:var(--naranja)">$ ' + fmtUSD(saldoLibros) + '</div></div>'
    + '<div style="background:var(--gris2);border-radius:8px;padding:16px">'
    + '<div style="font-size:10px;color:var(--suave);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Saldo Banco (ingresa manualmente)</div>'
    + '<input type="number" id="cont-conc-saldo-banco" placeholder="0.00" step="0.01" style="width:100%;background:var(--gris3);border:1px solid var(--naranja);color:var(--naranja);font-family:var(--font-display);font-size:22px;padding:8px 12px;border-radius:5px;outline:none;font-weight:700" onchange="contActualizarDiferencia(' + saldoLibros + ')">'
    + '<div id="cont-conc-dif" style="margin-top:6px;font-size:12px;color:var(--suave)">Diferencia: —</div>'
    + '</div></div>'
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Fecha</th><th>Asiento</th><th>Descripción</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo Acum.</th>'
    + '</tr></thead><tbody>'
    + (filas.length ? filas.join('') : '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--suave)">Sin movimientos en este período.</td></tr>')
    + '</tbody></table></div>';
}

function contActualizarDiferencia(saldoLibros) {
  const banco = parseFloat(document.getElementById('cont-conc-saldo-banco').value)||0;
  const diff  = banco - saldoLibros;
  const el    = document.getElementById('cont-conc-dif');
  if (el) el.innerHTML = 'Diferencia: <span style="font-family:var(--font-mono);color:' + (Math.abs(diff)<0.01?'#22c55e':'#fc8181') + ';font-weight:700">'
    + (Math.abs(diff)<0.01 ? '✓ Conciliado' : '$ ' + fmtUSD(Math.abs(diff)) + (diff<0?' (déficit)':' (superávit)')) + '</span>';
}

// ══════════════════════════════════════════════════════════════
//  PLAN DE CUENTAS
// ══════════════════════════════════════════════════════════════
async function contRenderCuentas(filtro) {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  await contCargarCuentas();
  const hayFiltro = filtro && filtro.trim().length > 0;
  const items = hayFiltro
    ? contCuentasCache.filter(function(c){ return c.nombre.toLowerCase().includes(filtro.toLowerCase()) || c.codigo.includes(filtro); })
    : contCuentasCache;

  const tipoBadge = { ACTIVO:'badge-verde', PASIVO:'badge-rojo', PATRIMONIO:'badge-naranja', INGRESO:'badge-verde', EGRESO:'badge-rojo' };

  const hoy = new Date().toISOString().split('T')[0];
  cont.innerHTML = contSelectorMoneda(hoy) +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
    + '<h3 style="margin:0">Plan de Cuentas VEN-NIF</h3>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<input type="text" placeholder="Buscar código o nombre..." value="' + (filtro||'') + '" oninput="contRenderCuentas(this.value)" style="' + contSelStyle() + ';width:240px">'
    + (puedo('CONTABILIDAD','PLAN_CUENTAS') ? '<button class="btn-primario" onclick="contAbrirCuenta(null)">+ Nueva Cuenta</button>' : '')
    + '</div></div>'
    + '<div class="tabla-container"><table style="width:100%"><thead><tr>'
    + '<th style="width:160px">Código</th><th>Nombre</th><th style="width:110px">Tipo</th>'
    + '<th style="width:100px">Naturaleza</th><th style="width:60px;text-align:center">Nivel</th>'
    + '<th style="width:80px;text-align:center">Mov.</th>'
    + (puedo('CONTABILIDAD','PLAN_CUENTAS') ? '<th style="width:60px"></th>' : '')
    + '</tr></thead><tbody>'
    + items.map(function(c) {
        const indent   = (c.nivel - 1) * 16;
        const esGrupo  = c.nivel <= 2;
        const esSubGrp = c.nivel === 3;
        const bgRow    = esGrupo ? 'background:rgba(255,107,0,0.06);' : (esSubGrp ? 'background:rgba(255,255,255,0.02);' : '');
        return '<tr style="' + bgRow + '">'
          + '<td style="font-family:var(--font-mono);font-size:12px;padding:6px 8px;'
          + 'color:' + (esGrupo ? 'var(--naranja)' : esSubGrp ? 'var(--texto)' : 'var(--suave)') + ';'
          + 'font-weight:' + (esGrupo ? '700' : esSubGrp ? '600' : '400') + '">'
          + c.codigo + '</td>'
          + '<td style="padding:6px 8px;padding-left:' + (8 + indent) + 'px;'
          + 'font-weight:' + (esGrupo ? '700' : esSubGrp ? '600' : '400') + ';'
          + 'font-size:' + (esGrupo ? '13px' : '12px') + '">'
          + (esGrupo ? '▌ ' : esSubGrp ? '├ ' : '  └ ') + c.nombre + '</td>'
          + '<td style="padding:6px 8px">'
          + (esGrupo ? '<span class="badge ' + (tipoBadge[c.tipo]||'badge-gris') + '" style="font-size:10px">' + c.tipo + '</span>' : '')
          + '</td>'
          + '<td style="padding:6px 8px;font-size:11px;color:var(--suave)">' + (c.nivel >= 3 ? c.naturaleza : '') + '</td>'
          + '<td style="text-align:center;padding:6px 8px;font-size:11px;color:var(--suave)">' + c.nivel + '</td>'
          + '<td style="text-align:center;padding:6px 8px">'
          + (c.permite_movimiento ? '<span style="color:#22c55e;font-size:13px">✓</span>' : '<span style="color:var(--suave);font-size:11px">—</span>')
          + '</td>'
          + (puedo('CONTABILIDAD','PLAN_CUENTAS')
              ? '<td style="padding:4px 8px"><button class="btn-secundario" style="font-size:11px;padding:3px 8px" onclick="contAbrirCuenta(' + c.id_cuenta + ')">Ver</button></td>'
              : '')
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

async function contAbrirCuenta(id) {
  // Asegurar cache actualizado
  if (!contCuentasCache.length) await contCargarCuentas();
  const c = id ? contCuentasCache.find(function(x){ return x.id_cuenta===id; }) : null;
  // Padres organizados jerárquicamente
  const padres = contCuentasCache.filter(function(x){ return !x.permite_movimiento; });
  let optsP = '<option value="">— Sin cuenta padre —</option>';
  padres.forEach(function(p) {
    const indent = '  '.repeat(p.nivel - 1);
    optsP += '<option value="' + p.id_cuenta + '"' + (c && c.id_cuenta_padre===p.id_cuenta?' selected':'') + '>'
      + indent + p.codigo + ' — ' + p.nombre + '</option>';
  });
  document.getElementById('cont-cuenta-padre').innerHTML = optsP;
  document.getElementById('cont-cuenta-id').value     = c ? c.id_cuenta : '';
  document.getElementById('cont-cuenta-codigo').value = c ? c.codigo    : '';
  document.getElementById('cont-cuenta-nombre').value = c ? c.nombre    : '';
  document.getElementById('cont-cuenta-tipo').value   = c ? c.tipo      : 'ACTIVO';
  document.getElementById('cont-cuenta-nat').value    = c ? c.naturaleza: 'DEUDORA';
  document.getElementById('cont-cuenta-nivel').value  = c ? c.nivel     : '4';
  document.getElementById('cont-cuenta-mov').checked  = c ? c.permite_movimiento : true;
  document.getElementById('alerta-cuenta-ok').style.display  = 'none';
  document.getElementById('alerta-cuenta-err').style.display = 'none';
  const btnElimCuenta = document.getElementById('cont-cuenta-btn-eliminar');
  if (btnElimCuenta) btnElimCuenta.style.display = id ? '' : 'none';
  abrirModal('modal-cont-cuenta');
  focusFirstField('modal-cont-cuenta');
}

// Sugerir código automático al seleccionar padre
function contSugerirCodigo() {
  const idPadre = parseInt(document.getElementById('cont-cuenta-padre').value)||null;
  if (!idPadre) return;
  const padre = contCuentasCache.find(function(x){ return x.id_cuenta===idPadre; });
  if (!padre) return;

  // Actualizar tipo y naturaleza según el padre
  document.getElementById('cont-cuenta-tipo').value  = padre.tipo;
  document.getElementById('cont-cuenta-nat').value   = padre.naturaleza;
  document.getElementById('cont-cuenta-nivel').value = (padre.nivel + 1);

  // Buscar hijos del padre para sugerir siguiente código
  const hijos = contCuentasCache.filter(function(x){ return x.id_cuenta_padre === idPadre; });
  if (hijos.length === 0) {
    // Primer hijo: codigo_padre.001
    document.getElementById('cont-cuenta-codigo').value = padre.codigo + '.001';
  } else {
    // Encontrar el mayor número y sumar 1
    const ultimos = hijos.map(function(h){
      const partes = h.codigo.split('.');
      return parseInt(partes[partes.length-1]) || 0;
    });
    const siguiente = Math.max.apply(null, ultimos) + 1;
    document.getElementById('cont-cuenta-codigo').value = padre.codigo + '.' + String(siguiente).padStart(3,'0');
  }
}

async function contEliminarCuenta() {
  const id = document.getElementById('cont-cuenta-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta cuenta del Plan de Cuentas? Esta acción no se puede deshacer.')) return;
  try {
    await api('cont_cuentas','DELETE',null,'?id_cuenta=eq.'+id);
    cerrarModal('modal-cont-cuenta');
    await contCargarCuentas();
    contCuentasCache = [];
    contRenderCuentas();
  } catch(e) { alert('Error al eliminar: '+e.message); }
}

async function contGuardarCuenta() {
  const id     = document.getElementById('cont-cuenta-id').value;
  const codigo = document.getElementById('cont-cuenta-codigo').value.trim();
  const nombre = document.getElementById('cont-cuenta-nombre').value.trim();
  const tipo   = document.getElementById('cont-cuenta-tipo').value;
  const nat    = document.getElementById('cont-cuenta-nat').value;
  const nivel  = parseInt(document.getElementById('cont-cuenta-nivel').value)||4;
  const mov    = document.getElementById('cont-cuenta-mov').checked;
  const padre  = parseInt(document.getElementById('cont-cuenta-padre').value)||null;
  const okEl   = document.getElementById('alerta-cuenta-ok');
  const errEl  = document.getElementById('alerta-cuenta-err');
  okEl.style.display='none'; errEl.style.display='none';
  if (!codigo || !nombre) { errEl.textContent='Código y nombre son obligatorios.'; errEl.style.display='block'; return; }
  try {
    const datos = { codigo, nombre, tipo, naturaleza: nat, nivel, permite_movimiento: mov, id_cuenta_padre: padre, id_usuario: sesionActual.correo_usuario };
    if (id) { await api('cont_cuentas','PATCH',datos,'?id_cuenta=eq.'+id); }
    else    { await api('cont_cuentas','POST',datos); }
    okEl.textContent='✓ Cuenta guardada.'; okEl.style.display='block';
    contCuentasCache = [];
    setTimeout(function(){ cerrarModal('modal-cont-cuenta'); contRenderCuentas(); }, 900);
  } catch(e) { errEl.textContent='Error: ' + e.message; errEl.style.display='block'; }
}

// ══════════════════════════════════════════════════════════════
//  PERÍODOS CONTABLES
// ══════════════════════════════════════════════════════════════
async function contRenderPeriodos() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  await contCargarPeriodos();
  cont.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<h3 style="margin:0">Períodos Contables</h3>'
    + '<button class="btn-primario" onclick="contAbrirPeriodo(null)">+ Nuevo Período</button>'
    + '</div>'
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Período</th><th>Fecha Inicio</th><th>Fecha Fin</th><th>Estado</th><th>Acción</th>'
    + '</tr></thead><tbody>'
    + contPeriodosCache.map(function(p) {
        return '<tr>'
          + '<td style="font-weight:600">' + p.nombre + '</td>'
          + '<td style="font-size:12px">' + fmtFecha(p.fecha_inicio) + '</td>'
          + '<td style="font-size:12px">' + fmtFecha(p.fecha_fin) + '</td>'
          + '<td><span class="badge ' + (p.estado==='ABIERTO'?'badge-verde':'badge-gris') + '">' + p.estado + '</span></td>'
          + '<td><div style="display:flex;gap:6px">'
          + (p.estado==='ABIERTO' ? '<button class="btn-secundario" style="font-size:11px;color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="contCerrarPeriodo(' + p.id_periodo + ',\'' + p.nombre + '\')">🔒 Cerrar</button>' : '')
          + '<button class="btn-secundario" style="font-size:11px" onclick="contAbrirPeriodo(' + p.id_periodo + ')">✏</button>'
          + '</div></td></tr>';
      }).join('')
    + '</tbody></table></div>';
}

async function contAbrirPeriodo(id) {
  const p = id ? contPeriodosCache.find(function(x){ return x.id_periodo===id; }) : null;
  document.getElementById('cont-per-id').value     = p ? p.id_periodo   : '';
  document.getElementById('cont-per-nombre').value = p ? p.nombre       : '';
  document.getElementById('cont-per-desde').value  = p ? p.fecha_inicio : '';
  document.getElementById('cont-per-hasta').value  = p ? p.fecha_fin    : '';
  document.getElementById('alerta-per-ok').style.display  = 'none';
  document.getElementById('alerta-per-err').style.display = 'none';
  abrirModal('modal-cont-periodo');
  focusFirstField('modal-cont-periodo');
}

async function contGuardarPeriodo() {
  const id     = document.getElementById('cont-per-id').value;
  const nombre = document.getElementById('cont-per-nombre').value.trim();
  const desde  = document.getElementById('cont-per-desde').value;
  const hasta  = document.getElementById('cont-per-hasta').value;
  const okEl   = document.getElementById('alerta-per-ok');
  const errEl  = document.getElementById('alerta-per-err');
  okEl.style.display='none'; errEl.style.display='none';
  if (!nombre||!desde||!hasta) { errEl.textContent='Todos los campos son obligatorios.'; errEl.style.display='block'; return; }
  try {
    const datos = { nombre, fecha_inicio: desde, fecha_fin: hasta, estado:'ABIERTO', id_usuario: sesionActual.correo_usuario };
    if (id) { await api('cont_periodos','PATCH',datos,'?id_periodo=eq.'+id); }
    else    { await api('cont_periodos','POST',datos); }
    okEl.textContent='✓ Período guardado.'; okEl.style.display='block';
    setTimeout(function(){ cerrarModal('modal-cont-periodo'); contRenderPeriodos(); }, 900);
  } catch(e) { errEl.textContent='Error: ' + e.message; errEl.style.display='block'; }
}

async function contCerrarPeriodo(id, nombre) {
  if (!confirm('¿Cerrar el período "' + nombre + '"?\nNo se podrán crear asientos en este período una vez cerrado.')) return;
  try {
    await api('cont_periodos','PATCH',{ estado:'CERRADO' },'?id_periodo=eq.'+id);
    contRenderPeriodos();
  } catch(e) { alert('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════
//  MÓDULO TRIBUTOS EN PARÁMETROS
// ══════════════════════════════════════════════════════════════
let _tributosCache = [];

async function renderTributos() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('TRIBUTOS')) {
    document.getElementById('contenido-principal').innerHTML =
      '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  // Usar contenido-principal como contenedor
  const cont = document.getElementById('contenido-principal');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando tributos...</div>';
  try {
    _tributosCache = await api('param_tributos','GET',null,'?order=nivel_gobierno.asc,codigo.asc&select=*');
    const tiposUnicos = _tributosCache.map(function(t){ return t.tipo; })
      .filter(function(v,i,a){ return v && a.indexOf(v)===i; }).sort();
    cont.innerHTML =
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
      + '<div style="font-family:var(--font-display);font-size:20px;letter-spacing:1px">📋 Tributos</div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<input type="text" id="tributos-input-buscar" placeholder="Buscar tributo..." oninput="renderTablaTributos(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + '<select id="tributos-filtro-nivel" onchange="renderTablaTributosNivel(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none">'
      + '<option value="">Todos los niveles</option>'
      + '<option value="NACIONAL">Nacional</option>'
      + '<option value="ESTADAL">Estadal</option>'
      + '<option value="MUNICIPAL">Municipal</option>'
      + '</select>'
      + '<select id="tributos-filtro-tipo" onchange="renderTablaTributosTipo(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none">'
      + '<option value="">Todos los tipos</option>'
      + tiposUnicos.map(function(t){ const lbl={'DEBITO':'Impuesto','CONTRIBUCION':'Contribución','TIMBRE':'Timbre Fiscal','RETENCION':'Retención'}; return '<option value="'+t+'">'+(lbl[t]||t)+'</option>'; }).join('')
      + '</select>'
      + (puedo('TRIBUTOS','CREAR') ? '<button class="btn-primario" onclick="abrirFormTributo(null)" style="font-size:12px">+ Nuevo Tributo</button>' : '')
      + '</div></div>'
      + tributosAlerta()
      + '<div class="tabla-container"><table style="table-layout:fixed;width:100%">'
      + '<thead><tr>'
      + '<th style="width:9%;font-size:9px">Código</th>'
      + '<th style="font-size:9px">Nombre / Organismo</th>'
      + '<th style="width:10%;font-size:9px">Nivel</th>'
      + '<th style="width:10%;font-size:9px">Tipo</th>'
      + '<th style="width:11%;font-size:9px">Periodicidad</th>'
      + '<th style="width:10%;text-align:right;font-size:9px">Alícuota %</th>'
      + '<th style="width:10%;font-size:9px">Ult. Revisión</th>'
      + '<th style="width:8%;font-size:9px">Estado</th>'
      + '<th style="width:8%;text-align:center;font-size:9px">Acción</th>'
      + '</tr></thead><tbody id="tributos-tbody"></tbody></table></div>';
    window._tributosTextoFiltro = '';
    window._tributosTipoFiltro  = '';
    window._tributosNivelFiltro = '';
    renderTablaTributos();
  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando tributos: ' + e.message + '</div>';
  }
}

async function mostrarTablaParamTributos() {
  _paramTabActivo = 'tributos';

  // Resaltar tab activo
  document.querySelectorAll('.param-tab').forEach(function(b) {
    b.style.background  = '';
    b.style.color       = '';
    b.style.borderColor = '';
  });
  const tabBtn = document.getElementById('tab-tributos');
  if (tabBtn) { tabBtn.style.background = 'var(--naranja)'; tabBtn.style.color = '#fff'; tabBtn.style.borderColor = 'var(--naranja)'; }

  const cont = document.getElementById('param-tabla-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando tributos...</div>';

  try {
    _tributosCache = await api('param_tributos','GET',null,'?order=nivel_gobierno.asc,codigo.asc&select=*');

    const tiposUnicos = _tributosCache.map(function(t){ return t.tipo; })
      .filter(function(v,i,a){ return v && a.indexOf(v)===i; }).sort();

    cont.innerHTML =
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
      + '<div style="font-family:var(--font-display);font-size:20px;letter-spacing:1px">🧾 Tributos del Sistema</div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<input type="text" id="tributos-input-buscar" placeholder="Buscar tributo..." oninput="renderTablaTributos(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + '<select id="tributos-filtro-nivel" onchange="renderTablaTributosNivel(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none">'
      + '<option value="">Todos los niveles</option>'
      + '<option value="NACIONAL">Nacional</option>'
      + '<option value="ESTADAL">Estadal</option>'
      + '<option value="MUNICIPAL">Municipal</option>'
      + '</select>'
      + '<select id="tributos-filtro-tipo" onchange="renderTablaTributosTipo(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none">'
      + '<option value="">Todos los tipos</option>'
      + tiposUnicos.map(function(t){ const lbl={'DEBITO':'Impuesto','CONTRIBUCION':'Contribución','TIMBRE':'Timbre Fiscal','RETENCION':'Retención'}; return '<option value="'+t+'">'+(lbl[t]||t)+'</option>'; }).join('')
      + '</select>'
      + (puedo('TRIBUTOS','CREAR') ? '<button class="btn-primario" onclick="abrirFormTributo(null)" style="font-size:12px">+ Nuevo Tributo</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Código</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Nombre / Organismo</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Nivel</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Tipo</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Periodicidad</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:right">Alícuota %</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Ult. Revisión</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Estado</th>'
      + '<th style="padding:10px 14px;font-size:11px;color:var(--suave);text-align:left">Acción</th>'
      + '</tr></thead><tbody id="tributos-tbody"></tbody></table></div>';

    window._tributosTextoFiltro = '';
    window._tributosTipoFiltro  = '';
    window._tributosNivelFiltro = '';
    renderTablaTributos();
  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function renderTablaTributos(filtro) {
  // Actualizar filtro de texto
  if (filtro !== undefined) window._tributosTextoFiltro = filtro;
  const txtFiltro = window._tributosTextoFiltro || '';
  const nivel     = window._tributosNivelFiltro || '';
  const tipo      = window._tributosTipoFiltro  || '';

  // Aplicar filtros
  let base = _tributosCache;
  if (nivel) base = base.filter(function(t){ return t.nivel_gobierno === nivel; });
  if (tipo)  base = base.filter(function(t){ return t.tipo === tipo; });
  if (txtFiltro) {
    const q = txtFiltro.toLowerCase();
    base = base.filter(function(t){
      return (t.nombre||'').toLowerCase().includes(q)
          || (t.codigo||'').toLowerCase().includes(q)
          || (t.organismo||'').toLowerCase().includes(q);
    });
  }

  const nivColores  = { NACIONAL:'badge-naranja', ESTADAL:'badge-azul', MUNICIPAL:'badge-verde' };
  const tipColores  = { IMPUESTO:'badge-rojo', DEBITO:'badge-rojo', RETENCION:'badge-naranja', CONTRIBUCION:'badge-verde', TIMBRE:'badge-gris' };
  const tipEtiqueta = { IMPUESTO:'Impuesto', DEBITO:'Impuesto', RETENCION:'Retención', CONTRIBUCION:'Contribución', TIMBRE:'Timbre Fiscal' };

  // Si ya existe el tbody, solo actualizarlo
  const tbody = document.getElementById('tributos-tbody');
  if (tbody) {
    tbody.innerHTML = base.length ? base.map(function(t) {
      const alicuotaStr = t.alicuota_min && t.alicuota_max && t.alicuota_min !== t.alicuota_max
        ? t.alicuota_min + '% — ' + t.alicuota_max + '%'
        : (parseFloat(t.alicuota) > 0 ? parseFloat(t.alicuota).toFixed(2) + '%' : 'Variable');
      return '<tr>'
        + '<td style="padding:10px 14px;font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--naranja)">' + t.codigo + '</td>'
        + '<td style="padding:10px 14px;font-size:10px"><div style="font-weight:600">' + t.nombre + '</div>'
        + '<div style="font-size:9px;color:var(--suave)">' + (t.organismo||'') + '</div>'
        + (t.base_legal ? '<div style="font-size:10px;color:var(--suave)">' + t.base_legal + '</div>' : '')
        + '</td>'
        + '<td style="padding:10px 14px;font-size:10px"><span class="badge ' + (nivColores[t.nivel_gobierno]||'badge-gris') + '">' + (t.nivel_gobierno||'—') + '</span></td>'
        + '<td style="padding:10px 14px;font-size:10px"><span class="badge ' + (tipColores[t.tipo]||'badge-gris') + '">' + (tipEtiqueta[t.tipo] || t.tipo || '—') + '</span></td>'
        + '<td style="padding:10px 14px;font-size:10px">' + (t.periodicidad||'—') + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--naranja)">' + alicuotaStr + '</td>'
        + '<td style="padding:10px 14px;font-size:10px">'
        + (function(fecha) {
            if (!fecha) return '<span style="color:#fc8181">Sin revisar</span>';
            const diff = (new Date() - new Date(fecha)) / (1000*60*60*24);
            const color = diff > 180 ? '#fc8181' : diff > 90 ? '#F48C06' : '#22c55e';
            return '<span style="color:' + color + '">' + fmtFecha(fecha) + '</span>';
          })(t.fecha_revision)
        + '</td>'
        + '<td style="padding:10px 14px;font-size:10px">' + (t.estado==='ACTIVO' ? '<span class="badge badge-verde">ACTIVO</span>' : '<span class="badge badge-gris">' + (t.estado||'—') + '</span>') + '</td>'
        + '<td style="padding:10px 14px;text-align:center"><button class="btn-secundario" style="font-size:9px;padding:4px 8px" onclick="abrirFormTributo(' + t.id_tributo + ')">Ver</button>'
        + '</td></tr>';
    }).join('') : '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--suave)">Sin tributos registrados</td></tr>';
    return;
  }

  // Si no existe el tbody, regenerar todo (primera vez)
  const cont = document.getElementById('param-tabla-cont');
  if (!cont) return;
  const tiposUnicos = _tributosCache.map(function(t){ return t.tipo; })
    .filter(function(v,i,a){ return v && a.indexOf(v)===i; }).sort();

  cont.innerHTML = contSelectorMoneda(hoy) +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
    + '<div style="font-family:var(--font-display);font-size:20px;letter-spacing:1px">🧾 Tributos del Sistema</div>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '<input type="text" id="tributos-input-buscar" placeholder="Buscar tributo..." oninput="renderTablaTributos(this.value)" '
    + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:10px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
    + '<select id="tributos-filtro-tipo" onchange="renderTablaTributosTipo(this.value)" '
    + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:10px;padding:8px 10px;border-radius:5px;outline:none">'
    + '<option value="">Todos los tipos</option>'
    + tiposUnicos.map(function(t){ const lbl={'DEBITO':'Impuesto','CONTRIBUCION':'Contribución','TIMBRE':'Timbre Fiscal','RETENCION':'Retención'}; return '<option value="'+t+'">'+(lbl[t]||t)+'</option>'; }).join('')
    + '</select>'
    + '<select id="tributos-filtro-nivel" onchange="renderTablaTributosNivel(this.value)" '
    + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:10px;padding:8px 10px;border-radius:5px;outline:none">'
    + '<option value="">Todos los niveles</option>'
    + '<option value="NACIONAL">Nacional</option>'
    + '<option value="ESTADAL">Estadal</option>'
    + '<option value="MUNICIPAL">Municipal</option>'
    + '</select>'
    + (puedo('TRIBUTOS','CREAR') ? '<button class="btn-primario" onclick="abrirFormTributo(null)" style="font-size:10px">+ Nuevo Tributo</button>' : '')
    + '</div></div>'
    + tributosAlerta()
    + '<div class="tabla-container"><table style="table-layout:fixed;width:100%">'
    +'<thead><tr>'+'<th style="width:9%;font-size:11px">Código</th>'+'<th style="font-size:7px">Nombre / Organismo</th>'+'<th style="width:10%;font-size:7px">Nivel</th>'+'<th style="width:10%;font-size:7px">Tipo</th>'+'<th style="width:11%;font-size:7px">Periodicidad</th>'+'<th style="width:10%;text-align:right;font-size:7px">Alícuota %</th>'+'<th style="width:10%;font-size:7px">Ult. Revisión</th>'+'<th style="width:8%;font-size:7px">Estado</th>'+'<th style="width:8%;text-align:center;font-size:7px">Acción</th>'+'</tr></thead>'
    + '<tbody id="tributos-tbody"></tbody></table></div>';

  renderTablaTributos();
}


function tributosAlerta() {
  const hoy = new Date();
  const viejos = _tributosCache.filter(function(t) {
    if (!t.fecha_revision) return true;
    return (hoy - new Date(t.fecha_revision)) / (1000*60*60*24) > 180;
  });
  if (!viejos.length) return '';
  return '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.3);border-radius:6px;padding:10px 16px;margin-bottom:12px;font-size:12px;display:flex;align-items:center;gap:10px">'
    + '<span style="font-size:18px">⚠️</span>'
    + '<div><strong>' + viejos.length + ' tributo(s)</strong> con más de 6 meses sin revisar. '
    + 'Verifique en la <strong>Gaceta Oficial</strong> si hay cambios en alícuotas.</div></div>';
}

function renderTablaTributosTipo(tipo) {
  window._tributosTipoFiltro = tipo;
  renderTablaTributos(window._tributosTextoFiltro || '');
}

function renderTablaTributosNivel(nivel) {
  window._tributosNivelFiltro = nivel;
  renderTablaTributos(window._tributosTextoFiltro || '');
}



async function toggleEstadoTributo(id, estadoActual) {
  const nuevoEstado = estadoActual === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
  if (!confirm('¿' + (nuevoEstado==='INACTIVO'?'Desactivar':'Activar') + ' este tributo?')) return;
  try {
    await api('param_tributos','PATCH',{ estado: nuevoEstado },'?id_tributo=eq.'+id);
    await mostrarTablaParamTributos();
  } catch(e) { alert('Error: ' + e.message); }
}

async function abrirFormTributo(id) {
  let t = null;
  if (id) {
    t = _tributosCache.find(function(x){ return x.id_tributo === parseInt(id); });
    if (!t) {
      try {
        const res = await api('param_tributos','GET',null,'?id_tributo=eq.'+parseInt(id)+'&select=*');
        t = res[0] || null;
      } catch(e) {}
    }
  }
  document.getElementById('trib-id').value          = t ? t.id_tributo  : '';
  document.getElementById('trib-codigo').value      = t ? t.codigo      : '';
  document.getElementById('trib-nombre').value      = t ? t.nombre      : '';
  document.getElementById('trib-descripcion').value = t ? (t.descripcion||'') : '';
  document.getElementById('trib-nivel').value       = t ? t.nivel_gobierno : 'NACIONAL';
  document.getElementById('trib-tipo').value        = t ? t.tipo        : 'IMPUESTO';
  document.getElementById('trib-organismo').value   = t ? t.organismo   : '';
  document.getElementById('trib-alicuota').value    = t ? parseFloat(t.alicuota||0).toFixed(4) : '0.0000';
  document.getElementById('trib-alicuota-min').value= t ? parseFloat(t.alicuota_min||0).toFixed(4) : '0.0000';
  document.getElementById('trib-alicuota-max').value= t ? parseFloat(t.alicuota_max||0).toFixed(4) : '0.0000';
  document.getElementById('trib-base-legal').value  = t ? (t.base_legal||'') : '';
  document.getElementById('trib-periodicidad').value= t ? (t.periodicidad||'MENSUAL') : 'MENSUAL';
  document.getElementById('trib-es-retencion').checked = t ? t.es_retencion : false;
  document.getElementById('trib-porc-ret').value    = t ? parseFloat(t.porcentaje_retencion||0).toFixed(2) : '0.00';
  document.getElementById('trib-aplica-serv').checked = t ? t.aplica_servicios : true;
  document.getElementById('trib-aplica-bien').checked = t ? t.aplica_bienes    : true;
  document.getElementById('trib-fecha-vigencia').value  = t ? (t.fecha_vigencia||'') : '';
  document.getElementById('trib-lapso-pago').value      = t ? (t.lapso_pago||'') : '';
  document.getElementById('trib-estado').value         = t ? (t.estado||'ACTIVO') : 'ACTIVO';
  document.getElementById('alerta-trib-ok').style.display  = 'none';
  document.getElementById('alerta-trib-err').style.display = 'none';
  const btnElim = document.getElementById('trib-btn-eliminar');
  if (btnElim) btnElim.style.display = id ? '' : 'none';
  const esRet = t ? t.es_retencion : false;
  await cargarCuentasTributo(esRet, t ? t.id_cuenta_contable : null);
  abrirModal('modal-tributo');
}

async function cargarCuentasTributo(esRetencion, id_cuentaActual) {
  const sel = document.getElementById('trib-cuenta-contable');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar cuenta --</option>';
  try {
    const grupos = esRetencion ? ['2.1.02','2.1.03'] : ['6.1.04'];
    const cuentas = await api('cont_cuentas','GET',null,
      '?or=(' + grupos.map(function(g){ return 'codigo.ilike.'+g+'*'; }).join(',') + ')' +
      '&estado=eq.ACTIVA&order=codigo.asc&select=id_cuenta,codigo,nombre');
    cuentas.forEach(function(c) {
      const opt = document.createElement('option');
      opt.value = c.id_cuenta;
      opt.textContent = c.codigo + ' — ' + c.nombre;
      if (id_cuentaActual && parseInt(id_cuentaActual) === c.id_cuenta) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Error cargando cuentas tributo:', e); }
}

async function eliminarTributo() {
  const id = document.getElementById('trib-id').value;
  if (!id) return;
  if (!confirm('¿Está seguro que desea ELIMINAR este tributo? Esta acción no se puede deshacer.')) return;
  try {
    await api('param_tributos','DELETE',null,'?id_tributo=eq.'+id);
    const idGuardado = id || (await api('param_tributos','GET',null,'?order=id_tributo.desc&select=id_tributo&limit=1'))[0]?.id_tributo;
    cerrarModal('modal-tributo');
    _tributosCache = [];
    if (document.getElementById('tributos-tbody')) { await renderTributos(); } else { await mostrarTablaParamTributos(); }
    if (idGuardado) setTimeout(function(){ abrirFormTributo(idGuardado); }, 300);
  } catch(e) { alert('Error al eliminar: '+e.message); }
}

async function guardarTributo() {
  const id          = document.getElementById('trib-id').value;
  const codigo      = document.getElementById('trib-codigo').value.trim().toUpperCase();
  const nombre      = document.getElementById('trib-nombre').value.trim();
  const descripcion = document.getElementById('trib-descripcion').value.trim();
  const nivel       = document.getElementById('trib-nivel').value;
  const tipo        = document.getElementById('trib-tipo').value;
  const organismo   = document.getElementById('trib-organismo').value.trim().toUpperCase();
  const alicuota    = parseFloat(document.getElementById('trib-alicuota').value)||0;
  const alicuotaMin = parseFloat(document.getElementById('trib-alicuota-min').value)||0;
  const alicuotaMax = parseFloat(document.getElementById('trib-alicuota-max').value)||0;
  const baseLegal   = document.getElementById('trib-base-legal').value.trim();
  const periodicidad= document.getElementById('trib-periodicidad').value;
  const esRet       = document.getElementById('trib-es-retencion').checked;
  const porcRet     = parseFloat(document.getElementById('trib-porc-ret').value)||0;
  const apServ      = document.getElementById('trib-aplica-serv').checked;
  const apBien      = document.getElementById('trib-aplica-bien').checked;
  const okEl        = document.getElementById('alerta-trib-ok');
  const errEl       = document.getElementById('alerta-trib-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!codigo || !nombre || !organismo) {
    errEl.textContent = 'Código, nombre y organismo son obligatorios.';
    errEl.style.display = 'block'; return;
  }
  try {
    const datos = { codigo, nombre, descripcion: descripcion||null, nivel_gobierno: nivel, tipo,
      organismo, alicuota, alicuota_min: alicuotaMin, alicuota_max: alicuotaMax,
      base_legal: baseLegal||null, periodicidad, es_retencion: esRet,
      porcentaje_retencion: porcRet, aplica_servicios: apServ, aplica_bienes: apBien,
      estado: document.getElementById('trib-estado').value,
      fecha_revision: new Date().toISOString().split('T')[0],
      revisado_por: sesionActual?.correo_usuario || '',
      fecha_vigencia: document.getElementById('trib-fecha-vigencia').value || null,
      lapso_pago: document.getElementById('trib-lapso-pago').value.trim() || null,
      id_cuenta_contable: parseInt(document.getElementById('trib-cuenta-contable').value) || null };

    const original = id ? _tributosCache.find(function(t){ return String(t.id_tributo) === String(id); }) : null;
    const cambioAlicuota = original && (
      parseFloat(original.alicuota||0)     !== alicuota ||
      parseFloat(original.alicuota_min||0) !== alicuotaMin ||
      parseFloat(original.alicuota_max||0) !== alicuotaMax
    );

    if (id && cambioAlicuota) {
      // La alícuota cambió -- no se sobrescribe el registro (se perdería el
      // histórico de "cuánto era antes y hasta cuándo"). Se desactiva el
      // registro viejo (conserva su alícuota y fecha originales tal cual
      // estaban) y se crea uno nuevo con el valor actualizado.
      await api('param_tributos','PATCH', { estado: 'INACTIVO' }, '?id_tributo=eq.'+id);
      const nuevaFecha = { ...datos, fecha_registro: new Date().toISOString() };
      await api('param_tributos','POST', nuevaFecha);
    } else if (id) {
      // Sin cambio de alícuota -- edición normal (descripción, base legal,
      // etc.), no hace falta versionar nada.
      await api('param_tributos','PATCH',datos,'?id_tributo=eq.'+id);
    } else {
      await api('param_tributos','POST',datos);
    }
    okEl.textContent = '✓ Tributo guardado correctamente.';
    okEl.style.display = 'block';
    cerrarModal('modal-tributo');
    _tributosCache = [];
    if (document.getElementById('tributos-tbody')) { await renderTributos(); } else { await mostrarTablaParamTributos(); }
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
}

// ══════════════════════════════════════════════════════════════
//  ASIENTOS CONTABLES DE INVENTARIO
// ══════════════════════════════════════════════════════════════

async function generarAsientoInventario(tipo, datos) {
  // tipo: 'ENTRADA_COMPRA' | 'ENTRADA_DEVOLUCION' | 'ENTRADA_AJUSTE'
  //       'SALIDA_AREA' | 'SALIDA_AJUSTE'
  // datos: { articulo, cantidad, montoUSD, areaId, areaNombre, proveedor, referencia }
  try {
    // Usar tasa proporcionada, o buscar la de la fecha de negociación
    let tasa = datos.tasa ? parseFloat(datos.tasa) : 0;
    if (!tasa) {
      const fechaBuscar = datos.fecha || getHoyVzla();
      const tasas = await api('tasas','GET',null,'?fecha_valor=lte.' + fechaBuscar + '&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      tasa = tasas.length ? parseFloat(tasas[0].tipo_cambio) : 1;
    }

    const anio = new Date().getFullYear();
    const existAst = await api('cont_asientos','GET',null,'?numero_asiento=like.AST-'+anio+'-*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
    let seq = 1;
    if (existAst.length) { const p = existAst[0].numero_asiento.split('-'); seq = parseInt(p[p.length-1])+1; }
    const numAst = 'AST-'+anio+'-'+String(seq).padStart(4,'0');

    const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
    const id_periodo = periodos.length ? periodos[0].id_periodo : null;

    // Descripción del asiento
    const descripciones = {
      'ENTRADA_COMPRA':     'Compra Inventario: ' + datos.articulo,
      'ENTRADA_DEVOLUCION': 'Devolución a Inventario: ' + datos.articulo,
      'ENTRADA_AJUSTE':     'Ajuste Entrada Inventario: ' + datos.articulo,
      'SALIDA_AREA':        'Salida Inventario → ' + (datos.areaNombre||'Área') + ': ' + datos.articulo,
      'SALIDA_AJUSTE':      'Ajuste Salida Inventario: ' + datos.articulo,

    };

    const asiento = await api('cont_asientos','POST',{
      numero_asiento: numAst,
      fecha:          datos.fecha || getHoyVzla(),
      descripcion:    descripciones[tipo] || 'Movimiento Inventario',
      tipo:           'AUTOMATICO',
      referencia:     datos.referencia || null,
      moneda_base:    ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(),
      tasa_bcv:       tasa,
      id_periodo:     id_periodo,
      id_empresa:      _empresaActiva ? _empresaActiva.id_empresa : null,
      estado:         'APROBADO',
      id_usuario:     sesionActual.correo_usuario
    });

    if (!asiento || !asiento[0]) return;
    const idAst = asiento[0].id_asiento;
    const monto = datos.montoUSD || 0;

    // Buscar cuenta de inventario
    let idInv = datos.id_cuentaInventario || null;
    if (!idInv) { const cInv = await api('cont_cuentas','GET',null,'?codigo=eq.1.1.03.001&select=id_cuenta'); idInv = cInv.length ? cInv[0].id_cuenta : null; }

    // Buscar o crear cuenta auxiliar de área
    let id_areaCuenta = null;
    if (datos.areaId && datos.areaNombre) {
      const codigoArea = '6.1.01.' + String(datos.areaId).padStart(3,'0');
      let cArea = await api('cont_cuentas','GET',null,'?codigo=eq.'+codigoArea+'&select=id_cuenta');
      if (!cArea.length) {
        // Crear cuenta del área automáticamente
        const nuevaCuenta = await api('cont_cuentas','POST',{
          codigo: codigoArea,
          nombre: 'Costo Área — ' + datos.areaNombre,
          tipo: 'EGRESO', naturaleza: 'DEUDOR',
          nivel: 3, permite_movimiento: true, estado: 'ACTIVA'
        });
        cArea = nuevaCuenta || [];
        if (cArea.length) id_areaCuenta = cArea[0].id_cuenta;
        else {
          const reCheck = await api('cont_cuentas','GET',null,'?codigo=eq.'+codigoArea+'&select=id_cuenta');
          if (reCheck.length) id_areaCuenta = reCheck[0].id_cuenta;
        }
      } else {
        id_areaCuenta = cArea[0].id_cuenta;
      }
    }

    // Buscar cuenta de proveedores
    const cProv = await api('cont_cuentas','GET',null,'?codigo=eq.2.1.01.001&select=id_cuenta');
    const idProv = cProv.length ? cProv[0].id_cuenta : null;

    // ── Líneas según tipo ──
    // VEN-NIF: Moneda funcional = Bs. USD es auxiliar de referencia
    const montoBs  = monto * tasa;
    const auxDesc  = monto > 0 ? ' (USD '+fmtUSD(monto)+' × '+tasa.toFixed(4)+')' : '';

    if (tipo === 'ENTRADA_COMPRA') {
      const IVA_RATE   = tasaIVAActual();
      const exentoIVA  = datos.exentoIVA  || false;
      const incluyeIVA = datos.incluyeIVA || false;
      const montoTotalUSD = monto;
      const montoTotalBs  = montoBs;
      // baseExactaUSD/Bs: el mismo costo YA REDONDEADO que se guarda en
      // inventario_almacen.precio_costo_moneda y que usará después la SALIDA
      // para valorar el consumo. Si se provee, la línea de Inventario usa
      // este valor EXACTO (no el derivado del monto total sin redondear),
      // para que Entrada y Salida coincidan centavo a centavo cuando se
      // agote el stock — el IVA/Total se ajustan para seguir cuadrando
      // contra el monto real de la factura.
      const baseExactaUSD = (datos.baseExactaUSD !== undefined && datos.baseExactaUSD !== null) ? datos.baseExactaUSD : null;
      const baseExactaBs  = (datos.baseExactaBs  !== undefined && datos.baseExactaBs  !== null) ? datos.baseExactaBs  : null;

      let baseUSD, ivaUSD, baseBs, ivaBs, totalUSD, totalBs;

      if (exentoIVA) {
        // Sin IVA
        baseUSD = baseExactaUSD !== null ? baseExactaUSD : montoTotalUSD; ivaUSD = 0;
        baseBs  = baseExactaBs  !== null ? baseExactaBs  : montoTotalBs;  ivaBs  = 0;
        totalUSD = baseUSD; totalBs = baseBs;
      } else if (incluyeIVA) {
        // Monto incluye IVA — desglozar (o usar la base exacta ya conocida)
        baseUSD = baseExactaUSD !== null ? baseExactaUSD : parseFloat((montoTotalUSD / (1 + IVA_RATE)).toFixed(4));
        ivaUSD  = parseFloat((montoTotalUSD - baseUSD).toFixed(4));
        baseBs  = baseExactaBs  !== null ? baseExactaBs  : parseFloat((montoTotalBs  / (1 + IVA_RATE)).toFixed(2));
        ivaBs   = parseFloat((montoTotalBs  - baseBs).toFixed(2));
        totalUSD = montoTotalUSD; totalBs = montoTotalBs;
      } else {
        // Monto NO incluye IVA — calcular y sumar (o usar la base exacta)
        baseUSD  = baseExactaUSD !== null ? baseExactaUSD : montoTotalUSD;
        ivaUSD   = parseFloat((baseUSD * IVA_RATE).toFixed(4));
        baseBs   = baseExactaBs  !== null ? baseExactaBs  : montoTotalBs;
        ivaBs    = parseFloat((baseBs  * IVA_RATE).toFixed(2));
        totalUSD = parseFloat((baseUSD + ivaUSD).toFixed(4));
        totalBs  = parseFloat((baseBs  + ivaBs).toFixed(2));
      }

      // Buscar cuenta IVA Crédito Fiscal
      const cIVA = await api('cont_cuentas','GET',null,'?codigo=eq.1.1.04.001&select=id_cuenta&limit=1');
      const idIVA = cIVA.length ? cIVA[0].id_cuenta : null;

      // DEBE: Inventario (base sin IVA)
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:1,
        descripcion: 'Entrada compra ' + datos.articulo + auxDesc,
        debe_usd: baseUSD, haber_usd: 0, debe_ves: baseBs, haber_ves: 0 });

      // DEBE: Crédito Fiscal IVA (solo si aplica)
      if (!exentoIVA && idIVA && ivaUSD > 0) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idIVA, orden:2,
        descripcion: 'IVA (' + Math.round(IVA_RATE*100) + '%) compra ' + datos.articulo,
        debe_usd: ivaUSD, haber_usd: 0, debe_ves: ivaBs, haber_ves: 0 });

      // HABER: CxP Proveedores (monto total con IVA)
      if (idProv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idProv, orden:3,
        descripcion: 'CxP ' + datos.articulo + auxDesc,
        debe_usd: 0, haber_usd: totalUSD, debe_ves: 0, haber_ves: totalBs });

    } else if (tipo === 'ENTRADA_DEVOLUCION' || tipo === 'ENTRADA_AJUSTE') {
      // Débito: Inventario Bs / Crédito: Costo Área Bs
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:1,
        descripcion:'Entrada '+datos.articulo+auxDesc,
        debe_usd:monto, haber_usd:0, debe_ves:montoBs, haber_ves:0 });
      if (id_areaCuenta) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:id_areaCuenta, orden:2,
        descripcion:'Crédito área '+datos.areaNombre+auxDesc,
        debe_usd:0, haber_usd:monto, debe_ves:0, haber_ves:montoBs });

    } else if (tipo === 'SALIDA_AREA' || tipo === 'SALIDA_AJUSTE') {
      // Débito: Costo Área / Crédito: Inventario — en USD y VES
      const montoBsSal = parseFloat((monto * tasa).toFixed(2));
      if (id_areaCuenta) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:id_areaCuenta, orden:1,
        descripcion:'Costo '+datos.areaNombre+' '+datos.articulo+auxDesc,
        debe_usd:monto, haber_usd:0, debe_ves:montoBsSal, haber_ves:0 });
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:2,
        descripcion:'Salida inventario '+datos.articulo+auxDesc,
        debe_usd:0, haber_usd:monto, debe_ves:0, haber_ves:montoBsSal });

    }

    console.log('✓ Asiento inventario creado:', numAst, tipo);
  } catch(eAst) { console.warn('Error asiento inventario:', eAst); }
}

// ══════════════════════════════════════════════════════════════
//  ASIENTO CONTABLE — CxP MANUAL (Gasto genérico, no ligado a Inventario)
// ══════════════════════════════════════════════════════════════
// datos: { descripcion, montoUSD, referencia, id_cuentaGasto, fecha, tasa,
//          incluyeIVA, exentoIVA, baseExactaUSD, baseExactaBs }
async function generarAsientoGastoManual(datos) {
  try {
    let tasa = datos.tasa ? parseFloat(datos.tasa) : 0;
    if (!tasa) {
      const fechaBuscar = datos.fecha || getHoyVzla();
      const tasas = await api('tasas','GET',null,'?fecha_valor=lte.' + fechaBuscar + '&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      tasa = tasas.length ? parseFloat(tasas[0].tipo_cambio) : 1;
    }

    const anio = new Date().getFullYear();
    const existAst = await api('cont_asientos','GET',null,'?numero_asiento=like.AST-'+anio+'-*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
    let seq = 1;
    if (existAst.length) { const p = existAst[0].numero_asiento.split('-'); seq = parseInt(p[p.length-1])+1; }
    const numAst = 'AST-'+anio+'-'+String(seq).padStart(4,'0');

    const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
    const id_periodo = periodos.length ? periodos[0].id_periodo : null;

    const asiento = await api('cont_asientos','POST',{
      numero_asiento: numAst,
      fecha:          datos.fecha || getHoyVzla(),
      descripcion:    datos.descripcion || 'Cuenta por Pagar manual',
      tipo:           'GASTO_MANUAL',
      referencia:     datos.referencia || null,
      moneda_base:    ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(),
      tasa_bcv:       tasa,
      id_periodo:     id_periodo,
      id_empresa:     _empresaActiva ? _empresaActiva.id_empresa : null,
      estado:         'APROBADO',
      id_usuario:     sesionActual.correo_usuario
    });
    if (!asiento || !asiento[0]) return;
    const idAst = asiento[0].id_asiento;

    const montoTotalUSD = datos.montoUSD || 0;
    const montoTotalBs  = (datos.montoBsExacto !== undefined && datos.montoBsExacto !== null)
      ? datos.montoBsExacto
      : parseFloat((montoTotalUSD * tasa).toFixed(2));
    const IVA_RATE = (datos.tasaIVA != null) ? datos.tasaIVA : tasaIVAActual();
    let baseUSD, ivaUSD, baseBs, ivaBs;
    if (datos.exentoIVA) {
      baseUSD = datos.baseExactaUSD ?? montoTotalUSD; ivaUSD = 0;
      baseBs  = datos.baseExactaBs  ?? montoTotalBs;  ivaBs  = 0;
    } else if (datos.incluyeIVA) {
      baseUSD = datos.baseExactaUSD ?? parseFloat((montoTotalUSD/(1+IVA_RATE)).toFixed(4));
      ivaUSD  = parseFloat((montoTotalUSD - baseUSD).toFixed(4));
      baseBs  = datos.baseExactaBs  ?? parseFloat((montoTotalBs/(1+IVA_RATE)).toFixed(2));
      ivaBs   = parseFloat((montoTotalBs - baseBs).toFixed(2));
    } else {
      baseUSD = datos.baseExactaUSD ?? montoTotalUSD;
      ivaUSD  = parseFloat((baseUSD*IVA_RATE).toFixed(4));
      baseBs  = datos.baseExactaBs  ?? montoTotalBs;
      ivaBs   = parseFloat((baseBs*IVA_RATE).toFixed(2));
    }

    let idCtaIVA = null;
    if (!datos.exentoIVA) {
      const cIVA = await api('cont_cuentas','GET',null,'?codigo=eq.1.1.04.001&select=id_cuenta&limit=1');
      idCtaIVA = cIVA.length ? cIVA[0].id_cuenta : null;
    }
    let idCtaCxP = null;
    { const cProv = await api('cont_cuentas','GET',null,'?codigo=eq.2.1.01.001&select=id_cuenta');
      idCtaCxP = cProv.length ? cProv[0].id_cuenta : null; }

    let orden = 1;
    if (datos.id_cuentaGasto) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:datos.id_cuentaGasto, orden:orden++,
        descripcion: datos.descripcion || 'Gasto',
        debe_usd: baseUSD, haber_usd:0, debe_ves: baseBs, haber_ves:0, tasa_bcv: tasa });
    }
    if (idCtaIVA && ivaUSD > 0) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idCtaIVA, orden:orden++,
        descripcion: 'IVA (' + Math.round(IVA_RATE*100) + '%) — ' + (datos.descripcion||''),
        debe_usd: ivaUSD, haber_usd:0, debe_ves: ivaBs, haber_ves:0, tasa_bcv: tasa });
    }
    if (idCtaCxP) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idCtaCxP, orden:orden++,
        descripcion: 'CxP ' + (datos.descripcion||''),
        debe_usd:0, haber_usd: montoTotalUSD, debe_ves:0, haber_ves: montoTotalBs, tasa_bcv: tasa });
    }

    console.log('✓ Asiento gasto manual creado:', numAst);
  } catch(eAstGasto) {
    console.warn('Error asiento gasto manual:', eAstGasto);
    alert('⚠ DIAGNÓSTICO TEMPORAL — No se generó el asiento contable.\n\nError real: ' + (eAstGasto?.message || JSON.stringify(eAstGasto)) + '\n\nPor favor comparte este mensaje completo.');
  }
}


