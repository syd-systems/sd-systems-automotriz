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
      '<h3 id="pagos-contador">Pagos</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (puedo('PAGOS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoPago()">+ Nueva CxP</button>' : '') +
      '</div></div>' +
      '<div style="padding:12px 24px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--borde)">' +
      '<input id="pagos-buscar" placeholder="🔍 Buscar..." style="' + inputStyle() + ';flex:1;min-width:160px" oninput="cargarPagosDesdeUI()">' +'<input id="pagos-referencia" placeholder="🔍 N° Referencia" style="' + inputStyle() + ';min-width:140px" oninput="cargarPagosDesdeUI()">' +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Desde</span>' +'<input type="date" id="pagos-fecha-desde" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()"></div>' +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;color:var(--suave)">Hasta</span>' +'<input type="date" id="pagos-fecha-hasta" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()"></div>' +
      '<select id="pagos-tipo" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()">' +
      '<option value="">Todos los estados</option>' +
      '<option value="BORRADOR">Borrador</option>' +
      '<option value="APROBADO">Aprobado</option>' +
      '<option value="PAGADO">Pagado</option>' +
      '<option value="ANULADO">Anulado</option>' +
      '</select>' +
      '<select id="pagos-tipo" style="' + inputStyle() + '" onchange="cargarPagosDesdeUI()">' +
      '<option value="">Todos los tipos</option>' +
      TIPOS_PAGO.map(function(t){ return '<option value="'+t.value+'">'+t.label+'</option>'; }).join('') +
      '</select>' +
      '</div>' +
      '<div id="pagos-tabla-cont" style="padding:0"></div>' +
      '</div>';
  }

  // Restaurar filtros
  const elEstado = document.getElementById('pagos-estado');
  const elTipo   = document.getElementById('pagos-tipo');
  if (filtroEstado !== undefined && elEstado) elEstado.value = filtroEstado || '';
  if (filtroTipo   !== undefined && elTipo)   elTipo.value   = filtroTipo   || '';

  const fEstado = document.getElementById('pagos-estado')?.value || '';
  const fTipo   = document.getElementById('pagos-tipo')?.value || '';
  const fBuscar = busqueda || document.getElementById('pagos-buscar')?.value || '';

  let q = '?order=fecha_registro.desc&select=*' + emisorQ();
  if (fEstado) q += '&estado=eq.' + fEstado;
  if (fTipo)   q += '&tipo_pago=eq.' + fTipo;

  const pagos = await api('pagos','GET',null,q);
  pagosCache = pagos;

  const fRef   = (filtroRef   || document.getElementById('pagos-referencia')?.value  || '').toLowerCase();
  const fDesde = filtroDesde || document.getElementById('pagos-fecha-desde')?.value  || '';
  const fHasta = filtroHasta || document.getElementById('pagos-fecha-hasta')?.value  || '';

  const filtrados = pagos.filter(function(p){
    if (fBuscar) {
      const s = fBuscar.toLowerCase();
      if (!(p.numero_pago||'').toLowerCase().includes(s)
        && !(p.descripcion||'').toLowerCase().includes(s)
        && !(p.nombre_beneficiario||'').toLowerCase().includes(s)) return false;
    }
    if (fRef    && !(p.referencia||'').toLowerCase().includes(fRef)) return false;
    if (fDesde  && (p.fecha_pago||'').substring(0,10) < fDesde) return false;
    if (fHasta  && (p.fecha_pago||'').substring(0,10) > fHasta) return false;
    return true;
  });

  document.getElementById('pagos-contador').textContent = 'Pagos (' + filtrados.length + ')';

  // Alertas de recurrentes próximos a vencer
  const hoy = new Date();
  const en7dias = new Date(hoy); en7dias.setDate(en7dias.getDate()+7);
  const proximos = pagos.filter(function(p){
    if (!p.es_recurrente || !p.fecha_proxima || p.estado === 'ANULADO') return false;
    const fp = new Date(p.fecha_proxima);
    return fp <= en7dias;
  });

  const cont = document.getElementById('pagos-tabla-cont');

  let alertaHtml = '';
  if (proximos.length) {
    alertaHtml = '<div class="alerta" style="display:block;margin:12px 24px;background:rgba(255,107,0,0.1);border:1px solid rgba(255,107,0,0.3);border-radius:6px;padding:10px 14px">' +
      '⚠️ <strong>' + proximos.length + ' pago(s) recurrente(s)</strong> próximos a vencer: ' +
      proximos.map(function(p){ return '<span style="color:var(--naranja)">' + p.descripcion + ' (' + fmtFecha(p.fecha_proxima) + ')</span>'; }).join(', ') +
      '</div>';
  }

  if (!filtrados.length) {
    cont.innerHTML = alertaHtml + '<div style="text-align:center;padding:40px;color:var(--suave)">Sin pagos registrados.</div>';
    return;
  }

  const estadoBadge = {
    'BORRADOR': '<span class="badge badge-gris">Borrador</span>',
    'APROBADO': '<span class="badge badge-naranja">Aprobado</span>',
    'PAGADO':   '<span class="badge" style="background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3)">Pagado</span>',
    'ANULADO':  '<span class="badge" style="background:rgba(252,129,129,0.15);color:#fc8181;border:1px solid rgba(252,129,129,0.3)">Anulado</span>',
  };

  const filas = filtrados.map(function(p) {
    const tipo = TIPOS_PAGO.find(function(t){ return t.value === p.tipo_pago; });
    const metodo = METODOS_PAGO_PAGOS.find(function(m){ return m.value === p.metodo_pago; });
    return '<tr style="cursor:pointer" onclick="abrirFichaPago('+p.id_pago+')">' +
      '<td style="padding:10px 14px;font-size:12px;font-family:var(--font-mono);color:var(--naranja)">' + (p.numero_pago||'—') + '</td>' +
      '<td style="padding:10px 14px;font-size:12px">' + (tipo ? tipo.label : p.tipo_pago) + '</td>' +
      '<td style="padding:10px 14px;font-size:13px;font-weight:500">' + (p.descripcion||'—') + '<br><span style="font-size:11px;color:var(--suave)">' + (p.nombre_beneficiario||'') + '</span></td>' +
      '<td style="padding:10px 14px;font-size:13px;font-family:var(--font-mono);text-align:right">' +
        (p.monto_ves ? '<strong>Bs '+fmtVES(p.monto_ves)+'</strong>' : (p.monto_usd ? '<strong>Bs '+fmtVES(parseFloat(p.monto_usd)*(parseFloat(p.tasa_bcv)||1))+'</strong>' : '—')) +
        (p.monto_usd ? '<br><span style="font-size:11px;color:var(--suave)">$ '+fmtUSD(p.monto_usd)+'</span>' : '') +
      '</td>' +
      '<td style="padding:10px 14px;font-size:12px">' + (metodo ? metodo.label : (p.metodo_pago||'—')) + '</td>' +
      '<td style="padding:10px 14px;font-size:12px">' + (p.fecha_pago ? fmtFecha(p.fecha_pago) : '—') + (p.es_recurrente ? ' <span style="font-size:10px;color:var(--naranja)">🔄</span>' : '') + '</td>' +
      '<td style="padding:10px 14px">' + (estadoBadge[p.estado]||p.estado) + '</td>' +
      '<td style="padding:10px 14px">' +
        '<button class="btn-secundario" style="font-size:11px;padding:4px 12px" onclick="event.stopPropagation();abrirFichaPago('+p.id_pago+')">Ver</button>' +
      '</td>' +
      '</tr>';
  }).join('');

  cont.innerHTML = alertaHtml +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
    '<thead><tr style="border-bottom:2px solid var(--borde)">' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">N°</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Tipo</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Descripción</th>' +
    '<th style="padding:10px 14px;text-align:right;font-size:11px;color:var(--suave)">Monto</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Método</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Cancelado</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Estado</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--suave)">Acción</th>' +
    '</tr></thead><tbody>' + filas + '</tbody></table></div>';
}

