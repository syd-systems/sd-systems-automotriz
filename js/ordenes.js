// ─── S&D Systems — Módulo: ORDENES ───
// ══════════════════════════════════════════════════════════════
//  FASE 3 — ÓRDENES DE SERVICIO
// ══════════════════════════════════════════════════════════════
let ordenesCache = [];
let _idCuentaMercanciasOS = null; // cache del id_cuenta de 1.1.03.001 (Inventario de Mercancías)
let osServiciosLineas = [];  // líneas de servicios de la OS activa
let osArtículosLineas = [];  // líneas de artículos de la OS activa
// ─── fmtBs / fmtUSD / fmtVES definidas globalmente en core.js ───

let tasaActualOS = 1;        // tasa USD→VES al crear/editar OS

const ESTADOS_OS = {
  'ABIERTA':          { clase: 'badge-naranja', label: 'Abierta' },
  'EN_PROCESO':       { clase: 'badge-verde',   label: 'En Proceso' },
  'ESPERA_ARTICULO':  { clase: 'badge-rojo',    label: 'Espera Artículo' },
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
            ? '<td style="font-family:var(--font-mono)"><span style="color:var(--naranja)">' + fmtBs(o.total_ves) + ' Bs</span>'
              + '<div style="font-size:10px;color:var(--suave)">$ ' + fmtUSD(o.total_usd) + '</div></td>'
            : '<td style="text-align:center;color:#555;font-size:11px">🔒</td>')
        + '<td><div style="display:flex;gap:6px;flex-wrap:wrap">'
        + '<button class="btn-secundario" onclick="verFichaOS(' + o.id_orden + ')">Ver</button>'
        
        + '</div></td>'
        + '</tr>';
    }).join('');

    const resumen = {
      ABIERTA:         ordenes.filter(function(o) { return o.estado === 'ABIERTA'; }).length,
      EN_PROCESO:      ordenes.filter(function(o) { return o.estado === 'EN_PROCESO'; }).length,
      ESPERA_ARTICULO: ordenes.filter(function(o) { return o.estado === 'ESPERA_ARTICULO'; }).length,
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
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + msgErr(e) + '</div>';
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
  return d.toLocaleDateString('es-VE', { timeZone: 'America/Caracas',  day:'2-digit', month:'2-digit', year:'numeric' });
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
// Resuelve el Área que Realiza el Servicio a partir de un usuario (correo) --
// se busca su ficha de empleado y de ahí su Área asignada. Se usa tanto para
// una OS nueva (usuario en sesión) como para una existente (su creador).
async function _resolverAreaOS(correo) {
  const disp = document.getElementById('os-area-display');
  const hid  = document.getElementById('os-area');
  if (disp) disp.textContent = 'Área: —';
  if (hid) hid.value = '';
  if (!correo) return;
  try {
    const empRows = await api('empleados', 'GET', null,
      '?correo=eq.' + encodeURIComponent(correo) + '&select=id_area,param_areas(id,codigo,nombre)&limit=1');
    const a = empRows && empRows[0] && empRows[0].param_areas;
    if (a) {
      if (disp) disp.textContent = 'Área: ' + (a.codigo ? a.codigo + ' — ' : '') + a.nombre;
      if (hid) hid.value = a.id;
    } else if (disp) {
      disp.textContent = 'Área: el usuario no tiene ninguna asignada en su ficha';
    }
  } catch(eResArea) { console.warn('Error resolviendo Área de la OS:', eResArea); }
}

async function abrirNuevaOS() {
  setTimeout(function() {
    const body = document.querySelector('#modal-os .modal-body');
    if (body) body.scrollTop = 0;
  }, 80);
  osServiciosLineas = [];
  osArtículosLineas = [];

  // Obtener tasas vigentes (USD y EUR)
  try {
    const tasasDB = await api('tasas', 'GET', null, '?order=fecha_valor.desc&limit=10&select=*');
    const hoy = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];

    function getTasaOS(moneda) {
      // tasasDB ya viene ordenado por fecha_valor.desc desde la consulta --
      // tomar directamente la más reciente para esta moneda, sin comparar
      // contra "hoy" (ese cálculo con ajuste de huso horario podía excluir
      // la tasa del día según la hora exacta del navegador).
      const reg = tasasDB.filter(function(t) { return t.moneda_origen === moneda; })
        .sort(function(a,b) {
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
  await _resolverAreaOS(sesionActual?.correo_usuario);
  const hoyOS = getHoyVzla();
  document.getElementById('os-fecha-entrada').value = hoyOS;
  document.getElementById('os-fecha-entrada').max = sesionActual.administrador ? '' : hoyOS;
  document.getElementById('os-fecha-prometida').value = '';
  document.getElementById('os-fecha-cierre').value    = '';
  document.getElementById('os-fecha-anulacion').value = '';
  onCambioEstadoOS('ABIERTA');
  document.getElementById('os-fecha-prometida').min = sesionActual.administrador ? '' : hoyOS;
  document.getElementById('os-estado').value = 'ABIERTA';
  document.getElementById('os-estado').disabled = true;
  const lblEstado = document.getElementById('lbl-os-estado');
  if (lblEstado) lblEstado.textContent = 'Estado';
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
  // Resetear el precio de Artículos -- quedaba con el valor de la última
  // mercancía seleccionada en una OS anterior de la misma sesión.
  const precioInvReset = document.getElementById('os-precio-inv');
  if (precioInvReset) precioInvReset.value = '';
  const precioLibreReset = document.getElementById('os-precio-libre');
  if (precioLibreReset) precioLibreReset.value = '';
  const btnGuardarNuevaOS = document.getElementById('btn-guardar-os');
  if (btnGuardarNuevaOS) {
    btnGuardarNuevaOS.textContent = 'GUARDAR OS';
    btnGuardarNuevaOS.onclick = function() { guardarOS(); };
  }
  abrirModal('modal-os');
  focusFirstField('modal-os');
}

// ─── ABRIR EDITAR OS ───
async function abrirEditarOS(id) {
  if (!sesionActual?.administrador && !puedo('SERVICIOS','EDITAR')) {
    alert('No tiene permiso para editar órdenes de servicio.');
    return;
  }
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
  osArtículosLineas = [];

  try {
    const [linServ, linRep, tasasDB] = await Promise.all([
      api('os_servicios', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('os_mercancias', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('tasas', 'GET', null, '?order=fecha_valor.desc&limit=10&select=*'),
    ]);
    osServiciosLineas = linServ.map(function(l) {
      return { id: l.id_os_serv, id_servicio: l.id_servicio, descripcion: l.descripcion,
        cantidad: l.cantidad, precio_usd: l.precio_usd,
        moneda: (l.moneda || 'USD').toUpperCase(),
        precio_original: parseFloat(l.precio_original || l.precio_usd || 0) };
    });
    osArtículosLineas = linRep.map(function(l) {
      return { id: l.id_os_mercancia, id_articulo: l.id_articulo, descripcion: l.descripcion,
        cantidad: l.cantidad, precio_usd: l.precio_usd,
        moneda: (l.moneda || 'USD').toUpperCase(),
        precio_original: parseFloat(l.precio_original || l.precio_usd || 0) };
    });
    // Misma lógica robusta que Nueva OS -- tomar directamente la más
    // reciente por moneda, sin depender de fecha_registro (que dejaba
    // tasasDisponiblesOS.USD/EUR sin actualizar y calcularTotalesOS()
    // terminaba usando su valor por defecto de 1).
    function getTasaEditOS(moneda) {
      const reg = (tasasDB || []).filter(function(t) { return t.moneda_origen === moneda; })
        .sort(function(a,b) {
          const fa = String(a.fecha_valor||'').substring(0,10);
          const fb = String(b.fecha_valor||'').substring(0,10);
          if (fb !== fa) return fb.localeCompare(fa);
          return (b.id_tasa||0) - (a.id_tasa||0);
        });
      return reg.length ? parseFloat(reg[0].tipo_cambio) : null;
    }
    tasasDisponiblesOS.USD = getTasaEditOS('USD') || (o.tasa_bcv || 1);
    tasasDisponiblesOS.EUR = getTasaEditOS('EUR') || tasasDisponiblesOS.USD;
    tasaActualOS = tasasDisponiblesOS.USD;
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
  document.getElementById('os-estado').disabled = false;
  const lblEstadoE = document.getElementById('lbl-os-estado');
  if (lblEstadoE) lblEstadoE.textContent = 'Selección Estado';
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
  await _resolverAreaOS(o.id_usuario);

  // Si la OS está Cerrada, el botón de guardar se convierte en Facturar --
  // genera la Factura directo, sin pasar por el formulario manual de
  // '+ Nueva Factura' (mismo atajo que ya existe en Ventas).
  const btnGuardarOS = document.getElementById('btn-guardar-os');
  if (btnGuardarOS) {
    if (o.estado === 'CERRADA') {
      btnGuardarOS.textContent = '🧾 Facturar';
      btnGuardarOS.onclick = function() { facturarOS(o.id_orden); };
    } else {
      btnGuardarOS.textContent = 'GUARDAR OS';
      btnGuardarOS.onclick = function() { guardarOS(); };
    }
  }

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
    infoDiv.innerHTML = '<div style="color:#fc8181;font-size:12px">' + msgErr(e) + '</div>';
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
    const mon    = (l.moneda || 'USD').toUpperCase();
    const precio = parseFloat(l.precio_original !== undefined ? l.precio_original : (l.precio_usd || 0));
    const precioFmt = mon === 'VES' ? fmtBs(precio) : fmtUSD(precio);
    return '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
      + '<div style="font-size:13px;font-weight:500">' + l.descripcion + '</div>'
      + '<input type="number" value="' + l.cantidad + '" min="0.01" step="0.01" onchange="osServiciosLineas[' + i + '].cantidad=parseFloat(this.value)||1;calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:center">'
      + '<input type="text" value="' + precioFmt + '" onchange="osServiciosLineas[' + i + '].precio_original=parsePrecio(this.value,\'' + mon + '\');calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--naranja);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:right">'
      + '<div style="font-size:10px;font-weight:600;color:var(--suave);text-align:center">' + (monedaLabels[mon] || mon) + '</div>'
      + '<button onclick="quitarLineaServ(' + i + ')" style="background:none;border:none;color:#fc8181;cursor:pointer;font-size:16px;padding:0 4px">✕</button>'
      + '</div>';
  }).join('');
  calcularTotalesOS();
}

function renderLineasRep() {
  const cont = document.getElementById('os-lineas-rep');
  if (!cont) return;
  if (!osArtículosLineas.length) {
    cont.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:12px 0;text-align:center">Sin artículos agregados</div>';
    return;
  }
  const monedaLabels = { USD: '$ USD', EUR: '€ EUR', VES: 'Bs VES' };
  cont.innerHTML = '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px">'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px">Descripción</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Cant.</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:right">Precio</div>'
    + '<div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;text-align:center">Mon.</div>'
    + '<div></div></div>'
  + osArtículosLineas.map(function(l, i) {
    const mon    = (l.moneda || 'USD').toUpperCase();
    const precio = parseFloat(l.precio_original !== undefined ? l.precio_original : (l.precio_usd || 0));
    const precioFmt = mon === 'VES' ? fmtBs(precio) : fmtUSD(precio);
    return '<div style="display:grid;grid-template-columns:1fr 70px 110px 60px auto;gap:6px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
      + '<div style="font-size:13px;font-weight:500">' + l.descripcion + '</div>'
      + '<input type="number" value="' + l.cantidad + '" min="0.01" step="0.01" onchange="onCambiarCantidadLineaRep(' + i + ',this.value)" style="background:var(--gris3);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:center">'
      + '<input type="text" value="' + precioFmt + '" onchange="osArtículosLineas[' + i + '].precio_original=parsePrecio(this.value,\'' + mon + '\');calcularTotalesOS()" style="background:var(--gris3);border:1px solid var(--borde);color:var(--naranja);font-family:var(--font-mono);font-size:12px;padding:5px 8px;border-radius:4px;outline:none;text-align:right">'
      + '<div style="font-size:10px;font-weight:600;color:var(--suave);text-align:center">' + (monedaLabels[mon] || mon) + '</div>'
      + '<button onclick="quitarLineaRep(' + i + ')" style="background:none;border:none;color:#fc8181;cursor:pointer;font-size:16px;padding:0 4px">✕</button>'
      + '</div>';
  }).join('');
  calcularTotalesOS();
}

function parsePrecio(valor, moneda) {
  const s = (valor || '0').toString();
  // Todo el sistema MUESTRA los precios en formato venezolano (punto=miles,
  // coma=decimal) sin importar la moneda -- fmtUSD() es solo un alias de
  // fmtBs(). Por eso aquí también se debe parsear siempre igual; antes se
  // asumía formato inglés (coma=miles) para USD/EUR, lo que interpretaba
  // "80,00" como 8000 (inflado 100x).
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function convertirAUSD(precio, moneda) {
  if (moneda === 'VES') return tasasDisponiblesOS.USD > 0 ? precio / tasasDisponiblesOS.USD : precio;
  if (moneda === 'EUR') return tasasDisponiblesOS.USD > 0 && tasasDisponiblesOS.EUR > 0 ? precio * (tasasDisponiblesOS.EUR / tasasDisponiblesOS.USD) : precio;
  return precio; // USD
}

function quitarLineaServ(i) { osServiciosLineas.splice(i, 1); renderLineasOS(); }
function quitarLineaRep(i)  { osArtículosLineas.splice(i, 1); renderLineasRep(); refrescarSelectorArticulosOS(); }

// Se dispara al editar la Cantidad directamente en la lista de líneas de
// Artículos ya agregadas -- antes esto no validaba nada, permitiendo
// escribir cualquier número sin importar el stock real. Misma regla de
// bloqueo total que agregarMercanciaInventario(): nunca se puede superar
// el stock disponible en el área, contando también lo que ya ocupan las
// OTRAS líneas de ese mismo artículo en esta misma OS.
function onCambiarCantidadLineaRep(i, valor) {
  const linea = osArtículosLineas[i];
  if (!linea) return;
  const nuevaCant = parseFloat(valor) || 0;
  const art = inventarioCache.find(function(x) { return x.id_articulo === linea.id_articulo; });
  const stockDisponible = art ? stockMostrarArticulo(art.id_articulo) : 0;
  const usadoOtrasLineas = osArtículosLineas
    .filter(function(l, idx) { return idx !== i && l.id_articulo === linea.id_articulo; })
    .reduce(function(acc, l) { return acc + (parseFloat(l.cantidad) || 0); }, 0);
  const disponibleReal = stockDisponible - usadoOtrasLineas;
  if (nuevaCant > disponibleReal) {
    alert('⚠ Stock insuficiente. Disponible para este artículo: ' + disponibleReal
      + '. No se puede agregar una cantidad mayor a la disponible.');
    renderLineasRep(); // revertir el campo visual al último valor válido
    return;
  }
  linea.cantidad = nuevaCant || 1;
  calcularTotalesOS();
}

function calcularTotalesOS() {
  const tasaUSD = tasasDisponiblesOS.USD || tasaActualOS || 1;

  function lineaABs(precio, moneda) {
    const p   = parseFloat(precio) || 0;
    const mon = (moneda || 'USD').toUpperCase();
    if (mon === 'VES') return p;
    const tasa = tasasDisponiblesOS[mon] || tasaUSD;
    return p * tasa;
  }

  const totServBs = osServiciosLineas.reduce(function(acc, l) {
    return acc + lineaABs(l.precio_original || l.precio_usd, l.moneda) * parseFloat(l.cantidad);
  }, 0);
  const totRepBs = osArtículosLineas.reduce(function(acc, l) {
    return acc + lineaABs(l.precio_original || l.precio_usd, l.moneda || 'USD') * parseFloat(l.cantidad);
  }, 0);
  const totalBs  = totServBs + totRepBs;
  const totalUSD = tasaUSD > 0 ? totalBs / tasaUSD : 0;

  const el = document.getElementById('os-totales');
  if (el) el.innerHTML = '<div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding:12px 0">'
    + '<div><div style="font-size:10px;color:var(--suave);letter-spacing:1px">Servicios</div><div style="font-family:var(--font-mono)">' + fmtBs(totServBs) + ' Bs</div></div>'
    + '<div><div style="font-size:10px;color:var(--suave);letter-spacing:1px">Artículos</div><div style="font-family:var(--font-mono)">' + fmtBs(totRepBs) + ' Bs</div></div>'
    + '<div style="border-left:1px solid var(--borde);padding-left:24px">'
    +   '<div style="font-size:10px;color:var(--suave);letter-spacing:1px">TOTAL</div>'
    +   '<div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + fmtBs(totalBs) + ' Bs</div>'
    +   '<div style="font-size:12px;color:var(--suave)">$ ' + fmtUSD(totalUSD) + ' USD</div>'
    +   '<div style="font-size:9px;color:var(--suave);margin-top:2px">Tasa: $ 1 = ' + fmtBs(tasaUSD) + ' Bs</div>'
    + '</div>'
    + '</div>';

  // Actualizar totales globales para guardar en BD
  window._osLastTotalBs  = totalBs;
  window._osLastTotalUSD = totalUSD;
}

// ─── AGREGAR LÍNEA SERVICIO DESDE CATÁLOGO ───
async function agregarServicioCatalogo() {
  if (!catalogoCache.length) {
    try { catalogoCache = await api('servicios_catalogo', 'GET', null, '?activo=eq.true&order=grupo.asc,nombre.asc&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+''); } catch(e) {}
  }
  const sel    = document.getElementById('os-sel-cat');
  const precioLibre = document.getElementById('os-precio-libre');
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
      setTimeout(function() { descEl.style.borderColor = ''; descEl.placeholder = 'Escribe el concepto...'; }, 2000);
      descEl.focus();
      return;
    }
    const pVal = parseFloat(precioLibre.value) || 0;
    if (pVal <= 0) {
      precioLibre.style.borderColor = 'var(--naranja)';
      precioLibre.style.boxShadow = '0 0 0 3px rgba(255,107,0,0.2)';
      setTimeout(function() { precioLibre.style.borderColor = ''; precioLibre.style.boxShadow = ''; }, 2000);
      precioLibre.focus();
      precioLibre.select();
      return;
    }
    osServiciosLineas.push({ id_servicio: null, descripcion: descEl.value.trim().toUpperCase(),
      cantidad: parseFloat(cant.value) || 1, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
  } else {
    const s = catalogoCache.find(function(x) { return x.id_servicio == sel.value; });
    if (!s) return;
    const pVal = parseFloat(s.precio_usd) || 0;
    osServiciosLineas.push({ id_servicio: s.id_servicio, descripcion: s.nombre,
      cantidad: parseFloat(cant.value) || 1, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
  }
  // Resetear campos del formulario de agregar — sin borrar las opciones del select
  sel.value = '';
  precioLibre.value = '';
  precioLibre.readOnly = false; precioLibre.style.cursor = ''; precioLibre.style.opacity = ''; // desbloquear -- pudo quedar de solo lectura por un servicio de catálogo
  cant.value = '1';
  const descLibreEl = document.getElementById('os-desc-libre');
  if (descLibreEl) descLibreEl.value = '';
  // Desbloquear moneda
  const monedaSelEl = document.getElementById('os-moneda-cat');
  if (monedaSelEl) monedaSelEl.disabled = false;
  // Resetear también el grupo para que el usuario elija de nuevo
  const grpEl = document.getElementById('os-sel-grupo-cat');
  if (grpEl) grpEl.value = '';
  // Restaurar el toggle Nombre del Servicio / Concepto a su estado normal
  // (por si la línea se agregó estando en modo "Descripción Libre")
  const contNombreServReset = document.getElementById('os-cont-nombre-serv');
  const contConceptoReset   = document.getElementById('os-cont-concepto');
  if (contNombreServReset) contNombreServReset.style.display = '';
  if (contConceptoReset)   contConceptoReset.style.display = 'none';
  cant.readOnly = false; cant.style.cursor = ''; cant.style.opacity = ''; // desbloquear Cantidad -- ya no está en modo Descripción Libre
  // Ocultar todas las opciones de servicio hasta que se seleccione un grupo
  if (sel) Array.from(sel.options).forEach(function(opt) {
    if (opt.value) opt.style.display = 'none';
  });
  renderLineasOS();
}

function onSelCatalogoChange() {
  const sel = document.getElementById('os-sel-cat');
  const descLibre = document.getElementById('os-desc-libre');
  const cant = document.getElementById('os-cant-cat');

  if (!sel.value) {
    // Sin servicio de catálogo seleccionado (Concepto libre) → Precio se
    // desbloquea para que el Usuario lo escriba a mano.
    const monedaSel = document.getElementById('os-moneda-cat');
    if (monedaSel) monedaSel.disabled = false;
    const precioLibreElVacio = document.getElementById('os-precio-libre');
    if (precioLibreElVacio) {
      precioLibreElVacio.readOnly = false;
      precioLibreElVacio.style.cursor = '';
      precioLibreElVacio.style.opacity = '';
    }
    if (descLibre) setTimeout(function() { descLibre.focus(); }, 50);
    return;
  }

  // Servicio de catálogo seleccionado → el precio ya no se muestra en el
  // texto del <option> (solo el Nombre); se muestra aquí, en el campo
  // Precio, de solo lectura -- el precio real lo define el Catálogo de
  // Servicios, no se edita desde la Orden.
  const s = catalogoCache.find(function(x) { return x.id_servicio == sel.value; });
  if (s) {
    const precioLibreEl = document.getElementById('os-precio-libre');
    if (precioLibreEl) {
      precioLibreEl.value = parseFloat(s.precio_usd || 0).toFixed(2);
      precioLibreEl.readOnly = true;
      precioLibreEl.style.cursor = 'not-allowed';
      precioLibreEl.style.opacity = '0.6';
    }
    const monedaServ = (s.moneda_precio || 'USD').toUpperCase();
    const monedaSel  = document.getElementById('os-moneda-cat');
    // Asignar y bloquear la moneda — no se puede cambiar, viene del catálogo
    if (monedaSel) {
      // Asegurar que la opción existe en el select
      let optExists = Array.from(monedaSel.options).find(function(o) { return o.value === monedaServ; });
      if (!optExists) {
        const opt = document.createElement('option');
        opt.value = monedaServ;
        opt.textContent = monedaServ;
        monedaSel.appendChild(opt);
      }
      monedaSel.value   = monedaServ;
      monedaSel.disabled = true; // bloqueado — la moneda la define el catálogo
    }
  }
  if (cant) setTimeout(function() { cant.focus(); cant.select(); }, 50);
}

// ─── AGREGAR LÍNEA ARTÍCULO DESDE INVENTARIO ───
async function agregarMercanciaInventario() {
  if (!inventarioCache.length) {
    try { inventarioCache = await api('inventario_almacen', 'GET', null, '?order=nombre.asc&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+''); } catch(e) {}
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
    alert('Debe seleccionar un consumible del inventario.');
    return;
  } else {
    const r = inventarioCache.find(function(x) { return x.id_articulo == sel.value; });
    if (!r) return;
    const stockDisponible = stockMostrarArticulo(r.id_articulo);
    // Sumar lo que YA está agregado del mismo artículo en otras líneas de
    // esta misma OS (todavía no guardadas en BD, por eso stockDisponible
    // no las "ve" por sí solo) -- de lo contrario se podían agregar varias
    // líneas del mismo artículo, cada una pasando la validación por
    // separado, hasta sumar mucho más de lo que realmente existe.
    const yaAgregadoEnEstaOS = osArtículosLineas
      .filter(function(l) { return l.id_articulo === r.id_articulo; })
      .reduce(function(acc, l) { return acc + (parseFloat(l.cantidad) || 0); }, 0);
    const disponibleReal = stockDisponible - yaAgregadoEnEstaOS;
    if (cantVal > disponibleReal) {
      alert('⚠ Stock insuficiente. Disponible en tu área: ' + stockDisponible
        + (yaAgregadoEnEstaOS > 0 ? ' (ya agregaste ' + yaAgregadoEnEstaOS + ' de este artículo en esta misma Orden, quedan ' + disponibleReal + ' disponibles)' : '')
        + '. No se puede agregar una cantidad mayor a la disponible.');
      return;
    }
    const pVal = parseFloat(precio.value) || parseFloat(r.precio_venta_moneda) || 0;
    osArtículosLineas.push({ id_articulo: r.id_articulo, descripcion: r.nombre_articulo,
      cantidad: cantVal, precio_usd: precioAUSD(pVal, moneda),
      precio_original: pVal, moneda });
    sel.value = ''; precio.value = ''; cant.value = '1';
  }
  renderLineasRep();
  refrescarSelectorArticulosOS();
}

function onSelInventarioChange() {
  const sel = document.getElementById('os-sel-inv');
  const precio = document.getElementById('os-precio-inv');
  const monedaInv = document.getElementById('os-moneda-inv');
  if (!sel.value) { precio.value = ''; if (monedaInv) monedaInv.value = 'USD'; return; }
  const r = inventarioCache.find(function(x) { return x.id_articulo == sel.value; });
  if (r) {
    precio.value = parseFloat(r.precio_venta_moneda || 0).toFixed(2);
    // La Moneda viene del Artículo (inventario_almacen.moneda_venta, definida
    // en su última Salida de Stock) — bloqueada aquí, coherente con el
    // Precio que se muestra al lado. Queda deshabilitada en el HTML.
    if (monedaInv) monedaInv.value = r.moneda_venta || 'USD';
  }
}

// ─── GUARDAR OS ───
async function guardarOS() {
  if (window._guardandoOS) return;
  window._guardandoOS = true;
  const btnGuardar = document.getElementById('btn-guardar-os');
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...'; }
  try {
    await _guardarOSInterno();
  } finally {
    window._guardandoOS = false;
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'GUARDAR OS'; }
  }
}

async function _guardarOSInterno() {
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

  // Validar Vehículo, Km de Entrada, Fecha de Entrada y Fecha Prometida --
  // son los campos que aparecen más arriba en el formulario, en ese orden.
  if (!vehId) {
    errEl.textContent = 'Debe buscar y seleccionar un vehículo.';
    errEl.style.display = 'block';
    document.getElementById('os-placa-bus')?.focus();
    return;
  }
  if (km === null) {
    errEl.textContent = 'El Km de Entrada es obligatorio.';
    errEl.style.display = 'block';
    document.getElementById('os-km')?.focus();
    return;
  }
  if (!fechaEnt) {
    errEl.textContent = 'La fecha de entrada es obligatoria.';
    errEl.style.display = 'block';
    document.getElementById('os-fecha-entrada')?.focus();
    return;
  }
  if (!fechaProm) {
    errEl.textContent = 'La Fecha Prometida es obligatoria.';
    errEl.style.display = 'block';
    document.getElementById('os-fecha-prometida')?.focus();
    return;
  }

  // Validar fechas obligatorias según estado (más abajo en el formulario)
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
  if (!diagnostico) {
    errEl.textContent = 'El Diagnóstico es obligatorio.';
    errEl.style.display = 'block';
    document.getElementById('os-diagnostico')?.focus();
    return;
  }

  // Validar que tenga al menos un servicio o artículo -- estas secciones
  // están más abajo en el formulario, se revisan al final.
  const tieneServicios   = osServiciosLineas && osServiciosLineas.length > 0;
  const tieneConsumibles = osArtículosLineas && osArtículosLineas.length > 0;
  if (!tieneServicios && !tieneConsumibles) {
    errEl.textContent = 'Debe agregar al menos un Servicio o un Artículo antes de guardar la OS.';
    errEl.style.display = 'block';
    document.getElementById('os-sel-grupo-cat')?.focus();
    return;
  }

  const tasaUSDGuardar = tasasDisponiblesOS.USD || tasaActualOS || 1;

  function lineaABsGuardar(precio, moneda) {
    const p   = parseFloat(precio) || 0;
    const mon = (moneda || 'USD').toUpperCase();
    if (mon === 'VES') return p;
    return p * (tasasDisponiblesOS[mon] || tasaUSDGuardar);
  }

  const totServBs = osServiciosLineas.reduce(function(acc, l) {
    return acc + lineaABsGuardar(l.precio_original || l.precio_usd, l.moneda) * parseFloat(l.cantidad);
  }, 0);
  const totRepBs = osArtículosLineas.reduce(function(acc, l) {
    return acc + lineaABsGuardar(l.precio_original || l.precio_usd, l.moneda || 'USD') * parseFloat(l.cantidad);
  }, 0);
  const totalBsGuardar  = totServBs + totRepBs;
  const totalUSDGuardar = tasaUSDGuardar > 0 ? totalBsGuardar / tasaUSDGuardar : 0;
  // Para compatibilidad con campos existentes en BD
  const totServ = tasaUSDGuardar > 0 ? totServBs / tasaUSDGuardar : 0;
  const totRep  = tasaUSDGuardar > 0 ? totRepBs  / tasaUSDGuardar : 0;

  // Obtener id_propietario del vehículo
  let id_propietario = null;
  try {
    const veh = await api('vehiculos', 'GET', null, '?id_vehiculo=eq.' + vehId + '&select=id_propietario');
    if (veh.length) id_propietario = veh[0].id_propietario;
  } catch(e) {}

  if (!_empresaActiva) { alert('No hay empresa activa. Por favor seleccione una empresa.'); return; }

  try {
    let osId = id;
    const hoyEstado = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    const osActual = id ? ordenesCache.find(function(x) { return x.id_orden == id; }) : null;
    const estadoCambio = !osActual || osActual.estado !== estado;

    const datos = {
      id_empresa: _empresaActiva.id_empresa,
      id_vehiculo: parseInt(vehId),
      id_propietario: id_propietario,
      kilometraje_entrada: km,
      fecha_entrada:   fechaEnt,
      fecha_prometida: fechaProm    || null,
      fecha_cierre:    fechaCierre   || null,
      fecha_anulacion: fechaAnulacion || null,
      estado,
      diagnostico: diagnostico || null,
      observaciones: obs || null,
      tasa_bcv: tasaUSDGuardar,
      total_servicios_usd: totServ,
      total_articulos_usd: totRep,
      total_usd: totalUSDGuardar,
      total_ves: totalBsGuardar,
      id_usuario: sesionActual.correo_usuario,
      ...(estadoCambio ? {
        fecha_estado: hoyEstado,
        usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
      } : {}),
    };

    if (id) {
      // Editar
      await api('ordenes_servicio', 'PATCH', datos, '?id_orden=eq.' + id);
      // Borrar líneas anteriores y reinsertar
      // Guardar líneas de artículos anteriores para restaurar stock
      var lineasArtículosAntes = [];
      try {
        lineasArtículosAntes = await api('os_mercancias', 'GET', null, '?id_orden=eq.' + id + '&select=id_articulo,cantidad');
      } catch(e) {}
      await Promise.all([
        api('os_servicios', 'DELETE', null, '?id_orden=eq.' + id),
        api('os_mercancias', 'DELETE', null, '?id_orden=eq.' + id),
      ]);
    } else {
      // Nueva — generar número OS por empresa con reintento ante duplicado
      const hoy = new Date();
      const anio = hoy.getFullYear();
      const id_emisor = _empresaActiva ? _empresaActiva.id_empresa : 0;
      const prefijo = 'OS-' + anio + '-';
      const existentes = await api('ordenes_servicio', 'GET', null,
        '?select=numero_os&numero_os=gte.' + prefijo + '0000&numero_os=lte.' + prefijo + '9999&id_empresa=eq.' + id_emisor + '&order=numero_os.desc&limit=1');
      let seq = 1;
      if (existentes && existentes.length) {
        const partes = existentes[0].numero_os.split('-');
        seq = parseInt(partes[partes.length - 1]) + 1;
      }
      // Reintentar hasta 5 veces en caso de duplicado por concurrencia
      let intentos = 0;
      while (intentos < 5) {
        datos.numero_os = 'OS-' + anio + '-' + String(seq).padStart(4, '0');
        try {
          const res = await api('ordenes_servicio', 'POST', datos);
          if (res && res[0]) osId = res[0].id_orden;
          break; // éxito
        } catch(eDup) {
          if (eDup.message && eDup.message.includes('duplicate key')) {
            seq++;
            intentos++;
          } else {
            throw eDup; // otro error — propagar
          }
        }
      }
      if (!osId) throw new Error('No se pudo generar número de OS único después de varios intentos.');
    }

    // Insertar líneas de servicios
    for (var i = 0; i < osServiciosLineas.length; i++) {
      var l = osServiciosLineas[i];
      const monL   = (l.moneda || 'USD').toUpperCase();
      const precL  = parseFloat(l.precio_original || l.precio_usd || 0);
      const subtUsdL = parseFloat(l.precio_usd || 0) * parseFloat(l.cantidad);
      await api('os_servicios', 'POST', {
        id_orden: parseInt(osId), id_servicio: l.id_servicio || null,
        descripcion: l.descripcion, cantidad: l.cantidad,
        moneda: monL, precio_original: precL,
        precio_usd: l.precio_usd, subtotal_usd: subtUsdL
      });
    }

    // ── Restaurar stock de artículos anteriores (solo en edición) ──
    // Asignar un Artículo a la OS RESTA del stock que Taller YA TIENE
    // (no genera una entrega nueva desde Compras -- Compras no interviene
    // en este momento). Si es edición, las líneas anteriores ya fueron
    // borradas arriba -- hay que devolverle a Taller esa cantidad antes
    // de aplicar las líneas nuevas.
    const id_areaTallerOS = parseInt(document.getElementById('os-area')?.value) || null;
    if (id && lineasArtículosAntes && lineasArtículosAntes.length && id_areaTallerOS) {
      for (var k = 0; k < lineasArtículosAntes.length; k++) {
        var la = lineasArtículosAntes[k];
        if (!la.id_articulo) continue;
        try {
          var cantAntes = parseFloat(la.cantidad || 0);
          await upsertStockArea(la.id_articulo, id_areaTallerOS, cantAntes);
        } catch(eRest) { console.warn('Error restaurando stock:', eRest); }
      }
    }

    // ── Insertar nuevas líneas de artículos y descontar del stock de Taller ──
    for (var j = 0; j < osArtículosLineas.length; j++) {
      var lr = osArtículosLineas[j];
      const monR   = (lr.moneda || 'USD').toUpperCase();
      const precR  = parseFloat(lr.precio_original || lr.precio_usd || 0);
      const subtUsdR = parseFloat(lr.precio_usd || 0) * parseFloat(lr.cantidad);
      await api('os_mercancias', 'POST', {
        id_orden: parseInt(osId), id_articulo: lr.id_articulo || null,
        descripcion: lr.descripcion, cantidad: lr.cantidad,
        moneda: monR, precio_original: precR,
        precio_usd: lr.precio_usd, subtotal_usd: subtUsdR
      });
      // Descontar del stock que Taller YA TIENE -- no se toca Compras
      if (lr.id_articulo && id_areaTallerOS) {
        try {
          var cantNueva = parseFloat(lr.cantidad);
          await upsertStockArea(lr.id_articulo, id_areaTallerOS, -cantNueva);
        } catch(eStock) { console.warn('Error descontando stock:', eStock); }
      }
    }

    okEl.textContent = '✓ Orden de servicio guardada correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-os'); renderOrdenes(); }, 1200);
  } catch(e) { errEl.textContent = 'Error: ' + msgErr(e); errEl.style.display = 'block'; }
}

// ─── ANULAR OS ───
// ─── HELPER: restaurar o descontar stock de artículos de una OS ───
// operacion: 'restaurar' (anular OS) le devuelve el stock a Taller;
// 'descontar' (reabrir OS) se lo vuelve a restar -- Compras NO interviene
// en ninguno de los dos casos, porque el Artículo nunca salió de Taller
// (solo estaba reservado/asignado a esta OS).
async function ajustarStockOS(id_orden, operacion) {
  try {
    const [lineas, osRes] = await Promise.all([
      api('os_mercancias', 'GET', null, '?id_orden=eq.' + id_orden + '&select=id_articulo,cantidad'),
      api('ordenes_servicio', 'GET', null, '?id_orden=eq.' + id_orden + '&select=id_usuario'),
    ]);
    const correoCreadorOS = osRes && osRes[0] ? osRes[0].id_usuario : null;
    let id_areaTallerOS = null;
    if (correoCreadorOS) {
      const empOS = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(correoCreadorOS)+'&select=id_area&limit=1');
      id_areaTallerOS = empOS && empOS[0] ? empOS[0].id_area : null;
    }
    if (!id_areaTallerOS) {
      console.warn('ajustarStockOS: no se pudo determinar el área de Taller — stock no ajustado.');
      return;
    }
    for (var k = 0; k < lineas.length; k++) {
      var l = lineas[k];
      if (!l.id_articulo) continue;
      try {
        var cant = parseFloat(l.cantidad || 0);
        if (operacion === 'restaurar') {
          // Anular OS: se le devuelve la cantidad a Taller
          await upsertStockArea(l.id_articulo, id_areaTallerOS, cant);
        } else {
          // Reabrir OS: se le vuelve a restar a Taller
          await upsertStockArea(l.id_articulo, id_areaTallerOS, -cant);
        }
      } catch(eInv) { console.warn('Error ajustando stock artículo', l.id_articulo, eInv); }
    }
  } catch(e) { console.warn('Error ajustarStockOS:', e); }
}

// Genera la Factura directo desde una OS Cerrada -- mismo criterio que
// facturarVenta() en Ventas: sin preguntar Moneda de Facturación (usa la
// Moneda Funcional de la Empresa) ni IVA (siempre aplica). El IGTF, igual
// que en Ventas, se decide después, en el momento del Cobro, no aquí.
async function facturarOS(id) {
  if (!confirm('¿Facturar esta Orden de Servicio?')) return;
  const btn = document.getElementById('btn-guardar-os');
  const textoOriginalBtn = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando...'; }
  try {
    const osRows = await api('ordenes_servicio','GET',null,'?id_orden=eq.'+id+'&select=*,propietarios(nombre_completo,tipo_doc,numero_doc,direccion)');
    const os = osRows && osRows[0];
    if (!os) throw new Error('Orden de Servicio no encontrada.');
    if (os.estado !== 'CERRADA') throw new Error('Solo se puede facturar una OS en estado Cerrada.');

    const yaFacturada = await api('facturas','GET',null,'?id_orden=eq.'+id+'&estado=neq.ANULADA&select=id_factura,numero_factura');
    if (yaFacturada && yaFacturada.length) throw new Error('Esta OS ya tiene una factura activa: '+yaFacturada[0].numero_factura);

    await cargarTasaIVAGlobal();
    const prop = os.propietarios;
    const subtotal = parseFloat(os.total_usd||0);
    const iva = parseFloat((subtotal * tasaIVAActual()).toFixed(2));
    const total = parseFloat((subtotal + iva).toFixed(2));
    const tasaBCV = parseFloat(os.tasa_bcv) || 1;
    const totalVes = parseFloat((total * tasaBCV).toFixed(2));

    const anio = new Date().getFullYear();
    const existentes = await api('facturas','GET',null,'?select=numero_factura&numero_factura=like.FAC-'+anio+'-*&order=numero_factura.desc&limit=1');
    let seq = 1;
    if (existentes.length) { const p = existentes[0].numero_factura.split('-'); seq = parseInt(p[p.length-1])+1; }
    const numeroFactura = 'FAC-'+anio+'-'+String(seq).padStart(4,'0');

    const datosFactura = {
      id_orden: id, id_empresa: os.id_empresa, id_propietario: os.id_propietario,
      receptor_nombre: prop?.nombre_completo || 'Cliente sin nombre',
      receptor_rif: prop ? ((prop.tipo_doc||'')+'-'+(prop.numero_doc||'')) : null,
      receptor_direccion: prop?.direccion || null,
      receptor_tipo_contribuyente: null,
      moneda_cobro: (_empresaActiva?.moneda_principal || 'VES').toUpperCase(),
      fecha_emision: getHoyVzla(),
      estado: 'EMITIDA',
      aplica_iva: true, aplica_igtf: false,
      subtotal_usd: subtotal, iva_usd: iva, igtf_usd: 0,
      total_usd: total, total_ves: totalVes, tasa_bcv: tasaBCV,
      id_usuario: sesionActual.correo_usuario
    };

    const nuevaFactura = await api('facturas','POST',datosFactura);
    const idFacturaFinal = nuevaFactura && nuevaFactura[0] ? nuevaFactura[0].id_factura : null;
    if (!idFacturaFinal) throw new Error('No se pudo crear la Factura.');

    // Reutiliza el motor de CxC + Asiento Contable + Salida de Inventario +
    // Costo de Venta ya probado en producción (ver ingresos.js) -- ya sabe
    // manejar Órdenes de Servicio (fac.id_orden).
    await generarCxCyAsientoFactura(idFacturaFinal);

    cerrarModal('modal-os');
    renderOrdenes();
    alert('✓ Orden facturada correctamente: ' + numeroFactura);
  } catch(err) {
    alert('Error al facturar: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginalBtn; }
  }
}

async function anularOS(id, numero) {
  if (!puedo('SERVICIOS','ANULAR')) {
    alert('No tiene permiso para anular órdenes de servicio.');
    return;
  }
  // No se puede anular si ya tiene una factura asociada (misma salvedad que
  // antes tenía Eliminar, ya que Anular pasa a cubrir ambos casos)
  try {
    const facturasAnul = await api('facturas', 'GET', null, '?id_orden=eq.' + id + '&select=id_factura&limit=1');
    if (facturasAnul && facturasAnul.length > 0) {
      alert('No se puede anular la orden ' + numero + ' porque tiene una factura asociada.');
      return;
    }
  } catch(eFactAnul) { console.warn('Error verificando factura asociada:', eFactAnul); }
  if (!confirm('¿Anular la orden ' + numero + '? El Artículo asignado a esta OS se devolverá al Stock del Área de Taller.')) return;
  try {
    const hoyAnul = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    // Anular la OS devuelve al Área de Taller el stock que se le había
    // restado al asignar el Artículo (ver ajustarStockOS) -- ya no es "solo
    // un cambio de estado": el Artículo nunca salió de Compras (el modelo
    // viejo, donde la OS actuaba como la entrega Compras→Taller, ya no
    // aplica), solo estaba reservado dentro del propio stock de Taller.
    await ajustarStockOS(id, 'restaurar');
    await api('ordenes_servicio', 'PATCH', {
      estado: 'ANULADA',
      fecha_estado: hoyAnul,
      usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
    }, '?id_orden=eq.' + id);
    renderOrdenes();
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

// ─── REABRIR OS (requiere permiso SERVICIOS.REABRIR) ───
async function reabrirOS(id, numero) {
  if (!puedo('SERVICIOS','REABRIR')) {
    alert('No tiene permiso para reabrir órdenes de servicio.');
    return;
  }
  if (!confirm('¿Reabrir la orden ' + numero + '? El Artículo que se le había devuelto al Área de Taller se le volverá a restar (vuelve a quedar asignado a esta OS).')) return;
  try {
    const hoyReab = new Date(new Date().getTime() - 4*60*60*1000).toISOString().split('T')[0];
    // Reabrir la OS le vuelve a restar al Área de Taller el stock que se
    // le había devuelto al anular (ver ajustarStockOS y anularOS()).
    await ajustarStockOS(id, 'descontar');
    await api('ordenes_servicio', 'PATCH', {
      estado: 'ABIERTA',
      fecha_estado: hoyReab,
      usuario_estado: sesionActual.nombre || sesionActual.correo_usuario,
    }, '?id_orden=eq.' + id);
    renderOrdenes();
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

// ─── FICHA OS ───

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
  // Área que realiza el servicio -- se resuelve por el usuario que creó la
  // OS (empleados.id_area), ya no se guarda en ordenes_servicio.
  let areaLabelFicha = '—';
  try {
    if (o.id_usuario) {
      const empAreaRows = await api('empleados', 'GET', null,
        '?correo=eq.' + encodeURIComponent(o.id_usuario) + '&select=param_areas(codigo,nombre)&limit=1');
      const a = empAreaRows && empAreaRows[0] && empAreaRows[0].param_areas;
      if (a) areaLabelFicha = (a.codigo ? a.codigo + ' — ' : '') + a.nombre;
    }
  } catch(eAreaFicha) { console.warn('Error resolviendo Área en Ficha OS:', eAreaFicha); }
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
      api('os_mercancias', 'GET', null, '?id_orden=eq.' + id + '&select=*'),
      api('tasas', 'GET', null, '?moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio'),
    ]);
    const tasaActualFicha = tasasActuales.length ? parseFloat(tasasActuales[0].tipo_cambio) : null;
    const tasaHistorica = parseFloat(o.tasa_bcv || 1);
    const tasaDiferente = tasaActualFicha && Math.abs(tasaActualFicha - tasaHistorica) > 0.01;
    // Tasa para mostrar el equivalente en Bs de cada línea -- la vigente si
    // la OS sigue abierta, o la que quedó registrada si ya está Cerrada/Anulada
    const tasaParaLineas = (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' && tasaActualFicha) ? tasaActualFicha : tasaHistorica;
    const est = ESTADOS_OS[o.estado] || { clase: 'badge-gris', label: o.estado };
    const veh = o.vehiculos;
    const prop = o.propietarios;

    const tablaServ = linServ.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr>'
        + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px">DESCRIPCIÓN</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">P/U</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SUBTOTAL</th>'
        + '</tr></thead><tbody>'
        + linServ.map(function(l) {
            const mon  = (l.moneda || 'USD').toUpperCase();
            const prec = parseFloat(l.precio_original || l.precio_usd || 0);
            const subt = parseFloat(l.subtotal_usd || 0);
            const simbolo = { USD: '$', EUR: '€', USDT: '₮' };
            const sim = simbolo[mon] || '';
            const precUsdEq  = mon === 'VES' ? (tasaParaLineas > 0 ? parseFloat(l.precio_usd || 0) : 0) : prec;
            const subtUsdEq  = subt;
            const precFmt = mon === 'VES'
              ? fmtBs(prec) + ' Bs<div style="font-size:10px;color:var(--suave)">≈ $ ' + fmtUSD(precUsdEq) + '</div>'
              : sim + ' ' + fmtUSD(prec) + ' ' + mon + '<div style="font-size:10px;color:var(--suave)">≈ Bs ' + fmtBs(prec * tasaParaLineas) + '</div>';
            const subtFmt = mon === 'VES'
              ? fmtBs(subt * tasaParaLineas) + ' Bs<div style="font-size:10px;color:var(--suave)">≈ $ ' + fmtUSD(subtUsdEq) + '</div>'
              : sim + ' ' + fmtUSD(subt) + ' ' + mon + '<div style="font-size:10px;color:var(--suave)">≈ Bs ' + fmtBs(subt * tasaParaLineas) + '</div>';
            return '<tr><td style="padding:6px 0;font-size:14px">' + l.descripcion + '</td>'
              + '<td style="text-align:right;padding:6px 0">' + l.cantidad + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono)">' + precFmt + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono);color:var(--naranja)">' + subtFmt + '</td></tr>';
          }).join('')
        + '</tbody></table>'
      : '<div style="color:var(--suave);font-size:12px">Sin servicios</div>';

    const tablaRep = linRep.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr>'
        + '<th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px">ARTÍCULO</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANT</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">P/U</th>'
        + '<th style="text-align:right;padding:6px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">SUBTOTAL</th>'
        + '</tr></thead><tbody>'
        + linRep.map(function(l) {
            const mon  = (l.moneda || 'USD').toUpperCase();
            const prec = parseFloat(l.precio_original || l.precio_usd || 0);
            const subt = parseFloat(l.subtotal_usd || 0);
            const simbolo = { USD: '$', EUR: '€', USDT: '₮' };
            const sim = simbolo[mon] || '';
            const precFmt = mon === 'VES'
              ? fmtBs(prec) + ' Bs<div style="font-size:10px;color:var(--suave)">≈ $ ' + fmtUSD(parseFloat(l.precio_usd || 0)) + '</div>'
              : sim + ' ' + fmtUSD(prec) + ' ' + mon + '<div style="font-size:10px;color:var(--suave)">≈ Bs ' + fmtBs(prec * tasaParaLineas) + '</div>';
            const subtFmt = mon === 'VES'
              ? fmtBs(subt * tasaParaLineas) + ' Bs<div style="font-size:10px;color:var(--suave)">≈ $ ' + fmtUSD(subt) + '</div>'
              : sim + ' ' + fmtUSD(subt) + ' ' + mon + '<div style="font-size:10px;color:var(--suave)">≈ Bs ' + fmtBs(subt * tasaParaLineas) + '</div>';
            return '<tr><td style="padding:6px 0;font-size:14px">' + l.descripcion + '</td>'
              + '<td style="text-align:right;padding:6px 0">' + l.cantidad + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono)">' + precFmt + '</td>'
              + '<td style="text-align:right;padding:6px 0;font-family:var(--font-mono);color:var(--naranja)">' + subtFmt + '</td></tr>';
          }).join('')
        + '</tbody></table>'
      : '<div style="color:var(--suave);font-size:12px">Sin artículos</div>';

    document.getElementById('ficha-os-contenido').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px;flex-wrap:wrap">'
      + '<div><div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + (o.numero_os || '—') + '</div>'
      + '<span class="badge ' + est.clase + '">' + est.label + '</span>'
      + (o.fecha_estado ? '<span style="font-size:10px;color:var(--suave);margin-left:8px">desde ' + fmtFecha(o.fecha_estado) + (o.usuario_estado ? ' · ' + o.usuario_estado : '') + '</span>' : '')
      + '</div>'
      + '<div style="text-align:right"><div style="font-size:10px;color:var(--suave);letter-spacing:1px">TOTAL</div>'
      + '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + fmtBs(o.total_ves) + ' Bs</div>'
      + '<div style="font-size:12px;color:var(--suave)">$ ' + fmtUSD(o.total_usd) + ' USD</div>'
      + '</div></div>'
      + '<div style="font-size:10px;color:var(--suave);margin-bottom:16px">Área: ' + areaLabelFicha + '</div>'

      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Vehículo</div>'
      + '<div style="font-weight:500">' + (veh ? veh.placa + ' — ' + veh.marca + ' ' + veh.modelo : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Propietario</div>'
      + '<div>' + (prop ? prop.nombre_completo : '—') + '</div></div>'
      + '</div>'

      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Fecha Entrada</div>'
      + '<div style="font-size:12px">' + (o.fecha_entrada ? fmtFecha(o.fecha_entrada) : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Fecha Prometida</div>'
      + '<div style="font-size:12px">' + (o.fecha_prometida ? fmtFecha(o.fecha_prometida) : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Km Entrada</div>'
      + '<div style="font-size:12px">' + (o.kilometraje_entrada ? o.kilometraje_entrada.toLocaleString() + ' km' : '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' ? 'Tasa USD Actual' : 'Tasa USD al Cerrar')
      + '</div><div style="font-family:var(--font-mono);font-size:12px">'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' && tasaActualFicha ? tasaActualFicha : tasaHistorica).toFixed(2) + ' Bs/$'
      + (o.estado !== 'CERRADA' && o.estado !== 'ANULADA' && tasaDiferente ? '<span style="font-size:9px;color:var(--suave);margin-left:6px">(creada: ' + tasaHistorica.toFixed(2) + ')</span>' : '')
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
      + '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">📦 Artículos Utilizados</div>'
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
    if (puedo('SERVICIOS','REABRIR') && (o.estado === 'CERRADA' || o.estado === 'ANULADA')) {
      btnReabrir.textContent = '↺ Reabrir OS';
      btnReabrir.setAttribute('onclick', 'cerrarModal(\'modal-ficha-os\');reabrirOS(' + id + ',\'' + (o.numero_os || '') + '\')');
      btnReabrir.style.display = '';
    } else {
      btnReabrir.style.display = 'none';
    }
    // Botón Anular (siempre visible si la OS no está ya anulada; el permiso
    // se valida dentro de anularOS() al hacer clic, igual que en el resto
    // de módulos)
    let btnAnularOS = document.getElementById('ficha-os-anular-btn');
    if (!btnAnularOS) {
      btnAnularOS = document.createElement('button');
      btnAnularOS.id = 'ficha-os-anular-btn';
      btnAnularOS.className = 'btn-peligro';
      document.getElementById('ficha-os-editar-btn').parentNode.insertBefore(btnAnularOS, document.getElementById('ficha-os-editar-btn'));
    }
    if (o.estado !== 'ANULADA') {
      btnAnularOS.textContent = '🗑 Anular OS';
      btnAnularOS.setAttribute('onclick', 'cerrarModal(\'modal-ficha-os\');anularOS(' + id + ',\'' + (o.numero_os || '') + '\')');
      btnAnularOS.style.display = '';
    } else {
      btnAnularOS.style.display = 'none';
    }
    window._fichaOSId = o.id_orden;
    abrirModal('modal-ficha-os');
  focusFirstField('modal-ficha-os');
  } catch(e) { alert('Error: ' + msgErr(e)); }
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
      tasa_bcv: nuevaTasa,
      total_ves: nuevoTotalVes,
    }, '?id_orden=eq.' + id);
    // Actualizar cache local
    o.tasa_bcv = nuevaTasa;
    o.total_ves = nuevoTotalVes;
    cerrarModal('modal-ficha-os');
    renderOrdenes();
  } catch(e) { alert('Error: ' + msgErr(e)); }
}

// ─── Cargar catálogo e inventario en selects del modal OS ───
async function cargarSelectsOS() {
  try {
    if (!catalogoCache.length) catalogoCache = await api('servicios_catalogo', 'GET', null, '?activo=eq.true&order=grupo.asc,nombre.asc&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
    inventarioCache = await api('inventario_almacen', 'GET', null, '?order=nombre_articulo.asc&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
  } catch(e) { console.warn('Error cargando catalogo/inventario para OS:', e); }

  // ── Área que realiza el servicio: se resuelve sola por el usuario (ver
  // _resolverAreaOS), no se carga como catálogo aquí. ──

  // ── Cargar selector de GRUPOS ──
  const selGrupo = document.getElementById('os-sel-grupo-cat');
  if (selGrupo) {
    const grupos = [...new Set(catalogoCache.map(function(s) { return s.grupo; }).filter(Boolean))].sort();
    selGrupo.innerHTML = '<option value="">— Seleccionar grupo —</option>'
      + grupos.map(function(g) { return '<option value="' + g + '">' + g + '</option>'; }).join('');
  }
  // Al abrir el modal siempre se parte del estado normal: Nombre del
  // Servicio visible, Concepto oculto -- por si quedó en el otro estado de
  // una Orden anterior en la misma sesión del navegador.
  const contNombreServInit = document.getElementById('os-cont-nombre-serv');
  const contConceptoInit   = document.getElementById('os-cont-concepto');
  if (contNombreServInit) contNombreServInit.style.display = '';
  if (contConceptoInit)   contConceptoInit.style.display = 'none';
  const cantCatInit = document.getElementById('os-cant-cat');
  if (cantCatInit) { cantCatInit.readOnly = false; cantCatInit.style.cursor = ''; cantCatInit.style.opacity = ''; }
  const precioLibreInit = document.getElementById('os-precio-libre');
  if (precioLibreInit) { precioLibreInit.readOnly = false; precioLibreInit.style.cursor = ''; precioLibreInit.style.opacity = ''; }

  // ── Cargar selector de SERVICIOS — todos ocultos hasta seleccionar grupo ──
  const selCat = document.getElementById('os-sel-cat');
  if (selCat) {
    selCat.innerHTML = '<option value="">— Primero seleccione un grupo —</option>'
      + catalogoCache.map(function(s) {
          return '<option value="' + s.id_servicio + '" data-grupo="' + (s.grupo || '') + '" style="display:none">'
            + s.nombre + '</option>';
        }).join('');
  }

  // ── Cargar selector de INVENTARIO ──
  // Recalcular el saldo por área/consolidado SIEMPRE fresco al abrir este
  // selector -- antes dependía de un cálculo hecho la última vez que se
  // visitó el módulo de Inventario (si es que se visitó), pudiendo quedar
  // desactualizado tras usar/anular Órdenes de Servicio en esta sesión.
  if (typeof calcularInvSaldoArea === 'function') {
    try { await calcularInvSaldoArea(); } catch(eSaldoOS) { console.warn('Error recalculando saldo para OS:', eSaldoOS); }
  }
  const selInv = document.getElementById('os-sel-inv');
  if (selInv) try {
    // Calcular saldo por área si no está disponible y el usuario no tiene permiso general
    if (!_invSaldoArea && !sesionActual?.administrador && !puedo('INVENTARIO','VER_INVENTARIO_GENERAL') && inventarioCache.length > 0) {
      try {
        const correo = sesionActual?.correo_usuario;
        const empRes = correo ? await api('empleados','GET',null,
          '?correo=eq.'+encodeURIComponent(correo)+'&select=id_area&limit=1') : [];
        const id_areaUsuario = empRes?.[0]?.id_area || null;
        if (id_areaUsuario) {
          const inClause = inventarioCache.map(function(r){ return r.id_articulo; }).join(',');
          const t4s = function(){ return new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); },4000); }); };
          const [entsDirectas, salsRecibidas, salsEnviadas] = await Promise.all([
            Promise.race([api('stock_entradas','GET',null,'?id_area=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
            Promise.race([api('stock_salidas','GET',null,'?id_area=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; }),
            Promise.race([api('stock_salidas','GET',null,'?id_area_entrega=eq.'+id_areaUsuario+'&id_articulo=in.('+inClause+')&select=id_articulo,cantidad'), t4s()]).catch(function(){ return []; })
          ]);
          const saldo = {};
          (entsDirectas||[]).forEach(function(e){ saldo[e.id_articulo] = (saldo[e.id_articulo]||0) + parseFloat(e.cantidad||0); });
          (salsRecibidas||[]).forEach(function(s){ saldo[s.id_articulo] = (saldo[s.id_articulo]||0) + parseFloat(s.cantidad||0); });
          (salsEnviadas||[]).forEach(function(s){ saldo[s.id_articulo] = (saldo[s.id_articulo]||0) - parseFloat(s.cantidad||0); });
          _invSaldoArea = saldo;
        }
      } catch(eS) { console.warn('Error calculando saldo área OS:', eS); }
    }

    // Filtrar: solo Mercancías (cuenta contable 1.1.03.001) con saldo
    // positivo en el área del usuario -- los Consumibles (ej. 1.1.03.002)
    // no deben ofrecerse aquí, ya que las Órdenes de Servicio son para
    // repuestos/mercancías del vehículo, no para artículos de uso interno.
    let itemsDisponibles = inventarioCache;
    if (!_idCuentaMercanciasOS) {
      try {
        const ctaMercRows = await api('cont_cuentas','GET',null,'?codigo=eq.1.1.03.001&select=id_cuenta&limit=1');
        _idCuentaMercanciasOS = ctaMercRows && ctaMercRows[0] ? ctaMercRows[0].id_cuenta : null;
      } catch(eCtaM) { console.warn('Error buscando cuenta de Mercancías:', eCtaM); }
    }
    if (_idCuentaMercanciasOS) {
      itemsDisponibles = itemsDisponibles.filter(function(r) { return String(r.id_cuenta_contable) === String(_idCuentaMercanciasOS); });
    }
    if (_invSaldoArea && !sesionActual?.administrador && !puedo('INVENTARIO','VER_INVENTARIO_GENERAL')) {
      itemsDisponibles = itemsDisponibles.filter(function(r) {
        return (_invSaldoArea[r.id_articulo] || 0) > 0;
      });
    }
    selInv.innerHTML = '<option value="">— Seleccionar —</option>'
      + itemsDisponibles.map(function(r) {
          const stock = stockMostrarArticulo(r.id_articulo);
          return '<option value="' + r.id_articulo + '">' + r.nombre_articulo + ' (Stock: ' + stock + ')</option>';
        }).join('');
  } catch(eInvSel) { console.warn('Error cargando selector de Mercancías en OS:', eInvSel); }
}

// Refresca solo las ETIQUETAS "(Stock: X)" del selector de Artículos de la
// OS, restando lo que ya se agregó en líneas de esta misma Orden (todavía
// no guardadas en BD -- stockMostrarArticulo() por sí solo no las ve).
// Se llama tras cada Agregar/Quitar línea para que el número mostrado no
// quede desactualizado durante la sesión de edición de la OS.
function refrescarSelectorArticulosOS() {
  const selInv = document.getElementById('os-sel-inv');
  if (!selInv) return;
  const valorPrevio = selInv.value;
  Array.prototype.forEach.call(selInv.options, function(opt) {
    if (!opt.value) return; // "— Seleccionar —"
    const stockReal = stockMostrarArticulo(opt.value);
    const yaAgregado = osArtículosLineas
      .filter(function(l) { return String(l.id_articulo) === String(opt.value); })
      .reduce(function(acc, l) { return acc + (parseFloat(l.cantidad) || 0); }, 0);
    const stockMostrar = stockReal - yaAgregado;
    const r = inventarioCache.find(function(x) { return String(x.id_articulo) === String(opt.value); });
    if (r) opt.textContent = r.nombre_articulo + ' (Stock: ' + stockMostrar + ')';
  });
  selInv.value = valorPrevio;
}

// Comparación robusta de texto -- sin mayúsculas ni acentos -- para no
// depender de que "DESCRIPCIÓN LIBRE" esté escrito exactamente igual en
// la base de datos que en este código.
function _normTxt(s) {
  return (s || '').toString().trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Filtrar servicios al cambiar el Grupo ──
function onSelGrupoCatChange() {
  const grupo = document.getElementById('os-sel-grupo-cat').value;
  const selCat = document.getElementById('os-sel-cat');
  const esDescLibre = _normTxt(grupo) === 'DESCRIPCION LIBRE';

  const contNombreServ = document.getElementById('os-cont-nombre-serv');
  const contConcepto   = document.getElementById('os-cont-concepto');
  const descLibreEl    = document.getElementById('os-desc-libre');
  const precioLibreEl  = document.getElementById('os-precio-libre');

  if (esDescLibre) {
    // Grupo "DESCRIPCIÓN LIBRE": no se toma el servicio/precio (0) asociado
    // a ese grupo en el catálogo -- se oculta el selector de Nombre del
    // Servicio y se usa en su lugar el campo Concepto (texto libre) con su
    // propio Precio Venta, que el Usuario ingresa manualmente. La Cantidad
    // queda fija en 1 y de solo lectura -- un concepto libre es una línea
    // única, no tiene sentido "cantidad" editable.
    if (contNombreServ) contNombreServ.style.display = 'none';
    if (contConcepto)   contConcepto.style.display = '';
    selCat.value = ''; // asegurar que no quede seleccionado el servicio placeholder de precio 0
    if (precioLibreEl) { precioLibreEl.value = ''; precioLibreEl.readOnly = false; precioLibreEl.style.cursor = ''; precioLibreEl.style.opacity = ''; }
    const cantElDL = document.getElementById('os-cant-cat');
    if (cantElDL) { cantElDL.value = '1'; cantElDL.readOnly = true; cantElDL.style.cursor = 'not-allowed'; cantElDL.style.opacity = '0.6'; }
    const monedaSelDL = document.getElementById('os-moneda-cat');
    if (monedaSelDL) monedaSelDL.disabled = false;
    setTimeout(function() { descLibreEl?.focus(); }, 50);
    return;
  }

  // Cualquier otro grupo (o ninguno): comportamiento normal -- mostrar
  // Nombre del Servicio, ocultar Concepto y limpiar su texto para que no
  // quede un concepto de una selección anterior mezclado con un servicio real.
  if (contNombreServ) contNombreServ.style.display = '';
  if (contConcepto)   contConcepto.style.display = 'none';
  if (descLibreEl) descLibreEl.value = '';
  const cantElNorm = document.getElementById('os-cant-cat');
  if (cantElNorm) { cantElNorm.readOnly = false; cantElNorm.style.cursor = ''; cantElNorm.style.opacity = ''; } // desbloquear -- ya no es Descripción Libre

  // Mostrar solo servicios del grupo seleccionado (o todos si grupo vacío)
  Array.from(selCat.options).forEach(function(opt) {
    if (!opt.value) { opt.style.display = ''; return; } // placeholder siempre visible
    opt.style.display = (!grupo || opt.dataset.grupo === grupo) ? '' : 'none';
  });

  // Siempre resetear a "— Seleccionar servicio —" y limpiar precio
  selCat.value = '';
}

// Cargar selects cuando se abre el modal OS
// NOTA: No sobreescribir abrirModal — llamar cargarSelectsOS directamente desde abrirNuevaOS y abrirEditarOS


window.addEventListener('load', async () => {
  // sessionStorage se limpia con Ctrl+Shift+R — usar localStorage como fallback
  const guardado = sessionStorage.getItem('sd_sesion') || localStorage.getItem('sd_sesion');
  if (guardado) {
    // Sincronizar sessionStorage si vino de localStorage
    if (!sessionStorage.getItem('sd_sesion')) {
      sessionStorage.setItem('sd_sesion', guardado);
    }
    try {
      const { usuario, accesos, jwt, jwtExpiry, refreshToken } = JSON.parse(guardado);

      let jwtVigente       = jwt;
      let jwtExpiryVigente = jwtExpiry;

      // Si el access_token expiró (dura 1 hora), intentar renovarlo en
      // silencio con el refresh_token antes de forzar un nuevo login
      if ((!jwtVigente || !jwtExpiryVigente || Date.now() >= jwtExpiryVigente) && refreshToken) {
        try {
          const refRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          const refData = await refRes.json().catch(function() { return null; });
          if (refData && refData.access_token) {
            jwtVigente       = refData.access_token;
            jwtExpiryVigente = refData.expires_at * 1000;
            _sessionRefreshToken = refData.refresh_token;
          }
        } catch (eRef) { /* si falla, cae al chequeo de abajo */ }
      } else {
        _sessionRefreshToken = refreshToken || null;
      }

      // Si sigue sin haber un token vigente, la sesión ya no es válida —
      // forzar re-login en vez de continuar silenciosamente con la anon key.
      if (!jwtVigente || !jwtExpiryVigente || Date.now() >= jwtExpiryVigente) {
        sessionStorage.removeItem('sd_sesion');
        localStorage.removeItem('sd_sesion');
        throw new Error('Sesión expirada, se requiere iniciar sesión de nuevo.');
      }
      _sessionJWT       = jwtVigente;
      _sessionJWTExpiry = jwtExpiryVigente;
      iniciarRenovacionJWT();

      // Refrescar el storage con el token renovado (si cambió)
      const sesionActualizada = JSON.stringify({ usuario, accesos, jwt: jwtVigente, jwtExpiry: jwtExpiryVigente, refreshToken: _sessionRefreshToken });
      sessionStorage.setItem('sd_sesion', sesionActualizada);
      localStorage.setItem('sd_sesion', sesionActualizada);

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
            '?correo_usuario=eq.'+encodeURIComponent(usuario.correo_usuario)+'&activo=eq.true&select=id_empresa');
          const idsPermitidos = new Set(ues.map(function(x){ return x.id_empresa; }));
          _empresasUsuario = todasEmisores.filter(function(e){ return idsPermitidos.has(e.id_empresa); });
          if (_empresasUsuario.length === 1) _empresaActiva = _empresasUsuario[0];
        }
        // Restaurar empresa activa desde sessionStorage o localStorage
        const empGuardada = sessionStorage.getItem('sd_empresa_activa') || localStorage.getItem('sd_empresa_activa');
        if (empGuardada) {
          const emp = JSON.parse(empGuardada);
          const empEncontrada = _empresasUsuario.find(function(e){ return e.id_empresa === emp.id_empresa; });
          if (empEncontrada) _empresaActiva = empEncontrada;
        }
        // Fallback: si no hay empresa guardada, tomar la primera disponible
        if (!_empresaActiva && _empresasUsuario.length > 0) {
          _empresaActiva = _empresasUsuario[0];
        }
      } catch(eE) { console.warn('Error cargando empresas al restaurar sesión:', eE); }

      // Generar un token PROPIO y escribirlo en BD -- igual que un login
      // real, para que esta pestaña restaurada desplace correctamente
      // cualquier otra sesión activa (no basta con leer/adoptar el token
      // que ya hubiera en BD: si dos pestañas hicieran eso, ambas
      // terminarían con el MISMO token y el control de sesión única
      // nunca detectaría un conflicto entre ellas).
      try {
        const miTokenRestaurado = Math.random().toString(36).substr(2) + Date.now().toString(36);
        window._miTokenSesion = miTokenRestaurado;
        await api('usuarios', 'PATCH', {
          sesion_activa: true, sesion_invalidada: false,
          ultimo_acceso: new Date().toISOString(), ultima_conexion: new Date().toISOString(),
          token_sesion: miTokenRestaurado
        }, '?correo_usuario=eq.' + encodeURIComponent(usuario.correo_usuario));
        clearInterval(_pollingInterval);
        _pollingInterval = setInterval(verificarSesionActiva, 30000);
        window._sesionLista = true;
      } catch(eT) { console.warn('Error generando token propio al restaurar sesión:', eT); }

      // iniciarApp DESPUÉS de que _empresaActiva esté asignado
      iniciarApp();
      actualizarEmpresaUI();
      const btnCambiarEmp = document.getElementById('btn-cambiar-empresa');
      if (btnCambiarEmp) btnCambiarEmp.style.display = _empresasUsuario.length > 1 ? '' : 'none';
      iniciarTimerInactividad();
    } catch(e) {
      sessionStorage.removeItem('sd_sesion');
      localStorage.removeItem('sd_sesion');
    }
  }
});
  // ─── NAVEGACIÓN ENTRE CAMPOS CON ENTER / SELECCIÓN ───
  // Un campo se considera "vacío" si no tiene valor (input/textarea) o no
  // tiene nada seleccionado (select). Usado SOLO para el salto tras elegir
  // una opción de un <select> -- ej. Cuenta de Gasto autocompletada al
  // elegir Proveedor se salta sola. Con Enter NO se usa esta lógica, porque
  // varios campos numéricos traen un valor por defecto (ej. "0.00") que
  // técnicamente no está "vacío" pero sí necesita que el usuario lo edite.
  function campoEstaVacio(campo) {
    if (campo.tagName === 'SELECT') return !campo.value;
    if (campo.type === 'checkbox' || campo.type === 'radio') return !campo.checked;
    return !String(campo.value || '').trim();
  }

  function getCamposNavegables(el) {
    const modal = el.closest('.modal') || el.closest('.modal-body') || document.body;
    return Array.from(modal.querySelectorAll(
      'input:not([type=hidden]):not([disabled]):not([readonly]):not([type=button]):not([type=submit]), select:not([disabled]), textarea:not([disabled])'
    )).filter(function(c) { return c.offsetParent !== null; });
  }

  // Enter -- siempre al campo inmediato siguiente, simple y predecible
  function nextField(el) {
    try {
      const campos = getCamposNavegables(el);
      const idx = campos.indexOf(el);
      if (idx !== -1 && idx < campos.length - 1) campos[idx + 1].focus();
    } catch(e) {}
  }

  // Selección en un <select> -- saltar los campos ya autocompletados
  function nextEmptyField(el) {
    try {
      const campos = getCamposNavegables(el);
      const idx = campos.indexOf(el);
      if (idx === -1 || idx >= campos.length - 1) return;
      for (let i = idx + 1; i < campos.length; i++) {
        if (campoEstaVacio(campos[i])) { campos[i].focus(); return; }
      }
      campos[idx + 1].focus();
    } catch(e) {}
  }

  function focusFirstField(modalId) {
    setTimeout(function() {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      // Agregar navegación con Enter y con selección (change) a todos los campos del modal
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
          // Al elegir una opción de un <select> (con mouse o teclado), saltar
          // al próximo campo VACÍO -- pequeño delay para que primero corra
          // el onchange propio del campo (ej. autocompletar Cuenta de Gasto)
          // antes de decidir a cuál campo saltar.
          if (campo.tagName === 'SELECT') {
            campo.addEventListener('change', function() {
              setTimeout(function(){ nextEmptyField(campo); }, 150);
            });
          }
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




