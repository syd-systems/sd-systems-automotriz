// ─── S&D Systems — Módulo: CLIENTES ───
// Creado el 2026-08-26. Clientes es una entidad GLOBAL (no atada a id_empresa) --
// un mismo cliente puede operar con cualquiera de las empresas del sistema.
// El vínculo comercial por empresa (crédito, límite, moneda) se maneja aparte
// cuando se implemente CxC (tabla clientes_empresa, pendiente).

const CONDICION_LEGAL_LABEL = { V: 'Venezolano', E: 'Extranjero', J: 'Jurídico', G: 'Gubernamental', C: 'Comuna' };

async function renderClientes() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('CLIENTES')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando clientes...</div>';
  try {
    const clientes = await api('clientes', 'GET', null, '?order=nombre_apellido.asc&select=*');
    clientesCache = clientes;

    const activos   = clientes.filter(function(x) { return x.estado === 'ACTIVO'; }).length;
    const inactivos = clientes.length - activos;

    const filas = clientes.map(function(x) {
      return '<tr data-id="' + x.id_cliente + '">'
        + '<td>'
        + '<div style="font-weight:500">' + x.nombre_apellido + '</div>'
        + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + x.condicion_legal + '-' + x.identificacion + '</div>'
        + '</td>'
        + '<td style="font-size:12px"><span class="badge badge-gris">' + (CONDICION_LEGAL_LABEL[x.condicion_legal] || x.condicion_legal) + '</span></td>'
        + '<td style="font-size:12px">' + (x.telefono_movil || '—') + '</td>'
        + '<td style="font-size:12px">' + (x.correo_electronico || '—') + '</td>'
        + '<td><span class="badge ' + (x.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (x.estado || 'ACTIVO') + '</span></td>'
        + '<td><button class="btn-naranja" onclick="verFichaCliente(' + x.id_cliente + ')">Ver</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:12px">'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Total</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + clientes.length + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Activos</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + activos + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Inactivos</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + inactivos + '</div></div>'
      + '</div>'
      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Clientes</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<select id="cli-filtro-estado" onchange="filtrarTablaClientes()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + '<option value="ACTIVO">Activo</option>'
      + '<option value="INACTIVO">Inactivo</option>'
      + '</select>'
      + '<input type="text" id="cli-buscar" placeholder="Buscar nombre o identificación..." oninput="filtrarTablaClientes()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:220px">'
      + (puedo('CLIENTES','CREAR') ? '<button class="btn-primario" onclick="abrirCliente(null)">+ Nuevo Cliente</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" style="max-height:max(200px, calc(100vh - 355px))"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th>Nombre / Identificación</th><th>Condición Legal</th><th>Teléfono</th><th>Correo</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody id="cli-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay clientes registrados</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function filtrarTablaClientes() {
  const estado = document.getElementById('cli-filtro-estado')?.value || '';
  const buscar = (document.getElementById('cli-buscar')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('cli-tbody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(function(tr) {
    const cId = parseInt(tr.dataset.id);
    const x   = clientesCache.find(function(c) { return c.id_cliente === cId; });
    if (!x) { tr.style.display = 'none'; return; }
    const matchEstado = !estado || x.estado === estado;
    const matchBuscar = !buscar || x.nombre_apellido.toLowerCase().includes(buscar) || (x.identificacion||'').toLowerCase().includes(buscar);
    tr.style.display = matchEstado && matchBuscar ? '' : 'none';
  });
}

function verFichaCliente(id) {
  if (!sesionActual?.administrador && !puedo('CLIENTES','VER')) {
    alert('No tiene permiso para ver la ficha del cliente.'); return;
  }
  const x = clientesCache.find(function(c) { return c.id_cliente === id; });
  if (!x) return;

  document.getElementById('ficha-cliente-contenido').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nombre / Apellido</div><div style="font-weight:600;font-size:15px">' + x.nombre_apellido + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Condición Legal</div><div><span class="badge badge-gris">' + (CONDICION_LEGAL_LABEL[x.condicion_legal] || x.condicion_legal) + '</span></div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Identificación</div><div style="font-family:var(--font-mono)">' + x.condicion_legal + '-' + x.identificacion + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono Móvil</div><div>' + (x.telefono_movil||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Correo</div><div>' + (x.correo_electronico||'—') + '</div></div>'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div>' + (x.direccion||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Estado</div><div><span class="badge ' + (x.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (x.estado||'ACTIVO') + '</span></div></div>'
    + (x.observaciones ? '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Observaciones</div><div style="background:var(--gris2);border-radius:6px;padding:10px 14px;font-size:13px">' + x.observaciones + '</div></div>' : '')
    + '</div>';

  var btnEditar   = document.getElementById('ficha-cliente-btn-editar');
  var btnEliminar = document.getElementById('ficha-cliente-btn-eliminar');
  if (btnEditar)  { btnEditar._id = x.id_cliente;  btnEditar.onclick  = function() { cerrarModal('modal-ficha-cliente'); abrirCliente(this._id); }; btnEditar.style.display = puedo('CLIENTES','EDITAR') ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = x.id_cliente; btnEliminar._nombre = x.nombre_apellido; btnEliminar.onclick = function() { cerrarModal('modal-ficha-cliente'); eliminarCliente(this._id, this._nombre); }; btnEliminar.style.display = puedo('CLIENTES','ELIMINAR') ? '' : 'none'; }

  abrirModal('modal-ficha-cliente');
  focusFirstField('modal-ficha-cliente');
}

function abrirCliente(id) {
  if (id && !puedo('CLIENTES','EDITAR'))  { alert('No tiene permiso para editar clientes.'); return; }
  if (!id && !puedo('CLIENTES','CREAR'))  { alert('No tiene permiso para registrar clientes.'); return; }

  const x = id ? clientesCache.find(function(c) { return c.id_cliente === id; }) : null;

  document.getElementById('cli-modal-titulo').textContent    = x ? 'EDITAR CLIENTE' : 'NUEVO CLIENTE';
  document.getElementById('cli-id').value                    = x ? x.id_cliente : '';
  document.getElementById('cli-condicion-legal').value        = x ? (x.condicion_legal||'V') : 'V';
  document.getElementById('cli-identificacion').value         = x ? (x.identificacion||'') : '';
  document.getElementById('cli-nombre-apellido').value        = x ? (x.nombre_apellido||'') : '';
  document.getElementById('cli-telefono-movil').value         = x ? (x.telefono_movil||'') : '';
  document.getElementById('cli-correo-electronico').value     = x ? (x.correo_electronico||'') : '';
  document.getElementById('cli-direccion').value               = x ? (x.direccion||'') : '';
  document.getElementById('cli-estado').value                 = x ? (x.estado||'ACTIVO') : 'ACTIVO';
  document.getElementById('cli-observaciones').value           = x ? (x.observaciones||'') : '';
  document.getElementById('alerta-cli-ok').style.display     = 'none';
  document.getElementById('alerta-cli-err').style.display    = 'none';

  abrirModal('modal-cliente');
  focusFirstField('modal-cliente');
  setTimeout(function() { document.getElementById('cli-nombre-apellido')?.focus(); }, 100);
}

// ── Validación compartida (usada por el modal completo y por el rápido) ──
// Devuelve el objeto `datos` listo para guardar, o null si hay un error
// (en cuyo caso ya dejó el mensaje en el elemento de error indicado).
function _validarDatosCliente(prefijo, errEl, idExcluir) {
  const condicionLegal = document.getElementById(prefijo + '-condicion-legal').value;
  const identificacion = document.getElementById(prefijo + '-identificacion').value.trim();
  const nombreApellido = document.getElementById(prefijo + '-nombre-apellido').value.trim();

  if (!identificacion) { errEl.textContent = 'La identificación es obligatoria.'; errEl.style.display = 'block'; return null; }
  if (!/^\d{6,15}$/.test(identificacion)) { errEl.textContent = 'La identificación debe tener entre 6 y 15 dígitos.'; errEl.style.display = 'block'; return null; }
  if (!nombreApellido) { errEl.textContent = 'El nombre / apellido es obligatorio.'; errEl.style.display = 'block'; return null; }

  return {
    condicion_legal:     condicionLegal,
    identificacion:      identificacion,
    nombre_apellido:     nombreApellido,
    _idExcluir:          idExcluir || null
  };
}

async function _verificarDuplicadoCliente(condicionLegal, identificacion, idExcluir, errEl) {
  try {
    const existe = await api('clientes', 'GET', null,
      '?condicion_legal=eq.' + condicionLegal + '&identificacion=eq.' + identificacion
      + (idExcluir ? '&id_cliente=neq.' + idExcluir : ''));
    if (existe && existe.length > 0) {
      errEl.textContent = 'Ya existe un cliente registrado con ese documento (' + condicionLegal + '-' + identificacion + ').';
      errEl.style.display = 'block';
      return true;
    }
  } catch(e) {}
  return false;
}

async function guardarCliente() {
  const id     = document.getElementById('cli-id').value;
  const okEl   = document.getElementById('alerta-cli-ok');
  const errEl  = document.getElementById('alerta-cli-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const base = _validarDatosCliente('cli', errEl, id || null);
  if (!base) return;

  if (await _verificarDuplicadoCliente(base.condicion_legal, base.identificacion, id || null, errEl)) return;

  const datos = {
    condicion_legal:     base.condicion_legal,
    identificacion:      base.identificacion,
    nombre_apellido:     base.nombre_apellido,
    telefono_movil:      document.getElementById('cli-telefono-movil').value.trim() || null,
    correo_electronico:  document.getElementById('cli-correo-electronico').value.trim() || null,
    direccion:           document.getElementById('cli-direccion').value.trim() || null,
    estado:              document.getElementById('cli-estado').value || 'ACTIVO',
    observaciones:       document.getElementById('cli-observaciones').value.trim() || null,
    id_usuario:          sesionActual.correo_usuario
  };

  try {
    if (id) { await api('clientes','PATCH',datos,'?id_cliente=eq.'+id); okEl.textContent = '✓ Cliente actualizado correctamente.'; }
    else    { await api('clientes','POST',datos);                        okEl.textContent = '✓ Cliente registrado correctamente.'; }
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-cliente'); renderClientes(); }, 1200);
  } catch(err) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
}

async function eliminarCliente(id, nombre) {
  if (!puedo('CLIENTES','ELIMINAR')) { alert('No tiene permiso para eliminar clientes.'); return; }
  if (!confirm('¿Eliminar el cliente "' + nombre + '"?\\nEsta acción no se puede deshacer.')) return;
  try { await api('clientes','DELETE',null,'?id_cliente=eq.'+id); renderClientes(); }
  catch(err) { alert('Error: ' + err.message); }
}

// ═══════════════════════════════════════════════════════════════
// MODAL RÁPIDO -- pensado para invocarse desde otros módulos
// (ej. Ventas) sin que el operador tenga que salir del flujo.
//
// Uso desde otro módulo:
//   abrirClienteRapido(function(clienteCreado) {
//     // clienteCreado = { id_cliente, nombre_apellido, condicion_legal, identificacion, ... }
//     // aquí se actualiza el <select> de Ventas con el cliente recién creado
//   });
// ═══════════════════════════════════════════════════════════════
let _callbackClienteRapido = null;

function abrirClienteRapido(onCreado) {
  if (!puedo('CLIENTES','CREAR')) { alert('No tiene permiso para registrar clientes.'); return; }
  _callbackClienteRapido = typeof onCreado === 'function' ? onCreado : null;

  document.getElementById('clir-condicion-legal').value    = 'V';
  document.getElementById('clir-identificacion').value     = '';
  document.getElementById('clir-nombre-apellido').value    = '';
  document.getElementById('clir-telefono-movil').value     = '';
  document.getElementById('alerta-clir-ok').style.display  = 'none';
  document.getElementById('alerta-clir-err').style.display = 'none';

  abrirModal('modal-cliente-rapido');
  focusFirstField('modal-cliente-rapido');
  setTimeout(function() { document.getElementById('clir-nombre-apellido')?.focus(); }, 100);
}

async function guardarClienteRapido() {
  const okEl   = document.getElementById('alerta-clir-ok');
  const errEl  = document.getElementById('alerta-clir-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const base = _validarDatosCliente('clir', errEl, null);
  if (!base) return;

  if (await _verificarDuplicadoCliente(base.condicion_legal, base.identificacion, null, errEl)) return;

  const datos = {
    condicion_legal:     base.condicion_legal,
    identificacion:      base.identificacion,
    nombre_apellido:     base.nombre_apellido,
    telefono_movil:      document.getElementById('clir-telefono-movil').value.trim() || null,
    estado:              'ACTIVO',
    id_usuario:          sesionActual.correo_usuario
  };

  try {
    const creado = await api('clientes','POST',datos);
    okEl.textContent = '✓ Cliente registrado correctamente.';
    okEl.style.display = 'block';
    const clienteNuevo = Array.isArray(creado) ? creado[0] : creado;
    if (clienteNuevo && clienteNuevo.id_cliente) {
      clientesCache = clientesCache || [];
      clientesCache.push(clienteNuevo);
    }
    setTimeout(function() {
      cerrarModal('modal-cliente-rapido');
      if (_callbackClienteRapido) { _callbackClienteRapido(clienteNuevo); _callbackClienteRapido = null; }
    }, 800);
  } catch(err) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
}
