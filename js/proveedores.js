// ─── S&D Systems — Módulo: PROVEEDORES ───
// Extraido de inventario.js el 2026-08-03
let _provBancosCache = null; // cache propia de bancos, independiente de _empParamCache (Empleados)

async function renderProveedores() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('PROVEEDORES')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando proveedores...</div>';
  try {
    const proveedores = await api('proveedores', 'GET', null, '?order=nombre.asc&select=*&id_empresa=eq.'+(_empresaActiva?.id_empresa||0)+'');
    proveedoresCache = proveedores;

    const activos   = proveedores.filter(function(p) { return p.estado === 'ACTIVO'; }).length;
    const inactivos = proveedores.length - activos;

    const tipoLabel = { 'ORDINARIO':'Ord.','ESPECIAL':'Esp.','FORMAL':'Form.' };
    const tipoColor = { 'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris' };

    const filas = proveedores.map(function(p) {
      return '<tr data-id="' + p.id_proveedor + '">'
        + '<td>'
        + '<div style="font-weight:500">' + p.nombre + '</div>'
        + '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (p.rif||'—') + '</div>'
        + (p.tipo_contribuyente ? '<span class="badge ' + (tipoColor[p.tipo_contribuyente]||'badge-gris') + '" style="font-size:9px;margin-top:3px;display:inline-block">' + (tipoLabel[p.tipo_contribuyente]||p.tipo_contribuyente) + '</span>' : '')
        + '</td>'
        + '<td style="font-size:12px">'
        + '<span class="badge ' + (p.tipo_proveedor === 'NACIONAL' ? 'badge-naranja' : 'badge-gris') + '" style="font-size:10px">' + (p.tipo_proveedor||'NACIONAL') + '</span>'
        + '</td>'
        + '<td style="font-size:12px">' + (p.telefono||'—') + '</td>'
        + '<td style="font-size:12px">' + (p.correo||'—') + '</td>'
        + '<td style="font-size:12px;font-family:var(--font-mono)">'
        + (p.moneda_facturacion||'USD')
        + (p.dias_credito ? '<div style="font-size:10px;color:var(--suave)">' + p.dias_credito + ' días crédito</div>' : '')
        + '</td>'
        + '<td><span class="badge ' + (p.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (p.estado||'ACTIVO') + '</span></td>'
        + '<td><button class="btn-naranja" onclick="verFichaProveedor(' + p.id_proveedor + ')">Ver</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:12px">'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Total</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + proveedores.length + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Activos</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + activos + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:7px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Inactivos</div><div style="font-family:var(--font-display);font-size:18px;color:var(--naranja)">' + inactivos + '</div></div>'
      + '</div>'
      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Proveedores</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<select id="prov-filtro-estado" onchange="filtrarTablaProveedores()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estados</option>'
      + '<option value="ACTIVO">Activo</option>'
      + '<option value="INACTIVO">Inactivo</option>'
      + '</select>'
      + '<input type="text" id="prov-buscar" placeholder="Buscar nombre o RIF..." oninput="filtrarTablaProveedores()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + (puedo('PROVEEDORES','CREAR') ? '<button class="btn-primario" onclick="abrirProveedor(null)">+ Nuevo Proveedor</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" style="max-height:calc(100vh - 355px)"><table style="table-layout:fixed;width:100%"><thead><tr>'
      + '<th>Nombre / RIF</th><th>Tipo</th><th>Teléfono</th><th>Correo</th><th>Moneda / Crédito</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead><tbody id="prov-tbody">'
      + (filas || '<tr><td colspan="7" style="text-align:center;color:var(--suave);padding:32px">No hay proveedores registrados</td></tr>')
      + '</tbody></table></div></div>';
  } catch(err) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function filtrarTablaProveedores() {
  const estado = document.getElementById('prov-filtro-estado')?.value || '';
  const buscar = (document.getElementById('prov-buscar')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('prov-tbody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(function(tr) {
    const pId = parseInt(tr.dataset.id);
    const p   = proveedoresCache.find(function(x) { return x.id_proveedor === pId; });
    if (!p) { tr.style.display = 'none'; return; }
    const matchEstado = !estado || p.estado === estado;
    const matchBuscar = !buscar || p.nombre.toLowerCase().includes(buscar) || (p.rif||'').toLowerCase().includes(buscar);
    tr.style.display = matchEstado && matchBuscar ? '' : 'none';
  });
}

async function verFichaProveedor(id) {
  if (!sesionActual?.administrador && !puedo('PROVEEDORES','VER')) {
    alert('No tiene permiso para ver la ficha del proveedor.'); return;
  }
  const p = proveedoresCache.find(function(x) { return x.id_proveedor === id; });
  if (!p) return;

  // Asegurar bancos en cache para mostrar nombres
  if (!_provBancosCache || !_provBancosCache.length) {
    try {
      const bancos = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
      _provBancosCache = bancos || [];
    } catch(e) { _provBancosCache = []; }
  }

  const tipoLabel = { 'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal' };
  const tipoColor = { 'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris' };

  // Buscar nombre de categoría
  let catNombre = '—';
  if (p.id_categoria) {
    try {
      const cats = await api('param_categorias_proveedor','GET',null,'?id=eq.'+p.id_categoria+'&select=nombre&limit=1');
      if (cats && cats[0]) catNombre = cats[0].nombre;
    } catch(e) {}
  }

  const metodosLabel = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', AFILIACION_BANCARIA: 'Afiliación Bancaria' };
  const metodosProv = Array.isArray(p.metodos_pago_tipos) ? p.metodos_pago_tipos : [];
  const aceptaTransferenciaActual = metodosProv.includes('TRANSFERENCIA');

  document.getElementById('ficha-prov-contenido').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nombre</div><div style="font-weight:600;font-size:15px">' + p.nombre + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">RIF</div><div style="font-family:var(--font-mono)">' + (p.rif||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Contribuyente</div><div>' + (p.tipo_contribuyente ? '<span class="badge ' + (tipoColor[p.tipo_contribuyente]||'badge-gris') + '">' + (tipoLabel[p.tipo_contribuyente]||p.tipo_contribuyente) + '</span>' : '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Proveedor</div><div><span class="badge ' + (p.tipo_proveedor === 'NACIONAL' ? 'badge-naranja' : 'badge-gris') + '">' + (p.tipo_proveedor||'NACIONAL') + '</span></div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Categoría</div><div>' + catNombre + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono</div><div>' + (p.telefono||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Correo</div><div>' + (p.correo||'—') + '</div></div>'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div>' + (p.direccion||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Moneda Facturación</div><div style="font-family:var(--font-mono)">' + (p.moneda_facturacion||'USD') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Días de Crédito</div><div>' + (p.dias_credito||0) + ' días</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Límite de Crédito</div><div style="font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(p.limite_credito||0) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Estado</div><div><span class="badge ' + (p.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (p.estado||'ACTIVO') + '</span></div></div>'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">💳 Método de Pago</div><div>'
      + (metodosProv.length ? metodosProv.map(function(m){ return '<span class="badge badge-naranja" style="margin-right:6px">' + (metodosLabel[m]||m) + '</span>'; }).join('') : '<span style="color:var(--suave)">— Sin métodos marcados —</span>')
      + '</div></div>'
    + (p.observaciones ? '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Observaciones</div><div style="background:var(--gris2);border-radius:6px;padding:10px 14px;font-size:13px">' + p.observaciones + '</div></div>' : '')
    // ── Datos Bancarios (solo si "Transferencia" sigue marcado actualmente) ──
    + (aceptaTransferenciaActual && (p.id_banco || p.numero_cuenta) ? '<div style="grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid var(--borde)"><div style="font-size:10px;color:var(--naranja);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;font-weight:600">🏦 Datos Bancarios</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Institución Financiera</div><div>' + ((_provBancosCache||[]).find(function(b){return b.id===p.id_banco;})?.nombre || '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo de Cuenta</div><div>' + (p.tipo_cuenta||'—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Número de Cuenta</div><div style="font-family:var(--font-mono)">' + (p.numero_cuenta||'—') + '</div></div>'
      + '</div></div>' : '')
    // ── Pago Móvil (solo si "Transferencia" sigue marcado actualmente) ──
    + (aceptaTransferenciaActual && (p.pm_id_banco || p.pm_celular) ? '<div style="grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid var(--borde)"><div style="font-size:10px;color:var(--naranja);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;font-weight:600">📱 Pago Móvil</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Banco</div><div>' + ((_provBancosCache||[]).find(function(b){return b.id===p.pm_id_banco;})?.nombre || '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">C.I. / R.I.F</div><div style="font-family:var(--font-mono)">' + (p.pm_ci||'—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">N° Celular</div><div style="font-family:var(--font-mono)">' + (p.pm_celular||'—') + '</div></div>'
      + '</div></div>' : '')
    + '</div>';

  var btnEditar   = document.getElementById('ficha-prov-btn-editar');
  var btnEliminar = document.getElementById('ficha-prov-btn-eliminar');
  if (btnEditar)  { btnEditar._id = p.id_proveedor;  btnEditar.onclick  = function() { cerrarModal('modal-ficha-prov'); abrirProveedor(this._id); }; btnEditar.style.display = puedo('PROVEEDORES','EDITAR') ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = p.id_proveedor; btnEliminar._nombre = p.nombre; btnEliminar.onclick = function() { cerrarModal('modal-ficha-prov'); eliminarProveedor(this._id, this._nombre); }; btnEliminar.style.display = puedo('PROVEEDORES','ELIMINAR') ? '' : 'none'; }

  abrirModal('modal-ficha-prov');
  focusFirstField('modal-ficha-prov');
}

function onSelBancoProveedor() {
  var sel     = document.getElementById('prov-banco');
  var codEl   = document.getElementById('prov-cod-banco');
  var restoEl = document.getElementById('prov-num-cuenta-resto');
  if (!sel || !codEl) return;
  var id_banco = parseInt(sel.value);
  var banco   = (_provBancosCache || []).find(function(b){ return b.id === id_banco; });
  var codigo  = banco && banco.codigo ? banco.codigo.replace(/\D/g,'').substring(0,4) : '';
  codEl.value = codigo;
  if (restoEl) { restoEl.value = ''; restoEl.focus(); }
  sincronizarNumCuentaProv();
}

function sincronizarNumCuentaProv() {
  var codEl   = document.getElementById('prov-cod-banco');
  var restoEl = document.getElementById('prov-num-cuenta-resto');
  var hidEl   = document.getElementById('prov-num-cuenta');
  if (!hidEl) return;
  hidEl.value = (codEl?.value || '') + (restoEl?.value || '');
}

function cargarBancosProveedor(id_bancoSel, id_bancoPMSel) {
  var bancos = _provBancosCache || [];
  var opts = '<option value="">— Seleccionar —</option>'
    + bancos.map(function(b){
        return '<option value="'+b.id+'"'+(b.id===id_bancoSel?' selected':'')+'>'+b.nombre+'</option>';
      }).join('');
  var el = document.getElementById('prov-banco');
  if (el) { el.innerHTML = opts; if (id_bancoSel) onSelBancoProveedor(); }
  var opts2 = '<option value="">— Seleccionar —</option>'
    + bancos.map(function(b){
        return '<option value="'+b.id+'"'+(b.id===id_bancoPMSel?' selected':'')+'>'+b.nombre+'</option>';
      }).join('');
  var el2 = document.getElementById('prov-pm-banco');
  if (el2) el2.innerHTML = opts2;
}

function onCambioMetodoPagoAceptadoProv() {
  const aceptaTransferencia = document.querySelector('.prov-metodo-pago-chk[value="TRANSFERENCIA"]')?.checked;
  const bancoCont = document.getElementById('prov-datos-bancarios-cont');
  const pmCont    = document.getElementById('prov-pago-movil-cont');
  if (bancoCont) bancoCont.style.display = aceptaTransferencia ? '' : 'none';
  if (pmCont)    pmCont.style.display    = aceptaTransferencia ? '' : 'none';
}

async function abrirProveedor(id) {
  if (id && !puedo('PROVEEDORES','EDITAR'))  { alert('No tiene permiso para editar proveedores.'); return; }
  if (!id && !puedo('PROVEEDORES','CREAR'))  { alert('No tiene permiso para registrar proveedores.'); return; }

  const p = id ? proveedoresCache.find(function(x) { return x.id_proveedor === id; }) : null;

  document.getElementById('prov-modal-titulo').textContent   = p ? 'EDITAR PROVEEDOR' : 'NUEVO PROVEEDOR';
  document.getElementById('prov-id').value                   = p ? p.id_proveedor : '';
  document.getElementById('prov-nombre').value               = p ? (p.nombre||'') : '';
  document.getElementById('prov-rif').value                  = p ? (p.rif||'') : '';
  document.getElementById('prov-tipo-contrib').value         = p ? (p.tipo_contribuyente||'') : '';
  document.getElementById('prov-tipo').value                 = p ? (p.tipo_proveedor||'NACIONAL') : 'NACIONAL';
  document.getElementById('prov-telefono').value             = p ? (p.telefono||'') : '';
  document.getElementById('prov-correo').value               = p ? (p.correo||'') : '';
  document.getElementById('prov-direccion').value            = p ? (p.direccion||'') : '';
  document.getElementById('prov-moneda').value               = p ? (p.moneda_facturacion||'USD') : 'USD';
  document.getElementById('prov-dias-credito').value         = p ? (p.dias_credito||0) : 0;
  document.getElementById('prov-limite-credito').value       = p ? (p.limite_credito||0) : 0;
  document.getElementById('prov-estado').value               = p ? (p.estado||'ACTIVO') : 'ACTIVO';
  document.getElementById('prov-observaciones').value        = p ? (p.observaciones||'') : '';
  document.getElementById('alerta-prov-ok').style.display    = 'none';
  document.getElementById('alerta-prov-err').style.display   = 'none';

  // Cargar bancos si no están en cache
  if (!_provBancosCache || !_provBancosCache.length) {
    try {
      const bancos = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
      _provBancosCache = bancos || [];
    } catch(e) { _provBancosCache = []; }
  }
  cargarBancosProveedor(p ? (p.id_banco||null) : null, p ? (p.pm_id_banco||null) : null);
  // Cargar categorías de proveedor
  try {
    const cats = await api('param_categorias_proveedor','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
    const selCat = document.getElementById('prov-categoria');
    if (selCat) {
      selCat.innerHTML = '<option value="">— Seleccionar —</option>'
        + (cats||[]).map(function(c){
            return '<option value="'+c.id+'"'+(c.id===(p?.id_categoria)?' selected':'')+'>'+c.nombre+'</option>';
          }).join('');
    }
  } catch(e) {}
  // Tipo y número de cuenta
  document.getElementById('prov-tipo-cuenta').value         = p ? (p.tipo_cuenta||'') : '';
  const numCuenta = p ? (p.numero_cuenta||'') : '';
  document.getElementById('prov-cod-banco').value           = numCuenta.substring(0,4);
  document.getElementById('prov-num-cuenta-resto').value    = numCuenta.substring(4);
  document.getElementById('prov-num-cuenta').value          = numCuenta;
  // Pago móvil
  document.getElementById('prov-pm-ci').value               = p ? (p.pm_ci||'') : '';
  document.getElementById('prov-pm-celular').value          = p ? (p.pm_celular||'') : '';

  // Método de Pago -- selección única (radio), no múltiple.
  const tiposAceptados = (p && Array.isArray(p.metodos_pago_tipos)) ? p.metodos_pago_tipos : [];
  const metodoActual = tiposAceptados[0] || '';
  document.querySelectorAll('.prov-metodo-pago-chk').forEach(function(chk) {
    chk.checked = (chk.value === metodoActual);
  });
  onCambioMetodoPagoAceptadoProv();

  abrirModal('modal-proveedor');
  focusFirstField('modal-proveedor');
  setTimeout(function() { document.getElementById('prov-nombre')?.focus(); }, 100);
}

async function guardarProveedor() {
  const id     = document.getElementById('prov-id').value;
  const nombre = document.getElementById('prov-nombre').value.trim();
  const okEl   = document.getElementById('alerta-prov-ok');
  const errEl  = document.getElementById('alerta-prov-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }

  // ── Validar datos bancarios (solo si se seleccionó banco) ──
  const id_bancoVal    = document.getElementById('prov-banco')?.value;
  const tipoCuentaVal = document.getElementById('prov-tipo-cuenta')?.value;
  const numCuentaVal  = document.getElementById('prov-num-cuenta')?.value || '';
  if (id_bancoVal) {
    if (!tipoCuentaVal) {
      errEl.textContent = 'Seleccione el Tipo de Cuenta.';
      errEl.style.display = 'block'; return;
    }
    const digitos = numCuentaVal.replace(/\D/g,'');
    if (digitos.length !== 20) {
      errEl.textContent = 'El Número de Cuenta debe tener 20 dígitos completos (código banco + 16 dígitos).';
      errEl.style.display = 'block';
      document.getElementById('prov-num-cuenta-resto')?.focus();
      return;
    }
  }

  // ── Validar Pago Móvil (solo si se seleccionó banco PM) ──
  const id_bancoPMVal = document.getElementById('prov-pm-banco')?.value;
  const pmCiVal      = (document.getElementById('prov-pm-ci')?.value || '').trim().toUpperCase();
  const pmCelVal     = (document.getElementById('prov-pm-celular')?.value || '').replace(/\D/g,'');
  if (id_bancoPMVal) {
    if (!/^[JGVEPCE]\d{8}$/.test(pmCiVal.replace(/[-]/g,''))) {
      errEl.textContent = 'C.I./R.I.F debe comenzar con J, G, V, E, P o C seguido de 8 dígitos (ej: J12345678).';
      errEl.style.display = 'block';
      document.getElementById('prov-pm-ci')?.focus();
      return;
    }
    if (pmCelVal.length !== 11) {
      errEl.textContent = 'El N° Celular debe tener 11 dígitos (ej: 04141234567).';
      errEl.style.display = 'block';
      document.getElementById('prov-pm-celular')?.focus();
      return;
    }
  }

  // ── Validar Método de Pago (selección única) ──
  const metodosMarcados = Array.from(document.querySelectorAll('.prov-metodo-pago-chk:checked')).map(function(el){ return el.value; });
  if (!metodosMarcados.length) {
    errEl.textContent = 'Debe seleccionar un Método de Pago.';
    errEl.style.display = 'block';
    return;
  }
  if (metodosMarcados.includes('TRANSFERENCIA') && !document.getElementById('prov-banco')?.value && !document.getElementById('prov-pm-banco')?.value) {
    errEl.textContent = 'Seleccionó "Transferencia" -- complete al menos una vía (Datos Bancarios o Pago Móvil).';
    errEl.style.display = 'block';
    return;
  }

  // Validar duplicado por nombre
  try {
    const existe = await api('proveedores', 'GET', null, '?nombre=ilike.' + encodeURIComponent(nombre) + (id ? '&id_proveedor=neq.' + id : ''));
    if (existe && existe.length > 0) { errEl.textContent = 'Ya existe un proveedor con ese nombre.'; errEl.style.display = 'block'; return; }
  } catch(e) {}

  const datos = {
    nombre,
    rif:                document.getElementById('prov-rif').value.trim().toUpperCase() || null,
    tipo_contribuyente: document.getElementById('prov-tipo-contrib').value || null,
    tipo_proveedor:     document.getElementById('prov-tipo').value || 'NACIONAL',
    telefono:           document.getElementById('prov-telefono').value.trim() || null,
    correo:             document.getElementById('prov-correo').value.trim() || null,
    direccion:          document.getElementById('prov-direccion').value.trim() || null,
    moneda_facturacion: document.getElementById('prov-moneda').value || 'USD',
    dias_credito:       parseInt(document.getElementById('prov-dias-credito').value) || 0,
    limite_credito:     parseFloat(document.getElementById('prov-limite-credito').value) || 0,
    estado:             document.getElementById('prov-estado').value || 'ACTIVO',
    observaciones:      document.getElementById('prov-observaciones').value.trim() || null,
    // Datos bancarios
    id_banco:           parseInt(document.getElementById('prov-banco')?.value) || null,
    tipo_cuenta:        document.getElementById('prov-tipo-cuenta')?.value || null,
    numero_cuenta:      document.getElementById('prov-num-cuenta')?.value || null,
    // Pago móvil
    pm_id_banco:        parseInt(document.getElementById('prov-pm-banco')?.value) || null,
    pm_ci:              document.getElementById('prov-pm-ci')?.value.trim().toUpperCase() || null,
    pm_celular:         document.getElementById('prov-pm-celular')?.value.trim() || null,
    metodos_pago_tipos: Array.from(document.querySelectorAll('.prov-metodo-pago-chk:checked')).map(function(el){ return el.value; }),
    id_categoria:       parseInt(document.getElementById('prov-categoria')?.value) || null,
    id_usuario:         sesionActual.correo_usuario,
    id_empresa:          _empresaActiva?.id_empresa || null
  };

  try {
    if (id) { await api('proveedores','PATCH',datos,'?id_proveedor=eq.'+id); okEl.textContent = '✓ Proveedor actualizado correctamente.'; }
    else    { await api('proveedores','POST',datos);                          okEl.textContent = '✓ Proveedor registrado correctamente.'; }
    okEl.style.display = 'block';
    setTimeout(function() { cerrarModal('modal-proveedor'); renderProveedores(); }, 1200);
  } catch(err) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
}

async function eliminarProveedor(id, nombre) {
  if (!puedo('PROVEEDORES','ELIMINAR')) { alert('No tiene permiso para eliminar proveedores.'); return; }
  if (!confirm('¿Eliminar el proveedor "' + nombre + '"?\\nEsta acción no se puede deshacer.')) return;
  try { await api('proveedores','DELETE',null,'?id_proveedor=eq.'+id); renderProveedores(); }
  catch(err) { alert('Error: ' + err.message); }
}
