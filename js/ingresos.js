// ─── S&D Systems — Módulo: INGRESOS (Facturas + CxC) ───
// Renombrado desde facturacion.js el 2026-08-03

// ─── S&D Systems — Módulo: FACTURACION ───
// ══════════════════════════════════════════════════════════════
//  FASE 4 — FACTURAS
// ══════════════════════════════════════════════════════════════
let facturasCache = [];

const ESTADOS_FAC = {
  'BORRADOR': { clase: 'badge-gris',    label: 'Borrador'  },
  'EMITIDA':  { clase: 'badge-naranja', label: 'Pendiente' },
  'APROBADA': { clase: 'badge-verde',   label: 'Aprobada'  },
  'PAGADA':   { clase: 'badge-verde',   label: 'Cobrada'   },
};

// ── Verificar facultad de aprobación ──
let _facultadesAprobacion = null;
async function cargarFacultades() {
  if (_facultadesAprobacion) return;
  _facultadesAprobacion = {};
  if (!sesionActual) return;
  try {
    const rows = await api('usuario_aprobaciones','GET',null,
      '?id_usuario=eq.'+sesionActual.id_usuario+'&puede_aprobar=eq.true&select=modulo');
    rows.forEach(function(r){ _facultadesAprobacion[r.modulo] = true; });
  } catch(e) {}
}
function puedeAprobar(modulo) {
  if (sesionActual?.administrador) return true;
  return !!((_facultadesAprobacion||{})[modulo]);
}

