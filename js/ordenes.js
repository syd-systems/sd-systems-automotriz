// ─── S&D Systems — Módulo: ORDENES ───
// ══════════════════════════════════════════════════════════════
//  FASE 3 — ÓRDENES DE SERVICIO
// ══════════════════════════════════════════════════════════════
let ordenesCache = [];
let osServiciosLineas = [];  // líneas de servicios de la OS activa
let osRepuestosLineas = [];  // líneas de repuestos de la OS activa
// ─── fmtBs / fmtUSD / fmtVES definidas globalmente en core.js ───

let tasaActualOS = 1;        // tasa USD→VES al crear/editar OS

const ESTADOS_OS = {
  'ABIERTA':          { clase: 'badge-naranja', label: 'Abierta' },
  'EN_PROCESO':       { clase: 'badge-verde',   label: 'En Proceso' },
  'ESPERA_REPUESTO':  { clase: 'badge-rojo',    label: 'Espera Repuesto' },
  'CERRADA':          { clase: 'badge-gris',    label: 'Cerrada' },
  'ANULADA':          { clase: 'badge-rojo',    label: 'Anulada' },
};

async function renderOrdenes() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('SERVICIOS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando órdenes...</div>';
  try {
    const [ordenes, tasas] = await Promise.all([
      api('ordenes_servicio', 'GET', null,
        '?order=fecha_registro.desc&select=*,vehiculos(placa,marca,modelo),propietarios(nombre_completo)'+emisorQ()),
      api('tasas', 'GET', null, '?order=fecha_registro.desc&limit=1&select=tipo_cambio'),
    ]);
    ordenesCache = ordenes;
    if (tasas.length) tasaActualOS = parseFloat(tasas[0].tipo_cambio);

    // Resetear filtros al cargar el módulo
    window._osFechaDesde   = '';
    window._osFechaHasta   = '';
    window._osEstadoFiltro = '';
    window._osBuscar       = '';

    // Filtros
    const filtroEstado = (window._osEstadoFiltro || '');

    const ordenesFiltradas = filtroEstado
      ? ordenes.filter(function(o) { return o.estado === filtroEstado; })
      : ordenes;

    const filas = ordenesFiltradas.map(function(o) {
      const est = ESTADOS_OS[o.estado] || { clase: 'badge-gris', label: o.estado };
      const veh = o.vehiculos;
      const prop = o.propietarios;
      return '<tr data-id="' + o.id_orden + '" data-estado="' + (o.estado||'') + '" data-fecha="' + (o.fecha_entrada ? o.fecha_entrada.substring(0,10) : '') + '">'
        + '<td><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + (o.numero_os || '—') + '</div>'
        + '<div style="font-size:11px;color:var(--suave)">' + fmtFecha(o.fecha_entrada) + '</div></td>'
        + '<td>' + (veh ? '<div style="font-weight:500">' + veh.placa + '</div><div style="font-size:11px;color:var(--suave)">' + veh.marca + ' ' + veh.modelo + '</div>' : '—') + '</td>'
        + '<td>' + (prop ? prop.nombre_completo : '—') + '</td>'
        + '<td><span class="badge ' + est.clase + '">' + est.label + '</span>'
        + (o.fecha_estado ? '<div style="font-size:10px;color:var(--suave);margin-top:3px">' + fmtFecha(o.fecha_estado) + '</div>' : '')
        + '</td>'
        + (puedo('SERVICIOS','VER_TOTALES')
            ? '<td style="font-family:var(--font-mono)"><span style="color:var(--naranja)">$ ' + fmtUSD(o.total_usd) + '</span>'
              + '<div style="font-size:10px;color:var(--suave)">' + fmtBs(o.total_ves) + ' Bs</div></td>'
            : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
        + '<td><div style="display:flex;gap:6px;flex-wrap:wrap">'
        + '<button class="btn-secundario" onclick="verFichaOS(' + o.id_orden + ')">Ver</button>'
        + (o.stock_actual === 0 && puedo('SERVICIOS','ELIMINAR') ? '<button class="btn-secundario" style="color:#fc8181;border-color:rgba(252,129,129,0.4);font-size:11px;padding:3px 8px" onclick="eliminarOS(' + o.id_orden + ')">🗑</button>' : '')
        + '</div></td>'
        + '</tr>';
    }).join('');

    const resumen = {
      ABIERTA:         ordenes.filter(function(o) { return o.estado === 'ABIERTA'; }).length,
      EN_PROCESO:      ordenes.filter(function(o) { return o.estado === 'EN_PROCESO'; }).length,
      ESPERA_REPUESTO: ordenes.filter(function(o) { return o.estado === 'ESPERA_REPUESTO'; }).length,
      CERRADA:         ordenes.filter(function(o) { return o.estado === 'CERRADA'; }).length,
      ANULADA:         ordenes.filter(function(o) { return o.estado === 'ANULADA'; }).length,
    };

    c.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px">'
      + Object.entries(resumen).map(function(entry) {
          var k = entry[0], v = entry[1];
          var est = ESTADOS_OS[k];
          var activo = window._osEstadoFiltro === k ? ';border-color:var(--naranja)' : '';
          return '<div class="tarjeta-stat" style="padding:16px;cursor:pointer' + activo + '" onclick="window._osEstadoFiltro=\'' + k + '\';renderOrdenes()">'
            + '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">' + est.label + '</div>'
            + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + v + '</div>'
            + '</div>';
        }).join('')
      + '<div class="tarjeta-stat" style="padding:16px;cursor:pointer;' + (!window._osEstadoFiltro ? 'border-color:var(--naranja)' : '') + '" onclick="window._osEstadoFiltro=\'\';renderOrdenes()">'
      + '<div style="font-size:11px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Todas</div>'
      + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + ordenes.length + '</div>'
      + '</div></div>'

      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:12px">'
      + '<h3 style="white-space:nowrap">Órdenes de Servicio</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">'
      + '<span style="font-size:11px;color:var(--suave)">Desde</span>'
      + '<input type="date" id="os-fecha-desde" value="' + (window._osFechaDesde||'') + '" onchange="limpiarBuscarOS();window._osFechaDesde=this.value;filtrarTablaOS()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:7px 10px;border-radius:5px;outline:none">'
      + '<span style="font-size:11px;color:var(--suave)">Hasta</span>'
      + '<input type="date" id="os-fecha-hasta" value="' + (window._osFechaHasta||'') + '" onchange="limpiarBuscarOS();window._osFechaHasta=this.value;filtrarTablaOS()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:7px 10px;border-radius:5px;outline:none">'
      + '</div>'



      + '<select id="os-filtro-estado" onchange="limpiarBuscarOS();window._osEstadoFiltro=this.value;filtrarTablaOS()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:7px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + Object.entries(ESTADOS_OS).map(function(e) {
          return '<option value="' + e[0] + '"' + (window._osEstadoFiltro === e[0] ? ' selected' : '') + '>' + e[1].label + '</option>';
        }).join('')
      + '</select>'
      + '<input type="text" id="os-buscar" placeholder="Buscar N° OS, vehículo, propietario..." '
      + 'value="' + (window._osBuscar || '') + '" '
      + 'oninput="buscarOS(this.value)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:220px">'
      + (puedo('SERVICIOS','CREAR') ? '<button class="btn-primario" onclick="abrirNuevaOS()">+ Nueva OS</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container"><table id="os-tabla"><thead><tr>'
      + '<th>N° OS / Fecha</th><th>Vehículo</th><th>Propietario</th><th>Estado</th><th>Total</th><th>Acción</th>'
      + '</tr></thead><tbody id="os-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">Sin órdenes registradas</td></tr>')
      + '</tbody></table></div></div>';
  } catch(e) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

// ─── FILTRO EN TIEMPO REAL DE TABLA OS ───

function limpiarBuscarOS() {
  window._osBuscar = '';
  var sb = document.getElementById('os-buscar');
  if (sb) sb.value = '';
}

