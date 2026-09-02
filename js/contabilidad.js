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
    + contTabBtn('cajabancos',   '🏦 Caja - Bancos',  'VER')
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
  else if (vista === 'cajabancos')   await contRenderCajaBancos();
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
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
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
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando Libro Diario: ' + msgErr(e) + '</div>';
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
    // Mostrar las cuentas del asiento ordenadas por su Código (menor a
    // mayor), igual que en el Catálogo de Cuentas -- no por el orden en
    // que se insertaron las líneas (Debe/Haber según se fueron generando).
    lineas.sort(function(la, lb) {
      const ca = la.cont_cuentas?.codigo || '';
      const cb = lb.cont_cuentas?.codigo || '';
      return ca.localeCompare(cb, undefined, { numeric: true });
    });
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
        btns += '<button class="btn-secundario" style="color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="btnSetGuardando(this,true,null,\'Procesando...\');contEliminarAsiento(' + ast.id_asiento + ').finally(()=>btnSetGuardando(this,false))">🗑 Eliminar</button>';
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
    if (contEl) contEl.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando asiento: ' + msgErr(e) + '</div>';
    else alert('Error: ' + msgErr(e));
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
                + (montoFunc > 0 ? montoFunc.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2}) : '—') + '</td>';
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
    // moneda_base -- SIEMPRE la Moneda Funcional de la Empresa
    // (moneda_principal), sin excepción, sin importar qué Moneda haya
    // elegido el Contador para capturar este Asiento puntual. Nada se
    // puede ocultar contablemente: el select "cont-form-moneda" solo
    // decide en cuál columna (REF/FUNC) escribe el monto de referencia --
    // el equivalente en Moneda Funcional ya se calcula por línea (columna
    // FUNC) y es siempre lo que queda como base del asiento.
    const datos = { fecha, descripcion: desc, referencia: ref||null, tipo, moneda_base: monedaFunc, tasa_bcv: tasa, id_periodo: periodo || null, estado:'PENDIENTE', id_usuario: sesionActual.correo_usuario, id_empresa: _empresaActiva?.id_empresa || null };

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
  } catch(e) { errEl.textContent = 'Error: ' + msgErr(e); errEl.style.display='block'; }
}