async function renderFacturas() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('FACTURAS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  window._facBuscar       = '';
  window._facFechaDesde   = '';
  window._facFechaHasta   = '';
  window._facEstadoFiltro = '';
  // Alícuotas de tributos -- usa el cache global (correcto, con los códigos
  // reales IVA/IGTF), refrescado cada vez que se entra al módulo
  await cargarTasaIVAGlobal();
  window._facAlicuotaIVA  = tasaIVAActual()  * 100;
  window._facAlicuotaIGTF = tasaIGTFActual() * 100;
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando facturas...</div>';
  try {
    if (!usuariosCache || !usuariosCache.length) {
      try { usuariosCache = await api('usuarios','GET',null,'?select=id_usuario,correo_usuario,nombre') || []; } catch(eUsu) { usuariosCache = []; }
    }
    const [facturas, tasas] = await Promise.all([
      api('facturas','GET',null,'?order=fecha_emision.desc&select=*,emisores(nombre,rif),propietarios(nombre_completo,tipo_doc,numero_doc)'+emisorQ()),
      api('tasas','GET',null,'?moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    facturasCache = facturas;
    const tasaActual = tasas.length ? parseFloat(tasas[0].tipo_cambio) : 1;
    const resumen = {};
    Object.keys(ESTADOS_FAC).forEach(function(k) { resumen[k]=0; });
    facturas.forEach(function(f) { if (resumen[f.estado]!==undefined) resumen[f.estado]++; });
    const filas = facturas.map(function(f) {
      const est = ESTADOS_FAC[f.estado] || { clase:'badge-gris', label:f.estado };
      const prop   = f.propietarios;
      const vendedor = (usuariosCache.find(function(u) { return u.correo_usuario === f.id_usuario; }) || {}).nombre || f.id_usuario || '—';
      const identifCliente = prop ? ((prop.tipo_doc||'') + '-' + (prop.numero_doc||'')) : (f.receptor_rif || '');
      return '<tr data-id="' + f.id_factura + '">'
        + '<td><div style="font-family:var(--font-display);font-size:17px;color:var(--naranja)">' + (f.numero_factura||'—') + '</div>'
        + '<div style="font-size:11px;color:var(--suave)">' + (f.fecha_emision ? fmtFecha(f.fecha_emision) : '—') + '</div></td>'
        + '<td style="font-size:12px">' + vendedor + '</td>'
        + '<td style="font-size:12px">' + (prop ? prop.nombre_completo : (f.receptor_nombre||'—')) + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + identifCliente + '</div></td>'
        + '<td><span class="badge ' + est.clase + '">' + est.label + '</span></td>'
        + (puedo('FACTURAS','VER_TOTALES')
            ? '<td style="font-family:var(--font-mono)">'
              + (f.moneda_cobro==='VES'
                  ? '<span style="color:var(--naranja)">' + fmtBs(f.total_ves) + ' Bs</span><div style="font-size:10px;color:var(--suave)">$ ' + fmtUSD(f.total_usd) + '</div>'
                  : '<span style="color:var(--naranja)">$ ' + fmtUSD(f.total_usd) + '</span><div style="font-size:10px;color:var(--suave)">' + fmtBs(f.total_ves) + ' Bs</div>')
              + '</td>'
            : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
        + '<td><button class="btn-naranja" onclick="verFichaFactura(' + f.id_factura + ')">Ver</button>'
        + '</td>'
        + '</tr>';
    }).join('');
    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px">'
      + Object.entries(ESTADOS_FAC).map(function(entry) {
          return '<div class="tarjeta-stat" style="padding:16px">'
            + '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">' + entry[1].label + '</div>'
            + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + (resumen[entry[0]]||0) + '</div>'
            + '</div>';
        }).join('')
      + '<div class="tarjeta-stat" style="padding:16px"><div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Total</div>'
      + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + facturas.length + '</div></div></div>'
      + '<div class="panel"><div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Facturas</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">'
      + '<span style="font-size:11px;color:var(--suave)">Desde</span>'
      + '<input type="date" id="fac-fecha-desde" onchange="limpiarBuscarFac();window._facFechaDesde=this.value;filtrarTablaFacturas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:7px 10px;border-radius:5px;outline:none">'
      + '<span style="font-size:11px;color:var(--suave)">Hasta</span>'
      + '<input type="date" id="fac-fecha-hasta" onchange="limpiarBuscarFac();window._facFechaHasta=this.value;filtrarTablaFacturas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:7px 10px;border-radius:5px;outline:none">'
      + '</div>'
      + '<select id="fac-filtro-estado" onchange="limpiarBuscarFac();window._facEstadoFiltro=this.value;filtrarTablaFacturas()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + Object.entries(ESTADOS_FAC).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('')
      + '</select>'
      + '<input type="text" id="fac-buscar" placeholder="Buscar N° factura, cliente..." oninput="buscarFac(this.value)" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + (puedo('FACTURAS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevaFactura()">+ Nueva Factura<span id="badge-os-cerradas-fac"></span></button>' : '')
      + '</div></div>'
      + '<div class="tabla-container"><table id="fac-tabla"><thead><tr>'
      + '<th>N° / Fecha</th><th>Vendedor</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Acción</th>'
      + '</tr></thead><tbody id="fac-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay facturas registradas</td></tr>')
      + '</tbody></table></div></div>';
    // En segundo plano, sin bloquear el render principal -- revisa si hay
    // Órdenes de Servicio Cerradas sin Factura asociada, para hacer titilar
    // el botón "+ Nueva Factura" (mismo patrón que Entradas Rechazadas).
    revisarBadgeOSCerradas();
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(err) + '</div>';
  }
}

async function revisarBadgeOSCerradas() {
  const badgeEl = document.getElementById('badge-os-cerradas-fac');
  if (!badgeEl) return;
  if (!puedo('FACTURAS','CREAR')) { badgeEl.innerHTML = ''; return; }
  try {
    // Mismo criterio EXACTO que cargarOSParaFactura(): OS en estado CERRADA
    // que todavía no tienen una Factura activa (no ANULADA) asociada.
    const os = await api('ordenes_servicio','GET',null,'?estado=eq.CERRADA&select=id_orden'+emisorQ());
    if (!os || !os.length) { badgeEl.innerHTML = ''; return; }
    const facturadas = await api('facturas','GET',null,
      '?id_orden=not.is.null&estado=neq.ANULADA&select=id_orden'+emisorQ());
    const idsFacturadas = new Set((facturadas||[]).map(function(f){ return f.id_orden; }));
    const pendientes = os.filter(function(o){ return !idsFacturadas.has(o.id_orden); });
    badgeEl.innerHTML = pendientes.length
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fc8181;margin-left:6px;vertical-align:middle;animation:parpadeoAlerta 1.2s ease-in-out infinite" title="'+pendientes.length+' Orden(es) de Servicio Cerrada(s) sin facturar"></span>'
      : '';
  } catch(eBadgeOS) { console.warn('Error revisando badge de OS Cerradas sin facturar:', eBadgeOS); }
}


function filtrarTablaFacturas() {
  const estado = (document.getElementById('fac-filtro-estado')?.value || '').toUpperCase();
  const buscar = (document.getElementById('fac-buscar')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('fac-tbody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(function(tr) {
    const fId = parseInt(tr.dataset.id);
    const f   = facturasCache.find(function(x) { return x.id_factura === fId; });
    if (!f) { tr.style.display = 'none'; return; }
    const matchEstado = !estado || f.estado === estado;
    const desde    = window._facFechaDesde || '';
    const hasta    = window._facFechaHasta || '';
    const fechaFac = (f.fecha_emision || '').substring(0,10);
    const matchDesde  = !desde || fechaFac >= desde;
    const matchHasta  = !hasta || fechaFac <= hasta;
    const matchBuscar = !buscar || [f.numero_factura||'', f.receptor_nombre||'',
      f.emisores ? f.emisores.nombre : '', f.propietarios ? f.propietarios.nombre_completo : '']
      .some(function(s) { return s.toLowerCase().includes(buscar); });
    tr.style.display = matchEstado && matchDesde && matchHasta && matchBuscar ? '' : 'none';
  });
}

async function abrirNuevaFactura() {
  if (!puedo('FACTURAS','CREAR')) { alert('No tiene permiso para crear facturas.'); return; }
  // Alícuotas de tributos -- siempre se refrescan al abrir el formulario
  await cargarTasaIVAGlobal();
  window._facAlicuotaIVA  = tasaIVAActual()  * 100;
  window._facAlicuotaIGTF = tasaIGTFActual() * 100;
  let emisoresList = [], tasaActual = 1;
  try {
    const [em, ta] = await Promise.all([
      api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*'),
      api('tasas','GET',null,'?moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    emisoresList = em;
    tasaActual = ta.length ? parseFloat(ta[0].tipo_cambio) : 1;
  } catch(e) {}

  window._facSubtotalOS = 0;
  document.getElementById('fac-id').value            = '';
  document.getElementById('fac-numero').textContent  = 'Se asignará al emitir';
  document.getElementById('fac-os-id').value         = '';
  document.getElementById('fac-os-info').innerHTML   = '';
  document.getElementById('fac-os-sel').value        = '';
  document.getElementById('fac-lineas-cont').innerHTML = '';
  const contLineasOSInit = document.getElementById('fac-cont-lineas-os');
  if (contLineasOSInit) contLineasOSInit.style.display = 'none';
  const contSubtotalManualInit = document.getElementById('fac-cont-subtotal-manual');
  if (contSubtotalManualInit) contSubtotalManualInit.style.display = '';
  document.getElementById('fac-subtotal-manual').value      = '';
  document.getElementById('fac-receptor-nombre').value     = '';
  document.getElementById('fac-receptor-rif').value        = '';
  document.getElementById('fac-receptor-dir').value        = '';
  document.getElementById('fac-receptor-nombre').removeAttribute('readonly');
  document.getElementById('fac-receptor-rif').removeAttribute('readonly');
  document.getElementById('fac-receptor-dir').removeAttribute('readonly');
  document.getElementById('fac-receptor-tipo-contrib').value = '';
  document.getElementById('fac-receptor-tipo-contrib').disabled = false;
  // Sin Moneda por defecto -- el operador debe elegirla explícitamente
  // (mismo criterio que Método de Cobro: ninguna preselección que pueda
  // pasar desapercibida y quedar guardada por error).
  document.getElementById('fac-aplica-iva').checked        = true;
  document.getElementById('fac-aplica-igtf').checked       = false;
  document.getElementById('fac-moneda').value              = '';
  document.getElementById('fac-tasa').value                = tasaActual.toFixed(4);
  document.getElementById('fac-fecha').value               = getHoyVzla();
  document.getElementById('fac-estado').value              = 'BORRADOR';
  document.getElementById('fac-observaciones').value       = '';
  document.getElementById('alerta-fac-ok').style.display   = 'none';
  document.getElementById('alerta-fac-err').style.display  = 'none';
  document.getElementById('modal-fac-titulo').textContent  = 'NUEVA FACTURA';
  document.getElementById('fac-subtotal-os').textContent = '$ 0.00';

  const selEm = document.getElementById('fac-emisor');
  selEm.innerHTML = '<option value="">— Seleccionar empresa —</option>'
    + emisoresList.map(function(e) { return '<option value="' + e.id_empresa + '" data-tipo-contrib="' + (e.tipo_contribuyente||'') + '">' + e.nombre + ' (' + (e.rif||'') + ')</option>'; }).join('');
  // Preseleccionar empresa activa
  if (_empresaActiva) selEm.value = _empresaActiva.id_empresa;
  _aplicarReglaIGTFFactura();

  actualizarVisibilidadMonedaFactura();
  // Las Órdenes que se listan dependen SIEMPRE de la Empresa seleccionada
  // arriba -- nunca se muestran las de otra Empresa.
  await cargarOSParaFactura(parseInt(selEm.value)||null);

  calcularTotalesFactura();
  abrirModal('modal-factura');
  focusFirstField('modal-factura');
  setTimeout(function() { document.querySelector('#modal-factura .modal-body')?.scrollTo(0,0); }, 80);
}

// Carga las Órdenes de Servicio CERRADAS de una Empresa específica, en el
// select de Motivo -- nunca mezcla Órdenes de otra Empresa. idFacturaExcluir
// permite mantener disponible la propia OS de la Factura que se está
// editando, aunque ya tenga esa misma Factura asociada (de lo contrario
// desaparecería del listado al editar un Borrador).
async function cargarOSParaFactura(id_empresa, idFacturaExcluir) {
  const selOS = document.getElementById('fac-os-sel');
  if (!selOS) return;
  if (!id_empresa) {
    selOS.innerHTML = '<option value="">— Seleccione primero una Empresa —</option>';
    return;
  }
  selOS.innerHTML = '<option value="">— Cargando Órdenes —</option>';
  try {
    const os = await api('ordenes_servicio','GET',null,
      '?estado=eq.CERRADA&id_empresa=eq.'+id_empresa+'&select=id_orden,numero_os,fecha_entrada,total_usd,total_ves,estado,id_vehiculo,id_propietario,vehiculos(placa,marca,modelo),propietarios(nombre_completo,tipo_doc,numero_doc,tipo_contribuyente,direccion)&order=fecha_entrada.desc');
    let osDisponibles = os;
    try {
      const facturadas = await api('facturas','GET',null,
        '?id_orden=not.is.null&estado=neq.ANULADA&select=id_orden,id_factura&id_empresa=eq.'+id_empresa);
      const idsFacturadas = new Set(
        facturadas.filter(function(f){ return f.id_factura !== idFacturaExcluir; })
                  .map(function(f){ return f.id_orden; })
      );
      osDisponibles = os.filter(function(o){ return !idsFacturadas.has(o.id_orden); });
    } catch(e) {}
    selOS.innerHTML = '<option value="">— Seleccionar Orden —</option>'
      + osDisponibles.map(function(o) {
          const veh = o.vehiculos, prop = o.propietarios;
          return '<option value="' + o.id_orden + '">'
            + o.numero_os + ' [' + (o.estado||'') + '] — '
            + (veh ? veh.placa + ' ' + veh.marca + ' ' + veh.modelo : '')
            + (prop ? ' · ' + prop.nombre_completo : '') + '</option>';
        }).join('');
  } catch(e) {
    selOS.innerHTML = '<option value="">— Error cargando Órdenes —</option>';
  }
}

// Al cambiar la Empresa dentro del formulario: la Orden, el Cliente y las
// líneas pertenecían a la Empresa anterior, así que se limpian y se
// recarga la lista de Órdenes para la nueva Empresa seleccionada.
async function onCambiarEmpresaFactura() {
  const id_empresa = parseInt(document.getElementById('fac-emisor')?.value) || null;
  document.getElementById('fac-os-id').value = '';
  document.getElementById('fac-os-info').innerHTML = '';
  document.getElementById('fac-lineas-cont').innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Selecciona una Orden para cargar las líneas</div>';
  document.getElementById('fac-receptor-nombre').value = '';
  document.getElementById('fac-receptor-rif').value = '';
  document.getElementById('fac-receptor-dir').value = '';
  document.getElementById('fac-receptor-tipo-contrib').value = '';
  window._facSubtotalOS = 0; actualizarSubtotalOSLabel();
  _aplicarReglaIGTFFactura();
  calcularTotalesFactura();
  await cargarOSParaFactura(id_empresa);
}

async function onSelOSFactura() {
  const sel    = document.getElementById('fac-os-sel');
  const id_os   = parseInt(sel.value);
  const infoDiv = document.getElementById('fac-os-info');
  const linDiv  = document.getElementById('fac-lineas-cont');
  const contLineasOS = document.getElementById('fac-cont-lineas-os');
  const contSubtotalManual = document.getElementById('fac-cont-subtotal-manual');
  const camposReceptor = ['fac-receptor-nombre','fac-receptor-rif','fac-receptor-dir'];
  if (!id_os) {
    infoDiv.innerHTML = ''; linDiv.innerHTML = '';
    document.getElementById('fac-os-id').value = '';
    if (contLineasOS) contLineasOS.style.display = 'none';
    if (contSubtotalManual) contSubtotalManual.style.display = '';
    camposReceptor.forEach(function(idc) {
      const el = document.getElementById(idc);
      if (el) { el.removeAttribute('readonly'); el.value = ''; }
    });
    const tipoContribEl = document.getElementById('fac-receptor-tipo-contrib');
    if (tipoContribEl) { tipoContribEl.disabled = false; tipoContribEl.value = ''; }
    const subManualEl = document.getElementById('fac-subtotal-manual');
    if (subManualEl) subManualEl.value = '';
    window._facSubtotalOS = 0; actualizarSubtotalOSLabel(); calcularTotalesFactura(); return;
  }
  if (contLineasOS) contLineasOS.style.display = '';
  if (contSubtotalManual) contSubtotalManual.style.display = 'none';
  camposReceptor.forEach(function(idc) { const el = document.getElementById(idc); if (el) el.setAttribute('readonly', 'readonly'); });
  const tipoContribEl2 = document.getElementById('fac-receptor-tipo-contrib');
  if (tipoContribEl2) tipoContribEl2.disabled = true;
  document.getElementById('fac-os-id').value = id_os;
  linDiv.innerHTML = '<div class="loading" style="padding:16px"><div class="spinner"></div> Cargando líneas...</div>';
  try {
    const [linServ, linRep, osData] = await Promise.all([
      api('os_servicios','GET',null,'?id_orden=eq.'+id_os+'&select=*'),
      api('os_mercancias','GET',null,'?id_orden=eq.'+id_os+'&select=*'),
      api('ordenes_servicio','GET',null,'?id_orden=eq.'+id_os+'&select=*,vehiculos(placa,marca,modelo),propietarios(nombre_completo,tipo_doc,numero_doc,correo,telefono,direccion,tipo_contribuyente)'),
    ]);
    const o = osData[0]||{}, prop = o.propietarios, veh = o.vehiculos;
    if (prop) {
      document.getElementById('fac-receptor-nombre').value = prop.nombre_completo||'';
      document.getElementById('fac-receptor-rif').value    = (prop.tipo_doc&&prop.numero_doc) ? prop.tipo_doc+'-'+prop.numero_doc : '';
      document.getElementById('fac-receptor-dir').value    = prop.direccion||'';
      document.getElementById('fac-receptor-tipo-contrib').value = prop.tipo_contribuyente||'';
    }
    infoDiv.innerHTML = '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:10px 14px;margin-top:6px">'
      + '<div style="display:flex;gap:16px;flex-wrap:wrap">'
      + '<div><div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">OS</div><div style="font-weight:600;color:var(--naranja)">' + o.numero_os + '</div></div>'
      + (veh ? '<div><div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Vehículo</div><div>' + veh.placa + ' · ' + veh.marca + ' ' + veh.modelo + '</div></div>' : '')
      + (prop ? '<div><div style="font-size:9px;color:var(--suave);letter-spacing:1px;text-transform:uppercase">Propietario</div><div>' + prop.nombre_completo + '</div></div>' : '')
      + '</div></div>';

    var monedaLineas = document.getElementById('fac-moneda')?.value||'USD';
    var tasaReal     = parseFloat(document.getElementById('fac-tasa')?.value)||1;
    var esVESLineas  = monedaLineas==='VES';
    function fmtLin(usd) {
      const principal  = esVESLineas ? fmtBs(usd*tasaReal)+' Bs' : '$ '+fmtUSD(usd);
      const secundario = esVESLineas ? '$ '+fmtUSD(usd) : fmtBs(usd*tasaReal)+' Bs';
      return principal + '<div style="font-size:10px;color:var(--suave)">'+secundario+'</div>';
    }

    const todasLineas = [
      ...linServ.map(function(l) { return {tipo:'servicio',desc:l.descripcion,cant:l.cantidad,precio:l.precio_usd,subtotal:l.subtotal_usd}; }),
      ...linRep.map(function(l)  { return {tipo:'artículo', desc:l.descripcion,cant:l.cantidad,precio:l.precio_usd,subtotal:l.subtotal_usd}; }),
    ];

    if (!todasLineas.length) {
      linDiv.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0">Esta OS no tiene líneas.</div>';
    } else {
      linDiv.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
        + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">DESCRIPCIÓN</th>'
        + '<th style="text-align:center;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">TIPO</th>'
        + '<th style="text-align:center;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">' + (esVESLineas?'P/U Bs':'P/U USD') + '</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">' + (esVESLineas?'SUBTOTAL Bs':'SUBTOTAL') + '</th>'
        + '</tr></thead><tbody>'
        + todasLineas.map(function(l) {
            return '<tr>'
              + '<td style="padding:6px 0">' + l.desc + '</td>'
              + '<td style="text-align:center;padding:6px"><span class="badge ' + (l.tipo==='servicio'?'badge-naranja':'badge-gris') + '" style="font-size:11px">' + (l.tipo==='servicio'?'Serv.':'Rep.') + '</span></td>'
              + '<td style="text-align:center;padding:6px;font-family:var(--font-mono)">' + l.cant + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono)">' + fmtLin(l.precio) + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono);color:var(--naranja)">' + fmtLin(l.subtotal) + '</td>'
              + '</tr>';
          }).join('')
        + '</tbody></table>';
    }
    window._facSubtotalOS = parseFloat(o.total_usd||0);
    actualizarSubtotalOSLabel();
    calcularTotalesFactura();
  } catch(err) {
    linDiv.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(err) + '</div>';
  }
}

function actualizarSubtotalOSLabel() {
  const sub    = window._facSubtotalOS||0;
  const moneda = document.getElementById('fac-moneda')?.value||'USD';
  const tasa   = moneda==='VES' ? (parseFloat(document.getElementById('fac-tasa')?.value)||1) : 1;
  const el     = document.getElementById('fac-subtotal-os');
  if (el) el.textContent = moneda==='VES' ? fmtBs(sub*tasa)+' Bs' : '$ '+fmtUSD(sub);
}

// Solo ajusta qué campos se ven según la moneda (Tasa / IGTF) -- no toca
// los checkboxes de IVA/IGTF. La usa abrirEditarFactura() para respetar los
// valores reales ya guardados de la Factura, sin pisarlos con un default.
function actualizarVisibilidadMonedaFactura() {
  const moneda   = document.getElementById('fac-moneda')?.value||'VES';
  const esVES    = moneda==='VES';
  const tasaCont = document.getElementById('fac-tasa-cont');
  const igtfCont = document.getElementById('fac-igtf-cont');
  if (tasaCont) tasaCont.style.display = esVES ? 'block' : 'none';
  if (igtfCont) igtfCont.style.display = esVES ? 'none' : 'flex';
}

// Regla legal de IGTF en Facturas: si la Empresa emisora es Contribuyente
// Especial y la Moneda de Cobro no es VES, el IGTF es OBLIGATORIO por Ley
// (no una preferencia) -- se marca y se bloquea, el Usuario no puede
// desmarcarlo. Si la Empresa NO es Contribuyente Especial, no está
// autorizada a cobrar IGTF -- se apaga y también se bloquea, para que no lo
// pueda marcar por error. En VES no aplica de ningún modo (el contenedor ya
// se oculta aparte).
function _aplicarReglaIGTFFactura() {
  const selEm = document.getElementById('fac-emisor');
  const opt = selEm?.selectedOptions?.[0];
  const tipoContrib = opt?.dataset?.tipoContrib || '';
  const esEspecial = tipoContrib === 'ESPECIAL';
  const esVES = (document.getElementById('fac-moneda')?.value || 'VES') === 'VES';
  const igtfChk  = document.getElementById('fac-aplica-igtf');
  const igtfNota = document.getElementById('fac-igtf-obligatorio-nota');
  if (!igtfChk) return;
  const tipoLabelIGTF = { ORDINARIO: 'Contribuyente Ordinario', FORMAL: 'Contribuyente Formal' };
  if (esVES) {
    igtfChk.checked = false;
    igtfChk.disabled = false;
    if (igtfNota) igtfNota.style.display = 'none';
  } else if (esEspecial) {
    igtfChk.checked = true;
    igtfChk.disabled = true;
    if (igtfNota) { igtfNota.style.display = ''; igtfNota.textContent = 'Obligatorio por Ley — la Empresa es Contribuyente Especial.'; }
  } else {
    igtfChk.checked = false;
    igtfChk.disabled = true;
    if (igtfNota) {
      igtfNota.style.display = '';
      igtfNota.textContent = 'Por ser la Empresa un ' + (tipoLabelIGTF[tipoContrib] || 'Contribuyente no Especial') + ' no cobra IGTF.';
    }
  }
}

// Se dispara cuando el Usuario cambia la Moneda manualmente (onchange del
// select) -- además de la visibilidad, aplica los defaults acordados:
// VES -> IVA activado, IGTF no aplica. USD -> IVA activado, IGTF según la
// regla legal de _aplicarReglaIGTFFactura(). El Usuario puede modificar el
// IVA después; el IGTF no, cuando la regla lo determina obligatorio o
// prohibido.
function onCambiarMonedaFactura() {
  actualizarVisibilidadMonedaFactura();
  const ivaChk  = document.getElementById('fac-aplica-iva');
  if (ivaChk) ivaChk.checked = true;
  _aplicarReglaIGTFFactura();
  actualizarSubtotalOSLabel();
  var id_os = document.getElementById('fac-os-id')?.value;
  if (id_os) onSelOSFactura(); else calcularTotalesFactura();
}

function calcularTotalesFactura() {
  const ivaLbl = document.getElementById('fac-iva-label');
  if (ivaLbl) ivaLbl.textContent = 'IVA (' + Math.round(tasaIVAActual()*100) + '%)';
  const igtfLbl = document.getElementById('fac-igtf-label');
  if (igtfLbl) igtfLbl.textContent = 'IGTF (' + Math.round(tasaIGTFActual()*100) + '%)';
  const subtotal = window._facSubtotalOS||0;
  const moneda   = document.getElementById('fac-moneda')?.value||'USD';
  // Tasa BCV real -- SIEMPRE se lee, sin importar la Moneda de la Factura.
  // Antes, para Facturas en USD, se fijaba en 1 literal (en vez de la tasa
  // real ya cargada en el campo al abrir el formulario), así que
  // total_ves terminaba guardándose igual al total en USD -- un valor sin
  // sentido, no un equivalente real en Bs. Eso rompía el cálculo de
  // diferencial cambiario al momento de cobrar (comparaba contra "tasa
  // original = 1", generando una "ganancia en cambio" falsa y gigantesca).
  const tasa     = parseFloat(document.getElementById('fac-tasa')?.value)||1;
  const aplIVA   = document.getElementById('fac-aplica-iva')?.checked;
  const aplIGTF  = document.getElementById('fac-aplica-igtf')?.checked;
  const esVES    = moneda==='VES';
  const iva    = aplIVA  ? subtotal*tasaIVAActual() : 0;
  const base   = subtotal+iva;
  const igtf   = aplIGTF ? base*tasaIGTFActual() : 0;
  const total  = base+igtf;
  const totVes = parseFloat((total*tasa).toFixed(2));
  function fmt(usd) { return esVES ? fmtBs(usd*tasa)+' Bs' : '$ '+fmtUSD(usd); }
  // Formato DUAL -- Moneda de Cobro como principal, y debajo el
  // equivalente en la Moneda contraria (mismo patrón que la Ficha de
  // Factura, verFichaFactura/fmtFDual).
  function fmtDual(usd, tamPrincipal, colorPrincipal) {
    const principal = esVES ? fmtBs(usd*tasa)+' Bs' : '$ '+fmtUSD(usd);
    const secundario = esVES ? '$ '+fmtUSD(usd) : fmtBs(usd*tasa)+' Bs';
    return '<div style="font-family:var(--font-mono);font-size:'+(tamPrincipal||'13px')+';'+(colorPrincipal?'color:'+colorPrincipal+';':'')+'">'+principal+'</div>'
      + '<div style="font-family:var(--font-mono);font-size:10px;color:var(--suave);margin-top:1px">'+secundario+'</div>';
  }
  const el = document.getElementById('fac-totales');
  if (!el) return;
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;padding:14px 0">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:13px"><span style="color:var(--suave)">Subtotal</span><div style="text-align:right">' + fmtDual(subtotal) + '</div></div>'
    + (aplIVA  ? '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:13px"><span style="color:var(--suave)">IVA (' + Math.round(tasaIVAActual()*100) + '%)</span><div style="text-align:right">' + fmtDual(iva) + '</div></div>' : '')
    + (aplIGTF ? '<div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:13px"><span style="color:var(--suave)">IGTF (' + Math.round(tasaIGTFActual()*100) + '%)</span><div style="text-align:right">' + fmtDual(igtf) + '</div></div>' : '')
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-top:1px solid var(--borde);padding-top:8px;margin-top:4px">'
    + '<span style="font-family:var(--font-display);font-size:16px;letter-spacing:1px">TOTAL</span>'
    + '<div style="text-align:right">' + fmtDual(total, '22px', 'var(--naranja)') + '</div>'
    + '</div></div>';
  window._facTotales = { subtotal, iva, igtf, total, totVes, moneda, tasa };
}

async function guardarFactura(emitir) {
  // Protección contra doble clic
  if (window._facturaProcesando) return;
  window._facturaProcesando = true;
  const btnGuardar = document.getElementById(emitir ? 'btn-fac-emitir' : 'btn-fac-borrador');
  const btnGuardarTextoOriginal = btnGuardar ? btnGuardar.textContent : (emitir ? '✓ Emitir Factura' : 'Guardar Borrador');
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = '⏳ Procesando...'; }

  const okEl  = document.getElementById('alerta-fac-ok');
  const errEl = document.getElementById('alerta-fac-err');
  okEl.style.display='none'; errEl.style.display='none';

  // El try/finally garantiza que la bandera _facturaProcesando y el botón
  // SIEMPRE se liberan, sea cual sea la salida (validación fallida, error
  // de red, o éxito) -- antes, varios "return" tempranos se saltaban ese
  // reseteo y dejaban ambos botones bloqueados hasta recargar la página.
  try {
    const id       = document.getElementById('fac-id').value;
    const id_os     = parseInt(document.getElementById('fac-os-id').value)||null;
    const id_emisor = parseInt(document.getElementById('fac-emisor').value)||null;
    const recNom   = document.getElementById('fac-receptor-nombre').value.trim();
    const recRif   = document.getElementById('fac-receptor-rif').value.trim();
    const recDir   = document.getElementById('fac-receptor-dir').value.trim();
    const tasa     = parseFloat(document.getElementById('fac-tasa').value)||1;
    const fecha    = document.getElementById('fac-fecha').value;
    const estadoActual = document.getElementById('fac-estado').value;

    if (emitir && estadoActual === 'BORRADOR' && !puedeAprobar('FACTURAS')) {
      errEl.textContent = 'Esta factura requiere aprobación antes de emitirse.';
      errEl.style.display = 'block';
      return;
    }
    const estado   = emitir ? 'EMITIDA' : 'BORRADOR';
    const obs      = document.getElementById('fac-observaciones').value.trim();
    const aplIVA   = document.getElementById('fac-aplica-iva').checked;
    const aplIGTF  = document.getElementById('fac-aplica-igtf').checked;
    if (!id_emisor) { errEl.textContent='Debe seleccionar una Empresa.';           errEl.style.display='block'; return; }
    const monedaSel = document.getElementById('fac-moneda')?.value;
    if (!monedaSel) { errEl.textContent='Debe seleccionar la Moneda de Cobro.';    errEl.style.display='block'; return; }
    if (!recNom)   { errEl.textContent='El nombre del cliente es obligatorio.';   errEl.style.display='block'; return; }
    if (!fecha)    { errEl.textContent='La fecha es obligatoria.';                errEl.style.display='block'; return; }
    if (!id_os && (!window._facSubtotalOS || window._facSubtotalOS <= 0)) {
      errEl.textContent='El Subtotal debe ser mayor a 0.'; errEl.style.display='block'; return;
    }
    const tot = window._facTotales||{subtotal:0,iva:0,igtf:0,total:0,totVes:0};
    let idProp = null;
    if (id_os) {
      try { const os=await api('ordenes_servicio','GET',null,'?id_orden=eq.'+id_os+'&select=id_propietario'); if(os.length) idProp=os[0].id_propietario; } catch(e) {}
    }

    const datos = {
      id_orden:id_os, id_empresa:id_emisor, id_propietario:idProp,
      receptor_nombre:recNom, receptor_rif:recRif||null, receptor_direccion:recDir||null,
      receptor_tipo_contribuyente:document.getElementById('fac-receptor-tipo-contrib')?.value||null,
      moneda_cobro:document.getElementById('fac-moneda')?.value||'VES',
      fecha_emision:fecha, estado,
      aplica_iva:aplIVA, aplica_igtf:aplIGTF,
      subtotal_usd:tot.subtotal, iva_usd:tot.iva, igtf_usd:tot.igtf,
      total_usd:tot.total, total_ves:tot.totVes, tasa_bcv:tot.tasa||tasa,
      observaciones:obs||null, id_usuario:sesionActual.correo_usuario
    };

    // idFacturaFinal: id real de la Factura ya guardada -- antes se
    // intentaba "adivinar" cuál factura se acababa de crear con un GET
    // separado por nombre de receptor+fecha, lo cual era frágil (podía
    // traer la fila equivocada si dos facturas coincidían). Ahora se toma
    // directamente de la respuesta del PATCH/POST.
    let idFacturaFinal = id ? parseInt(id) : null;

    if (id) {
      await api('facturas','PATCH',datos,'?id_factura=eq.'+id);
    } else {
      // Verificar que la OS no tenga ya una factura activa (solo aplica
      // si esta Factura está vinculada a una OS)
      if (id_os) {
        const osFacturada = await api('facturas','GET',null,
          '?id_orden=eq.'+id_os+'&estado=neq.ANULADA&select=id_factura,numero_factura');
        if (osFacturada && osFacturada.length) {
          errEl.textContent = 'Esta OS ya tiene una factura activa: ' + osFacturada[0].numero_factura;
          errEl.style.display = 'block';
          return;
        }
      }
      const anio=new Date().getFullYear();
      const existentes=await api('facturas','GET',null,'?select=numero_factura&numero_factura=like.FAC-'+anio+'-*&order=numero_factura.desc&limit=1');
      let seq=1;
      if (existentes.length) { const p=existentes[0].numero_factura.split('-'); seq=parseInt(p[p.length-1])+1; }
      datos.numero_factura='FAC-'+anio+'-'+String(seq).padStart(4,'0');
      const nuevaRows = await api('facturas','POST',datos);
      idFacturaFinal = (nuevaRows && nuevaRows[0]) ? nuevaRows[0].id_factura : null;
    }

    // Si se emite: crear CxC, asiento contable, salida de inventario y
    // asiento de Costo de Venta -- toda esa lógica vive en una sola función
    // reutilizable (también la usa emitirFactura() en la Ficha de Factura).
    if (emitir && idFacturaFinal) {
      await generarCxCyAsientoFactura(idFacturaFinal);
    }

    okEl.textContent = emitir ? '✓ Factura emitida correctamente.' : '✓ Factura guardada como borrador.';
    okEl.style.display='block';
    setTimeout(function() { cerrarModal('modal-factura'); renderFacturas(); }, 1200);
  } catch(err) {
    errEl.textContent='Error: '+msgErr(err); errEl.style.display='block';
  } finally {
    window._facturaProcesando = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = btnGuardarTextoOriginal; }
  }
}

// Crea la CxC, el asiento contable de la Factura, y (si la OS tenía
// Mercancía) la salida de Inventario + asiento de Costo de Venta. Se llama
// tanto al emitir directamente desde el formulario (guardarFactura) como al
// emitir después un Borrador ya guardado desde la Ficha (emitirFactura) --
// antes esta segunda vía no generaba nada de esto.
async function generarCxCyAsientoFactura(idFactura) {
  const _tg0 = Date.now();
  const _tglog = function(etiqueta) { console.log('[generarCxCyAsientoFactura] ' + etiqueta + ' — ' + (Date.now()-_tg0) + 'ms desde el inicio'); };
  try {
    _tglog('inicio');
    const facRows = await api('facturas','GET',null,'?id_factura=eq.'+idFactura+'&select=*');
    const fac = facRows && facRows[0];
    if (!fac) return;

    // Protección: si por algún motivo ya existe una CxC activa para esta
    // Factura (doble llamada), no duplicar.
    const yaExiste = await api('cont_cxc','GET',null,'?id_factura=eq.'+idFactura+'&estado=neq.ANULADA&select=id_cxc&limit=1');
    if (yaExiste && yaExiste.length) return;

    // Si la Factura no viene de una Orden de Servicio, puede venir de una
    // Venta directa (mostrador) -- se detecta buscando en `ventas` por
    // id_factura (no se agrega columna nueva a `facturas` para esto, ya
    // que `ventas.id_factura` ya apunta hacia acá una vez facturada).
    let ventaOrigen = null;
    if (!fac.id_orden) {
      try {
        const ventaRows = await api('ventas','GET',null,'?id_factura=eq.'+idFactura+'&select=id_venta,id_area');
        ventaOrigen = ventaRows && ventaRows[0] ? ventaRows[0] : null;
      } catch(eVentaOrigen) { console.warn('Error buscando Venta de origen de la factura:', eVentaOrigen); }
    }

    // 1. Crear registro CxC
    try {
      await api('cont_cxc','POST',{
        tipo:           'FACTURA',
        id_propietario: fac.id_propietario,
        id_factura:     fac.id_factura,
        numero_doc:     fac.numero_factura,
        fecha_emision:  fac.fecha_emision,
        monto_usd:      fac.total_usd,
        monto_ves:      fac.total_ves || 0,
        tasa_bcv:       fac.tasa_bcv || 1,
        saldo_usd:      fac.total_usd,
        estado:         'PENDIENTE',
        moneda_cobro:   fac.moneda_cobro || 'VES',
        id_empresa:      fac.id_empresa || null,
        id_usuario:     sesionActual.correo_usuario
      });
    } catch(eCxc) { console.warn('Error creando CxC:', eCxc); }
    _tglog('CxC creada');

    // 2. Crear asiento contable
    try {
      const anioAst = new Date().getFullYear();
      const existAst = await api('cont_asientos','GET',null,
        '?numero_asiento=like.AST-'+anioAst+'-*&id_empresa=eq.'+(fac.id_empresa||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
      let seqAst = 1;
      if (existAst.length) { const pa = existAst[0].numero_asiento.split('-'); seqAst = parseInt(pa[pa.length-1]) + 1; }
      const numAst = 'AST-'+anioAst+'-'+String(seqAst).padStart(4,'0');

      const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_empresa=eq.'+(fac.id_empresa||0));
      const id_periodo = periodos.length ? periodos[0].id_periodo : null;

      let tasaReal = fac.tasa_bcv || 1;
      try {
        const tasasBCV = await api('tasas','GET',null,
          '?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
        tasaReal = tasasBCV.length ? parseFloat(tasasBCV[0].tipo_cambio) : (fac.tasa_bcv || 1);
      } catch(eTasa) {}

      const asiento = await api('cont_asientos','POST',{
        numero_asiento: numAst,
        fecha:          fac.fecha_emision,
        descripcion:    'Factura '+fac.numero_factura+' — '+(fac.receptor_nombre||''),
        tipo:           'AUTOMATICO',
        referencia:     fac.numero_factura,
        // moneda_base -- SIEMPRE la Moneda Funcional de la Empresa, no la
        // Moneda de Cobro de la Factura -- mismo criterio ya corregido en
        // Pago/Cobro/Asiento Manual (nada se puede ocultar contablemente).
        moneda_base:    ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(),
        tasa_bcv:       tasaReal,
        id_periodo:     id_periodo,
        id_empresa:      fac.id_empresa || null,
        estado:         'APROBADO',
        id_usuario:     sesionActual.correo_usuario
      });

      if (asiento && asiento[0]) {
        const idAst = asiento[0].id_asiento;
        const _todasCtasFac = await obtenerCuentasContables();
        const cuentas = _todasCtasFac.filter(function(c){ return ['1.1.03.001','4.1.01.001','4.1.02.001','2.1.03.001'].includes(c.codigo); });
        const cCxC     = cuentas.find(function(c){ return c.codigo==='1.1.03.001'; });
        const cIngServ = cuentas.find(function(c){ return c.codigo==='4.1.01.001'; });
        const cIngRep  = cuentas.find(function(c){ return c.codigo==='4.1.02.001'; });
        const cIVA     = cuentas.find(function(c){ return c.codigo==='2.1.03.001'; });

        // Desglosar el subtotal entre Servicios Realizados y Artículos
        // Utilizados, tomando el detalle real de la OS de origen -- antes
        // todo (servicios + artículos) se contabilizaba de golpe en la
        // cuenta de Servicios (4.1.01.001), aunque incluyera venta de
        // Mercancía, que debe ir a Ingreso por Ventas (4.1.02.001).
        let totalServ = fac.subtotal_usd || 0;
        let totalArt = 0;
        if (fac.id_orden) {
          try {
            const [servRows, mercRows] = await Promise.all([
              api('os_servicios','GET',null,'?id_orden=eq.'+fac.id_orden+'&select=subtotal_usd'),
              api('os_mercancias','GET',null,'?id_orden=eq.'+fac.id_orden+'&select=subtotal_usd'),
            ]);
            totalServ = (servRows||[]).reduce(function(a,r){ return a + (parseFloat(r.subtotal_usd)||0); }, 0);
            totalArt  = (mercRows||[]).reduce(function(a,r){ return a + (parseFloat(r.subtotal_usd)||0); }, 0);
          } catch(eDesglose) {
            console.warn('No se pudo desglosar Servicios/Artículos, todo va a Ingresos por Servicios:', eDesglose);
            totalServ = fac.subtotal_usd || 0; totalArt = 0;
          }
        } else if (ventaOrigen) {
          // Una Venta directa (mostrador) es siempre 100% Artículos -- nunca
          // hay Servicios en este flujo, así que no hace falta prorratear.
          totalServ = 0;
          totalArt  = fac.subtotal_usd || 0;
        }

        let cIGTF = fac.igtf_usd > 0
          ? (_todasCtasFac.find(function(c){ return c.estado === 'ACTIVO' && /igtf.*por.*pagar/i.test(c.nombre||''); }) || null)
          : null;
        if (!cIGTF && fac.igtf_usd > 0) {
          cIGTF = _todasCtasFac.find(function(c){ return c.codigo === '2.1.03.004'; }) || null;
        }

        const auxFac = ' (USD × '+tasaReal.toFixed(4)+')';
        if (cCxC) await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: cCxC.id_cuenta, orden: 1,
          descripcion: 'CxC '+fac.numero_factura+auxFac,
          debe_usd: fac.total_usd, haber_usd: 0,
          debe_ves: fac.total_ves, haber_ves: 0
        });
        if (cIngServ && totalServ > 0) await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: cIngServ.id_cuenta, orden: 2,
          descripcion: 'Ingreso por Servicios Realizados '+fac.numero_factura+auxFac,
          debe_usd: 0, haber_usd: totalServ,
          debe_ves: 0, haber_ves: totalServ * tasaReal
        });
        if (cIngRep && totalArt > 0) await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: cIngRep.id_cuenta, orden: 3,
          descripcion: 'Ingreso por Venta de Artículos '+fac.numero_factura+auxFac,
          debe_usd: 0, haber_usd: totalArt,
          debe_ves: 0, haber_ves: totalArt * tasaReal
        });
        if (cIVA && fac.iva_usd > 0) await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: cIVA.id_cuenta, orden: 4,
          descripcion: 'IVA '+fac.numero_factura+auxFac,
          debe_usd: 0, haber_usd: fac.iva_usd,
          debe_ves: 0, haber_ves: fac.iva_usd * tasaReal
        });
        if (cIGTF && fac.igtf_usd > 0) await api('cont_asiento_lineas','POST',{
          id_asiento: idAst, id_cuenta: cIGTF.id_cuenta, orden: 5,
          descripcion: 'IGTF '+fac.numero_factura+auxFac,
          debe_usd: 0, haber_usd: fac.igtf_usd,
          debe_ves: 0, haber_ves: fac.igtf_usd * tasaReal
        });
      }
    } catch(eAst) { console.warn('Error creando asiento:', eAst); }
    _tglog('asiento contable creado -- entrando a stock/salida');

    // 3. Registrar en el Historial la salida por venta (si la OS tenía Mercancía)
    // -- OJO: esto es SOLO informativo para el Historial de Stock. El stock
    // real de Taller YA se rebajó cuando se asignó el Artículo a la OS (ver
    // _guardarOSInterno en ordenes.js); NO se debe volver a tocar
    // inventario_stock_area aquí, o quedaría descontado dos veces.
    if (fac.id_orden) {
      try {
        const reps = await api('os_mercancias','GET',null,'?id_orden=eq.'+fac.id_orden+'&select=id_articulo,cantidad');
        const correo = sesionActual?.correo_usuario;

        // El Área a mostrar en el Historial es la del Taller que cerró la
        // OS (su creador) -- NO la del usuario que está facturando ahora,
        // que puede ser de otra Área (Facturación/Compras) sin relación
        // con dónde salió físicamente el Artículo.
        const osRow = await api('ordenes_servicio','GET',null,'?id_orden=eq.'+fac.id_orden+'&select=id_usuario');
        const correoTaller = osRow && osRow[0] ? osRow[0].id_usuario : null;
        const empRes = correoTaller ? await api('empleados','GET',null,
          '?correo=eq.'+encodeURIComponent(correoTaller)+'&select=id_empleado,id_area&limit=1') : [];
        const id_areaEmp = empRes?.[0]?.id_area || null;
        const idEmpEmp  = empRes?.[0]?.id_empleado || null;

        let tasaCOGS = _tasaVigente || 1;
        try {
          const tasasCOGS = await api('tasas','GET',null,
            '?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
          if (tasasCOGS && tasasCOGS[0]) tasaCOGS = parseFloat(tasasCOGS[0].tipo_cambio) || tasaCOGS;
        } catch(eTasaCOGS) {}

        for (const rep of (reps||[])) {
          if (!rep.id_articulo || !parseFloat(rep.cantidad)) continue;
          const cantidadRep = parseFloat(rep.cantidad);

          const sal = await api('stock_salidas','POST',{
            id_articulo:   rep.id_articulo,
            cantidad:      cantidadRep,
            id_area:       null,
            id_area_entrega: id_areaEmp,
            id_empleado_entrega: idEmpEmp,
            fecha_salida:  new Date().toISOString().split('T')[0],
            observaciones: 'Factura FAC-'+fac.id_factura,
            id_usuario:    correo
          });
          const id_salidaFac = sal && sal[0] ? sal[0].id_salida : null;

          // NO se llama a upsertStockArea aquí -- el stock de Taller ya
          // quedó correctamente rebajado al asignar el Artículo a la OS.

          try {
            const artCOGS = await api('inventario_almacen','GET',null,
              '?id_articulo=eq.'+rep.id_articulo+'&select=nombre_articulo,precio_costo_moneda,id_cuenta_contable,id_cuenta_costo_gasto');
            const aC = artCOGS && artCOGS[0] ? artCOGS[0] : null;
            if (aC && aC.id_cuenta_contable && aC.id_cuenta_costo_gasto) {
              const cppCOGS   = parseFloat(aC.precio_costo_moneda || 0);
              const montoUSDCOGS = parseFloat((cantidadRep * cppCOGS).toFixed(4));
              const montoVESCOGS = parseFloat((montoUSDCOGS * tasaCOGS).toFixed(2));
              if (montoUSDCOGS > 0) {
                const anioCOGS = new Date().getFullYear();
                const ultsCOGS = await api('cont_asientos','GET',null,'?id_empresa=eq.'+(fac.id_empresa||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
                let seqCOGS = 1;
                if (ultsCOGS[0]?.numero_asiento) { const mmC = ultsCOGS[0].numero_asiento.match(/(\d+)$/); if (mmC) seqCOGS = parseInt(mmC[1])+1; }
                const numAstCOGS = 'AST-' + anioCOGS + '-' + String(seqCOGS).padStart(4,'0');
                const astCOGS = await api('cont_asientos','POST',{
                  id_empresa: fac.id_empresa||0, numero_asiento: numAstCOGS,
                  tipo: 'COSTO_VENTA', fecha: new Date().toISOString().split('T')[0],
                  descripcion: 'Costo de Venta: ' + (aC.nombre_articulo||'') + ' x' + cantidadRep + ' — Factura FAC-'+fac.id_factura,
                  referencia: id_salidaFac ? 'SAL-'+id_salidaFac : 'FAC-'+fac.id_factura,
                  estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaCOGS,
                  id_usuario: correo || null
                });
                const arCOGS = Array.isArray(astCOGS) ? astCOGS[0] : astCOGS;
                if (arCOGS?.id_asiento) {
                  await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:aC.id_cuenta_costo_gasto, orden:1,
                    descripcion:'Costo de Venta: '+(aC.nombre_articulo||'')+' x'+cantidadRep+' (CPP $'+cppCOGS.toFixed(2)+' x T/C '+tasaCOGS.toFixed(2)+')',
                    debe_usd:montoUSDCOGS, haber_usd:0, debe_ves:montoVESCOGS, haber_ves:0, tasa_bcv:tasaCOGS });
                  await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:aC.id_cuenta_contable, orden:2,
                    descripcion:'Salida inventario por venta: '+(aC.nombre_articulo||'')+' x'+cantidadRep,
                    debe_usd:0, haber_usd:montoUSDCOGS, debe_ves:0, haber_ves:montoVESCOGS, tasa_bcv:tasaCOGS });

                  // ── Si el stock del artículo quedó en 0 GLOBAL (sumando
                  // todas las Áreas, no solo Taller), cerrar cualquier
                  // residuo de redondeo del CPP -- mismo mecanismo ya
                  // probado en la Salida de Stock de Consumibles
                  // (inventario.js), replicado aquí porque la venta de
                  // Mercancía vía OS/Factura es un camino de código aparte.
                  try {
                    const stockGlobalFilas = await api('inventario_stock_area','GET',null,
                      '?id_articulo=eq.'+rep.id_articulo+'&select=stock_actual');
                    const stockGlobalRestante = (stockGlobalFilas||[]).reduce(function(a,f){ return a + (parseFloat(f.stock_actual)||0); }, 0);
                    if (Math.abs(stockGlobalRestante) < 0.0001 && aC.id_cuenta_contable) {
                      const [entradasRefFac, salidasRefFac] = await Promise.all([
                        api('stock_entradas','GET',null,'?id_articulo=eq.'+rep.id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada'),
                        api('stock_salidas','GET',null,'?id_articulo=eq.'+rep.id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_salida'),
                      ]);
                      const refsFac = []
                        .concat((entradasRefFac||[]).map(function(e){ return 'ENT-'+e.id_entrada; }))
                        .concat((salidasRefFac||[]).map(function(s){ return 'SAL-'+s.id_salida; }));
                      if (refsFac.length) {
                        const asientosArtFac = await api('cont_asientos','GET',null,
                          '?referencia=in.(' + refsFac.join(',') + ')&estado=neq.ANULADO&select=id_asiento');
                        const idsAstFac = (asientosArtFac||[]).map(function(a){ return a.id_asiento; });
                        if (idsAstFac.length) {
                          const lineasInvFac = await api('cont_asiento_lineas','GET',null,
                            '?id_asiento=in.(' + idsAstFac.join(',') + ')&id_cuenta=eq.' + aC.id_cuenta_contable + '&select=debe_ves,haber_ves');
                          let totalDebeFac = 0, totalHaberFac = 0;
                          (lineasInvFac||[]).forEach(function(l) {
                            totalDebeFac  += parseFloat(l.debe_ves  || 0);
                            totalHaberFac += parseFloat(l.haber_ves || 0);
                          });
                          const residuoFac = parseFloat((totalDebeFac - totalHaberFac).toFixed(2));
                          if (Math.abs(residuoFac) >= 0.01) {
                            const _todasCtasRedondeoFac = await obtenerCuentasContables();
                            const ctaGastoResFac   = _todasCtasRedondeoFac.find(function(c){ return c.codigo === '6.2.02.001'; }) || null;
                            const ctaIngresoResFac = _todasCtasRedondeoFac.find(function(c){ return c.codigo === '4.2.02.001'; }) || null;
                            const montoAjusteFac = Math.abs(residuoFac);
                            if (residuoFac > 0 && ctaGastoResFac) {
                              // Inventario quedó DEUDOR (sobró valor) -> Gasto (debe) / Inventario (haber)
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:ctaGastoResFac.id_cuenta, orden:3,
                                descripcion:'Ajuste por redondeo de inventario: '+(aC.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:montoAjusteFac, haber_ves:0, tasa_bcv:tasaCOGS });
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:aC.id_cuenta_contable, orden:4,
                                descripcion:'Ajuste por redondeo de inventario: '+(aC.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjusteFac, tasa_bcv:tasaCOGS });
                            } else if (residuoFac < 0 && ctaIngresoResFac) {
                              // Inventario quedó ACREEDOR (faltó valor) -> Inventario (debe) / Ingreso (haber)
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:aC.id_cuenta_contable, orden:3,
                                descripcion:'Ajuste por redondeo de inventario: '+(aC.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:montoAjusteFac, haber_ves:0, tasa_bcv:tasaCOGS });
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGS.id_asiento, id_cuenta:ctaIngresoResFac.id_cuenta, orden:4,
                                descripcion:'Ajuste por redondeo de inventario: '+(aC.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjusteFac, tasa_bcv:tasaCOGS });
                            }
                          }
                        }
                      }
                    }
                  } catch(eAjusteRedondeoFac) { console.warn('Error generando ajuste por redondeo de inventario (Factura):', eAjusteRedondeoFac); }
                }
              }
            }
          } catch(eCOGS) { console.warn('Error creando asiento de Costo de Venta:', eCOGS); }
        }
      } catch(eSal) { console.warn('Error registrando salida de inventario:', eSal); }
    } else if (ventaOrigen) {
      // ── Venta directa (mostrador): a diferencia de una OS, aquí el stock
      // NO se había descontado todavía -- se descuenta recién ahora, al
      // momento de facturar.
      try {
        const lineasVenta = await api('venta_detalle','GET',null,'?id_venta=eq.'+ventaOrigen.id_venta+'&select=id_articulo,cantidad');
        const correo = sesionActual?.correo_usuario;

        let tasaCOGS = _tasaVigente || 1;
        try {
          const tasasCOGS = await api('tasas','GET',null,
            '?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
          if (tasasCOGS && tasasCOGS[0]) tasaCOGS = parseFloat(tasasCOGS[0].tipo_cambio) || tasaCOGS;
        } catch(eTasaCOGSVenta) {}

        for (const lin of (lineasVenta||[])) {
          if (!lin.id_articulo || !parseFloat(lin.cantidad)) continue;
          const cantidadVenta = parseFloat(lin.cantidad);

          // Descontar el stock real del área de la Venta
          try { await upsertStockArea(lin.id_articulo, ventaOrigen.id_area, -cantidadVenta); }
          catch(eStockVenta) { console.warn('Error descontando stock de Venta directa:', eStockVenta); }

          // Liberar la reserva de esta línea -- ya se descontó como stock
          // REAL arriba, así que la reserva "en vivo" que traía desde el
          // Presupuesto debe soltarse aquí. Sin esto, quedaba colgada y
          // restaba el disponible dos veces (una como reserva fantasma,
          // otra como salida real ya reflejada en stock_actual).
          try { await ajustarReservaArea(lin.id_articulo, ventaOrigen.id_area, -cantidadVenta); }
          catch(eReservaVenta) { console.warn('Error liberando reserva al facturar Venta:', eReservaVenta); }

          const sal = await api('stock_salidas','POST',{
            id_articulo:   lin.id_articulo, id_area: ventaOrigen.id_area, cantidad: cantidadVenta,
            fecha_salida:  fac.fecha_emision || new Date().toISOString().split('T')[0],
            observaciones: 'Venta '+fac.numero_factura,
            id_usuario:    correo
          });
          const id_salidaVenta = sal && sal[0] ? sal[0].id_salida : null;

          try {
            const artCOGSVenta = await api('inventario_almacen','GET',null,
              '?id_articulo=eq.'+lin.id_articulo+'&select=nombre_articulo,precio_costo_moneda,id_cuenta_contable,id_cuenta_costo_gasto');
            const aCV = artCOGSVenta && artCOGSVenta[0] ? artCOGSVenta[0] : null;
            if (aCV && aCV.id_cuenta_contable && aCV.id_cuenta_costo_gasto) {
              const cppCOGSVenta = parseFloat(aCV.precio_costo_moneda || 0);
              const montoUSDCOGSVenta = parseFloat((cantidadVenta * cppCOGSVenta).toFixed(4));
              const montoVESCOGSVenta = parseFloat((montoUSDCOGSVenta * tasaCOGS).toFixed(2));
              if (montoUSDCOGSVenta > 0) {
                const anioCOGSVenta = new Date().getFullYear();
                const ultsCOGSVenta = await api('cont_asientos','GET',null,'?id_empresa=eq.'+(fac.id_empresa||0)+'&order=id_asiento.desc&limit=1&select=numero_asiento') || [];
                let seqCOGSVenta = 1;
                if (ultsCOGSVenta[0]?.numero_asiento) { const mmCV = ultsCOGSVenta[0].numero_asiento.match(/(\d+)$/); if (mmCV) seqCOGSVenta = parseInt(mmCV[1])+1; }
                const numAstCOGSVenta = 'AST-' + anioCOGSVenta + '-' + String(seqCOGSVenta).padStart(4,'0');
                const astCOGSVenta = await api('cont_asientos','POST',{
                  id_empresa: fac.id_empresa||0, numero_asiento: numAstCOGSVenta,
                  tipo: 'COSTO_VENTA', fecha: fac.fecha_emision || new Date().toISOString().split('T')[0],
                  descripcion: 'Costo de Venta: ' + (aCV.nombre_articulo||'') + ' x' + cantidadVenta + ' — Factura '+fac.numero_factura,
                  referencia: id_salidaVenta ? 'SAL-'+id_salidaVenta : 'FAC-'+fac.id_factura,
                  estado: 'APROBADO', moneda_base: 'VES', tasa_bcv: tasaCOGS,
                  id_usuario: correo || null
                });
                const arCOGSVenta = Array.isArray(astCOGSVenta) ? astCOGSVenta[0] : astCOGSVenta;
                if (arCOGSVenta?.id_asiento) {
                  await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:aCV.id_cuenta_costo_gasto, orden:1,
                    descripcion:'Costo de Venta: '+(aCV.nombre_articulo||'')+' x'+cantidadVenta+' (CPP $'+cppCOGSVenta.toFixed(2)+' x T/C '+tasaCOGS.toFixed(2)+')',
                    debe_usd:montoUSDCOGSVenta, haber_usd:0, debe_ves:montoVESCOGSVenta, haber_ves:0, tasa_bcv:tasaCOGS });
                  await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:aCV.id_cuenta_contable, orden:2,
                    descripcion:'Salida inventario por venta: '+(aCV.nombre_articulo||'')+' x'+cantidadVenta,
                    debe_usd:0, haber_usd:montoUSDCOGSVenta, debe_ves:0, haber_ves:montoVESCOGSVenta, tasa_bcv:tasaCOGS });

                  // ── Si el stock del artículo quedó en 0 GLOBAL (sumando
                  // todas las Áreas), cerrar cualquier residuo de redondeo
                  // del CPP -- mismo mecanismo ya usado en la rama de OS
                  // arriba y en Salida de Stock de Consumibles
                  // (inventario.js). Faltaba aquí, en Venta directa, que es
                  // el camino de código que generó exactamente este bug.
                  try {
                    const stockGlobalFilasVenta = await api('inventario_stock_area','GET',null,
                      '?id_articulo=eq.'+lin.id_articulo+'&select=stock_actual');
                    const stockGlobalRestanteVenta = (stockGlobalFilasVenta||[]).reduce(function(a,f){ return a + (parseFloat(f.stock_actual)||0); }, 0);
                    if (Math.abs(stockGlobalRestanteVenta) < 0.0001 && aCV.id_cuenta_contable) {
                      const [entradasRefVenta, salidasRefVenta] = await Promise.all([
                        api('stock_entradas','GET',null,'?id_articulo=eq.'+lin.id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada'),
                        api('stock_salidas','GET',null,'?id_articulo=eq.'+lin.id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_salida'),
                      ]);
                      const refsVenta = []
                        .concat((entradasRefVenta||[]).map(function(e){ return 'ENT-'+e.id_entrada; }))
                        .concat((salidasRefVenta||[]).map(function(s){ return 'SAL-'+s.id_salida; }));
                      if (refsVenta.length) {
                        const asientosArtVenta = await api('cont_asientos','GET',null,
                          '?referencia=in.(' + refsVenta.join(',') + ')&estado=neq.ANULADO&select=id_asiento');
                        const idsAstVenta = (asientosArtVenta||[]).map(function(a){ return a.id_asiento; });
                        if (idsAstVenta.length) {
                          const lineasInvVenta = await api('cont_asiento_lineas','GET',null,
                            '?id_asiento=in.(' + idsAstVenta.join(',') + ')&id_cuenta=eq.' + aCV.id_cuenta_contable + '&select=debe_ves,haber_ves');
                          let totalDebeVenta = 0, totalHaberVenta = 0;
                          (lineasInvVenta||[]).forEach(function(l) {
                            totalDebeVenta  += parseFloat(l.debe_ves  || 0);
                            totalHaberVenta += parseFloat(l.haber_ves || 0);
                          });
                          const residuoVenta = parseFloat((totalDebeVenta - totalHaberVenta).toFixed(2));
                          if (Math.abs(residuoVenta) >= 0.01) {
                            const _todasCtasRedondeoVenta = await obtenerCuentasContables();
                            const ctaGastoResVenta   = _todasCtasRedondeoVenta.find(function(c){ return c.codigo === '6.2.02.001'; }) || null;
                            const ctaIngresoResVenta = _todasCtasRedondeoVenta.find(function(c){ return c.codigo === '4.2.02.001'; }) || null;
                            const montoAjusteVenta = Math.abs(residuoVenta);
                            if (residuoVenta > 0 && ctaGastoResVenta) {
                              // Inventario quedó DEUDOR (sobró valor) -> Gasto (debe) / Inventario (haber)
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:ctaGastoResVenta.id_cuenta, orden:3,
                                descripcion:'Ajuste por redondeo de inventario: '+(aCV.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:montoAjusteVenta, haber_ves:0, tasa_bcv:tasaCOGS });
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:aCV.id_cuenta_contable, orden:4,
                                descripcion:'Ajuste por redondeo de inventario: '+(aCV.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjusteVenta, tasa_bcv:tasaCOGS });
                            } else if (residuoVenta < 0 && ctaIngresoResVenta) {
                              // Inventario quedó ACREEDOR (faltó valor) -> Inventario (debe) / Ingreso (haber)
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:aCV.id_cuenta_contable, orden:3,
                                descripcion:'Ajuste por redondeo de inventario: '+(aCV.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:montoAjusteVenta, haber_ves:0, tasa_bcv:tasaCOGS });
                              await api('cont_asiento_lineas','POST',{ id_asiento:arCOGSVenta.id_asiento, id_cuenta:ctaIngresoResVenta.id_cuenta, orden:4,
                                descripcion:'Ajuste por redondeo de inventario: '+(aCV.nombre_articulo||''),
                                debe_usd:0, haber_usd:0, debe_ves:0, haber_ves:montoAjusteVenta, tasa_bcv:tasaCOGS });
                            }
                          }
                        }
                      }
                    }
                  } catch(eAjusteRedondeoVenta) { console.warn('Error generando ajuste por redondeo de inventario (Venta directa):', eAjusteRedondeoVenta); }
                }
              }
            }
          } catch(eCOGSVenta) { console.warn('Error creando asiento de Costo de Venta (Venta directa):', eCOGSVenta); }
        }
      } catch(eSalVenta) { console.warn('Error registrando salida de inventario (Venta directa):', eSalVenta); }
    }
    _tglog('completado exitosamente');
  } catch(eGen) { _tglog('ERROR: ' + eGen.message); console.warn('Error generando CxC/asiento/salida de la factura:', eGen); }
}