function limpiarFiltrosOS() {
  window._osBuscar       = '';
  window._osFechaDesde   = '';
  window._osFechaHasta   = '';
  window._osEstadoFiltro = '';
  var sb = document.getElementById('os-buscar');      if (sb) sb.value = '';
  var fd = document.getElementById('os-fecha-desde'); if (fd) fd.value = '';
  var fh = document.getElementById('os-fecha-hasta'); if (fh) fh.value = '';
  var fe = document.getElementById('os-filtro-estado'); if (fe) fe.value = '';
  filtrarTablaOS();
}

// Limpiar filtros con Escape según módulo activo
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (document.getElementById('os-buscar'))  { limpiarFiltrosOS();  return; }
    if (document.getElementById('fac-buscar')) { limpiarFiltrosFac(); return; }
  }
});

function buscarOS(valor) {
  // Al buscar por texto, limpiar fechas y estado
  window._osBuscar       = valor;
  window._osFechaDesde   = '';
  window._osFechaHasta   = '';
  window._osEstadoFiltro = '';
  // Limpiar los controles visuales
  var fd = document.getElementById('os-fecha-desde');
  var fh = document.getElementById('os-fecha-hasta');
  var fe = document.getElementById('os-filtro-estado');
  if (fd) fd.value = '';
  if (fh) fh.value = '';
  if (fe) fe.value = '';
  filtrarTablaOS();
}

function filtrarTablaOS() {
  const estado  = (window._osEstadoFiltro || '').toUpperCase();
  const buscar  = (window._osBuscar || '').toLowerCase().trim();
  const tbody   = document.getElementById('os-tbody');
  if (!tbody) return;

  const filas = Array.from(tbody.querySelectorAll('tr[data-id]'));
  let visibles = 0;

  filas.forEach(function(tr) {
    const oId    = parseInt(tr.dataset.id);
    const o      = ordenesCache.find(function(x) { return x.id_orden === oId; });
    if (!o) { tr.style.display = 'none'; return; }

    const desde = window._osFechaDesde || '';
    const hasta  = window._osFechaHasta || '';
    const fechaOS = (o.fecha_entrada || '').substring(0,10);

    const matchEstado = !estado || o.estado === estado;
    const matchDesde  = !desde  || fechaOS >= desde;
    const matchHasta  = !hasta  || fechaOS <= hasta;
    const hayBusqueda = buscar.length > 0;
    const matchBuscar = !hayBusqueda || [
      o.numero_os || '',
      (o.vehiculos ? o.vehiculos.placa + ' ' + o.vehiculos.marca + ' ' + o.vehiculos.modelo : ''),
      (o.propietarios ? o.propietarios.nombre_completo : ''),
    ].some(function(s) { return s.toLowerCase().includes(buscar); });

    const visible = matchEstado && matchDesde && matchHasta && matchBuscar;
    tr.style.display = visible ? '' : 'none';
    if (visible) visibles++;
  });

  // Mostrar mensaje si no hay resultados
  let noResultEl = document.getElementById('os-no-results');
  if (!noResultEl) {
    noResultEl = document.createElement('tr');
    noResultEl.id = 'os-no-results';
    noResultEl.innerHTML = '<td colspan="6" style="text-align:center;color:var(--suave);padding:32px">Sin resultados para la búsqueda</td>';
    tbody.appendChild(noResultEl);
  }
  noResultEl.style.display = visibles === 0 ? '' : 'none';
}

// ─── VALIDACIÓN DE FECHAS OS ───
function getHoyVzla() {
  const _vzla = new Date(new Date().getTime() - 4 * 60 * 60 * 1000);
  return _vzla.toISOString().split('T')[0];
}

function onCambioEstadoOS(estado) {
  const cierreCont   = document.getElementById('os-fecha-cierre-cont');
  const anulaCont    = document.getElementById('os-fecha-anulacion-cont');
  if (cierreCont)  cierreCont.style.display  = (estado === 'CERRADA')  ? '' : 'none';
  if (anulaCont)   anulaCont.style.display   = (estado === 'ANULADA')  ? '' : 'none';
  // Si cambia a otro estado, limpiar fechas
  if (estado !== 'CERRADA')  { var fc = document.getElementById('os-fecha-cierre');   if (fc) fc.value = ''; }
  if (estado !== 'ANULADA')  { var fa = document.getElementById('os-fecha-anulacion'); if (fa) fa.value = ''; }
}

function validarFechaEntradaOS(input) {
  const hoy = getHoyVzla();
  const esAdmin = sesionActual && sesionActual.administrador;
  if (input.value > hoy) {
    if (!esAdmin) {
      mostrarAlertaFecha('La fecha de entrada no puede ser posterior a hoy (' + formatearFechaCorta(hoy) + ').');
      input.value = hoy;
    } else {
      // Admin puede forzar — solo advierte
      if (!confirm('⚠ La fecha de entrada es posterior a hoy. ¿Confirmar como administrador?')) {
        input.value = hoy;
      }
    }
  }
}

function validarFechaPrometidaOS(input) {
  const hoy = getHoyVzla();
  const esAdmin = sesionActual && sesionActual.administrador;
  if (input.value && input.value < hoy) {
    if (!esAdmin) {
      mostrarAlertaFecha('La fecha prometida no puede ser anterior a hoy (' + formatearFechaCorta(hoy) + ').');
      input.value = '';
    } else {
      if (!confirm('⚠ La fecha prometida es anterior a hoy. ¿Confirmar como administrador?')) {
        input.value = '';
      }
    }
  }
}

function formatearFechaCorta(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr + 'T12:00:00');
  return d.toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function mostrarAlertaFecha(msg) {
  const errEl = document.getElementById('alerta-os-err');
  if (errEl) {
    errEl.textContent = '⚠ ' + msg;
    errEl.style.display = 'block';
    setTimeout(function() { errEl.style.display = 'none'; }, 4000);
  } else {
    alert(msg);
  }
}

let tasasDisponiblesOS = { USD: 1, EUR: 1 };

function cambiarTipoTasaOS(moneda) {
  tasaActualOS = tasasDisponiblesOS[moneda] || 1;
  const labelMap = { USD: '$', EUR: '€' };
  const tasaEl = document.getElementById('os-tasa');
  const monedaEl = document.getElementById('os-moneda-label');
  if (tasaEl) tasaEl.textContent = tasaActualOS.toFixed(2);
  if (monedaEl) monedaEl.textContent = labelMap[moneda] || '$';
  calcularTotalesOS();
}

