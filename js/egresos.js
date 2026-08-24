// ─── S&D Systems — Módulo: EGRESOS (CxP + Ejecutar Pago) ─── (renombrado desde pagos.js el 2026-08-03)
// v20260701002
// v20260628084
// ─── S&D Systems — Módulo: PAGOS ───
// ══════════════════════════════════════════════════════════════
//  MÓDULO DE PAGOS
// ══════════════════════════════════════════════════════════════

var _pagoEditando = null;

// ══════════════════════════════════════════════════════════════
//  PENDIENTES POR FACTURAR / PAGO CONSOLIDADO
// ══════════════════════════════════════════════════════════════
// Agrupa varias Entradas CONTADO de un mismo Proveedor, con la misma
// Fecha de Pago, bajo una sola Factura -- se pagan todas juntas en un
// único movimiento de Banco/Caja. Cada Entrada conserva su propia
// conversión/diferencial cambiario individual (pueden tener Monedas de
// Negociación distintas entre sí).
window._pendFacturarProvSel = null;
window._pendFacturarEntradasSel = [];

async function abrirPendientesFacturar() {
  document.getElementById('pend-fact-paso-proveedores').style.display = '';
  document.getElementById('pend-fact-paso-entradas').style.display = 'none';
  document.getElementById('btn-confirmar-pago-consolidado').style.display = 'none';
  window._pendFacturarProvSel = null;
  window._pendFacturarEntradasSel = [];
  abrirModal('modal-pend-facturar');
  await _pendFacturarCargarProveedores();
}

async function _pendFacturarCargarProveedores() {
  const cont = document.getElementById('pend-fact-lista-proveedores');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const id_emisor = _empresaActiva?.id_empresa || 0;
    const rows = await api('cont_cxp','GET',null,
      '?id_empresa=eq.'+id_emisor+'&estado=eq.APROBADA&id_pago_consolidado=is.null&select=id_cxp,numero_doc,id_proveedor,monto_usd,monto_ves,moneda_pago,proveedores:id_proveedor(nombre,rif)');
    // Solo CONTADO -- numero_doc con patrón ENT-<id>-<id_cxp>, sin cuota (-C)
    const contado = (rows||[]).filter(function(r){ return /^ENT-\d+-\d+$/.test(r.numero_doc||''); });

    if (!contado.length) {
      cont.innerHTML = '<p style="color:var(--suave);font-size:13px;text-align:center;padding:20px 0">No hay Entradas Contado pendientes de facturar.</p>';
      return;
    }

    const porProveedor = {};
    contado.forEach(function(r) {
      const id = r.id_proveedor;
      if (!porProveedor[id]) porProveedor[id] = { nombre: r.proveedores?.nombre || '—', rif: r.proveedores?.rif || '', cant: 0, totalUsd: 0 };
      porProveedor[id].cant++;
      porProveedor[id].totalUsd += parseFloat(r.monto_usd || 0);
    });

    cont.innerHTML = Object.keys(porProveedor).map(function(id) {
      const p = porProveedor[id];
      return '<div onclick="_pendFacturarSeleccionarProveedor('+id+')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;margin-bottom:8px;cursor:pointer">'
        + '<div><div style="font-weight:600">'+p.nombre+'</div><div style="font-size:11px;color:var(--suave)">'+p.rif+' — '+p.cant+' Entrada(s) pendiente(s)</div></div>'
        + '<div style="color:var(--naranja);font-weight:700;font-family:var(--font-mono)">$ '+p.totalUsd.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>'
        + '</div>';
    }).join('');
  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">'+msgErr(e)+'</div>';
  }
}

async function _pendFacturarSeleccionarProveedor(id_proveedor) {
  document.getElementById('pend-fact-paso-proveedores').style.display = 'none';
  document.getElementById('pend-fact-paso-entradas').style.display = '';
  document.getElementById('pend-fact-form-consolidado').style.display = 'none';
  document.getElementById('btn-confirmar-pago-consolidado').style.display = 'none';
  window._pendFacturarEntradasSel = [];

  const id_emisor = _empresaActiva?.id_empresa || 0;
  const rows = await api('proveedores','GET',null,'?id_proveedor=eq.'+id_proveedor+'&select=*&limit=1');
  const prov = rows && rows[0];
  window._pendFacturarProvSel = prov;
  document.getElementById('pend-fact-prov-nombre').textContent = (prov?.nombre || '—') + (prov?.rif ? ' — ' + prov.rif : '');

  const cxpRows = await api('cont_cxp','GET',null,
    '?id_empresa=eq.'+id_emisor+'&id_proveedor=eq.'+id_proveedor+'&estado=eq.APROBADA&id_pago_consolidado=is.null&select=id_cxp,numero_doc,moneda_negociacion,moneda_pago,monto_usd,monto_ves,fecha_vencimiento,fecha_emision');
  const contado = (cxpRows||[]).filter(function(r){ return /^ENT-\d+-\d+$/.test(r.numero_doc||''); });

  const cont = document.getElementById('pend-fact-lista-entradas');
  if (!contado.length) {
    cont.innerHTML = '<p style="color:var(--suave);font-size:13px;text-align:center;padding:20px 0">Este Proveedor no tiene Entradas pendientes.</p>';
    return;
  }

  const porFecha = {};
  contado.forEach(function(r) {
    const f = (r.fecha_vencimiento || r.fecha_emision || '').slice(0,10);
    if (!porFecha[f]) porFecha[f] = [];
    porFecha[f].push(r);
  });

  cont.innerHTML = Object.keys(porFecha).sort().map(function(fecha) {
    const grupo = porFecha[fecha];
    return '<div style="margin-bottom:14px">'
      + '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Fecha de Pago: '+fecha.split('-').reverse().join('/')+'</div>'
      + grupo.map(function(r) {
          return '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;margin-bottom:6px;cursor:pointer">'
            + '<input type="checkbox" class="pend-fact-chk-entrada" value="'+r.id_cxp+'" data-fecha="'+fecha+'" onchange="_pendFacturarOnCambioSeleccion()">'
            + '<div style="flex:1"><span style="color:var(--naranja);font-weight:600">'+fmtNumeroDoc(r.numero_doc)+'</span> <span style="font-size:11px;color:var(--suave)">('+r.moneda_negociacion+')</span></div>'
            + '<div style="font-family:var(--font-mono);font-weight:600">$ '+parseFloat(r.monto_usd||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>'
            + '</label>';
        }).join('')
      + '</div>';
  }).join('');
}

function _pendFacturarVolverProveedores() {
  document.getElementById('pend-fact-paso-proveedores').style.display = '';
  document.getElementById('pend-fact-paso-entradas').style.display = 'none';
  document.getElementById('btn-confirmar-pago-consolidado').style.display = 'none';
}

// Al marcar/desmarcar una Entrada -- solo se permite mantener marcadas las
// que compartan la MISMA Fecha de Pago que la primera que se seleccionó
// (desmarca automáticamente cualquier otra fecha distinta, con aviso).
async function _pendFacturarOnCambioSeleccion() {
  const chks = Array.from(document.querySelectorAll('.pend-fact-chk-entrada'));
  const marcados = chks.filter(function(c){ return c.checked; });

  if (marcados.length) {
    const fechaBase = marcados[0].dataset.fecha;
    chks.forEach(function(c) {
      if (c.dataset.fecha !== fechaBase && c.checked) c.checked = false;
    });
  }

  const seleccionados = chks.filter(function(c){ return c.checked; }).map(function(c){ return parseInt(c.value); });
  window._pendFacturarEntradasSel = seleccionados;

  const formCont = document.getElementById('pend-fact-form-consolidado');
  const btnConf = document.getElementById('btn-confirmar-pago-consolidado');
  if (seleccionados.length < 2) {
    formCont.style.display = 'none';
    btnConf.style.display = 'none';
    return;
  }
  formCont.style.display = '';
  btnConf.style.display = '';
  await _pendFacturarResolverMetodo();
}

async function confirmarPagoConsolidado() {
  const errEl = document.getElementById('alerta-pend-fact-err');
  const btn = document.getElementById('btn-confirmar-pago-consolidado');
  const resetBtn = function() { if (btn) { btn.disabled = false; btn.textContent = '💳 CONFIRMAR PAGO CONSOLIDADO'; } };
  if (errEl) errEl.style.display = 'none';

  const ids = window._pendFacturarEntradasSel || [];
  const prov = window._pendFacturarProvSel;
  const calculo = window._pendFacturarCalculo;
  const detalle = window._pendFacturarDetalle;
  if (!ids.length || ids.length < 2 || !calculo || !detalle) {
    if (errEl) { errEl.textContent = 'Seleccione al menos 2 Entradas.'; errEl.style.display = 'block'; }
    resetBtn(); return;
  }

  const facturaNo = document.getElementById('pend-fact-factura-no')?.value?.trim() || '';
  const referencia = document.getElementById('pend-fact-referencia')?.value?.trim() || '';
  if (!facturaNo)  { if (errEl) { errEl.textContent = 'Debe ingresar el N° de Factura.'; errEl.style.display = 'block'; } resetBtn(); return; }
  if (!referencia) { if (errEl) { errEl.textContent = 'Debe ingresar la Referencia de Pago.'; errEl.style.display = 'block'; } resetBtn(); return; }

  const idCuentaBanco = document.getElementById('pend-fact-cuenta-banco')?.value || null;
  if (!idCuentaBanco) { if (errEl) { errEl.textContent = 'No hay Cuenta Contable resuelta para esta combinación de Moneda/Método.'; errEl.style.display = 'block'; } resetBtn(); return; }

  const monedaPago = calculo.monedaPago;
  const tipoMetodo = document.getElementById('pend-fact-metodo-tipo')?.value || '';
  const fechaPago = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);

  try {
    // 1. Crear la cabecera del Pago Consolidado
    const pagoRows = await api('cont_pagos_consolidados','POST',{
      id_empresa: _empresaActiva?.id_empresa || null,
      id_proveedor: prov.id_proveedor,
      numero_factura_proveedor: facturaNo,
      referencia: referencia,
      fecha_pago: fechaPago,
      moneda_pago: monedaPago,
      metodo_pago: tipoMetodo,
      id_cuenta_banco: parseInt(idCuentaBanco),
      monto_total_usd: calculo.totalUSD,
      monto_total_ves: calculo.totalVES,
      monto_igtf_usd: calculo.igtf,
      monto_igtf_ves: parseFloat((calculo.igtf * calculo.tasaHoy).toFixed(2)),
      diferencial_cambiario_ves: calculo.diferencialTotal,
      id_usuario: sesionActual?.correo_usuario || null
    });
    const idPagoConsolidado = pagoRows && pagoRows[0] ? pagoRows[0].id_pago_consolidado : null;

    // 2. Crear el Asiento contable consolidado
    const _todasCtasCons = await obtenerCuentasContables();
    const buscarCtaCons = function(cod){ return _todasCtasCons.find(function(c){ return c.codigo === cod; }) || null; };
    const idCtaIGTFCons       = buscarCtaCons('6.1.04.003')?.id_cuenta || null;
    const idCtaPerdCambioCons = buscarCtaCons('6.2.01.003')?.id_cuenta || null;
    const idCtaGanCambioCons  = buscarCtaCons('4.2.01.003')?.id_cuenta || null;
    const idCtaCxPCons        = buscarCtaCons('2.1.01.001')?.id_cuenta || null;

    const numAstCons = await _siguienteNumeroAsiento();
    await api('cont_asientos','POST',{
      id_empresa: _empresaActiva?.id_empresa || null,
      numero_asiento: numAstCons,
      tipo: 'PAGO_CXP',
      fecha: fechaPago,
      estado: 'APROBADO',
      moneda_base: 'VES',
      tasa_bcv: calculo.tasaHoy,
      referencia: 'FACT-' + facturaNo,
      descripcion: 'Pago Consolidado N° Factura ' + facturaNo + ' — ' + (prov.nombre || '') + ' (' + ids.length + ' Entradas)',
      id_usuario: sesionActual?.correo_usuario
    });
    const astConsRows = await api('cont_asientos','GET',null,
      '?numero_asiento=eq.'+encodeURIComponent(numAstCons)+emisorQ()+'&select=id_asiento&limit=1');
    const idAstCons = astConsRows && astConsRows[0] ? astConsRows[0].id_asiento : null;

    if (idAstCons) {
      let orden = 1;
      const r2c = function(v) { return parseFloat((v||0).toFixed(2)); };
      const sufijoConsolidado = ' N° Factura ' + facturaNo + ' Ref. Pago ' + referencia;
      const lineaCons = async function(id_cta, debeUSD, haberUSD, debeVES, haberVES, desc) {
        await api('cont_asiento_lineas','POST',{
          id_asiento: idAstCons, id_cuenta: id_cta, orden: orden++,
          debe_usd: r2c(debeUSD), haber_usd: r2c(haberUSD),
          debe_ves: r2c(debeVES), haber_ves: r2c(haberVES), tasa_bcv: calculo.tasaHoy,
          descripcion: desc || null
        });
      };

      // DEBE: una línea de CxP por cada Entrada. El lado USD usa el monto
      // ya resuelto (igual al original, salvo que se haya negociado en
      // Bs y se pague en USD -- ahí sí se recalcula con la tasa de hoy,
      // mismo criterio que un pago individual). El lado Bs SIEMPRE usa el
      // monto ORIGINAL congelado -- el diferencial (si aplica) se agrega
      // aparte, más abajo, así que no se debe sumar dos veces aquí.
      for (const d of detalle) {
        if (idCtaCxPCons) await lineaCons(idCtaCxPCons, d.montoUSD, 0, d.montoVesOrig, 0, 'Pago' + sufijoConsolidado + ' (' + fmtNumeroDoc(d.numero_doc) + ')');
      }
      // DEBE: IGTF consolidado
      if (idCtaIGTFCons && calculo.igtf > 0) {
        const igtfVESCons = r2c(calculo.igtf * calculo.tasaHoy);
        await lineaCons(idCtaIGTFCons, calculo.igtf, 0, igtfVESCons, 0, 'Gasto IGTF pago' + sufijoConsolidado);
      }
      // Diferencial Cambiario consolidado — solo en BS
      if (Math.abs(calculo.diferencialTotal) > 0.01) {
        if (calculo.diferencialTotal > 0 && idCtaPerdCambioCons)
          await lineaCons(idCtaPerdCambioCons, 0, 0, Math.abs(calculo.diferencialTotal), 0, 'Pérdida cambiaria — Pago Consolidado Factura ' + facturaNo);
        else if (calculo.diferencialTotal < 0 && idCtaGanCambioCons)
          await lineaCons(idCtaGanCambioCons, 0, 0, 0, Math.abs(calculo.diferencialTotal), 'Ganancia cambiaria — Pago Consolidado Factura ' + facturaNo);
      }
      // HABER: una sola línea de Banco/Efectivo por el total. La columna
      // Bs siempre refleja el total en Bs + IGTF en Bs (el Debe también
      // lleva ambas columnas en cada línea, sin importar en qué Moneda se
      // pague en efectivo) -- si no, el asiento quedaría descuadrado del
      // lado Bs cuando se paga en USD.
      const igtfVESParaBanco = r2c(calculo.igtf * calculo.tasaHoy);
      const bancoUSDCons = monedaPago === 'VES' ? 0 : calculo.totalFinal;
      const bancoVESCons = monedaPago === 'VES' ? calculo.totalFinal : r2c(calculo.totalVES + igtfVESParaBanco);
      if (idCuentaBanco) await lineaCons(parseInt(idCuentaBanco), 0, bancoUSDCons, 0, bancoVESCons, 'Egreso por Pago' + sufijoConsolidado);

      await api('cont_pagos_consolidados','PATCH',{ id_asiento: idAstCons }, '?id_pago_consolidado=eq.'+idPagoConsolidado);
    }

    // 3. Actualizar cada CxP -- PAGADA, con los datos compartidos del Pago Consolidado
    for (const d of detalle) {
      await api('cont_cxp','PATCH',{
        estado: 'PAGADA',
        pagado_usd: d.montoUSD,
        saldo_usd: 0,
        monto_ves: d.montoVES,
        tasa_bcv: calculo.tasaHoy,
        numero_factura_proveedor: facturaNo,
        referencia: referencia,
        fecha_pago: fechaPago,
        metodo_pago: tipoMetodo,
        moneda_pago: monedaPago,
        id_pago_consolidado: idPagoConsolidado,
        pagado_por: sesionActual?.correo_usuario || null
      }, '?id_cxp=eq.'+d.id_cxp);
    }

    cerrarModal('modal-pend-facturar');
    alert('Pago Consolidado registrado correctamente (' + ids.length + ' Entradas).');
    if (typeof cargarPagos === 'function') cargarPagos();
  } catch(e) {
    if (errEl) { errEl.textContent = msgErr(e); errEl.style.display = 'block'; }
    resetBtn();
  }
}

async function _pendFacturarResolverMetodo() {
  const prov = window._pendFacturarProvSel;
  const moneda = document.getElementById('pend-fact-moneda')?.value || 'USD';
  const selTipoMetodo = document.getElementById('pend-fact-metodo-tipo');
  const tiposAceptados = (prov && Array.isArray(prov.metodos_pago_tipos)) ? prov.metodos_pago_tipos : [];
  if (selTipoMetodo && !selTipoMetodo.dataset.poblado) {
    selTipoMetodo.innerHTML = tiposAceptados.map(function(t){ return '<option value="'+t+'">'+(METODO_PAGO_LABELS[t]||t)+'</option>'; }).join('');
    selTipoMetodo.dataset.poblado = '1';
  }
  const tipoMetodo = selTipoMetodo?.value || '';
  const metodoHidden = document.getElementById('pend-fact-metodo');
  const cuentaCont = document.getElementById('pend-fact-cuenta-cont');
  const cuentaDisplay = document.getElementById('pend-fact-cuenta-display');
  const cuentaHidden = document.getElementById('pend-fact-cuenta-banco');
  if (cuentaCont) cuentaCont.style.display = 'none';
  if (tipoMetodo) {
    try {
      const metodos = await api('param_metodos_pago','GET',null,
        '?codigo=eq.'+moneda+'&tipo_canal=eq.'+tipoMetodo+'&estado=eq.ACTIVO&limit=1&select=id_metodo,id_cuenta_contable'+emisorQ());
      const m = metodos && metodos[0];
      if (m && m.id_cuenta_contable) {
        const cta = (await obtenerCuentasContables()).find(function(c){ return c.id_cuenta === m.id_cuenta_contable; });
        if (metodoHidden) metodoHidden.value = m.id_metodo;
        if (cuentaHidden) cuentaHidden.value = m.id_cuenta_contable;
        if (cuentaDisplay) cuentaDisplay.textContent = cta ? (cta.codigo+' — '+cta.nombre) : '—';
        if (cuentaCont) cuentaCont.style.display = '';
      }
    } catch(e) {}
  }
  await _renderDesglosePagoConsolidado();
}

// Arma el desglose del Pago Consolidado -- por cada Entrada seleccionada,
// aplica el mismo criterio simétrico ya usado en Ejecutar Pago (según su
// propia Moneda de Negociación vs la Moneda de Pago elegida aquí, con la
// tasa BCV de HOY), y suma todo. IGTF y diferencial se muestran
// consolidados, pero cada Entrada conserva su propio cálculo individual.
async function _renderDesglosePagoConsolidado() {
  const cont = document.getElementById('pend-fact-desglose-tabla');
  const prov = window._pendFacturarProvSel;
  const ids = window._pendFacturarEntradasSel || [];
  if (!cont || !ids.length) return;

  const monedaPago = document.getElementById('pend-fact-moneda')?.value || 'USD';
  const esUSD = monedaPago !== 'VES';
  const hoy = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);

  let tasaHoy = _tasaVigente || 1;
  try {
    const tasasHoy = await api('tasas','GET',null,'?fecha_valor=lte.'+hoy+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    if (tasasHoy && tasasHoy[0]) tasaHoy = parseFloat(tasasHoy[0].tipo_cambio);
  } catch(e) {}

  const rows = await api('cont_cxp','GET',null,'?id_cxp=in.('+ids.join(',')+')&select=id_cxp,numero_doc,moneda_negociacion,monto_usd,monto_ves,exento_iva');

  let totalUSD = 0, totalVES = 0, diferencialTotal = 0;
  window._pendFacturarDetalle = [];
  (rows||[]).forEach(function(r) {
    const monedaNeg = (r.moneda_negociacion || 'USD').toUpperCase();
    const montoUsdOrig = parseFloat(r.monto_usd || 0);
    const montoVesOrig = parseFloat(r.monto_ves || 0);
    let montoUSD, montoVES, diferencial = 0;
    if (monedaNeg === monedaPago) {
      montoUSD = montoUsdOrig; montoVES = montoVesOrig;
    } else if (monedaNeg === 'VES') {
      montoVES = montoVesOrig;
      montoUSD = parseFloat((montoVesOrig / (tasaHoy||1)).toFixed(2));
    } else {
      montoUSD = montoUsdOrig;
      montoVES = parseFloat((montoUsdOrig * tasaHoy).toFixed(2));
      diferencial = parseFloat((montoVES - montoVesOrig).toFixed(2));
    }
    totalUSD += montoUSD; totalVES += montoVES; diferencialTotal += diferencial;
    window._pendFacturarDetalle.push({ id_cxp: r.id_cxp, numero_doc: r.numero_doc, montoUSD, montoVES, diferencial, montoUsdOrig, montoVesOrig });
  });
  totalUSD = parseFloat(totalUSD.toFixed(2));
  totalVES = parseFloat(totalVES.toFixed(2));
  diferencialTotal = parseFloat(diferencialTotal.toFixed(2));

  const totalPago = esUSD ? totalUSD : totalVES;
  const esEspecial = prov?.tipo_contribuyente === 'ESPECIAL';
  const aplicaIGTF = esUSD && esEspecial;
  let tasaIGTF = 0.03;
  try { const t = await _obtenerTributos(hoy); tasaIGTF = t.tasaIGTF; } catch(e) {}
  const igtf = aplicaIGTF ? parseFloat((totalPago * tasaIGTF).toFixed(2)) : 0;
  const totalFinal = parseFloat((totalPago + igtf).toFixed(2));
  window._pendFacturarCalculo = { totalUSD, totalVES, diferencialTotal, igtf, totalFinal, tasaHoy, monedaPago, aplicaIGTF };

  const simbolo = esUSD ? '$' : 'Bs.';
  const fmt = function(n){ return simbolo+' '+n.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}); };

  document.getElementById('pend-fact-resumen-cant').textContent = ids.length;
  document.getElementById('pend-fact-resumen-total').textContent = fmt(totalPago);

  cont.innerHTML =
    '<table style="width:100%;font-size:12px;border-collapse:collapse">'
    + window._pendFacturarDetalle.map(function(d) {
        const montoLinea = esUSD ? d.montoUSD : d.montoVES;
        return '<tr><td style="padding:4px 0;color:var(--suave)">'+fmtNumeroDoc(d.numero_doc)+'</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono)">'+fmt(montoLinea)+'</td></tr>';
      }).join('')
    + '<tr style="border-top:1px solid var(--borde)"><td style="padding:4px 0;font-weight:600">Total Facturado</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-weight:600">'+fmt(totalPago)+'</td></tr>'
    + (Math.abs(diferencialTotal) > 0.01 ? '<tr><td style="padding:4px 0;font-size:11px;color:'+(diferencialTotal>0?'#f87171':'#22c55e')+'">↳ '+(diferencialTotal>0?'Pérdida':'Ganancia')+' Cambiaria (consolidada)</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-size:11px;color:'+(diferencialTotal>0?'#f87171':'#22c55e')+'">'+fmt(Math.abs(diferencialTotal))+'</td></tr>' : '')
    + (aplicaIGTF ? ('<tr><td style="padding:4px 0;color:var(--suave)">IGTF ('+(tasaIGTF*100).toFixed(0)+'%) — 6.1.04.003</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono)">'+fmt(igtf)+'</td></tr>'
        + '<tr style="border-top:1px solid var(--borde)"><td style="padding:4px 0;font-weight:700;color:var(--naranja)">Total</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--naranja)">'+fmt(totalFinal)+'</td></tr>') : '')
    + '</table>';
}

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
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>';
  }
}

function cargarPagosDesdeUI() {
  const estado    = document.getElementById('pagos-estado')?.value    || '';
  const busqueda  = document.getElementById('pagos-buscar')?.value    || '';
  const desde     = document.getElementById('pagos-fecha-desde')?.value || '';
  const hasta     = document.getElementById('pagos-fecha-hasta')?.value || '';
  const categoria = document.getElementById('pagos-categoria')?.value  || '';
  cargarPagos(estado, null, busqueda, null, desde, hasta, categoria);
}

// Cache simple correo -> { nombre, areaCodigo, areaNombre } para no repetir
// consultas a 'empleados' por cada fila/uso (Detalle de Obligación,
// listado, notificaciones de Aprobar/Rechazar todas usan esto).
const _cacheCreadorCxP = {};
async function resolverCreadorCxP(correo) {
  if (!correo) return { nombre: '—', areaCodigo: '', areaNombre: '' };
  if (_cacheCreadorCxP[correo]) return _cacheCreadorCxP[correo];
  try {
    const rows = await api('empleados','GET',null,
      '?correo=eq.'+encodeURIComponent(correo)+'&select=nombre_completo,areas:id_area(nombre,codigo)&limit=1');
    const emp = rows && rows[0];
    const info = {
      nombre:     emp?.nombre_completo || correo,
      areaCodigo: emp?.areas?.codigo || '',
      areaNombre: emp?.areas?.nombre || ''
    };
    _cacheCreadorCxP[correo] = info;
    return info;
  } catch(e) {
    return { nombre: correo, areaCodigo: '', areaNombre: '' };
  }
}
// Formato corto para mostrar: "Nombre (CÓDIGO)"
function fmtCreadorCxP(info) {
  if (!info) return '—';
  return info.nombre + (info.areaCodigo ? ' (' + info.areaCodigo + ')' : '');
}

// ── ENRUTAMIENTO DE APROBACIÓN ──
// Al crear una Obligación nueva (PENDIENTE), llama al RPC del servidor
// (enrutar_aprobacion_cxp, SECURITY DEFINER) que busca a quién le
// corresponde aprobarla y le envía la notificación:
//   1. Busca Nivel 2 (Firma) EN EL ÁREA del creador. Si lo encuentra Y el
//      monto está dentro de su monto_maximo_aprobacion (o no tiene límite),
//      lo notifica y termina.
//   2. Si no hay Nivel 2 en esa Área, o el monto excede su límite, escala
//      DIRECTO a Nivel 1 (no sigue buscando otro Nivel 2 en Áreas
//      superiores) -- busca Nivel 1 en el Área del creador y, si no está,
//      va subiendo por id_area_padre hasta encontrarlo.
//   3. Si tampoco hay Nivel 1 en ninguna Área de la cadena, notifica a todos
//      los Administradores como respaldo.
// Se hace vía RPC (no consultas directas del cliente) porque requiere leer
// usuarios/usuarios_permisos de OTRAS personas -- datos sensibles que un
// Operador normal no debe poder consultar libremente por RLS.
// Arma el mensaje de la notificación con formato (etiquetas/negritas), para
// que el aprobador sepa DE UNA qué está autorizando -- mismo patrón que
// _armarMensajeAprobacionEntrada (inventario.js). "Monto a Pagar" es
// Base+IVA+IGTF (si aplica) -- lo que realmente se le paga al Proveedor.
function _armarMensajeAprobacionCxP(monto, idCxp, numeroDoc, detalle) {
  const d = detalle || {};
  const tasaUsar = d.tasaBcv || _tasaVigente || 1;
  const montoIgtf = d.montoIgtf || 0;
  const montoTotalUSD = monto + montoIgtf;
  const montoBsBase = d.montoBsExacto != null
    ? d.montoBsExacto
    : parseFloat((monto * tasaUsar).toFixed(2));
  const montoIgtfBs = montoIgtf > 0 ? parseFloat((montoIgtf * tasaUsar).toFixed(2)) : 0;
  const montoTotalBs = parseFloat((montoBsBase + montoIgtfBs).toFixed(2));
  const monedaPago = (d.monedaPago || 'USD').toUpperCase();
  const principal = monedaPago === 'USD'
    ? '$ ' + fmtUSD(montoTotalUSD) + ' <span style="font-weight:400;color:var(--suave)">(equivalente a Bs ' + fmtBs(montoTotalBs) + ')</span>'
    : 'Bs ' + fmtBs(montoTotalBs) + ' <span style="font-weight:400;color:var(--suave)">(equivalente a $ ' + fmtUSD(montoTotalUSD) + ')</span>';
  const igtfLinea = montoIgtf > 0
    ? '<div style="font-size:10px;color:var(--suave);margin-top:2px">Incluye IGTF: $ ' + fmtUSD(montoIgtf) + '</div>'
    : '';
  return '<div style="font-size:10px;color:var(--suave);letter-spacing:0.5px;margin-bottom:2px">OBLIGACIÓN DE PAGO — ' + (numeroDoc || ('#'+idCxp)) + '</div>'
    + '<div style="font-weight:600;margin-bottom:12px">' + (d.concepto || '—') + '</div>'
    + '<div style="display:flex;gap:24px;margin-bottom:12px">'
    + '<div><div style="font-size:10px;color:var(--suave)">PROVEEDOR</div><div style="font-weight:600">' + (d.proveedor || '—') + '</div></div>'
    + '<div><div style="font-size:10px;color:var(--suave)">MONEDA DE PAGO</div><div style="font-weight:600">' + monedaPago + '</div></div>'
    + '</div>'
    + '<div><div style="font-size:10px;color:var(--suave)">MONTO A PAGAR</div><div style="font-weight:700;color:var(--naranja);font-size:16px">' + principal + '</div>' + igtfLinea + '</div>';
}

async function enrutarAprobacionCxP(idCxp, numeroDoc, montoUsd, detalle) {
  try {
    const idAreaCreador = await _resolverAreaSesion();
    const mensajeRico = _armarMensajeAprobacionCxP(montoUsd, idCxp, numeroDoc, detalle);
    // El monto que decide QUIÉN debe aprobar (contra el límite de su Nivel
    // de Firma) tiene que ser lo que REALMENTE se está autorizando -- Base
    // + IVA + IGTF (si aplica), no solo la Base+IVA. Mismo criterio que
    // enrutarAprobacionEntrada.
    const montoParaLimite = montoUsd + (detalle?.montoIgtf || 0);
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/enrutar_aprobacion_cxp', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_id_area: idAreaCreador,
        p_monto: montoParaLimite,
        p_id_cxp: idCxp,
        p_numero_doc: numeroDoc,
        p_correo_creador: sesionActual?.correo_usuario || null,
        p_mensaje: mensajeRico
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(function(){ return {}; });
      throw new Error(err.message || 'Error ' + resp.status);
    }
    const data = await resp.json();
    console.log('[enrutamiento de aprobación]', data);
  } catch(e) { console.warn('Error en enrutamiento de aprobación:', e); }
}