async function verFichaFactura(id) {
  try {
    const [facArr] = await Promise.all([
      api('facturas','GET',null,'?id_factura=eq.'+id+'&select=*,emisores(*),propietarios(nombre_completo,tipo_doc,numero_doc),cont_cxc(metodo_pago,referencia,fecha_cobro,pagado_usd,tasa_bcv,id_banco_origen,banco_origen:id_banco_origen(nombre))'),
    ]);
    const f = facArr[0]; if (!f) return;
    let linServ=[], linRep=[];
    if (f.id_orden) {
      [linServ,linRep] = await Promise.all([
        api('os_servicios','GET',null,'?id_orden=eq.'+f.id_orden+'&select=*'),
        api('os_mercancias','GET',null,'?id_orden=eq.'+f.id_orden+'&select=*'),
      ]);
    } else {
      // Factura de Venta directa -- las líneas viven en venta_detalle, no
      // en os_mercancias. Se ubica la Venta de origen por id_factura
      // (mismo criterio ya usado en generarCxCyAsientoFactura).
      try {
        const ventaOrigenFicha = await api('ventas','GET',null,'?id_factura=eq.'+id+'&select=id_venta&limit=1');
        if (ventaOrigenFicha && ventaOrigenFicha[0]) {
          const lineasVentaFicha = await api('venta_detalle','GET',null,
            '?id_venta=eq.'+ventaOrigenFicha[0].id_venta+'&select=cantidad,precio_unitario,subtotal,inventario_almacen(nombre_articulo)');
          linRep = (lineasVentaFicha||[]).map(function(l) {
            return { descripcion: l.inventario_almacen?.nombre_articulo || 'Artículo', cantidad: l.cantidad, precio_usd: l.precio_unitario, subtotal_usd: l.subtotal };
          });
        }
      } catch(eLineasVentaFicha) { console.warn('Error cargando líneas de Venta para la ficha:', eLineasVentaFicha); }
    }
    const est    = ESTADOS_FAC[f.estado]||{clase:'badge-gris',label:f.estado};
    const emisor = f.emisores;
    const esVES  = f.moneda_cobro==='VES';
    const t      = parseFloat(f.tasa_bcv||1);
    // Formato DUAL para P/U y Subtotal del Detalle -- Moneda de Cobro
    // como principal, y debajo el equivalente en la otra moneda (chico,
    // tenue), mismo criterio ya usado en Total/Subtotal/IVA.
    function fmtF(usd) {
      const principal  = esVES ? fmtBs(usd*t)+' Bs' : '$ '+fmtUSD(usd);
      const secundario = esVES ? '$ '+fmtUSD(usd) : fmtBs(usd*t)+' Bs';
      return principal + '<div style="font-size:10px;color:var(--suave)">'+secundario+'</div>';
    }
    // Formato DUAL -- Moneda de Cobro como principal (grande), y debajo el
    // equivalente en la Moneda contraria (chico, tenue). Se usa en
    // Total/Subtotal/IVA/IGTF, donde sí hay espacio.
    function fmtFDual(usd, tamPrincipal, colorPrincipal) {
      const principal = esVES ? fmtBs(usd*t)+' Bs' : '$ '+fmtUSD(usd);
      const secundario = esVES ? '$ '+fmtUSD(usd) : fmtBs(usd*t)+' Bs';
      return '<div style="font-family:var(--font-mono);font-size:'+(tamPrincipal||'12px')+';'+(colorPrincipal?'color:'+colorPrincipal+';':'')+'">'+principal+'</div>'
        + '<div style="font-family:var(--font-mono);font-size:10px;color:var(--suave);margin-top:1px">'+secundario+'</div>';
    }

    const tablaLineas = [...linServ.map(function(l){return{desc:l.descripcion,tipo:'Serv.',cant:l.cantidad,precio:l.precio_usd,sub:l.subtotal_usd};}),
                         ...linRep.map(function(l) {return{desc:l.descripcion,tipo:'Rep.', cant:l.cantidad,precio:l.precio_usd,sub:l.subtotal_usd};})]
      .map(function(l) {
        return '<tr><td style="padding:6px 0;font-size:12px">'+l.desc+'</td>'
          + '<td style="text-align:center;padding:6px"><span class="badge badge-gris" style="font-size:11px">'+l.tipo+'</span></td>'
          + '<td style="text-align:center;font-family:var(--font-mono);font-size:12px">'+l.cant+'</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px;white-space:nowrap">'+fmtF(l.precio)+'</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--naranja);white-space:nowrap">'+fmtF(l.sub)+'</td></tr>';
      }).join('');

    document.getElementById('ficha-fac-contenido').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">'
      + '<div><div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">'+(f.numero_factura||'—')+'</div>'
      + '<span class="badge '+est.clase+'">'+est.label+'</span>'
      + '<div style="font-size:11px;color:var(--suave);margin-top:4px">Fecha: '+(f.fecha_emision ? fmtFecha(f.fecha_emision) : '—')+'</div></div>'
      + (puedo('FACTURAS','VER_TOTALES')
          ? '<div style="text-align:right"><div style="font-size:9px;color:var(--suave);letter-spacing:2px;text-transform:uppercase">TOTAL</div>'
            + fmtFDual(f.total_usd, '28px', 'var(--naranja)')
            + '<div style="font-size:10px;color:#555;margin-top:3px">'+(f.moneda_cobro||'USD')+' · Tasa '+t.toFixed(2)+' Bs/$</div></div>'
          : '')
      + '</div>'
      + (emisor ? '<div style="background:var(--gris2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
          + '<div style="font-size:9px;color:var(--suave);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Empresa</div>'
          + '<div style="font-weight:600">'+emisor.nombre+'</div>'
          + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">'+(emisor.rif||'')+'</div>'
          + (emisor.direccion ? '<div style="font-size:11px;color:var(--suave);margin-top:2px">'+emisor.direccion+'</div>' : '')
          + '</div>' : '')
      + '<div style="background:var(--gris2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
      + '<div style="font-size:9px;color:var(--suave);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Cliente</div>'
      + '<div style="font-weight:600">'+(f.receptor_nombre||'—')+'</div>'
      + (f.receptor_rif ? '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">'+f.receptor_rif+'</div>' : '')
      + (f.receptor_tipo_contribuyente ? '<span class="badge '+(({'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris'})[f.receptor_tipo_contribuyente]||'badge-gris')+'" style="font-size:10px;margin-top:4px;display:inline-block">'+(({'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal'})[f.receptor_tipo_contribuyente]||f.receptor_tipo_contribuyente)+'</span>' : '')
      + (f.receptor_direccion ? '<div style="font-size:11px;color:var(--suave);margin-top:4px">'+f.receptor_direccion+'</div>' : '')
      + '</div>'
      + (puedo('FACTURAS','VER_TOTALES')
          ? '<div style="background:var(--gris2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
            + (function() {
                return '<div style="display:flex;flex-direction:column;gap:8px;font-size:12px">'
                  + '<div style="display:flex;justify-content:space-between;align-items:flex-start"><span style="color:var(--suave)">Subtotal</span><div style="text-align:right">'+fmtFDual(f.subtotal_usd)+'</div></div>'
                  + (f.aplica_iva  ? '<div style="display:flex;justify-content:space-between;align-items:flex-start"><span style="color:var(--suave)">IVA (' + (f.subtotal_usd > 0 ? Math.round(f.iva_usd/f.subtotal_usd*100) : Math.round(tasaIVAActual()*100)) + '%)</span><div style="text-align:right">'+fmtFDual(f.iva_usd)+'</div></div>' : '')
                  + (f.aplica_igtf ? '<div style="display:flex;justify-content:space-between;align-items:flex-start"><span style="color:var(--suave)">IGTF (' + (f.subtotal_usd > 0 ? Math.round(f.igtf_usd/(f.subtotal_usd+(f.iva_usd||0))*100) : Math.round(tasaIGTFActual()*100)) + '%)</span><div style="text-align:right">'+fmtFDual(f.igtf_usd)+'</div></div>' : '')
                  + '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-top:1px solid var(--borde);padding-top:8px;font-weight:600"><span>Total</span><div style="text-align:right">'+fmtFDual(f.total_usd, '13px', 'var(--naranja)')+'</div></div>'

                  + '</div>';
              })()
            + '</div>'
          : '')
      + (function() {
          // Datos de Cobro -- solo si ya se registró al menos un cobro
          // sobre esta Factura (cont_cxc.fecha_cobro presente).
          const cxcFicha = (f.cont_cxc && f.cont_cxc[0]) || null;
          if (!cxcFicha || !cxcFicha.fecha_cobro) return '';
          return '<div style="background:var(--gris2);border-radius:6px;padding:12px 16px;margin-bottom:14px">'
            + '<div style="font-size:9px;color:var(--suave);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Datos de Cobro</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">'
            + '<div style="display:flex;flex-direction:column;gap:10px">'
            + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:2px">Fecha de Cobro</div><div style="font-weight:600">'+fmtFecha(cxcFicha.fecha_cobro)+'</div></div>'
            + (cxcFicha.banco_origen?.nombre ? '<div><div style="font-size:10px;color:var(--suave);margin-bottom:2px">Banco Origen</div><div style="font-weight:600">'+cxcFicha.banco_origen.nombre+'</div></div>' : '')
            + '</div>'
            + '<div style="display:flex;flex-direction:column;gap:10px">'
            + '<div><div style="font-size:10px;color:var(--suave);margin-bottom:2px">Forma de Cobro</div><div style="font-weight:600">'+(cxcFicha.metodo_pago||'—')+'</div></div>'
            + (function() {
                const pagadoUSD = cxcFicha.pagado_usd||0;
                const pagadoVES = pagadoUSD * (cxcFicha.tasa_bcv||0);
                const pagoEnUSD = /USD/i.test(cxcFicha.metodo_pago||'');
                const principal = pagoEnUSD ? '$ '+fmtUSD(pagadoUSD) : 'Bs '+fmtBs(pagadoVES);
                const secundario = pagoEnUSD ? 'Bs '+fmtBs(pagadoVES) : '$ '+fmtUSD(pagadoUSD);
                return '<div><div style="font-size:10px;color:var(--suave);margin-bottom:2px">Monto Cobrado</div>'
                  + '<div style="font-weight:600;font-family:var(--font-mono);color:var(--naranja)">'+principal+'</div>'
                  + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">'+secundario+'</div></div>';
              })()
            + '</div>'
            + '<div style="grid-column:1/-1"><div style="font-size:10px;color:var(--suave);margin-bottom:2px">Comprobante de Cobro No.</div><div style="font-weight:600;font-family:var(--font-mono)">'+(cxcFicha.referencia||'—')+'</div></div>'
            + '</div></div>';
        })()
      + '<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Detalle</div>'
      + '<div class="tabla-container"><table style="width:100%;border-collapse:collapse"><thead><tr>'
      + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">DESCRIPCIÓN</th>'
      + '<th style="text-align:center;padding:6px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">TIPO</th>'
      + '<th style="text-align:center;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
      + '<th style="text-align:right;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">P/U</th>'
      + '<th style="text-align:right;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SUBTOTAL</th>'
      + '</tr></thead><tbody>'
      + (tablaLineas||'<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--suave)">Sin líneas</td></tr>')
      + '</tbody></table></div>'
      + (f.observaciones ? '<div style="margin-top:14px"><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Observaciones</div><div style="background:var(--gris2);border-radius:6px;padding:10px 14px;font-size:13px">'+f.observaciones+'</div></div>' : '');

    var btnEditar   = document.getElementById('ficha-fac-btn-editar');
    var btnEmitir   = document.getElementById('ficha-fac-btn-emitir');
    var btnPago     = document.getElementById('ficha-fac-btn-pago');
    // "Eliminar Factura Anulada" se eliminó de raíz -- dependía por completo
    // de estado==='ANULADA', y ese estado ya no se genera desde que se
    // eliminó "Anular Factura" de raíz (ver notas de esa sesión).
    // Botón Aprobar
    await cargarFacultades();
    var btnAprobar = document.getElementById('ficha-fac-btn-aprobar');
    if (btnAprobar) {
      btnAprobar.style.display = (f.estado==='EMITIDA' && puedeAprobar('FACTURAS')) ? '' : 'none';
      btnAprobar.onclick = function() { btnSetGuardando(this,true,null,'Procesando...'); aprobarFactura(f.id_factura).finally(()=>btnSetGuardando(this,false)); };
    }
    if (btnPago) {
      btnPago._id = f.id_factura;
      btnPago.style.display = (f.estado==='EMITIDA'||f.estado==='APROBADA'||f.estado==='PARCIAL') ? '' : 'none';
      btnPago._facId = f.id_factura;
      btnPago.onclick = async function() {
        try {
          const cxcs = await api('cont_cxc','GET',null,'?id_factura=eq.'+this._facId+'&estado=neq.ANULADA&select=*,facturas(aplica_igtf,moneda_cobro,numero_factura,receptor_nombre,fecha_emision)');
          if (cxcs && cxcs.length) {
            if (!contCxcCache) contCxcCache = [];
            cxcs.forEach(function(c) {
              const i = contCxcCache.findIndex(function(x){ return x.id_cxc===c.id_cxc; });
              if (i >= 0) contCxcCache[i] = c; else contCxcCache.push(c);
            });
            contAbrirPagoCxc(cxcs[0].id_cxc);
          } else {
            alert('No se encontró la CxC asociada a esta factura.');
          }
        } catch(e) { alert('Error: ' + msgErr(e)); }
      };
    }
    if (btnEditar)  { btnEditar._id=f.id_factura;  btnEditar.onclick=function(){cerrarModal('modal-ficha-fac');abrirEditarFactura(this._id);}; btnEditar.style.display=puedo('FACTURAS','EDITAR')&&f.estado==='BORRADOR'?'':'none'; }
    if (btnEmitir)  { btnEmitir._id=f.id_factura;  btnEmitir.onclick=function(){emitirFactura(this._id);};   btnEmitir.style.display=puedo('FACTURAS','CREAR')&&f.estado==='BORRADOR'?'':'none'; }
    // "Anular Factura" se eliminó de raíz (botón HTML, wiring y función) --
    // decisión de negocio: una vez Emitida, la Empresa no está dispuesta a
    // asumir el riesgo fiscal de que el IVA ya reportado al SENIAT quede
    // como gasto propio. Ventas y OS ya bloqueaban su propia anulación una
    // vez facturadas (ver anularVenta() en ventas.js y anularOS() en
    // ordenes.js) -- esta era la única puerta que quedaba abierta.
    // (ver comentario arriba sobre btnEliminar)
    abrirModal('modal-ficha-fac');
  focusFirstField('modal-ficha-fac');
  } catch(err) { alert('Error: '+msgErr(err)); console.error(err); }
}