// ─── ABRIR NUEVA OS ───
async function abrirNuevaOS() {
  setTimeout(function() {
    const body = document.querySelector('#modal-os .modal-body');
    if (body) body.scrollTop = 0;
  }, 80);
  osServiciosLineas = [];
  osRepuestosLineas = [];

  // Obtener tasas vigentes (USD y EUR)
  try {
    const tasasDB = await api('tasas', 'GET', null, '?order=fecha_valor.desc&limit=10&select=*');
    const hoy = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];

    function getTasaOS(moneda) {
      const reg = tasasDB.filter(function(t) {
        return t.moneda_origen === moneda &&
          String(t.fecha_valor || '').substring(0,10) <= hoy;
      }).sort(function(a,b) {
        const fa = String(a.fecha_valor||'').substring(0,10);
        const fb = String(b.fecha_valor||'').substring(0,10);
        if (fb !== fa) return fb.localeCompare(fa);
        return (b.id_tasa||0) - (a.id_tasa||0);
      });
      return reg.length ? parseFloat(reg[0].tipo_cambio) : 1;
    }

    tasasDisponiblesOS.USD = getTasaOS('USD');
    tasasDisponiblesOS.EUR = getTasaOS('EUR');
    tasaActualOS = tasasDisponiblesOS.USD;
  } catch(e) { tasaActualOS = 1; }

  document.getElementById('os-id').value = '';
  document.getElementById('os-numero').textContent = 'Se asignará al guardar';
  document.getElementById('os-placa-bus').value = '';
  document.getElementById('os-veh-id').value = '';
  document.getElementById('os-veh-info').innerHTML = '';
  document.getElementById('os-km').value = '';
  const hoyOS = getHoyVzla();
  document.getElementById('os-fecha-entrada').value = hoyOS;
  document.getElementById('os-fecha-entrada').max = sesionActual.administrador ? '' : hoyOS;
  document.getElementById('os-fecha-prometida').value = '';
  document.getElementById('os-fecha-cierre').value    = '';
  document.getElementById('os-fecha-anulacion').value = '';
  onCambioEstadoOS('ABIERTA');
  document.getElementById('os-fecha-prometida').min = sesionActual.administrador ? '' : hoyOS;
  document.getElementById('os-estado').value = 'ABIERTA';
  document.getElementById('os-diagnostico').value = '';
  document.getElementById('os-observaciones').value = '';
  const tasaUsdEl = document.getElementById('os-tasa-usd');
  const tasaEurEl = document.getElementById('os-tasa-eur');
  if (tasaUsdEl) tasaUsdEl.textContent = tasasDisponiblesOS.USD.toFixed(2);
  if (tasaEurEl) tasaEurEl.textContent = tasasDisponiblesOS.EUR.toFixed(2);
  document.getElementById('alerta-os-ok').style.display = 'none';
  document.getElementById('alerta-os-err').style.display = 'none';
  document.getElementById('modal-os-titulo').textContent = 'NUEVA ORDEN DE SERVICIO';

  renderLineasOS();
  renderLineasRep();
  calcularTotalesOS();
  await cargarSelectsOS();
  // Resetear grupo al abrir modal
  const grpSel = document.getElementById('os-sel-grupo-cat');
  if (grpSel) grpSel.value = '';
  abrirModal('modal-os');
  focusFirstField('modal-os');
}