async function cargarPagos(filtroEstado, filtroTipo, busqueda, filtroRef, filtroDesde, filtroHasta, filtroCategoria) {
  const c = document.getElementById('contenido-principal');
  const panelExiste = !!document.getElementById('panel-pagos');

  if (!panelExiste) {
    c.innerHTML =
      '<div class="panel" id="panel-pagos">' +
      '<div class="panel-header">' +
      '<h3 id="pagos-contador">Obligaciones de Pago (0)</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (puedo('PAGOS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoPago()">+ Nuevo Pago</button>' : '') +
      (puedo('PAGOS','CREAR') ? '<button class="btn-secundario" onclick="abrirPendientesFacturar()">📄 Pendientes por Facturar</button>' : '') +
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

  // Restaurar categoría si se pasó como parámetro
  const elCat = document.getElementById('pagos-categoria');
  if (filtroCategoria !== undefined && elCat) elCat.value = filtroCategoria || '';

  const fEstado    = document.getElementById('pagos-estado')?.value    || '';
  const fBuscar    = (busqueda || document.getElementById('pagos-buscar')?.value || '').toLowerCase();
  const fDesde     = filtroDesde    || document.getElementById('pagos-fecha-desde')?.value || '';
  const fHasta     = filtroHasta    || document.getElementById('pagos-fecha-hasta')?.value || '';
  const fCategoria = filtroCategoria !== undefined ? (filtroCategoria || '') : (document.getElementById('pagos-categoria')?.value || '');

  const id_emisor = _empresaActiva?.id_empresa || 0;

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

  const cxps = await api('cont_cxp','GET',null,'?id_empresa=eq.'+id_emisor+'&order=numero_doc.asc&select=*,proveedores:id_proveedor(nombre,id_categoria)');

  // Tasa BCV de HOY -- se busca una sola vez para todo el listado (no por
  // fila), y se usa para recalcular el equivalente en Bs de las
  // Obligaciones AÚN NO PAGADAS cuya deuda real está en USD (Moneda de
  // Negociación USD) -- mientras no se paguen, ese equivalente debe
  // reflejar la tasa de hoy, no la tasa congelada de cuando se negoció.
  let tasaHoyLista = _tasaVigente || 1;
  try {
    const hoyLista = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);
    const tasasHoyListaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+hoyLista+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    if (tasasHoyListaRows && tasasHoyListaRows[0]) tasaHoyLista = parseFloat(tasasHoyListaRows[0].tipo_cambio);
  } catch(eTasaLista) {}

  // Calcular total cuotas por prefijo para display
  const cxpMap = {};
  (cxps||[]).forEach(function(c) {
    const m = (c.numero_doc||'').match(/^(.*)-C(\d+)(?:-\d+)?$/);
    if (m) {
      const prefix = m[1];
      if (!cxpMap[prefix]) cxpMap[prefix] = 0;
      cxpMap[prefix]++;
    }
  });

  const itemsCxP = (cxps||[]).map(function(c) {
    const m = (c.numero_doc||'').match(/^(.*)-C(\d+)(?:-\d+)?$/);
    let tipoDisplay = 'CONTADO';
    if (m) {
      const prefix = m[1];
      const num    = parseInt(m[2]);
      const total  = cxpMap[prefix] || 1;
      tipoDisplay  = 'Crédito ' + num + '/' + total;
    }
    // Moneda de Negociación (deuda real) en USD + aún sin pagar -- el
    // equivalente en Bs se recalcula con la tasa de HOY, no con la
    // congelada al negociar (mismo criterio que la Ficha de Obligación).
    // Si la deuda real es en Bs, o ya está pagada, se usa el monto
    // congelado directo (nunca cambia / ya es lo que realmente ocurrió).
    const monedaNegLista = (c.moneda_negociacion || c.moneda_pago || 'USD').toUpperCase();
    const montoVES = (monedaNegLista === 'USD' && c.estado !== 'PAGADA')
      ? parseFloat((parseFloat(c.monto_usd || 0) * tasaHoyLista).toFixed(2))
      : (parseFloat(c.monto_ves || 0) || parseFloat(c.monto_usd || 0) * parseFloat(c.tasa_bcv || 1));
    return {
      _src:        'cxp',
      _id:         c.id_cxp,
      id_usuario:  c.id_usuario,
      numero:      fmtNumeroDoc(c.numero_doc) || '—',
      beneficiario: c.proveedores?.nombre || '—',
      fecha:       (c.estado === 'PAGADA' ? c.fecha_pago : c.fecha_vencimiento) || c.fecha_emision || '',
      tipo:        tipoDisplay,
      origen:      c.tipo === 'PAGO_MANUAL' ? 'Manual' : 'Automático',
      monto_usd:   parseFloat(c.monto_usd || 0),
      monto_ves:   montoVES,
      estado:      c.estado || 'PENDIENTE',
      _raw:        c
    };
  });

  // ── Ordenar por fecha desc ──
  let todos = fCategoria
    ? itemsCxP.filter(function(item){
        return String(item._raw?.proveedores?.id_categoria||'') === String(fCategoria);
      })
    : itemsCxP.slice();
  todos.sort(function(a,b){ return (a.fecha||'').localeCompare(b.fecha||''); });

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

  const estCol2 = { PENDIENTE:'#f59e0b', APROBADA:'#a78bfa', POR_APROBAR:'#60a5fa', PAGADA:'#22c55e', PARCIAL:'#f59e0b', ANULADA:'#6b7280', RECHAZADA:'#fc8181' };

  // Resolver en bulk (una sola consulta) Nombre + Código de Área de cada
  // creador, para mostrarlo en el listado sin una consulta por fila.
  const correosCreadores = [...new Set(todos.map(function(t){ return t.id_usuario; }).filter(Boolean))];
  const faltantesCreadores = correosCreadores.filter(function(c){ return !_cacheCreadorCxP[c]; });
  if (faltantesCreadores.length) {
    try {
      const empsBulk = await api('empleados','GET',null,
        '?correo=in.('+faltantesCreadores.map(encodeURIComponent).join(',')+')&select=correo,nombre_completo,areas:id_area(nombre,codigo)');
      (empsBulk||[]).forEach(function(e){
        _cacheCreadorCxP[e.correo] = { nombre: e.nombre_completo||e.correo, areaCodigo: e.areas?.codigo||'', areaNombre: e.areas?.nombre||'' };
      });
    } catch(eBulk) { console.warn('Error resolviendo creadores:', eBulk); }
  }

  const filas = todos.map(function(item) {
    const est = item.estado || 'PENDIENTE';
    const col = estCol2[est] || '#888';
    const badge = '<span style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600">'+est+'</span>';

    let acciones = '';
    if (item._src === 'cxp') {
      const btnVerPend = '<button onclick="verCxPPendiente('+item._id+')" style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">👁 Ver</button>';
      const btnVerPag  = '<button onclick="verDetalleCxP('+item._id+')" style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">👁 Ver</button>';
      const fechaVencAccion = item._raw?.fecha_vencimiento || '';
      const yaVenceAccion   = !fechaVencAccion || fechaVencAccion <= getHoyVzla();
      const btnAprobar  = (puedo('PAGOS','APROBAR') && yaVenceAccion) ? '<button onclick="aprobarPagoCxP('+item._id+')" style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#22c55e;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">✅ Aprobar</button>' : '';
      const btnRechazar = (puedo('PAGOS','RECHAZAR') && yaVenceAccion) ? '<button onclick="rechazarPagoCxP('+item._id+')" style="background:rgba(252,129,129,0.1);border:1px solid rgba(252,129,129,0.3);color:#fc8181;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">❌ Rechazar</button>' : '';
      const btnRegistrarPagoLista = (puedo('PAGOS','PAGAR') || sesionActual?.administrador) ? '<button onclick="verDetalleCxP('+item._id+')" style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#22c55e;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">💸 Registrar Pago</button>' : '';
      if (est === 'PENDIENTE' || est === 'RECHAZADA') acciones = btnVerPend + (btnAprobar ? ' '+btnAprobar : '') + ((btnRechazar && est !== 'RECHAZADA') ? ' '+btnRechazar : '');
      else if (est === 'APROBADA') acciones = btnVerPag + (btnRegistrarPagoLista ? ' '+btnRegistrarPagoLista : '');
      else if (est === 'POR_APROBAR') acciones = btnVerPag + (btnAprobar ? ' '+btnAprobar : '') + (btnRechazar ? ' '+btnRechazar : '');
      else acciones = btnVerPag;
    }

    const origenBadge = item.origen === 'Automático'
      ? '<span style="background:rgba(96,165,250,0.15);color:#60a5fa;border-radius:4px;padding:1px 6px;font-size:10px">Auto</span>'
      : '<span style="background:rgba(255,255,255,0.06);color:var(--suave);border-radius:4px;padding:1px 6px;font-size:10px">Manual</span>';

    const montoVES = item.monto_ves ? fmtBs(item.monto_ves) : (item.monto_usd ? fmtBs(item.monto_usd) : '—');
    // Resaltar la columna de la Moneda de Pago REAL de ESTA Obligación
    // (item._raw.moneda_pago), y atenuar la otra -- antes resaltaba según
    // la Moneda Principal fija de la Empresa, sin importar en qué Moneda
    // se pagó realmente cada Obligación puntual.
    const monedaPagoItem = (item._raw?.moneda_pago || 'USD').toUpperCase();
    const estiloUSD = monedaPagoItem === 'USD' ? '' : 'color:var(--suave)';
    const estiloVES = monedaPagoItem === 'VES' ? '' : 'color:var(--suave)';

    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
      +'<td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--naranja)">'+item.numero+'</td>'
      +'<td style="padding:8px;font-size:12px">'+item.beneficiario+'</td>'
      +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+fmtFecha(item.fecha)+'</td>'
      +'<td style="padding:8px;font-size:11px;color:var(--suave)">'+item.tipo+'</td>'
      +'<td style="padding:8px;text-align:center">'+origenBadge+'</td>'
      +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);'+estiloUSD+'">$ '+fmtUSD(item.monto_usd)+'</td>'
      +'<td style="text-align:right;padding:8px;font-family:var(--font-mono);'+estiloVES+'">'+montoVES+'</td>'
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
  window._tipoContribProveedorPago = null;
  window._aplicaIGTFPago = false;
  window._tasaIGTFPago = 0.03;
  await cargarTasaIVAGlobal(); // refresca IVA/IGTF vigente cada vez que se abre el formulario
  const errEl = document.getElementById('alerta-pago-err');
  const okEl  = document.getElementById('alerta-pago-ok');
  if (errEl) errEl.style.display = 'none';
  if (okEl)  okEl.style.display  = 'none';
  document.getElementById('pago-modal-titulo').textContent = 'NUEVA CUENTA POR PAGAR';
  const btnGuardarInit = document.getElementById('btn-guardar-pago');
  if (btnGuardarInit) {
    btnGuardarInit.disabled = false;
    btnGuardarInit.textContent = '📨 Solicitar Aprobación de Pago';
    btnGuardarInit.dataset.textoOriginal = '📨 Solicitar Aprobación de Pago';
  }
  // Restaurar campos (pueden estar disabled del modo VER)
  ['pago-descripcion','pago-cuenta-gasto',
   'pago-monto','pago-vencimiento','pago-proveedor','pago-observaciones'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  // Restaurar botón Guardar
  const footerNuevo = document.querySelector('#modal-pago .modal-footer');
  if (footerNuevo) footerNuevo.innerHTML =
    '<button class="btn-secundario" onclick="cerrarModal(\'modal-pago\')">Retornar</button>'
    + '<button class="btn-primario" id="btn-guardar-pago" data-texto-original="📨 Solicitar Aprobación de Pago" onclick="this.disabled=true;this.textContent=\'⏳ Procesando...\';guardarPago()">📨 Solicitar Aprobación de Pago</button>';

  // Reset campos
  ['pago-descripcion','pago-monto','pago-vencimiento','pago-rif','pago-observaciones','pago-manual-cuenta','pago-referencia'].forEach(function(id){
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pagoMonedaEl2 = document.getElementById('pago-moneda');
  if (pagoMonedaEl2) pagoMonedaEl2.value = '';
  const tasaContNuevo = document.getElementById('pago-tasa-cont-nuevo');
  if (tasaContNuevo) tasaContNuevo.style.display = 'none';
  ['pago-tasa-bcv','pago-monto-calc'].forEach(function(id){ const el = document.getElementById(id); if (el) el.value = ''; });
  const pagoArchivo = document.getElementById('pago-archivo');
  if (pagoArchivo) pagoArchivo.value = '';
  document.getElementById('pago-id').value = '';
  document.getElementById('pago-modal-titulo').textContent = 'NUEVA CUENTA POR PAGAR';
  // Limpiar selección exento IVA
  document.querySelectorAll('input[name="pago-exento-iva"]').forEach(function(r){ r.checked = false; });
  const _me = document.getElementById('pago-monto-equiv'); if (_me) _me.textContent = '';
  const _tc = document.getElementById('pago-tasa-cont'); if (_tc) _tc.style.display = 'none';
  ['pago-banco-info','pago-pm-info','pago-manual-info'].forEach(function(id){
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const _md = document.getElementById('pago-metodo-display'); if (_md) _md.textContent = '—';

  // Cargar tasas
  try {
    const hoy = new Date(new Date().getTime()-4*60*60*1000).toISOString().split('T')[0];
    const tasas = await api('tasas','GET',null,'?order=fecha_valor.desc&limit=20&select=*') || [];
    const getTasa = function(mon) {
      const reg = tasas.filter(function(t){ return t.moneda_origen===mon && String(t.fecha_valor||'').substring(0,10)<=hoy; })
        .sort(function(a,b){ return String(b.fecha_valor||'').localeCompare(String(a.fecha_valor||'')); });
      return reg.length ? reg[0] : null;
    };
    const tasaUSDReg = getTasa('USD');
    const tasaEURReg = getTasa('EUR');
    window._pagoTasaUSD = tasaUSDReg ? parseFloat(tasaUSDReg.tipo_cambio) : 1;
    window._pagoTasaEUR = tasaEURReg ? parseFloat(tasaEURReg.tipo_cambio) : 1;
    window._pagoTasaFechaUSD = tasaUSDReg ? tasaUSDReg.fecha_valor : null;
    window._pagoTasaFechaEUR = tasaEURReg ? tasaEURReg.fecha_valor : null;
  } catch(e) { window._pagoTasaUSD = _tasaVigente||1; window._pagoTasaEUR = 1; window._pagoTasaFechaUSD = null; window._pagoTasaFechaEUR = null; }

  // Cargar categorías de proveedor
  try {
    const cats = await api('param_categorias_proveedor','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre') || [];
    const sel = document.getElementById('pago-categoria-prov');
    if (sel) {
      sel.innerHTML = '<option value="">— Seleccionar —</option>'
        + cats.map(function(c){ return '<option value="'+c.id+'">'+c.nombre+'</option>'; }).join('');
    }
  } catch(e) {}

  // Cargar cuentas de gasto — solo grupos 6.1.02, 6.1.04, 6.2.01, 6.2.02
  try {
    const gruposGasto = ['6.1.02','6.1.04','6.2.01','6.2.02'];
    const cuentas = (await obtenerCuentasContables()).filter(function(c) {
      return c.permite_movimiento === true && c.estado === 'ACTIVA' && c.codigo && gruposGasto.some(function(g){ return c.codigo.indexOf(g) === 0; });
    }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const selC = document.getElementById('pago-cuenta-gasto');
    if (selC) {
      selC.innerHTML = '<option value="">— Seleccionar cuenta —</option>'
        + cuentas.map(function(c){ return '<option value="'+c.id_cuenta+'">'+c.codigo+' — '+c.nombre+'</option>'; }).join('');
    }
  } catch(e) {}

  // Cargar TODOS los proveedores activos -- ya no se filtra por Categoría,
  // porque ahora Proveedor va primero y Categoría se autocompleta de su ficha.
  try {
    const provs = await api('proveedores','GET',null,
      '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif,id_categoria,moneda_facturacion,tipo_contribuyente,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)') || [];
    const selProv = document.getElementById('pago-proveedor');
    if (selProv) {
      selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
        + provs.map(function(p){ return '<option value="'+p.id_proveedor+'">'+p.nombre+'</option>'; }).join('');
    }
    window._pagoProveedores = provs;
  } catch(e) { console.warn('Error cargando proveedores:', e); }

  // Poblar usuario para la confirmación
  const unEl = document.getElementById('pago-usuario-nombre');
  if (unEl) unEl.textContent = sesionActual?.nombre || sesionActual?.correo_usuario || '—';
  const uaEl = document.getElementById('pago-usuario-area');
  if (uaEl) uaEl.textContent = sesionActual?.nombre_area || '';
  const claveEl2 = document.getElementById('pago-clave');
  if (claveEl2) claveEl2.value = '';
  const confUsuarioReset = document.getElementById('pago-clave')?.closest('.form-campo');
  if (confUsuarioReset) confUsuarioReset.style.display = '';

  // Reset modalidad, tributos y crédito
  const modEl = document.getElementById('pago-modalidad');
  if (modEl) { modEl.value = ''; modEl.disabled = false; }
  const credCont = document.getElementById('pago-credito-cont');
  if (credCont) credCont.style.display = 'none';
  const vencContReset = document.getElementById('pago-vencimiento-cont');
  if (vencContReset) vencContReset.style.display = 'none';
  document.getElementById('pago-incluye-iva-val').value = '';
  const incCont = document.getElementById('pago-incluye-iva-cont');
  if (incCont) incCont.style.display = 'none';
  document.querySelectorAll('input[name="pago-incluye-iva"]').forEach(function(r){ r.checked = false; });
  const tribPrev = document.getElementById('pago-tributos-preview');
  if (tribPrev) tribPrev.style.display = 'none';
  ['pago-cuotas-num','pago-cuotas-fecha-inicio','pago-cuotas-monto'].forEach(function(id){
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cuotasIntEl = document.getElementById('pago-cuotas-intervalo');
  if (cuotasIntEl) cuotasIntEl.value = '30';
  const cuotasPrevEl = document.getElementById('pago-cuotas-preview');
  if (cuotasPrevEl) cuotasPrevEl.innerHTML = '';

  abrirModal('modal-pago');
  focusFirstField('modal-pago');
  // Posicionar el modal al inicio siempre que se abra -- si quedó scrolleado
  // hacia abajo de un uso anterior, se abría de nuevo en esa misma posición.
  // El elemento que realmente scrollea es .modal (overflow-y:auto), NO
  // .modal-body (ese solo tiene padding, sin overflow) -- por eso el reset
  // anterior no tenía ningún efecto real.
  const modalPagoEl = document.querySelector('#modal-pago .modal');
  if (modalPagoEl) modalPagoEl.scrollTop = 0;
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      if (modalPagoEl) modalPagoEl.scrollTop = 0;
    });
  });
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
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('abierto');
  el.style.display = 'none';
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

    // El login real de Supabase Auth ya corrió antes de llegar aquí (incluso en
    // cambio obligatorio), así que _sessionJWT ya está disponible — usarlo en vez de la anon key fija
    const hdrs = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
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
    if (sesionActual) sessionStorage.setItem('sd_sesion', JSON.stringify({ usuario: sesionActual, accesos: modulosAcceso, jwt: _sessionJWT, jwtExpiry: _sessionJWTExpiry, refreshToken: _sessionRefreshToken }));

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

    // Upsert: verificar si ya existe tasa para esa fecha y moneda
    async function upsertTasa(moneda, valor) {
      const existe = await api('tasas','GET',null,
        '?moneda_origen=eq.'+moneda+'&fecha_valor=eq.'+fecha+'&select=id_tasa&limit=1');
      if (existe && existe[0]) {
        // Actualizar existente
        await api('tasas','PATCH',
          { tipo_cambio: valor, fecha_registro: hoyISO, id_usuario: usuario },
          '?id_tasa=eq.'+existe[0].id_tasa);
      } else {
        // Insertar nuevo
        await api('tasas','POST',
          { moneda_origen: moneda, moneda_destino: 'VES', tipo_cambio: valor,
            fecha_valor: fecha, fecha_registro: hoyISO, id_usuario: usuario });
      }
    }

    await Promise.all([upsertTasa('USD', usd), upsertTasa('EUR', eur)]);

    const pFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'long', day:'2-digit', month:'long', year:'numeric' });
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
    msg.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>';
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
    const pFmt = new Date(fechaVal + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  weekday:'long', day:'2-digit', month:'long', year:'numeric' });
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
    btn.innerHTML = '✗ ' + msgErr(e);
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
    const solicitudRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/solicitar_recuperacion', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_correo: correo })
    });
    const solicitud = await solicitudRes.json().catch(function() { return null; });
    if (!solicitud || !solicitud.ok) {
      errEl.textContent = (solicitud && solicitud.msg) || 'Error al enviar el correo. Intente nuevamente.';
      errEl.style.display = 'block';
      return;
    }

    const enlace = `${window.location.origin}${window.location.pathname}?reset=${solicitud.token}`;

    await enviarCorreoRecuperacion(correo, solicitud.nombre, enlace, false);

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
    const resetRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/resetear_clave_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_clave_nueva: clave1 })
    });
    const resultado = await resetRes.json().catch(function() { return null; });
    if (!resultado || !resultado.ok) {
      errEl.textContent = (resultado && resultado.msg) || 'Error al actualizar la contraseña. Intente nuevamente.';
      errEl.style.display = 'block';
      return;
    }

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
    alert('Error al enviar el correo: ' + msgErr(e));
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






// Inserta un guion despues de los primeros 4 digitos (codigo de banco) para
// que el numero de cuenta tenga un punto de quiebre de linea natural en vez
// de romper feo a la mitad de un digito (ej. 0172-1111111111111111)
function fmtNumCuenta(num) {
  const soloDigitos = String(num || '').replace(/\D/g,'');
  if (soloDigitos.length <= 4) return num || '—';
  return soloDigitos.slice(0,4) + '-' + soloDigitos.slice(4);
}

function dato(label, val, fullWidth) {
  return '<div style="min-width:0'+(fullWidth ? ';grid-column:1/-1' : '')+'"><div style="font-size:10px;color:var(--suave);margin-bottom:3px">'+label+'</div>'
    +'<div style="font-size:13px;font-family:var(--font-mono);overflow-wrap:break-word'+(fullWidth ? ';white-space:nowrap' : '')+'">'+val+'</div></div>';
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
    // Misma moneda — sin conversión, monto directo
    montoPago = saldoOrig;
    if (tasaCont) tasaCont.style.display = 'none';
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
    } else if (monedaPago === 'EUR') {
      montoEl.value = fmtUSD(montoPago) + ' EUR';
    } else {
      montoEl.value = '$ ' + fmtUSD(montoPago) + ' USD';
    }
    montoEl.dataset.valor = montoPago; // guardar valor numérico para cálculos
  }
  onCambioPagoMonto();

  // Cargar métodos de pago dinámicos según moneda seleccionada
  const selMetodoManual = document.getElementById('cont-pago-manual-tipo');
  if (selMetodoManual && monedaPago) {
    selMetodoManual.innerHTML = '<option value="">⏳ Cargando...</option>';
    api('param_metodos_pago','GET',null,
      '?codigo=eq.'+monedaPago+'&estado=eq.ACTIVO&order=nombre.asc&select=id_metodo,nombre,tipo_canal,id_cuenta_contable' + emisorQ())
    .then(async function(metodosRaw) {
      // Filtrar según lo que la ficha del proveedor realmente permite
      // (metodos_pago_tipos) -- si la ficha no tiene ninguno configurado,
      // no se filtra (se muestran todos, como respaldo).
      let metodos = metodosRaw || [];
      try {
        const permitidos = JSON.parse(modal?.dataset.metodosPagoTipos || '[]');
        if (Array.isArray(permitidos) && permitidos.length) {
          metodos = metodos.filter(function(m){ return permitidos.includes(m.tipo_canal); });
        }
      } catch(eFiltro) {}
      var cuentasMap = {};
      const idsArr = (metodos||[]).map(function(m){ return m.id_cuenta_contable; }).filter(Boolean);
      if (idsArr.length) {
        try {
          const ctas = (await obtenerCuentasContables()).filter(function(c){ return idsArr.includes(c.id_cuenta); });
          (ctas||[]).forEach(function(c){ cuentasMap[c.id_cuenta] = c; });
        } catch(e) {}
      }
      if (!metodos || !metodos.length) {
        selMetodoManual.innerHTML = '<option value="">⚠ Sin métodos de pago configurados para '+monedaPago+' — configure uno en Parámetros, o en la ficha del proveedor</option>';
        return;
      }
      selMetodoManual.innerHTML = '<option value="">— Seleccione método —</option>'
        + metodos.map(function(m) {
            const cta = cuentasMap[m.id_cuenta_contable];
            return '<option value="'+m.id_metodo+'" data-cuenta-id="'+(m.id_cuenta_contable||'')+'" data-cuenta-nombre="'+(cta ? cta.codigo+' — '+cta.nombre : '')+'">'+m.nombre+'</option>';
          }).join('');
      // El campo queda oculto (ver comentario en el HTML) -- ya no lo
      // elige la persona que autoriza el pago, así que se autoselecciona
      // el primero disponible (el que la ficha del proveedor permite, o
      // el primero activo si no hay restricción configurada).
      if (metodos.length) {
        selMetodoManual.value = metodos[0].id_metodo;
        onCambioMetodoPagoManual();
      }
    }).catch(function() {
      selMetodoManual.innerHTML = '<option value="">— Sin métodos disponibles —</option>';
    });
    // Limpiar cuenta contable
    const ctaCont = document.getElementById('cont-pago-manual-cuenta-cont');
    if (ctaCont) ctaCont.style.display = 'none';
    const ctaId = document.getElementById('cont-pago-manual-cuenta-id');
    if (ctaId) ctaId.value = '';
  }
}

function onCambioMetodoPagoManual() {
  const sel = document.getElementById('cont-pago-manual-tipo');
  const opt = sel?.selectedOptions[0];
  const cuentaId     = opt?.getAttribute('data-cuenta-id')   || '';
  const cuentaNombre = opt?.getAttribute('data-cuenta-nombre') || '—';
  const ctaCont    = document.getElementById('cont-pago-manual-cuenta-cont');
  const ctaDisplay = document.getElementById('cont-pago-manual-cuenta-display');
  const ctaId      = document.getElementById('cont-pago-manual-cuenta-id');
  if (cuentaId) {
    if (ctaCont)    ctaCont.style.display   = '';
    if (ctaDisplay) ctaDisplay.textContent  = cuentaNombre;
    if (ctaId)      ctaId.value             = cuentaId;
  } else {
    if (ctaCont)    ctaCont.style.display   = 'none';
    if (ctaId)      ctaId.value             = '';
  }
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

// Pide Referencia (obligatoria) y Comprobante (opcional) en un diálogo,
// justo al momento de dar clic en "Registrar Pago" -- ya que la sección
// "Datos del Pago" permanece oculta mientras la obligación no está pagada
// (no tiene sentido mostrar campos de un pago que aún no existe).
async function abrirDialogoRegistrarPago() {
  const resultado = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8;text-align:center">Registrar Pago</div>'
      + '<label style="font-size:12px;color:#999;display:block;margin-bottom:4px">Referencia *</label>'
      + '<input type="text" id="dlg-registrar-ref" placeholder="N° referencia bancaria o comprobante" style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:14px">'
      + '<label style="font-size:12px;color:#999;display:block;margin-bottom:4px">Comprobante (opcional)</label>'
      + '<input type="file" id="dlg-registrar-archivo" accept="image/*,application/pdf" style="width:100%;box-sizing:border-box;color:#e8e8e8;font-size:12px;margin-bottom:12px">'
      + '<div id="dlg-registrar-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-confirm-si" style="background:#22c55e;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Registrar</button>'
      + '<button id="btn-confirm-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const refEl = div.querySelector('#dlg-registrar-ref');
    const errEl = div.querySelector('#dlg-registrar-err');
    refEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-confirm-si').onclick = function() {
      const val = refEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese la Referencia.'; errEl.style.display = 'block'; return; }
      const archivoInput = div.querySelector('#dlg-registrar-archivo');
      cerrar({ ref: val, archivo: (archivoInput.files && archivoInput.files[0]) || null });
    };
    div.querySelector('#btn-confirm-no').onclick = function() { cerrar(null); };
    refEl.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') div.querySelector('#btn-confirm-si').click(); });
  });
  if (!resultado) return;

  // Trasladar lo capturado a los campos reales (ocultos) que
  // contGuardarPagoCxp() ya sabe leer, sin tener que tocar esa función.
  const refFinal = document.getElementById('cont-pago-cxp-ref');
  if (refFinal) refFinal.value = resultado.ref;
  const archivoFinal = document.getElementById('cont-pago-cxp-archivo');
  if (archivoFinal && resultado.archivo) {
    try {
      const dt = new DataTransfer();
      dt.items.add(resultado.archivo);
      archivoFinal.files = dt.files;
    } catch(eDT) { console.warn('No se pudo adjuntar el comprobante:', eDT); }
  }
  await contGuardarPagoCxp();
}