async function abrirEditarFactura(id) {
  const f = facturasCache.find(function(x){return x.id_factura===id;});
  if (!f||f.estado!=='BORRADOR') { alert('Solo se pueden editar facturas en Borrador.'); return; }
  await abrirNuevaFactura();
  setTimeout(async function() {
    document.getElementById('fac-id').value=''+f.id_factura;
    document.getElementById('fac-numero').textContent=f.numero_factura||'Borrador';
    document.getElementById('fac-emisor').value=f.id_empresa||'';
    document.getElementById('fac-fecha').value=f.fecha_emision||getHoyVzla();
    document.getElementById('fac-estado').value=f.estado;
    document.getElementById('fac-moneda').value=f.moneda_cobro||'VES';
    document.getElementById('fac-tasa').value=parseFloat(f.tasa_bcv||1).toFixed(4);
    document.getElementById('fac-receptor-nombre').value=f.receptor_nombre||'';
    document.getElementById('fac-receptor-rif').value=f.receptor_rif||'';
    document.getElementById('fac-receptor-dir').value=f.receptor_direccion||'';
    document.getElementById('fac-receptor-tipo-contrib').value=f.receptor_tipo_contribuyente||'';
    document.getElementById('fac-aplica-iva').checked=!!f.aplica_iva;
    document.getElementById('fac-aplica-igtf').checked=!!f.aplica_igtf;
    document.getElementById('fac-observaciones').value=f.observaciones||'';
    document.getElementById('modal-fac-titulo').textContent='EDITAR FACTURA — '+(f.numero_factura||'Borrador');
    // Solo visibilidad -- NO se debe pisar el IVA/IGTF real que ya se
    // guardó, con el default de "cambio de moneda manual".
    actualizarVisibilidadMonedaFactura();
    // Re-aplicar la regla legal de IGTF (obligatorio/prohibido según la
    // Empresa) -- una Factura en Borrador todavía no se emitió, así que
    // conviene corregirla aquí si el Tipo de Contribuyente de la Empresa
    // cambió desde que se guardó por última vez.
    _aplicarReglaIGTFFactura();
    // La lista de Órdenes debe reflejar la Empresa REAL de esta Factura
    // (puede no coincidir con la Empresa activa global), y debe incluir su
    // propia OS aunque ya esté facturada por esta misma Factura.
    await cargarOSParaFactura(f.id_empresa, f.id_factura);
    if (f.id_orden) { document.getElementById('fac-os-sel').value=f.id_orden; await onSelOSFactura(); }
    calcularTotalesFactura();
  }, 300);
}