async function contAprobarAsiento(id) {
  if (!confirm('¿Aprobar este asiento? Una vez aprobado no podrá editarse.')) return;
  try {
    await api('cont_asientos','PATCH',{ estado:'APROBADO', aprobado_por: sesionActual.correo_usuario, fecha_aprobacion: new Date().toISOString() },'?id_asiento=eq.' + id);
    contCambiarVista('diario');
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

async function contEliminarAsiento(id) {
  if (!confirm('¿Eliminar este asiento? Esta acción no se puede deshacer.')) return;
  try {
    await api('cont_asiento_lineas', 'DELETE', null, '?id_asiento=eq.' + id);
    await api('cont_asientos', 'DELETE', null, '?id_asiento=eq.' + id);
    cerrarModal('modal-cont-asiento-ver');
    contCambiarVista('diario');
  } catch(e) { alert('Error al eliminar: ' + msgErr(e)); }
}

async function contAnularAsiento(id) {
  if (!confirm('¿Anular este asiento? Esta acción no puede deshacerse.')) return;
  try {
    await api('cont_asientos','PATCH',{ estado:'ANULADO' },'?id_asiento=eq.' + id);
    contCambiarVista('diario');
  } catch(e) { alert('Error: ' + msgErr(e)); }
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
        lineasG = lineasG.slice().sort(function(x, y) {
          return new Date(x.cont_asientos?.fecha || 0) - new Date(y.cont_asientos?.fecha || 0);
        });
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
        cuentaIds.sort(function(a, b) {
          const ca = contCuentasCache.find(function(c){ return c.id_cuenta === a; });
          const cb = contCuentasCache.find(function(c){ return c.id_cuenta === b; });
          return (ca?.codigo || '').localeCompare(cb?.codigo || '', undefined, {numeric:true});
        });
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
    const fmtM = function(v) { return fmtVES(v); };

    if (!id_cuenta) {
      const cuentaIds = [...new Set(lineas.map(function(l){ return l.id_cuenta; }))];
      cuentaIds.sort(function(a, b) {
        const ca = contCuentasCache.find(function(c){ return c.id_cuenta === a; });
        const cb = contCuentasCache.find(function(c){ return c.id_cuenta === b; });
        return (ca?.codigo || '').localeCompare(cb?.codigo || '', undefined, {numeric:true});
      });
      let html = '';
      cuentaIds.forEach(function(cid) {
        const lineasCuenta = lineas.filter(function(l){ return l.id_cuenta === cid; }).sort(function(x, y) {
          return new Date(x.cont_asientos?.fecha || 0) - new Date(y.cont_asientos?.fecha || 0);
        });
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
    const lineasOrdenadas = lineas.slice().sort(function(x, y) {
      return new Date(x.cont_asientos?.fecha || 0) - new Date(y.cont_asientos?.fecha || 0);
    });
    const filas = lineasOrdenadas.map(function(l) {
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

  } catch(e) { res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>'; }
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
  } catch(e) { res.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>'; }
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
let _pagoCxcActualId = null; // id_cxc que se esta cobrando en el modal

// Muestra el campo "Banco Origen" solo cuando el Método de Cobro elegido es
// Transferencia (Efectivo, Afiliación, etc. no lo necesitan). También
// evalúa fresco si aplica IGTF para ESTA cobranza puntual: Empresa
// Contribuyente Especial + Moneda del Método elegido en USD -- sin
// importar en qué Moneda se facturó originalmente (facturas.aplica_igtf
// es solo lo que se congeló al EMITIR, no determina cómo se cobra).
function onCambiarMetodoCobroCxc() {
  const selMetodoEl = document.getElementById('cont-pago-cxc-metodo');
  const opt = selMetodoEl?.selectedOptions?.[0];
  const tipoCanal = opt?.dataset?.tipoCanal || '';
  const monedaMetodoSel = (opt?.dataset?.moneda || '').toUpperCase();
  const cont = document.getElementById('cont-pago-cxc-banco-origen-cont');
  if (cont) cont.style.display = (tipoCanal === 'TRANSFERENCIA') ? '' : 'none';
  if (tipoCanal !== 'TRANSFERENCIA') {
    const sel = document.getElementById('cont-pago-cxc-banco-origen');
    if (sel) sel.value = '';
  }
  // Comprobante No. -- solo aplica (y solo se exige) cuando el Método es
  // Transferencia; para Efectivo u otros canales no hay número que pedir.
  const refCont = document.getElementById('cont-pago-cxc-ref-cont');
  if (refCont) refCont.style.display = (tipoCanal === 'TRANSFERENCIA') ? '' : 'none';
  if (tipoCanal !== 'TRANSFERENCIA') {
    const refEl = document.getElementById('cont-pago-cxc-ref');
    if (refEl) refEl.value = '';
  }
  const igtfNotaEl = document.getElementById('cont-pago-cxc-igtf-nota');
  if (igtfNotaEl) {
    const aplicaIGTFAhora = monedaMetodoSel === 'USD' && _empresaActiva?.tipo_contribuyente === 'ESPECIAL';
    igtfNotaEl.style.display = aplicaIGTFAhora ? '' : 'none';
    if (aplicaIGTFAhora) {
      const pctIGTF = window._contPagoCxcPctIGTF || 0.03;
      const montoUSD = window._contPagoCxcMontoUSD || 0;
      const montoIGTF = parseFloat((montoUSD * pctIGTF).toFixed(2));
      const totalPagar = parseFloat((montoUSD + montoIGTF).toFixed(2));
      igtfNotaEl.innerHTML = '<div style="white-space:nowrap;overflow-x:auto">Contribuyente Especial, Cobros en USD aplica IGTF ('+(pctIGTF*100).toFixed(0)+'%): <strong>$ '+montoIGTF.toFixed(2)+'</strong></div>'
        + '<div style="margin-top:4px;color:var(--texto);font-family:var(--font-mono);font-size:23px;font-weight:600">Total a Pagar: $ '+totalPagar.toFixed(2)+'</div>';
    }
  }
}

async function contAbrirPagoCxc(id_cxc) {
  const c = (contCxcCache || []).find(function(x) { return x.id_cxc === id_cxc; });
  if (!c) { alert('No se encontró la Cuenta por Cobrar.'); return; }
  _pagoCxcActualId = id_cxc;

  const facturaRefCxc = Array.isArray(c.facturas) ? c.facturas[0] : c.facturas;
  const elFacturaRefCxc = document.getElementById('cont-pago-cxc-factura-ref');
  if (elFacturaRefCxc) elFacturaRefCxc.textContent = 'Factura ' + (facturaRefCxc?.numero_factura || '—') + ' — ' + (facturaRefCxc?.receptor_nombre || '');
  const elFacturaFechaCxc = document.getElementById('cont-pago-cxc-factura-fecha');
  if (elFacturaFechaCxc) elFacturaFechaCxc.textContent = facturaRefCxc?.fecha_emision ? 'Fecha: ' + fmtFecha(facturaRefCxc.fecha_emision) : '';

  const okEl  = document.getElementById('alerta-pago-cxc-ok');
  const errEl = document.getElementById('alerta-pago-cxc-err');
  if (okEl)  okEl.style.display  = 'none';
  if (errEl) errEl.style.display = 'none';

  const saldoPend = parseFloat(c.saldo_usd != null ? c.saldo_usd : c.monto_usd) || 0;

  // Tasa BCV vigente (la misma que se usará al guardar, para que lo que se
  // muestra aquí coincida exactamente con lo que se registra después).
  let tasaActualPago = parseFloat(c.tasa_bcv) || 1;
  try {
    const tasasBCVPago = await api('tasas','GET',null,
      '?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    if (tasasBCVPago.length) tasaActualPago = parseFloat(tasasBCVPago[0].tipo_cambio);
  } catch(eTasaPago) {}
  const montoVESPago = parseFloat((saldoPend * tasaActualPago).toFixed(2));

  window._contPagoCxcMontoUSD = saldoPend;
  window._contPagoCxcMontoVES = montoVESPago;
  try {
    const tribCxc = await api('param_tributos','GET',null,'?codigo=eq.IGTF&select=alicuota&limit=1');
    window._contPagoCxcPctIGTF = (tribCxc && tribCxc[0]) ? parseFloat(tribCxc[0].alicuota) / 100 : 0.03;
  } catch(eTribCxc) { window._contPagoCxcPctIGTF = 0.03; }
  document.getElementById('cont-pago-cxc-tasa').value   = tasaActualPago.toFixed(2) + ' Bs/$';
  document.getElementById('cont-pago-cxc-monto-raw').value = saldoPend;
  document.getElementById('cont-pago-cxc-tasa-raw').value  = tasaActualPago;
  document.getElementById('cont-pago-cxc-ref').value    = '';

  // Limpiar comprobante y contraseña de una apertura anterior
  const archivoElPago = document.getElementById('cont-pago-cxc-archivo');
  if (archivoElPago) archivoElPago.value = '';
  const previewContPago = document.getElementById('cont-pago-cxc-archivo-preview-cont');
  if (previewContPago) previewContPago.style.display = 'none';
  const claveElPago = document.getElementById('cont-pago-cxc-clave');
  if (claveElPago) claveElPago.value = '';
  const usuarioNombreEl = document.getElementById('cont-pago-cxc-usuario-nombre');
  if (usuarioNombreEl) usuarioNombreEl.textContent = sesionActual?.nombre || sesionActual?.correo_usuario || '—';

  // Bancos disponibles para "Banco Origen" (solo aplica cuando el Método
  // de Cobro elegido es Transferencia) -- misma tabla de Parámetros que ya
  // usa Proveedores.
  const selBancoOrigen = document.getElementById('cont-pago-cxc-banco-origen');
  if (selBancoOrigen) {
    try {
      const bancos = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre');
      selBancoOrigen.innerHTML = '<option value="">— Seleccionar —</option>'
        + (bancos||[]).map(function(b){ return '<option value="'+b.id+'">'+b.nombre+'</option>'; }).join('');
    } catch(eBanCxc) { selBancoOrigen.innerHTML = '<option value="">— Sin bancos disponibles —</option>'; }
    selBancoOrigen.value = '';
  }
  const bancoOrigenContCxc = document.getElementById('cont-pago-cxc-banco-origen-cont');
  if (bancoOrigenContCxc) bancoOrigenContCxc.style.display = 'none';

  // El IGTF NO se decide con facturas.aplica_igtf (eso es lo que se
  // congeló al EMITIR la Factura) -- se evalúa fresco, en el momento de
  // ESTA cobranza puntual, cuando el Usuario elige el Método
  // (onCambiarMetodoCobroCxc): aplica si la Empresa es Contribuyente
  // Especial Y la Moneda elegida para este Cobro es USD.
  const monedaFacturaCxc = (facturaRefCxc?.moneda_cobro || 'VES').toUpperCase();

  // Moneda del Cobro -- por defecto, la misma Moneda de Cobro de la
  // Factura; el operador puede cambiarla (ej. Cliente paga en efectivo
  // en la otra moneda), y el listado de Métodos y el Monto principal se
  // refiltran/invierten según lo que elija aquí.
  const selMoneda = document.getElementById('cont-pago-cxc-moneda');
  if (selMoneda) selMoneda.value = monedaFacturaCxc;
  _actualizarMontoPrincipalCxc();

  await _cargarMetodosCobroCxc();

  const infoEl = document.getElementById('cont-pago-cxc-tasa-info');
  if (infoEl) {
    infoEl.textContent = c.tasa_bcv
      ? 'Tasa registrada en la Factura original: ' + parseFloat(c.tasa_bcv).toFixed(4) + ' Bs/$'
      : '';
  }

  abrirModal('modal-cont-pago-cxc');
}

// Invierte cuál Monto (Bs o USD) se muestra como principal (grande) según
// la Moneda actualmente elegida en el select -- se llama al abrir el
// modal y cada vez que el operador cambia esa Moneda.
function _actualizarMontoPrincipalCxc() {
  const monedaSel = (document.getElementById('cont-pago-cxc-moneda')?.value || 'VES').toUpperCase();
  const saldoPend = window._contPagoCxcMontoUSD || 0;
  const montoVESPago = window._contPagoCxcMontoVES || 0;
  const elPrincipalCxc = document.getElementById('cont-pago-cxc-monto-ves');
  const elSecundarioCxc = document.getElementById('cont-pago-cxc-monto');
  if (monedaSel === 'USD') {
    if (elPrincipalCxc) elPrincipalCxc.textContent = '$ ' + saldoPend.toFixed(2);
    if (elSecundarioCxc) elSecundarioCxc.textContent = '≈ Bs ' + montoVESPago.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2});
  } else {
    if (elPrincipalCxc) elPrincipalCxc.textContent = montoVESPago.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' Bs';
    if (elSecundarioCxc) elSecundarioCxc.textContent = '≈ $ ' + saldoPend.toFixed(2);
  }
}

// Carga los Métodos de Cobro disponibles para la Moneda actualmente
// elegida en el select Moneda -- separado de contAbrirPagoCxc() para
// poder llamarse de nuevo cuando el operador cambia esa Moneda.
async function _cargarMetodosCobroCxc() {
  _actualizarMontoPrincipalCxc();
  const monedaSel = (document.getElementById('cont-pago-cxc-moneda')?.value || 'VES').toUpperCase();
  const selMetodo = document.getElementById('cont-pago-cxc-metodo');
  if (!selMetodo) return;
  selMetodo.innerHTML = '<option value="">— Cargando métodos —</option>';
  try {
    let metodos = await api('param_metodos_pago','GET',null,
      '?estado=eq.ACTIVO&order=nombre.asc&select=id_metodo,nombre,tipo_canal,id_cuenta_contable,codigo' + emisorQ());
    metodos = (metodos || []).filter(function(m) {
      return m.tipo_canal !== 'AFILIACION_BANCARIA' && (m.codigo || '').toUpperCase() === monedaSel;
    });
    if (!metodos || !metodos.length) {
      selMetodo.innerHTML = '<option value="">⚠ No hay métodos de Cobro en '+monedaSel+' configurados — configure uno en Parámetros</option>';
    } else {
      // Etiqueta homologada con Ejecutar Pago (METODO_PAGO_LABELS, definida
      // en egresos.js): se muestra solo el tipo de canal ("Efectivo",
      // "Transferencia"), sin repetir la Moneda -- ya se eligió arriba en
      // el campo Moneda, y repetirla aquí era redundante/inconsistente.
      selMetodo.innerHTML = '<option value="">— Seleccione método —</option>'
        + metodos.map(function(m) {
            const etiqueta = (typeof METODO_PAGO_LABELS !== 'undefined' && METODO_PAGO_LABELS[m.tipo_canal]) || m.nombre;
            return '<option value="'+m.id_metodo+'" data-cuenta-id="'+(m.id_cuenta_contable||'')+'" data-moneda="'+(m.codigo||'')+'" data-tipo-canal="'+(m.tipo_canal||'')+'">'+etiqueta+'</option>';
          }).join('');
      // Sin preselección -- el operador debe elegir explícitamente.
    }
  } catch(eMet) {
    selMetodo.innerHTML = '<option value="">— Sin métodos disponibles —</option>';
  }
  onCambiarMetodoCobroCxc();
}

async function contGuardarPagoCxc() {
  const okEl  = document.getElementById('alerta-pago-cxc-ok');
  const errEl = document.getElementById('alerta-pago-cxc-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!_pagoCxcActualId) { errEl.textContent = 'No hay ninguna Cuenta por Cobrar seleccionada.'; errEl.style.display = 'block'; return; }

  const monto = parseFloat(document.getElementById('cont-pago-cxc-monto-raw')?.value);
  if (!monto || monto <= 0) {
    errEl.textContent = 'No se pudo determinar el monto a cobrar. Cierre y vuelva a abrir el Cobro.'; errEl.style.display = 'block';
    return;
  }
  const fecha = getHoyVzla();
  const selMetodoEl = document.getElementById('cont-pago-cxc-metodo');
  const metodo = selMetodoEl?.value || null;
  if (!metodo) {
    errEl.textContent = 'Debe seleccionar el Método de Pago.'; errEl.style.display = 'block';
    selMetodoEl?.focus(); return;
  }
  const metodoNombre = selMetodoEl?.selectedOptions?.[0]?.textContent || metodo;
  const tipoCanalSel = selMetodoEl?.selectedOptions?.[0]?.dataset?.tipoCanal || '';
  const idCuentaMetodoSel = parseInt(selMetodoEl?.selectedOptions?.[0]?.dataset?.cuentaId) || null;
  if (!idCuentaMetodoSel) {
    errEl.textContent = 'El método "' + metodoNombre + '" no tiene una Cuenta Contable configurada en Parámetros. Configúrela antes de registrar este Cobro (de lo contrario quedaría sin asiento).';
    errEl.style.display = 'block';
    selMetodoEl?.focus(); return;
  }
  let idBancoOrigen = null;
  if (tipoCanalSel === 'TRANSFERENCIA') {
    const selBancoEl = document.getElementById('cont-pago-cxc-banco-origen');
    idBancoOrigen = parseInt(selBancoEl?.value) || null;
    if (!idBancoOrigen) {
      errEl.textContent = 'Debe seleccionar el Banco Origen de la Transferencia.'; errEl.style.display = 'block';
      selBancoEl?.focus(); return;
    }
  }
  const referencia = document.getElementById('cont-pago-cxc-ref')?.value.trim() || null;
  if (tipoCanalSel === 'TRANSFERENCIA' && !referencia) {
    errEl.textContent = 'El Comprobante No. es obligatorio para pagos por Transferencia.'; errEl.style.display = 'block';
    document.getElementById('cont-pago-cxc-ref')?.focus(); return;
  }
  const claveCxc = document.getElementById('cont-pago-cxc-clave')?.value || '';
  if (!claveCxc) {
    errEl.textContent = 'Debe ingresar su contraseña para confirmar.'; errEl.style.display = 'block';
    document.getElementById('cont-pago-cxc-clave')?.focus(); return;
  }
  const validaClaveCxc = await validarClaveUsuarioActual(claveCxc);
  if (!validaClaveCxc.ok) {
    errEl.textContent = validaClaveCxc.msg; errEl.style.display = 'block';
    document.getElementById('cont-pago-cxc-clave')?.focus(); return;
  }

  try {
    const rows = await api('cont_cxc','GET',null,'?id_cxc=eq.'+_pagoCxcActualId+'&select=*');
    if (!rows || !rows[0]) { errEl.textContent = 'La Cuenta por Cobrar ya no existe.'; errEl.style.display = 'block'; return; }
    const c = rows[0];

    if (monto > parseFloat(c.saldo_usd != null ? c.saldo_usd : c.monto_usd) + 0.01) {
      errEl.textContent = 'El saldo de esta Cuenta por Cobrar cambió desde que se abrió este Cobro (ahora es $ ' + parseFloat(c.saldo_usd||c.monto_usd).toFixed(2) + '). Cierre y vuelva a abrirlo.';
      errEl.style.display = 'block';
      return;
    }

    // Subir comprobante si se adjuntó archivo
    let urlComprobanteCxc = null;
    const archivoElCxc = document.getElementById('cont-pago-cxc-archivo');
    if (archivoElCxc && archivoElCxc.files && archivoElCxc.files[0]) {
      try {
        urlComprobanteCxc = await subirFoto(archivoElCxc.files[0], 'comprobantes-cobro/' + _pagoCxcActualId);
      } catch(eFileCxc) { console.warn('Error subiendo comprobante:', eFileCxc); }
    }

    const nuevoPagado = parseFloat((parseFloat(c.pagado_usd||0) + monto).toFixed(2));
    const nuevoSaldo  = Math.max(0, parseFloat((parseFloat(c.monto_usd||0) - nuevoPagado).toFixed(2)));
    const nuevoEstado = nuevoSaldo <= 0.01 ? 'PAGADA' : 'PARCIAL';

    const patchDataCxc = {
      pagado_usd:  nuevoPagado,
      saldo_usd:   nuevoSaldo,
      estado:      nuevoEstado,
      metodo_pago: metodoNombre,
      referencia:  referencia,
      id_banco_origen: idBancoOrigen,
      fecha_cobro: new Date().toISOString()
    };
    if (urlComprobanteCxc) patchDataCxc.url_comprobante = urlComprobanteCxc;

    await api('cont_cxc','PATCH', patchDataCxc, '?id_cxc=eq.'+_pagoCxcActualId);

    // Mantener sincronizado el estado de la Factura relacionada, ya que la
    // lista de Contabilidad (contRenderCxc) se basa en facturas.estado.
    if (c.id_factura) {
      await api('facturas','PATCH',{ estado: nuevoEstado },'?id_factura=eq.'+c.id_factura);
    }

    // Generar asiento contable del Cobro -- Debe Caja/Banco (según método
    // elegido, desde param_metodos_pago) / Haber CxC Cliente. Si la tasa
    // BCV cambió desde que se emitió la Factura, se registra diferencia
    // cambiaria (espejo exacto de cómo Egresos trata el Pago de CxP, pero
    // en sentido de Cobro: si sube la tasa, la empresa recibe más Bs de lo
    // que el Cliente debía = ganancia; si baja, pérdida). Si el método es
    // en divisas, se agrega IGTF 3% (mismas cuentas que usa Egresos).
    try {
      const selMetodoEl = document.getElementById('cont-pago-cxc-metodo');
      const optSel = selMetodoEl?.selectedOptions?.[0];
      const idCuentaContraparte = parseInt(optSel?.dataset.cuentaId) || null;
      const monedaMetodo = (optSel?.dataset.moneda || 'VES').toUpperCase();

      if (!idCuentaContraparte) {
        console.warn('Cobro registrado, pero no se generó asiento: el método seleccionado no tiene cuenta contable configurada en Parámetros.');
        if (okEl) { okEl.textContent = '⚠ Cobro registrado, pero SIN asiento contable (el método no tiene Cuenta configurada en Parámetros). Contacte a Contabilidad.'; okEl.style.display = 'block'; }
      } else {
        const todasCtas = await obtenerCuentasContables();
        const getCta = function(codigo){ return todasCtas.find(function(x){ return x.codigo === codigo; }) || null; };
        const cCxC       = getCta('1.1.02.001');
        const cDifGasto   = getCta('6.2.01.003');
        const cDifIngr    = getCta('4.2.01.003');
        const cIGTFPagar  = getCta('2.1.03.004');
        const cContraparte = todasCtas.find(function(x){ return x.id_cuenta === idCuentaContraparte; }) || null;

        let pctIGTF = 0.03;
        try {
          const trib = await api('param_tributos','GET',null,'?codigo=eq.IGTF&select=alicuota&limit=1');
          if (trib && trib[0]) pctIGTF = parseFloat(trib[0].alicuota) / 100;
        } catch(eTrib) {}

        let tasaActual = parseFloat(document.getElementById('cont-pago-cxc-tasa-raw')?.value) || parseFloat(c.tasa_bcv) || 1;

        const tasaOriginal      = parseFloat(c.tasa_bcv) || 1;

        let numeroFacturaRef = 'CXC-' + _pagoCxcActualId;
        let totalVesFactura = null;
        try {
          if (c.id_factura) {
            const facRef = await api('facturas','GET',null,'?id_factura=eq.'+c.id_factura+'&select=numero_factura,receptor_nombre,total_ves');
            if (facRef && facRef[0]) {
              numeroFacturaRef = facRef[0].numero_factura || numeroFacturaRef;
              if (facRef[0].total_ves != null) totalVesFactura = parseFloat(facRef[0].total_ves);
            }
          }
        } catch(eFacRef) {}

        // montoVESOriginal: el Bs EXACTO ya congelado en la propia Factura
        // (facturas.total_ves) -- no se recalcula multiplicando el USD por
        // la tasa, porque ese redondeo no siempre regresa exacto al monto
        // real facturado (mismo patrón que ya corregimos en Compras).
        const montoVESOriginal  = totalVesFactura != null ? totalVesFactura : parseFloat((monto * tasaOriginal).toFixed(2));
        // montoVESCobro: solo se recalcula multiplicando USD × tasa si la
        // tasa de HOY realmente es distinta a la original -- si es la
        // misma (cobro el mismo día, sin devaluación real), usa el mismo
        // monto congelado, para no generar un "diferencial cambiario"
        // falso por puro redondeo cuando la tasa no se movió ni un ápice.
        const montoVESCobro     = tasaActual === tasaOriginal ? montoVESOriginal : parseFloat((monto * tasaActual).toFixed(2));
        const difCambio         = tasaActual === tasaOriginal ? 0 : parseFloat((montoVESCobro - montoVESOriginal).toFixed(2));

        const anio = new Date(fecha).getFullYear();
        const existAst = await api('cont_asientos','GET',null,'?numero_asiento=like.AST-'+anio+'-*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
        let seqAst = 1;
        if (existAst.length) { const p = existAst[0].numero_asiento.split('-'); seqAst = parseInt(p[p.length-1]) + 1; }
        const numAst = 'AST-' + anio + '-' + String(seqAst).padStart(4,'0');

        const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_empresa=eq.'+(_empresaActiva?.id_empresa||0));
        const id_periodo = periodos.length ? periodos[0].id_periodo : null;

        const ast = await api('cont_asientos','POST',{
          id_empresa: _empresaActiva?.id_empresa || null,
          numero_asiento: numAst, tipo: 'COBRO_CLIENTE', fecha: fecha,
          descripcion: 'Cobro Factura ' + numeroFacturaRef,
          referencia: numeroFacturaRef, estado: 'APROBADO',
          // moneda_base -- la Moneda FUNCIONAL de la Empresa (normalmente
          // VES), no la del Método de Cobro elegido. Antes quedaba en
          // 'monedaMetodo' (USD si se cobraba en divisas), generando
          // asientos "en USD" aunque la Empresa lleve su contabilidad en
          // VES -- mismo criterio ya usado en Entradas y Egresos.
          moneda_base: ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(), tasa_bcv: tasaActual, id_periodo: id_periodo,
          id_usuario: sesionActual?.correo_usuario || null
        });
        const ar = Array.isArray(ast) ? ast[0] : ast;
        if (ar?.id_asiento) {
          const idAst = ar.id_asiento;
          let orden = 1;
          const desc = 'Cobro ' + numeroFacturaRef;

          // IGTF -- solo aplica si quien COBRA (nuestra propia empresa) es
          // Contribuyente Especial (agente de percepción ante el SENIAT).
          // Quien PAGA el IGTF es el CLIENTE, no la Empresa: al pagar en
          // divisas, entrega el monto de la venta MÁS 3% de IGTF -- la
          // Empresa solo lo recauda en nombre del SENIAT (no es un gasto
          // propio). Por eso a Caja/Banco entra la SUMA de ambos montos,
          // y se abona contra dos cuentas: CxC (el monto base) e IGTF por
          // Pagar (lo recaudado, que ahora se le debe a SENIAT) -- sin
          // ninguna línea de "IGTF Pagado" (gasto), que no aplica aquí.
          const aplicaIGTFCobro = monedaMetodo !== 'VES' && _empresaActiva?.tipo_contribuyente === 'ESPECIAL';
          const montoIGTF_USD = aplicaIGTFCobro ? parseFloat((monto * pctIGTF).toFixed(2)) : 0;
          const montoIGTF_VES = aplicaIGTFCobro ? parseFloat((montoIGTF_USD * tasaActual).toFixed(2)) : 0;

          if (cContraparte) await api('cont_asiento_lineas','POST',{
            id_asiento: idAst, id_cuenta: cContraparte.id_cuenta, orden: orden++,
            descripcion: desc + (aplicaIGTFCobro ? ' (incluye IGTF '+(pctIGTF*100).toFixed(0)+'%)' : ''),
            debe_usd: monto + montoIGTF_USD, haber_usd: 0, debe_ves: montoVESCobro + montoIGTF_VES, haber_ves: 0, tasa_bcv: tasaActual
          });

          if (cCxC) await api('cont_asiento_lineas','POST',{
            id_asiento: idAst, id_cuenta: cCxC.id_cuenta, orden: orden++,
            descripcion: desc,
            debe_usd: 0, haber_usd: monto, debe_ves: 0, haber_ves: montoVESOriginal, tasa_bcv: tasaOriginal
          });

          if (difCambio < 0 && cDifGasto) {
            await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cDifGasto.id_cuenta, orden: orden++,
              descripcion: 'Pérdida por diferencia cambiaria ('+tasaOriginal+' -> '+tasaActual+')',
              debe_usd: 0, haber_usd: 0, debe_ves: Math.abs(difCambio), haber_ves: 0, tasa_bcv: tasaActual
            });
          } else if (difCambio > 0 && cDifIngr) {
            await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cDifIngr.id_cuenta, orden: orden++,
              descripcion: 'Ganancia por diferencia cambiaria ('+tasaOriginal+' -> '+tasaActual+')',
              debe_usd: 0, haber_usd: 0, debe_ves: 0, haber_ves: difCambio, tasa_bcv: tasaActual
            });
          }

          if (aplicaIGTFCobro && cIGTFPagar) {
            await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cIGTFPagar.id_cuenta, orden: orden++,
              descripcion: 'IGTF '+(pctIGTF*100).toFixed(0)+'% recaudado al Cliente (enterar primeros 12 días del mes)',
              debe_usd: 0, haber_usd: montoIGTF_USD, debe_ves: 0, haber_ves: montoIGTF_VES, tasa_bcv: tasaActual
            });
          }
        }
      }
    } catch(eAst) {
      console.warn('Cobro registrado, pero hubo un error generando el asiento contable:', eAst);
      if (okEl) {
        okEl.textContent = '⚠ Cobro registrado, pero el asiento contable NO se generó. Error: ' + (eAst?.message || eAst) + ' — este movimiento no aparecerá en Caja/Bancos hasta corregirlo.';
        okEl.style.display = 'block';
        okEl.style.color = 'var(--naranja)';
      }
    }

    // Refrescar la cache local
    const i = contCxcCache.findIndex(function(x){ return x.id_cxc === _pagoCxcActualId; });
    const cxcActualizada = Object.assign({}, c, { pagado_usd: nuevoPagado, saldo_usd: nuevoSaldo, estado: nuevoEstado });
    if (i >= 0) contCxcCache[i] = cxcActualizada; else contCxcCache.push(cxcActualizada);

    okEl.textContent = 'Cobro registrado correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-cont-pago-cxc');
      cerrarModal('modal-ficha-fac');
      if (typeof renderFacturas === 'function') renderFacturas();
      if (document.getElementById('cont-vista-cont') && typeof contRenderCxc === 'function') contRenderCxc();
    }, 900);
  } catch(e) {
    errEl.textContent = 'Error al registrar el cobro: ' + msgErr(e);
    errEl.style.display = 'block';
  }
}