async function contGuardarPagoCxp() {
  if (!puedo('PAGOS','PAGAR') && !sesionActual?.administrador) { alert('No tiene permiso para procesar pagos.'); return; }
  const id_cxp = parseInt(document.getElementById('cont-pago-cxp-id')?.value) || null;
  const ref    = document.getElementById('cont-pago-cxp-ref')?.value || '';
  const facturaNoCxp = document.getElementById('cont-pago-cxp-factura-no')?.value || '';
  const okEl   = document.getElementById('alerta-pago-cxp-ok');
  const errEl  = document.getElementById('alerta-pago-cxp-err');
  if (okEl)  okEl.style.display  = 'none';
  if (errEl) errEl.style.display = 'none';

  const mostrarError = function(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else { alert(msg); }
  };

  if (!id_cxp) { mostrarError('Obligación no identificada.'); return; }
  if (!ref.trim()) {
    mostrarError('Debe ingresar el número de referencia o comprobante.');
    document.getElementById('cont-pago-cxp-ref')?.focus();
    return;
  }
  if (!facturaNoCxp.trim()) {
    mostrarError('Debe ingresar el N° de Factura del Proveedor.');
    document.getElementById('cont-pago-cxp-factura-no')?.focus();
    return;
  }

  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=*,proveedores:id_proveedor(nombre,id_categoria,metodos_pago_tipos),cuenta_gasto:id_cuenta_gasto(id_cuenta,codigo,nombre)');
    if (!rows || !rows[0]) return;
    const c = rows[0];
    c.numero_factura_proveedor = facturaNoCxp.trim();

    // Monto/Moneda ya quedaron definidos al crear la Obligación -- pero la
    // TASA se busca fresca aquí (la real del día en que se ejecuta el
    // pago), no la congelada desde la creación.
    const monedaPagoReg = c.moneda_pago || 'VES';
    const monedaNegReg  = (c.moneda_negociacion || monedaPagoReg).toUpperCase();
    const montoVESCongReg = parseFloat(c.monto_ves || 0);
    const montoUSDCongReg = parseFloat(c.monto_usd || 0);
    const fecha     = new Date().toISOString().split('T')[0]; // fecha real en que se ejecuta el pago

    let tasaDia = parseFloat(c.tasa_bcv || 1);
    try {
      const tasasHoyReg = await api('tasas','GET',null,'?fecha_valor=lte.'+fecha+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      if (tasasHoyReg && tasasHoyReg[0]) tasaDia = parseFloat(tasasHoyReg[0].tipo_cambio);
    } catch(eTasaReg) {}

    // La Moneda de NEGOCIACIÓN determina cuál es la deuda REAL:
    //   - Misma Moneda que se paga -- sin conversión, sin diferencial.
    //   - Deuda real en Bs, pagada en USD -- se convierte con la tasa de
    //     HOY. El Bs nunca cambia de valor -- SIN diferencial.
    //   - Deuda real en USD, pagada en Bs -- se recalcula con la tasa de
    //     HOY. SÍ hay diferencial cambiario.
    let montoUSD, montoVESReg, diferencialReg = 0;
    if (monedaNegReg === monedaPagoReg) {
      montoUSD = montoUSDCongReg;
      montoVESReg = montoVESCongReg;
    } else if (monedaNegReg === 'VES') {
      montoVESReg = montoVESCongReg;
      montoUSD = parseFloat((montoVESCongReg / (tasaDia || 1)).toFixed(2));
    } else {
      montoUSD = montoUSDCongReg;
      montoVESReg = parseFloat((montoUSDCongReg * tasaDia).toFixed(2));
      diferencialReg = parseFloat((montoVESReg - montoVESCongReg).toFixed(2));
    }
    const moneda = monedaPagoReg;
    const monto  = moneda === 'VES' ? montoVESReg : montoUSD;

    // Corregir la CxP con los montos REALES a la fecha de pago -- si la
    // deuda real es en Bs, se corrige el monto_usd (era la estimación); si
    // la deuda real es en USD, se corrige el monto_ves (era la estimación
    // al negociar, la tasa de hoy es la real).
    if (monedaNegReg !== monedaPagoReg) {
      try {
        const patchCorrReg = { tasa_bcv: tasaDia };
        if (monedaNegReg === 'VES') patchCorrReg.monto_usd = montoUSD;
        else patchCorrReg.monto_ves = montoVESReg;
        await api('cont_cxp','PATCH', patchCorrReg, '?id_cxp=eq.'+id_cxp);
        c.tasa_bcv = tasaDia;
        if (monedaNegReg === 'VES') c.monto_usd = montoUSD; else c.monto_ves = montoVESReg;
      } catch(eCorrReg) { console.warn('Error corrigiendo montos reales de la CxP:', eCorrReg); }
    }

    // Método de Pago Y Cuenta Contable real (Efectivo -> Caja,
    // Transferencia/Afiliación -> Banco) -- según lo que permite la ficha
    // del proveedor + la Moneda, mismo criterio y misma tabla que usa
    // Ejecutar Pago (_resolverMetodoPagoEjecucion). Antes esta ruta
    // ("Registrar Pago" rápido desde la Ficha) ignoraba la Cuenta y siempre
    // usaba Banco USD/VES fijo, sin importar si el Proveedor cobra en
    // Efectivo. Se guarda el id_metodo (numérico) en metodo_pago -- mismo
    // formato que usa Ejecutar Pago, para que la Ficha lo resuelva igual.
    let tipoMetodo = (c.proveedores && Array.isArray(c.proveedores.metodos_pago_tipos) && c.proveedores.metodos_pago_tipos[0]) || '';
    let idMetodoResuelto = null;
    let idCuentaDestino  = null;
    try {
      let metRows = tipoMetodo
        ? await api('param_metodos_pago','GET',null,'?codigo=eq.'+moneda+'&tipo_canal=eq.'+tipoMetodo+'&estado=eq.ACTIVO&limit=1&select=id_metodo,id_cuenta_contable,tipo_canal')
        : null;
      if (!metRows || !metRows[0]) {
        // Sin Método configurado en la ficha -- cae a un método activo
        // genérico para esa Moneda (mismo respaldo de siempre)
        metRows = await api('param_metodos_pago','GET',null,'?codigo=eq.'+moneda+'&estado=eq.ACTIVO&order=nombre.asc&limit=1&select=id_metodo,id_cuenta_contable,tipo_canal');
      }
      if (metRows && metRows[0]) {
        idMetodoResuelto = metRows[0].id_metodo;
        idCuentaDestino  = metRows[0].id_cuenta_contable;
        tipoMetodo       = metRows[0].tipo_canal || tipoMetodo;
      }
    } catch(eMet) {}
    if (!tipoMetodo) tipoMetodo = 'TRANSFERENCIA';
    const metodo = tipoMetodo;

    // Redondeado a 2 decimales (precisión real de moneda) -- si se queda
    // en 4, una división Bs/tasa puede dejar un residuo de centésimas de
    // centavo (ej. $0,0001) que la comparación siguiente no perdona,
    // marcando PARCIAL algo que en la práctica ya quedó pagado completo
    // (pasaba incluso en Obligaciones de Contado, que nunca deberían
    // quedar parciales).
    const nuevoPagado = parseFloat((parseFloat(c.pagado_usd||0) + montoUSD).toFixed(2));
    const nuevoSaldo  = parseFloat(Math.max(0, parseFloat(c.monto_usd||0) - nuevoPagado).toFixed(2));
    const nuevoEstado = nuevoSaldo <= 0 ? 'PAGADA' : 'PARCIAL';

    // Subir comprobante si se adjuntó archivo
    let urlComprobante = null;
    const archivoEl = document.getElementById('cont-pago-cxp-archivo');
    if (archivoEl && archivoEl.files && archivoEl.files[0]) {
      try {
        urlComprobante = await subirFoto(archivoEl.files[0], 'comprobantes/' + id_cxp);
      } catch(eFile) { console.warn('Error subiendo comprobante:', eFile); }
    }

    // Guardar datos del pago -- la aprobación del superior ya ocurrió
    // antes de llegar aquí (la CxP estaba en estado APROBADA), así que
    // este paso va directo a PAGADA/PARCIAL y genera el asiento real.
    const patchData = {
      estado:          nuevoEstado,
      pagado_usd:      nuevoPagado,
      saldo_usd:       nuevoSaldo,
      referencia:      ref,
      numero_factura_proveedor: c.numero_factura_proveedor,
      fecha_pago:      fecha,
      metodo_pago:     idMetodoResuelto,
      pagado_por:      sesionActual?.correo_usuario || null
    };
    if (urlComprobante) patchData.url_comprobante = urlComprobante;

    await api('cont_cxp','PATCH', patchData, '?id_cxp=eq.'+id_cxp);

    // ── Generar el asiento contable real del pago ──
    try {
      const id_emisor  = _empresaActiva?.id_empresa || 0;
      const tasaPago   = tasaDia;

      const codigosArr = moneda === 'USD' ? ['2.1.01.001','1.1.01.004','6.2.01.003','4.2.01.003','6.1.04.003','2.1.03.004'] : ['2.1.01.001','1.1.01.003'];
      const cuentasAstFull = await obtenerCuentasContables();
      const cuentasAst = cuentasAstFull.filter(function(c){ return codigosArr.includes(c.codigo); });
      const getCta = function(cod){ return cuentasAst.find(function(x){ return x.codigo===cod; }); };
      const cCxP      = getCta('2.1.01.001');
      const cDifGasto = getCta('6.2.01.003');
      const cDifIngr  = getCta('4.2.01.003');
      const cIGTF     = getCta('6.1.04.003');
      const cIGTFPagar = getCta('2.1.03.004');
      // Cuenta de Caja/Banco real, resuelta arriba según el Método de Pago
      // del Proveedor -- si por algún motivo no se pudo resolver (Método
      // sin Cuenta Contable configurada), cae a Banco USD/VES fijo como
      // respaldo, igual que el comportamiento de siempre.
      const cDestino = (idCuentaDestino && cuentasAstFull.find(function(x){ return x.id_cuenta === idCuentaDestino; }))
        || (moneda === 'VES' ? getCta('1.1.01.003') : getCta('1.1.01.004'));
      const cBanVES = moneda === 'VES' ? cDestino : getCta('1.1.01.003');
      const cBanUSD = moneda === 'USD' ? cDestino : getCta('1.1.01.004');

      // El asiento de PAGO siempre debita CxP Proveedores (cierra el
      // pasivo) -- la cuenta de Gasto ya se debitó en el asiento de
      // creación de la Obligación (GASTO_MANUAL). Debitarla otra vez aquí
      // duplicaría el gasto y nunca cerraría la cuenta por pagar.
      const cDebito = cCxP;

      let pctIGTF = 0.03;
      try {
        const trib = await api('param_tributos','GET',null,'?codigo=eq.IGTF&select=alicuota&limit=1');
        if (trib && trib[0]) pctIGTF = parseFloat(trib[0].alicuota) / 100;
      } catch(e2) {}

      const anio = new Date(fecha).getFullYear();
      const ults = await api('cont_asientos','GET',null,'?id_empresa=eq.'+id_emisor+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
      let seq = 1;
      if (ults[0]?.numero_asiento) { const mm = ults[0].numero_asiento.match(/(\d+)$/); if (mm) seq = parseInt(mm[1])+1; }
      const numAst = 'AST-' + anio + '-' + String(seq).padStart(4,'0');

      const ast = await api('cont_asientos','POST',{
        id_empresa: id_emisor, numero_asiento: numAst, tipo: 'PAGO_PROVEEDOR', fecha: fecha,
        descripcion: 'Pago ' + (c.proveedores?.nombre||'Proveedor') + ' | Doc: ' + (c.numero_doc||'') + ' | Ref: ' + ref,
        referencia: c.numero_doc || ('CXP-'+id_cxp),
        // moneda_base -- la Moneda FUNCIONAL de la Empresa (normalmente
        // VES), no la de esta transacción puntual. Antes quedaba en
        // 'moneda' (la de este pago), generando asientos "en USD" aunque
        // la Empresa lleve su contabilidad en VES -- mismo criterio ya
        // usado en Entradas, Devoluciones y Ejecutar Pago.
        estado: 'APROBADO', moneda_base: ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(), tasa_bcv: tasaPago,
        id_usuario: sesionActual?.correo_usuario || null
      });
      const ar = Array.isArray(ast) ? ast[0] : ast;
      if (ar?.id_asiento) {
        const idAst = ar.id_asiento;
        let orden = 1;
        // Mismo concepto en todas las líneas del asiento -- antes cada
        // línea tenía su propia frase distinta ('Cancelación CxP...' /
        // 'Salida banco...'), lo cual no tenía sentido para un mismo
        // movimiento.
        // Mismo texto en todas las líneas del asiento, sin prefijos ni
        // guiones: Proveedor + Categoría + Concepto de la Obligación.
        let categoriaNombreLinea = '';
        if (c.proveedores?.id_categoria) {
          try {
            const catRowsLinea = await api('param_categorias_proveedor','GET',null,'?id=eq.'+c.proveedores.id_categoria+'&select=nombre&limit=1');
            categoriaNombreLinea = catRowsLinea?.[0]?.nombre || '';
          } catch(eCatLinea) {}
        }
        const numFacturaRefLinea = c.numero_factura_proveedor || c.referencia || c.numero_doc || '';
        const esEntradaLinea = /^ENT-/.test(c.numero_doc || '');
        const mEntLinea = (c.numero_doc || '').match(/^ENT-(\d+)/);
        const refEntLinea = mEntLinea ? ('ENT-' + mEntLinea[1]) : (c.numero_doc || '');
        const sufijoPagoLinea = esEntradaLinea
          ? (' N° Factura ' + numFacturaRefLinea + ' (' + refEntLinea + ') Ref. Pago ' + ref)
          : (' N° Factura ' + numFacturaRefLinea + ' Ref. Pago ' + ref);
        const descCxP   = 'Pago' + sufijoPagoLinea;
        const descBanco = 'Egreso por Pago' + sufijoPagoLinea;

        if (moneda === 'VES') {
          // montoVESCongReg = el monto ORIGINAL ya congelado en la CxP. Si
          // la deuda real es en USD (monedaNegReg='USD'), montoVESReg ya
          // viene recalculado arriba con la tasa de HOY -- la diferencia
          // entre ambos es el diferencial cambiario real.
          if (cDebito) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cDebito.id_cuenta, orden:orden++,
            descripcion:descCxP,
            debe_usd:0, haber_usd:0, debe_ves:montoVESCongReg, haber_ves:0, tasa_bcv:tasaPago });
          if (Math.abs(diferencialReg) > 0.01) {
            if (diferencialReg > 0 && cDifGasto) {
              await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cDifGasto.id_cuenta, orden:orden++,
                descripcion:'Pérdida por diferencia cambiaria',
                debe_usd:0, haber_usd:0, debe_ves:diferencialReg, haber_ves:0, tasa_bcv:tasaPago });
            } else if (diferencialReg < 0 && cDifIngr) {
              await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cDifIngr.id_cuenta, orden:orden++,
                descripcion:'Ganancia por diferencia cambiaria',
                debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:Math.abs(diferencialReg), tasa_bcv:tasaPago });
            }
          }
          if (cBanVES) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cBanVES.id_cuenta, orden:orden++,
            descripcion:descBanco,
            debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:monto, tasa_bcv:tasaPago });
        } else {
          // montoVESReg ya viene calculado arriba con el criterio simétrico
          // (mismo congelado si se negoció y paga en USD; nunca hay
          // diferencial en este lado -- ver comentario en el cálculo de
          // arriba: el Bs nunca cambia de valor cuando la deuda real es en
          // Bs y se paga en USD, solo se traduce a dólares).
          const montoVESCompra = montoVESReg;
          const montoIGTF_USD  = parseFloat((montoUSD * pctIGTF).toFixed(2));
          const montoIGTF_VES  = parseFloat((montoIGTF_USD * tasaPago).toFixed(2));
          // IGTF -- si esta CxP ya trae aplica_igtf resuelto (no NULL), el
          // IGTF ya se reconoció en el asiento de creación (GASTO_MANUAL) y
          // ya está horneado en monto_usd/saldo_usd -- agregarlo otra vez
          // aquí lo duplicaría. Solo las filas viejas (aplica_igtf NULL,
          // creadas antes de esta corrección) siguen calculándolo en el
          // momento del pago, como siempre.
          const igtfYaResueltoReg = c.aplica_igtf !== null && c.aplica_igtf !== undefined;

          if (cDebito) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cDebito.id_cuenta, orden:orden++,
            descripcion:descCxP,
            debe_usd:montoUSD, haber_usd:0, debe_ves:montoVESCompra, haber_ves:0, tasa_bcv:tasaPago });

          if (!igtfYaResueltoReg) {
            if (cIGTF) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cIGTF.id_cuenta, orden:orden++,
              descripcion:'Gasto IGTF pago'+sufijoPagoLinea,
              debe_usd:montoIGTF_USD, haber_usd:0, debe_ves:montoIGTF_VES, haber_ves:0, tasa_bcv:tasaPago });
            if (cIGTFPagar) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cIGTFPagar.id_cuenta, orden:orden++,
              descripcion:'IGTF por Pagar (enterar primeros 12 días del mes)',
              debe_usd:0, haber_usd:montoIGTF_USD, debe_ves:0, haber_ves:montoIGTF_VES, tasa_bcv:tasaPago });
          }

          // Lo que sale de Banco/Caja es solo el monto de la CxP (el
          // IGTF, cuando se calcula aquí en filas viejas, queda como
          // pasivo acumulado en 2.1.03.004 -- Debe IGTF / Haber IGTF por
          // Pagar ya se cuadran entre sí, no sale de Banco en esta misma
          // transacción; se entera al fisco aparte).
          if (cBanUSD) await api('cont_asiento_lineas','POST',{ id_asiento:idAst, id_cuenta:cBanUSD.id_cuenta, orden:orden++,
            descripcion:descBanco,
            debe_usd:0, haber_usd:montoUSD, debe_ves:0, haber_ves:montoVESCompra, tasa_bcv:tasaPago });
        }
      }
    } catch(eAst) { console.warn('Error generando asiento de pago:', eAst); }

    okEl.textContent = '✓ Pago registrado y contabilizado correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-cont-pago-cxp');
      cargarPagos();
    }, 1000);
  } catch(e) {
    errEl.textContent = 'Error: '+msgErr(e);
    errEl.style.display = 'block';
  }
}


async function anularPagoEjecutado(id_cxp) {
  if (!sesionActual?.administrador && !puedo('PAGOS','ANULAR')) { alert('No tiene permiso para anular pagos.'); return; }
  if (!(await tieneNivelMinimo(1))) { alert('Esta acción requiere Firma de Aprobación Nivel 1.'); return; }

  const resultado = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%;text-align:center">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8">Esta acción ANULA un pago YA EJECUTADO y el asiento de pago asociado.<br><span style="font-size:12px;color:#666">La CxP vuelve a PENDIENTE. El asiento de la compra/entrada original NO se toca.</span></div>'
      + '<input type="password" id="anular-pago-clave" autocomplete="new-password" placeholder="Ingrese su contraseña para confirmar" style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:16px">'
      + '<div id="anular-pago-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-rev-si" style="background:#ef4444;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Sí, Anular</button>'
      + '<button id="btn-rev-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const claveEl = div.querySelector('#anular-pago-clave');
    const errEl   = div.querySelector('#anular-pago-err');
    claveEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-rev-si').onclick = function() {
      const val = claveEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese su contraseña.'; errEl.style.display = 'block'; return; }
      cerrar(val);
    };
    div.querySelector('#btn-rev-no').onclick = function() { cerrar(null); };
    claveEl.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') div.querySelector('#btn-rev-si').click(); });
  });
  if (!resultado) return;
  const clave = resultado;

  try {
    const verif = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verif.ok) { alert(verif.msg || 'Contraseña incorrecta.'); return; }
  } catch(eV) { alert('Error verificando contraseña: ' + msgErr(eV)); return; }

  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=monto_usd,monto_ves,numero_doc,estado');
    if (!rows || !rows[0]) throw new Error('CxP no encontrada.');
    const c = rows[0];
    if (c.estado !== 'PAGADA' && c.estado !== 'PARCIAL') { alert('Esta CxP no está en estado PAGADA ni PARCIAL.'); return; }

    // 1. Devolver la CxP a PENDIENTE (dejar sin efecto el pago registrado)
    await api('cont_cxp','PATCH',
      { estado: 'PENDIENTE', pagado_usd: 0, saldo_usd: c.monto_usd, fecha_pago: null, metodo_pago: null, revertido_por: sesionActual?.correo_usuario || null },
      '?id_cxp=eq.'+id_cxp);

    // 2. Anular el asiento de pago asociado (NO el de la compra/entrada original)
    // — se usan varios nombres de "tipo" en distintos flujos de pago
    const asientos = await api('cont_asientos','GET',null,
      '?referencia=eq.'+encodeURIComponent(c.numero_doc)+emisorQ()+'&tipo=in.(PAGO_PROVEEDOR,PAGO_CXP,PAGO_MANUAL)&estado=neq.ANULADO&select=id_asiento,descripcion');
    for (const a of (asientos||[])) {
      await api('cont_asientos','PATCH',
        { estado: 'ANULADO', descripcion: '[ANULADO] ' + (a.descripcion||'') },
        '?id_asiento=eq.'+a.id_asiento);
    }

    cerrarModal('modal-cont-pago-cxp');
    cerrarModal('modal-ver-cxp-auto');
    cargarPagos();
  } catch(e) { alert('Error al anular el pago: '+msgErr(e)); }
}

async function anularPagoCxP(id_cxp) {
  if (!puedo('PAGOS','ELIMINAR') && !sesionActual?.administrador) { alert('No tiene permiso para anular obligaciones de pago.'); return; }

  const clave = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%;text-align:center">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8">¿Anular esta CxP?<br><span style="font-size:12px;color:#666">Solo se revertirán asientos de pago, NO los de inventario.</span></div>'
      + '<input type="password" id="anular-cxp-clave" autocomplete="new-password" placeholder="Ingrese su contraseña para confirmar" style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:16px">'
      + '<div id="anular-cxp-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-confirm-si" style="background:#ef4444;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Sí, Anular</button>'
      + '<button id="btn-confirm-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const claveEl = div.querySelector('#anular-cxp-clave');
    const errEl   = div.querySelector('#anular-cxp-err');
    claveEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-confirm-si').onclick = function() {
      const val = claveEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese su contraseña.'; errEl.style.display = 'block'; return; }
      cerrar(val);
    };
    div.querySelector('#btn-confirm-no').onclick = function() { cerrar(null); };
    claveEl.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') div.querySelector('#btn-confirm-si').click(); });
  });
  if (!clave) return;

  const verifAnular = await verificarContrasena(sesionActual.correo_usuario, clave);
  if (!verifAnular.ok) { alert(verifAnular.msg || 'Contraseña incorrecta.'); return; }

  const _chkPag = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=estado');
  if (_chkPag && _chkPag[0] && _chkPag[0].estado === 'PAGADA') { alert('Un pago aprobado no puede anularse desde CxP.'); return; }
  try {
    // 1. Anular la CxP
    await api('cont_cxp','PATCH',
      { estado: 'ANULADA', observaciones: '[ANULADA] ', anulado_por: sesionActual?.correo_usuario || null },
      '?id_cxp=eq.'+id_cxp);

    // 2. Anular asientos contables asociados (marcar ANULADO, sin contrapartida)
    const numDoc = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=numero_doc');
    if (numDoc && numDoc[0]) {
      // El asiento se creó con referencia = numDocBase, SIN el sufijo
      // "-<id_cxp>" -- ese sufijo se agrega al numero_doc de la CxP DESPUÉS
      // de crear el asiento. Hay que quitarlo antes de buscar, si no nunca
      // coincide con el asiento real (mismo bug del punto 14, sin corregir aquí).
      const numDocConSufijo = numDoc[0].numero_doc;
      const ref = numDocConSufijo ? numDocConSufijo.replace(new RegExp('-'+id_cxp+'$'), '') : numDocConSufijo;
      // Solo anular asientos de PAGO_PROVEEDOR - NO los de entrada de inventario
      const asientos = await api('cont_asientos','GET',null,
        '?referencia=eq.'+encodeURIComponent(ref)+emisorQ()+'&tipo=in.(PAGO_PROVEEDOR,PAGO_CXP,PAGO_MANUAL,GASTO_MANUAL)&estado=neq.ANULADO&select=id_asiento,descripcion');
      for (const a of (asientos||[])) {
        await api('cont_asientos','PATCH',
          { estado: 'ANULADO', descripcion: '[ANULADO] ' + (a.descripcion||'') },
          '?id_asiento=eq.'+a.id_asiento);
      }
    }

    cerrarModal('modal-cont-pago-cxp');
    cargarPagos();
  } catch(e) { alert('Error al anular: '+msgErr(e)); }
}

// Deshace una anulación hecha por error -- SOLO si la CxP nunca tuvo pago
// (ni completo ni parcial) antes de anularse. Si alguna vez tuvo un pago,
// este no es el camino: ese caso toca el terreno de "reversar" un pago ya
// ejecutado, que es un problema distinto (afecta el Estado de Resultados
// del período en que se pagó) y se resuelve aparte, no aquí.
async function reactivarPagoCxP(id_cxp) {
  if (!puedo('PAGOS','ELIMINAR') && !sesionActual?.administrador) { alert('No tiene permiso para reactivar obligaciones de pago.'); return; }

  const chk = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=estado,numero_doc,pagado_usd,fecha_pago,observaciones');
  if (!chk || !chk[0]) { alert('CxP no encontrada.'); return; }
  const cxpChk = chk[0];
  if (cxpChk.estado !== 'ANULADA') { alert('Esta CxP no está en estado ANULADA.'); return; }
  if (parseFloat(cxpChk.pagado_usd || 0) > 0 || cxpChk.fecha_pago) {
    alert('Esta CxP tuvo un pago registrado antes de anularse -- no se puede reactivar por esta vía. Consulte para resolverlo caso por caso.');
    return;
  }

  const clave = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%;text-align:center">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8">¿Reactivar esta CxP anulada?<br><span style="font-size:12px;color:#666">Volverá a estado PENDIENTE. Solo use esto si se anuló por equivocación.</span></div>'
      + '<input type="password" id="reactivar-cxp-clave" autocomplete="new-password" placeholder="Ingrese su contraseña para confirmar" style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:16px">'
      + '<div id="reactivar-cxp-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-confirm-si" style="background:#22c55e;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Sí, Reactivar</button>'
      + '<button id="btn-confirm-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const claveEl = div.querySelector('#reactivar-cxp-clave');
    const errEl   = div.querySelector('#reactivar-cxp-err');
    claveEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-confirm-si').onclick = function() {
      const val = claveEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese su contraseña.'; errEl.style.display = 'block'; return; }
      cerrar(val);
    };
    div.querySelector('#btn-confirm-no').onclick = function() { cerrar(null); };
    claveEl.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') div.querySelector('#btn-confirm-si').click(); });
  });
  if (!clave) return;

  const verifReactivar = await verificarContrasena(sesionActual.correo_usuario, clave);
  if (!verifReactivar.ok) { alert(verifReactivar.msg || 'Contraseña incorrecta.'); return; }

  try {
    // 1. Regresar la CxP a PENDIENTE
    await api('cont_cxp','PATCH',
      { estado: 'PENDIENTE', observaciones: (cxpChk.observaciones || '').replace(/^\[ANULADA\]\s*/, ''), revertido_por: sesionActual?.correo_usuario || null },
      '?id_cxp=eq.'+id_cxp);

    // 2. Restaurar (APROBADO) el asiento GASTO_MANUAL que se anuló al cancelarla
    const numDocConSufijo = cxpChk.numero_doc;
    const ref = numDocConSufijo ? numDocConSufijo.replace(new RegExp('-'+id_cxp+'$'), '') : numDocConSufijo;
    const asientos = await api('cont_asientos','GET',null,
      '?referencia=eq.'+encodeURIComponent(ref)+emisorQ()+'&tipo=eq.GASTO_MANUAL&estado=eq.ANULADO&select=id_asiento,descripcion');
    for (const a of (asientos||[])) {
      await api('cont_asientos','PATCH',
        { estado: 'APROBADO', descripcion: (a.descripcion||'').replace(/^\[ANULADO\]\s*/, '') },
        '?id_asiento=eq.'+a.id_asiento);
    }

    cerrarModal('modal-cont-pago-cxp');
    cargarPagos();
  } catch(e) { alert('Error al reactivar: '+msgErr(e)); }
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
        + dato('N° Cuenta', fmtNumCuenta(p.numero_cuenta), true);
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

// Determina si aplica IGTF para ESTA Obligación puntual: Contribuyente
// Especial + Moneda seleccionada en USD. Antes se decidía con
// moneda_facturacion (fija en la ficha del Proveedor) y el campo Moneda
// quedaba bloqueado -- ahora el campo es editable (el Usuario puede pagar
// en una moneda distinta a la de facturación del Proveedor para esta
// Obligación puntual) y el IGTF se reevalúa según lo que realmente esté
// seleccionado. Mismo criterio y mismo patrón que Entradas
// (_actualizarAplicaIGTFEntrada).
// El IGTF ya NO se calcula ni se muestra en la vista previa de la CxP
// manual -- depende de en qué Moneda se termine pagando, y eso se decide
// recién al pagar (puede cambiar entre que se crea la Obligación y que
// efectivamente se paga). Esta función queda neutralizada a propósito.
async function _actualizarAplicaIGTFPago(monedaFieldId) {
  window._aplicaIGTFPago = false;
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
  const selCat     = document.getElementById('pago-categoria-prov');
  const selCta     = document.getElementById('pago-cuenta-gasto');
  const selMon     = document.getElementById('pago-moneda');

  // Reset
  [bancoInfo, pmInfo, manualInfo].forEach(function(el){ if (el) el.style.display = 'none'; });
  if (rifEl)     rifEl.value = '';
  if (metodoDisp) metodoDisp.textContent = '—';
  if (selCat) selCat.value = '';
  if (selCta) selCta.value = '';
  if (selMon) selMon.value = '';
  // IGTF -- reset al cambiar de Proveedor; se re-detecta abajo si corresponde
  window._tipoContribProveedorPago = null;
  window._aplicaIGTFPago = false;
  window._tasaIGTFPago = 0.03;

  if (!idProv) { calcularTributosPago(); return; }

  // Use cached data if available, else fetch
  let p = (window._pagoProveedores||[]).find(function(x){ return x.id_proveedor === idProv; });
  if (!p) {
    try {
      const rows = await api('proveedores','GET',null,
        '?id_proveedor=eq.'+idProv+'&select=nombre,rif,id_categoria,moneda_facturacion,tipo_contribuyente,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)');
      p = rows?.[0];
    } catch(e) {}
  }
  if (!p) { if (manualInfo) manualInfo.style.display = ''; calcularTributosPago(); return; }

  // IGTF -- el criterio real es Contribuyente Especial + Moneda de esta
  // Obligación en USD (no la Moneda de Facturación fija del Proveedor). Se
  // guarda el Tipo de Contribuyente aparte, y se reevalúa más abajo, ya con
  // la Moneda propuesta por defecto -- el Usuario puede después cambiarla
  // para esta Obligación puntual, y el IGTF se reevalúa en vivo (ver
  // onCambiarMonedaPago).
  window._tipoContribProveedorPago = p.tipo_contribuyente || null;

  // Categoría de Servicio -- de solo lectura, según la ficha del proveedor
  if (selCat) selCat.value = p.id_categoria || '';
  if (selMon) {
    selMon.value = p.moneda_facturacion || 'USD';
    await _actualizarAplicaIGTFPago('pago-moneda');
    onCambiarMonedaPago();
  }

  // Cuenta de Gasto -- se autocompleta con la cuenta contable configurada
  // para esta Categoría de Servicio (Parámetros del Sistema), pero el select
  // queda editable por si el caso puntual requiere una cuenta distinta.
  if (selCta && p.id_categoria) {
    try {
      const catRows = await api('param_categorias_proveedor','GET',null,
        '?id=eq.'+p.id_categoria+'&select=id_cuenta_contable&limit=1');
      const idCuenta = catRows?.[0]?.id_cuenta_contable;
      if (idCuenta) selCta.value = idCuenta;
    } catch(e) { console.warn('Error buscando cuenta contable de la categoría:', e); }
  }

  // RIF
  if (rifEl) rifEl.value = p.rif || '';

  const tieneBanco = !!p.id_banco;
  const tienePM    = !!p.pm_id_banco;

  if (tieneBanco && bancoDatos) {
    bancoDatos.innerHTML =
      dato('Institución', p.banco_prov?.nombre || '—')
      + dato('Tipo Cuenta', p.tipo_cuenta || '—')
      + dato('N° Cuenta', fmtNumCuenta(p.numero_cuenta), true);
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

async function verPagoCxP(id_cxp) {
  try {
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+id_cxp+'&select=*,proveedores:id_proveedor(nombre,rif,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre))');
    if (!rows || !rows[0]) return;
    const c    = rows[0];
    const prov = c.proveedores || {};
    const esManual = !(c.tipo||'').includes('COMPRA_CONSUMIBLE');

    // Llenar modal en modo solo lectura
    document.getElementById('cont-pago-cxp-id').value    = id_cxp;
    document.getElementById('cont-pago-cxp-fecha').value = c.fecha_emision || '';
    document.getElementById('cont-pago-cxp-ref').value   = c.referencia || '';
    const conceptoVer = document.getElementById('cont-pago-cxp-concepto');
    if (conceptoVer) conceptoVer.value = c.observaciones || '';
    document.getElementById('alerta-pago-cxp-ok').style.display  = 'none';
    document.getElementById('alerta-pago-cxp-err').style.display = 'none';

    const saldoEl = document.getElementById('cont-pago-cxp-saldo');
    if (saldoEl) {
      const monedaV = c.moneda_pago || 'USD';
      if (monedaV === 'VES') saldoEl.textContent = fmtBs(c.monto_ves || c.monto_usd) + ' Bs';
      else if (monedaV === 'EUR') saldoEl.textContent = fmtUSD(c.monto_usd) + ' EUR';
      else saldoEl.textContent = '$ ' + fmtUSD(c.monto_usd) + ' USD';
    }

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
      bancoDatos.innerHTML = dato('Institución', prov.banco_prov?.nombre||'—') + dato('Tipo', prov.tipo_cuenta||'—') + dato('N° Cuenta', fmtNumCuenta(prov.numero_cuenta), true);
      if (bancoInfo) bancoInfo.style.display = '';
    }
    if (prov.pm_id_banco && pmDatos) {
      pmDatos.innerHTML = dato('Banco', prov.banco_pm?.nombre||'—') + dato('C.I./R.I.F', prov.pm_ci||'—') + dato('Celular', prov.pm_celular||'—');
      if (pmInfo) pmInfo.style.display = '';
    }

    // Mostrar comprobante si existe
    const archivoCampo2 = document.getElementById('cont-pago-cxp-archivo-campo');
    if (archivoCampo2) archivoCampo2.style.display = 'none';
    const previewCont2 = document.getElementById('cont-pago-cxp-archivo-preview-cont');
    const previewEl2   = document.getElementById('cont-pago-cxp-archivo-preview');
    if (previewEl2) {
      if (c.url_comprobante) {
        const url = c.url_comprobante;
        const esImg = url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        let html = '<div style="margin-top:8px"><div style="font-size:10px;color:var(--suave);margin-bottom:4px">Comprobante:</div>';
        if (esImg) {
          html += '<a href="' + url + '" target="_blank"><img src="' + url + '" style="max-width:100%;max-height:200px;border-radius:6px;border:1px solid var(--borde);cursor:pointer"></a>';
        } else {
          html += '<a href="' + url + '" target="_blank" style="color:var(--naranja);font-size:12px">&#x1F4C4; Ver comprobante PDF</a>';
        }
        html += '</div>';
        previewEl2.innerHTML = html;
      } else {
        previewEl2.innerHTML = '<div style="font-size:11px;color:var(--suave);margin-top:4px">Sin comprobante adjunto</div>';
      }
      if (previewCont2) previewCont2.style.display = '';
    }
    // Hacer referencia readonly en modo VER
    const refEl = document.getElementById('cont-pago-cxp-ref');
    if (refEl) refEl.readOnly = true;
    // Ocultar solo el input de archivo en modo VER (no el contenedor)
    const archivoInput2 = document.getElementById('cont-pago-cxp-archivo');
    if (archivoInput2) archivoInput2.style.display = 'none';

    // Título modo VER
    const tituloVer = document.getElementById('cont-pago-cxp-titulo');
    if (tituloVer) tituloVer.textContent = 'DETALLE DE PAGO';

    // Cambiar botones del modal — solo Anular (si manual) y Retornar
    const footer = document.querySelector('#modal-cont-pago-cxp .modal-footer');
    if (footer) {
      const btnEditar = (esManual && est === 'PENDIENTE' && puedo('PAGOS','EDITAR'))
        ? '<button class="btn-naranja" onclick="editarCxPManual('+id_cxp+')">✏️ Editar</button>' : '';
      const btnAnular = (esManual && est !== 'PAGADA')
        ? '<button class="btn-peligro" onclick="anularPagoCxP('+id_cxp+')">🗑 Anular</button>' : '';
      footer.innerHTML = btnEditar + btnAnular
        + '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-pago-cxp\');cargarPagos()">RETORNAR</button>';
    }

    abrirModal('modal-cont-pago-cxp');
  } catch(e) { alert('Error: '+msgErr(e)); }
}