async function emitirFactura(id) {
  if (!confirm('¿Emitir esta factura? Una vez emitida no podrá editarse.')) return;
  // Verificar que no esté ya emitida
  const facCheck = await api('facturas','GET',null,'?id_factura=eq.'+id+'&select=estado');
  if (facCheck && facCheck[0] && facCheck[0].estado !== 'BORRADOR') {
    alert('Esta factura ya fue procesada.'); return;
  }
  // Deshabilitar botón para evitar doble clic
  const btnEmitir = document.getElementById('ficha-fac-btn-emitir');
  if (btnEmitir) { btnEmitir.disabled = true; btnEmitir.textContent = '⏳ Procesando...'; }
  try {
    await api('facturas','PATCH',{estado:'EMITIDA'},'?id_factura=eq.'+id);
    // Antes, emitir desde aquí solo cambiaba el estado -- nunca creaba la
    // CxC ni el asiento contable, a diferencia de emitir directo desde el
    // formulario. Ahora usa la misma función que guardarFactura().
    await generarCxCyAsientoFactura(id);
    cerrarModal('modal-ficha-fac');
    renderFacturas();
  }
  catch(err) { alert('Error: '+msgErr(err)); }
  finally { if (btnEmitir) { btnEmitir.disabled=false; btnEmitir.textContent='✓ Emitir'; } }
}