// ─── ABRIR EDITAR OS ───
async function abrirEditarOS(id) {
  setTimeout(function() {
    const body = document.querySelector('#modal-os .modal-body');
    if (body) body.scrollTop = 0;
  }, 80);
  // Refrescar OS desde Supabase antes de editar
  try {
    const fresh = await api('ordenes_servicio', 'GET', null,
      '?id_orden=eq.' + id + '&select=*,vehiculos(placa,marca,modelo),propietarios(nombre_completo)');
    if (fresh && fresh[0]) {
      const idx = ordenesCache.findIndex(function(x) { return x.id_orden === id; });
      if (idx >= 0) ordenesCache[idx] = fresh[0];
      else ordenesCache.push(fresh[0]);
    }
  } catch(e) {}
  const o = ordenesCache.find(function(x) { return x.id_orden === id; });
  if (!o) return;

  osServiciosLineas = [];
  osRepuestosLineas = [];

  try {
    const [linServ, linRep, tasas] = await Promise.all([
      api('os_servicios', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('os_repuestos', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('tasas', 'GET', null, '?order=fecha_registro.desc&limit=1&select=tipo_cambio'),
    ]);
    osServiciosLineas = linServ.map(function(l) {
      return { id: l.id_os_serv, id_servicio: l.id_servicio, descripcion: l.descripcion, cantidad: l.cantidad, precio_usd: l.precio_usd };
    });
    osRepuestosLineas = linRep.map(function(l) {
      return { id: l.id_os_rep, id_articulo: l.id_articulo, descripcion: l.descripcion, cantidad: l.cantidad, precio_usd: l.precio_usd };
    });
    tasaActualOS = tasas.length ? parseFloat(tasas[0].tipo_cambio) : (o.tasa_cambio_usd || 1);
  } catch(e) {}

  document.getElementById('os-id').value = o.id_orden;
  document.getElementById('os-numero').textContent = o.numero_os || '—';
  document.getElementById('os-km').value = o.kilometraje_entrada || '';
  document.getElementById('os-fecha-entrada').value = o.fecha_entrada || '';
  document.getElementById('os-fecha-prometida').value = o.fecha_prometida || '';
  // Cargar fechas cierre/anulación
  document.getElementById('os-fecha-cierre').value   = o.fecha_cierre    || '';
  document.getElementById('os-fecha-anulacion').value = o.fecha_anulacion || '';
  // Mostrar/ocultar según estado
  onCambioEstadoOS(o.estado || '');
  document.getElementById('os-estado').value = o.estado;
  document.getElementById('os-diagnostico').value = o.diagnostico || '';
  document.getElementById('os-observaciones').value = o.observaciones || '';
  const tasaUsdEl2 = document.getElementById('os-tasa-usd');
  const tasaEurEl2 = document.getElementById('os-tasa-eur');
  if (tasaUsdEl2) tasaUsdEl2.textContent = tasasDisponiblesOS.USD.toFixed(2);
  if (tasaEurEl2) tasaEurEl2.textContent = tasasDisponiblesOS.EUR.toFixed(2);
  const tipoCambioEl = document.getElementById('os-tipo-cambio');
  if (tipoCambioEl) tipoCambioEl.value = o.moneda_cambio || 'USD';
  const monedaLabelEl = document.getElementById('os-moneda-label');
  if (monedaLabelEl) monedaLabelEl.textContent = (o.moneda_cambio === 'EUR') ? '€' : '$';
  document.getElementById('os-veh-id').value = o.id_vehiculo || '';
  document.getElementById('alerta-os-ok').style.display = 'none';
  document.getElementById('alerta-os-err').style.display = 'none';
  document.getElementById('modal-os-titulo').textContent = 'EDITAR OS — ' + (o.numero_os || '');

  // Mostrar info del vehículo
  if (o.vehiculos) {
    const v = o.vehiculos;
    document.getElementById('os-placa-bus').value = v.placa;
    document.getElementById('os-veh-info').innerHTML = renderVehInfoOS({ placa: v.placa, marca: v.marca, modelo: v.modelo });
  }

  renderLineasOS();
  renderLineasRep();
  calcularTotalesOS();
  await cargarSelectsOS();
  abrirModal('modal-os');
  focusFirstField('modal-os');
}

// ─── BUSCAR VEHÍCULO EN OS ───
async function buscarVehiculoOS() {
  const placa = document.getElementById('os-placa-bus').value.trim().toUpperCase();
  const infoDiv = document.getElementById('os-veh-info');
  if (!placa) { infoDiv.innerHTML = ''; return; }

  infoDiv.innerHTML = '<div class="loading" style="padding:12px"><div class="spinner"></div> Buscando...</div>';
  try {
    const vehs = await api('vehiculos', 'GET', null,
      '?placa=eq.' + encodeURIComponent(placa) + '&select=*,propietarios(nombre_completo)');
    if (!vehs.length) {
      infoDiv.innerHTML = '<div style="color:#fc8181;font-size:12px;padding:8px">Vehículo no encontrado</div>';
      document.getElementById('os-veh-id').value = '';
      return;
    }
    const v = vehs[0];
    document.getElementById('os-veh-id').value = v.id_vehiculo;
    infoDiv.innerHTML = renderVehInfoOS(v);
  } catch(e) {
    infoDiv.innerHTML = '<div style="color:#fc8181;font-size:12px">' + e.message + '</div>';
  }
}

function renderVehInfoOS(v) {
  return '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:12px 16px;margin-top:8px">'
    + '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">'
    + '<div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + v.placa + '</div>'
    + '<div><div style="font-weight:500">' + v.marca + ' ' + v.modelo + '</div>'
    + (v.propietarios ? '<div style="font-size:12px;color:var(--suave)">👤 ' + v.propietarios.nombre_completo + '</div>' : '')
    + '</div></div></div>';
}

// ─── LÍNEAS DE SERVICIOS ───
function renderLineasOS() {
  const cont = document.getElementById('os-lineas-serv');
  if (!cont) return;
  if (!osServiciosLineas.length) {
    cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Sin servicios agregados</div>';
    return;
  }
  const monedaLabels = { USD: '$ USD', EUR: '€ EUR', VES: 'Bs VES' };
  cont.innerHTML = '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px">'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px">Descripción</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Cant.</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:right">Precio</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Mon.</div>'
    + '<div></div></div>'
  + osServiciosLineas.map(function(l, i) {
    const mon = l.moneda || 'USD';
    return '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
      + '<div style="font-size:13px;font-weight:500">' + l.descripcion + '</div>'
      + '<input type="number" value="' + l.cantidad + '" min="0.01" step="0.01" onchange="osServiciosLineas[' + i + '].cantidad=parseFloat(this.value)||1;calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:center">'
      + '<input type="number" value="' + (parseFloat(l.precio_original !== undefined ? l.precio_original : (l.precio_usd || 0)).toFixed(2)) + '" min="0" step="0.01" onchange="osServiciosLineas[' + i + '].precio_original=parseFloat(this.value)||0;osServiciosLineas[' + i + '].precio_usd=convertirAUSD(parseFloat(this.value)||0,osServiciosLineas[' + i + '].moneda||\'USD\');calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--naranja);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:right">'
      + '<div style="font-size:10px;font-weight:600;color:var(--suave);text-align:center">' + (monedaLabels[mon] || mon) + '</div>'
      + '<button onclick="quitarLineaServ(' + i + ')" style="background:none;border:none;color:#fc8181;cursor:pointer;font-size:16px;padding:0 4px">✕</button>'
      + '</div>';
  }).join('');
  calcularTotalesOS();
}

function renderLineasRep() {
  const cont = document.getElementById('os-lineas-rep');
  if (!cont) return;
  if (!osRepuestosLineas.length) {
    cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Sin repuestos / materiales agregados</div>';
    return;
  }
  const monedaLabels = { USD: '$ USD', EUR: '€ EUR', VES: 'Bs VES' };
  cont.innerHTML = '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px">'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px">Descripción</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Cant.</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:right">Precio</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Mon.</div>'
    + '<div></div></div>'
  + osRepuestosLineas.map(function(l, i) {
    const mon = l.moneda || 'USD';
    return '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
      + '<div style="font-size:13px;font-weight:500">' + l.descripcion + '</div>'
      + '<input type="number" value="' + l.cantidad + '" min="0.01" step="0.01" onchange="osRepuestosLineas[' + i + '].cantidad=parseFloat(this.value)||1;calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:center">'
      + '<input type="number" value="' + (parseFloat(l.precio_original !== undefined ? l.precio_original : (l.precio_usd || 0)).toFixed(2)) + '" min="0" step="0.01" onchange="osRepuestosLineas[' + i + '].precio_original=parseFloat(this.value)||0;osRepuestosLineas[' + i + '].precio_usd=convertirAUSD(parseFloat(this.value)||0,osRepuestosLineas[' + i + '].moneda||\'USD\');calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--naranja);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:right">'
      + '<div style="font-size:10px;font-weight:600;color:var(--suave);text-align:center">' + (monedaLabels[mon] || mon) + '</div>'
      + '<button onclick="quitarLineaRep(' + i + ')" style="background:none;border:none;color:#fc8181;cursor:pointer;font-size:16px;padding:0 4px">✕</button>'
      + '</div>';
  }).join('');
  calcularTotalesOS();
}

function convertirAUSD(precio, moneda) {
  if (moneda === 'VES') return tasasDisponiblesOS.USD > 0 ? precio / tasasDisponiblesOS.USD : precio;
  if (moneda === 'EUR') return tasasDisponiblesOS.USD > 0 && tasasDisponiblesOS.EUR > 0 ? precio * (tasasDisponiblesOS.EUR / tasasDisponiblesOS.USD) : precio;
  return precio; // USD
}

function quitarLineaServ(i) { osServiciosLineas.splice(i, 1); renderLineasOS(); }
function quitarLineaRep(i)  { osRepuestosLineas.splice(i, 1); renderLineasRep(); }

function calcularTotalesOS() {
  const totServ = osServiciosLineas.reduce(function(acc, l) { return acc + parseFloat(l.precio_usd) * parseFloat(l.cantidad); }, 0);
  const totRep  = osRepuestosLineas.reduce(function(acc, l) { return acc + parseFloat(l.precio_usd) * parseFloat(l.cantidad); }, 0);
  const total   = totServ + totRep;
  const totalVes = total * tasaActualOS;
  const el = document.getElementById('os-totales');
  if (el) el.innerHTML = '<div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding:12px 0">'
    + '<div><div style="font-size:10px;color:var(--suave);letter-spacing:1px">Servicios</div><div style="font-family:var(--font-mono)">$ ' + fmtUSD(totServ) + '</div></div>'
    + '<div><div style="font-size:10px;color:var(--suave);letter-spacing:1px">Repuestos</div><div style="font-family:var(--font-mono)">$ ' + fmtUSD(totRep) + '</div></div>'
    + '<div style="border-left:1px solid var(--borde);padding-left:24px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px">TOTAL USD</div><div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">$ ' + fmtUSD(total) + '</div></div>'
    + '<div style="border-left:1px solid var(--borde);padding-left:24px">'
    +   '<div style="font-size:10px;color:var(--suave);letter-spacing:1px">TOTAL Bs</div>'
    +   '<div style="font-family:var(--font-mono);font-size:14px;color:var(--suave)">' + fmtBs(totalVes) + '</div>'
    +   '<div style="font-size:9px;color:var(--suave);margin-top:2px">Tasa: $ 1 = ' + tasaActualOS.toFixed(2) + ' Bs</div>'
    + '</div>'
    + '</div>';
}

// ─── AGREGAR LÍNEA SERVICIO DESDE CATÁLOGO ───
async function agregarServicioCatalogo() {
  if (!catalogoCache.length) {
    try { catalogoCache = await api('servicios_catalogo', 'GET', null, '?activo=eq.true&order=grupo.asc,nombre.asc&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+''); } catch(e) {}
  }
  const sel    = document.getElementById('os-sel-cat');
  const precio = document.getElementById('os-precio-cat');
  const cant   = document.getElementById('os-cant-cat');
  const moneda = document.getElementById('os-moneda-cat').value;

  // Convertir precio a USD equivalente según moneda
  function precioAUSD(p, mon) {
    if (mon === 'VES') return tasasDisponiblesOS.USD > 0 ? p / tasasDisponiblesOS.USD : p;
    if (mon === 'EUR') return tasasDisponiblesOS.USD > 0 && tasasDisponiblesOS.EUR > 0 ? p * (tasasDisponiblesOS.EUR / tasasDisponiblesOS.USD) : p;
    return p; // USD
  }

  if (!sel.value) {
    const descEl = document.getElementById('os-desc-libre');
    if (!descEl.value.trim()) {
      descEl.style.borderColor = 'var(--naranja)';
      descEl.placeholder = '⚠ Requerido';
      setTimeout(function() { descEl.style.borderColor = ''; descEl.placeholder = 'Escribe descripción libre...'; }, 2000);
      descEl.focus();
      return;
    }
    const pVal = parseFloat(precio.value) || 0;
    if (pVal <= 0) {
      precio.style.borderColor = 'var(--naranja)';
      precio.style.boxShadow = '0 0 0 3px rgba(255,107,0,0.2)';
      setTimeout(function() { precio.style.borderColor = ''; precio.style.boxShadow = ''; }, 2000);
      precio.focus();
      precio.select();
      return;
    }
    osServiciosLineas.push({ id_servicio: null, descripcion: descEl.value.trim(),
      cantidad: parseFloat(cant.value) || 1, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
    descEl.value = ''; precio.value = ''; cant.value = '1';
  } else {
    const s = catalogoCache.find(function(x) { return x.id_servicio == sel.value; });
    if (!s) return;
    const pVal = parseFloat(precio.value) || parseFloat(s.precio_usd) || 0;
    osServiciosLineas.push({ id_servicio: s.id_servicio, descripcion: s.nombre,
      cantidad: parseFloat(cant.value) || 1, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
    sel.value = ''; precio.value = ''; cant.value = '1';
  }
  renderLineasOS();
}

function onSelCatalogoChange() {
  const sel = document.getElementById('os-sel-cat');
  const precio = document.getElementById('os-precio-cat');
  const descLibre = document.getElementById('os-desc-libre');
  const cant = document.getElementById('os-cant-cat');

  if (!sel.value) {
    // Sin servicio seleccionado → posicionar en descripción libre
    precio.value = '';
    if (descLibre) setTimeout(function() { descLibre.focus(); }, 50);
    return;
  }

  // Servicio seleccionado → autocompletar precio y posicionar en Cantidad
  const s = catalogoCache.find(function(x) { return x.id_servicio == sel.value; });
  if (s) precio.value = parseFloat(s.precio_usd || 0).toFixed(2);
  if (cant) setTimeout(function() { cant.focus(); cant.select(); }, 50);
}

// ─── AGREGAR LÍNEA REPUESTO DESDE INVENTARIO ───
async function agregarRepuestoInventario() {
  if (!inventarioCache.length) {
    try { inventarioCache = await api('inventario', 'GET', null, '?order=nombre.asc&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+''); } catch(e) {}
  }
  const sel    = document.getElementById('os-sel-inv');
  const precio = document.getElementById('os-precio-inv');
  const cant   = document.getElementById('os-cant-inv');
  const desc   = document.getElementById('os-desc-rep-libre');
  const moneda = document.getElementById('os-moneda-inv').value;
  const cantVal = parseFloat(cant.value) || 1;

  function precioAUSD(p, mon) {
    if (mon === 'VES') return tasasDisponiblesOS.USD > 0 ? p / tasasDisponiblesOS.USD : p;
    if (mon === 'EUR') return tasasDisponiblesOS.USD > 0 && tasasDisponiblesOS.EUR > 0 ? p * (tasasDisponiblesOS.EUR / tasasDisponiblesOS.USD) : p;
    return p;
  }

  if (!sel.value) {
    if (!desc.value.trim()) { alert('Escribe una descripción o selecciona del inventario.'); return; }
    const pVal = parseFloat(precio.value) || 0;
    osRepuestosLineas.push({ id_articulo: null, descripcion: desc.value.trim(),
      cantidad: cantVal, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
    desc.value = ''; precio.value = ''; cant.value = '1';
  } else {
    const r = inventarioCache.find(function(x) { return x.id_articulo == sel.value; });
    if (!r) return;
    if (r.stock_actual < cantVal) {
      if (!confirm('⚠ Stock insuficiente (' + r.stock_actual + ' disponibles). ¿Agregar igual?')) return;
    }
    const pVal = parseFloat(precio.value) || parseFloat(r.precio_venta_usd) || 0;
    osRepuestosLineas.push({ id_articulo: r.id_articulo, descripcion: r.nombre,
      cantidad: cantVal, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
    sel.value = ''; precio.value = ''; cant.value = '1';
  }
  renderLineasRep();
}

function onSelInventarioChange() {
  const sel = document.getElementById('os-sel-inv');
  const precio = document.getElementById('os-precio-inv');
  if (!sel.value) { precio.value = ''; return; }
  const r = inventarioCache.find(function(x) { return x.id_articulo == sel.value; });
  if (r) precio.value = parseFloat(r.precio_venta_usd || 0).toFixed(2);
}

// ─── GUARDAR OS ───
async function guardarOS() {
  const id = document.getElementById('os-id').value;
  if (id && !puedo('SERVICIOS','EDITAR')) { alert('No tiene permiso para editar órdenes de servicio.'); return; }
  if (!id && !puedo('SERVICIOS','CREAR')) { alert('No tiene permiso para crear órdenes de servicio.'); return; }
  const vehId       = document.getElementById('os-veh-id').value;
  const km          = parseInt(document.getElementById('os-km').value) || null;
  const fechaEnt    = document.getElementById('os-fecha-entrada').value;
  const fechaProm   = document.getElementById('os-fecha-prometida').value;
  const estado        = document.getElementById('os-estado').value;
  const fechaCierre   = document.getElementById('os-fecha-cierre')?.value   || null;
  const fechaAnulacion= document.getElementById('os-fecha-anulacion')?.value || null;
  const diagnostico   = document.getElementById('os-diagnostico').value.trim();
  const obs         = document.getElementById('os-observaciones').value.trim();
  const okEl        = document.getElementById('alerta-os-ok');
  const errEl       = document.getElementById('alerta-os-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  // Validar fechas obligatorias según estado
  if (estado === 'CERRADA' && !fechaCierre) {
    errEl.textContent = 'Debe ingresar la Fecha de Cierre para cerrar la OS.';
    errEl.style.display = 'block';
    document.getElementById('os-fecha-cierre')?.focus(); return;
  }
  if (estado === 'ANULADA' && !fechaAnulacion) {
    errEl.textContent = 'Debe ingresar la Fecha de Anulación para anular la OS.';
    errEl.style.display = 'block';
    document.getElementById('os-fecha-anulacion')?.focus(); return;
  }

  if (!vehId) { errEl.textContent = 'Debe buscar y seleccionar un vehículo.'; errEl.style.display = 'block'; return; }
  if (!fechaEnt) { errEl.textContent = 'La fecha de entrada es obligatoria.'; errEl.style.display = 'block'; return; }

  const totServ = osServiciosLineas.reduce(function(acc, l) { return acc + parseFloat(l.precio_usd) * parseFloat(l.cantidad); }, 0);
  const totRep  = osRepuestosLineas.reduce(function(acc, l) { return acc + parseFloat(l.precio_usd) * parseFloat(l.cantidad); }, 0);
  const total   = totServ + totRep;

  // Obtener id_propietario del vehículo
  let idPropietario = null;
  try {
    const veh = await api('vehiculos', 'GET', null, '?id_vehiculo=eq.' + vehId + '&select=id_propietario');
    if (veh.length) idPropietario = veh[0].id_propietario;
  } catch(e) {}

  try {
    let osId = id;
    // Fecha del estado actual (Venezuela UTC-4)
    const hoyEstado = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    // Detectar si el estado cambió (en edición) para actualizar fecha_estado
    const osActual = id ? ordenesCache.find(function(x) { return x.id_orden == id; }) : null;
    const estadoCambio = !osActual || osActual.estado !== estado;

    const datos = {
      id_vehiculo: parseInt(vehId),
      id_propietario: idPropietario,
      kilometraje_entrada: km,
      fecha_entrada:   fechaEnt,
      fecha_prometida: fechaProm    || null,
      fecha_cierre:    fechaCierre   || null,
      fecha_anulacion: fechaAnulacion || null,
      estado,
      diagnostico: diagnostico || null,
      observaciones: obs || null,
      tasa_cambio_usd: tasasDisponiblesOS.USD,
      total_servicios_usd: totServ,
      total_repuestos_usd: totRep,
      total_usd: total,
      total_ves: total * tasaActualOS,
      id_usuario: sesionActual.correo_usuario,
      // Actualizar fecha y usuario del estado solo si cambió
      ...(estadoCambio ? {
        fecha_estado: hoyEstado,
        usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
      } : {}),
    };

    if (id) {
      // Editar
      await api('ordenes_servicio', 'PATCH', datos, '?id_orden=eq.' + id);
      // Borrar líneas anteriores y reinsertar
      // Guardar líneas de repuestos anteriores para restaurar stock
      var lineasRepuestosAntes = [];
      try {
        lineasRepuestosAntes = await api('os_repuestos', 'GET', null, '?id_orden=eq.' + id + '&select=id_articulo,cantidad');
      } catch(e) {}
      await Promise.all([
        api('os_servicios', 'DELETE', null, '?id_orden=eq.' + id),
        api('os_repuestos', 'DELETE', null, '?id_orden=eq.' + id),
      ]);
    } else {
      // Nueva — generar número OS por empresa
      const hoy = new Date();
      const anio = hoy.getFullYear();
      const idEmisor = _empresaActiva ? _empresaActiva.id_emisor : 0;
      const existentes = await api('ordenes_servicio', 'GET', null,
        '?select=numero_os&numero_os=like.OS-' + anio + '-*&id_emisor=eq.' + idEmisor + '&order=numero_os.desc&limit=1');
      let seq = 1;
      if (existentes.length) {
        const partes = existentes[0].numero_os.split('-');
        seq = parseInt(partes[partes.length - 1]) + 1;
      }
      datos.numero_os = 'OS-' + anio + '-' + String(seq).padStart(4, '0');
      const res = await api('ordenes_servicio', 'POST', datos);
      if (res && res[0]) osId = res[0].id_orden;
    }

    // Insertar líneas de servicios
    for (var i = 0; i < osServiciosLineas.length; i++) {
      var l = osServiciosLineas[i];
      await api('os_servicios', 'POST', {
        id_orden: parseInt(osId), id_servicio: l.id_servicio || null,
        descripcion: l.descripcion, cantidad: l.cantidad,
        precio_usd: l.precio_usd, subtotal_usd: parseFloat(l.precio_usd) * parseFloat(l.cantidad)
      });
    }

    // ── Restaurar stock de repuestos anteriores (solo en edición) ──
    // Si es edición, las líneas anteriores ya fueron borradas arriba.
    // Necesitamos restaurar el stock que consumieron antes de descontar el nuevo.
    if (id && lineasRepuestosAntes && lineasRepuestosAntes.length) {
      for (var k = 0; k < lineasRepuestosAntes.length; k++) {
        var la = lineasRepuestosAntes[k];
        if (!la.id_articulo) continue;
        try {
          const invAntes = inventarioCache.find(function(x) { return x.id_articulo == la.id_articulo; });
          if (invAntes) {
            const stockRestaurado = invAntes.stock_actual + parseFloat(la.cantidad || 0);
            await api('inventario', 'PATCH', { stock_actual: stockRestaurado }, '?id_articulo=eq.' + la.id_articulo);
            invAntes.stock_actual = stockRestaurado; // actualizar cache local
          }
        } catch(eRest) { console.warn('Error restaurando stock:', eRest); }
      }
    }

    // ── Insertar nuevas líneas de repuestos y descontar stock ──
    for (var j = 0; j < osRepuestosLineas.length; j++) {
      var lr = osRepuestosLineas[j];
      await api('os_repuestos', 'POST', {
        id_orden: parseInt(osId), id_articulo: lr.id_articulo || null,
        descripcion: lr.descripcion, cantidad: lr.cantidad,
        precio_usd: lr.precio_usd, subtotal_usd: parseFloat(lr.precio_usd) * parseFloat(lr.cantidad)
      });
      // Descontar stock siempre que haya repuesto de inventario vinculado
      if (lr.id_articulo) {
        try {
          const invItem = inventarioCache.find(function(x) { return x.id_articulo == lr.id_articulo; });
          if (invItem) {
            const nuevoStock = Math.max(0, invItem.stock_actual - parseFloat(lr.cantidad));
            await api('inventario', 'PATCH', { stock_actual: nuevoStock }, '?id_articulo=eq.' + lr.id_articulo);
            invItem.stock_actual = nuevoStock; // actualizar cache local
          }
        } catch(eStock) { console.warn('Error descontando stock:', eStock); }
      }
    }

    okEl.textContent = '✓ Orden de servicio guardada correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-os'); renderOrdenes(); }, 1200);
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
}

// ─── ANULAR OS ───
// ─── HELPER: restaurar o descontar stock de repuestos de una OS ───
async function ajustarStockOS(idOrden, operacion) {
  // operacion: 'restaurar' suma al stock, 'descontar' resta
  try {
    const lineas = await api('os_repuestos', 'GET', null, '?id_orden=eq.' + idOrden + '&select=id_articulo,cantidad');
    for (var k = 0; k < lineas.length; k++) {
      var l = lineas[k];
      if (!l.id_articulo) continue;
      try {
        const inv = await api('inventario', 'GET', null, '?id_articulo=eq.' + l.id_articulo + '&select=id_articulo,stock_actual');
        if (!inv.length) continue;
        var cant = parseFloat(l.cantidad || 0);
        var nuevoStock = operacion === 'restaurar'
          ? inv[0].stock_actual + cant
          : Math.max(0, inv[0].stock_actual - cant);
        await api('inventario', 'PATCH', { stock_actual: nuevoStock }, '?id_articulo=eq.' + l.id_articulo);
        // Actualizar cache local
        var cached = inventarioCache.find(function(x) { return x.id_articulo == l.id_articulo; });
        if (cached) cached.stock_actual = nuevoStock;
      } catch(eInv) { console.warn('Error ajustando stock artículo', l.id_articulo, eInv); }
    }
  } catch(e) { console.warn('Error ajustarStockOS:', e); }
}

async function anularOS(id, numero) {
  if (!puedo('SERVICIOS','ANULAR')) {
    alert('No tiene permiso para anular órdenes de servicio.');
    return;
  }
  if (!confirm('¿Anular la orden ' + numero + '? Se restaurará el stock de los repuestos utilizados.')) return;
  try {
    const hoyAnul = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    // Restaurar stock ANTES de anular
    await ajustarStockOS(id, 'restaurar');
    await api('ordenes_servicio', 'PATCH', {
      estado: 'ANULADA',
      fecha_estado: hoyAnul,
      usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
    }, '?id_orden=eq.' + id);
    renderOrdenes();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── REABRIR OS (solo administradores) ───
async function reabrirOS(id, numero) {
  if (!puedo('SERVICIOS','REABRIR')) {
    alert('No tiene permiso para reabrir órdenes de servicio.');
    return;
  }
  if (!confirm('¿Reabrir la orden ' + numero + '? Se descontará nuevamente el stock de los repuestos.')) return;
  try {
    const hoyReab = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    // Descontar stock nuevamente al reabrir
    await ajustarStockOS(id, 'descontar');
    await api('ordenes_servicio', 'PATCH', {
      estado: 'ABIERTA',
      fecha_estado: hoyReab,
      usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
    }, '?id_orden=eq.' + id);
    renderOrdenes();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── ELIMINAR OS ───
async function eliminarOS(id, numero) {
  if (!puedo('SERVICIOS','ELIMINAR')) { alert('No tiene permiso para eliminar órdenes de servicio.'); return; }
  const o = ordenesCache.find(function(x) { return x.id_orden === id; });
  if (o && o.estado !== 'ANULADA') { alert('Solo se pueden eliminar órdenes ANULADAS.'); return; }
  if (!confirm('¿Eliminar definitivamente la orden ' + numero + '?\nEsta acción no se puede deshacer.')) return;
  try {
    await Promise.all([
      api('os_servicios', 'DELETE', null, '?id_orden=eq.' + id),
      api('os_repuestos',  'DELETE', null, '?id_orden=eq.' + id),
    ]);
    await api('ordenes_servicio', 'DELETE', null, '?id_orden=eq.' + id);
    renderOrdenes();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

// ─── FICHA OS ───

async function eliminarOSFicha() {
  const id = window._fichaOSId;
  if (!id) return;
  if (!confirm('¿Eliminar esta Orden de Servicio? Esta acción no se puede deshacer.')) return;
  try {
    await api('ordenes_servicio','DELETE',null,'?id_orden=eq.'+id);
    cerrarModal('modal-ficha-os');
    await renderOrdenes();
  } catch(e) { alert('Error al eliminar: '+e.message); }
}

async function verFichaOS(id) {
  if (!sesionActual?.administrador && !puedo('SERVICIOS','VER')) {
    alert('No tiene permiso para ver la ficha de la orden de servicio.');
    return;
  }
  // Refrescar OS desde Supabase antes de mostrar
  try {
    const fresh = await api('ordenes_servicio', 'GET', null,
      '?id_orden=eq.' + id + '&select=*,vehiculos(placa,marca,modelo),propietarios(nombre_completo)');
    if (fresh && fresh[0]) {
      const idx = ordenesCache.findIndex(function(x) { return x.id_orden === id; });
      if (idx >= 0) ordenesCache[idx] = fresh[0];
      else ordenesCache.push(fresh[0]);
    }
  } catch(e) {}
  const o = ordenesCache.find(function(x) { return x.id_orden === id; });
  if (!o) return;
  // Actualizar fila de la tabla si el estado cambió
  const fila = document.querySelector('tr[data-id="' + id + '"]');
  if (fila && o) {
    const est = ESTADOS_OS[o.estado] || { clase: 'badge-gris', label: o.estado };
    const tdEstado = fila.cells[3];
    if (tdEstado) tdEstado.innerHTML = '<span class="badge ' + est.clase + '">' + est.label + '</span>'
      + (o.fecha_estado ? '<div style="font-size:10px;color:var(--suave);margin-top:3px">' + fmtFecha(o.fecha_estado) + '</div>' : '');
  }
  try {
    const [linServ, linRep, tasasActuales] = await Promise.all([
      api('os_servicios', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('os_repuestos', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('tasas', 'GET', null, '?moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    const tasaActualFicha = tasasActuales.length ? parseFloat(tasasActuales[0].tipo_cambio) : null;
    const tasaHistorica = parseFloat(o.tasa_cambio_usd || 1);
    const tasaDiferente = tasaActualFicha && Math.abs(tasaActualFicha - tasaHistorica) > 0.01;
    const est = ESTADOS_OS[o.estado] || { clase: 'badge-gris', label: o.estado };
    const veh = o.vehiculos;
    const prop = o.propietarios;

    const tablaServ = linServ.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr>'
        + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px">DESCRIPCIÓN</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">P/U USD</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SUBTOTAL</th>'
        + '</tr></thead><tbody>'
        + linServ.map(function(l) {
            return '<tr><td style="padding:6px 0">' + l.descripcion + '</td>'
              + '<td style="text-align:right;padding:6px 0">' + l.cantidad + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono)">$ ' + fmtUSD(l.precio_usd) + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(l.subtotal_usd) + '</td></tr>';
          }).join('')
        + '</tbody></table>'
      : '<div style="color:var(--suave);font-size:12px">Sin servicios</div>';

    const tablaRep = linRep.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr>'
        + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px">REPUESTO</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">P/U USD</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SUBTOTAL</th>'
        + '</tr></thead><tbody>'
        + linRep.map(function(l) {
            return '<tr><td style="padding:6px 0">' + l.descripcion + '</td>'
              + '<td style="text-align:right;padding:6px 0">' + l.cantidad + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono)">$ ' + fmtUSD(l.precio_usd) + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(l.subtotal_usd) + '</td></tr>';
          }).join('')
        + '</tbody></table>'
      : '<div style="color:var(--suave);font-size:12px">Sin artículos</div>';

    document.getElementById('ficha-os-contenido').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:20px;flex-wrap:wrap">'
      + '<div><div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + (o.numero_os || '—') + '</div>'
      + '<span class="badge ' + est.clase + '">' + est.label + '</span>'
      + (o.fecha_estado ? '<span style="font-size:10px;color:var(--suave);margin-left:8px">desde ' + fmtFecha(o.fecha_estado) + (o.usuario_estado ? ' · ' + o.usuario_estado : '') + '</span>' : '')
      + '</div>'
      + '<div style="text-align:right"><div style="font-size:10px;color:var(--suave);letter-spacing:1px">TOTAL</div>'
      + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">$ ' + fmtUSD(o.total_usd) + '</div>'
      + '<div style="font-size:11px;color:var(--suave)">' + fmtBs(o.total_ves) + ' Bs</div>'
      + '</div></div>'

      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Vehículo</div>'
      + '<div style="font-weight:500">' + (veh ? veh.placa + ' — ' + veh.marca + ' ' + veh.modelo : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Propietario</div>'
      + '<div>' + (prop ? prop.nombre_completo : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Fecha Entrada</div>'
      + '<div>' + (o.fecha_entrada ? fmtFecha(o.fecha_entrada) : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Fecha Prometida</div>'
      + '<div>' + (o.fecha_prometida ? fmtFecha(o.fecha_prometida) : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Km Entrada</div>'
      + '<div>' + (o.kilometraje_entrada ? o.kilometraje_entrada.toLocaleString() + ' km' : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' ? 'Tasa USD Actual' : 'Tasa USD al Cerrar')
      + '</div><div style="font-family:var(--font-mono)">'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' && tasaActualFicha ? tasaActualFicha : tasaHistorica).toFixed(2) + ' Bs/$'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' && tasaDiferente ? '<span style="font-size:10px;color:var(--suave);margin-left:6px">(creada: ' + tasaHistorica.toFixed(2) + ')</span>' : '')
      + '</div></div>'
      + '</div>'

      + (o.diagnostico ? '<div style="margin-bottom:16px"><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Diagnóstico</div>'
        + '<div style="background:var(--gris2);border-radius:6px;padding:12px;font-size:13px">' + o.diagnostico + '</div></div>' : '')
      + (o.observaciones ? '<div style="margin-bottom:16px"><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Observaciones</div>'
        + '<div style="background:var(--gris2);border-radius:6px;padding:12px;font-size:13px">' + o.observaciones + '</div></div>' : '')

      + (tasaDiferente && sesionActual && sesionActual.administrador && o.estado !== 'CERRADA' && o.estado !== 'ANULADA'
          ? '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.25);border-radius:6px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px">'
            + '<div style="font-size:12px;color:var(--naranja)">⚠ La tasa vigente (' + tasaActualFicha.toFixed(2) + ' Bs/$) difiere de la registrada en esta OS (' + tasaHistorica.toFixed(2) + ' Bs/$).</div>'
            + '<button class="btn-primario" style="font-size:11px;padding:7px 14px;white-space:nowrap" onclick="recalcularTasaOS(' + id + ',' + tasaActualFicha + ')">Recalcular Bs</button>'
            + '</div>'
          : '')
      + '<div style="margin-bottom:16px"><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">🔧 Servicios Realizados</div>'
      + tablaServ + '</div>'
      + '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">📦 Repuestos Utilizados</div>'
      + tablaRep + '</div>';

    document.getElementById('ficha-os-editar-btn').setAttribute('onclick', 'cerrarModal(\'modal-ficha-os\');abrirEditarOS(' + id + ')');
    document.getElementById('ficha-os-editar-btn').style.display = (o.estado !== 'CERRADA' && o.estado !== 'ANULADA') ? '' : 'none';
    // Botón Reabrir (solo admins, solo en CERRADA o ANULADA)
    let btnReabrir = document.getElementById('ficha-os-reabrir-btn');
    if (!btnReabrir) {
      btnReabrir = document.createElement('button');
      btnReabrir.id = 'ficha-os-reabrir-btn';
      btnReabrir.className = 'btn-secundario';
      btnReabrir.style.cssText = 'border-color:rgba(255,107,0,0.4);color:var(--naranja)';
      document.getElementById('ficha-os-editar-btn').parentNode.insertBefore(btnReabrir, document.getElementById('ficha-os-editar-btn'));
    }
    if (sesionActual && sesionActual.administrador && (o.estado === 'CERRADA' || o.estado === 'ANULADA')) {
      btnReabrir.textContent = '↺ Reabrir OS';
      btnReabrir.setAttribute('onclick', 'cerrarModal(\'modal-ficha-os\');reabrirOS(' + id + ',\'' + (o.numero_os || '') + '\')');
      btnReabrir.style.display = '';
    } else {
      btnReabrir.style.display = 'none';
    }
    // Mostrar Eliminar si total USD y Bs = 0
  const btnElimOS = document.getElementById('ficha-os-eliminar-btn');
  if (btnElimOS && puedo('SERVICIOS','ELIMINAR')) {
    const sinTotal = (!o.total_usd || parseFloat(o.total_usd) === 0) && (!o.total_ves || parseFloat(o.total_ves) === 0);
    btnElimOS.style.display = sinTotal ? '' : 'none';
    window._fichaOSId = o.id_orden;
  }
  abrirModal('modal-ficha-os');
  focusFirstField('modal-ficha-os');
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── RECALCULAR TOTAL EN BS CON TASA ACTUAL (solo admins) ───
async function recalcularTasaOS(id, nuevaTasa) {
  if (!sesionActual || !sesionActual.administrador) return;
  if (!confirm('¿Recalcular el Total en Bs de esta OS usando la tasa actual (' + parseFloat(nuevaTasa).toFixed(2) + ' Bs/$)?')) return;
  try {
    const o = ordenesCache.find(function(x) { return x.id_orden === id; });
    if (!o) return;
    const nuevoTotalVes = parseFloat(o.total_usd || 0) * nuevaTasa;
    await api('ordenes_servicio', 'PATCH', {
      tasa_cambio_usd: nuevaTasa,
      total_ves: nuevoTotalVes,
    }, '?id_orden=eq.' + id);
    // Actualizar cache local
    o.tasa_cambio_usd = nuevaTasa;
    o.total_ves = nuevoTotalVes;
    cerrarModal('modal-ficha-os');
    renderOrdenes();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── Cargar catálogo e inventario en selects del modal OS ───
async function cargarSelectsOS() {
  try {
    if (!catalogoCache.length) catalogoCache = await api('servicios_catalogo', 'GET', null, '?activo=eq.true&order=grupo.asc,nombre.asc&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
    if (!inventarioCache.length) inventarioCache = await api('inventario', 'GET', null, '?order=nombre.asc&id_emisor=eq.'+(_empresaActiva?.id_emisor||0)+'');
  } catch(e) {}

  // ── Cargar selector de GRUPOS (sin corchetes, sin categoría) ──
  const selGrupo = document.getElementById('os-sel-grupo-cat');
  if (selGrupo) {
    const grupos = [...new Set(catalogoCache.map(function(s) { return s.grupo; }).filter(Boolean))].sort();
    selGrupo.innerHTML = '<option value="">— Todos los grupos —</option>'
      + grupos.map(function(g) { return '<option value="' + g + '">' + g + '</option>'; }).join('');
  }

  // ── Cargar selector de SERVICIOS (todos por defecto, sin corchetes) ──
  const selCat = document.getElementById('os-sel-cat');
  if (selCat) {
    selCat.innerHTML = '<option value="">— Seleccionar servicio —</option>'
      + catalogoCache.map(function(s) {
          return '<option value="' + s.id_servicio + '" data-grupo="' + (s.grupo || '') + '">'
            + s.nombre + ' — $' + parseFloat(s.precio_usd || 0).toFixed(2) + '</option>';
        }).join('');
  }

  // ── Cargar selector de INVENTARIO ──
  const selInv = document.getElementById('os-sel-inv');
  if (selInv) {
    selInv.innerHTML = '<option value="">— Descripción libre —</option>'
      + inventarioCache.map(function(r) {
          return '<option value="' + r.id_articulo + '">' + r.nombre + ' (Stock: ' + r.stock_actual + ') — $' + parseFloat(r.precio_venta_usd || 0).toFixed(2) + '</option>';
        }).join('');
  }
}

// ── Filtrar servicios al cambiar el Grupo ──
function onSelGrupoCatChange() {
  const grupo = document.getElementById('os-sel-grupo-cat').value;
  const selCat = document.getElementById('os-sel-cat');
  const precio = document.getElementById('os-precio-cat');

  // Mostrar solo servicios del grupo seleccionado (o todos si grupo vacío)
  Array.from(selCat.options).forEach(function(opt) {
    if (!opt.value) { opt.style.display = ''; return; } // placeholder siempre visible
    opt.style.display = (!grupo || opt.dataset.grupo === grupo) ? '' : 'none';
  });

  // Siempre resetear a "— Seleccionar servicio —" y limpiar precio
  selCat.value = '';
  precio.value = '';
}

// Cargar selects cuando se abre el modal OS
// NOTA: No sobreescribir abrirModal — llamar cargarSelectsOS directamente desde abrirNuevaOS y abrirEditarOS


window.addEventListener('load', async () => {
  const guardado = sessionStorage.getItem('sd_sesion');
  if (guardado) {
    try {
      const { usuario, accesos } = JSON.parse(guardado);
      sesionActual = usuario;
      modulosAcceso = accesos;
      // Recargar permisos granulares desde Supabase al restaurar sesión
      try {
        const perms = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(usuario.correo_usuario));
        permisosActuales = {};
        perms.forEach(function(p) {
          if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
          permisosActuales[p.modulo].push(p.accion);
        });
      } catch(eP) { console.warn('Error cargando permisos sessionStorage:', eP); }
      // Recargar empresas del usuario
      try {
        const todasEmisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=*');
        if (usuario.administrador) {
          _empresasUsuario = todasEmisores;
          if (todasEmisores.length === 1) _empresaActiva = todasEmisores[0];
        } else {
          const ues = await api('usuarios_empresas','GET',null,
            '?correo_usuario=eq.'+encodeURIComponent(usuario.correo_usuario)+'&activo=eq.true&select=id_emisor');
          const idsPermitidos = new Set(ues.map(function(x){ return x.id_emisor; }));
          _empresasUsuario = todasEmisores.filter(function(e){ return idsPermitidos.has(e.id_emisor); });
          if (_empresasUsuario.length === 1) _empresaActiva = _empresasUsuario[0];
        }
        // Restaurar empresa activa desde sessionStorage si existe
        const empGuardada = sessionStorage.getItem('sd_empresa_activa');
        if (empGuardada) {
          const emp = JSON.parse(empGuardada);
          const empEncontrada = _empresasUsuario.find(function(e){ return e.id_emisor === emp.id_emisor; });
          if (empEncontrada) _empresaActiva = empEncontrada;
        }
      } catch(eE) { console.warn('Error cargando empresas al restaurar sesión:', eE); }
      iniciarApp();
      // Actualizar botón cambiar empresa después de cargar
      const btnCambiarEmp = document.getElementById('btn-cambiar-empresa');
      if (btnCambiarEmp) btnCambiarEmp.style.display = _empresasUsuario.length > 1 ? '' : 'none';
      iniciarTimerInactividad();
    } catch(e) {
      sessionStorage.removeItem('sd_sesion');
    }
  }
});
  // ─── NAVEGACIÓN ENTRE CAMPOS CON ENTER ───
  function nextField(el) {
    try {
      const modal = el.closest('.modal') || el.closest('.modal-body') || document.body;
      const campos = Array.from(modal.querySelectorAll(
        'input:not([type=hidden]):not([disabled]):not([readonly]):not([type=button]):not([type=submit]), select:not([disabled]), textarea:not([disabled])'
      )).filter(function(c) { return c.offsetParent !== null; });
      const idx = campos.indexOf(el);
      if (idx !== -1 && idx < campos.length - 1) {
        campos[idx + 1].focus();
      }
    } catch(e) {}
  }

  function focusFirstField(modalId) {
    setTimeout(function() {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      // Agregar navegación Enter a todos los campos del modal
      const campos = modal.querySelectorAll(
        'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=file]):not([disabled]):not([type=button]):not([type=submit]), select:not([disabled]), textarea:not([disabled])'
      );
      campos.forEach(function(campo) {
        if (!campo._enterNavSet) {
          campo._enterNavSet = true;
          campo.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && campo.tagName !== 'TEXTAREA') {
              e.preventDefault();
              nextField(campo);
            }
          });
        }
      });
      // Focus en el primer campo visible
      const primer = Array.from(campos).find(function(c) { return c.offsetParent !== null; });
      if (primer) primer.focus();
    }, 200);
  }

  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() { document.getElementById('login-correo')?.focus(); }, 300);
  });