async function editarCxPManual(id_cxp) {
  if (!puedo('PAGOS','EDITAR') && !sesionActual?.administrador) { alert('No tiene permiso para editar obligaciones de pago.'); return; }
  cerrarModal('modal-cont-pago-cxp');
  try {
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+id_cxp+'&select=*,proveedores:id_proveedor(id_categoria)');
    if (!rows || !rows[0]) return;
    const c = rows[0];

    // Defensa adicional -- no confiar solo en que el boton este oculto.
    // Editar el monto de una CxP ya PAGADA/PARCIAL corrompe el registro:
    // resetea el saldo pero no el estado, y regenera el asiento contable
    // con un monto distinto al que realmente salio del banco.
    if (c.estado !== 'PENDIENTE' && c.estado !== 'RECHAZADA') {
      alert('No se puede editar: esta Obligación de Pago ya está en estado ' + c.estado + '. Si necesita corregirla, anule el pago primero (botón "🗑 Anular Pago Procesado").');
      return;
    }

    // Abrir modal-pago con datos cargados
    await abrirNuevoPago();

    // Cargar valores
    document.getElementById('pago-id').value          = c.id_cxp;
    document.getElementById('pago-descripcion').value = c.concepto || '';
    const obsEditEl = document.getElementById('pago-observaciones');
    if (obsEditEl) obsEditEl.value = c.observaciones || '';
    // Se precarga desde monto_facturado (el dato crudo, tal como se
    // escribió) y NO desde monto_usd/monto_ves (el Total ya resuelto con
    // IVA) -- si no, cada edición reinterpretaba el Total de la vez
    // anterior como si fuera el dato original, inflándolo en cascada.
    // Respaldo para CxP creadas antes de esta columna: usa el resuelto.
    document.getElementById('pago-monto').value       = (c.monto_facturado !== null && c.monto_facturado !== undefined)
      ? fmtBs(c.monto_facturado)
      : (c.moneda_pago === 'VES' ? fmtBs(c.monto_ves || 0) : fmtBs(c.monto_usd || 0));
    const modoEl = document.getElementById('pago-moneda');
    if (modoEl) modoEl.value = c.moneda_pago || '';
    // La asignación directa de arriba tampoco dispara el "onchange" -- por
    // eso el contenedor de Tasa BCV (pago-tasa-cont-nuevo) se quedaba oculto
    // en modo edición. Se muestra aquí explícitamente.
    onCambiarMonedaPago();
    if (c.exento_iva) document.getElementById('pago-exento-iva-si').checked = true;
    else document.getElementById('pago-exento-iva-no').checked = true;
    // Mostrar "Incluye IVA" también al editar, pre-marcada con el valor
    // original, para que se pueda VER y corregir si hubo un error al
    // crear -- antes se ocultaba y por eso un valor incorrecto pasaba
    // desapercibido.
    document.querySelectorAll('input[name="pago-incluye-iva"]').forEach(function(r){ r.checked = false; });
    if (!c.exento_iva) {
      if (c.incluye_iva) document.getElementById('pago-incluye-iva-si').checked = true;
      else document.getElementById('pago-incluye-iva-no').checked = true;
    }
    document.getElementById('pago-incluye-iva-val').value = c.exento_iva ? '' : (c.incluye_iva ? 'SI' : 'NO');

    // Modalidad de Pago: editable -- si se cambia (Contado<->Credito), se
    // detecta comparando contra el valor original guardado aquí, y
    // guardarPago() recrea toda la estructura de pago (ver mas abajo).
    const modalidadSel = document.getElementById('pago-modalidad');
    if (modalidadSel) {
      modalidadSel.value = c.esquema_pago || 'CONTADO';
      modalidadSel.dataset.original = c.esquema_pago || 'CONTADO';
      modalidadSel.disabled = false;
    }
    const vencCont = document.getElementById('pago-vencimiento-cont');
    if (vencCont) vencCont.style.display = '';
    document.getElementById('pago-vencimiento').value = c.fecha_vencimiento?.slice(0,10) || '';
    // La asignación directa de arriba NO dispara el "onchange" del campo, así
    // que la tasa BCV de la Fecha de Pago (histórica) nunca se buscaba -- se
    // quedaba con la tasa de HOY, cargada al abrir el modal. Se fuerza aquí.
    if (c.fecha_vencimiento) await onCambiarFechaPagoContado();
    // Mostrar la sección correspondiente (Contado o Crédito) según el
    // esquema actual -- editable ahora, ver nota arriba en modalidadSel
    onCambioModalidadPago();
    // Incluye IVA: visible y editable también al editar (ver justo arriba,
    // donde ya se pre-marca con el valor original guardado en incluye_iva)
    const incCont = document.getElementById('pago-incluye-iva-cont');
    if (incCont) incCont.style.display = c.exento_iva ? 'none' : '';
    // Confirmación de Usuario: ahora también se exige al editar
    const claveElEdit = document.getElementById('pago-clave');
    if (claveElEdit) claveElEdit.value = '';

    // Proveedor → Categoría se autocompleta sola (ficha del proveedor).
    // onSelProveedorPago() también propone una Moneda por defecto -- se
    // vuelve a imponer la Moneda REAL ya guardada en esta Obligación justo
    // después, para no perder lo que el Usuario haya elegido en su momento
    // (puede ser distinta a la Moneda de Facturación actual del Proveedor).
    if (c.id_proveedor) {
      const selProv = document.getElementById('pago-proveedor');
      if (selProv) selProv.value = c.id_proveedor;
      if (typeof onSelProveedorPago === 'function') await onSelProveedorPago();
      if (modoEl && c.moneda_pago) {
        modoEl.value = c.moneda_pago;
        await _actualizarAplicaIGTFPago('pago-moneda');
        await onCambiarMonedaPago();
      }
    }

    // Preseleccionar cuenta de gasto
    if (c.id_cuenta_gasto) {
      const selCta = document.getElementById('pago-cuenta-gasto');
      if (selCta) selCta.value = c.id_cuenta_gasto;
    }

    document.getElementById('pago-modal-titulo').textContent = 'EDITAR OBLIGACIÓN DE PAGO';
    const btnGuardarEdit = document.getElementById('btn-guardar-pago');
    if (btnGuardarEdit) {
      btnGuardarEdit.disabled = false;
      btnGuardarEdit.textContent = '💾 Guardar Cambios';
      btnGuardarEdit.dataset.textoOriginal = '💾 Guardar Cambios';
    }
    calcularTributosPago();

    // Agregar botón Anular al footer (Eliminar solo aplica a CxP PENDIENTE)
    if (c.estado === 'PENDIENTE') {
      const footerEdit = document.querySelector('#modal-pago .modal-footer');
      if (footerEdit) {
        footerEdit.innerHTML =
          '<button class="btn-peligro" onclick="anularPagoCxP('+id_cxp+');cerrarModal(\'modal-pago\')">🗑 Anular</button>'
          + '<button class="btn-secundario" onclick="cerrarModal(\'modal-pago\')">Retornar</button>'
          + '<button class="btn-primario" id="btn-guardar-pago" data-texto-original="💾 Guardar Cambios" onclick="this.disabled=true;this.textContent=\'⏳ Procesando...\';guardarPago()">💾 Guardar Cambios</button>';
      }
    }
    const modalBodyEdit = document.querySelector('#modal-pago .modal-body');
    if (modalBodyEdit) modalBodyEdit.scrollTop = 0;
  } catch(e) { alert('Error: ' + msgErr(e)); }
}


async function onCambiarMonedaPago() {
  const moneda = document.getElementById('pago-moneda')?.value || '';
  const cont = document.getElementById('pago-tasa-cont-nuevo');
  if (cont) cont.style.display = moneda ? '' : 'none';
  const lbl = document.getElementById('pago-label-moneda-calc');
  if (lbl) lbl.textContent = moneda === 'VES' ? 'Monto en USD' : 'Monto en VES';
  await _actualizarAplicaIGTFPago('pago-moneda');
  onCambiarMontoPago();
}

function onCambiarMontoPago() {
  const moneda = document.getElementById('pago-moneda')?.value || '';
  const montoRaw = (document.getElementById('pago-monto')?.value || '').replace(/\./g,'').replace(',','.');
  const monto = parseFloat(montoRaw) || 0;
  const tasaUSD = window._pagoTasaUSD || _tasaVigente || 1;
  const tasaEUR = window._pagoTasaEUR || tasaUSD;
  const tasaEl = document.getElementById('pago-tasa-bcv');
  const calcEl = document.getElementById('pago-monto-calc');
  const fechaEl = document.getElementById('pago-tasa-bcv-fecha');
  if (moneda === 'VES') {
    if (tasaEl) tasaEl.value = tasaUSD.toFixed(4);
    if (calcEl) calcEl.value = tasaUSD > 0 ? (monto / tasaUSD).toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2}) : '';
    if (fechaEl) fechaEl.textContent = window._pagoTasaFechaUSD ? fmtFecha(window._pagoTasaFechaUSD) : 'día';
  } else if (moneda === 'EUR') {
    if (tasaEl) tasaEl.value = tasaEUR.toFixed(4);
    if (calcEl) calcEl.value = (monto * tasaEUR).toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2});
    if (fechaEl) fechaEl.textContent = window._pagoTasaFechaEUR ? fmtFecha(window._pagoTasaFechaEUR) : 'día';
  } else {
    if (tasaEl) tasaEl.value = tasaUSD.toFixed(4);
    if (calcEl) calcEl.value = (monto * tasaUSD).toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2});
    if (fechaEl) fechaEl.textContent = window._pagoTasaFechaUSD ? fmtFecha(window._pagoTasaFechaUSD) : 'día';
  }
  calcularTributosPago();
  calcularCuotasPago();
}

function onCambioModalidadPago() {
  const modalidad = document.getElementById('pago-modalidad')?.value || '';
  const cont = document.getElementById('pago-credito-cont');
  if (cont) cont.style.display = modalidad === 'CREDITO' ? '' : 'none';
  const vencCont = document.getElementById('pago-vencimiento-cont');
  if (vencCont) vencCont.style.display = modalidad === 'CONTADO' ? '' : 'none';
  calcularCuotasPago();
}

// Al elegir la Fecha de Pago (Contado), buscar la tasa BCV de ESA fecha
// específica y recalcular el monto convertido y los tributos con ella
async function onCambiarFechaPagoContado() {
  const fecha = document.getElementById('pago-vencimiento')?.value || '';
  if (!fecha) return;
  try {
    const tasaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+fecha+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
    if (tasaRows && tasaRows[0]) {
      window._pagoTasaUSD = parseFloat(tasaRows[0].tipo_cambio);
      window._pagoTasaFechaUSD = tasaRows[0].fecha_valor;
    }
  } catch(e) { console.warn('Error buscando tasa BCV de la fecha:', e); }
  // IVA vigente EN ESA FECHA (no el más reciente global) -- mismo criterio
  // que la Tasa BCV justo arriba, para no mezclar alícuota de hoy con una
  // Fecha de Pago histórica.
  const tasaIVAFecha = await tributoVigenteEnFecha('IVA', fecha);
  window._pagoTasaIVAFecha = tasaIVAFecha; // null si no encontró ninguno <= fecha
  onCambiarMontoPago();
}

function onCambioExentoIVAPago() {
  const exento  = document.getElementById('pago-exento-iva-si')?.checked;
  const incCont = document.getElementById('pago-incluye-iva-cont');
  if (incCont) incCont.style.display = exento ? 'none' : '';
  if (exento) {
    document.getElementById('pago-incluye-iva-val').value = '';
    document.querySelectorAll('input[name="pago-incluye-iva"]').forEach(function(r){ r.checked = false; });
  }
  calcularTributosPago();
  const cme = document.getElementById('pago-cuotas-monto');
  if (cme) cme.value = '';
  calcularCuotasPago();
}

// Convierte el monto ingresado (en la moneda seleccionada) a USD, usando las
// tasas ya cargadas al abrir el modal
function _pagoMontoEnUSD() {
  const montoRaw = (document.getElementById('pago-monto')?.value || '').replace(/\./g,'').replace(',','.');
  const monto  = parseFloat(montoRaw) || 0;
  const moneda = document.getElementById('pago-moneda')?.value || 'USD';
  const tasaUSD = window._pagoTasaUSD || _tasaVigente || 1;
  const tasaEUR = window._pagoTasaEUR || tasaUSD;
  if (moneda === 'VES') return tasaUSD > 0 ? monto / tasaUSD : 0;
  if (moneda === 'EUR') return tasaUSD > 0 ? (monto * tasaEUR) / tasaUSD : 0;
  return monto;
}

function calcularTributosPago() {
  // Usa el IVA vigente EN LA FECHA DE PAGO ya buscado por
  // onCambiarFechaPagoContado(); si aún no se ha elegido fecha (o la
  // búsqueda no encontró nada), cae al global de hoy como antes.
  const tasaIVA = (window._pagoTasaIVAFecha != null) ? window._pagoTasaIVAFecha : tasaIVAActual();
  const pctIVA = Math.round(tasaIVA*100);
  const pctLbl = document.getElementById('pago-iva-pct-label');
  if (pctLbl) pctLbl.textContent = 'IVA (' + pctIVA + '%)';
  const pctSpan = document.getElementById('pago-trib-iva-pct');
  if (pctSpan) pctSpan.textContent = pctIVA;
  const montoRaw = (document.getElementById('pago-monto')?.value || '').replace(/\./g,'').replace(',','.');
  const montoNativo = parseFloat(montoRaw) || 0;
  const moneda = document.getElementById('pago-moneda')?.value || 'USD';
  const montoUSD = _pagoMontoEnUSD();
  const exento   = document.getElementById('pago-exento-iva-si')?.checked;
  const incluyeVal = document.getElementById('pago-incluye-iva-val')?.value;
  const prev = document.getElementById('pago-tributos-preview');
  if (!prev) return;
  if (!montoUSD || (!exento && !incluyeVal)) { prev.style.display = 'none'; return; }
  const incluye = incluyeVal === 'SI';
  let base, iva, total;
  if (exento) { base = montoUSD; iva = 0; total = montoUSD; }
  else if (incluye) { base = parseFloat((montoUSD/(1+tasaIVA)).toFixed(4)); iva = parseFloat((montoUSD-base).toFixed(4)); total = montoUSD; }
  else { base = montoUSD; iva = parseFloat((montoUSD*tasaIVA).toFixed(4)); total = parseFloat((base+iva).toFixed(4)); }
  prev.style.display = '';
  document.getElementById('pago-trib-base').textContent  = '$ ' + base.toFixed(2);
  document.getElementById('pago-trib-iva').textContent   = '$ ' + iva.toFixed(2);
  document.getElementById('pago-trib-total').textContent = '$ ' + total.toFixed(2);
  // Columna Bs: si se ingresó DIRECTO en VES, calcular el desglose sobre el
  // monto nativo tal cual (sin pasar por USD e ida y vuelta -- mismo
  // criterio que ya usa guardarPago() para el monto real). Si la moneda es
  // USD/EUR, se convierte Base y Total, y el IVA en Bs se deriva como resto
  // (Total-Base) para que los tres siempre cuadren exacto.
  let baseVes, ivaVes, totalVes;
  // Declarada aquí (no dentro del else) porque el bloque de IGTF más abajo
  // también la necesita, sin importar si moneda === 'VES' o no.
  const tasaBcvVigentePago = window._pagoTasaUSD || _tasaVigente || 1;
  if (moneda === 'VES') {
    if (exento) { baseVes = montoNativo; ivaVes = 0; totalVes = montoNativo; }
    else if (incluye) {
      baseVes = parseFloat((montoNativo/(1+tasaIVA)).toFixed(2));
      ivaVes  = parseFloat((montoNativo-baseVes).toFixed(2));
      totalVes = montoNativo;
    } else {
      baseVes = montoNativo;
      ivaVes  = parseFloat((montoNativo*tasaIVA).toFixed(2));
      totalVes = parseFloat((baseVes+ivaVes).toFixed(2));
    }
  } else {
    baseVes  = parseFloat((base*tasaBcvVigentePago).toFixed(2));
    totalVes = parseFloat((total*tasaBcvVigentePago).toFixed(2));
    ivaVes   = parseFloat((totalVes-baseVes).toFixed(2));
  }
  document.getElementById('pago-trib-base-ves').textContent  = 'Bs ' + baseVes.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('pago-trib-iva-ves').textContent   = 'Bs ' + ivaVes.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('pago-trib-total-ves').textContent = 'Bs ' + totalVes.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2,maximumFractionDigits:2});

  // IGTF -- mismo patrón visual que Nueva Entrada (actualizarIGTFEntrada):
  // el "Total Facturado" pasa a "Sub-Total Facturado", se agrega la línea de
  // IGTF, y aparece un "Total Facturado" nuevo al final que sí lo incluye.
  const lblTotalPago = document.getElementById('pago-trib-total-label');
  const igtfLabelRowPago = document.getElementById('pago-trib-igtf-label');
  const igtfRowPago = document.getElementById('pago-trib-igtf');
  const igtfRowVesPago = document.getElementById('pago-trib-igtf-ves');
  const totalFinalLabelPago = document.getElementById('pago-trib-total-final-label');
  const totalFinalPago = document.getElementById('pago-trib-total-final');
  const totalFinalVesPago = document.getElementById('pago-trib-total-final-ves');
  const igtfPctSpanPago = document.getElementById('pago-trib-igtf-pct');
  if (!window._aplicaIGTFPago) {
    if (lblTotalPago) lblTotalPago.textContent = 'Total Facturado';
    [igtfLabelRowPago, igtfRowPago, igtfRowVesPago, totalFinalLabelPago, totalFinalPago, totalFinalVesPago].forEach(function(el){ if (el) el.style.display = 'none'; });
    return;
  }
  const tasaIGTFPagoVal = window._tasaIGTFPago || 0.03;
  const igtfUSDPago = parseFloat((total * tasaIGTFPagoVal).toFixed(2));
  const igtfBsPago = tasaBcvVigentePago > 0 ? parseFloat((igtfUSDPago * tasaBcvVigentePago).toFixed(2)) : 0;
  if (lblTotalPago) lblTotalPago.textContent = 'Sub-Total Facturado';
  if (igtfPctSpanPago) igtfPctSpanPago.textContent = (tasaIGTFPagoVal*100).toFixed(0);
  const igtfEnMonedaPago = moneda === 'VES' ? igtfBsPago : igtfUSDPago;
  if (igtfLabelRowPago) igtfLabelRowPago.style.display = '';
  if (igtfRowPago) { igtfRowPago.style.display = ''; igtfRowPago.textContent = (moneda === 'VES' ? 'Bs.' : '$') + ' ' + fmtBs(igtfEnMonedaPago); }
  if (igtfRowVesPago) {
    igtfRowVesPago.style.display = '';
    igtfRowVesPago.textContent = tasaBcvVigentePago > 0 && moneda !== 'VES' ? 'Bs. ' + fmtBs(igtfBsPago)
      : (moneda === 'VES' && tasaBcvVigentePago > 0 ? '$ ' + fmtBs(igtfUSDPago) : '—');
  }
  const totalConIGTFNativo = totalVes && moneda === 'VES' ? totalVes + igtfBsPago : total + igtfUSDPago;
  if (totalFinalLabelPago) totalFinalLabelPago.style.display = '';
  if (totalFinalPago) { totalFinalPago.style.display = ''; totalFinalPago.textContent = (moneda === 'VES' ? 'Bs.' : '$') + ' ' + fmtBs(totalConIGTFNativo); }
  if (totalFinalVesPago) {
    totalFinalVesPago.style.display = '';
    if (tasaBcvVigentePago > 0 && moneda !== 'VES') totalFinalVesPago.textContent = 'Bs. ' + fmtBs((total + igtfUSDPago) * tasaBcvVigentePago);
    else if (moneda === 'VES' && tasaBcvVigentePago > 0) totalFinalVesPago.textContent = '$ ' + fmtBs((totalVes + igtfBsPago) / tasaBcvVigentePago);
    else totalFinalVesPago.textContent = '—';
  }
}

function calcularCuotasPago() {
  const numCuotas   = parseInt(document.getElementById('pago-cuotas-num')?.value) || 0;
  const fechaInicio = document.getElementById('pago-cuotas-fecha-inicio')?.value || '';
  const intervalo   = parseInt(document.getElementById('pago-cuotas-intervalo')?.value) || 30;
  const montoCuotaInput = parseFloat(document.getElementById('pago-cuotas-monto')?.value) || 0;
  const montoUSD = _pagoMontoEnUSD();
  const exento   = document.getElementById('pago-exento-iva-si')?.checked;
  const incluye  = document.getElementById('pago-incluye-iva-val') === null ? false : document.getElementById('pago-incluye-iva-val').value === 'SI';
  let totalUSD = parseFloat((exento || incluye ? montoUSD : montoUSD * (1+tasaIVAActual())).toFixed(2));
  if (!totalUSD && montoCuotaInput && numCuotas) totalUSD = parseFloat((montoCuotaInput * numCuotas).toFixed(2));
  const preview = document.getElementById('pago-cuotas-preview');
  if (!preview) return;
  if (!numCuotas || !fechaInicio || !totalUSD) { preview.innerHTML = ''; preview.dataset.cuotas = ''; return; }
  const montoCuota = montoCuotaInput || parseFloat((totalUSD / numCuotas).toFixed(2));
  const cuotas = [];
  let fecha = new Date(fechaInicio + 'T00:00:00');
  let acumulado = 0;
  for (let i = 1; i <= numCuotas; i++) {
    const esUltima = i === numCuotas;
    const monto = esUltima ? parseFloat((totalUSD - acumulado).toFixed(2)) : montoCuota;
    acumulado = parseFloat((acumulado + monto).toFixed(2));
    cuotas.push({ num: i, fecha: fecha.toISOString().split('T')[0], monto: monto });
    fecha = new Date(fecha.getTime() + intervalo * 24 * 60 * 60 * 1000);
  }
  const sumaCuotas = cuotas.reduce(function(s,c){ return s + c.monto; }, 0);
  const cuadra = Math.abs(sumaCuotas - totalUSD) < 0.01;
  preview.dataset.cuotas = JSON.stringify(cuotas);
  preview.innerHTML = '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">Vista previa — Total: $ '+totalUSD.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2})+(cuadra?' ✓':' ⚠ revise el monto por cuota')+'</div>'
    + '<table style="width:100%;font-size:12px"><thead><tr>'
    + '<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Cuota</th>'
    + '<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Fecha Vencimiento</th>'
    + '<th style="padding:6px 8px;text-align:right;color:var(--suave);font-size:10px">Monto USD</th>'
    + '</tr></thead><tbody>'
    + cuotas.map(function(c){ return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
        +'<td style="padding:6px 8px;font-weight:600">Cuota '+c.num+'</td>'
        +'<td style="padding:6px 8px;font-family:var(--font-mono)">'+c.fecha+'</td>'
        +'<td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);color:var(--naranja)">$ '+c.monto.toFixed(2)+'</td>'
        +'</tr>'; }).join('')
    + '</tbody></table>';
}