// "Anular Factura" se eliminó de raíz de este archivo -- decisión de
// negocio: una vez que una Factura fue EMITIDA, no se permite anularla
// bajo ningún caso -- si ya fue reportada al SENIAT, el IVA queda como un
// gasto que la Empresa asume directamente, riesgo que se decidió no
// aceptar. Ventas y Órdenes de Servicio ya bloqueaban su propia anulación
// una vez facturadas (ver anularVenta() en ventas.js y anularOS() en
// ordenes.js); esta era la única puerta que quedaba abierta.
//
// La corrección de una Factura ya Emitida deberá hacerse, en el futuro,
// con Notas de Crédito/Débito (pendiente de implementar -- ver backlog).
// La función y el botón anteriores quedan recuperables en el historial de
// Git si alguna vez se retoma ese diseño.

async function aprobarFactura(id) {
  if (!puedeAprobar('FACTURAS')) { alert('No tiene facultad para aprobar facturas.'); return; }
  if (!confirm('¿Confirma la aprobación de esta factura?')) return;
  try {
    await api('facturas','PATCH',{
      estado: 'APROBADA'
    },'?id_factura=eq.'+id);
    cerrarModal('modal-ficha-fac');
    renderFacturas();
  } catch(e) { alert('Error: '+msgErr(e)); }
}

