// ─── S&D Systems — Módulo: EMPRESAS ───
// ══════════════════════════════════════════════════════════════
//  MÓDULO DATOS DE EMPRESAS (EMISORES)
// ══════════════════════════════════════════════════════════════
let emisoresCache = [];

async function renderEmisores() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('EMISORES')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {
    const emisores = await api('emisores', 'GET', null, '?order=nombre.asc&select=*'+emisorQ());
    emisoresCache = emisores;
    const tipoLabel = { 'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal' };
    const tipoColor = { 'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris' };
    const filas = emisores.map(function(e) {
      return '<tr>'
        + '<td><div style="font-weight:600">' + e.nombre + '</div><div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (e.rif||'—') + '</div></td>'
        + '<td><span class="badge ' + (tipoColor[e.tipo_contribuyente]||'badge-gris') + '">' + (tipoLabel[e.tipo_contribuyente]||'—') + '</span></td>'
        + '<td style="font-size:12px">' + (e.telefono||'—') + '</td>'
        + '<td style="font-size:12px">' + (e.correo||'—') + '</td>'
        + '<td><span class="badge ' + (e.estado==='ACTIVO'?'badge-verde':'badge-rojo') + '">' + (e.estado||'ACTIVO') + '</span></td>'
        + '<td><button class="btn-secundario" onclick="verFichaEmisor(' + e.id_empresa + ')">Ver</button></td>'
        + '</tr>';
    }).join('');
    c.innerHTML = '<div class="panel">'
      + '<div class="panel-header"><h3>Datos de Empresas (' + emisores.length + ')</h3>'
      + (puedo('EMISORES','CREAR') ? '<button class="btn-primario" onclick="abrirEmisor(null)">+ Nueva Empresa</button>' : '')
      + '</div><div class="tabla-container"><table><thead><tr>'
      + '<th>Nombre / RIF</th><th>Tipo Contribuyente</th><th>Teléfono</th><th>Correo</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody>'
      + (filas || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--suave)">No hay empresas registradas</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

async function verFichaEmisor(id) {
  const e = emisoresCache.find(function(x) { return x.id_empresa === id; });
  if (!e) return;
  const tipoLabel = { 'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal' };
  document.getElementById('ficha-emisor-contenido').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nombre</div><div style="font-weight:600">' + e.nombre + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">RIF</div><div style="font-family:var(--font-mono)">' + (e.rif||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Contribuyente</div><div>' + (tipoLabel[e.tipo_contribuyente]||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Estado</div><span class="badge ' + (e.estado==='ACTIVO'?'badge-verde':'badge-rojo') + '">' + (e.estado||'ACTIVO') + '</span></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono</div><div>' + (e.telefono||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Correo</div><div>' + (e.correo||'—') + '</div></div>'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div>' + (e.direccion||'—') + '</div></div>'
    + '</div>';
  var btnEditar   = document.getElementById('ficha-emisor-btn-editar');
  window._fichaEmisorId     = e.id_empresa;
  window._fichaEmisorNombre = e.nombre;
  var btnEliminar = document.getElementById('ficha-emisor-btn-eliminar');
  if (btnEditar)  { btnEditar._id = e.id_empresa; btnEditar.onclick = function() { cerrarModal('modal-ficha-emisor'); abrirEmisor(this._id); }; btnEditar.style.display = puedo('EMISORES','EDITAR') ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = e.id_empresa; btnEliminar._nombre = e.nombre; btnEliminar.onclick = function() { cerrarModal('modal-ficha-emisor'); eliminarEmisor(this._id, this._nombre); }; btnEliminar.style.display = puedo('EMISORES','ELIMINAR') ? '' : 'none'; }
  abrirModal('modal-ficha-emisor');
  focusFirstField('modal-ficha-emisor');
}

async function abrirEmisor(id) {
  if (id && !puedo('EMISORES','EDITAR'))  { alert('No tiene permiso para editar empresas.'); return; }
  if (!id && !puedo('EMISORES','CREAR'))  { alert('No tiene permiso para registrar empresas.'); return; }
  const e = id ? emisoresCache.find(function(x) { return x.id_empresa === id; }) : null;
  document.getElementById('modal-emisor-titulo').textContent  = e ? 'EDITAR EMPRESA' : 'NUEVA EMPRESA';
  document.getElementById('em-id').value                     = e ? e.id_empresa : '';
  document.getElementById('em-nombre').value                 = e ? (e.nombre||'') : '';
  document.getElementById('em-rif').value                    = e ? (e.rif||'') : '';
  document.getElementById('em-telefono').value               = e ? (e.telefono||'') : '';
  document.getElementById('em-correo').value                 = e ? (e.correo||'') : '';
  document.getElementById('em-direccion').value              = e ? (e.direccion||'') : '';
  document.getElementById('em-tipo-contribuyente').value     = e ? (e.tipo_contribuyente||'') : '';
  document.getElementById('em-moneda1').value                = e ? (e.moneda_principal||'VES') : 'VES';
  document.getElementById('em-moneda2').value                = e ? (e.moneda_secundaria||'USD') : 'USD';
  document.getElementById('em-estado').value                 = e ? (e.estado||'ACTIVO') : 'ACTIVO';
  document.getElementById('alerta-emisor-ok').style.display  = 'none';
  document.getElementById('alerta-emisor-err').style.display = 'none';
  const btnElimEm = document.getElementById('emisor-btn-eliminar');
  if (btnElimEm) btnElimEm.style.display = document.getElementById('em-id').value ? '' : 'none';
  abrirModal('modal-emisor');
  focusFirstField('modal-emisor');
}

async function eliminarEmisorFicha() {
  const id = window._fichaEmisorId;
  if (!id) return;
  const nombre = window._fichaEmisorNombre || 'esta empresa';
  try {
    const [asientos, facturas, ordenes] = await Promise.all([
      api('cont_asientos',    'GET', null, '?id_empresa=eq.'+id+'&select=id_asiento&limit=1'),
      api('facturas',         'GET', null, '?id_empresa=eq.'+id+'&select=id_factura&limit=1'),
      api('ordenes_servicio', 'GET', null, '?id_empresa=eq.'+id+'&select=id_orden&limit=1'),
    ]);
    const motivos = [];
    if (asientos.length > 0) motivos.push('asientos contables');
    if (facturas.length > 0)  motivos.push('facturas');
    if (false)     motivos.push('pagos');
    if (ordenes.length > 0)   motivos.push('órdenes de servicio');
    if (motivos.length > 0) {
      alert('No se puede eliminar "' + nombre + '" porque tiene ' + motivos.join(', ') + ' registrados.');
      return;
    }
  } catch(e) {}
  if (!confirm('¿Eliminar la empresa "' + nombre + '"? Esta acción no se puede deshacer.')) return;
  try {
    await api('emisores', 'DELETE', null, '?id_empresa=eq.' + id);
    emisoresCache = [];
    cerrarModal('modal-ficha-emisor');
    await renderEmisores();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function eliminarEmisor() {
  const id = document.getElementById('em-id').value;
  if (!id) return;
  const nombre = document.getElementById('em-nombre')?.value || 'esta empresa';

  // Verificar registros asociados antes de preguntar
  try {
    const [asientos, facturas, ordenes] = await Promise.all([
      api('cont_asientos',    'GET', null, '?id_empresa=eq.'+id+'&select=id_asiento&limit=1'),
      api('facturas',         'GET', null, '?id_empresa=eq.'+id+'&select=id_factura&limit=1'),
      api('ordenes_servicio', 'GET', null, '?id_empresa=eq.'+id+'&select=id_orden&limit=1'),
    ]);
    const motivos = [];
    if (asientos.length > 0) motivos.push('asientos contables');
    if (facturas.length > 0) motivos.push('facturas');
    if (false)    motivos.push('pagos');
    if (ordenes.length > 0)  motivos.push('órdenes de servicio');
    if (motivos.length > 0) {
      alert('No se puede eliminar "' + nombre + '" porque tiene ' + motivos.join(', ') + ' registrados.');
      return;
    }
  } catch(e) {}

  if (!confirm('¿Eliminar la empresa "' + nombre + '"? Esta acción no se puede deshacer.')) return;
  try {
    await api('emisores', 'DELETE', null, '?id_empresa=eq.' + id);
    cerrarModal('modal-emisor');
    renderEmisores();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function guardarEmisor() {
  const id     = document.getElementById('em-id').value;
  const nombre = document.getElementById('em-nombre').value.trim();
  const rif    = document.getElementById('em-rif').value.trim().toUpperCase();
  const okEl   = document.getElementById('alerta-emisor-ok');
  const errEl  = document.getElementById('alerta-emisor-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }
  if (!rif)    { errEl.textContent = 'El RIF es obligatorio.';    errEl.style.display = 'block'; return; }
  const datos = {
    nombre, rif,
    telefono: document.getElementById('em-telefono').value.trim() || null,
    correo:   document.getElementById('em-correo').value.trim()   || null,
    direccion:document.getElementById('em-direccion').value.trim()|| null,
    tipo_contribuyente: document.getElementById('em-tipo-contribuyente').value || null,
    moneda_principal:   document.getElementById('em-moneda1').value,
    moneda_secundaria:  document.getElementById('em-moneda2').value,
    estado:             document.getElementById('em-estado').value,
    id_usuario:         sesionActual.correo_usuario
  };
  try {
    if (id) { await api('emisores','PATCH',datos,'?id_empresa=eq.'+id); okEl.textContent='✓ Empresa actualizada correctamente.'; }
    else    { await api('emisores','POST',datos);                       okEl.textContent='✓ Empresa registrada correctamente.'; }
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-emisor'); renderEmisores(); }, 1200);
  } catch(err) { errEl.textContent='Error: '+err.message; errEl.style.display='block'; }
}

async function eliminarEmisor(id, nombre) {
  if (!puedo('EMISORES','ELIMINAR')) { alert('No tiene permiso para eliminar empresas.'); return; }
  if (!confirm('¿Eliminar la empresa "' + nombre + '"?')) return;
  try { await api('emisores','DELETE',null,'?id_empresa=eq.'+id); renderEmisores(); }
  catch(err) { alert('Error: '+err.message); }
}