async function guardarPago() {
  const id_cxp_edit = document.getElementById('pago-id')?.value || '';
  if (!puedo('PAGOS','CREAR') && !id_cxp_edit) { alert('No tiene permiso para registrar obligaciones de pago.'); return; }
  if (id_cxp_edit && !puedo('PAGOS','EDITAR') && !sesionActual?.administrador) { alert('No tiene permiso para editar obligaciones de pago.'); return; }
  // Defensa adicional -- reconfirmar el estado actual en BD (no confiar en
  // que editarCxPManual ya lo validó; esta función podría llamarse desde
  // otro punto en el futuro). Editar el monto de una CxP ya no-PENDIENTE
  // corrompe el registro (ver nota en editarCxPManual).
  if (id_cxp_edit) {
    try {
      const chkRows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp_edit+'&select=estado');
      if (chkRows && chkRows[0] && chkRows[0].estado !== 'PENDIENTE' && chkRows[0].estado !== 'RECHAZADA') {
        alert('No se puede guardar: esta Obligación de Pago ya está en estado ' + chkRows[0].estado + '. Anule el pago primero (botón "🗑 Anular Pago Procesado").');
        return;
      }
    } catch(eChk) {}
  }
  const errEl = document.getElementById('alerta-pago-err');
  const okEl  = document.getElementById('alerta-pago-ok');
  if (errEl) errEl.style.display = 'none';
  if (okEl)  okEl.style.display  = 'none';

  const btnGuardarPagoEl = document.getElementById('btn-guardar-pago');
  const mostrarErr = function(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else alert(msg);
    if (btnGuardarPagoEl) { btnGuardarPagoEl.disabled = false; btnGuardarPagoEl.textContent = btnGuardarPagoEl.dataset.textoOriginal || btnGuardarPagoEl.textContent; }
  };

  // Leer campos
  const id_categoria   = document.getElementById('pago-categoria-prov')?.value || '';
  const moneda         = document.getElementById('pago-moneda')?.value || '';
  const descripcion    = document.getElementById('pago-descripcion')?.value.trim() || '';
  const id_cuentaGasto = parseInt(document.getElementById('pago-cuenta-gasto')?.value) || null;
  const montoRaw       = (document.getElementById('pago-monto')?.value || '').replace(/\./g,'').replace(',','.');
  const monto          = parseFloat(montoRaw) || 0;
  const vencimiento    = document.getElementById('pago-vencimiento')?.value || '';
  const id_proveedor   = parseInt(document.getElementById('pago-proveedor')?.value) || null;
  const observaciones  = document.getElementById('pago-observaciones')?.value.trim() || '';
  const modalidad      = document.getElementById('pago-modalidad')?.value || '';
  // Mismo texto para todas las líneas del asiento contable (Gasto/IVA/CxP):
  // Proveedor + Categoría + Concepto, sin prefijos ni guiones.
  const nombreProvLinea = document.getElementById('pago-proveedor')?.selectedOptions?.[0]?.text || '';
  const nombreCatLinea  = document.getElementById('pago-categoria-prov')?.selectedOptions?.[0]?.text || '';
  const textoLineaAsiento = [nombreProvLinea, nombreCatLinea, descripcion].filter(Boolean).join(' ');
  const modalidadOriginal = document.getElementById('pago-modalidad')?.dataset.original || '';
  // true solo si se está editando Y la modalidad realmente cambió respecto
  // a la guardada -- dispara la recreación completa de la estructura de
  // pago (ver mas abajo). Si no cambió, el PATCH simple de siempre alcanza.
  const modalidadCambio = !!(id_cxp_edit && modalidadOriginal && modalidad !== modalidadOriginal);
  const exento         = document.getElementById('pago-exento-iva-si')?.checked || false;
  const incluyeIVAVal  = document.getElementById('pago-incluye-iva-val')?.value || '';
  const clave          = document.getElementById('pago-clave')?.value || '';

  // Validaciones en orden de los campos (Proveedor primero -- Categoría y
  // Moneda se autocompletan de su ficha, no se piden si falta el proveedor)
  if (!id_proveedor)   { mostrarErr('Debe seleccionar un Proveedor.');           document.getElementById('pago-proveedor')?.focus(); return; }
  if (!id_categoria)   { mostrarErr('El Proveedor seleccionado no tiene Categoría configurada en su ficha.'); return; }
  if (!moneda)         { mostrarErr('Debe seleccionar la Moneda de Pago.'); document.getElementById('pago-moneda')?.focus(); return; }
  if (!id_cuentaGasto) { mostrarErr('Debe seleccionar la Cuenta de Gasto.');    document.getElementById('pago-cuenta-gasto')?.focus(); return; }
  if (!descripcion)    { mostrarErr('El Concepto es obligatorio.');           document.getElementById('pago-descripcion')?.focus(); return; }
  if (!monto)          { mostrarErr('El Monto es obligatorio.');                 document.getElementById('pago-monto')?.focus(); return; }
  const exentoIVASel = document.querySelector('input[name="pago-exento-iva"]:checked');
  if (!exentoIVASel)   { mostrarErr('Debe indicar si el Gasto está Exento de IVA.'); return; }
  // Se valida siempre (crear Y editar) -- la pregunta es visible/editable en
  // ambos modos, así que el operador siempre debe decidirla explícitamente,
  // nunca quedarse con un default silencioso.
  if (!exento && !incluyeIVAVal) { mostrarErr('Debe indicar si el Monto Facturado incluye IVA.'); return; }

  if (!id_cxp_edit || modalidadCambio) {
    if (!modalidad) { mostrarErr('Debe seleccionar la Modalidad de Pago.'); document.getElementById('pago-modalidad')?.focus(); return; }
    if (modalidad === 'CONTADO' && !vencimiento) { mostrarErr('La Fecha de Pago es obligatoria.'); document.getElementById('pago-vencimiento')?.focus(); return; }
    if (modalidad === 'CREDITO') {
      const numCuotas = parseInt(document.getElementById('pago-cuotas-num')?.value) || 0;
      const fechaIni  = document.getElementById('pago-cuotas-fecha-inicio')?.value || '';
      if (!numCuotas) { mostrarErr('Debe indicar el N° de Cuotas.'); document.getElementById('pago-cuotas-num')?.focus(); return; }
      if (!fechaIni)  { mostrarErr('Debe indicar la Fecha de la Primera Cuota.'); document.getElementById('pago-cuotas-fecha-inicio')?.focus(); return; }
    }
    if (!clave) { mostrarErr('Ingrese su contraseña de acceso al Sistema.'); document.getElementById('pago-clave')?.focus(); return; }
  }

  // Buscar tasa BCV — de la Fecha de Pago si es Contado (esa es la fecha que
  // importa para valorar la obligación), o de hoy en cualquier otro caso
  const fechaParaTasa = (modalidad === 'CONTADO' && vencimiento) ? vencimiento : getHoyVzla();
  let tasaUSD = _tasaVigente || 1;
  try {
    const tasaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaParaTasa+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    if (tasaRows && tasaRows[0]) tasaUSD = parseFloat(tasaRows[0].tipo_cambio);
  } catch(e) {}
  const tasaEUR = window._pagoTasaEUR || tasaUSD;
  let montoIngresadoUSD = monto;
  if (moneda === 'VES') montoIngresadoUSD = parseFloat((monto / tasaUSD).toFixed(4));
  else if (moneda === 'EUR') montoIngresadoUSD = parseFloat((monto * tasaEUR / tasaUSD).toFixed(4));

  // IVA vigente EN LA MISMA fechaParaTasa usada arriba para la BCV -- no el
  // global de "hoy". Se recalcula aquí (no se confía en window._pagoTasaIVAFecha)
  // para que el monto guardado sea correcto incluso si por algún motivo no se
  // disparó el evento de cambio de fecha en el formulario.
  const tasaIVAFinal = (await tributoVigenteEnFecha('IVA', fechaParaTasa)) ?? tasaIVAActual();

  // Monto TOTAL con IVA (si aplica) — se calcula UNA sola vez, en USD
  const montoTotalConIVA = exento || incluyeIVAVal === 'SI'
    ? parseFloat(montoIngresadoUSD.toFixed(2))
    : parseFloat((montoIngresadoUSD * (1+tasaIVAFinal)).toFixed(2));
  // Si se ingresó directamente en VES, usar ese monto TAL CUAL (sin volver
  // a convertir desde el USD redondeado) para no perder precisión
  const montoTotalVES = moneda === 'VES'
    ? (exento || incluyeIVAVal === 'SI' ? parseFloat(monto.toFixed(2)) : parseFloat((monto * (1+tasaIVAFinal)).toFixed(2)))
    : parseFloat((montoTotalConIVA * tasaUSD).toFixed(2));

  // IGTF -- ya detectado automáticamente al seleccionar el Proveedor
  // (onSelProveedorPago, mismo criterio que Nueva Entrada). Se congela aquí
  // una sola vez, en USD, sobre el monto Base+IVA ya resuelto. Igual que en
  // Entradas: NO afecta el Gasto ni el IVA, pero SÍ queda horneado en
  // monto_usd/saldo_usd de la CxP -- es lo que realmente se le debe pagar
  // al Proveedor.
  const aplicaIGTFFinal = !!window._aplicaIGTFPago;
  const tasaIGTFFinal = window._tasaIGTFPago || 0.03;
  const montoIGTFFinal = aplicaIGTFFinal ? parseFloat((montoTotalConIVA * tasaIGTFFinal).toFixed(2)) : 0;
  const montoIGTFVESFinal = montoIGTFFinal > 0 ? parseFloat((montoIGTFFinal * tasaUSD).toFixed(2)) : 0;
  const montoTotalConIGTF = parseFloat((montoTotalConIVA + montoIGTFFinal).toFixed(2));
  const montoTotalVESConIGTF = parseFloat((montoTotalVES + montoIGTFVESFinal).toFixed(2));

  const id_emisor = _empresaActiva?.id_empresa || 0;
  const hoy = new Date().toISOString().split('T')[0];

  try {
    const btnGuardar = document.getElementById('btn-guardar-pago');
    if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = '⏳ Procesando...'; }

    // Si es edición → validar contraseña y PATCH (regenera cuotas solo si
    // la Modalidad de Pago cambió; ver modalidadCambio más abajo)
    if (id_cxp_edit) {
      if (!clave) { mostrarErr('Ingrese su contraseña de acceso al Sistema.'); document.getElementById('pago-clave')?.focus(); if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = btnGuardar.dataset.textoOriginal || btnGuardar.textContent; } return; }
      const verifEdit = await verificarContrasena(sesionActual.correo_usuario, clave);
      if (!verifEdit.ok) { mostrarErr(verifEdit.msg || 'Contraseña incorrecta.'); if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar'; } return; }

      // Obtener el numero_doc actual para localizar el asiento asociado.
      // El asiento se creó con la referencia SIN ningún sufijo (ni el
      // "-<id_cxp>" que se agrega después, ni el "-C<n>" de las cuotas de
      // crédito) -- hay que quitar AMBOS antes de buscar, si no nunca
      // coincide con el asiento real (referenciado siempre por la base).
      const cxpActualRows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp_edit+'&select=numero_doc');
      const numDocConSufijo = cxpActualRows && cxpActualRows[0] ? cxpActualRows[0].numero_doc : null;
      const numDocActual = numDocConSufijo
        ? numDocConSufijo.replace(new RegExp('(-C\\d+)?-'+id_cxp_edit+'$'), '')
        : null;

      // ── Conversión de Modalidad de Pago (Contado<->Crédito): recrear
      // toda la estructura de pago desde cero, en vez del PATCH simple ──
      if (modalidadCambio) {
        if (!numDocActual) throw new Error('No se pudo determinar el documento base para la conversión.');

        // 1. Todas las filas hermanas de esta obligación (todas las cuotas
        // si era CREDITO, o la única fila si era CONTADO)
        const hermanas = await api('cont_cxp','GET',null,
          '?numero_doc=ilike.'+encodeURIComponent(numDocActual+'*')+emisorQ()+'&select=id_cxp,numero_doc,estado');
        const noPendiente = (hermanas||[]).find(function(h){ return h.estado !== 'PENDIENTE'; });
        if (noPendiente) {
          mostrarErr('No se puede cambiar la Modalidad de Pago: "'+noPendiente.numero_doc+'" ya está en estado '+noPendiente.estado+'. Toda la obligación debe estar PENDIENTE para reestructurarla.');
          if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar'; }
          return;
        }

        // 2. Borrar todas las filas hermanas (todas están PENDIENTE, validado arriba)
        for (const h of (hermanas||[])) {
          await api('cont_cxp','DELETE',null,'?id_cxp=eq.'+h.id_cxp);
        }

        // 3. Borrar el asiento GASTO_MANUAL original y generar uno nuevo
        try {
          const asientosViejosConv = await api('cont_asientos','GET',null,
            '?referencia=eq.'+encodeURIComponent(numDocActual)+'&tipo=eq.GASTO_MANUAL&estado=neq.ANULADO&select=id_asiento');
          for (const a of (asientosViejosConv||[])) {
            await api('cont_asiento_lineas','DELETE',null,'?id_asiento=eq.'+a.id_asiento);
            await api('cont_asientos','DELETE',null,'?id_asiento=eq.'+a.id_asiento);
          }
        } catch(eDelAstConv) { console.warn('Error borrando asiento anterior:', eDelAstConv); }

        const descAsientoConv = descripcion + (observaciones ? ' — ' + observaciones : '');
        await generarAsientoGastoManual({
          descripcion:    descAsientoConv,
          concepto:       textoLineaAsiento,
          montoUSD:       montoTotalConIVA,
          montoBsExacto:  montoTotalVES,
          referencia:     numDocActual,
          id_cuentaGasto: id_cuentaGasto,
          fecha:          fechaParaTasa,
          tasa:           tasaUSD,
          tasaIVA:        tasaIVAFinal,
          incluyeIVA:     true,
          exentoIVA:      exento,
          montoIGTF_USD:  montoIGTFFinal,
          montoIGTF_BS:   montoIGTFVESFinal,
          tasaIGTF:       tasaIGTFFinal
        });

        // 4. Crear la nueva estructura -- misma lógica que al crear desde cero
        const id_emisorConv = _empresaActiva?.id_empresa || 0;
        const hoyConv = new Date().toISOString().split('T')[0];
        const referenciaConv = document.getElementById('pago-referencia')?.value.trim() || '';

        if (modalidad === 'CREDITO') {
          const previewConv = document.getElementById('pago-cuotas-preview');
          const cuotasConv = previewConv?.dataset.cuotas ? JSON.parse(previewConv.dataset.cuotas) : [];
          if (!cuotasConv.length) throw new Error('No se calcularon las cuotas. Complete los campos de crédito.');
          // Mismo prorrateo proporcional del IGTF que en la creación nueva
          const totalUsdCuotasConv = montoTotalConIGTF;
          const totalVesCuotasConv = montoTotalVESConIGTF;
          let acumUsdCuotasConv = 0;
          let acumVesCuotasConv = 0;
          for (let i = 0; i < cuotasConv.length; i++) {
            const cc = cuotasConv[i];
            const esUltimaConv = i === cuotasConv.length - 1;
            const igtfCuotaConv = montoIGTFFinal > 0 && montoTotalConIVA > 0
              ? parseFloat((montoIGTFFinal * (cc.monto / montoTotalConIVA)).toFixed(2))
              : 0;
            const montoUsdCuotaConv = esUltimaConv
              ? parseFloat((totalUsdCuotasConv - acumUsdCuotasConv).toFixed(2))
              : parseFloat((cc.monto + igtfCuotaConv).toFixed(2));
            acumUsdCuotasConv = parseFloat((acumUsdCuotasConv + montoUsdCuotaConv).toFixed(2));
            const montoVesCuotaConv = esUltimaConv
              ? parseFloat((totalVesCuotasConv - acumVesCuotasConv).toFixed(2))
              : parseFloat((montoUsdCuotaConv * tasaUSD).toFixed(2));
            acumVesCuotasConv = parseFloat((acumVesCuotasConv + montoVesCuotaConv).toFixed(2));
            const cxpCuotaConv = await api('cont_cxp','POST',{
              id_empresa: id_emisorConv, id_proveedor: id_proveedor, tipo: 'PAGO_MANUAL_CREDITO',
              numero_doc: numDocActual + '-C' + cc.num, fecha_emision: hoyConv, fecha_vencimiento: cc.fecha,
              moneda_pago: moneda, monto_usd: montoUsdCuotaConv, monto_ves: montoVesCuotaConv,
              tasa_bcv: tasaUSD, tasa_bcv_compra: tasaUSD, pagado_usd: 0, saldo_usd: montoUsdCuotaConv,
              estado: 'PENDIENTE', referencia: referenciaConv || null, id_cuenta_gasto: id_cuentaGasto,
              concepto: descripcion, observaciones: observaciones || null, exento_iva: exento, incluye_iva: exento ? null : (incluyeIVAVal === 'SI'),
              esquema_pago: 'CREDITO',
              tasa_iva: exento ? null : tasaIVAFinal,
              id_usuario: sesionActual?.correo_usuario || null
            });
            if (cxpCuotaConv && cxpCuotaConv[0]) {
              await api('cont_cxp','PATCH',{ numero_doc: numDocActual + '-C' + cc.num + '-' + cxpCuotaConv[0].id_cxp }, '?id_cxp=eq.' + cxpCuotaConv[0].id_cxp);
              if (cc.fecha <= getHoyVzla()) {
                enrutarAprobacionCxP(cxpCuotaConv[0].id_cxp, numDocActual + '-C' + cc.num + '-' + cxpCuotaConv[0].id_cxp, cc.monto, {
                  monedaPago: moneda, tasaBcv: tasaUSD,
                  concepto: descripcion, proveedor: nombreProvLinea
                });
              } else {
                api('cont_cxp','PATCH',{ sin_firma_notificado: true }, '?id_cxp=eq.'+cxpCuotaConv[0].id_cxp).catch(function(){});
              }
            }
          }
        } else {
          const cxpContadoConv = await api('cont_cxp','POST',{
            id_empresa: id_emisorConv, id_proveedor: id_proveedor, tipo: 'PAGO_MANUAL',
            numero_doc: numDocActual, fecha_emision: hoyConv, fecha_vencimiento: vencimiento,
            moneda_pago: moneda, monto_usd: montoTotalConIGTF, monto_ves: montoTotalVESConIGTF, monto_facturado: monto,
            tasa_bcv: tasaUSD, pagado_usd: 0, saldo_usd: montoTotalConIGTF, estado: 'PENDIENTE',
            referencia: referenciaConv || null, id_cuenta_gasto: id_cuentaGasto, concepto: descripcion, observaciones: observaciones || null,
            exento_iva: exento, incluye_iva: exento ? null : (incluyeIVAVal === 'SI'),
            esquema_pago: 'CONTADO',
            tasa_iva: exento ? null : tasaIVAFinal,
            id_usuario: sesionActual?.correo_usuario || null
          });
          if (cxpContadoConv && cxpContadoConv[0]) {
            await api('cont_cxp','PATCH',{ numero_doc: numDocActual + '-' + cxpContadoConv[0].id_cxp }, '?id_cxp=eq.' + cxpContadoConv[0].id_cxp);
            enrutarAprobacionCxP(cxpContadoConv[0].id_cxp, numDocActual + '-' + cxpContadoConv[0].id_cxp, montoTotalConIVA, {
              monedaPago: moneda, tasaBcv: tasaUSD, montoBsExacto: montoTotalVES,
              concepto: descripcion, proveedor: nombreProvLinea
            });
          }
        }

        if (okEl) { okEl.textContent = '✓ Obligación actualizada y Modalidad de Pago cambiada correctamente.'; okEl.style.display = 'block'; }
        setTimeout(function() { cerrarModal('modal-pago'); cargarPagos(); }, 1000);
        return;
      }

      await api('cont_cxp','PATCH',{
        id_proveedor:      id_proveedor,
        fecha_vencimiento: vencimiento,
        monto_usd:         montoTotalConIGTF,
        monto_ves:         montoTotalVESConIGTF,
        saldo_usd:         montoTotalConIGTF,
        tasa_iva:          exento ? null : tasaIVAFinal,
        incluye_iva:       exento ? null : (incluyeIVAVal === 'SI'),
        // Monto tal como se escribió, SIN resolver -- separado del total ya
        // calculado (monto_usd/monto_ves). Así, al reabrir para editar, el
        // campo Monto siempre vuelve a mostrar el dato original de la
        // factura, no el Total ya inflado/recalculado de la vez anterior.
        monto_facturado:   monto,
        id_cuenta_gasto:   id_cuentaGasto,
        concepto:          descripcion,
        observaciones:     observaciones || null,
        exento_iva:        exento,
        // Si venía de RECHAZADA, esta corrección la reingresa a PENDIENTE
        // para una nueva revisión (limpiando el motivo anterior).
        estado:            'PENDIENTE',
        motivo_rechazo:    null,
        modificado_por:    sesionActual?.correo_usuario || null,
      }, '?id_cxp=eq.'+id_cxp_edit);

      // Borrar el asiento viejo (Gasto+IVA/CxP) y generar uno nuevo con los
      // valores ya actualizados, en vez de dejarlo desactualizado
      if (numDocActual) {
        try {
          const asientosViejos = await api('cont_asientos','GET',null,
            '?referencia=eq.'+encodeURIComponent(numDocActual)+'&tipo=eq.GASTO_MANUAL&estado=neq.ANULADO&select=id_asiento');
          for (const a of (asientosViejos||[])) {
            await api('cont_asiento_lineas','DELETE',null,'?id_asiento=eq.'+a.id_asiento);
            await api('cont_asientos','DELETE',null,'?id_asiento=eq.'+a.id_asiento);
          }
        } catch(eDelAst) { console.warn('Error borrando asiento anterior:', eDelAst); }

        await generarAsientoGastoManual({
          descripcion:    descripcion + (observaciones ? ' — ' + observaciones : ''),
          concepto:       textoLineaAsiento,
          montoUSD:       montoTotalConIVA,
          montoBsExacto:  montoTotalVES,
          referencia:     numDocActual,
          id_cuentaGasto: id_cuentaGasto,
          fecha:          fechaParaTasa,
          tasa:           tasaUSD,
          // La misma alícuota vigente en fechaParaTasa que ya se usó para
          // resolver montoTotalConIVA/montoTotalVES arriba -- si no, el
          // asiento partiría el Total con el IVA de HOY y no cuadraría con
          // la obligación real cuando la Fecha de Pago es histórica.
          tasaIVA:        tasaIVAFinal,
          // montoUSD/montoBsExacto ya son el TOTAL resuelto (con IVA sumado si
          // aplicaba) -- decirle a generarAsientoGastoManual que lo desglose
          // (true), sin importar la seleccion original del usuario
          incluyeIVA:     true,
          exentoIVA:      exento,
          montoIGTF_USD:  montoIGTFFinal,
          montoIGTF_BS:   montoIGTFVESFinal,
          tasaIGTF:       tasaIGTFFinal
        });
      }

      if (okEl) { okEl.textContent = '✓ Obligación actualizada correctamente.'; okEl.style.display = 'block'; }
      setTimeout(function() { cerrarModal('modal-pago'); cargarPagos(); }, 1000);
      return;
    }

    // Confirmar contraseña
    const verif = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verif.ok) { mostrarErr(verif.msg || 'Contraseña incorrecta.'); if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar'; } return; }

    // Subir comprobante si se adjuntó
    let urlComp = null;
    const archivoNuevo = document.getElementById('pago-archivo');
    if (archivoNuevo && archivoNuevo.files && archivoNuevo.files[0]) {
      try { urlComp = await subirFoto(archivoNuevo.files[0], 'comprobantes/manual'); } catch(e) {}
    }
    const referenciaNueva = document.getElementById('pago-referencia')?.value.trim() || '';
    const numDocBase = 'MAN-' + Date.now();
    const descAsiento = descripcion + (observaciones ? ' — ' + observaciones : '');

    // ── Asiento contable: Gasto (+IVA) / CxP ──
    await generarAsientoGastoManual({
      descripcion: descAsiento,
      concepto:    textoLineaAsiento,
      montoUSD:    montoTotalConIVA,
      montoBsExacto: montoTotalVES,
      referencia:  numDocBase,
      id_cuentaGasto: id_cuentaGasto,
      fecha:       fechaParaTasa,
      tasa:        tasaUSD,
      // idem edición: la misma alícuota vigente en fechaParaTasa, no la de hoy
      tasaIVA:     tasaIVAFinal,
      // idem: el monto ya es el total resuelto, siempre desglozar
      incluyeIVA:  true,
      exentoIVA:   exento,
      montoIGTF_USD: montoIGTFFinal,
      montoIGTF_BS:  montoIGTFVESFinal,
      tasaIGTF:      tasaIGTFFinal
    });

    if (modalidad === 'CREDITO') {
      const preview = document.getElementById('pago-cuotas-preview');
      const cuotas  = preview?.dataset.cuotas ? JSON.parse(preview.dataset.cuotas) : [];
      if (!cuotas.length) throw new Error('No se calcularon las cuotas. Complete los campos de crédito.');
      // Prorrateo proporcional del IGTF entre cuotas, según el peso de cada
      // una sobre el total Base+IVA -- mismo criterio ya usado en el
      // prorrateo de Devolución de Factura, y el mismo que se corrigió en
      // Entradas (antes el IGTF completo caía de golpe en la última cuota,
      // y solo en Bs, nunca en USD).
      const totalUsdCuotas = montoTotalConIGTF;
      const totalVesCuotas = montoTotalVESConIGTF;
      let acumUsdCuotas = 0;
      let acumVesCuotas = 0;
      for (let i = 0; i < cuotas.length; i++) {
        const c = cuotas[i];
        const esUltimaCuota = i === cuotas.length - 1;
        const igtfCuota = montoIGTFFinal > 0 && montoTotalConIVA > 0
          ? parseFloat((montoIGTFFinal * (c.monto / montoTotalConIVA)).toFixed(2))
          : 0;
        const montoUsdCuota = esUltimaCuota
          ? parseFloat((totalUsdCuotas - acumUsdCuotas).toFixed(2))
          : parseFloat((c.monto + igtfCuota).toFixed(2));
        acumUsdCuotas = parseFloat((acumUsdCuotas + montoUsdCuota).toFixed(2));
        const montoVesCuota = esUltimaCuota
          ? parseFloat((totalVesCuotas - acumVesCuotas).toFixed(2))
          : parseFloat((montoUsdCuota * tasaUSD).toFixed(2));
        acumVesCuotas = parseFloat((acumVesCuotas + montoVesCuota).toFixed(2));
        const cxpCuota = await api('cont_cxp','POST',{
          id_empresa:        id_emisor,
          id_proveedor:      id_proveedor,
          tipo:              'PAGO_MANUAL_CREDITO',
          numero_doc:        numDocBase + '-C' + c.num,
          fecha_emision:     hoy,
          fecha_vencimiento: c.fecha,
          moneda_pago:       moneda,
          monto_usd:         montoUsdCuota,
          monto_ves:         montoVesCuota,
          tasa_bcv:          tasaUSD,
          tasa_bcv_compra:   tasaUSD,
          pagado_usd:        0,
          saldo_usd:         montoUsdCuota,
          estado:            'PENDIENTE',
          referencia:        referenciaNueva || null,
          url_comprobante:   urlComp || null,
          id_cuenta_gasto:   id_cuentaGasto,
          concepto:          descripcion,
          observaciones:     observaciones || null,
          exento_iva:        exento,
          incluye_iva:       exento ? null : (incluyeIVAVal === 'SI'),
          esquema_pago:      'CREDITO',
          tasa_iva:          exento ? null : tasaIVAFinal,
          id_usuario:        sesionActual?.correo_usuario || null
        });
        if (cxpCuota && cxpCuota[0]) {
          await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-C' + c.num + '-' + cxpCuota[0].id_cxp }, '?id_cxp=eq.' + cxpCuota[0].id_cxp);
          if (c.fecha <= getHoyVzla()) {
            enrutarAprobacionCxP(cxpCuota[0].id_cxp, numDocBase + '-C' + c.num + '-' + cxpCuota[0].id_cxp, c.monto, {
              monedaPago: moneda, tasaBcv: tasaUSD,
              concepto: descripcion, proveedor: nombreProvLinea
            });
          } else {
            // Cuota con vencimiento futuro -- no notificar todavía; se
            // enrutará solo cuando llegue su fecha (reintentar_enrutamiento_pendientes al iniciar sesión)
            api('cont_cxp','PATCH',{ sin_firma_notificado: true }, '?id_cxp=eq.'+cxpCuota[0].id_cxp).catch(function(){});
          }
        }
      }
    } else {
      const cxpContado = await api('cont_cxp','POST',{
        id_empresa:        id_emisor,
        id_proveedor:      id_proveedor,
        tipo:              'PAGO_MANUAL',
        numero_doc:        numDocBase,
        fecha_emision:     hoy,
        fecha_vencimiento: vencimiento,
        moneda_pago:       moneda,
        monto_usd:         montoTotalConIGTF,
        monto_ves:         montoTotalVESConIGTF,
        monto_facturado:   monto,
        tasa_bcv:          tasaUSD,
        pagado_usd:        0,
        saldo_usd:         montoTotalConIGTF,
        estado:            'PENDIENTE',
        referencia:        referenciaNueva || null,
        url_comprobante:   urlComp || null,
        id_cuenta_gasto:   id_cuentaGasto,
        concepto:          descripcion,
        observaciones:     observaciones || null,
        exento_iva:        exento,
        incluye_iva:       exento ? null : (incluyeIVAVal === 'SI'),
        esquema_pago:      'CONTADO',
        tasa_iva:          exento ? null : tasaIVAFinal,
        id_usuario:        sesionActual?.correo_usuario || null
      });
      if (cxpContado && cxpContado[0]) {
        await api('cont_cxp','PATCH',{ numero_doc: numDocBase + '-' + cxpContado[0].id_cxp }, '?id_cxp=eq.' + cxpContado[0].id_cxp);
        enrutarAprobacionCxP(cxpContado[0].id_cxp, numDocBase + '-' + cxpContado[0].id_cxp, montoTotalConIVA, {
          monedaPago: moneda, tasaBcv: tasaUSD, montoBsExacto: montoTotalVES,
          concepto: descripcion, proveedor: nombreProvLinea
        });
      }
    }

    if (okEl) { okEl.textContent = '✓ CxP registrada correctamente.'; okEl.style.display = 'block'; }
    setTimeout(function() {
      cerrarModal('modal-pago');
      cargarPagos();
    }, 1000);
  } catch(e) {
    mostrarErr('Error: ' + msgErr(e));
    const btnGuardar = document.getElementById('btn-guardar-pago');
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = btnGuardar.dataset.textoOriginal || btnGuardar.textContent; }
  }
}