// "eliminarFactura()" se eliminó de raíz -- dependía por completo de una
// Factura en estado ANULADA, que ya no puede ocurrir. Recuperable en el
// historial de Git si algún día se retoma un mecanismo de corrección.




// ─── ARTÍCULO ACTIVO EN FICHA ───




// ─── Estado visual del modal según el modo: crear / ver / editar ───


// Ver la ficha de un Ajuste ya registrado (desde Historial de Movimientos)


// Habilitar edición (solo Empleado que reporta y Observaciones — Área/Tipo/Cantidad
// ya generaron el asiento contable y no se pueden alterar retroactivamente;
// si el registro está mal, se anula y se crea uno nuevo)


// Anular el Ajuste (reutiliza la misma lógica de Anular que Entrada/Salida)


// ─── AJUSTE POR DIFERENCIA EN INVENTARIO (Faltante o Sobrante) ───


// Carga el usuario de la sesión actual en el recuadro de Confirmación de Usuario


// Al elegir el Área afectada: cargar solo los empleados de esa área (informativo) y mostrar el stock disponible


// Alternar textos según sea Faltante o Sobrante




// Guardar edición limitada de un Ajuste ya registrado: solo Empleado que
// reporta y Observaciones. Área/Tipo/Cantidad no se tocan (ya generaron
// el asiento contable) — si están mal, se anula y se crea un ajuste nuevo.






// ─── FILTRO DE EMPRESA ACTIVA ───


// ─── FORMATO DE FECHA DD-MM-YYYY ───


// ─── EMPRESAS CON ACCESO EN MODAL USUARIO ───




// ─── HASHEAR CONTRASEÑA VIA RPC ───


// ─── VERIFICAR CONTRASEÑA BCRYPT VIA SUPABASE ───
// Usa pgcrypto: crypt(clave_ingresada, hash_guardado) == hash_guardado


// ─── VALIDAR CONTRASEÑA RECEPTOR ───
// Valida la contraseña directamente contra el usuario de la sesión actual
// (no requiere que exista un registro en `empleados` — útil para el Administrador,
// que puede no tener ficha de empleado asociada).




// ─── CARGAR EMPLEADOS POR ÁREA ───



















// Parsea un texto en formato venezolano (punto de miles, coma decimal, ej.
// "1.234,56") a un número JS normal. Devuelve 0 si no es un número válido.












// ─── SALIDA DE STOCK ───





