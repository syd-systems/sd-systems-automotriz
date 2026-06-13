// ─── S&D Systems — Módulo: FACTURACION ───
// ══════════════════════════════════════════════════════════════
//  FASE 4 — FACTURAS
// ══════════════════════════════════════════════════════════════
let facturasCache = [];

const ESTADOS_FAC = {
  'BORRADOR': { clase: 'badge-gris',    label: 'Borrador'  },
  'EMITIDA':  { clase: 'badge-naranja', label: 'Emitida'   },
  'APROBADA': { clase: 'badge-verde',   label: 'Aprobada'  },
  'PAGADA':   { clase: 'badge-verde',   label: 'Pagada'    },
  'ANULADA':  { clase: 'badge-rojo',    label: 'Anulada'   },
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
  // Cargar alícuotas de tributos
  try {
    const tributos = await api('param_tributos','GET',null,'?estado=eq.ACTIVO&select=codigo,alicuota');
    const ivaT  = tributos.find(function(t){ return t.codigo === 'IVA-GEN'; });
    const igtfT = tributos.find(function(t){ return t.codigo === 'IGTF-3'; });
    window._facAlicuotaIVA  = ivaT  ? parseFloat(ivaT.alicuota)  : 16;
    window._facAlicuotaIGTF = igtfT ? parseFloat(igtfT.alicuota) : 3;
  } catch(e) { window._facAlicuotaIVA = 16; window._facAlicuotaIGTF = 3; }
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando facturas...</div>';
  try {
    const [facturas, tasas] = await Promise.all([
      api('facturas','GET',null,'?order=fecha_emision.desc&select=*,emisores(nombre,rif),propietarios(nombre_completo)'+emisorQ()),
      api('tasas','GET',null,'?order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    facturasCache = facturas;
    const tasaActual = tasas.length ? parseFloat(tasas[0].tipo_cambio) : 1;
    const resumen = {};
    Object.keys(ESTADOS_FAC).forEach(function(k) { resumen[k]=0; });
    facturas.forEach(function(f) { if (resumen[f.estado]!==undefined) resumen[f.estado]++; });
    const filas = facturas.map(function(f) {
      const est = ESTADOS_FAC[f.estado] || { clase:'badge-gris', label:f.estado };
      const emisor = f.emisores;
      const prop   = f.propietarios;
      return '<tr data-id="' + f.id_factura + '">'
        + '<td><div style="font-family:var(--font-display);font-size:17px;color:var(--naranja)">' + (f.numero_factura||'—') + '</div>'
        + '<div style="font-size:11px;color:var(--suave)">' + (f.fecha_emision||'—') + '</div></td>'
        + '<td style="font-size:12px">' + (emisor ? emisor.nombre : '—') + '</td>'
        + '<td style="font-size:12px">' + (prop ? prop.nombre_completo : (f.receptor_nombre||'—')) + '</td>'
        + '<td><span class="badge ' + est.clase + '">' + est.label + '</span></td>'
        + (puedo('FACTURAS','VER_TOTALES')
            ? '<td style="font-family:var(--font-mono)">'
              + (f.moneda_cobro==='VES'
                  ? '<span style="color:var(--naranja)">' + fmtBs(f.total_ves) + ' Bs</span><div style="font-size:10px;color:var(--suave)">$ ' + fmtUSD(f.total_usd) + '</div>'
                  : '<span style="color:var(--naranja)">$ ' + fmtUSD(f.total_usd) + '</span>')
              + '</td>'
            : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
        + '<td><button class="btn-secundario" onclick="verFichaFactura(' + f.id_factura + ')">Ver</button>'
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
      + (puedo('FACTURAS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevaFactura()">+ Nueva Factura</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container"><table id="fac-tabla"><thead><tr>'
      + '<th>N° / Fecha</th><th>Empresa</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Acción</th>'
      + '</tr></thead><tbody id="fac-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay facturas registradas</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
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
  // Cargar alícuotas desde tributos si no están en cache
  if (!window._facAlicuotaIVA) {
    try {
      const tributos = await api('param_tributos','GET',null,'?estado=eq.ACTIVO&select=codigo,alicuota');
      const ivaT  = tributos.find(function(t){ return t.codigo === 'IVA-GEN'; });
      const igtfT = tributos.find(function(t){ return t.codigo === 'IGTF-3'; });
      window._facAlicuotaIVA  = ivaT  ? parseFloat(ivaT.alicuota)  : 16;
      window._facAlicuotaIGTF = igtfT ? parseFloat(igtfT.alicuota) : 3;
    } catch(e) { window._facAlicuotaIVA = 16; window._facAlicuotaIGTF = 3; }
  }
  let osDisponibles = [], emisoresList = [], tasaActual = 1;
  try {
    const [os, em, ta] = await Promise.all([
      api('ordenes_servicio','GET',null,'?estado=eq.CERRADA&select=id_orden,numero_os,fecha_entrada,total_usd,total_ves,estado,id_vehiculo,id_propietario,vehiculos(placa,marca,modelo),propietarios(nombre_completo,tipo_doc,numero_doc,tipo_contribuyente,direccion)&order=fecha_entrada.desc'+emisorQ()),
      api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*'),
      api('tasas','GET',null,'?order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    emisoresList = em;
    tasaActual = ta.length ? parseFloat(ta[0].tipo_cambio) : 1;

    // Excluir OS que ya tienen factura
    try {
      const facturadas = await api('facturas','GET',null,'?id_orden=not.is.null&select=id_orden&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
      const idsFacturadas = new Set(facturadas.map(function(f){ return f.id_orden; }));
      osDisponibles = os.filter(function(o){ return !idsFacturadas.has(o.id_orden); });
    } catch(e) { osDisponibles = os; }
  } catch(e) {}

  window._facSubtotalOS = 0;
  document.getElementById('fac-id').value            = '';
  document.getElementById('fac-numero').textContent  = 'Se asignará al emitir';
  document.getElementById('fac-os-id').value         = '';
  document.getElementById('fac-os-info').innerHTML   = '';
  document.getElementById('fac-lineas-cont').innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Selecciona una OS para cargar las líneas</div>';
  document.getElementById('fac-receptor-nombre').value     = '';
  document.getElementById('fac-receptor-rif').value        = '';
  document.getElementById('fac-receptor-dir').value        = '';
  document.getElementById('fac-receptor-tipo-contrib').value = '';
  document.getElementById('fac-aplica-iva').checked        = false;
  document.getElementById('fac-aplica-igtf').checked       = false;
  document.getElementById('fac-moneda').value              = 'USD';
  document.getElementById('fac-tasa').value                = tasaActual.toFixed(4);
  document.getElementById('fac-fecha').value               = getHoyVzla();
  document.getElementById('fac-estado').value              = 'BORRADOR';
  document.getElementById('fac-observaciones').value       = '';
  document.getElementById('alerta-fac-ok').style.display   = 'none';
  document.getElementById('alerta-fac-err').style.display  = 'none';
  document.getElementById('modal-fac-titulo').textContent  = 'NUEVA FACTURA';
  var tasaCont = document.getElementById('fac-tasa-cont');
  if (tasaCont) tasaCont.style.display = 'none';
  var igtfCont = document.getElementById('fac-igtf-cont');
  if (igtfCont) igtfCont.style.display = 'flex';
  document.getElementById('fac-subtotal-os').textContent = '$ 0.00';

  const selEm = document.getElementById('fac-emisor');
  selEm.innerHTML = '<option value="">— Seleccionar empresa —</option>'
    + emisoresList.map(function(e) { return '<option value="' + e.id_emisor + '">' + e.nombre + ' (' + (e.rif||'') + ')</option>'; }).join('');
  // Preseleccionar empresa activa
  if (_empresaActiva) selEm.value = _empresaActiva.id_emisor;

  const selOS = document.getElementById('fac-os-sel');
  selOS.innerHTML = '<option value="">— Seleccionar OS —</option>'
    + osDisponibles.map(function(o) {
        const veh = o.vehiculos, prop = o.propietarios;
        return '<option value="' + o.id_orden + '">'
          + o.numero_os + ' [' + (o.estado||'') + '] — '
          + (veh ? veh.placa + ' ' + veh.marca + ' ' + veh.modelo : '')
          + (prop ? ' · ' + prop.nombre_completo : '') + '</option>';
      }).join('');

  calcularTotalesFactura();
  abrirModal('modal-factura');
  focusFirstField('modal-factura');
  setTimeout(function() { document.querySelector('#modal-factura .modal-body')?.scrollTo(0,0); }, 80);
}

async function onSelOSFactura() {
  const sel    = document.getElementById('fac-os-sel');
  const idOS   = parseInt(sel.value);
  const infoDiv = document.getElementById('fac-os-info');
  const linDiv  = document.getElementById('fac-lineas-cont');
  if (!idOS) {
    infoDiv.innerHTML = ''; linDiv.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Selecciona una OS para cargar las líneas</div>';
    document.getElementById('fac-os-id').value = '';
    window._facSubtotalOS = 0; actualizarSubtotalOSLabel(); calcularTotalesFactura(); return;
  }
  document.getElementById('fac-os-id').value = idOS;
  linDiv.innerHTML = '<div class="loading" style="padding:16px"><div class="spinner"></div> Cargando líneas...</div>';
  try {
    const [linServ, linRep, osData] = await Promise.all([
      api('os_servicios','GET',null,'?id_orden=eq.'+idOS+'&select=*'),
      api('os_repuestos','GET',null,'?id_orden=eq.'+idOS+'&select=*'),
      api('ordenes_servicio','GET',null,'?id_orden=eq.'+idOS+'&select=*,vehiculos(placa,marca,modelo),propietarios(nombre_completo,tipo_doc,numero_doc,correo,telefono,direccion,tipo_contribuyente)'),
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
    var tasaLineas   = monedaLineas==='VES' ? (parseFloat(document.getElementById('fac-tasa')?.value)||1) : 1;
    var esVESLineas  = monedaLineas==='VES';
    function fmtLin(usd) { return esVESLineas ? fmtBs(usd*tasaLineas)+' Bs' : '$ '+fmtUSD(usd); }

    const todasLineas = [
      ...linServ.map(function(l) { return {tipo:'servicio',desc:l.descripcion,cant:l.cantidad,precio:l.precio_usd,subtotal:l.subtotal_usd}; }),
      ...linRep.map(function(l)  { return {tipo:'repuesto', desc:l.descripcion,cant:l.cantidad,precio:l.precio_usd,subtotal:l.subtotal_usd}; }),
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
    linDiv.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function actualizarSubtotalOSLabel() {
  const sub    = window._facSubtotalOS||0;
  const moneda = document.getElementById('fac-moneda')?.value||'USD';
  const tasa   = moneda==='VES' ? (parseFloat(document.getElementById('fac-tasa')?.value)||1) : 1;
  const el     = document.getElementById('fac-subtotal-os');
  if (el) el.textContent = moneda==='VES' ? fmtBs(sub*tasa)+' Bs' : '$ '+fmtUSD(sub);
}

function onCambiarMonedaFactura() {
  const moneda   = document.getElementById('fac-moneda')?.value||'USD';
  const esVES    = moneda==='VES';
  const tasaCont = document.getElementById('fac-tasa-cont');
  const igtfCont = document.getElementById('fac-igtf-cont');
  const igtfChk  = document.getElementById('fac-aplica-igtf');
  if (tasaCont) tasaCont.style.display = esVES ? 'block' : 'none';
  if (igtfCont) igtfCont.style.display = esVES ? 'none' : 'flex';
  if (igtfChk && esVES) igtfChk.checked = false;
  actualizarSubtotalOSLabel();
  var idOS = document.getElementById('fac-os-id')?.value;
  if (idOS) onSelOSFactura(); else calcularTotalesFactura();
}

function calcularTotalesFactura() {
  const subtotal = window._facSubtotalOS||0;
  const moneda   = document.getElementById('fac-moneda')?.value||'USD';
  const tasa     = moneda==='VES' ? (parseFloat(document.getElementById('fac-tasa')?.value)||1) : 1;
  const aplIVA   = document.getElementById('fac-aplica-iva')?.checked;
  const aplIGTF  = document.getElementById('fac-aplica-igtf')?.checked;
  const esVES    = moneda==='VES';
  const iva    = aplIVA  ? subtotal*0.16 : 0;
  const base   = subtotal+iva;
  const igtf   = aplIGTF ? base*0.03 : 0;
  const total  = base+igtf;
  const totVes = total*tasa;
  function fmt(usd) { return esVES ? fmtBs(usd*tasa)+' Bs' : '$ '+fmtUSD(usd); }
  const el = document.getElementById('fac-totales');
  if (!el) return;
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;padding:14px 0">'
    + '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--suave)">Subtotal</span><span style="font-family:var(--font-mono)">' + fmt(subtotal) + '</span></div>'
    + (aplIVA  ? '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--suave)">IVA (16%)</span><span style="font-family:var(--font-mono)">' + fmt(iva) + '</span></div>' : '')
    + (aplIGTF ? '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--suave)">IGTF (3%)</span><span style="font-family:var(--font-mono)">' + fmt(igtf) + '</span></div>' : '')
    + '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--borde);padding-top:8px;margin-top:4px">'
    + '<span style="font-family:var(--font-display);font-size:16px;letter-spacing:1px">TOTAL</span>'
    + '<div style="text-align:right"><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + fmt(total) + '</div>'
    + (esVES ? '<div style="font-size:11px;color:var(--suave)">Tasa: ' + tasa.toFixed(2) + ' Bs/$</div>' : '')
    + '</div></div></div>';
  window._facTotales = { subtotal, iva, igtf, total, totVes, moneda, tasa };
}

async function guardarFactura(emitir) {
  // Protección contra doble clic
  if (window._facturaProcesando) return;
  window._facturaProcesando = true;
  const btnGuardar = document.querySelector('#modal-factura .btn-primario');
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = '⏳ Procesando...'; }

  const id       = document.getElementById('fac-id').value;
  const idOS     = parseInt(document.getElementById('fac-os-id').value)||null;
  const idEmisor = parseInt(document.getElementById('fac-emisor').value)||null;
  const recNom   = document.getElementById('fac-receptor-nombre').value.trim();
  const recRif   = document.getElementById('fac-receptor-rif').value.trim();
  const recDir   = document.getElementById('fac-receptor-dir').value.trim();
  const tasa     = parseFloat(document.getElementById('fac-tasa').value)||1;
  const fecha    = document.getElementById('fac-fecha').value;
  const estadoActual = document.getElementById('fac-estado').value;
  if (emitir && estadoActual === 'BORRADOR' && !puedeAprobar('FACTURAS')) {
    const errEl = document.getElementById('alerta-fac-err');
    errEl.textContent = 'Esta factura requiere aprobación antes de emitirse.';
    errEl.style.display = 'block';
    window._facturaProcesando = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = '✓ Emitir Factura'; }
    return;
  }
  const estado   = emitir ? 'EMITIDA' : document.getElementById('fac-estado').value;
  const obs      = document.getElementById('fac-observaciones').value.trim();
  const aplIVA   = document.getElementById('fac-aplica-iva').checked;
  const aplIGTF  = document.getElementById('fac-aplica-igtf').checked;
  const okEl     = document.getElementById('alerta-fac-ok');
  const errEl    = document.getElementById('alerta-fac-err');
  okEl.style.display='none'; errEl.style.display='none';
  if (!idOS)     { errEl.textContent='Debe seleccionar una Orden de Servicio.'; errEl.style.display='block'; return; }
  if (!idEmisor) { errEl.textContent='Debe seleccionar una Empresa.';           errEl.style.display='block'; return; }
  if (!recNom)   { errEl.textContent='El nombre del cliente es obligatorio.';   errEl.style.display='block'; return; }
  if (!fecha)    { errEl.textContent='La fecha es obligatoria.';                errEl.style.display='block'; return; }
  const tot = window._facTotales||{subtotal:0,iva:0,igtf:0,total:0,totVes:0};
  let idProp = null;
  try { const os=await api('ordenes_servicio','GET',null,'?id_orden=eq.'+idOS+'&select=id_propietario'); if(os.length) idProp=os[0].id_propietario; } catch(e) {}
  try {
    const datos = {
      id_orden:idOS, id_emisor:idEmisor, id_propietario:idProp,
      receptor_nombre:recNom, receptor_rif:recRif||null, receptor_direccion:recDir||null,
      receptor_tipo_contribuyente:document.getElementById('fac-receptor-tipo-contrib')?.value||null,
      moneda_cobro:document.getElementById('fac-moneda')?.value||'USD',
      fecha_emision:fecha, estado,
      aplica_iva:aplIVA, aplica_igtf:aplIGTF,
      subtotal_usd:tot.subtotal, iva_usd:tot.iva, igtf_usd:tot.igtf,
      total_usd:tot.total, total_ves:tot.totVes, tasa_cambio:tot.tasa||tasa,
      observaciones:obs||null, id_usuario:sesionActual.correo_usuario
    };
    if (id) {
      await api('facturas','PATCH',datos,'?id_factura=eq.'+id);
    } else {
      // Verificar que la OS no tenga ya una factura activa
      if (idOS) {
        const osFacturada = await api('facturas','GET',null,
          '?id_orden=eq.'+idOS+'&estado=neq.ANULADA&select=id_factura,numero_factura');
        if (osFacturada && osFacturada.length) {
          errEl.textContent = 'Esta OS ya tiene una factura activa: ' + osFacturada[0].numero_factura;
          errEl.style.display = 'block';
          window._facturaProcesando = false;
          if (btnGuardar) { btnGuardar.disabled=false; btnGuardar.textContent = emitir ? '✓ Emitir' : 'Guardar'; }
          return;
        }
      }
      const anio=new Date().getFullYear();
      const existentes=await api('facturas','GET',null,'?select=numero_factura&numero_factura=like.FAC-'+anio+'-*&order=numero_factura.desc&limit=1');
      let seq=1;
      if (existentes.length) { const p=existentes[0].numero_factura.split('-'); seq=parseInt(p[p.length-1])+1; }
      datos.numero_factura='FAC-'+anio+'-'+String(seq).padStart(4,'0');
      await api('facturas','POST',datos);
    }
    // ── Si se emite: crear CxC y asiento contable automáticamente ──
    if (emitir) {
      const facGuardada = await api('facturas','GET',null,
        '?id_propietario=eq.'+(idProp||0)+'&estado=eq.EMITIDA&order=fecha_emision.desc&limit=1&select=*');
      const fac = facGuardada[0];
      if (fac) {
        // 1. Crear registro CxC
        try {
          await api('cont_cxc','POST',{
            tipo:           'FACTURA',
            id_propietario: idProp,
            id_factura:     fac.id_factura,
            numero_doc:     fac.numero_factura,
            fecha_emision:  fac.fecha_emision,
            monto_usd:      fac.total_usd,
            monto_ves:      fac.total_ves || 0,
            tasa_bcv:       fac.tasa_cambio || 1,
            saldo_usd:      fac.total_usd,
            estado:         'PENDIENTE',
            moneda_cobro:   fac.moneda_cobro || 'USD',
            id_emisor:      fac.id_emisor || null,
            id_usuario:     sesionActual.correo_usuario
          });
        } catch(eCxc) { console.warn('Error creando CxC:', eCxc); }

        // 2. Crear asiento contable
        try {
          const anioAst = new Date().getFullYear();
          const existAst = await api('cont_asientos','GET',null,
            '?numero_asiento=like.AST-'+anioAst+'-*&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'&order=numero_asiento.desc&limit=1&select=numero_asiento');
          let seqAst = 1;
          if (existAst.length) { const pa = existAst[0].numero_asiento.split('-'); seqAst = parseInt(pa[pa.length-1]) + 1; }
          const numAst = 'AST-'+anioAst+'-'+String(seqAst).padStart(4,'0');
          const tasa = fac.tasa_cambio || 1;

          const periodos = await api('cont_periodos','GET',null,'?estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1&select=id_periodo&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
          const idPeriodo = periodos.length ? periodos[0].id_periodo : null;

          // Obtener tasa BCV real desde la BD
          let tasaReal = 1;
          try {
            const tasasBCV = await api('tasas','GET',null,
              '?moneda_origen=eq.USD&moneda_destino=eq.VES&order=fecha_valor.desc&limit=1&select=tipo_cambio');
            tasaReal = tasasBCV.length ? parseFloat(tasasBCV[0].tipo_cambio) : (tot.tasa || tasa || 1);
          } catch(eTasa) { tasaReal = tot.tasa || tasa || 1; }

          const asiento = await api('cont_asientos','POST',{
            numero_asiento: numAst,
            fecha:          fac.fecha_emision,
            descripcion:    'Factura '+fac.numero_factura+' — '+recNom,
            tipo:           'AUTOMATICO',
            referencia:     fac.numero_factura,
            moneda_base:    document.getElementById('cont-form-moneda')?.value || ((_empresaActiva?.moneda_principal)||'VES').toUpperCase(),
            tasa_bcv:       tasaReal,
            id_periodo:     idPeriodo,
            id_emisor:      fac.id_emisor || null,
            estado:         'APROBADO',
            id_usuario:     sesionActual.correo_usuario
          });

          if (asiento && asiento[0]) {
            const idAst = asiento[0].id_asiento;
            // Buscar cuentas contables
            const cuentas = await api('cont_cuentas','GET',null,
              '?codigo=in.(1.1.02.001,4.1.01.001,4.1.02.001,2.1.03.001)&select=id_cuenta,codigo');
            const cCxC     = cuentas.find(function(c){ return c.codigo==='1.1.02.001'; });
            const cIngServ = cuentas.find(function(c){ return c.codigo==='4.1.01.001'; });
            const cIngRep  = cuentas.find(function(c){ return c.codigo==='4.1.02.001'; });
            const cIVA     = cuentas.find(function(c){ return c.codigo==='2.1.03.001'; });

            // Línea 1: Débito CxC por el total
            // Buscar cuenta IGTF por pagar
            // Buscar cuenta IGTF por nombre
            const cuentasIGTF = fac.igtf_usd > 0
              ? await api('cont_cuentas','GET',null,'?nombre=ilike.%25IGTF%25por%25Pagar%25&estado=eq.ACTIVO&select=id_cuenta,codigo&limit=1')
              : [];
            let cIGTF = cuentasIGTF[0] || null;
            if (!cIGTF && fac.igtf_usd > 0) {
              const igtfPorCodigo = await api('cont_cuentas','GET',null,'?codigo=eq.2.1.03.004&select=id_cuenta,codigo');
              cIGTF = igtfPorCodigo[0] || null;
            }

            // VEN-NIF: Moneda funcional = Bs. USD como auxiliar
          const auxFac = ' (USD × '+tasaReal.toFixed(4)+')';
          // Línea 1: Débito CxC — en Bs, auxiliar USD
            if (cCxC) await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cCxC.id_cuenta, orden: 1,
              descripcion: 'CxC '+fac.numero_factura+auxFac,
              debe_usd: fac.total_usd, haber_usd: 0,
              debe_ves: fac.total_usd * tasaReal, haber_ves: 0
            });
            // Línea 2: Crédito Ingresos — en Bs, auxiliar USD
            if (cIngServ) await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cIngServ.id_cuenta, orden: 2,
              descripcion: 'Ingreso '+fac.numero_factura+auxFac,
              debe_usd: 0, haber_usd: fac.subtotal_usd,
              debe_ves: 0, haber_ves: fac.subtotal_usd * tasaReal
            });
            // Línea 3: Crédito IVA — en Bs
            if (cIVA && fac.iva_usd > 0) await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cIVA.id_cuenta, orden: 3,
              descripcion: 'IVA '+fac.numero_factura+auxFac,
              debe_usd: 0, haber_usd: fac.iva_usd,
              debe_ves: 0, haber_ves: fac.iva_usd * tasaReal
            });
            // Línea 4: Crédito IGTF — en Bs
            if (cIGTF && fac.igtf_usd > 0) await api('cont_asiento_lineas','POST',{
              id_asiento: idAst, id_cuenta: cIGTF.id_cuenta, orden: 4,
              descripcion: 'IGTF '+fac.numero_factura+auxFac,
              debe_usd: 0, haber_usd: fac.igtf_usd,
              debe_ves: 0, haber_ves: fac.igtf_usd * tasaReal
            });
          }
        } catch(eAst) { console.warn('Error creando asiento:', eAst); }
      }
    }

    okEl.textContent = emitir ? '✓ Factura emitida correctamente.' : '✓ Factura guardada como borrador.';
    okEl.style.display='block';
    setTimeout(function() { cerrarModal('modal-factura'); renderFacturas(); }, 1200);
  } catch(err) { errEl.textContent='Error: '+err.message; errEl.style.display='block'; }
}

async function verFichaFactura(id) {
  try {
    const [facArr] = await Promise.all([
      api('facturas','GET',null,'?id_factura=eq.'+id+'&select=*,emisores(*),propietarios(nombre_completo,tipo_doc,numero_doc)'),
    ]);
    const f = facArr[0]; if (!f) return;
    let linServ=[], linRep=[];
    if (f.id_orden) {
      [linServ,linRep] = await Promise.all([
        api('os_servicios','GET',null,'?id_orden=eq.'+f.id_orden+'&select=*'),
        api('os_repuestos','GET',null,'?id_orden=eq.'+f.id_orden+'&select=*'),
      ]);
    }
    const est    = ESTADOS_FAC[f.estado]||{clase:'badge-gris',label:f.estado};
    const emisor = f.emisores;
    const esVES  = f.moneda_cobro==='VES';
    const t      = parseFloat(f.tasa_cambio||1);
    function fmtF(usd) { return esVES ? fmtBs(usd*t)+' Bs' : '$ '+fmtUSD(usd); }

    const tablaLineas = [...linServ.map(function(l){return{desc:l.descripcion,tipo:'Serv.',cant:l.cantidad,precio:l.precio_usd,sub:l.subtotal_usd};}),
                         ...linRep.map(function(l) {return{desc:l.descripcion,tipo:'Rep.', cant:l.cantidad,precio:l.precio_usd,sub:l.subtotal_usd};})]
      .map(function(l) {
        return '<tr><td style="padding:6px 0;font-size:12px">'+l.desc+'</td>'
          + '<td style="text-align:center;padding:6px"><span class="badge badge-gris" style="font-size:11px">'+l.tipo+'</span></td>'
          + '<td style="text-align:center;font-family:var(--font-mono);font-size:12px">'+l.cant+'</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px">'+fmtF(l.precio)+'</td>'
          + '<td style="text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--naranja)">'+fmtF(l.sub)+'</td></tr>';
      }).join('');

    document.getElementById('ficha-fac-contenido').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">'
      + '<div><div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">'+(f.numero_factura||'—')+'</div>'
      + '<span class="badge '+est.clase+'">'+est.label+'</span>'
      + '<div style="font-size:11px;color:var(--suave);margin-top:4px">Fecha: '+(f.fecha_emision||'—')+'</div></div>'
      + (puedo('FACTURAS','VER_TOTALES')
          ? '<div style="text-align:right"><div style="font-size:9px;color:var(--suave);letter-spacing:2px;text-transform:uppercase">TOTAL</div>'
            + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">'+fmtF(f.total_usd)+'</div>'
            + (esVES ? '<div style="font-size:11px;color:var(--suave)">Tasa: '+t.toFixed(2)+' Bs/$</div>' : '')
            + '<div style="font-size:10px;color:#555;margin-top:3px">'+(f.moneda_cobro||'USD')+'</div></div>'
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
                return '<div style="display:flex;flex-direction:column;gap:5px;font-size:12px">'
                  + '<div style="display:flex;justify-content:space-between"><span style="color:var(--suave)">Subtotal</span><span style="font-family:var(--font-mono)">'+fmtF(f.subtotal_usd)+'</span></div>'
                  + (f.aplica_iva  ? '<div style="display:flex;justify-content:space-between"><span style="color:var(--suave)">IVA (16%)</span><span style="font-family:var(--font-mono)">'+fmtF(f.iva_usd)+'</span></div>' : '')
                  + (f.aplica_igtf ? '<div style="display:flex;justify-content:space-between"><span style="color:var(--suave)">IGTF (3%)</span><span style="font-family:var(--font-mono)">'+fmtF(f.igtf_usd)+'</span></div>' : '')
                  + '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--borde);padding-top:6px;font-weight:600"><span>Total</span><span style="font-family:var(--font-mono);color:var(--naranja)">'+fmtF(f.total_usd)+'</span></div>'

                  + '</div>';
              })()
            + '</div>'
          : '')
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
    var btnAnular   = document.getElementById('ficha-fac-btn-anular');
    var btnPago     = document.getElementById('ficha-fac-btn-pago');
    var btnEliminar = document.getElementById('ficha-fac-btn-eliminar');
    // Botón Aprobar
    await cargarFacultades();
    var btnAprobar = document.getElementById('ficha-fac-btn-aprobar');
    if (btnAprobar) {
      btnAprobar.style.display = (f.estado==='EMITIDA' && puedeAprobar('FACTURAS')) ? '' : 'none';
      btnAprobar.onclick = function() { aprobarFactura(f.id_factura); };
    }
    if (btnPago) {
      btnPago._id = f.id_factura;
      btnPago.style.display = (f.estado==='EMITIDA'||f.estado==='APROBADA'||f.estado==='PARCIAL') ? '' : 'none';
      btnPago._facId = f.id_factura;
      btnPago.onclick = async function() {
        try {
          const cxcs = await api('cont_cxc','GET',null,'?id_factura=eq.'+this._facId+'&estado=neq.ANULADA&select=*');
          if (cxcs && cxcs.length) {
            if (!contCxcCache) contCxcCache = [];
            cxcs.forEach(function(c) {
              const i = contCxcCache.findIndex(function(x){ return x.id_cxc===c.id_cxc; });
              if (i >= 0) contCxcCache[i] = c; else contCxcCache.push(c);
            });
            contRegistrarPagoCxc(cxcs[0].id_cxc);
          } else {
            alert('No se encontró la CxC asociada a esta factura.');
          }
        } catch(e) { alert('Error: ' + e.message); }
      };
    }
    if (btnEditar)  { btnEditar._id=f.id_factura;  btnEditar.onclick=function(){cerrarModal('modal-ficha-fac');abrirEditarFactura(this._id);}; btnEditar.style.display=puedo('FACTURAS','EDITAR')&&f.estado==='BORRADOR'?'':'none'; }
    if (btnEmitir)  { btnEmitir._id=f.id_factura;  btnEmitir.onclick=function(){emitirFactura(this._id);};   btnEmitir.style.display=puedo('FACTURAS','CREAR')&&f.estado==='BORRADOR'?'':'none'; }
    if (btnAnular)  { btnAnular._id=f.id_factura;  btnAnular._num=f.numero_factura; btnAnular.onclick=function(){anularFactura(this._id,this._num);}; btnAnular.style.display=puedo('FACTURAS','ANULAR')&&(f.estado==='EMITIDA'||f.estado==='PAGADA')?'':'none'; }
    if (btnEliminar){ btnEliminar._id=f.id_factura; btnEliminar._num=f.numero_factura; btnEliminar.onclick=function(){eliminarFactura(this._id,this._num);}; btnEliminar.style.display=puedo('FACTURAS','ELIMINAR')&&f.estado==='ANULADA'?'':'none'; }
    abrirModal('modal-ficha-fac');
  focusFirstField('modal-ficha-fac');
  } catch(err) { alert('Error: '+err.message); console.error(err); }
}

async function abrirEditarFactura(id) {
  const f = facturasCache.find(function(x){return x.id_factura===id;});
  if (!f||f.estado!=='BORRADOR') { alert('Solo se pueden editar facturas en Borrador.'); return; }
  await abrirNuevaFactura();
  setTimeout(async function() {
    document.getElementById('fac-id').value=''+f.id_factura;
    document.getElementById('fac-numero').textContent=f.numero_factura||'Borrador';
    document.getElementById('fac-emisor').value=f.id_emisor||'';
    document.getElementById('fac-fecha').value=f.fecha_emision||getHoyVzla();
    document.getElementById('fac-estado').value=f.estado;
    document.getElementById('fac-moneda').value=f.moneda_cobro||'USD';
    document.getElementById('fac-tasa').value=parseFloat(f.tasa_cambio||1).toFixed(4);
    document.getElementById('fac-receptor-nombre').value=f.receptor_nombre||'';
    document.getElementById('fac-receptor-rif').value=f.receptor_rif||'';
    document.getElementById('fac-receptor-dir').value=f.receptor_direccion||'';
    document.getElementById('fac-receptor-tipo-contrib').value=f.receptor_tipo_contribuyente||'';
    document.getElementById('fac-aplica-iva').checked=!!f.aplica_iva;
    document.getElementById('fac-aplica-igtf').checked=!!f.aplica_igtf;
    document.getElementById('fac-observaciones').value=f.observaciones||'';
    document.getElementById('modal-fac-titulo').textContent='EDITAR FACTURA — '+(f.numero_factura||'Borrador');
    onCambiarMonedaFactura();
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
  try { await api('facturas','PATCH',{estado:'EMITIDA'},'?id_factura=eq.'+id); cerrarModal('modal-ficha-fac'); renderFacturas(); }
  catch(err) { alert('Error: '+err.message); if (btnEmitir) { btnEmitir.disabled=false; btnEmitir.textContent='✓ Emitir'; } }
}

async function anularFactura(id, numero) {
  if (!confirm('¿Anular la factura '+numero+'? Esta acción no se puede deshacer.')) return;
  try {
    // Obtener la OS asociada antes de anular
    const facData = await api('facturas','GET',null,'?id_factura=eq.'+id+'&select=id_orden');
    await api('facturas','PATCH',{estado:'ANULADA'},'?id_factura=eq.'+id);
    // Liberar la OS para que pueda usarse en otra factura
    if (facData && facData[0] && facData[0].id_orden) {
      await api('facturas','PATCH',{id_orden:null},'?id_factura=eq.'+id);
    }
    // Anular CxC asociada
    try {
      await api('cont_cxc','PATCH',{estado:'ANULADA'},'?id_factura=eq.'+id);
    } catch(eCxc) { console.warn('Error anulando CxC:', eCxc); }
    cerrarModal('modal-ficha-fac');
    renderFacturas();
  }
  catch(err) { alert('Error: '+err.message); }
}

async function aprobarFactura(id) {
  if (!puedeAprobar('FACTURAS')) { alert('No tiene facultad para aprobar facturas.'); return; }
  if (!confirm('¿Confirma la aprobación de esta factura?')) return;
  try {
    await api('facturas','PATCH',{
      estado: 'APROBADA',
      aprobado_por: sesionActual.nombre || sesionActual.correo_usuario,
      fecha_aprobacion: new Date().toISOString()
    },'?id_factura=eq.'+id);
    cerrarModal('modal-ficha-fac');
    renderFacturas();
  } catch(e) { alert('Error: '+e.message); }
}

async function eliminarFactura(id, numero) {
  if (!confirm('¿Eliminar definitivamente la factura '+numero+'?\\nEsta acción no se puede deshacer.')) return;
  try { await api('facturas','DELETE',null,'?id_factura=eq.'+id); cerrarModal('modal-ficha-fac'); renderFacturas(); }
  catch(err) { alert('Error: '+err.message); }
}




// ─── ARTÍCULO ACTIVO EN FICHA ───
var _fichaInvActual = { id: null, nombre: '' };

function abrirStockArticulo(id, nombre) {
  if (!sesionActual?.administrador && !puedo('INVENTARIO','VER')) {
    alert('No tiene permiso.'); return;
  }
  const r = inventarioCache.find(function(x) { return x.id_articulo === id; });
  if (!r) return;
  _fichaInvActual = { id: r.id_articulo, nombre: r.nombre };

  document.getElementById('stock-art-nombre').textContent = r.nombre;
  document.getElementById('stock-art-stock').textContent  = r.stock_actual + ' ' + (r.unidad || 'UND');
  const ventaCont = document.getElementById('stock-art-venta-cont');
  if (puedo('INVENTARIO','VER_PRECIOS_VENTA')) {
    document.getElementById('stock-art-venta').textContent = '$ ' + fmtUSD(r.precio_venta_usd);
    if (ventaCont) ventaCont.style.display = '';
  } else {
    if (ventaCont) ventaCont.style.display = 'none';
  }

  const costoCont = document.getElementById('stock-art-costo-cont');
  const costoEl   = document.getElementById('stock-art-costo');
  if (puedo('INVENTARIO','VER_COSTOS')) {
    costoEl.textContent = '$ ' + fmtUSD(r.precio_costo_usd);
    costoCont.style.display = '';
  } else {
    costoCont.style.display = 'none';
  }

  // Permisos de botones
  document.getElementById('stock-btn-entrada').style.display  = puedo('INVENTARIO','ENTRADA_STOCK') ? '' : 'none';
  document.getElementById('stock-btn-salida').style.display   = puedo('INVENTARIO','SALIDA_STOCK')  ? '' : 'none';
  document.getElementById('stock-btn-historial').style.display = puedo('INVENTARIO','VER')          ? '' : 'none';

  abrirModal('modal-stock-articulo');
  focusFirstField('modal-stock-articulo');
}

async function regresarAFichaInv() {
  if (!_fichaInvActual.id) { renderInventario(); return; }
  try {
    // Actualizar cache con datos frescos
    const res = await api('inventario', 'GET', null, '?id_articulo=eq.' + _fichaInvActual.id + '&select=*');
    if (res && res[0]) {
      const i = inventarioCache.findIndex(function(x) { return x.id_articulo === _fichaInvActual.id; });
      if (i !== -1) inventarioCache[i] = res[0];
      else inventarioCache.push(res[0]);
    }
  } catch(e) {}
  // Recargar tabla del inventario general si está visible
  if (document.getElementById('tabla-inv-cont')) {
    invRenderVista(inventarioCache, _invVista);
  }
  // Regresar al modal de stock
  abrirStockArticulo(_fichaInvActual.id, _fichaInvActual.nombre);
}


// ─── FILTRO DE EMPRESA ACTIVA ───
function emisorQ() {
  return _empresaActiva ? '&id_emisor=eq.' + _empresaActiva.id_emisor : '';
}
function emisorQStart() {
  return _empresaActiva ? '?id_emisor=eq.' + _empresaActiva.id_emisor : '?';
}
// ─── FORMATO DE FECHA DD-MM-YYYY ───
function fmtFecha(fecha) {
  if (!fecha) return '—';
  const f = fecha.substring(0, 10); // YYYY-MM-DD
  const partes = f.split('-');
  if (partes.length !== 3) return fecha;
  return partes[2] + '-' + partes[1] + '-' + partes[0];
}

// ─── EMPRESAS CON ACCESO EN MODAL USUARIO ───
async function cargarEmpresasAccesoModal(correo) {
  const grid = document.getElementById('empresas-acceso-grid');
  if (!grid) return;
  try {
    const todasEmisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id_emisor,nombre,rif');
    let asignadas = new Set();
    if (correo) {
      const ues = await api('usuarios_empresas','GET',null,
        '?correo_usuario=eq.'+encodeURIComponent(correo)+'&activo=eq.true&select=id_emisor');
      ues.forEach(function(u){ asignadas.add(u.id_emisor); });
    }
    grid.innerHTML = todasEmisores.map(function(e) {
      const checked = (!correo || asignadas.has(e.id_emisor)) ? 'checked' : '';
      return '<label style="display:flex;align-items:center;gap:8px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;padding:8px 12px;cursor:pointer;font-size:12px">'
        + '<input type="checkbox" value="'+e.id_emisor+'" '+checked+' class="emp-acceso-check" style="accent-color:var(--naranja);width:15px;height:15px">'
        + '<div><div style="font-weight:600">'+e.nombre+'</div>'
        + (e.rif ? '<div style="font-size:10px;color:var(--suave)">'+e.rif+'</div>' : '')
        + '</div></label>';
    }).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color:var(--suave);font-size:12px">Error cargando empresas</div>';
  }
}

function getEmpresasAccesoSeleccionadas() {
  const checks = document.querySelectorAll('.emp-acceso-check:checked');
  return Array.from(checks).map(function(c){ return parseInt(c.value); });
}

// ─── HASHEAR CONTRASEÑA VIA RPC ───
async function hashearClave(clave) {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/hashear_clave', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_clave: clave })
    });
    return await res.json();
  } catch(e) {
    throw new Error('Error hasheando contraseña: ' + e.message);
  }
}

// ─── VERIFICAR CONTRASEÑA BCRYPT VIA SUPABASE ───
// Usa pgcrypto: crypt(clave_ingresada, hash_guardado) == hash_guardado
async function verificarContrasena(correoUsu, claveIngresada) {
  try {
    // Usar siempre anon key para login — JWT no disponible aún
    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json'
    };
    // Buscar usuario
    const res = await fetch(SUPABASE_URL + '/rest/v1/usuarios?correo_usuario=eq.' 
      + encodeURIComponent(correoUsu) 
      + '&select=correo_usuario,contrasena,estado_usuario,nombre,administrador', { headers });
    const data = await res.json();
    if (!data || !data.length) return { ok: false, msg: 'Usuario no encontrado.' };
    const usu = data[0];
    if (usu.estado_usuario === 'INACTIVO') return { ok: false, msg: 'Usuario inactivo.' };

    // Verificar bcrypt via RPC
    const resVerif = await fetch(SUPABASE_URL + '/rest/v1/rpc/verificar_clave', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ p_clave: claveIngresada, p_hash: usu.contrasena })
    });
    
    if (!resVerif.ok) {
      // Fallback: si RPC falla, intentar comparación directa (compatibilidad)
      console.warn('RPC verificar_clave falló, usando fallback');
      return { ok: false, msg: 'Error de autenticación. Contacte al administrador.' };
    }
    
    const valido = await resVerif.json();
    if (!valido) return { ok: false, msg: 'Contraseña incorrecta.' };
    return { ok: true, usuario: usu };
  } catch(e) {
    return { ok: false, msg: 'Error verificando contraseña: ' + e.message };
  }
}

// ─── VALIDAR CONTRASEÑA RECEPTOR ───
async function validarClaveReceptor(idEmpleado, clave) {
  if (!idEmpleado || !clave) return { ok: false, msg: 'Debe seleccionar un empleado receptor e ingresar su contraseña.' };
  try {
    // Buscar el correo del empleado
    const empArr = await api('empleados', 'GET', null, '?id_empleado=eq.' + idEmpleado + '&select=id_empleado,nombre_completo,correo');
    const emp = empArr[0];
    if (!emp) return { ok: false, msg: 'Empleado no encontrado.' };
    if (!emp.correo) return { ok: false, msg: 'El empleado receptor no tiene correo registrado en el sistema.' };

    // Buscar usuario por correo y validar contraseña
    const usuArr = await api('usuarios', 'GET', null,
      '?correo_usuario=ilike.' + encodeURIComponent(emp.correo) + '&estado_usuario=eq.ACTIVO&select=correo_usuario,contrasena,nombre');
    const usu = usuArr[0];
    if (!usu) return { ok: false, msg: 'El empleado "' + emp.nombre_completo + '" no tiene usuario activo en el sistema.' };
    const verifRec = await verificarContrasena(usu.correo_usuario, clave);
    if (!verifRec.ok) return { ok: false, msg: 'Contraseña incorrecta para el receptor "' + emp.nombre_completo + '".' };

    return { ok: true, nombre: emp.nombre_completo };
  } catch(err) {
    return { ok: false, msg: 'Error validando receptor: ' + err.message };
  }
}

// ─── CARGAR EMPLEADOS POR ÁREA ───
async function cargarEmpleadosPorArea(idArea, selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  if (!idArea) {
    sel.innerHTML = '<option value="">— Seleccionar área primero —</option>';
    return;
  }
  sel.innerHTML = '<option value="">Cargando...</option>';
  try {
    const emps = await api('empleados', 'GET', null,
      '?id_area=eq.' + idArea + '&estatus=eq.ACTIVO&order=nombre_completo.asc&select=id_empleado,nombre_completo,id_cargo,param_cargos(nombre)');
    if (!emps.length) {
      sel.innerHTML = '<option value="">— Sin empleados en esta área —</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Seleccionar empleado —</option>'
      + emps.map(function(e) {
          return '<option value="' + e.id_empleado + '">'
            + e.nombre_completo
            + (e.param_cargos ? ' · ' + e.param_cargos.nombre : '')
            + '</option>';
        }).join('');
  } catch(err) {
    sel.innerHTML = '<option value="">— Error cargando empleados —</option>';
  }
}

function onSelAreaSalida() {
  const idArea = document.getElementById('salida-area')?.value;
  cargarEmpleadosPorArea(parseInt(idArea)||null, 'salida-empleado');
}

function onSelAreaEntrega() {
  const idArea = document.getElementById('salida-area-entrega')?.value;
  cargarEmpleadosPorArea(parseInt(idArea)||null, 'salida-empleado-entrega');
}

function onSelAreaEntrada() {
  const idArea = document.getElementById('es-area')?.value;
  cargarEmpleadosPorArea(parseInt(idArea)||null, 'es-empleado');
}

async function onCambiarMonedaEntrada() {
  const moneda   = document.getElementById('es-moneda-compra')?.value || 'USD';
  // Actualizar labels de moneda
  const lblCompra = document.getElementById('es-label-moneda-compra');
  const lblVenta  = document.getElementById('es-label-moneda-venta');
  if (lblCompra) lblCompra.textContent = '(' + moneda + ')';
  if (lblVenta)  lblVenta.textContent  = '(' + moneda + ')';
  const tasaCont = document.getElementById('es-tasa-cont');
  const usdCont  = document.getElementById('es-precio-usd-cont');
  const esVES    = moneda === 'VES';

  if (tasaCont) tasaCont.style.display  = esVES ? '' : 'none';
  if (usdCont)  usdCont.style.display   = esVES ? '' : 'none';

  if (esVES) {
    // Buscar tasa BCV del día de la entrada
    const fecha = document.getElementById('es-fecha-entrada')?.value || getHoyVzla();
    try {
      // Buscar tasa del mismo día o la más reciente anterior
      const tasas = await api('tasas', 'GET', null,
        '?fecha_valor=lte.' + fecha + '&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
      if (tasas && tasas.length) {
        document.getElementById('es-tasa-bcv').value = parseFloat(tasas[0].tipo_cambio).toFixed(2);
        document.getElementById('es-ref-cpp').textContent = 'Tasa BCV: ' + parseFloat(tasas[0].tipo_cambio).toFixed(2) + ' Bs/$ (' + tasas[0].fecha_valor + ')';
      } else {
        document.getElementById('es-tasa-bcv').value = '';
        document.getElementById('es-ref-cpp').textContent = 'No se encontró tasa BCV para esta fecha';
      }
    } catch(e) {}
    onCambiarPrecioEntrada();
  }
}

function onCambiarPrecioEntrada() {
  const moneda = document.getElementById('es-moneda-compra')?.value || 'USD';
  if (moneda !== 'VES') return;
  const precioVES = parseFloat(document.getElementById('es-precio-costo')?.value) || 0;
  const tasa      = parseFloat(document.getElementById('es-tasa-bcv')?.value) || 0;
  const elUSD     = document.getElementById('es-precio-usd-calc');
  if (elUSD) {
    elUSD.value = tasa > 0 ? (precioVES / tasa).toFixed(2) : '';
  }
}

function onCambiarMotivoEntrada() {
  const motivo = document.getElementById('es-motivo')?.value;
  const contProv     = document.getElementById('es-campo-proveedor-cont');
  const contCliente  = document.getElementById('es-campo-cliente-cont');
  const contTransf   = document.getElementById('es-campo-transferencia-cont');
  if (!contProv) return;

  // Ocultar todos
  contProv.style.display    = 'none';
  contCliente.style.display = 'none';
  contTransf.style.display  = 'none';

  // Mostrar el correspondiente
  if (motivo === 'compra') {
    contProv.style.display = '';
    contProv.querySelector('label').textContent = 'Proveedor *';
  } else if (motivo === 'devolucion') {
    contCliente.style.display = '';
  } else if (motivo === 'transferencia') {
    contTransf.style.display = '';
  }
  // ajuste y otro: ningún campo adicional
}

// ─── SALIDA DE STOCK ───
async function abrirSalidaStock(id, nombre) {
  if (!puedo('INVENTARIO','SALIDA_STOCK')) { alert('No tiene permiso para registrar salidas de stock.'); return; }

  // Cargar áreas
  let areas = [];
  try { areas = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}

  document.getElementById('salida-art-nombre').textContent = nombre;
  document.getElementById('salida-id-repuesto').value      = id;
  document.getElementById('salida-cantidad').value         = '';
  document.getElementById('salida-fecha').value            = getHoyVzla();
  document.getElementById('salida-observaciones').value    = '';
  document.getElementById('alerta-salida-ok').style.display  = 'none';
  document.getElementById('alerta-salida-err').style.display = 'none';
  // Limpiar campos de contraseña
  var claveEnt = document.getElementById('salida-clave-entrega');
  if (claveEnt) { claveEnt.value = ''; claveEnt.type = 'password'; }

  // Llenar áreas
  const selArea = document.getElementById('salida-area');
  selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
    + areas.map(function(a) {
        return '<option value="' + a.id + '">'
          + (a.codigo ? a.codigo + ' — ' : '') + a.nombre + '</option>';
      }).join('');
  // Llenar también área que entrega
  const optsAreas = '<option value="">— Seleccionar área —</option>'
    + areas.map(function(a) {
        return '<option value="' + a.id + '">'
          + (a.codigo ? a.codigo + ' — ' : '') + a.nombre + '</option>';
      }).join('');
  document.getElementById('salida-area-entrega').innerHTML = optsAreas;
  document.getElementById('salida-empleado').innerHTML = '<option value="">— Seleccionar área primero —</option>';
  document.getElementById('salida-empleado-entrega').innerHTML = '<option value="">— Seleccionar área primero —</option>';




  // Mostrar stock actual
  const art = inventarioCache.find(function(x) { return x.id_articulo === id; });
  document.getElementById('salida-stock-actual').textContent = art
    ? art.stock_actual + ' ' + (art.unidad || 'UND') : '—';

  abrirModal('modal-salida-stock');
  focusFirstField('modal-salida-stock');
  setTimeout(function() { document.getElementById('salida-cantidad')?.focus(); }, 100);
}

async function guardarSalidaStock() {
  if (!puedo('INVENTARIO','SALIDA_STOCK')) { alert('No tiene permiso.'); return; }

  const idRep   = parseInt(document.getElementById('salida-id-repuesto').value);
  const idArea  = parseInt(document.getElementById('salida-area').value) || null;
  const cantidad = parseFloat(document.getElementById('salida-cantidad').value);
  const fecha   = document.getElementById('salida-fecha').value;
  const obs     = document.getElementById('salida-observaciones').value.trim();
  const okEl    = document.getElementById('alerta-salida-ok');
  const errEl   = document.getElementById('alerta-salida-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!idArea)          { errEl.textContent = 'Debe seleccionar el Área receptora.'; errEl.style.display = 'block'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor a cero.'; errEl.style.display = 'block'; return; }
  if (!fecha)           { errEl.textContent = 'La fecha es obligatoria.'; errEl.style.display = 'block'; return; }

  // Validar contraseña del empleado que ENTREGA
  const idEmpEntrega  = parseInt(document.getElementById('salida-empleado-entrega')?.value) || null;
  const claveEntrega  = document.getElementById('salida-clave-entrega')?.value || '';
  if (!idEmpEntrega) {
    errEl.textContent = 'Debe seleccionar el empleado que entrega.';
    errEl.style.display = 'block'; return;
  }
  if (!claveEntrega) {
    errEl.textContent = 'El empleado que entrega debe ingresar su contraseña.';
    errEl.style.display = 'block';
    document.getElementById('salida-clave-entrega')?.focus(); return;
  }
  const validEntrega = await validarClaveReceptor(idEmpEntrega, claveEntrega);
  if (!validEntrega.ok) {
    errEl.textContent = validEntrega.msg;
    errEl.style.display = 'block';
    document.getElementById('salida-clave-entrega')?.focus(); return;
  }

  // Validar stock disponible
  const art = inventarioCache.find(function(x) { return x.id_articulo === idRep; });
  if (art && cantidad > art.stock_actual) {
    errEl.textContent = 'La cantidad supera el stock disponible (' + art.stock_actual + ' ' + (art.unidad||'UND') + ').';
    errEl.style.display = 'block'; return;
  }

  try {
    // Registrar salida
    const idEmpRecibe    = parseInt(document.getElementById('salida-empleado')?.value) || null;
    const idAreaEntrega  = parseInt(document.getElementById('salida-area-entrega')?.value) || null;
    const salidaRes = await api('stock_salidas', 'POST', {
      id_articulo:        idRep,
      id_area:            idArea,
      id_empleado:        idEmpRecibe,
      id_area_entrega:    idAreaEntrega,
      id_empleado_entrega: idEmpEntrega,
      cantidad:           cantidad,
      fecha_salida:       fecha,
      observaciones:      obs || null,
      id_usuario:         sesionActual.correo_usuario
    });
    const idSalida = salidaRes && salidaRes[0] ? salidaRes[0].id_salida : null;

    // Descontar del stock_actual
    const nuevoStock = (art ? art.stock_actual : 0) - cantidad;
    await api('inventario', 'PATCH', { stock_actual: nuevoStock }, '?id_articulo=eq.' + idRep);

    // Actualizar cache
    if (art) art.stock_actual = nuevoStock;

    // ── Generar asiento contable de salida ──
    try {
      const areaNombreSal = document.getElementById('salida-area')?.selectedOptions[0]?.text || 'Área';
      const areaIdSal     = parseInt(document.getElementById('salida-area')?.value) || null;
      const art = inventarioCache.find(function(x){ return x.id_articulo === idRep; });
      const costoUnit = art ? parseFloat(art.precio_costo_usd || 0) : 0;
      await generarAsientoInventario('SALIDA_AREA', {
        articulo:   art ? (art.nombre || art.codigo) : ('Art#'+idRep),
        cantidad:   cantidad,
        montoUSD:   costoUnit * cantidad,
        areaId:     areaIdSal,
        areaNombre: areaNombreSal,
        referencia: idSalida ? 'SAL-' + idSalida : 'SAL-INV-' + idRep
      });
    } catch(eAstSal) { console.warn('Error asiento salida inventario:', eAstSal); }

    okEl.textContent = '✓ Salida de ' + cantidad + ' unidades registrada correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-salida-stock'); regresarAFichaInv(); }, 1500);
  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
  }
}