// ── Función centralizada para abrir detalle/pago de CxP ──
async function verDetalleCxP(id_cxp, modoInicial) {
  if (!sesionActual?.administrador && !puedo('PAGOS','VER')) {
    alert('No tiene permiso para ver el detalle de la obligación de pago.');
    return;
  }
  try {
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+id_cxp+'&select=*,proveedores:id_proveedor(nombre,rif,id_categoria,metodos_pago_tipos,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre)),cuenta_gasto:id_cuenta_gasto(id_cuenta,codigo,nombre)');
    if (!rows || !rows[0]) return;
    const c = rows[0];

    // ── Detectar si es CxP automática de Inventario ──
    const esAutomatica = /^ENT-/.test(c.numero_doc || '')
      || c.tipo === 'COMPRA_ARTICULO' || c.tipo === 'COMPRA_ARTICULO_CREDITO';
    if (esAutomatica) {
      await _verCxPAutomatica(c, id_cxp);
      return;
    }

    // Si modo es pagar → usar modal-ejecutar-pago directamente
    if (modoInicial === 'pagar') {
      await ejecutarPagoCxP(id_cxp);
      return;
    }

    const prov = c.proveedores || {};
    const est  = c.estado || 'PENDIENTE';

    // Limpiar dataset
    const modal = document.getElementById('modal-cont-pago-cxp');
    if (modal) Object.keys(modal.dataset).forEach(function(k){ delete modal.dataset[k]; });

    // ── Sección 1: Datos de la obligación ──
    const tituloEl = document.getElementById('cont-pago-cxp-titulo');
    if (tituloEl) tituloEl.textContent = 'DETALLE DE OBLIGACIÓN';

    document.getElementById('cont-pago-cxp-id').value = id_cxp;

    const saldoEl = document.getElementById('cont-pago-cxp-saldo');
    const saldoUsdEl = document.getElementById('cont-pago-cxp-saldo-usd');
    if (saldoEl) {
      const monedaCxP = c.moneda_pago || 'USD';
      if (monedaCxP === 'VES') saldoEl.textContent = fmtBs(c.monto_ves || c.monto_usd) + ' Bs';
      else if (monedaCxP === 'EUR') saldoEl.textContent = fmtUSD(c.monto_usd) + ' EUR';
      else saldoEl.textContent = '$ ' + fmtUSD(c.monto_usd) + ' USD';
      // Equivalente en USD -- solo si la moneda de la Obligación no es ya USD
      if (saldoUsdEl) saldoUsdEl.textContent = monedaCxP !== 'USD' ? '≈ $ ' + fmtUSD(c.monto_usd) + ' USD' : '';
    }

    const provNomEl = document.getElementById('cont-pago-cxp-prov-nombre');
    if (provNomEl) provNomEl.textContent = prov.nombre || '—';

    const rifDetEl = document.getElementById('cont-pago-cxp-rif');
    if (rifDetEl) rifDetEl.textContent = prov.rif || '—';

    const catDetEl = document.getElementById('cont-pago-cxp-categoria');
    if (catDetEl) {
      catDetEl.textContent = '—';
      if (prov.id_categoria) {
        try {
          const catRows = await api('param_categorias_proveedor','GET',null,'?id=eq.'+prov.id_categoria+'&select=nombre&limit=1');
          if (catRows && catRows[0]) catDetEl.textContent = catRows[0].nombre;
        } catch(e) {}
      }
    }

    const ctaGastoEl = document.getElementById('cont-pago-cxp-cuenta-gasto');
    if (ctaGastoEl) ctaGastoEl.textContent = c.cuenta_gasto ? (c.cuenta_gasto.codigo + ' — ' + c.cuenta_gasto.nombre) : '—';

    const modalidadEl = document.getElementById('cont-pago-cxp-modalidad');
    if (modalidadEl) {
      const esCreditoModal = c.esquema_pago === 'CREDITO' || /-C\d+(?:-\d+)?$/.test(c.numero_doc || '');
      if (esCreditoModal) {
        const mCuotaModal = (c.numero_doc || '').match(/-C(\d+)(?:-\d+)?$/);
        modalidadEl.textContent = 'Crédito' + (mCuotaModal ? ' — Cuota ' + mCuotaModal[1] : '');
      } else {
        modalidadEl.textContent = c.esquema_pago === 'CONTADO' ? 'Contado' : '—';
      }
    }

    const metodoLabels = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', AFILIACION_BANCARIA: 'Afiliación Bancaria' };
    const metodoDetEl = document.getElementById('cont-pago-cxp-metodo');
    if (metodoDetEl) {
      const metodoActualProv = (Array.isArray(prov.metodos_pago_tipos) && prov.metodos_pago_tipos[0]) || '';
      metodoDetEl.textContent = metodoLabels[metodoActualProv] || '— No configurado en la ficha —';
    }

    const tasaCreacionEl = document.getElementById('cont-pago-cxp-tasa-creacion');
    if (tasaCreacionEl) tasaCreacionEl.textContent = c.tasa_bcv ? parseFloat(c.tasa_bcv).toFixed(4) : '—';

    const ivaInfoEl = document.getElementById('cont-pago-cxp-iva-info');
    if (ivaInfoEl) {
      // Usa la tasa REAL congelada al crear esta Obligación (tasa_iva) --
      // no la de hoy. Solo cae a la tasa de hoy en filas viejas creadas
      // antes de que existiera esta columna (tasa_iva NULL).
      const pctIVADet = Math.round((c.tasa_iva != null ? parseFloat(c.tasa_iva) : tasaIVAActual())*100);
      // Desde la Ficha de Detalle importa el RESULTADO, no cómo se armó el
      // cálculo al crear la Obligación (si el monto ya traía el IVA o si se
      // le sumó) -- ambos casos terminan en la misma Obligación con IVA
      // incluido, así que se muestra igual.
      ivaInfoEl.textContent = c.exento_iva
        ? 'Exento de IVA'
        : 'IVA ' + pctIVADet + '%';
    }

    // IGTF -- solo se muestra si esta CxP fue creada con IGTF ya resuelto
    // (aplica_igtf true) -- las CxP viejas (aplica_igtf NULL) no lo tenían
    // congelado y no se les inventa un valor ahora.
    const igtfContDetEl = document.getElementById('cont-pago-cxp-igtf-cont');
    const igtfInfoDetEl = document.getElementById('cont-pago-cxp-igtf-info');
    if (igtfContDetEl && igtfInfoDetEl) {
      if (c.aplica_igtf === true && c.monto_igtf > 0) {
        igtfContDetEl.style.display = '';
        igtfInfoDetEl.textContent = '$ ' + fmtUSD(c.monto_igtf) + ' (' + Math.round((c.tasa_igtf||0.03)*100) + '%) — incluido en el monto';
      } else {
        igtfContDetEl.style.display = 'none';
      }
    }

    const vencEl = document.getElementById('cont-pago-cxp-vencimiento');
    if (vencEl) vencEl.textContent = c.fecha_vencimiento ? fmtFecha(c.fecha_vencimiento) : '—';

    const conceptoEl = document.getElementById('cont-pago-cxp-concepto');
    if (conceptoEl) conceptoEl.textContent = c.concepto || '—';

    // Badge de Estado, en el extremo derecho del encabezado de la sección
    const estadoBadgeEl = document.getElementById('cont-pago-cxp-estado-badge');
    if (estadoBadgeEl) {
      const coloresEstado = { PENDIENTE:'#f59e0b', RECHAZADA:'#fc8181', APROBADA:'#a78bfa', POR_APROBAR:'#60a5fa', PAGADA:'#22c55e', PARCIAL:'#22c55e', ANULADA:'#6b7280' };
      const estActual = c.estado || 'PENDIENTE';
      const colEstado = coloresEstado[estActual] || '#888';
      estadoBadgeEl.textContent = estActual;
      estadoBadgeEl.style.color = colEstado;
      estadoBadgeEl.style.background = colEstado + '22';
      estadoBadgeEl.style.borderColor = colEstado + '44';
    }

    // Observación -- solo se muestra si tiene contenido
    const obsCont = document.getElementById('cont-pago-cxp-observacion-cont');
    const obsVerEl = document.getElementById('cont-pago-cxp-observacion');
    if (obsCont) {
      if (c.observaciones) {
        obsCont.style.display = '';
        if (obsVerEl) obsVerEl.textContent = c.observaciones;
      } else {
        obsCont.style.display = 'none';
      }
    }

    // Creado por -- Área (código) en una línea, Nombre completo debajo
    const creadorEl = document.getElementById('cont-pago-cxp-creador');
    if (creadorEl) {
      if (c.id_usuario) {
        creadorEl.textContent = '…';
        resolverCreadorCxP(c.id_usuario).then(function(info){
          const areaLinea = [info.areaNombre, info.areaCodigo ? '(' + info.areaCodigo + ')' : ''].filter(Boolean).join(' ');
          creadorEl.innerHTML = (areaLinea ? '<div>' + areaLinea + '</div>' : '') + '<div>' + (info.nombre || '—') + '</div>';
        });
      } else {
        creadorEl.textContent = '—';
      }
    }

    // Helper -- pinta Área (código) + Nombre en un contenedor que se muestra
    // solo si el correo viene con dato (Modificado/Anulado/Revertido por
    // son opcionales, a diferencia de Creado por que siempre existe)
    const pintarQuienCxP = function(idCont, idEl, correo) {
      const cont = document.getElementById(idCont);
      const el   = document.getElementById(idEl);
      if (!cont || !el) return;
      if (!correo) { cont.style.display = 'none'; return; }
      cont.style.display = '';
      el.textContent = '…';
      resolverCreadorCxP(correo).then(function(info){
        const areaLinea = [info.areaNombre, info.areaCodigo ? '(' + info.areaCodigo + ')' : ''].filter(Boolean).join(' ');
        el.innerHTML = (areaLinea ? '<div>' + areaLinea + '</div>' : '') + '<div>' + (info.nombre || '—') + '</div>';
      });
    };
    pintarQuienCxP('cont-pago-cxp-modificado-cont', 'cont-pago-cxp-modificado', c.modificado_por);
    pintarQuienCxP('cont-pago-cxp-anulado-cont',    'cont-pago-cxp-anulado',    c.anulado_por);
    pintarQuienCxP('cont-pago-cxp-revertido-cont',  'cont-pago-cxp-revertido',  c.revertido_por);

    // ── Sección 2: Datos del pago (si ya se registró un pago, aunque
    // esté pendiente de aprobación) ──
    const secPago = document.getElementById('cont-pago-cxp-seccion-pago');
    const tienePago = est === 'PAGADA' || est === 'PARCIAL' || est === 'POR_APROBAR';
    if (secPago) secPago.style.display = tienePago ? '' : 'none';
    if (tienePago) {
      const detFecha = document.getElementById('cont-pago-det-fecha');
      if (detFecha) detFecha.textContent = c.fecha_pago ? fmtFecha(c.fecha_pago) : '—';
      const detMonto = document.getElementById('cont-pago-det-monto');
      if (detMonto) { var _mon = c.moneda_pago||'VES'; detMonto.textContent = _mon==='VES' ? fmtBs(c.monto_ves||0)+' Bs' : '$ '+fmtUSD(c.monto_usd||0)+' '+_mon; }
      const detAprobado = document.getElementById('cont-pago-det-aprobado');
      if (detAprobado) {
        if (c.aprobado_por) {
          detAprobado.textContent = '…';
          resolverCreadorCxP(c.aprobado_por).then(function(info){
            const areaLinea = [info.areaNombre, info.areaCodigo ? '(' + info.areaCodigo + ')' : ''].filter(Boolean).join(' ');
            detAprobado.innerHTML = (areaLinea ? '<div>' + areaLinea + '</div>' : '') + '<div>' + (info.nombre || '—') + '</div>';
          });
        } else {
          detAprobado.textContent = '—';
        }
      }
      const detPagado = document.getElementById('cont-pago-det-pagado');
      if (detPagado) {
        if (c.pagado_por) {
          detPagado.textContent = '…';
          resolverCreadorCxP(c.pagado_por).then(function(info){
            const areaLinea = [info.areaNombre, info.areaCodigo ? '(' + info.areaCodigo + ')' : ''].filter(Boolean).join(' ');
            detPagado.innerHTML = (areaLinea ? '<div>' + areaLinea + '</div>' : '') + '<div>' + (info.nombre || '—') + '</div>';
          });
        } else {
          detPagado.textContent = '—';
        }
      }
      const detRef = document.getElementById('cont-pago-det-ref');
      if (detRef) detRef.textContent = c.referencia || '—';
      const detViaCont = document.getElementById('cont-pago-det-via-cont');
      const detVia = document.getElementById('cont-pago-det-via');
      if (detViaCont && detVia) {
        if (c.via_pago === 'BANCO') { detViaCont.style.display = ''; detVia.textContent = '🏦 Cuenta Bancaria'; }
        else if (c.via_pago === 'PM') { detViaCont.style.display = ''; detVia.textContent = '📱 Pago Móvil'; }
        else { detViaCont.style.display = 'none'; }
      }
      // Forma de Pago -- el método REAL (Efectivo/Transferencia/Afiliación
      // Bancaria) según quedó registrado al pagar. Antes mostraba
      // Contado/Crédito, que es la Modalidad -- dato que ya se muestra
      // arriba, en la sección "Datos de la Obligación".
      const detForma = document.getElementById('cont-pago-det-forma');
      if (detForma) {
        const metodoPagoLabels = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', AFILIACION_BANCARIA: 'Afiliación Bancaria' };
        const metodoPagoCrudo = c.metodo_pago || '';
        if (metodoPagoLabels[metodoPagoCrudo]) {
          detForma.textContent = metodoPagoLabels[metodoPagoCrudo];
        } else if (/^\d+$/.test(String(metodoPagoCrudo))) {
          // Guardado como id_metodo numérico (ruta "Ejecutar Pago") --
          // resolver contra param_metodos_pago para obtener el tipo_canal.
          try {
            const mRowsForma = await api('param_metodos_pago','GET',null,'?id_metodo=eq.'+metodoPagoCrudo+'&select=tipo_canal&limit=1');
            detForma.textContent = metodoPagoLabels[mRowsForma?.[0]?.tipo_canal] || '—';
          } catch(eForma) { detForma.textContent = '—'; }
        } else {
          detForma.textContent = '—';
        }
      }
      // Comprobante
      const detCompCont = document.getElementById('cont-pago-det-comprobante-cont');
      const detComp = document.getElementById('cont-pago-det-comprobante');
      if (c.url_comprobante && detComp) {
        const url = c.url_comprobante;
        const esImg = url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        detComp.innerHTML = esImg
          ? '<a href="'+url+'" target="_blank"><img src="'+url+'" style="max-width:100%;max-height:150px;border-radius:6px;border:1px solid var(--borde)"></a>'
          : '<a href="'+url+'" target="_blank" style="color:var(--naranja);font-size:12px">&#x1F4C4; Ver comprobante</a>';
        if (detCompCont) detCompCont.style.display = '';
      } else if (detCompCont) detCompCont.style.display = 'none';
    }

    // ── Sección 3: Datos bancarios del proveedor -- solo si "Transferencia"
    // sigue siendo el Método de Pago ACTUAL del proveedor (no solo porque el
    // dato exista guardado; el proveedor pudo haber cambiado de método
    // después de crear esta CxP, y no debe mostrarse info desactualizada) ──
    const bancoInfo  = document.getElementById('cont-pago-banco-info');
    const bancoDatos = document.getElementById('cont-pago-banco-datos');
    const pmInfo     = document.getElementById('cont-pago-pm-info');
    const pmDatos    = document.getElementById('cont-pago-pm-datos');
    const manualInfo = document.getElementById('cont-pago-manual-info');
    [bancoInfo, pmInfo, manualInfo].forEach(function(el){ if (el) el.style.display = 'none'; });

    const aceptaTransferenciaHoy = Array.isArray(prov.metodos_pago_tipos) && prov.metodos_pago_tipos.includes('TRANSFERENCIA');
    if (aceptaTransferenciaHoy && prov.id_banco && bancoDatos) {
      bancoDatos.innerHTML = dato('Institución', prov.banco_prov?.nombre||'—') + dato('Tipo', prov.tipo_cuenta||'—') + dato('N° Cuenta', fmtNumCuenta(prov.numero_cuenta), true);
      if (bancoInfo) bancoInfo.style.display = '';
    }
    if (aceptaTransferenciaHoy && prov.pm_id_banco && pmDatos) {
      pmDatos.innerHTML = dato('Banco', prov.banco_pm?.nombre||'—') + dato('C.I./R.I.F', prov.pm_ci||'—') + dato('Celular', prov.pm_celular||'—');
      if (pmInfo) pmInfo.style.display = '';
    }
    if (!aceptaTransferenciaHoy && est === 'PENDIENTE') {
      if (manualInfo) manualInfo.style.display = '';
    }

    // ── Sección 4: Formulario de pago -- ya NO se muestra mientras está
    // PENDIENTE (no tiene sentido mostrar campos de un pago que aún no
    // existe). Referencia/Comprobante se piden en un diálogo al momento
    // de darle clic a "Registrar Pago" (ver abrirDialogoRegistrarPago).
    const formPago = document.getElementById('cont-pago-cxp-form-pago');
    if (formPago) formPago.style.display = 'none';

    // ── Alertas ──
    const okEl  = document.getElementById('alerta-pago-cxp-ok');
    const errEl = document.getElementById('alerta-pago-cxp-err');
    if (okEl)  okEl.style.display  = 'none';
    if (errEl) errEl.style.display = 'none';

    // ── Footer según estado ──
    const footer = document.getElementById('cont-pago-cxp-footer');
    const esManualF = !(c.tipo||'').includes('COMPRA_CONSUMIBLE');
    if (footer) {
      if (est === 'PENDIENTE') {
        footer.innerHTML =
          '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-pago-cxp\')">Retornar</button>'
          + '<button class="btn-primario" onclick="abrirDialogoRegistrarPago()">&#x1F4B8; Registrar Pago</button>';
      } else {
        const btnAnularF    = (esManualF && est !== 'ANULADA' && est !== 'PAGADA') ? '<button class="btn-peligro" onclick="anularPagoCxP('+id_cxp+');cerrarModal(\'modal-cont-pago-cxp\')">🗑 Anular</button>' : '';
        const btnAnularEjecF = ((est === 'PAGADA' || est === 'PARCIAL') && (sesionActual?.administrador || puedo('PAGOS','ANULAR'))) ? '<button class="btn-peligro" onclick="anularPagoEjecutado('+id_cxp+')">🗑 Anular Pago Procesado</button>' : '';
        const btnReactivarF = (est === 'ANULADA' && (sesionActual?.administrador || puedo('PAGOS','ELIMINAR'))) ? '<button class="btn-primario" onclick="reactivarPagoCxP('+id_cxp+')">↩ Reactivar</button>' : '';
        footer.innerHTML =
          '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%">'
          + (btnAnularF || btnAnularEjecF || btnReactivarF)
          + '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-pago-cxp\');cargarPagos()">Retornar</button>'
          + '</div>';
      }
    }

    // ── Si es PENDIENTE o APROBADA, cargar tasas y preparar formulario de
    // pago -- Registrar Pago ahora solo se habilita en APROBADA, pero los
    // campos (ocultos) siguen necesitando este auto-completado igual ──
    if (est === 'PENDIENTE' || est === 'APROBADA') {
      try {
        const hoy2 = new Date(new Date().getTime()-4*60*60*1000).toISOString().split('T')[0];
        const tasas2 = await api('tasas','GET',null,'?order=fecha_valor.desc&limit=20&select=*') || [];
        const getTasa2 = function(mon) {
          const reg = tasas2.filter(function(t){ return t.moneda_origen===mon && String(t.fecha_valor||'').substring(0,10)<=hoy2; })
            .sort(function(a,b){ return String(b.fecha_valor||'').localeCompare(String(a.fecha_valor||'')); });
          return reg.length ? parseFloat(reg[0].tipo_cambio) : 1;
        };
        const tasaUSD2 = getTasa2('USD');
        const tasaEUR2 = getTasa2('EUR');
        if (modal) {
          modal.dataset.tasaUSD  = tasaUSD2;
          modal.dataset.tasaEUR  = tasaEUR2;
          modal.dataset.monedaCxP = c.moneda_pago || 'USD';
          modal.dataset.saldoOrig = c.moneda_pago === 'VES' ? (c.monto_ves || c.monto_usd) : c.monto_usd;
          modal.dataset.saldoUSD  = c.monto_usd;
          // Métodos de pago que la ficha del proveedor realmente permite --
          // se usa para filtrar el select de Método de Pago más abajo, en
          // vez de mostrar todos los métodos activos sin distinción.
          modal.dataset.metodosPagoTipos = JSON.stringify((prov && Array.isArray(prov.metodos_pago_tipos)) ? prov.metodos_pago_tipos : []);
        }
      } catch(e) {}

      // Reset campos pago
      document.getElementById('cont-pago-cxp-ref').value   = '';
      const facturaNoResetEl = document.getElementById('cont-pago-cxp-factura-no');
      if (facturaNoResetEl) facturaNoResetEl.value = '';
      document.getElementById('cont-pago-cxp-fecha').value = new Date().toISOString().split('T')[0];
      const archivoEl2 = document.getElementById('cont-pago-cxp-archivo');
      if (archivoEl2) { archivoEl2.value = ''; archivoEl2.style.display = ''; }
      const archivoCampoEl = document.getElementById('cont-pago-cxp-archivo-campo');
      if (archivoCampoEl) archivoCampoEl.style.display = '';
      const previewContEl = document.getElementById('cont-pago-cxp-archivo-preview-cont');
      if (previewContEl) previewContEl.style.display = 'none';

      // Método de pago
      const metodoCont = document.getElementById('cont-pago-metodo-cont');
      const metodoDisp = document.getElementById('cont-pago-metodo-display');
      const metodoHid  = document.getElementById('cont-pago-cxp-metodo');
      if (prov.id_banco && prov.pm_id_banco) {
        if (metodoCont) metodoCont.innerHTML =
          '<select id="cont-pago-cxp-metodo" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
          +'<option value="TRANSFERENCIA">🏦 Transferencia Bancaria</option>'
          +'<option value="PAGO_MOVIL">📱 Pago Móvil</option>'+'</select>';
      } else if (prov.id_banco) {
        if (metodoDisp) metodoDisp.textContent = '🏦 Transferencia Bancaria';
        if (metodoHid)  metodoHid.value = 'TRANSFERENCIA';
      } else if (prov.pm_id_banco) {
        if (metodoDisp) metodoDisp.textContent = '📱 Pago Móvil';
        if (metodoHid)  metodoHid.value = 'PAGO_MOVIL';
      } else {
        if (metodoDisp) metodoDisp.textContent = '—';
      }

      // Moneda por defecto y calcular
      const monedaEl3 = document.getElementById('cont-pago-cxp-moneda');
      if (monedaEl3) { monedaEl3.value = modal?.dataset.monedaCxP || 'VES'; monedaEl3.disabled = false; }

      setTimeout(function() {
        const saldoEl3 = document.getElementById('cont-pago-cxp-saldo');
        const saldoUsdEl3 = document.getElementById('cont-pago-cxp-saldo-usd');
        const modal4   = document.getElementById('modal-cont-pago-cxp');
        const mCxP2    = modal4?.dataset.monedaCxP || 'USD';
        const sOrig2   = parseFloat(modal4?.dataset.saldoOrig) || 0;
        const sUsd2    = parseFloat(modal4?.dataset.saldoUSD) || 0;
        if (saldoEl3) {
          if (mCxP2 === 'VES')      saldoEl3.textContent = fmtBs(sOrig2) + ' Bs';
          else if (mCxP2 === 'EUR') saldoEl3.textContent = fmtUSD(sOrig2) + ' EUR';
          else                      saldoEl3.textContent = '$ ' + fmtUSD(sOrig2) + ' USD';
        }
        // Equivalente en USD -- solo si la moneda de la Obligación no es ya USD
        if (saldoUsdEl3) saldoUsdEl3.textContent = mCxP2 !== 'USD' ? '≈ $ ' + fmtUSD(sUsd2) + ' USD' : '';
        onCambioPagoMoneda();
      }, 50);
    }

    abrirModal('modal-cont-pago-cxp');

    // Footer dinámico con botón Anular y Editar
    const footerPend = document.querySelector('#modal-cont-pago-cxp .modal-footer');
    if (footerPend) {
      const est = c.estado || '';
      const btnEditar = ((est === 'PENDIENTE' || est === 'RECHAZADA') && puedo('PAGOS','EDITAR'))
        ? '<button class="btn-naranja" onclick="editarCxPManual('+id_cxp+')">✏️ Editar</button>' : '';
      const btnRegistrarPago = (est === 'APROBADA' && (puedo('PAGOS','PAGAR') || sesionActual?.administrador))
        ? '<button class="btn-primario" onclick="abrirDialogoRegistrarPago()">&#x1F4B8; Registrar Pago</button>' : '';
      const btnAnular = ((est === 'PENDIENTE' || est === 'RECHAZADA') && (puedo('PAGOS','ELIMINAR') || sesionActual?.administrador))
        ? '<button class="btn-peligro" onclick="anularPagoCxP('+id_cxp+')">🗑 Anular</button>' : '';
      const btnAnularEjec = ((est === 'PAGADA' || est === 'PARCIAL') && (sesionActual?.administrador || puedo('PAGOS','ANULAR')))
        ? '<button class="btn-peligro" onclick="anularPagoEjecutado('+id_cxp+')">🗑 Anular Pago Procesado</button>' : '';
      const btnReactivar = (est === 'ANULADA' && (sesionActual?.administrador || puedo('PAGOS','ELIMINAR')))
        ? '<button class="btn-primario" onclick="reactivarPagoCxP('+id_cxp+')">↩ Reactivar</button>' : '';
      footerPend.innerHTML =
        '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%">'
        + (btnEditar + btnRegistrarPago + btnAnular + btnAnularEjec + btnReactivar)
        + '<button class="btn-secundario" onclick="cerrarModal(\'modal-cont-pago-cxp\')">RETORNAR</button>'
        + '</div>';
    }

  } catch(e) { alert('Error: '+msgErr(e)); console.error(e); }
}

// pagarCxP now delegates to verDetalleCxP
async function pagarCxP(id_cxp) {
  await verDetalleCxP(id_cxp, 'pagar');
}

// verPagoCxP now delegates to verDetalleCxP
async function verPagoCxP(id_cxp) {
  await verDetalleCxP(id_cxp, 'ver');
}

async function _verCxPAutomatica(c, id_cxp) {
  window._cxpAutoIdActual = id_cxp;
  // Determinar si es CRÉDITO por esquema_pago o por numero_doc con -C al final
  const esCredito = c.esquema_pago === 'CREDITO' || /-C\d+$/.test(c.numero_doc || '');

  // Proveedor -- nombre y RIF, ya vienen en el join de la consulta
  const provAuto = c.proveedores || {};
  document.getElementById('cxp-auto-prov-nombre').textContent = provAuto.nombre || '—';
  document.getElementById('cxp-auto-prov-rif').textContent = provAuto.rif || '—';

  // N° Documento -- antes de pagar, se ve aquí normal. Una vez PAGADA, este
  // slot pasa a mostrar el N°. Factura, y el N° Documento se muestra más
  // abajo, en formato de cuadro (entre Tasa BCV y Descripción).
  const yaPagadaTop = c.estado === 'PAGADA';
  const lblNumeroTop = document.getElementById('cxp-auto-numero-label');
  const numeroDocBox = document.getElementById('cxp-auto-numero-doc-box');
  const numeroDocBoxValor = document.getElementById('cxp-auto-numero-doc-box-valor');
  if (yaPagadaTop) {
    if (lblNumeroTop) lblNumeroTop.textContent = 'N°. Factura';
    document.getElementById('cxp-auto-numero').textContent = c.numero_factura_proveedor || '—';
    if (numeroDocBox) numeroDocBox.style.display = '';
    if (numeroDocBoxValor) numeroDocBoxValor.textContent = fmtNumeroDoc(c.numero_doc) || '—';
  } else {
    if (lblNumeroTop) lblNumeroTop.textContent = 'N° Documento';
    document.getElementById('cxp-auto-numero').textContent = fmtNumeroDoc(c.numero_doc) || '—';
    if (numeroDocBox) numeroDocBox.style.display = 'none';
  }

  // Estado
  const estadoEl = document.getElementById('cxp-auto-estado');
  estadoEl.textContent = c.estado || '—';
  estadoEl.style.color = c.estado === 'PAGADA' ? '#22c55e' : c.estado === 'PARCIAL' ? '#f59e0b' : 'var(--naranja)';

  // Fechas
  document.getElementById('cxp-auto-fecha-emision').textContent = c.fecha_emision ? c.fecha_emision.slice(0,10).split('-').reverse().join('/') : '—';
  document.getElementById('cxp-auto-fecha-venc').textContent    = c.fecha_vencimiento ? c.fecha_vencimiento.slice(0,10).split('-').reverse().join('/') : '—';

  // Monto USD y Bs -- la Moneda de NEGOCIACIÓN es la deuda REAL, nunca
  // cambia. La Moneda CONTRARIA es solo un equivalente informativo, y
  // mientras la Obligación no esté pagada, se recalcula SIEMPRE con la
  // tasa BCV de HOY (sin importar cuál sea la Moneda de Pago elegida) --
  // antes solo se recalculaba si la Moneda de Pago era distinta a la de
  // Negociación, dejando el caso más común (pagar en la misma Moneda que
  // se negoció) mostrando el equivalente contrario con la tasa vieja.
  // Una vez pagada, se muestra lo que realmente se pagó (congelado, ya no
  // cambia).
  const monedaNegAuto  = (c.moneda_negociacion || (c.moneda_pago || 'USD')).toUpperCase();
  const montoUSDCongAuto = parseFloat(c.monto_usd || 0);
  const montoVESCongAuto = parseFloat(c.monto_ves || 0);
  const yaPagadaAuto = c.estado === 'PAGADA';
  let tasaMostrar = parseFloat(c.tasa_bcv || 0) || 1;
  if (!yaPagadaAuto) {
    try {
      const hoyAuto = getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10);
      const tasasHoyAuto = await api('tasas','GET',null,'?fecha_valor=lte.'+hoyAuto+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      if (tasasHoyAuto && tasasHoyAuto[0]) tasaMostrar = parseFloat(tasasHoyAuto[0].tipo_cambio);
    } catch(eTasaAuto) {}
  }
  let montoUSDMostrar, montoVESMostrar;
  if (monedaNegAuto === 'VES') {
    montoVESMostrar = montoVESCongAuto; // deuda real, fija
    montoUSDMostrar = yaPagadaAuto ? montoUSDCongAuto : parseFloat((montoVESCongAuto / (tasaMostrar || 1)).toFixed(2));
  } else {
    montoUSDMostrar = montoUSDCongAuto; // deuda real, fija
    montoVESMostrar = yaPagadaAuto ? montoVESCongAuto : parseFloat((montoUSDCongAuto * tasaMostrar).toFixed(2));
  }
  const monedaPagoAuto = (c.moneda_pago || 'USD').toUpperCase();

  document.getElementById('cxp-auto-monto').textContent = '$ ' + montoUSDMostrar.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('cxp-auto-tasa').textContent    = tasaMostrar.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:4, maximumFractionDigits:4});
  document.getElementById('cxp-auto-monto-ves').textContent = 'Bs. ' + montoVESMostrar.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2});

  // Labels dinámicos: "Monto Pagado" para la Moneda predominante (la de
  // Pago), "Contravalor Monto" para la contraria -- los campos en pantalla
  // están fijos (USD primero, VES segundo), así que solo se cambia el
  // texto del label según cuál sea la predominante.
  const lblMontoAuto = document.getElementById('cxp-auto-monto-label');
  const lblMontoVesAuto = document.getElementById('cxp-auto-monto-ves-label');
  if (monedaPagoAuto === 'USD') {
    if (lblMontoAuto) lblMontoAuto.textContent = 'Monto Pagado (USD)';
    if (lblMontoVesAuto) lblMontoVesAuto.textContent = 'Contravalor Monto (VES)';
  } else {
    if (lblMontoAuto) lblMontoAuto.textContent = 'Contravalor Monto (USD)';
    if (lblMontoVesAuto) lblMontoVesAuto.textContent = 'Monto Pagado (VES)';
  }

  // Resaltar en naranja el Monto que coincida con la Moneda de Pago REAL
  // de esta CxP (c.moneda_pago) -- antes USD siempre quedaba resaltado
  // (color fijo en el HTML), sin importar la Moneda real.
  const elMontoUSDAuto = document.getElementById('cxp-auto-monto');
  const elMontoVESAuto = document.getElementById('cxp-auto-monto-ves');
  if (elMontoUSDAuto) elMontoUSDAuto.style.color = monedaPagoAuto === 'USD' ? 'var(--naranja)' : 'var(--texto)';
  if (elMontoVESAuto) elMontoVESAuto.style.color = monedaPagoAuto === 'VES' ? 'var(--naranja)' : 'var(--texto)';

  // Descripción — eliminar prefijos automáticos
  const descRaw = c.observaciones || c.descripcion || '—';
  const desc = descRaw
    .replace(/^Cuota\s+\d+\/\d+\s*[—\-]\s*/i, '')
    .replace(/^Contado\s*[—\-]\s*/i, '')
    .replace(/^Crédito\s*[—\-]\s*/i, '')
    .trim();
  document.getElementById('cxp-auto-descripcion').textContent = desc || '—';

  // Cuenta de Gasto
  const cg = c.cuenta_gasto;
  const cgEl = document.getElementById('cxp-auto-cuenta');
  if (cg) {
    cgEl.textContent = (cg.codigo ? cg.codigo + ' — ' : '') + (cg.nombre || '—');
    cgEl.style.color = '';
  } else {
    cgEl.innerHTML = '⚠ No asignada — edite el artículo y asigne la Cuenta Costo/Gasto';
    cgEl.style.color = '#fc8181';
  }

  // Modalidad de Pago
  document.getElementById('cxp-auto-modalidad').textContent = esCredito ? 'Crédito' : 'Contado';

  // Vía de Pago -- solo si quedó registrada (pago por Transferencia donde
  // el proveedor tenía tanto Cuenta Bancaria como Pago Móvil)
  const viaCont = document.getElementById('cxp-auto-via-cont');
  const viaEl   = document.getElementById('cxp-auto-via');
  if (viaCont && viaEl) {
    if (c.via_pago === 'BANCO') {
      viaCont.style.display = '';
      const bancoNom = c.proveedores?.banco_prov?.nombre || '—';
      viaEl.innerHTML = '🏦 Cuenta Bancaria — ' + bancoNom + (c.proveedores?.numero_cuenta ? '<div style="font-size:11px;color:var(--suave);margin-top:2px;font-family:var(--font-mono)">' + fmtNumCuenta(c.proveedores.numero_cuenta) + '</div>' : '');
    } else if (c.via_pago === 'PM') {
      viaCont.style.display = '';
      const bancoPM = c.proveedores?.banco_pm?.nombre || '—';
      viaEl.innerHTML = '📱 Pago Móvil — ' + bancoPM + (c.proveedores?.pm_celular ? '<div style="font-size:11px;color:var(--suave);margin-top:2px;font-family:var(--font-mono)">' + c.proveedores.pm_celular + '</div>' : '');
    } else {
      viaCont.style.display = 'none';
    }
  }

  // Referencia y Comprobante -- si ya se ejecutó el pago (PAGADA o PARCIAL);
  // o Motivo del Rechazo, reutilizando el mismo bloque/línea, si RECHAZADA.
  const pagoInfoCont = document.getElementById('cxp-auto-pago-info-cont');
  const refLabelEl = document.getElementById('cxp-auto-referencia-label');
  if (pagoInfoCont) {
    if (c.estado === 'PAGADA' || c.estado === 'PARCIAL') {
      pagoInfoCont.style.display = '';
      if (refLabelEl) refLabelEl.textContent = 'Referencia de Pago';
      const formaPagoCont = document.getElementById('cxp-auto-forma-pago-cont');
      const formaPagoEl = document.getElementById('cxp-auto-forma-pago');
      if (formaPagoCont && formaPagoEl) {
        if (c.metodo_pago) {
          formaPagoCont.style.display = '';
          // c.metodo_pago es un id_metodo (fila de param_metodos_pago) --
          // no el tipo genérico (Efectivo/Transferencia). Hay que
          // consultar esa fila para saber qué tipo fue realmente.
          formaPagoEl.textContent = '...';
          try {
            const metodoRows = await api('param_metodos_pago','GET',null,'?id_metodo=eq.'+c.metodo_pago+'&select=tipo_canal');
            const tipoCanalReal = metodoRows && metodoRows[0] ? metodoRows[0].tipo_canal : null;
            formaPagoEl.textContent = tipoCanalReal ? (METODO_PAGO_LABELS[tipoCanalReal] || tipoCanalReal) : '—';
          } catch(eMetodoPago) { formaPagoEl.textContent = '—'; }
        } else {
          formaPagoCont.style.display = 'none';
        }
      }
      const refAutoEl = document.getElementById('cxp-auto-referencia');
      if (refAutoEl) { refAutoEl.textContent = c.referencia || '—'; refAutoEl.style.color = ''; }
      const compAutoCont = document.getElementById('cxp-auto-comprobante-cont');
      const compAutoEl   = document.getElementById('cxp-auto-comprobante');
      if (c.url_comprobante && compAutoEl) {
        const urlAuto = c.url_comprobante;
        const esImgAuto = urlAuto.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        compAutoEl.innerHTML = esImgAuto
          ? '<a href="'+urlAuto+'" target="_blank"><img src="'+urlAuto+'" style="max-width:100%;max-height:150px;border-radius:6px;border:1px solid var(--borde)"></a>'
          : '<a href="'+urlAuto+'" target="_blank" style="color:var(--naranja);font-size:12px">&#x1F4C4; Ver comprobante</a>';
        if (compAutoCont) compAutoCont.style.display = '';
      } else if (compAutoCont) compAutoCont.style.display = 'none';
    } else if (c.estado === 'RECHAZADA') {
      pagoInfoCont.style.display = '';
      if (refLabelEl) refLabelEl.textContent = 'Motivo del Rechazo';
      const formaPagoContRech = document.getElementById('cxp-auto-forma-pago-cont');
      if (formaPagoContRech) formaPagoContRech.style.display = 'none';
      const refAutoEl = document.getElementById('cxp-auto-referencia');
      if (refAutoEl) { refAutoEl.textContent = c.motivo_rechazo || '—'; refAutoEl.style.color = '#fc8181'; }
      const compAutoCont = document.getElementById('cxp-auto-comprobante-cont');
      if (compAutoCont) compAutoCont.style.display = 'none';
    } else {
      pagoInfoCont.style.display = 'none';
    }
  }

  // Condiciones de Crédito — solo si es CRÉDITO
  const creditoCont = document.getElementById('cxp-auto-credito-cont');
  if (esCredito) {
    creditoCont.style.display = '';
    try {
      const base = (c.numero_doc || '').replace(/-C\d+$/, '');
      const cuotas = await api('cont_cxp', 'GET', null,
        '?numero_doc=ilike.' + encodeURIComponent(base + '*') + emisorQ()
        + '&order=fecha_vencimiento.asc&select=numero_doc,monto_usd,fecha_vencimiento,estado,fecha_pago');
      if (cuotas && cuotas.length) {
        document.getElementById('cxp-auto-cuotas-num').textContent   = cuotas.length;
        document.getElementById('cxp-auto-cuotas-fecha').textContent = cuotas[0].fecha_vencimiento?.slice(0,10).split('-').reverse().join('/') || '—';
        document.getElementById('cxp-auto-cuotas-monto').textContent = '$ ' + parseFloat(cuotas[0].monto_usd||0).toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2});
        // Intervalo
        if (cuotas.length > 1) {
          const f1 = new Date(cuotas[0].fecha_vencimiento + 'T00:00:00');
          const f2 = new Date(cuotas[1].fecha_vencimiento + 'T00:00:00');
          const intervalo = Math.round((f2 - f1) / (1000*60*60*24));
          document.getElementById('cxp-auto-cuotas-intervalo').textContent = intervalo + ' días';
        }
        const total = cuotas.reduce(function(s,q){ return s + parseFloat(q.monto_usd||0); }, 0);
        document.getElementById('cxp-auto-cuotas-tabla').innerHTML =
          '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">Vista previa — Total: $ '+total.toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2})+' ✓</div>'
          +'<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
          +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Cuota</th>'
          +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Fecha Vencimiento</th>'
          +'<th style="padding:6px 8px;text-align:right;color:var(--suave);font-size:10px">Monto USD</th>'
          +'<th style="padding:6px 8px;text-align:center;color:var(--suave);font-size:10px">Estado</th>'
          +'<th style="padding:6px 8px;text-align:center;color:var(--suave);font-size:10px">Fecha de Pago</th>'
          +'</tr></thead><tbody>'
          + cuotas.map(function(q,i) {
              const clr = q.estado === 'PAGADA' ? '#22c55e' : q.estado === 'PARCIAL' ? '#f59e0b' : 'var(--suave)';
              return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
                +'<td style="padding:6px 8px;font-weight:600">Cuota '+(i+1)+'</td>'
                +'<td style="padding:6px 8px;font-family:var(--font-mono)">'+(q.fecha_vencimiento?.slice(0,10)||'—')+'</td>'
                +'<td style="padding:6px 8px;text-align:right;font-family:var(--font-mono)">$ '+parseFloat(q.monto_usd||0).toLocaleString('es-VE', { timeZone: 'America/Caracas', minimumFractionDigits:2, maximumFractionDigits:2})+'</td>'
                +'<td style="padding:6px 8px;text-align:center;color:'+clr+';font-weight:600">'+(q.estado||'PENDIENTE')+'</td>'
                +'<td style="padding:6px 8px;text-align:center;font-family:var(--font-mono);color:var(--suave)">'+(q.fecha_pago?.slice(0,10)||'—')+'</td>'
                +'</tr>';
            }).join('')
          +'</tbody></table>';
      }
    } catch(e) { console.warn('Error cargando cuotas:', e); }
  } else {
    creditoCont.style.display = 'none';
  }

  // Mostrar botón PAGAR solo si ya fue APROBADA (o PARCIAL, para completar
  // un pago ya iniciado) y tiene permiso -- igual que el mundo manual, que
  // exige aprobación previa antes de poder pagar (PENDIENTE ya NO permite
  // pagar directo, para no saltarse el control de aprobación)
  const btnPagar = document.getElementById('cxp-auto-btn-pagar');
  if (btnPagar) {
    const tienePerm = sesionActual?.administrador || puedo('PAGOS','PAGAR');
    const estadoOK  = c.estado === 'APROBADA' || c.estado === 'PARCIAL';
    const puedePagar = estadoOK && tienePerm;
    btnPagar.style.display = puedePagar ? '' : 'none';
  }

  // Mostrar botón ANULAR PAGO EJECUTADO si está PAGADA o PARCIAL (un pago
  // parcial también puede necesitar reversarse, ej. si quedó mal calculado)
  const btnAnularEj = document.getElementById('cxp-auto-btn-anular-ejecutado');
  if (btnAnularEj) {
    const puedeAnular = (c.estado === 'PAGADA' || c.estado === 'PARCIAL') && (sesionActual?.administrador || puedo('PAGOS','ANULAR'));
    btnAnularEj.style.display = puedeAnular ? '' : 'none';
  }

  abrirModal('modal-ver-cxp-auto');
}