// ─── CAJA - BANCOS ───
// Saldos REALES por Moneda -- no el equivalente en Moneda Funcional que ya
// muestra el resto de la contabilidad (Diario/Mayor/Balance), sino la
// suma/resta de los montos tal como se movieron en la Moneda seleccionada.
// Las Cuentas relevantes se derivan de param_metodos_pago (misma fuente
// que ya usa el sistema para saber a qué Cuenta va cada pago/cobro) --
// si se agrega un Banco nuevo en Parámetros, aparece aquí solo.
let _cajaBancosMoneda = null;
let _cajaBancosDesde  = null;
let _cajaBancosHasta  = null;

async function contRenderCajaBancos() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;

  const monedaPrincipal  = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  const monedaSecundaria = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
  if (!_cajaBancosMoneda) _cajaBancosMoneda = monedaPrincipal;

  const hoy = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);
  if (!_cajaBancosHasta) _cajaBancosHasta = hoy;
  if (!_cajaBancosDesde) _cajaBancosDesde = hoy.slice(0,7) + '-01'; // primer día del mes actual

  cont.innerHTML =
    '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;background:var(--gris2);border-radius:8px;padding:14px 16px">'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Moneda</label>'
    + '<select id="cb-moneda" onchange="_cajaBancosMoneda=this.value;cbConsultarSaldos()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-size:13px;padding:7px 10px;border-radius:5px;outline:none">'
    + '<option value="'+monedaPrincipal+'"'+(_cajaBancosMoneda===monedaPrincipal?' selected':'')+'>'+monedaPrincipal+'</option>'
    + (monedaSecundaria !== monedaPrincipal ? '<option value="'+monedaSecundaria+'"'+(_cajaBancosMoneda===monedaSecundaria?' selected':'')+'>'+monedaSecundaria+'</option>' : '')
    + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Desde</label>'
    + '<input type="date" id="cb-desde" value="'+_cajaBancosDesde+'" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-size:13px;padding:6px 10px;border-radius:5px;outline:none"></div>'
    + '<div><label style="font-size:11px;color:var(--suave);display:block;margin-bottom:4px">Hasta</label>'
    + '<input type="date" id="cb-hasta" value="'+_cajaBancosHasta+'" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-size:13px;padding:6px 10px;border-radius:5px;outline:none"></div>'
    + '<button class="btn-primario" onclick="cbConsultarSaldos()">Consultar</button>'
    + ((sesionActual?.administrador || puedo('CONTABILIDAD','TRASPASO')) ? '<button class="btn-secundario" onclick="abrirModalTraspasoCB()">🔁 Nuevo Traspaso</button>' : '')
    + ((sesionActual?.administrador || puedo('CONTABILIDAD','TRASPASO')) ? '<button class="btn-secundario" onclick="abrirModalCuentasBancariasEmpresa()">🏦 Cuentas Bancarias</button>' : '')
    + '</div>'
    + '<div id="cb-resultado"></div>'
    + '<div id="cb-traspasos-cont" style="margin-top:20px"></div>';

  await cbConsultarSaldos();
  await cbCargarTraspasosRecientes();
}