// ── Abrir nuevo pago ──
async function abrirNuevoPago() {
  _pagoEditando = null;
  await poblarFormPago(null);
  document.getElementById('pago-modal-titulo').textContent = 'NUEVA CUENTA POR PAGAR';
  document.getElementById('alerta-pago-ok').style.display = 'none';
  document.getElementById('alerta-pago-err').style.display = 'none';
  abrirModal('modal-pago');
}

async function abrirEditarPago(id) {
  _pagoEditando = pagosCache.find(function(p){ return p.id_pago === id; });
  if (!_pagoEditando) return;
  await poblarFormPago(_pagoEditando);
  document.getElementById('pago-modal-titulo').textContent = 'EDITAR CUENTA POR PAGAR';
  abrirModal('modal-pago');
}

async function poblarFormPago(p) {
  // Cargar tasas
  const tasas = await api('tasas','GET',null,'?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
  const tasa = tasas.length ? parseFloat(tasas[0].tipo_cambio) : 1;
  document.getElementById('pago-tasa').value = tasa.toFixed(4);

  // Cargar proveedores
  const provs = await api('proveedores','GET',null,'?order=nombre.asc&select=id_proveedor,nombre&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
  const selProv = document.getElementById('pago-proveedor');
  selProv.innerHTML = '<option value="">— Sin proveedor —</option>' +
    provs.map(function(pr){ return '<option value="'+pr.id_proveedor+'">' + pr.nombre + '</option>'; }).join('');

  // Cargar empleados
  const emps = await api('empleados','GET',null,'?order=nombre_completo.asc&select=id_empleado,nombre_completo'+emisorQ());
  const selEmp = document.getElementById('pago-empleado');
  selEmp.innerHTML = '<option value="">— Sin empleado —</option>' +
    emps.map(function(e){ return '<option value="'+e.id_empleado+'">'+e.nombre_completo+'</option>'; }).join('');

  // Cargar cuentas de gasto
  await contCargarCuentas();
  const cuentasGasto = contCuentasCache.filter(function(c){ return c.permite_movimiento && (c.codigo.startsWith('5') || c.codigo.startsWith('6')); });
  const selGasto = document.getElementById('pago-cuenta-gasto');
  selGasto.innerHTML = '<option value="">— Seleccionar cuenta —</option>' +
    cuentasGasto.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');

  // Llenar campos si editando
  // Poblar select de tipos
  const selTipo = document.getElementById('pago-tipo');
  selTipo.innerHTML = '<option value="">— Seleccionar —</option>' +
    TIPOS_PAGO.map(function(t){ return '<option value="'+t.value+'">'+t.label+'</option>'; }).join('');
  document.getElementById('pago-tipo').value          = p ? p.tipo_pago : 'OTRO';
  document.getElementById('pago-descripcion').value   = p ? p.descripcion : '';
  document.getElementById('pago-beneficiario').value  = p ? (p.nombre_beneficiario||'') : '';
  document.getElementById('pago-monto-usd').value     = p ? (p.monto_usd||'') : '';
  document.getElementById('pago-monto-ves').value     = p ? (p.monto_ves||'') : '';
  document.getElementById('pago-moneda').value        = p ? (p.moneda_pago||'USD') : 'USD';
  document.getElementById('pago-fecha-venc').value    = p ? (p.fecha_vencimiento||'') : '';
  document.getElementById('pago-referencia').value    = p ? (p.referencia||'') : '';
  document.getElementById('pago-observaciones').value = p ? (p.observaciones||'') : '';
  document.getElementById('pago-recurrente').checked  = p ? !!p.es_recurrente : false;
  document.getElementById('pago-frecuencia').value    = p ? (p.frecuencia||'MENSUAL') : 'MENSUAL';
  if (p && p.id_beneficiario) selProv.value = p.id_beneficiario;
  if (p && p.id_empleado)     selEmp.value  = p.id_empleado;
  if (p && p.id_cuenta_gasto) selGasto.value = p.id_cuenta_gasto;
  onCambiarTipoPago();
  onToggleRecurrente();
  onCambiarMontoPago();

  // Al cambiar empleado en nómina, cargar su salario
  selEmp.onchange = async function() {
    if (document.getElementById('pago-tipo').value !== 'NOMINA') return;
    const idEmp = parseInt(this.value);
    if (!idEmp) return;
    try {
      const empData = await api('empleados','GET',null,'?id_empleado=eq.'+idEmp+'&select=monto_salario,moneda_calculo,moneda_pago,nombre_completo,id_calculo_salario,id_frecuencia_pago');
      if (empData.length) {
        const emp = empData[0];
        if (emp.monto_salario) {
          const moneda    = emp.moneda_calculo || 'USD';
          const salBase   = parseFloat(emp.monto_salario) || 0;
          const idCalc    = emp.id_calculo_salario;  // 3=hora,4=día,5=mes,7=semana
          const idFreq    = emp.id_frecuencia_pago;  // 1=semanal,2=quincenal,3=diario,4=mensual,5=por hora

          // Cargar nombres de frecuencia y cálculo para mostrar en descripción
          let montoAPagar = salBase;

          // Paso 1: convertir salario base a mensual según unidad de cálculo
          // id_calculo: 3=hora, 4=día, 5=mes, 7=semana
          const aMonthly = { 3: 160, 4: 30, 5: 1, 7: 4.33 };
          const salMensual = idCalc && aMonthly[idCalc]
            ? salBase * aMonthly[idCalc]
            : salBase;

          // Paso 2: dividir según frecuencia de pago
          // id_frecuencia: 1=semanal, 2=quincenal, 3=diario, 4=mensual, 5=por hora
          const divisorFreq = { 1: 4.33, 2: 2, 3: 30, 4: 1, 5: 240 }; // 5=hora: 30días×8hrs
          const divisor = idFreq && divisorFreq[idFreq] ? divisorFreq[idFreq] : 1;
          montoAPagar = salMensual / divisor;

          document.getElementById('pago-moneda').value = moneda;
          if (moneda === 'USD') {
            document.getElementById('pago-monto-usd').value = montoAPagar.toFixed(4);
          } else {
            document.getElementById('pago-monto-ves').value = montoAPagar.toFixed(2);
          }
          document.getElementById('pago-beneficiario').value = emp.nombre_completo || '';
          onCambiarMontoPago();
        }
      }
    } catch(e) {}
  };
}

function cargarPagosDesdeUI() {
  const est   = document.getElementById('pagos-estado')?.value || '';
  const tipo  = document.getElementById('pagos-tipo')?.value || '';
  const bus   = document.getElementById('pagos-buscar')?.value || '';
  const ref   = document.getElementById('pagos-referencia')?.value || '';
  const desde = document.getElementById('pagos-fecha-desde')?.value || '';
  const hasta = document.getElementById('pagos-fecha-hasta')?.value || '';
  cargarPagos(est, tipo, bus, ref, desde, hasta);
}

function onCambiarTipoPago() {
  const tipo = document.getElementById('pago-tipo').value;
  const provRow  = document.getElementById('pago-row-proveedor');
  const empRow   = document.getElementById('pago-row-empleado');
  const cuentaRow = document.getElementById('pago-row-cuenta-gasto');
  if (provRow)   provRow.style.display   = tipo === 'PROVEEDOR' ? '' : 'none';
  if (empRow)    empRow.style.display    = tipo === 'NOMINA' ? '' : 'none';
  if (cuentaRow) cuentaRow.style.display = '';

  // Preseleccionar cuenta de gasto según tipo
  const tipoDef = TIPOS_PAGO.find(function(t){ return t.value === tipo; });
  if (tipoDef && tipoDef.cuentaGasto) {
    const cta = contCuentasCache.find(function(c){ return c.codigo === tipoDef.cuentaGasto; });
    if (cta) document.getElementById('pago-cuenta-gasto').value = cta.id_cuenta;
  }
}

function onCambiarMontoPago() {
  const tasa    = parseFloat(document.getElementById('pago-tasa').value) || 1;
  const moneda  = document.getElementById('pago-moneda').value;
  const montoUSD = parseFloat(document.getElementById('pago-monto-usd').value) || 0;
  if (moneda === 'USD' && montoUSD > 0) {
    document.getElementById('pago-monto-ves').value = (montoUSD * tasa).toFixed(2);
  }
}

function onToggleRecurrente() {
  const es = document.getElementById('pago-recurrente').checked;
  const row = document.getElementById('pago-row-recurrente');
  if (row) row.style.display = es ? '' : 'none';
}

async function guardarPago() {
  const errEl = document.getElementById('alerta-pago-err');
  const okEl  = document.getElementById('alerta-pago-ok');
  errEl.style.display = 'none';

  const tipo        = document.getElementById('pago-tipo').value;
  const descripcion = document.getElementById('pago-descripcion').value.trim();
  const montoUSD    = parseFloat(document.getElementById('pago-monto-usd').value) || 0;
  const montoVES    = parseFloat(document.getElementById('pago-monto-ves').value) || 0;
  const moneda      = document.getElementById('pago-moneda').value;
  const fechaVenc   = document.getElementById('pago-fecha-venc').value;
  const tasa        = parseFloat(document.getElementById('pago-tasa').value) || 1;
  const esRec       = document.getElementById('pago-recurrente').checked;
  const frecuencia  = document.getElementById('pago-frecuencia').value;
  const idProv      = parseInt(document.getElementById('pago-proveedor').value) || null;
  const idEmp       = parseInt(document.getElementById('pago-empleado').value) || null;
  const idCtaGasto  = parseInt(document.getElementById('pago-cuenta-gasto').value) || null;
  const beneficiario = document.getElementById('pago-beneficiario').value.trim();

  if (!tipo)        { errEl.textContent = 'Selecciona el tipo de pago.';    errEl.style.display='block'; return; }
  if (!descripcion) { errEl.textContent = 'Ingresa una descripción.';       errEl.style.display='block'; return; }
  if (!montoUSD && !montoVES) { errEl.textContent = 'Ingresa el monto.';   errEl.style.display='block'; return; }
  if (!fechaVenc)   { errEl.textContent = 'Ingresa la fecha de vencimiento.'; errEl.style.display='block'; return; }

  // Calcular próxima fecha si recurrente
  let fechaProxima = null;
  if (esRec && fechaVenc) {
    const fp = new Date(fechaVenc);
    if (frecuencia === 'MENSUAL')     fp.setMonth(fp.getMonth()+1);
    else if (frecuencia === 'TRIMESTRAL') fp.setMonth(fp.getMonth()+3);
    else if (frecuencia === 'ANUAL')  fp.setFullYear(fp.getFullYear()+1);
    fechaProxima = fp.toISOString().split('T')[0];
  }

  // Generar número de pago
  let numeroPago = _pagoEditando ? _pagoEditando.numero_pago : null;
  if (!numeroPago) {
    const anio = new Date().getFullYear();
    const ultPago = await api('pagos','GET',null,'?numero_pago=like.PAG-'+anio+'-*&order=numero_pago.desc&limit=1&select=numero_pago');
    let seq = 1;
    if (ultPago.length) { const p = ultPago[0].numero_pago.split('-'); seq = parseInt(p[p.length-1])+1; }
    numeroPago = 'PAG-'+anio+'-'+String(seq).padStart(4,'0');
  }

  const datos = {
    numero_pago:       numeroPago,
    tipo_pago:         tipo,
    descripcion:       descripcion,
    nombre_beneficiario: beneficiario || null,
    id_beneficiario:   idProv,
    id_empleado:       idEmp,
    monto_usd:         montoUSD || null,
    monto_ves:         montoVES || null,
    moneda_pago:       moneda,
    tasa_bcv:          tasa,
    id_cuenta_gasto:   idCtaGasto,
    fecha_vencimiento: fechaVenc,
    referencia:        document.getElementById('pago-referencia').value.trim() || null,
    observaciones:     document.getElementById('pago-observaciones').value.trim() || null,
    es_recurrente:     esRec,
    frecuencia:        esRec ? frecuencia : null,
    fecha_proxima:     fechaProxima,
    estado:            'BORRADOR',
    id_emisor:         _empresaActiva ? _empresaActiva.id_emisor : null,
    id_usuario:        sesionActual.correo_usuario
  };

  try {
    if (_pagoEditando) {
      await api('pagos','PATCH',datos,'?id_pago=eq.'+_pagoEditando.id_pago);
    } else {
      await api('pagos','POST',datos);
    }
    okEl.textContent = _pagoEditando ? 'Pago actualizado.' : 'Pago registrado como borrador.';
    okEl.style.display = 'block';
    setTimeout(function(){ cerrarModal('modal-pago'); cargarPagos(); }, 1200);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

// ── Aprobar/Anular desde ficha ──
async function aprobarPagoFicha(id) {
  await aprobarPago(id);
  await cargarPagos();
  abrirFichaPago(id);
}

async function anularPagoFicha(id) {
  await anularPago(id);
  cerrarModal('modal-ficha-pago');
}

// ── Aprobar pago ──
async function aprobarPago(id) {
  if (!confirm('¿Aprobar este pago?')) return;
  try {
    await api('pagos','PATCH',{
      estado: 'APROBADO',
      aprobado_por: sesionActual.nombre || sesionActual.correo_usuario,
      fecha_aprobacion: new Date().toISOString()
    },'?id_pago=eq.'+id);
    cargarPagos();
  } catch(e) { alert('Error: '+e.message); }
}

// ── Ejecutar pago (pagar) ──
async function ejecutarPago(id) {
  const p = pagosCache.find(function(x){ return x.id_pago === id; });
  if (!p) return;
  // Mostrar modal de confirmación de pago
  _pagoEditando = p;
  document.getElementById('exec-pago-desc').textContent    = p.descripcion;
  document.getElementById('exec-pago-monto').textContent   = p.monto_usd ? '$ '+fmtUSD(p.monto_usd) : 'Bs '+fmtVES(p.monto_ves);
  document.getElementById('exec-pago-fecha').value         = getHoyVzla();
  document.getElementById('exec-pago-metodo').value        = p.metodo_pago || 'TRANSFERENCIA_VES';
  document.getElementById('alerta-exec-err').style.display = 'none';
  abrirModal('modal-ejecutar-pago');
}

async function confirmarEjecucionPago() {
  const p      = _pagoEditando;
  const fecha  = document.getElementById('exec-pago-fecha').value;
  const metodo = document.getElementById('exec-pago-metodo').value;
  const errEl  = document.getElementById('alerta-exec-err');
  errEl.style.display = 'none';

  if (!fecha)  { errEl.textContent = 'Selecciona la fecha de pago.'; errEl.style.display='block'; return; }
  if (!metodo) { errEl.textContent = 'Selecciona el método de pago.'; errEl.style.display='block'; return; }

  try {
    // Generar asiento contable
    await generarAsientoPago(p, fecha, metodo);

    // Calcular próxima fecha si recurrente
    let fechaProxima = null;
    if (p.es_recurrente && p.frecuencia) {
      const fp = new Date(fecha);
      if (p.frecuencia === 'MENSUAL')     fp.setMonth(fp.getMonth()+1);
      else if (p.frecuencia === 'TRIMESTRAL') fp.setMonth(fp.getMonth()+3);
      else if (p.frecuencia === 'ANUAL')  fp.setFullYear(fp.getFullYear()+1);
      fechaProxima = fp.toISOString().split('T')[0];
    }

    // Obtener tasa de cambio del día del pago
    let tasaPago = parseFloat(p.tasa_bcv) || 1;
    try {
      const tasas = await api('tasas_cambio','GET',null,
        '?fecha=lte.'+fecha+'&order=fecha.desc&limit=1&select=tipo_cambio');
      if (tasas.length) tasaPago = parseFloat(tasas[0].tipo_cambio) || tasaPago;
    } catch(e) {}

    // Si pago en USD, calcular contavalor en Bs
    const montoUSDp  = parseFloat(p.monto_usd) || 0;
    const montoVESp  = montoUSDp > 0 ? montoUSDp * tasaPago : (parseFloat(p.monto_ves) || 0);

    await api('pagos','PATCH',{
      estado:       'PAGADO',
      fecha_pago:   fecha,
      metodo_pago:  metodo,
      fecha_proxima: fechaProxima,
      tasa_bcv:     tasaPago,
      monto_ves:    montoVESp
    },'?id_pago=eq.'+p.id_pago);

    cerrarModal('modal-ejecutar-pago');
    cargarPagos();
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

// ── Generar asiento contable del pago ──
async function generarAsientoPago(p, fecha, metodo) {
  // Usar tasa del día del pago (ya calculada) o consultar
  let tasa = parseFloat(p.tasa_bcv) || 1;
  try {
    const tasasDia = await api('tasas_cambio','GET',null,
      '?fecha=lte.'+fecha+'&order=fecha.desc&limit=1&select=tipo_cambio');
    if (tasasDia.length) tasa = parseFloat(tasasDia[0].tipo_cambio) || tasa;
  } catch(e) {}
  const montoUSD = parseFloat(p.monto_usd) || 0;
  // Si pago en USD: contavalor Bs = USD × tasa. Si pago en Bs: usar monto_ves directo
  const montoVES = montoUSD > 0 ? (montoUSD * tasa) : (parseFloat(p.monto_ves) || 0);

  // Número de asiento
  const anio = new Date().getFullYear();
  const exist = await api('cont_asientos','GET',null,'?numero_asiento=like.AST-'+anio+'-*&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
  let seq = 1;
  if (exist.length) { const parts = exist[0].numero_asiento.split('-'); seq = parseInt(parts[parts.length-1])+1; }
  const numAst = 'AST-'+anio+'-'+String(seq).padStart(4,'0');

  const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
  const idPeriodo = periodos.length ? periodos[0].id_periodo : null;

  const auxDesc = montoUSD > 0 ? ' (USD '+fmtUSD(montoUSD)+' × '+tasa.toFixed(4)+')' : '';

  const asiento = await api('cont_asientos','POST',{
    numero_asiento: numAst,
    fecha:          fecha,
    descripcion:    'Pago '+p.tipo_pago+': '+p.descripcion,
    tipo:           'AUTOMATICO',
    referencia:     p.numero_pago,
    moneda_base:    'VES',
    tasa_bcv:       tasa,
    id_periodo:     idPeriodo,
    id_emisor:      _empresaActiva ? _empresaActiva.id_emisor : null,
    estado:         'APROBADO',
    id_usuario:     sesionActual.correo_usuario
  });
  if (!asiento || !asiento[0]) return;
  const idAst = asiento[0].id_asiento;

  // Cuenta de origen (banco/caja)
  const metodoDef = METODOS_PAGO_PAGOS.find(function(m){ return m.value === metodo; });
  let idCtaOrigen = null;
  if (metodoDef) {
    const cOrig = await api('cont_cuentas','GET',null,'?codigo=eq.'+metodoDef.cuenta+'&select=id_cuenta');
    if (cOrig.length) idCtaOrigen = cOrig[0].id_cuenta;
  }

  // Cuenta de gasto — buscar por tipo si no está definida
  let idCtaGasto = p.id_cuenta_gasto;
  if (!idCtaGasto) {
    const tipoDef = TIPOS_PAGO.find(function(t){ return t.value === p.tipo_pago; });
    if (tipoDef && tipoDef.cuentaGasto) {
      const cGasto = await api('cont_cuentas','GET',null,'?codigo=eq.'+tipoDef.cuentaGasto+'&select=id_cuenta');
      if (cGasto.length) idCtaGasto = cGasto[0].id_cuenta;
    }
  }

  // Línea 1: Débito Cuenta de Gasto (en Bs, auxiliar USD)
  if (idCtaGasto) await api('cont_asiento_lineas','POST',{
    id_asiento: idAst, id_cuenta: idCtaGasto, orden: 1,
    descripcion: p.descripcion + auxDesc,
    debe_usd: montoUSD, haber_usd: 0,
    debe_ves: montoVES, haber_ves: 0
  });

  // Línea 2: Crédito Banco/Caja (en Bs, auxiliar USD)
  if (idCtaOrigen) await api('cont_asiento_lineas','POST',{
    id_asiento: idAst, id_cuenta: idCtaOrigen, orden: 2,
    descripcion: 'Pago vía '+metodo+auxDesc,
    debe_usd: 0, haber_usd: montoUSD,
    debe_ves: 0, haber_ves: montoVES
  });

  // Actualizar id_asiento en el pago
  await api('pagos','PATCH',{ id_asiento: idAst },'?id_pago=eq.'+p.id_pago);
}

// ── Anular pago ──
async function anularPago(id) {
  if (!confirm('¿Anular este pago?')) return;
  try {
    await api('pagos','PATCH',{ estado: 'ANULADO' },'?id_pago=eq.'+id);
    cargarPagos();
  } catch(e) { alert('Error: '+e.message); }
}

// ── Ficha del pago ──
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