async function verCxPPendiente(id_cxp) {
  if (!sesionActual?.administrador && !puedo('PAGOS','VER')) {
    alert('No tiene permiso para ver el detalle de la obligación de pago.');
    return;
  }
  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=numero_doc,tipo');
    if (!rows || !rows[0]) return;
    const c = rows[0];

    // ── Detectar si es CxP automática de Inventario ──
    const esAutomatica = /^ENT-/.test(c.numero_doc || '')
      || c.tipo === 'COMPRA_ARTICULO' || c.tipo === 'COMPRA_ARTICULO_CREDITO';

    if (esAutomatica) {
      const full = await api('cont_cxp','GET',null,
        '?id_cxp=eq.'+id_cxp+'&select=*,proveedores:id_proveedor(nombre,rif,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre),id_categoria),cuenta_gasto:id_cuenta_gasto(id_cuenta,codigo,nombre)');
      if (full && full[0]) await _verCxPAutomatica(full[0], id_cxp);
      return;
    }

    // CxP manual — abrir primero el Detalle de solo lectura; desde ahí, el
    // botón "✏️ Editar" (si el usuario tiene permiso) lleva al formulario editable.
    await verDetalleCxP(id_cxp);
  } catch(e) { alert('Error: '+msgErr(e)); console.error(e); }
}

function editarCxPPendiente(id_cxp) {
  if (!puedo('PAGOS','EDITAR')) { alert('No tiene permiso para editar obligaciones de pago.'); return; }
  // Habilitar todos los campos
  ['pago-descripcion','pago-cuenta-gasto',
   'pago-monto','pago-vencimiento','pago-proveedor','pago-observaciones'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  // Cambiar título
  document.getElementById('pago-modal-titulo').textContent = 'EDITAR OBLIGACIÓN';
  // Cambiar footer
  const footer = document.querySelector('#modal-pago .modal-footer');
  if (footer) footer.innerHTML =
    '<button class="btn-secundario" onclick="cerrarModal(\'modal-pago\')">Retornar</button>'
    + '<button class="btn-primario" onclick="guardarEdicionCxP(' + id_cxp + ')">💾 Guardar Cambios</button>';
}

async function guardarEdicionCxP(id_cxp) {
  if (!puedo('PAGOS','EDITAR')) { alert('No tiene permiso para editar obligaciones de pago.'); return; }
  const errEl = document.getElementById('alerta-pago-err');
  const okEl  = document.getElementById('alerta-pago-ok');
  if (errEl) errEl.style.display = 'none';
  if (okEl)  okEl.style.display  = 'none';

  const mostrarErr = function(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else alert(msg);
  };

  const moneda      = document.getElementById('pago-moneda')?.value || 'VES';
  const descripcion = document.getElementById('pago-descripcion')?.value.trim() || '';
  const id_cuenta    = parseInt(document.getElementById('pago-cuenta-gasto')?.value) || null;
  const monto       = parseFloat(document.getElementById('pago-monto')?.value) || 0;
  const vencimiento = document.getElementById('pago-vencimiento')?.value || '';
  const id_proveedor = parseInt(document.getElementById('pago-proveedor')?.value) || null;
  const observ      = document.getElementById('pago-observaciones')?.value.trim() || '';

  if (!descripcion) { mostrarErr('La descripción es obligatoria.'); return; }
  if (!monto)       { mostrarErr('El monto es obligatorio.'); return; }
  if (!vencimiento) { mostrarErr('La fecha de vencimiento es obligatoria.'); return; }
  if (!id_proveedor) { mostrarErr('Debe seleccionar un proveedor.'); return; }

  const tasaUSD = window._pagoTasaUSD || _tasaVigente || 1;
  const tasaEUR = window._pagoTasaEUR || 1;
  let montoUSD = monto, montoVES = monto;
  if (moneda === 'VES')      { montoVES = monto; montoUSD = parseFloat((monto / tasaUSD).toFixed(4)); }
  else if (moneda === 'USD') { montoUSD = monto; montoVES = parseFloat((monto * tasaUSD).toFixed(2)); }
  else if (moneda === 'EUR') { montoUSD = parseFloat((monto * tasaEUR / tasaUSD).toFixed(4)); montoVES = parseFloat((monto * tasaEUR).toFixed(2)); }

  try {
    await api('cont_cxp','PATCH',{
      moneda_pago:      moneda,
      monto_usd:        montoUSD,
      monto_ves:        montoVES,
      saldo_usd:        montoUSD,
      tasa_bcv:         tasaUSD,
      fecha_vencimiento: vencimiento,
      id_proveedor:     id_proveedor,
      id_cuenta_gasto:  id_cuenta,
      observaciones:    descripcion + (observ ? ' — ' + observ : ''),
      modificado_por:   sesionActual?.correo_usuario || null
    },'?id_cxp=eq.'+id_cxp);

    if (okEl) { okEl.textContent = '✓ Obligación actualizada correctamente.'; okEl.style.display = 'block'; }
    setTimeout(function() { cerrarModal('modal-pago'); cargarPagos(); }, 1000);
  } catch(e) { mostrarErr('Error: ' + msgErr(e)); }
}

async function eliminarCxP(id_cxp) {
  if (!puedo('PAGOS','ELIMINAR')) { alert('No tiene permiso para eliminar obligaciones de pago.'); return; }
  if (!confirm('¿Eliminar esta obligación de pago? Esta acción no se puede deshacer.')) return;
  try {
    await api('cont_cxp','DELETE',null,'?id_cxp=eq.'+id_cxp+'&estado=eq.PENDIENTE');
    const modalPago = document.getElementById('modal-pago');
    if (modalPago) { modalPago.classList.remove('abierto'); modalPago.style.display = 'none'; }
    cargarPagos();
  } catch(e) { alert('Error al eliminar: '+msgErr(e)); }
}

async function aprobarPagoCxP(id_cxp) {
  if (!puedo('PAGOS','APROBAR')) { alert('Sin permiso para aprobar.'); return; }
  if (!(await tieneNivelMinimo(2))) { alert('Esta acción requiere Firma de Aprobación Nivel 1 o Nivel 2.'); return; }
  try {
    const rowsChk = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=monto_usd,fecha_vencimiento,id_usuario');
    const montoCxP = rowsChk && rowsChk[0] ? Number(rowsChk[0].monto_usd) : null;
    const fechaVencChk = rowsChk && rowsChk[0] ? rowsChk[0].fecha_vencimiento : null;
    if (fechaVencChk && fechaVencChk > getHoyVzla()) {
      alert('Esta Obligación vence el ' + fmtFecha(fechaVencChk) + ' -- todavía no se puede aprobar, se habilitará automáticamente en esa fecha.');
      return;
    }
    const montoMax = await _resolverMontoMaxAprobacionSesion();
    if (montoMax != null && montoCxP != null && montoCxP > montoMax) {
      alert('Esta Obligación ($' + montoCxP.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + ') supera el monto máximo que su Nivel de Firma puede aprobar ($' + montoMax.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + '). Debe ser aprobada por un Nivel de Firma superior.');
      return;
    }
    // Autoaprobación (el mismo Usuario creó la Obligación y también es
    // quien la aprueba) -- no tiene sentido decirle que "recibirá una
    // notificación", ya lo sabe porque lo está haciendo él mismo.
    window._esAutoaprobacionCxP = !!(rowsChk && rowsChk[0] && rowsChk[0].id_usuario === sesionActual?.correo_usuario);
  } catch(eChkMonto) { console.warn('Error validando monto máximo de aprobación:', eChkMonto); }
  const msgConfirmAprob = window._esAutoaprobacionCxP
    ? '¿Aprobar esta solicitud de pago?'
    : '¿Aprobar esta solicitud de pago? El operador que la generó recibirá una notificación para proceder a Registrar el Pago.';
  if (!confirm(msgConfirmAprob)) return;
  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=id_usuario,numero_doc,observaciones,concepto');
    if (!rows || !rows[0]) return;
    const c = rows[0];

    // La aprobación NO genera el asiento contable ni marca PAGADA -- eso
    // ocurre después, cuando el operador Registra el Pago (ver
    // contGuardarPagoCxp). Aquí solo se autoriza a seguir adelante.
    await api('cont_cxp','PATCH',{
      estado: 'APROBADA',
      aprobado_por: sesionActual?.correo_usuario || null,
      fecha_aprobacion: new Date().toISOString()
    },'?id_cxp=eq.'+id_cxp);

    // ── Si esta CxP venía RECHAZADA (Entrada EN_REVISION) y se aprobó
    // directamente sin pasar por "corregir", igual resuelve la revisión ──
    const mNumDocAprob = /^ENT-(\d+)/.exec(c.numero_doc || '');
    if (mNumDocAprob) {
      const id_entradaAprob = parseInt(mNumDocAprob[1]);
      try {
        await api('stock_entradas','PATCH',{ estado_revision: null },'?id_entrada=eq.'+id_entradaAprob);
        const notifsRevAprob = await api('notificaciones','GET',null,
          '?estado=eq.PENDIENTE&datos_extra=ilike.*%22id_entrada%22%3A'+id_entradaAprob+'*&select=id');
        for (const nAprob of (notifsRevAprob||[])) {
          await api('notificaciones','PATCH',{ estado: 'APROBADO', fecha_respuesta: new Date().toISOString() },'?id=eq.'+nAprob.id);
        }
      } catch(eResAprob) { console.warn('Error resolviendo notificaciones de revisión:', eResAprob); }
    }

    // Notificar al operador que generó la solicitud -- salvo que sea la
    // misma persona que acaba de aprobar (autoaprobación), en cuyo caso no
    // hace falta notificarse a sí mismo.
    if (c.id_usuario && c.id_usuario !== sesionActual?.correo_usuario) {
      try {
        const infoCreadorAprob = await resolverCreadorCxP(c.id_usuario);
        await api('notificaciones','POST',{
          correo_destino: c.id_usuario,
          titulo: 'Solicitud de Pago Aprobada',
          mensaje: fmtCreadorCxP(infoCreadorAprob) + ': tu solicitud de pago "' + (c.concepto || c.numero_doc || '') + '" fue aprobada por ' + (sesionActual?.nombre || sesionActual?.correo_usuario || 'un supervisor') + '. Ya puedes proceder a Registrar el Pago.',
          estado: 'PENDIENTE',
          fecha_creacion: new Date().toISOString(),
          datos_extra: JSON.stringify({ id_cxp: id_cxp, accion: 'registrar_pago' })
        }, '', true);
      } catch(eNotif) { console.warn('Error enviando notificación de aprobación:', eNotif); }
    }

    cargarPagos();
  } catch(e) { alert('Error al aprobar: '+msgErr(e)); console.error(e); }
}


async function rechazarPagoCxP(id_cxp) {
  if (!puedo('PAGOS','RECHAZAR')) { alert('Sin permiso para rechazar.'); return; }
  if (!(await tieneNivelMinimo(2))) { alert('Esta acción requiere Firma de Aprobación Nivel 1 o Nivel 2.'); return; }
  try {
    const rowsChkR = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=fecha_vencimiento');
    const fechaVencChkR = rowsChkR && rowsChkR[0] ? rowsChkR[0].fecha_vencimiento : null;
    if (fechaVencChkR && fechaVencChkR > getHoyVzla()) {
      alert('Esta Obligación vence el ' + fmtFecha(fechaVencChkR) + ' -- todavía no se puede rechazar, se habilitará automáticamente en esa fecha.');
      return;
    }
  } catch(eChkR) { console.warn('Error validando fecha de vencimiento:', eChkR); }

  const motivo = await new Promise(function(resolve) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    div.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:380px;width:90%">'
      + '<div style="font-size:15px;margin-bottom:16px;color:#e8e8e8;text-align:center">Rechazar Solicitud de Pago</div>'
      + '<label style="font-size:12px;color:#999;display:block;margin-bottom:4px">Motivo del rechazo *</label>'
      + '<textarea id="dlg-rechazo-motivo" rows="3" placeholder="Explique por qué se rechaza esta solicitud..." style="width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #444;background:#111;color:#e8e8e8;font-size:14px;margin-bottom:12px;resize:vertical;font-family:inherit"></textarea>'
      + '<div id="dlg-rechazo-err" style="color:#f87171;font-size:12px;margin-bottom:12px;display:none"></div>'
      + '<div style="display:flex;gap:12px;justify-content:center">'
      + '<button id="btn-confirm-si" style="background:#fc8181;border:none;color:#1a1a1a;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Rechazar</button>'
      + '<button id="btn-confirm-no" style="background:#333;border:1px solid #555;color:#e8e8e8;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Cancelar</button>'
      + '</div></div>';
    document.body.appendChild(div);
    const motivoEl = div.querySelector('#dlg-rechazo-motivo');
    const errEl = div.querySelector('#dlg-rechazo-err');
    motivoEl.focus();
    const cerrar = function(valor) { document.body.removeChild(div); resolve(valor); };
    div.querySelector('#btn-confirm-si').onclick = function() {
      const val = motivoEl.value.trim();
      if (!val) { errEl.textContent = 'Ingrese el motivo del rechazo.'; errEl.style.display = 'block'; return; }
      cerrar(val);
    };
    div.querySelector('#btn-confirm-no').onclick = function() { cerrar(null); };
  });
  if (!motivo) return;

  try {
    const rows = await api('cont_cxp','GET',null,'?id_cxp=eq.'+id_cxp+'&select=id_usuario,numero_doc,observaciones,concepto');
    if (!rows || !rows[0]) return;
    const c = rows[0];

    // NO se anula el asiento GASTO_MANUAL: lo que se rechaza es el
    // intento de pago, no la obligación en sí -- el gasto ya ocurrió y
    // sigue siendo válido. RECHAZADA es solo una etiqueta visible de que
    // ya se rechazó una vez -- se corrige igual que PENDIENTE (Editar) y
    // al guardar vuelve a PENDIENTE para una nueva revisión.
    await api('cont_cxp','PATCH',{
      estado: 'RECHAZADA',
      motivo_rechazo: motivo,
      aprobado_por: null
    },'?id_cxp=eq.'+id_cxp);

    // ── Si es una CxP automática de una Entrada de Stock (ENT-<id>...),
    // marcar esa Entrada como EN_REVISION para que quede visible/insistente
    // hasta que se corrija o se anule -- evita que quede "huérfana" (stock
    // y asiento ya aplicados, pero la obligación rechazada sin resolver).
    let id_entradaRech = null;
    const mNumDocRech = /^ENT-(\d+)/.exec(c.numero_doc || '');
    if (mNumDocRech) {
      id_entradaRech = parseInt(mNumDocRech[1]);
      try {
        await api('stock_entradas','PATCH',{ estado_revision: 'EN_REVISION' },'?id_entrada=eq.'+id_entradaRech);
      } catch(eRevRech) { console.warn('Error marcando Entrada en revisión:', eRevRech); }
    }

    // Notificar al operador que generó la solicitud
    if (c.id_usuario) {
      try {
        const infoCreadorRech = await resolverCreadorCxP(c.id_usuario);
        await api('notificaciones','POST',{
          correo_destino: c.id_usuario,
          titulo: 'Solicitud de Pago Rechazada',
          mensaje: fmtCreadorCxP(infoCreadorRech) + ': tu solicitud de pago "' + (c.concepto || c.numero_doc || '') + '" fue rechazada por ' + (sesionActual?.nombre || sesionActual?.correo_usuario || 'un supervisor') + '. Motivo: ' + motivo,
          estado: 'PENDIENTE',
          fecha_creacion: new Date().toISOString(),
          datos_extra: JSON.stringify({ id_cxp: id_cxp, accion: 'ver_rechazo', id_entrada: id_entradaRech })
        }, '', true);
      } catch(eNotif) { console.warn('Error enviando notificación de rechazo:', eNotif); }
    }

    cargarPagos();
  } catch(e) { alert('Error: '+msgErr(e)); }
}

// ══════════════════════════════════════════════════════════════
//  EJECUTAR PAGO — CxP AUTOMÁTICA (Inventario)
// ══════════════════════════════════════════════════════════════

var _ejecutarPagoCxPId = null; // id_cxp actual

async function ejecutarPagoCxP(id_cxp) {
  _ejecutarPagoCxPId = id_cxp;

  const refExecEl = document.getElementById('exec-pago-ref');
  if (refExecEl) refExecEl.value = '';
  const archivoExecReset = document.getElementById('exec-pago-archivo');
  if (archivoExecReset) archivoExecReset.value = '';

  // Cargar datos de la CxP + Proveedor (con datos bancarios de su ficha)
  const rows = await api('cont_cxp','GET',null,
    '?id_cxp=eq.'+id_cxp+'&select=*,cuenta_gasto:id_cuenta_gasto(id_cuenta,codigo,nombre),'
    +'proveedores:id_proveedor(nombre,rif,tipo_contribuyente,moneda_facturacion,id_banco,tipo_cuenta,numero_cuenta,pm_id_banco,pm_ci,pm_celular,metodos_pago_tipos,banco_prov:id_banco(nombre),banco_pm:pm_id_banco(nombre))');
  const c = rows && rows[0];
  if (!c) { alert('CxP no encontrada.'); return; }
  const prov = c.proveedores || {};

  // Cargar cuentas bancarias
  try {
    const ctas = (await obtenerCuentasContables()).filter(function(c){
      return c.codigo && c.codigo.indexOf('1.1.01') === 0 && c.estado === 'ACTIVA' && c.permite_movimiento === true;
    }).sort(function(a,b){ return a.codigo.localeCompare(b.codigo); });
    const sel = document.getElementById('exec-pago-cuenta-banco');
    if (sel) sel.innerHTML = '<option value="">— Seleccionar cuenta —</option>'
      + (ctas||[]).map(function(ct){
          return '<option value="'+ct.id_cuenta+'">'+ct.codigo+' — '+ct.nombre+'</option>';
        }).join('');
  } catch(e) {}

  // Resetear campos
  const cuentaCont = document.getElementById('exec-pago-cuenta-cont');
  if (cuentaCont) cuentaCont.style.display = 'none';
  const cuentaHidden = document.getElementById('exec-pago-cuenta-banco');
  if (cuentaHidden) cuentaHidden.value = '';
  const viaSel0 = document.getElementById('exec-pago-via');
  if (viaSel0) { viaSel0.innerHTML = ''; viaSel0.value = ''; }
  const viaCont0 = document.getElementById('exec-pago-via-cont');
  if (viaCont0) viaCont0.style.display = 'none';
  // El desglose (Base/IVA/Total/IGTF) se recalcula y repinta siempre que
  // se abre el modal o se cambia la Moneda de Pago (_renderDesglosePagoEjecutar).
  const btnConf = document.getElementById('btn-confirmar-pago');
  if (btnConf) { btnConf.disabled = false; btnConf.textContent = '💳 Confirmar Pago'; }
  document.getElementById('alerta-exec-err').style.display = 'none';

  // Moneda de Pago -- select editable. Se sugiere por defecto lo YA
  // CONGELADO en la CxP (c.moneda_pago) -- es el mejor punto de partida
  // conocido -- pero el Usuario puede cambiarla libremente aquí, porque la
  // decisión real de en qué Moneda pagar se toma recién en este momento
  // (puede ser distinta a lo que se pensaba cuando se creó la Obligación).
  window._execPagoCxP = c;
  const monedaCxP = c.moneda_pago || prov.moneda_facturacion || 'USD';
  const monedaSelEl = document.getElementById('exec-pago-moneda');
  if (monedaSelEl) monedaSelEl.value = (monedaCxP === 'VES') ? 'VES' : 'USD';

  // Buscar tasa vigente para mostrar equivalente
  // Ambos montos (USD y VES) ya están congelados en la CxP -- no se
  // recalcula con la tasa de hoy.
  const montoUSDShow = parseFloat(c.saldo_usd) || parseFloat(c.monto_usd || 0);
  const montoVESShow = parseFloat(c.saldo_ves) || parseFloat(c.monto_ves || 0) || (montoUSDShow * (_tasaVigente || 1));

  document.getElementById('exec-pago-desc').textContent  = fmtNumeroDoc(c.numero_doc) + ' — ' + (c.observaciones||'').replace(/^Cuota\s+\d+\/\d+\s*[—\-]\s*/i,'').replace(/^Contado\s*[—\-]\s*/i,'').trim();

  // MONTO FACTURACIÓN -- lo que realmente factura el Proveedor, en la
  // Moneda de NEGOCIACIÓN (fija, histórica) -- NO depende de la Moneda de
  // Pago elegida más abajo, que puede ser otra.
  const monedaNegFact = (c.moneda_negociacion || 'USD').toUpperCase();
  const totalNegFact = monedaNegFact === 'VES' ? montoVESShow : montoUSDShow;
  const montoFactEl = document.getElementById('exec-pago-monto-facturacion');
  if (montoFactEl) montoFactEl.textContent = (monedaNegFact === 'VES' ? 'Bs. ' : '$ ') + totalNegFact.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2});

  const facturaNoEl = document.getElementById('exec-pago-factura-no');
  if (facturaNoEl) facturaNoEl.value = c.numero_factura_proveedor || '';

  // Proveedor, RIF y Fecha de Pago -- vienen del Modal Obligación de Pago
  const provEl = document.getElementById('exec-pago-proveedor');
  if (provEl) provEl.textContent = prov.nombre || '—';
  const rifEl = document.getElementById('exec-pago-rif');
  if (rifEl) rifEl.textContent = prov.rif || '—';
  const tipoContribLabel = { ORDINARIO: 'Contribuyente Ordinario', ESPECIAL: 'Contribuyente Especial', FORMAL: 'Contribuyente Formal' };
  const tipoContribEl = document.getElementById('exec-pago-tipo-contrib');
  if (tipoContribEl) tipoContribEl.textContent = tipoContribLabel[prov.tipo_contribuyente] || '—';
  const fechaObEl = document.getElementById('exec-pago-fecha-obligacion');
  if (fechaObEl) fechaObEl.textContent = c.fecha_vencimiento ? fmtFecha(c.fecha_vencimiento) : '—';

  // Se guarda el proveedor para que la info de pago (Transferencia/Pago
  // Móvil) se muestre según el Método de Pago que se seleccione abajo,
  // no de forma estática independiente de la selección.
  window._execPagoProv = prov;
  [document.getElementById('exec-pago-banco-info'), document.getElementById('exec-pago-pm-info'), document.getElementById('exec-pago-manual-info')]
    .forEach(function(el){ if (el) el.style.display = 'none'; });

  // Resolver Método de Pago y Cuenta Contable automáticamente -- ya no se
  // pregunta: el Método de Pago viene fijo de la ficha del Proveedor
  // (metodos_pago_tipos), combinado con la Moneda de la CxP.
  await _resolverMetodoPagoEjecucion(monedaCxP, prov);
  await _renderDesglosePagoEjecutar();

  abrirModal('modal-ejecutar-pago');
}

const METODO_PAGO_LABELS = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', AFILIACION_BANCARIA: 'Afiliación Bancaria' };

// Se dispara al cambiar la Moneda de Pago en Ejecutar Pago -- recalcula
// todo lo que depende de ella: el monto principal mostrado, si corresponde
// preguntar IGTF, y el Método de Pago/Cuenta Contable sugeridos (pueden
// cambiar de Caja a Banco, o de USD a Bs, según la Moneda elegida).
async function onCambiarMonedaEjecPago() {
  const c = window._execPagoCxP;
  const prov = window._execPagoProv;
  if (!c) return;
  const monedaCxP = document.getElementById('exec-pago-moneda')?.value || 'USD';

  await _resolverMetodoPagoEjecucion(monedaCxP, prov);
  await _renderDesglosePagoEjecutar();
}