async function cbConsultarSaldos() {
  const resEl = document.getElementById('cb-resultado');
  if (!resEl) return;
  const moneda = document.getElementById('cb-moneda')?.value || _cajaBancosMoneda;
  const desde  = document.getElementById('cb-desde')?.value || _cajaBancosDesde;
  const hasta  = document.getElementById('cb-hasta')?.value || _cajaBancosHasta;
  _cajaBancosMoneda = moneda; _cajaBancosDesde = desde; _cajaBancosHasta = hasta;

  if (!desde || !hasta) { resEl.innerHTML = '<div class="alerta alerta-error" style="display:block">Debe indicar el rango de fechas.</div>'; return; }
  if (desde > hasta)    { resEl.innerHTML = '<div class="alerta alerta-error" style="display:block">"Desde" no puede ser posterior a "Hasta".</div>'; return; }

  resEl.innerHTML = '<div class="loading"><div class="spinner"></div> Calculando saldos...</div>';

  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/obtener_saldos_caja_bancos', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_id_empresa: window._contEmisorActivo || _empresaActiva?.id_empresa || null,
        p_moneda: moneda,
        p_fecha_desde: desde,
        p_fecha_hasta: hasta
      })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const filas = await resp.json() || [];

    if (!filas.length) {
      resEl.innerHTML = '<div class="alerta alerta-info" style="display:block">No hay Cuentas de Caja/Banco configuradas en Parámetros para '+moneda+' (revise Métodos de Cobro/Pago).</div>';
      return;
    }

    const simbolo = moneda === 'VES' ? 'Bs' : '$';
    const fmt = function(n) { return simbolo + ' ' + parseFloat(n||0).toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}); };
    const totInicial = filas.reduce(function(s,f){ return s + parseFloat(f.saldo_inicial||0); }, 0);
    const totEntradas = filas.reduce(function(s,f){ return s + parseFloat(f.entradas||0); }, 0);
    const totSalidas  = filas.reduce(function(s,f){ return s + parseFloat(f.salidas||0); }, 0);
    const totCierre   = filas.reduce(function(s,f){ return s + parseFloat(f.saldo_cierre||0); }, 0);

    resEl.innerHTML =
      '<div style="background:rgba(255,107,0,0.06);border:1px solid rgba(255,107,0,0.2);border-radius:8px;padding:16px;margin-bottom:16px">'
      + '<div style="font-size:11px;color:var(--naranja);letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;font-weight:600">Consolidado — '+moneda+'</div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">'
      + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:3px">SALDO INICIAL</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:600">'+fmt(totInicial)+'</div></div>'
      + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:3px">ENTRADAS</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:#22c55e">+'+fmt(totEntradas)+'</div></div>'
      + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:3px">SALIDAS</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:#f87171">-'+fmt(totSalidas)+'</div></div>'
      + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:3px">SALDO CIERRE</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--naranja)">'+fmt(totCierre)+'</div></div>'
      + '</div></div>'
      + '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Detalle por Cuenta</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CUENTA</th>'
      + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SALDO INICIAL</th>'
      + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">ENTRADAS</th>'
      + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SALIDAS</th>'
      + '<th style="text-align:right;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SALDO CIERRE</th>'
      + '</tr></thead><tbody>'
      + filas.map(function(f) {
          return '<tr>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)"><span style="color:var(--naranja);font-family:var(--font-mono);font-size:11px">'+f.codigo+'</span><br>'+f.nombre+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);text-align:right;font-family:var(--font-mono)">'+fmt(f.saldo_inicial)+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);text-align:right;font-family:var(--font-mono);color:#22c55e">+'+fmt(f.entradas)+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);text-align:right;font-family:var(--font-mono);color:#f87171">-'+fmt(f.salidas)+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);text-align:right;font-family:var(--font-mono);font-weight:600;color:var(--naranja)">'+fmt(f.saldo_cierre)+'</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch(eCB) {
    resEl.innerHTML = '<div class="alerta alerta-error" style="display:block">Error calculando saldos: ' + msgErr(eCB) + '</div>';
  }
}

// ══════════════════════════════════════════════════════════════
//  TRASPASOS CAJA/BANCO -- movimientos de EFECTIVO entre una Cuenta de
//  Caja y una Cuenta de Banco (en cualquier dirección), dentro de la
//  MISMA Moneda -- nunca se mezclan monedas en un mismo traspaso. Se
//  apoya en el mismo catálogo (param_metodos_pago) que ya usa el resto
//  del sistema para Cobros/Pagos, para no duplicar cuentas.
// ══════════════════════════════════════════════════════════════

async function cbCargarTraspasosRecientes() {
  const cont = document.getElementById('cb-traspasos-cont');
  if (!cont) return;
  try {
    const asientos = await api('cont_asientos','GET',null,
      '?tipo=eq.TRASPASO_CAJA_BANCO&estado=neq.ANULADO&order=fecha.desc&limit=10&select=id_asiento,numero_asiento,fecha,descripcion,referencia,tasa_bcv,moneda_base'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
    if (!asientos || !asientos.length) {
      cont.innerHTML = '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Traspasos Recientes</div>'
        + '<div style="color:var(--suave);font-size:12px;padding:12px">Todavía no se ha registrado ningún Traspaso.</div>';
      return;
    }

    // Comprobante adjunto (si lo hay) -- vive en cont_traspasos_cb, no en
    // el asiento genérico. Una sola consulta por lote.
    const idsAstTraspRec = asientos.map(function(a){ return a.id_asiento; });
    let comprobantePorAsiento = {};
    try {
      const trCbRows = await api('cont_traspasos_cb','GET',null,
        '?id_asiento=in.('+idsAstTraspRec.join(',')+')&select=id_asiento,url_comprobante');
      (trCbRows||[]).forEach(function(t){ if (t.url_comprobante) comprobantePorAsiento[t.id_asiento] = t.url_comprobante; });
    } catch(eCompTraspRec) {}

    cont.innerHTML = '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Traspasos Recientes</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">N° ASIENTO</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">FECHA</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">DESCRIPCIÓN</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">REFERENCIA</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">COMPROBANTE</th>'
      + '</tr></thead><tbody>'
      + asientos.map(function(a) {
          const rutaComp = comprobantePorAsiento[a.id_asiento];
          return '<tr>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);color:var(--naranja);font-family:var(--font-mono)">'+a.numero_asiento+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'+fmtFecha(a.fecha)+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'+(a.descripcion||'—')+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);font-family:var(--font-mono)">'+(a.referencia||'—')+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'
              + (rutaComp ? '<a href="#" onclick="_verComprobanteTraspaso(\''+rutaComp.replace(/'/g,"\\'")+'\');return false" style="color:var(--naranja)">📄 Ver</a>' : '—')
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch(eTraspRec) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando Traspasos: '+msgErr(eTraspRec)+'</div>';
  }
}

async function _verComprobanteTraspaso(rutaComprobante) {
  const url = await obtenerUrlFirmadaComprobante(rutaComprobante);
  if (url) window.open(url, '_blank');
  else alert('No se pudo generar el link para ver el comprobante.');
}

// ══════════════════════════════════════════════════════════════
//  CUENTAS BANCARIAS DE LA EMPRESA -- catálogo real (Institución + Tipo +
// Número), distinto de la Cuenta Contable abstracta. Puramente informativo
// por ahora; alimenta el selector de Cuenta Bancaria en Traspasos, y a
// futuro el módulo de Conciliación Bancaria.
// ══════════════════════════════════════════════════════════════

let _cbeBancosCache = []; // { id, nombre, codigo } -- para resolver el código de 4 dígitos al elegir Banco

async function abrirModalCuentasBancariasEmpresa() {
  if (!sesionActual?.administrador && !puedo('CONTABILIDAD','TRASPASO')) {
    alert('No tiene permiso para gestionar Cuentas Bancarias de la Empresa.');
    return;
  }
  document.getElementById('cbe-alias').value = '';
  document.getElementById('cbe-cod-banco').value = '';
  document.getElementById('cbe-num-cuenta-resto').value = '';
  document.getElementById('cbe-numero-cuenta').value = '';
  document.getElementById('cbe-tipo-cuenta').value = '';
  document.getElementById('alerta-cbe-err').style.display = 'none';

  const monedaPrincipalCbe  = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  const monedaSecundariaCbe = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
  document.getElementById('cbe-moneda').innerHTML = '<option value="'+monedaPrincipalCbe+'">'+monedaPrincipalCbe+'</option>'
    + (monedaSecundariaCbe !== monedaPrincipalCbe ? '<option value="'+monedaSecundariaCbe+'">'+monedaSecundariaCbe+'</option>' : '');

  try {
    // Mismo patrón que "Cuenta Nómina" en Empleados: código de 4 dígitos
    // del Banco se auto-llena al elegirlo (ver onSelBancoCbe más abajo).
    _cbeBancosCache = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo') || [];
    document.getElementById('cbe-banco').innerHTML = '<option value="">— Seleccionar —</option>'
      + _cbeBancosCache.map(function(b){ return '<option value="'+b.id+'">'+b.nombre+'</option>'; }).join('');
  } catch(eBancosCbe) {}

  try {
    const cuentasContablesCbe = await obtenerCuentasContables();
    // Solo cuentas de Banco (código 1.1.02.x) tienen sentido enlazar aquí.
    const ctasBanco = cuentasContablesCbe.filter(function(c){ return c.codigo && c.codigo.indexOf('1.1.02') === 0; });
    document.getElementById('cbe-cuenta-contable').innerHTML = '<option value="">— Seleccionar —</option>'
      + ctasBanco.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
  } catch(eCtasCbe) {}

  await cbeCargarListado();
  abrirModal('modal-cuentas-bancarias-empresa');
}

// Mismo patrón que onSelBancoEmpleado()/sincronizarNumeroCuenta() en
// parametros.js -- código de 4 dígitos del Banco se auto-llena y no se
// puede editar; el resto del número sí.
function onSelBancoCbe() {
  const sel     = document.getElementById('cbe-banco');
  const codEl   = document.getElementById('cbe-cod-banco');
  const restoEl = document.getElementById('cbe-num-cuenta-resto');
  if (!sel || !codEl) return;

  const id_banco = parseInt(sel.value);
  const banco = _cbeBancosCache.find(function(b) { return b.id === id_banco; });
  const codigo = banco && banco.codigo ? banco.codigo.replace(/\D/g,'').substring(0,4) : '';

  codEl.value = codigo;
  if (restoEl) { restoEl.value = ''; restoEl.focus(); }
  sincronizarNumeroCuentaCbe();
}

function sincronizarNumeroCuentaCbe() {
  const cod    = document.getElementById('cbe-cod-banco')?.value || '';
  const resto  = document.getElementById('cbe-num-cuenta-resto')?.value || '';
  const hidden = document.getElementById('cbe-numero-cuenta');
  if (hidden) hidden.value = (cod + resto).replace(/\s/g,'');
}

async function cbeCargarListado() {
  const cont = document.getElementById('cbe-listado-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const cuentasCbe = await api('param_cuentas_bancarias_empresa','GET',null,
      '?estado=eq.ACTIVA&order=alias.asc&select=id,alias,tipo_cuenta,numero_cuenta,moneda,param_bancos(nombre)'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
    if (!cuentasCbe || !cuentasCbe.length) {
      cont.innerHTML = '<div style="text-align:center;color:var(--suave);padding:24px;font-size:12px">Todavía no hay Cuentas Bancarias registradas.</div>';
      return;
    }
    cont.innerHTML = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">ALIAS</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">INSTITUCIÓN</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">TIPO</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">N° CUENTA</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">MONEDA</th>'
      + '</tr></thead><tbody>'
      + cuentasCbe.map(function(c) {
          const numMasked = c.numero_cuenta ? '****'+c.numero_cuenta.slice(-4) : '—';
          return '<tr>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);font-weight:600">'+(c.alias||'—')+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'+(c.param_bancos?.nombre||'—')+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'+(c.tipo_cuenta||'—')+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde);font-family:var(--font-mono)">'+numMasked+'</td>'
            + '<td style="padding:8px;border-bottom:1px solid var(--borde)">'+(c.moneda||'—')+'</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch(eCbeListado) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+msgErr(eCbeListado)+'</div>';
  }
}

async function guardarCuentaBancariaEmpresa() {
  const errEl = document.getElementById('alerta-cbe-err');
  errEl.style.display = 'none';

  const alias         = document.getElementById('cbe-alias').value.trim();
  const moneda         = document.getElementById('cbe-moneda').value;
  const idBancoCbe      = parseInt(document.getElementById('cbe-banco').value) || null;
  const tipoCuenta      = document.getElementById('cbe-tipo-cuenta').value;
  const numeroCuenta    = document.getElementById('cbe-numero-cuenta').value.trim();
  const idCuentaContableCbe = parseInt(document.getElementById('cbe-cuenta-contable').value) || null;

  if (!alias)              { errEl.textContent = 'Debe indicar un Alias.'; errEl.style.display = 'block'; return; }
  if (!idBancoCbe)          { errEl.textContent = 'Debe seleccionar la Institución Financiera.'; errEl.style.display = 'block'; return; }
  if (!tipoCuenta)          { errEl.textContent = 'Debe seleccionar el Tipo de Cuenta.'; errEl.style.display = 'block'; return; }
  if (!numeroCuenta)        { errEl.textContent = 'Debe indicar el Número de Cuenta.'; errEl.style.display = 'block'; return; }
  if (!idCuentaContableCbe) { errEl.textContent = 'Debe seleccionar la Cuenta Contable para el asiento.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('btn-cbe-guardar');
  btnSetGuardando(btn, true, null, 'Procesando...');
  try {
    await api('param_cuentas_bancarias_empresa','POST',{
      id_empresa:         _empresaActiva ? _empresaActiva.id_empresa : null,
      alias:              alias,
      id_banco:           idBancoCbe,
      tipo_cuenta:        tipoCuenta,
      numero_cuenta:      numeroCuenta,
      moneda:             moneda,
      id_cuenta_contable: idCuentaContableCbe,
      estado:             'ACTIVA'
    });
    document.getElementById('cbe-alias').value = '';
    document.getElementById('cbe-numero-cuenta').value = '';
    document.getElementById('cbe-tipo-cuenta').value = '';
    await cbeCargarListado();
    // Si el Traspaso está abierto y en la misma Moneda, refresca su
    // selector para que la cuenta recién creada aparezca de inmediato.
    if (document.getElementById('traspaso-cb-moneda')?.value === moneda) {
      await _traspasoCBActualizarCuentas();
    }
  } catch(eGuardarCbe) {
    errEl.textContent = 'Error: ' + msgErr(eGuardarCbe);
    errEl.style.display = 'block';
  } finally {
    btnSetGuardando(btn, false);
  }
}

async function abrirModalTraspasoCB() {
  if (!sesionActual?.administrador && !puedo('CONTABILIDAD','TRASPASO')) {
    alert('No tiene permiso para realizar Traspasos Caja/Banco.');
    return;
  }
  document.getElementById('traspaso-cb-fecha').value = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);
  document.getElementById('traspaso-cb-monto').value = '';
  document.getElementById('traspaso-cb-referencia').value = '';
  document.getElementById('traspaso-cb-concepto').value = '';
  document.getElementById('traspaso-cb-direccion').value = 'CAJA_A_BANCO';
  document.getElementById('traspaso-cb-clave').value = '';
  document.getElementById('traspaso-cb-usuario-nombre').textContent = sesionActual?.nombre || sesionActual?.correo_usuario || '—';
  const archivoElTrasp = document.getElementById('traspaso-cb-archivo');
  if (archivoElTrasp) archivoElTrasp.value = '';
  const previewContTrasp = document.getElementById('traspaso-cb-archivo-preview-cont');
  if (previewContTrasp) previewContTrasp.style.display = 'none';
  document.getElementById('alerta-traspaso-cb-err').style.display = 'none';

  const monedaPrincipal  = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  const monedaSecundaria = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
  const selMonedaTrasp = document.getElementById('traspaso-cb-moneda');
  selMonedaTrasp.innerHTML = '<option value="'+monedaPrincipal+'">'+monedaPrincipal+'</option>'
    + (monedaSecundaria !== monedaPrincipal ? '<option value="'+monedaSecundaria+'">'+monedaSecundaria+'</option>' : '');

  await _traspasoCBActualizarCuentas();
  abrirModal('modal-traspaso-cb');
}

// Repuebla Cuenta Caja (param_metodos_pago, sin cambios) y Cuenta
// Bancaria (ahora param_cuentas_bancarias_empresa -- Institución + Tipo +
// Número reales, no una cuenta contable abstracta) según la Moneda.
async function _traspasoCBActualizarCuentas() {
  const moneda = document.getElementById('traspaso-cb-moneda')?.value;
  if (!moneda) return;
  try {
    const metodosTrasp = await api('param_metodos_pago','GET',null,
      '?estado=eq.ACTIVO&codigo=eq.'+moneda+'&tipo_canal=eq.EFECTIVO&order=nombre.asc&select=id_metodo,nombre,tipo_canal,id_cuenta_contable');
    const selCaja = document.getElementById('traspaso-cb-cuenta-caja');
    selCaja.innerHTML = (metodosTrasp||[]).length
      ? metodosTrasp.map(function(m){ return '<option value="'+m.id_cuenta_contable+'" data-metodo="'+m.id_metodo+'">'+m.nombre+'</option>'; }).join('')
      : '<option value="">— Sin Cuenta de Caja en '+moneda+' —</option>';
  } catch(eCtasTrasp) { console.warn('Error cargando Cuenta Caja de Traspaso:', eCtasTrasp); }

  try {
    const cuentasBancTrasp = await api('param_cuentas_bancarias_empresa','GET',null,
      '?estado=eq.ACTIVA&moneda=eq.'+moneda+'&order=alias.asc&select=id,alias,tipo_cuenta,numero_cuenta,id_cuenta_contable,param_bancos(nombre)'
      + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
    const selCtaBanc = document.getElementById('traspaso-cb-cuenta-bancaria');
    selCtaBanc.innerHTML = (cuentasBancTrasp||[]).length
      ? (cuentasBancTrasp||[]).map(function(cb) {
          const numMasked = cb.numero_cuenta ? '****'+cb.numero_cuenta.slice(-4) : '';
          const label = cb.alias + ' — ' + (cb.param_bancos?.nombre||'') + ' — ' + (cb.tipo_cuenta||'') + ' — ' + numMasked;
          return '<option value="'+cb.id+'" data-cuenta-contable="'+cb.id_cuenta_contable+'">'+label+'</option>';
        }).join('')
      : '<option value="">— Sin Cuentas Bancarias en '+moneda+' —</option>';
  } catch(eCuentasBancTrasp) { console.warn('Error cargando Cuentas Bancarias de Traspaso:', eCuentasBancTrasp); }
}

async function guardarTraspasoCB() {
  const errEl = document.getElementById('alerta-traspaso-cb-err');
  errEl.style.display = 'none';

  const fecha       = document.getElementById('traspaso-cb-fecha').value;
  const direccion   = document.getElementById('traspaso-cb-direccion').value; // 'CAJA_A_BANCO' | 'BANCO_A_CAJA'
  const moneda      = document.getElementById('traspaso-cb-moneda').value;
  const idCtaCaja   = parseInt(document.getElementById('traspaso-cb-cuenta-caja').value) || null;
  const selCuentaBancTrasp = document.getElementById('traspaso-cb-cuenta-bancaria');
  const idCuentaBancaria   = parseInt(selCuentaBancTrasp.value) || null;
  const idCtaBanco  = parseInt(selCuentaBancTrasp.selectedOptions[0]?.dataset.cuentaContable) || null;
  const monto       = parseFloat(document.getElementById('traspaso-cb-monto').value) || 0;
  const referencia  = document.getElementById('traspaso-cb-referencia').value.trim();
  const concepto    = document.getElementById('traspaso-cb-concepto').value.trim();

  if (!fecha)                 { errEl.textContent = 'Debe indicar la Fecha.'; errEl.style.display = 'block'; return; }
  if (!idCtaCaja)              { errEl.textContent = 'Debe seleccionar la Cuenta de Caja.'; errEl.style.display = 'block'; return; }
  if (!idCuentaBancaria || !idCtaBanco) { errEl.textContent = 'Debe seleccionar la Cuenta Bancaria.'; errEl.style.display = 'block'; return; }
  if (!monto || monto <= 0)   { errEl.textContent = 'Debe indicar un Monto mayor a cero.'; errEl.style.display = 'block'; return; }
  if (!referencia)             { errEl.textContent = 'Debe indicar la Referencia/Comprobante.'; errEl.style.display = 'block'; return; }

  const claveTrasp = document.getElementById('traspaso-cb-clave')?.value || '';
  if (!claveTrasp) {
    errEl.textContent = 'Debe ingresar su contraseña para confirmar.'; errEl.style.display = 'block';
    document.getElementById('traspaso-cb-clave')?.focus(); return;
  }
  const validaClaveTrasp = await validarClaveUsuarioActual(claveTrasp);
  if (!validaClaveTrasp.ok) {
    errEl.textContent = validaClaveTrasp.msg; errEl.style.display = 'block';
    document.getElementById('traspaso-cb-clave')?.focus(); return;
  }

  const idCtaOrigen  = direccion === 'CAJA_A_BANCO' ? idCtaCaja  : idCtaBanco;
  const idCtaDestino = direccion === 'CAJA_A_BANCO' ? idCtaBanco : idCtaCaja;

  const btn = document.getElementById('btn-traspaso-cb-confirmar');
  btnSetGuardando(btn, true, null, 'Procesando...');
  try {
    // Validar saldo suficiente en la Cuenta de Origen -- se reutiliza la
    // MISMA fuente de verdad que el reporte de Caja/Bancos (la función
    // obtener_saldos_caja_bancos), para no calcular el saldo dos veces de
    // forma distinta y arriesgarnos a que no coincidan.
    const cuentasTodasTrasp = await obtenerCuentasContables();
    const ctaOrigenInfo  = cuentasTodasTrasp.find(function(c){ return c.id_cuenta === idCtaOrigen; });
    const ctaDestinoInfo = cuentasTodasTrasp.find(function(c){ return c.id_cuenta === idCtaDestino; });

    const respSaldos = await fetch(SUPABASE_URL + '/rest/v1/rpc/obtener_saldos_caja_bancos', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_id_empresa: window._contEmisorActivo || _empresaActiva?.id_empresa || null,
        p_moneda: moneda,
        p_fecha_desde: '2000-01-01',
        p_fecha_hasta: fecha
      })
    });
    if (respSaldos.ok) {
      const filasSaldos = await respSaldos.json() || [];
      const filaOrigen = filasSaldos.find(function(f){ return f.codigo === ctaOrigenInfo?.codigo; });
      const saldoOrigenActual = filaOrigen ? parseFloat(filaOrigen.saldo_cierre||0) : 0;
      if (saldoOrigenActual < monto) {
        errEl.textContent = 'Saldo insuficiente en '+(ctaOrigenInfo?.nombre||'la Cuenta de Origen')+'. Disponible: '+saldoOrigenActual.toFixed(2)+' '+moneda+'.';
        errEl.style.display = 'block';
        btnSetGuardando(btn, false);
        return;
      }
    }

    // Tasa BCV vigente (informativa -- el Traspaso no convierte moneda, es
    // el mismo monto en la misma Moneda en ambas cuentas; se registra la
    // tasa solo para mantener consistencia con el resto de los asientos,
    // que siempre llevan ambas columnas USD/VES).
    let tasaTrasp = 1;
    try {
      const tasasTrasp = await api('tasas','GET',null,'?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      if (tasasTrasp.length) tasaTrasp = parseFloat(tasasTrasp[0].tipo_cambio);
    } catch(eTasaTrasp) {}

    const montoUSD = moneda === 'USD' ? monto : parseFloat((monto / tasaTrasp).toFixed(2));
    const montoVES = moneda === 'VES' ? monto : parseFloat((monto * tasaTrasp).toFixed(2));

    const anioTrasp = new Date().getFullYear();
    const existTrasp = await api('cont_asientos','GET',null,
      '?numero_asiento=like.AST-'+anioTrasp+'-*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
    let seqTrasp = 1;
    if (existTrasp.length) { const p = existTrasp[0].numero_asiento.split('-'); seqTrasp = parseInt(p[p.length-1])+1; }
    const numAstTrasp = 'AST-'+anioTrasp+'-'+String(seqTrasp).padStart(4,'0');

    const periodosTrasp = await api('cont_periodos','GET',null,
      '?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_empresa=eq.'+(_empresaActiva?.id_empresa||0));
    const idPeriodoTrasp = periodosTrasp.length ? periodosTrasp[0].id_periodo : null;

    const direccionTexto = direccion === 'CAJA_A_BANCO' ? 'Caja → Banco' : 'Banco → Caja';
    const descAsientoTrasp = 'Traspaso ' + direccionTexto + (concepto ? ': ' + concepto : '');

    const asientoTrasp = await api('cont_asientos','POST',{
      numero_asiento: numAstTrasp,
      fecha:          fecha,
      descripcion:    descAsientoTrasp,
      tipo:           'TRASPASO_CAJA_BANCO',
      referencia:     referencia,
      moneda_base:    ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(),
      tasa_bcv:       tasaTrasp,
      id_periodo:     idPeriodoTrasp,
      id_empresa:     _empresaActiva ? _empresaActiva.id_empresa : null,
      estado:         'APROBADO',
      id_usuario:     sesionActual.correo_usuario
    });
    if (!asientoTrasp || !asientoTrasp[0]) throw new Error('No se pudo crear el asiento del Traspaso.');
    const idAstTrasp = asientoTrasp[0].id_asiento;

    await api('cont_asiento_lineas','POST',{
      id_asiento: idAstTrasp, id_cuenta: idCtaDestino, orden: 1,
      descripcion: 'Traspaso ' + direccionTexto + ' -- ' + (ctaDestinoInfo?.nombre||''),
      debe_usd: montoUSD, haber_usd: 0, debe_ves: montoVES, haber_ves: 0, tasa_bcv: tasaTrasp
    });
    await api('cont_asiento_lineas','POST',{
      id_asiento: idAstTrasp, id_cuenta: idCtaOrigen, orden: 2,
      descripcion: 'Traspaso ' + direccionTexto + ' -- ' + (ctaOrigenInfo?.nombre||''),
      debe_usd: 0, haber_usd: montoUSD, debe_ves: 0, haber_ves: montoVES, tasa_bcv: tasaTrasp
    });

    // Subir comprobante (opcional) y registrar el detalle propio del
    // proceso -- mismo patrón que Ventas/Facturas/CxC/CxP: el asiento
    // contable queda genérico, y los datos específicos del Traspaso (Banco,
    // comprobante) viven en su propia tabla de negocio, enlazada por
    // id_asiento.
    let urlComprobanteTrasp = null;
    const archivoElTrasp = document.getElementById('traspaso-cb-archivo');
    if (archivoElTrasp && archivoElTrasp.files && archivoElTrasp.files[0]) {
      try {
        urlComprobanteTrasp = await subirFoto(archivoElTrasp.files[0], 'comprobantes-traspaso/' + idAstTrasp);
      } catch(eFileTrasp) { console.warn('Error subiendo comprobante de Traspaso:', eFileTrasp); }
    }

    await api('cont_traspasos_cb','POST',{
      id_empresa:        _empresaActiva ? _empresaActiva.id_empresa : null,
      id_asiento:        idAstTrasp,
      fecha:             fecha,
      direccion:         direccion,
      moneda:            moneda,
      id_cuenta_origen:  idCtaOrigen,
      id_cuenta_destino: idCtaDestino,
      id_cuenta_bancaria_empresa: idCuentaBancaria,
      monto:             monto,
      monto_usd:         montoUSD,
      monto_ves:         montoVES,
      referencia:        referencia,
      concepto:          concepto || null,
      url_comprobante:   urlComprobanteTrasp,
      id_usuario:        sesionActual.correo_usuario
    });

    cerrarModal('modal-traspaso-cb');
    await cbConsultarSaldos();
    await cbCargarTraspasosRecientes();
  } catch(eGuardarTrasp) {
    errEl.textContent = 'Error: ' + msgErr(eGuardarTrasp);
    errEl.style.display = 'block';
  } finally {
    btnSetGuardando(btn, false);
  }
}

async function contRenderCxc() {
  const cont = document.getElementById('cont-vista-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const facturas = await api('facturas','GET',null,'?estado=neq.ANULADA&order=fecha_emision.desc&select=*,propietarios(nombre_completo),cont_cxc(pagado_usd,saldo_usd,fecha_cobro,monto_usd)'+emisorQ());
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
      PAGADA:'<span class="badge" style="background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3)">Cobrada</span>',
      PARCIAL:'<span class="badge badge-gris">Parcial</span>',
    };

    const filas = facturas.map(function(f) {
      const tusd = parseFloat(f.total_usd||0);
      const tves = parseFloat(f.total_ves||0);
      // Los datos reales de cobro viven en cont_cxc, no en facturas -- se
      // asume una sola CxC por factura (mismo criterio que verFichaFactura).
      const cxc = (f.cont_cxc && f.cont_cxc[0]) || null;
      const cobUSD = parseFloat(cxc?.pagado_usd||0);
      const saldoUSD = cxc ? parseFloat(cxc.saldo_usd||0) : (tusd - cobUSD);
      // El cobrado/saldo no siempre se guarda en VES por separado -- se
      // aproxima con la misma proporción del total, para no inventar una
      // tasa de conversión adicional. Excepción: si ya está totalmente
      // pagada, se usa el Total en Bs EXACTO en vez de la proporción --
      // de lo contrario, una diferencia mínima de centavos en el USD
      // guardado se amplifica al multiplicar por un monto grande en Bs.
      const totalmentePagada = saldoUSD <= 0.005;
      const propUSD = tusd > 0 ? cobUSD / tusd : 0;
      const cobVES  = totalmentePagada ? tves : tves * propUSD;
      const saldoVES = totalmentePagada ? 0 : tves - cobVES;
      const cliente = f.propietarios ? f.propietarios.nombre_completo : (f.receptor_nombre || '--');
      return '<tr>'
        +'<td style="padding:4px 8px;font-size:10px;font-family:var(--font-mono);color:var(--naranja)">'+(f.numero_factura||'--')+'</td>'
        +'<td style="padding:4px 8px;font-size:11px">'+fmtFecha(f.fecha_emision)+'</td>'
        +'<td style="padding:4px 8px;font-size:11px">'+cliente+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono)">'+((tusd>0||tves>0)?fmtMonto(tusd,tves):'--')+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono)">'+((cobUSD>0||cobVES>0)?fmtMonto(cobUSD,cobVES):'--')+'</td>'
        +'<td style="padding:4px 8px;text-align:right;font-size:10px;font-family:var(--font-mono);color:'+(saldoUSD>0?'#fc8181':'#22c55e')+'">'+((tusd>0||tves>0)?fmtMonto(saldoUSD,saldoVES):'--')+'</td>'
        +'<td style="padding:4px 8px">'+(cxc?.fecha_cobro?fmtFecha(cxc.fecha_cobro):'--')+'</td>'+'<td style="padding:4px 8px">'+(eb[f.estado]||f.estado)+'</td>'
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
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+msgErr(e)+'</div>';
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
        ? '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="width:100%;border-collapse:collapse"><thead><tr>'
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
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: '+msgErr(e)+'</div>';
  }
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
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
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
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 410px))"><table style="width:100%"><thead><tr>'
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
  } catch(e) { alert('Error al eliminar: '+msgErr(e)); }
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
  } catch(e) { errEl.textContent='Error: ' + msgErr(e); errEl.style.display='block'; }
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
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
    + '<th>Período</th><th>Fecha Inicio</th><th>Fecha Fin</th><th>Estado</th><th>Acción</th>'
    + '</tr></thead><tbody>'
    + contPeriodosCache.map(function(p) {
        return '<tr>'
          + '<td style="font-weight:600">' + p.nombre + '</td>'
          + '<td style="font-size:12px">' + fmtFecha(p.fecha_inicio) + '</td>'
          + '<td style="font-size:12px">' + fmtFecha(p.fecha_fin) + '</td>'
          + '<td><span class="badge ' + (p.estado==='ABIERTO'?'badge-verde':'badge-gris') + '">' + p.estado + '</span></td>'
          + '<td><div style="display:flex;gap:6px">'
          + (p.estado==='ABIERTO' ? '<button class="btn-secundario" style="font-size:11px;color:#fc8181;border-color:rgba(252,129,129,0.4)" onclick="btnSetGuardando(this,true,null,\'Procesando...\');contCerrarPeriodo(' + p.id_periodo + ',\'' + p.nombre + '\').finally(()=>btnSetGuardando(this,false))">🔒 Cerrar</button>' : '')
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
  } catch(e) { errEl.textContent='Error: ' + msgErr(e); errEl.style.display='block'; }
}

async function contCerrarPeriodo(id, nombre) {
  if (!confirm('¿Cerrar el período "' + nombre + '"?\nNo se podrán crear asientos en este período una vez cerrado.')) return;
  try {
    await api('cont_periodos','PATCH',{ estado:'CERRADO' },'?id_periodo=eq.'+id);
    contRenderPeriodos();
  } catch(e) { alert('Error: ' + msgErr(e)); }
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
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%">'
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
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error cargando tributos: ' + msgErr(e) + '</div>';
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
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
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
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>';
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
    + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 440px))"><table style="table-layout:fixed;width:100%">'
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
  } catch(e) { alert('Error: ' + msgErr(e)); }
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
  } catch(e) { alert('Error al eliminar: '+msgErr(e)); }
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
  } catch(e) { errEl.textContent = 'Error: ' + msgErr(e); errEl.style.display = 'block'; }
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
    const _todasCtasAst = await obtenerCuentasContables();

    // Buscar cuenta de inventario
    let idInv = datos.id_cuentaInventario || null;
    if (!idInv) { const cInv = _todasCtasAst.find(function(c){ return c.codigo === '1.1.03.001'; }); idInv = cInv ? cInv.id_cuenta : null; }

    // Buscar o crear cuenta auxiliar de área
    let id_areaCuenta = null;
    if (datos.areaId && datos.areaNombre) {
      const codigoArea = '6.1.01.' + String(datos.areaId).padStart(3,'0');
      let cArea = _todasCtasAst.filter(function(c){ return c.codigo === codigoArea; });
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
          const reCheck = (await obtenerCuentasContables(true)).filter(function(c){ return c.codigo === codigoArea; });
          if (reCheck.length) id_areaCuenta = reCheck[0].id_cuenta;
        }
      } else {
        id_areaCuenta = cArea[0].id_cuenta;
      }
    }

    // Buscar cuenta de proveedores
    const cProv = _todasCtasAst.find(function(c){ return c.codigo === '2.1.01.001'; });
    const idProv = cProv ? cProv.id_cuenta : null;

    // ── Líneas según tipo ──
    // VEN-NIF: Moneda funcional = Bs. USD es auxiliar de referencia
    const montoBs  = monto * tasa;
    const auxDesc  = '';

    if (tipo === 'ENTRADA_COMPRA') {
      const IVA_RATE   = tasaIVAActual();
      const exentoIVA  = datos.exentoIVA  || false;
      const incluyeIVA = datos.incluyeIVA || false;
      const montoTotalUSD = datos.totalExactoUSD !== undefined && datos.totalExactoUSD !== null ? datos.totalExactoUSD : monto;
      const montoTotalBs  = datos.totalExactoBs  !== undefined && datos.totalExactoBs  !== null ? datos.totalExactoBs  : montoBs;
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
        // Monto NO incluye IVA — calcular y sumar (o usar los valores exactos)
        baseUSD  = baseExactaUSD !== null ? baseExactaUSD : montoTotalUSD;
        baseBs   = baseExactaBs  !== null ? baseExactaBs  : montoTotalBs;
        if (datos.totalExactoUSD != null || datos.totalExactoBs != null) {
          // Total ya viene congelado -- el IVA se deriva por resta (total -
          // base), igual que en las otras dos ramas, para que DEBE y HABER
          // cuadren exacto contra el monto real, sin volver a calcular el
          // IVA con la tasa por su cuenta.
          totalUSD = montoTotalUSD;
          totalBs  = montoTotalBs;
          ivaUSD   = parseFloat((totalUSD - baseUSD).toFixed(4));
          ivaBs    = parseFloat((totalBs  - baseBs).toFixed(2));
        } else {
          ivaUSD   = parseFloat((baseUSD * IVA_RATE).toFixed(4));
          ivaBs    = parseFloat((baseBs  * IVA_RATE).toFixed(2));
          totalUSD = parseFloat((baseUSD + ivaUSD).toFixed(4));
          totalBs  = parseFloat((baseBs  + ivaBs).toFixed(2));
        }
      }

      // Buscar cuenta IVA Crédito Fiscal
      const cIVA = _todasCtasAst.find(function(c){ return c.codigo === '1.1.04.001'; });
      const idIVA = cIVA ? cIVA.id_cuenta : null;

      // DEBE: Inventario (base sin IVA)
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:1,
        descripcion: 'Compra de Artículos Entrada de Inventario N° ' + (datos.referencia || ''),
        debe_usd: baseUSD, haber_usd: 0, debe_ves: baseBs, haber_ves: 0 });

      // DEBE: Crédito Fiscal IVA (solo si aplica)
      if (!exentoIVA && idIVA && ivaUSD > 0) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idIVA, orden:2,
        descripcion: 'Pago IVA (' + Math.round(IVA_RATE*100) + '%) Compra de Artículos Entrada de Inventario (' + (datos.referencia || '') + ')',
        debe_usd: ivaUSD, haber_usd: 0, debe_ves: ivaBs, haber_ves: 0 });

      // DEBE: IGTF Pagado -- gasto NO deducible/NO acreditable (a diferencia
      // del IVA), no afecta el costo del Inventario ni el Crédito Fiscal --
      // solo aumenta lo que se le debe al Proveedor. Solo se agrega si esta
      // Entrada fue congelada con IGTF aplicable (moneda_facturacion USD +
      // Proveedor Contribuyente Especial).
      const montoIGTF_USD = datos.montoIGTF_USD || 0;
      const montoIGTF_BS  = datos.montoIGTF_BS  || 0;
      if (montoIGTF_USD > 0) {
        const cIGTF = _todasCtasAst.find(function(c){ return c.codigo === '6.1.04.003'; });
        const idIGTF = cIGTF ? cIGTF.id_cuenta : null;
        if (idIGTF) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idIGTF, orden:3,
          descripcion: 'Gasto IGTF pago Factura ' + (datos.referencia || ''),
          debe_usd: montoIGTF_USD, haber_usd: 0, debe_ves: montoIGTF_BS, haber_ves: 0 });
      }

      // HABER: CxP Proveedores (monto total con IVA + IGTF, si aplica)
      if (idProv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idProv, orden:4,
        descripcion: 'CxP Compra N° ' + (datos.referencia || '') + ' a ' + (datos.proveedorNombre || datos.articulo),
        debe_usd: 0, haber_usd: totalUSD + montoIGTF_USD, debe_ves: 0, haber_ves: totalBs + montoIGTF_BS });

    } else if (tipo === 'ENTRADA_DEVOLUCION') {
      // Débito: Inventario Bs / Crédito: Costo Área Bs
      // (uso legado — hoy Devolución de Cliente genera su propio reverso de
      // Ingreso/Costo de Venta vinculado a la factura, ver guardarEntradaStock)
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:1,
        descripcion:'Entrada '+datos.articulo+auxDesc,
        debe_usd:monto, haber_usd:0, debe_ves:montoBs, haber_ves:0 });
      if (id_areaCuenta) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:id_areaCuenta, orden:2,
        descripcion:'Crédito área '+datos.areaNombre+auxDesc,
        debe_usd:0, haber_usd:monto, debe_ves:0, haber_ves:montoBs });

    } else if (tipo === 'ENTRADA_AJUSTE') {
      // Sobrante de inventario (conteo físico encontró MÁS de lo que dice el sistema).
      // No es reverso de nada — es un evento contable propio: Ganancia por Ajuste.
      // Reutiliza la misma cuenta que ya existe para el residuo de redondeo (4.2.02.001).
      const cIngresoAjuste = _todasCtasAst.find(function(c){ return c.codigo === '4.2.02.001'; });
      const idIngresoAjuste = cIngresoAjuste ? cIngresoAjuste.id_cuenta : null;
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:1,
        descripcion:'Sobrante de Inventario (Ajuste): '+datos.articulo+auxDesc,
        debe_usd:monto, haber_usd:0, debe_ves:montoBs, haber_ves:0 });
      if (idIngresoAjuste) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idIngresoAjuste, orden:2,
        descripcion:'Ganancia por Ajuste de Inventario: '+datos.articulo+auxDesc,
        debe_usd:0, haber_usd:monto, debe_ves:0, haber_ves:montoBs });

    } else if (tipo === 'SALIDA_AJUSTE') {
      // Faltante de inventario (conteo físico encontró MENOS de lo que dice el sistema).
      // Tampoco es reverso de nada — evento contable propio: Pérdida por Ajuste.
      // Reutiliza la cuenta que ya existe para el residuo de redondeo (6.2.02.001).
      const cGastoAjuste = _todasCtasAst.find(function(c){ return c.codigo === '6.2.02.001'; });
      const idGastoAjuste = cGastoAjuste ? cGastoAjuste.id_cuenta : null;
      const montoBsSalAj = parseFloat((monto * tasa).toFixed(2));
      if (idGastoAjuste) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idGastoAjuste, orden:1,
        descripcion:'Pérdida por Ajuste de Inventario: '+datos.articulo+auxDesc,
        debe_usd:monto, haber_usd:0, debe_ves:montoBsSalAj, haber_ves:0 });
      if (idInv) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idInv, orden:2,
        descripcion:'Faltante de Inventario (Ajuste): '+datos.articulo+auxDesc,
        debe_usd:0, haber_usd:monto, debe_ves:0, haber_ves:montoBsSalAj });

    } else if (tipo === 'SALIDA_AREA') {
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

    const _todasCtasGasto = await obtenerCuentasContables();
    let idCtaIVA = null;
    if (!datos.exentoIVA) {
      const cIVA = _todasCtasGasto.find(function(c){ return c.codigo === '1.1.04.001'; });
      idCtaIVA = cIVA ? cIVA.id_cuenta : null;
    }
    let idCtaCxP = null;
    { const cProv = _todasCtasGasto.find(function(c){ return c.codigo === '2.1.01.001'; });
      idCtaCxP = cProv ? cProv.id_cuenta : null; }

    // IGTF -- gasto NO deducible/NO acreditable (a diferencia del IVA), no
    // afecta la Cuenta de Gasto -- solo aumenta lo que se le debe al
    // Proveedor. Igual criterio y misma cuenta que en Entradas de Compra.
    const montoIGTF_USD = datos.montoIGTF_USD || 0;
    const montoIGTF_BS  = datos.montoIGTF_BS  || 0;

    let orden = 1;
    const textoLinea = datos.concepto || datos.descripcion || '';
    if (datos.id_cuentaGasto) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:datos.id_cuentaGasto, orden:orden++,
        descripcion: textoLinea,
        debe_usd: baseUSD, haber_usd:0, debe_ves: baseBs, haber_ves:0, tasa_bcv: tasa });
    }
    if (idCtaIVA && ivaUSD > 0) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idCtaIVA, orden:orden++,
        descripcion: textoLinea,
        debe_usd: ivaUSD, haber_usd:0, debe_ves: ivaBs, haber_ves:0, tasa_bcv: tasa });
    }
    if (montoIGTF_USD > 0) {
      const cIGTF = _todasCtasGasto.find(function(c){ return c.codigo === '6.1.04.003'; });
      const idCtaIGTF = cIGTF ? cIGTF.id_cuenta : null;
      if (idCtaIGTF) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idCtaIGTF, orden:orden++,
        descripcion: 'IGTF (' + (datos.tasaIGTF ? Math.round(datos.tasaIGTF*100) : 3) + '%) — ' + textoLinea,
        debe_usd: montoIGTF_USD, haber_usd:0, debe_ves: montoIGTF_BS, haber_ves:0, tasa_bcv: tasa });
    }
    if (idCtaCxP) {
      await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:idCtaCxP, orden:orden++,
        descripcion: textoLinea,
        debe_usd:0, haber_usd: montoTotalUSD + montoIGTF_USD, debe_ves:0, haber_ves: montoTotalBs + montoIGTF_BS, tasa_bcv: tasa });
    }

    console.log('✓ Asiento gasto manual creado:', numAst);
  } catch(eAstGasto) { console.warn('Error asiento gasto manual:', eAstGasto); }
}