async function _resolverMetodoPagoEjecucion(moneda, prov) {
  const selTipoMetodo = document.getElementById('exec-pago-metodo-tipo');
  const sinCuentaCont = document.getElementById('exec-pago-sin-cuenta-cont');
  window._execPagoMoneda = moneda;
  window._execPagoProv = prov;

  const tiposAceptados = (prov && Array.isArray(prov.metodos_pago_tipos)) ? prov.metodos_pago_tipos : [];
  if (selTipoMetodo) {
    selTipoMetodo.innerHTML = tiposAceptados.map(function(t) {
      return '<option value="'+t+'">'+(METODO_PAGO_LABELS[t] || t)+'</option>';
    }).join('');
  }
  if (sinCuentaCont) sinCuentaCont.style.display = 'none';

  if (!tiposAceptados.length) {
    if (sinCuentaCont) {
      sinCuentaCont.style.display = '';
      sinCuentaCont.querySelector('.alerta')?.replaceChildren(document.createTextNode('Este proveedor no tiene ningún Método de Pago configurado en su ficha. Edítelo antes de continuar.'));
    }
    _actualizarInfoPagoProveedor();
    return;
  }

  await onCambiarTipoMetodoEjecPago();
}

// Se dispara al abrir el modal (con el primer Método aceptado por el
// Proveedor ya seleccionado) o al cambiar manualmente la selección --
// resuelve la Cuenta Contable para la combinación Moneda + Método elegido.
async function onCambiarTipoMetodoEjecPago() {
  const metodoHidden  = document.getElementById('exec-pago-metodo');
  const cuentaCont    = document.getElementById('exec-pago-cuenta-cont');
  const cuentaDisplay = document.getElementById('exec-pago-cuenta-display');
  const cuentaHidden  = document.getElementById('exec-pago-cuenta-banco');
  const sinCuentaCont = document.getElementById('exec-pago-sin-cuenta-cont');
  const selTipoMetodo = document.getElementById('exec-pago-metodo-tipo');
  const moneda = window._execPagoMoneda || 'USD';

  const tipoMetodo = selTipoMetodo?.value || '';
  window._execPagoTipoMetodo = tipoMetodo;

  if (metodoHidden) metodoHidden.value = '';
  if (cuentaCont) cuentaCont.style.display = 'none';
  if (cuentaHidden) cuentaHidden.value = '';
  if (sinCuentaCont) sinCuentaCont.style.display = 'none';

  if (!tipoMetodo) { _actualizarInfoPagoProveedor(); return; }

  try {
    const metodos = await api('param_metodos_pago','GET',null,
      '?codigo=eq.'+moneda+'&tipo_canal=eq.'+tipoMetodo+'&estado=eq.ACTIVO&limit=1&select=id_metodo,id_cuenta_contable' + emisorQ());
    const m = metodos && metodos[0];
    if (m && m.id_cuenta_contable) {
      const cta = (await obtenerCuentasContables()).find(function(c){ return c.id_cuenta === m.id_cuenta_contable; });
      if (metodoHidden) metodoHidden.value = m.id_metodo;
      if (cuentaHidden) cuentaHidden.value = m.id_cuenta_contable;
      if (cuentaDisplay) cuentaDisplay.textContent = cta ? (cta.codigo + ' — ' + cta.nombre) : '—';
      if (cuentaCont) cuentaCont.style.display = '';
    } else if (sinCuentaCont) {
      sinCuentaCont.style.display = '';
      sinCuentaCont.querySelector('.alerta')?.replaceChildren(document.createTextNode('No hay una Cuenta Contable configurada en Parámetros → Métodos de Pago para esta combinación de Moneda + Método de Pago. Configúrela antes de continuar.'));
    }
  } catch(e) {
    if (sinCuentaCont) sinCuentaCont.style.display = '';
  }

  _actualizarInfoPagoProveedor();
}


// Arma el desglose de "Pago a Ejecutar" -- Base (Inventario/Costo), IVA
// (16%), Total Facturado, y si aplica IGTF (USD + Proveedor Contribuyente
// Especial + no resuelto de antes): IGTF y Total final. Siempre en la
// Moneda de Pago elegida (no en la de Negociación -- esa es "Monto
// Facturación", arriba, y no cambia con esta selección).
async function _renderDesglosePagoEjecutar() {
  const c = window._execPagoCxP;
  const prov = window._execPagoProv;
  const cont = document.getElementById('exec-pago-desglose');
  if (!c || !cont) return;

  const monedaCxP = document.getElementById('exec-pago-moneda')?.value || 'USD';
  const esUSD = monedaCxP !== 'VES';
  const fechaPago = c.fecha_vencimiento?.slice(0,10) || (getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10));

  // Total en la Moneda de Pago -- según cuál sea la Moneda de
  // NEGOCIACIÓN (la deuda real):
  //   - Misma Moneda -- sin conversión, usar el monto congelado directo.
  //   - Deuda real en Bs (negociado VES), pagada en USD -- se convierte
  //     con la tasa de HOY. Sin diferencial (el Bs nunca cambia).
  //   - Deuda real en USD (negociado USD), pagada en Bs -- se recalcula
  //     con la tasa de HOY. SÍ hay diferencial cambiario.
  const monedaNeg = (c.moneda_negociacion || 'USD').toUpperCase();
  let total, diferencial = 0;
  if (monedaNeg === monedaCxP) {
    total = monedaCxP === 'VES' ? parseFloat(c.saldo_ves || c.monto_ves || 0) : parseFloat(c.saldo_usd || c.monto_usd || 0);
  } else {
    let tasaPago = 1;
    try {
      const tasasD = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaPago+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
      tasaPago = parseFloat(tasasD && tasasD[0] ? tasasD[0].tipo_cambio : 1) || 1;
    } catch(eTasaD) {}
    if (monedaNeg === 'VES') {
      total = parseFloat((parseFloat(c.monto_ves || 0) / tasaPago).toFixed(2));
    } else {
      const montoVESOriginal = parseFloat(c.monto_ves || 0);
      total = parseFloat((parseFloat(c.saldo_usd || c.monto_usd || 0) * tasaPago).toFixed(2));
      diferencial = parseFloat((total - montoVESOriginal).toFixed(2));
    }
  }

  const { tasaIVA, tasaIGTF } = await _obtenerTributos(fechaPago);
  const exento = c.exento_iva === true;
  const base = exento ? total : parseFloat((total / (1 + tasaIVA)).toFixed(2));
  const iva  = exento ? 0 : parseFloat((total - base).toFixed(2));

  const igtfYaResuelto = c.aplica_igtf !== null && c.aplica_igtf !== undefined;
  const aplicaIGTF = esUSD && !igtfYaResuelto && prov?.tipo_contribuyente === 'ESPECIAL';
  const igtf = aplicaIGTF ? parseFloat((total * tasaIGTF).toFixed(2)) : 0;
  const totalFinal = parseFloat((total + igtf).toFixed(2));

  const simbolo = esUSD ? '$' : 'Bs.';
  const fmt = function(n) { return simbolo + ' ' + n.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}); };

  cont.innerHTML =
    '<table style="width:100%;font-size:12px;border-collapse:collapse">'
    + '<tr><td style="padding:4px 0;color:var(--suave)">Base (Inventario/Costo)</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono)">'+fmt(base)+'</td></tr>'
    + (!exento ? '<tr><td style="padding:4px 0;color:var(--suave)">IVA ('+(tasaIVA*100).toFixed(0)+'%)</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono)">'+fmt(iva)+'</td></tr>' : '')
    + '<tr style="border-top:1px solid var(--borde)"><td style="padding:4px 0;font-weight:600">Total Facturado</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-weight:600">'+fmt(total)+'</td></tr>'
    + (Math.abs(diferencial) > 0.01 ? '<tr><td style="padding:4px 0;font-size:11px;color:'+(diferencial>0?'#f87171':'#22c55e')+'">↳ '+(diferencial>0?'Pérdida':'Ganancia')+' Cambiaria (vs. Bs '+fmtBs(parseFloat(c.monto_ves||0))+' al negociar)</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-size:11px;color:'+(diferencial>0?'#f87171':'#22c55e')+'">'+fmt(Math.abs(diferencial))+'</td></tr>' : '')
    + (aplicaIGTF ? (
        '<tr><td style="padding:4px 0;color:var(--suave)">IGTF ('+(tasaIGTF*100).toFixed(0)+'%) — 6.1.04.003</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono)">'+fmt(igtf)+'</td></tr>'
        + '<tr style="border-top:1px solid var(--borde)"><td style="padding:4px 0;font-weight:700;color:var(--naranja)">Total</td><td style="padding:4px 0;text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--naranja)">'+fmt(totalFinal)+'</td></tr>'
      ) : '')
    + '</table>';
}

function _actualizarInfoPagoProveedor() {
  const tipoCanal = window._execPagoTipoMetodo || '';
  const prov = window._execPagoProv || {};
  const viaContEl    = document.getElementById('exec-pago-via-cont');
  const viaSelEl     = document.getElementById('exec-pago-via');
  const bancoInfoEl  = document.getElementById('exec-pago-banco-info');
  const bancoDatosEl = document.getElementById('exec-pago-banco-datos');
  const pmInfoEl     = document.getElementById('exec-pago-pm-info');
  const pmDatosEl    = document.getElementById('exec-pago-pm-datos');
  const manualInfoEl = document.getElementById('exec-pago-manual-info');
  [viaContEl, bancoInfoEl, pmInfoEl, manualInfoEl].forEach(function(el){ if (el) el.style.display = 'none'; });

  if (tipoCanal !== 'TRANSFERENCIA') return; // Efectivo, Afiliación Bancaria, etc. -- no se muestra nada

  const tieneBanco = !!prov.id_banco;
  const tienePM    = !!prov.pm_id_banco;

  if (tieneBanco && tienePM) {
    // El proveedor tiene ambas vías -- dejar elegir cuál
    if (viaContEl) viaContEl.style.display = '';
    if (viaSelEl && !viaSelEl.options.length) {
      viaSelEl.innerHTML = '<option value="">— Seleccione —</option>'
        + '<option value="BANCO">🏦 Cuenta Bancaria</option>'
        + '<option value="PM">📱 Pago Móvil</option>';
    }
    const via = viaSelEl?.value || '';
    if (via === 'BANCO' && bancoDatosEl) {
      bancoDatosEl.innerHTML = dato('Institución', prov.banco_prov?.nombre||'—') + dato('Tipo', prov.tipo_cuenta||'—') + dato('N° Cuenta', fmtNumCuenta(prov.numero_cuenta), true);
      if (bancoInfoEl) bancoInfoEl.style.display = '';
    } else if (via === 'PM' && pmDatosEl) {
      pmDatosEl.innerHTML = dato('Banco', prov.banco_pm?.nombre||'—') + dato('C.I./R.I.F', prov.pm_ci||'—') + dato('Celular', prov.pm_celular||'—');
      if (pmInfoEl) pmInfoEl.style.display = '';
    }
  } else if (tieneBanco && bancoDatosEl) {
    bancoDatosEl.innerHTML = dato('Institución', prov.banco_prov?.nombre||'—') + dato('Tipo', prov.tipo_cuenta||'—') + dato('N° Cuenta', fmtNumCuenta(prov.numero_cuenta), true);
    if (bancoInfoEl) bancoInfoEl.style.display = '';
  } else if (tienePM && pmDatosEl) {
    pmDatosEl.innerHTML = dato('Banco', prov.banco_pm?.nombre||'—') + dato('C.I./R.I.F', prov.pm_ci||'—') + dato('Celular', prov.pm_celular||'—');
    if (pmInfoEl) pmInfoEl.style.display = '';
  } else if (manualInfoEl) {
    manualInfoEl.style.display = '';
  }
}

async function _obtenerTributos(fecha) {
  if (fecha) {
    const [tasaIVAFecha, tasaIGTFFecha] = await Promise.all([
      tributoVigenteEnFecha('IVA', fecha),
      tributoVigenteEnFecha('IGTF', fecha)
    ]);
    if (tasaIVAFecha != null || tasaIGTFFecha != null) {
      return {
        tasaIVA:  tasaIVAFecha  != null ? tasaIVAFecha  : 0.16,
        tasaIGTF: tasaIGTFFecha != null ? tasaIGTFFecha : 0.03
      };
    }
    // Si no se encontró ningún registro <= fecha, cae al comportamiento
    // anterior (más reciente ACTIVO) como último recurso.
  }
  const [ivaRows, igtfRows] = await Promise.all([
    api('param_tributos','GET',null,'?codigo=eq.IVA&estado=eq.ACTIVO&order=fecha_registro.desc&limit=1&select=alicuota'),
    api('param_tributos','GET',null,'?codigo=eq.IGTF&estado=eq.ACTIVO&order=fecha_registro.desc&limit=1&select=alicuota')
  ]);
  return {
    tasaIVA:  parseFloat(ivaRows  && ivaRows[0]  ? ivaRows[0].alicuota  : 16) / 100,
    tasaIGTF: parseFloat(igtfRows && igtfRows[0] ? igtfRows[0].alicuota : 3)  / 100
  };
}

function _calcularTributos(montoTotal, tasaIGTF, aplicaIGTF) {
  // El IGTF siempre se suma ADICIONAL sobre el monto completo de la CxP --
  // nunca "viene incluido" en lo facturado por el Proveedor (por Ley debe
  // mostrarse siempre por separado, en el momento de pagar en divisas).
  if (!aplicaIGTF) return { base: montoTotal, igtf: 0, total: montoTotal };
  const igtf = parseFloat((montoTotal * tasaIGTF).toFixed(4));
  return { base: montoTotal, igtf, total: parseFloat((montoTotal + igtf).toFixed(4)) };
}

async function confirmarEjecucionPago() {
  const id_cxp   = _ejecutarPagoCxPId;
  const idMetodo    = document.getElementById('exec-pago-metodo')?.value;
  const idCtaBanco  = parseInt(document.getElementById('exec-pago-cuenta-banco')?.value) || 0;
  const errEl = document.getElementById('alerta-exec-err');
  const btnConf = document.getElementById('btn-confirmar-pago');
  const resetBtn = function() { if (btnConf) { btnConf.disabled = false; btnConf.textContent = '💳 Confirmar Pago'; } };
  errEl.style.display = 'none';

  if (!puedo('PAGOS','PAGAR') && !sesionActual?.administrador) { errEl.textContent = 'No tiene permiso para procesar pagos.'; errEl.style.display = 'block'; resetBtn(); return; }

  if (!idMetodo)    { errEl.textContent = 'Seleccione el método de pago.';          errEl.style.display = 'block'; resetBtn(); return; }
  if (!idCtaBanco)  { errEl.textContent = 'El método seleccionado no tiene cuenta contable asignada.'; errEl.style.display = 'block'; resetBtn(); return; }

  // Validar Vía de Pago obligatoria si está visible (proveedor con ambas
  // vías registradas -- Cuenta Bancaria y Pago Móvil -- debe elegir una)
  const viaContVis = document.getElementById('exec-pago-via-cont');
  if (viaContVis && viaContVis.style.display !== 'none') {
    const viaSeleccionada = document.getElementById('exec-pago-via')?.value;
    if (!viaSeleccionada) {
      errEl.textContent = 'Debe seleccionar la Vía de Pago.';
      errEl.style.display = 'block';
      document.getElementById('exec-pago-via')?.focus();
      resetBtn();
      return;
    }
  }

  const refExec = document.getElementById('exec-pago-ref')?.value || '';
  if (!refExec.trim()) {
    errEl.textContent = 'Debe ingresar el número de referencia o comprobante.';
    errEl.style.display = 'block';
    document.getElementById('exec-pago-ref')?.focus();
    resetBtn();
    return;
  }

  const facturaNoExec = document.getElementById('exec-pago-factura-no')?.value || '';
  if (!facturaNoExec.trim()) {
    errEl.textContent = 'Debe ingresar el N° de Factura del Proveedor.';
    errEl.style.display = 'block';
    document.getElementById('exec-pago-factura-no')?.focus();
    resetBtn();
    return;
  }

  try {
    // 1. Cargar CxP -- Fecha de Pago y Moneda vienen de aquí, de solo lectura
    const rows = await api('cont_cxp','GET',null,
      '?id_cxp=eq.'+id_cxp+'&select=*,cuenta_gasto:id_cuenta_gasto(id_cuenta,codigo,nombre),proveedores:id_proveedor(nombre,tipo_contribuyente,metodos_pago_tipos)');
    const c = rows && rows[0];
    if (!c) throw new Error('CxP no encontrada.');
    // Sincronizar con lo que el Usuario acaba de escribir en el formulario
    // -- si no, las descripciones del asiento (más abajo) seguirían
    // usando lo que ya estaba guardado (vacío en un primer pago), en vez
    // de lo que se acaba de capturar en esta misma pantalla.
    c.numero_factura_proveedor = document.getElementById('exec-pago-factura-no')?.value?.trim() || null;

    const fechaPago  = c.fecha_vencimiento?.slice(0,10) || (getHoyVzla ? getHoyVzla() : new Date().toISOString().slice(0,10));
    // Moneda de Pago -- la que quedó seleccionada en pantalla (puede haber
    // sido corregida manualmente); si el select no llegó a existir por
    // algún motivo, cae a la guardada en la CxP.
    const monedaCxP  = document.getElementById('exec-pago-moneda')?.value || c.moneda_pago || 'USD';
    const esUSD      = monedaCxP !== 'VES';
    const montoVESCxP = parseFloat(c.monto_ves || 0);
    const montoUSDCxP = parseFloat(c.saldo_usd || c.monto_usd || 0);

    // Buscar tasa de compra desde BD usando fecha_emision de la CxP
    let tasaCompra = parseFloat(c.tasa_bcv_compra || c.tasa_bcv || 0);
    if (!tasaCompra || tasaCompra === 1) {
      try {
        const fechaEmision = c.fecha_emision?.slice(0,10) || fechaPago;
        const tasaRows = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaEmision+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
        if (tasaRows && tasaRows[0]) tasaCompra = parseFloat(tasaRows[0].tipo_cambio);
      } catch(e) {}
    }

    // Verificar si aplica IGTF -- solo USD + proveedor Contribuyente
    // Especial. El IGTF YA NO se hornea nunca al crear la Obligación (ni
    // Entrada ni CxP manual) -- depende de cómo se termine pagando, y eso
    // puede cambiar entre que se crea y que se paga. Por eso siempre se
    // calcula fresco aquí, en el momento real del pago (aplica_igtf en la
    // CxP se queda en NULL desde que se crea, a propósito).
    const igtfYaResuelto = c.aplica_igtf !== null && c.aplica_igtf !== undefined;
    const aplicaIGTF = esUSD && !igtfYaResuelto && c.proveedores?.tipo_contribuyente === 'ESPECIAL';

    // 2. Obtener tasa BCV del día de pago
    const tasasHoy = await api('tasas','GET',null,'?fecha_valor=lte.'+fechaPago+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio');
    const tasaPago = parseFloat(tasasHoy && tasasHoy[0] ? tasasHoy[0].tipo_cambio : tasaCompra);

    // La Moneda de NEGOCIACIÓN determina cuál es la deuda REAL (la que no
    // cambia de valor). Si se paga en esa misma Moneda, no hay conversión
    // ni diferencial. Si se paga en la Moneda contraria:
    //   - Deuda real en USD, pagada en Bs -- el Bs SÍ se recalcula con la
    //     tasa de HOY, y SÍ hay diferencial cambiario (la deuda en
    //     dólares vale distinto en Bs según el día).
    //   - Deuda real en Bs, pagada en USD -- el Bs nunca cambia de valor,
    //     solo se determina cuántos dólares hacen falta hoy. NO hay
    //     diferencial (no es que la deuda "cambió de valor").
    const monedaNeg = (c.moneda_negociacion || 'USD').toUpperCase();
    let montoUSD, montoVESPago, diferencial = 0;
    if (monedaNeg === monedaCxP) {
      // Misma Moneda de Negociación y de Pago -- no hace falta ninguna
      // conversión. montoUSD es directamente el ya congelado en la CxP
      // (nunca se recalcula con la tasa de hoy aquí -- si se hiciera,
      // el "monto pagado" quedaría en una tasa distinta a la que se usó
      // para congelar monto_usd al negociar, dejando un saldo falso).
      montoUSD = montoUSDCxP;
      montoVESPago = montoVESCxP;
    } else if (monedaNeg === 'VES') {
      montoUSD = parseFloat((montoVESCxP / (tasaPago || 1)).toFixed(2));
      montoVESPago = montoVESCxP;
    } else {
      montoUSD = montoUSDCxP;
      montoVESPago = (tasaPago === tasaCompra) ? montoVESCxP : parseFloat((montoUSDCxP * tasaPago).toFixed(2));
      diferencial = parseFloat((montoVESPago - montoVESCxP).toFixed(2));
    }
    const montoVESCompra = montoVESCxP;

    // Corregir la CxP con los montos REALES a la fecha de pago -- si la
    // deuda real es en Bs (monedaNeg='VES'), lo que se corrige es el
    // monto_usd/saldo_usd (era la estimación); si la deuda real es en USD,
    // el monto_usd/saldo_usd YA era el real, lo que se corrige es el
    // monto_ves (era la estimación al negociar, la tasa de hoy es la real).
    if (monedaNeg !== monedaCxP) {
      try {
        const patchCorrCxp = { tasa_bcv: tasaPago, monto_ves: montoVESPago };
        if (monedaNeg === 'VES') { patchCorrCxp.monto_usd = montoUSD; patchCorrCxp.saldo_usd = montoUSD; }
        await api('cont_cxp','PATCH', patchCorrCxp, '?id_cxp=eq.'+id_cxp);
        c.monto_ves = montoVESPago;
        c.tasa_bcv = tasaPago;
        if (monedaNeg === 'VES') { c.monto_usd = montoUSD; c.saldo_usd = montoUSD; }
      } catch(eCorrCxp) { console.warn('Error corrigiendo montos reales de la CxP:', eCorrCxp); }
    }

    // 3. IGTF -- el IVA ya no se toca aquí, se contabilizó al crear la Obligación de Pago
    const { tasaIGTF } = await _obtenerTributos(fechaPago);
    const { igtf, total } = igtfYaResuelto
      ? { igtf: 0, total: montoUSD }
      : _calcularTributos(montoUSD, tasaIGTF, aplicaIGTF);

    // 4. Obtener cuentas contables por código
    const _todasCtasPagoEjec = await obtenerCuentasContables();
    const buscarCta = function(cod){ return _todasCtasPagoEjec.find(function(c){ return c.codigo === cod; }) || null; };
    const idCtaIGTF       = buscarCta('6.1.04.003')?.id_cuenta || null;
    const idCtaPerdCambio = buscarCta('6.2.01.003')?.id_cuenta || null;
    const idCtaGanCambio  = buscarCta('4.2.01.003')?.id_cuenta || null;
    const idCtaCxP        = buscarCta('2.1.01.001')?.id_cuenta || null;

    // 6. Crear asiento contable
    const numAst = await _siguienteNumeroAsiento();
    await api('cont_asientos','POST',{
      id_empresa:     _empresaActiva?.id_empresa || null,
      numero_asiento: numAst,
      tipo:           'PAGO_CXP',
      fecha:          fechaPago,
      estado:         'APROBADO',
      moneda_base:    'VES',
      tasa_bcv:       tasaPago,
      referencia:     c.numero_doc,
      descripcion:    (function() {
        const numDoc = c.numero_doc || '';
        const obs    = (c.observaciones || '').replace(/^Cuota\s+\d+\/\d+\s*[—\-]\s*/i,'').replace(/^Contado\s*[—\-]\s*/i,'').trim();
        const cuotaM = numDoc.match(/ENT-(\d+)-C(\d+)/);
        const entM   = numDoc.match(/^ENT-(\d+)(?:-\d+)?$/);
        if (cuotaM) return 'Cuota ' + cuotaM[2] + ' — Pago compra Inventario ENT-' + cuotaM[1];
        if (entM)   return 'Pago contado Inventario ENT-' + entM[1];
        return obs || ('Pago ' + (c.proveedores?.nombre || numDoc));
      })(),
      id_usuario:     sesionActual?.correo_usuario
    });
    // Obtener id_asiento recién creado
    const astRows = await api('cont_asientos','GET',null,
      '?numero_asiento=eq.'+encodeURIComponent(numAst)+emisorQ()+'&select=id_asiento&limit=1');
    const idAst = astRows && astRows[0] ? astRows[0].id_asiento : null;

    if (idAst) {
      let orden = 1;

      // Pre-calcular todos los montos en BS con redondeo a 2 decimales
      const r2 = function(v) { return parseFloat(v.toFixed(2)); };
      const cxpVES    = montoVESCompra;
      const igtfVES   = r2(igtf * tasaPago);
      const bancoUSD  = total;
      // Si la CxP ya está en VES, usar el monto exacto directamente -- NO
      // recalcular convirtiendo VES→USD→VES, porque ese redondeo de ida y
      // vuelta reintroducía centavos de diferencia contra la CxP (mismo tipo
      // de bug ya corregido antes en la creación de la CxP).
      // Cuando la Moneda de Pago SÍ difiere (o hay IGTF), bancoVES se arma
      // como cxpVES + diferencial -- así el Asiento SIEMPRE cuadra exacto,
      // incluso cuando la diferencia es de apenas 1 centavo (muy chica para
      // que se le cree su propia línea de "Diferencia Cambiaria" más abajo,
      // pero igual tiene que quedar reflejada en algún lado para que Debe y
      // Haber coincidan).
      const bancoVES  = (monedaCxP === 'VES' && igtf === 0 && diferencial === 0) ? cxpVES : r2(cxpVES + igtfVES + diferencial);

      const numDoc2 = c.numero_doc || '';
      const cuotaM2 = numDoc2.match(/ENT-(\d+)-C(\d+)/);
      const entM2   = numDoc2.match(/^ENT-(\d+)(?:-\d+)?$/);
      const descBase = cuotaM2 ? ('Cuota ' + cuotaM2[2] + ' — Inventario ENT-' + cuotaM2[1])
                     : entM2   ? ('Contado — Inventario ENT-' + entM2[1])
                     : ((c.observaciones||'').replace(/^Cuota\s+\d+\/\d+\s*[—\-]\s*/i,'').replace(/^Contado\s*[—\-]\s*/i,'').trim() || numDoc2);

      const numFacturaRefAst = c.numero_factura_proveedor || numDoc2;
      const idEntAst = cuotaM2 ? cuotaM2[1] : (entM2 ? entM2[1] : null);
      const refEntAst = idEntAst ? ('ENT-' + idEntAst) : numDoc2;
      const sufijoPagoAst = ' N° Factura ' + numFacturaRefAst + ' (' + refEntAst + ') Ref. Pago ' + (refExec || '');

      const linea = async function(id_cta, debeUSD, haberUSD, debeVES, haberVES, desc) {
        await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: id_cta, orden: orden++,
          debe_usd: r2(debeUSD), haber_usd: r2(haberUSD),
          debe_ves: r2(debeVES), haber_ves: r2(haberVES), tasa_bcv: tasaPago,
          descripcion: desc || null
        });
      };

      // Rebajar la CxP contra Banco/Efectivo -- el IVA y el Gasto/Costo ya se
      // contabilizaron al crear la Obligación de Pago, aquí no se repiten.
      // DEBE: 2.1.01.001 CxP Proveedores
      if (idCtaCxP)  await linea(idCtaCxP, montoUSD, 0, cxpVES, 0, 'Pago' + sufijoPagoAst);
      // DEBE: 6.1.04.003 IGTF -- se genera en el momento del pago
      if (idCtaIGTF && igtf > 0) await linea(idCtaIGTF, igtf, 0, igtfVES, 0, 'Gasto IGTF pago' + sufijoPagoAst);
      // Diferencial Cambiario — solo en BS
      if (Math.abs(diferencial) > 0.01) {
        if (diferencial > 0 && idCtaPerdCambio)
          await linea(idCtaPerdCambio, 0, 0, Math.abs(diferencial), 0, 'Pérdida cambiaria — ' + descBase);
        else if (diferencial < 0 && idCtaGanCambio)
          await linea(idCtaGanCambio,  0, 0, 0, Math.abs(diferencial), 'Ganancia cambiaria — ' + descBase);
      }
      // HABER: Banco/Efectivo
      if (idCtaBanco) await linea(idCtaBanco, 0, bancoUSD, 0, bancoVES, 'Egreso por Pago' + sufijoPagoAst);
    }

    // 7. Actualizar CxP -- redondeado a 2 decimales (precisión real de
    // moneda), mismo motivo que en Registrar Pago: evitar que un residuo
    // de centésimas de centavo (por divisiones Bs/tasa) marque PARCIAL
    // algo que ya quedó pagado completo.
    const nuevoPagado = parseFloat((parseFloat(c.pagado_usd||0) + montoUSD).toFixed(2));
    const nuevoSaldo  = parseFloat(Math.max(0, parseFloat(c.monto_usd||0) - nuevoPagado).toFixed(2));
    const nuevoEstado = nuevoSaldo <= 0 ? 'PAGADA' : 'PARCIAL';

    // Subir comprobante si se adjuntó archivo (opcional)
    let urlComprobanteExec = null;
    const archivoExecEl = document.getElementById('exec-pago-archivo');
    if (archivoExecEl && archivoExecEl.files && archivoExecEl.files[0]) {
      try {
        urlComprobanteExec = await subirFoto(archivoExecEl.files[0], 'comprobantes/' + id_cxp);
      } catch(eFileExec) { console.warn('Error subiendo comprobante:', eFileExec); }
    }

    const patchFinalExec = {
      estado:      nuevoEstado,
      pagado_usd:  nuevoPagado,
      saldo_usd:   nuevoSaldo,
      fecha_pago:  fechaPago,
      metodo_pago: idMetodo,
      tasa_bcv:    tasaPago,
      referencia:  refExec.trim(),
      via_pago:    document.getElementById('exec-pago-via')?.value || null,
      // Si se corrigió la Moneda de Pago en este modal, persistirla para
      // que el registro quede reflejando la realidad de aquí en adelante
      moneda_pago: monedaCxP,
      numero_factura_proveedor: c.numero_factura_proveedor,
      pagado_por:  sesionActual?.correo_usuario || null
    };
    if (urlComprobanteExec) patchFinalExec.url_comprobante = urlComprobanteExec;
    await api('cont_cxp','PATCH', patchFinalExec, '?id_cxp=eq.'+id_cxp);

    cerrarModal('modal-ejecutar-pago');
    cerrarModal('modal-ver-cxp-auto');
    if (typeof cargarPagos === 'function') cargarPagos();

  } catch(err) {
    errEl.textContent = 'Error: ' + msgErr(err);
    errEl.style.display = 'block';
    resetBtn();
  }
}

async function _siguienteNumeroAsiento() {
  try {
    const rows = await api('cont_asientos','GET',null,
      '?id_empresa=eq.'+((_empresaActiva?.id_empresa)||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento');
    if (rows && rows[0]) {
      const last = rows[0].numero_asiento || 'AST-2026-0000';
      const n = parseInt(last.split('-').pop()) + 1;
      return 'AST-' + new Date().getFullYear() + '-' + String(n).padStart(4,'0');
    }
    return 'AST-' + new Date().getFullYear() + '-0001';
  } catch(e) { return 'AST-' + new Date().getFullYear() + '-0001'; }
}
