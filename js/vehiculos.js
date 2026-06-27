// ─── S&D Systems — Módulo: VEHICULOS ───
// ═══════════════════════════════════════════════════════
// FASE 2 — VEHÍCULOS Y PROPIETARIOS
// ═══════════════════════════════════════════════════════

const SUPABASE_STORAGE_URL = SUPABASE_URL + '/storage/v1/object/public/sd-systems-fotos/';
const CEDULA_APP_ID = '2130';
const CEDULA_TOKEN  = '32a4b5d127585d1479df5576453d6333';
const SUPABASE_UPLOAD_URL  = SUPABASE_URL + '/storage/v1/object/sd-systems-fotos/';


// ── Consultar cédula en cedula.com.ve ──
async function consultarCedula(tipDoc, numDoc) {
  const infoEl = document.getElementById('prop-cedula-info');
  if (!infoEl) return;

  if (!numDoc || numDoc.length < 5 || (tipDoc !== 'V' && tipDoc !== 'E')) {
    infoEl.style.display = 'none';
    return;
  }

  // Rellenar con ceros a la izquierda hasta 8 dígitos (requerido por la API)
  const numDocPadded = numDoc.replace(/\D/g, '').padStart(8, '0');

  infoEl.innerHTML = '<div style="color:var(--suave);font-size:12px">🔍 Consultando...</div>';
  infoEl.style.display = 'block';

  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/consultar_cedula', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_tipo: tipDoc, p_cedula: numDocPadded })
    });
    const data = await resp.json();

    if (data && data.error === false && data.data) {
      const d      = data.data;
      const nombre = [d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido]
        .filter(function(x) { return x && x.trim(); })
        .join(' ').trim();
      const rif    = d.rif || null;
      const estado = d.cne ? d.cne.estado : null;
      const municipio = d.cne ? d.cne.municipio : null;

      // Auto-llenar campos del formulario (siempre reemplaza con los datos encontrados)
      const campoNombre = document.getElementById('prop-nombre');
      if (campoNombre && nombre) {
        campoNombre.value = capitalizarNombre(nombre);
      }
      const campoRif = document.getElementById('prop-rif-civil');
      if (campoRif && rif) {
        campoRif.value = tipDoc + '-' + rif;
      }

      infoEl.innerHTML =
        '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.25);border-radius:6px;padding:10px 14px">'
        + '<div style="font-size:10px;color:var(--naranja);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">📋 Datos encontrados en el registro civil</div>'
        + '<div style="font-size:13px;font-weight:500;color:var(--texto);margin-bottom:3px">' + capitalizarNombre(nombre) + '</div>'
        + (rif ? '<div style="font-size:11px;color:var(--suave);margin-bottom:2px">RIF: ' + tipDoc + '-' + rif + '</div>' : '')
        + (estado ? '<div style="font-size:11px;color:var(--suave)">📍 ' + estado + (municipio ? ' · ' + municipio : '') + '</div>' : '')
        + '<div style="font-size:10px;color:#555;margin-top:6px">ℹ️ Datos autocompletados. Verifique y complete manualmente.</div>'
        + '</div>';
    } else {
      infoEl.innerHTML =
        '<div style="background:rgba(100,100,100,0.08);border:1px solid var(--borde);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--suave)">'
        + '⚠️ No se encontraron datos para esta cédula en el registro civil.'
        + '</div>';
    }
  } catch(e) {
    infoEl.innerHTML =
      '<div style="background:rgba(100,100,100,0.08);border:1px solid var(--borde);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--suave)">'
      + '⚠️ No se pudo conectar al servicio de consulta.'
      + '</div>';
  }
}

// ── Subir archivo a Supabase Storage ──
async function subirFoto(archivo, carpeta) {
  const ext      = archivo.name.split('.').pop();
  const nombre   = carpeta + '/' + Date.now() + '_' + Math.random().toString(36).substring(2) + '.' + ext;
  const resp     = await fetch(SUPABASE_UPLOAD_URL + nombre, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (_sessionJWT || SUPABASE_KEY),
      'Content-Type':  archivo.type,
      'x-upsert':      'true'
    },
    body: archivo
  });
  if (!resp.ok) throw new Error('Error subiendo foto');
  return SUPABASE_STORAGE_URL + nombre;
}

// ══════════════════════════════
// MÓDULO PROPIETARIOS
// ══════════════════════════════

// ─── CAPITALIZAR NOMBRE ───
function capitalizarNombre(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s|-)([a-záéíóúüñ])/gi, function(m, c) {
    return m.replace(c, c.toUpperCase());
  });
}


let propietariosCache = [];

async function renderPropietarios() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('PROPIETARIOS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando propietarios...</div>';
  await cargarPropietarios();
}

async function cargarPropietarios(filtro) {
  const c = document.getElementById('contenido-principal');

  const panelYaExiste = !!document.getElementById('buscar-prop');

  if (!panelYaExiste) {
    c.innerHTML =
      '<div class="panel" id="panel-propietarios">'
      + '<div class="panel-header">'
      + '<h3 id="prop-contador">Propietarios</h3>'
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<input type="text" id="buscar-prop" placeholder="Buscar por nombre o documento..." '
      + 'onkeyup="cargarPropietarios(this.value)" '
      + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();cargarPropietarios(this.value)}else if(event.key===\'Escape\'){this.value=\'\';cargarPropietarios(\'\')}" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;width:250px">'
      + (puedo('PROPIETARIOS','CREAR') ? '<button class="btn-primario" onclick="abrirPropietario(null)">+ Nuevo Propietario</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" id="tabla-prop-cont"><div class="loading"><div class="spinner"></div> Cargando...</div></div>'
      + '</div>';
  }

  const tablaCont = document.getElementById('tabla-prop-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  try {
    let query = '?select=*&order=fecha_registro.desc' + emisorQ();
    if (filtro && filtro.trim()) query += '&or=(nombre_completo.ilike.*' + encodeURIComponent(filtro.trim()) + '*,numero_doc.ilike.*' + encodeURIComponent(filtro.trim()) + '*)';
    const props = await api('propietarios', 'GET', null, query);
    propietariosCache = props;

    const vehs = await api('vehiculos', 'GET', null, '?select=id_vehiculo,placa,marca,modelo,id_propietario'+emisorQ());
    props.forEach(function(p) {
      p.vehiculos = vehs.filter(function(v) { return v.id_propietario === p.id_propietario; });
    });

    const filas = props.map(function(p) {
      const vCount = p.vehiculos ? p.vehiculos.length : 0;
      const vList  = p.vehiculos ? p.vehiculos.map(function(v) { return v.placa; }).join(', ') : '—';
      return '<tr>'
        + '<td>'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + (p.foto_documento
          ? '<img src="' + p.foto_documento + '" onerror="imgError(this)" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--borde)">'
          : '<div style="width:32px;height:32px;border-radius:50%;background:var(--gris3);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--suave)">👤</div>')
        + '<div>'
        + '<div style="font-weight:500">' + p.nombre_completo + '</div>'
        + '<div style="font-size:11px;color:var(--suave)">' + p.tipo_doc + '-' + p.numero_doc + '</div>'
        + (p.tipo_contribuyente ? '<span class="badge ' + ({'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris'}[p.tipo_contribuyente]||'badge-gris') + '" style="font-size:9px;margin-top:3px;display:inline-block">' + ({'ORDINARIO':'Ord.','ESPECIAL':'Esp.','FORMAL':'Form.'}[p.tipo_contribuyente]||p.tipo_contribuyente) + '</span>' : '')
        + '</div></div></td>'
        + '<td style="font-size:12px">' + (puedo('PROPIETARIOS','VER_DATOS_PERSONALES') ? (p.telefono || '—') : '🔒') + '</td>'
        + '<td style="font-size:12px">' + (puedo('PROPIETARIOS','VER_DATOS_PERSONALES') ? (p.correo || '—') : '🔒') + '</td>'
        + '<td><span class="badge badge-naranja" style="cursor:pointer" onclick="verVehiculosPropietario(' + p.id_propietario + ')">' + vCount + ' veh.</span></td>'
        + '<td style="font-size:11px;color:var(--suave)">' + (vList.length > 30 ? vList.substring(0,30)+'...' : vList) + '</td>'
        + '<td>'
        + '<div style="display:flex;gap:6px">'
        + '<button class="btn-secundario" onclick="verFichaPropietario(' + p.id_propietario + ')">Ver</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');

    const contador = document.getElementById('prop-contador');
    if (contador) contador.textContent = 'Propietarios (' + props.length + ')';

    const tabla = document.getElementById('tabla-prop-cont');
    if (tabla) tabla.innerHTML =
      '<table><thead><tr><th>Propietario</th><th>Teléfono</th><th>Correo</th><th>Vehículos</th><th>Placas</th><th>Acción</th></tr></thead>'
      + '<tbody>' + (filas || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--suave)">No hay propietarios registrados</td></tr>') + '</tbody>'
      + '</table>';

  } catch(e) {
    const tabla = document.getElementById('tabla-prop-cont');
    if (tabla) tabla.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function abrirPropietario(id) {
  if (id && !puedo('PROPIETARIOS','EDITAR')) { alert('No tiene permiso para editar propietarios.'); return; }
  if (!id && !puedo('PROPIETARIOS','CREAR')) { alert('No tiene permiso para registrar propietarios.'); return; }
  const p = id ? propietariosCache.find(function(x) { return x.id_propietario === id; }) : null;
  document.getElementById('modal-prop-titulo').textContent = p ? 'EDITAR PROPIETARIO' : 'NUEVO PROPIETARIO';
  document.getElementById('prop-id').value          = p ? p.id_propietario : '';
  document.getElementById('prop-tipo-doc').value    = p ? p.tipo_doc        : 'V';
  document.getElementById('prop-num-doc').value     = p ? p.numero_doc      : '';
  document.getElementById('prop-nombre').value      = p ? p.nombre_completo : '';
  document.getElementById('prop-rif-civil').value   = p ? (p.rif || '') : '';
  document.getElementById('prop-telefono').value    = p ? (p.telefono || '') : '';
  document.getElementById('prop-correo').value      = p ? (p.correo || '')   : '';
  document.getElementById('prop-direccion').value   = p ? (p.direccion || '') : '';
  document.getElementById('prop-empresa').value          = p ? (p.empresa || '')  : '';
  document.getElementById('prop-tipo-contribuyente').value = p ? (p.tipo_contribuyente || '') : '';
  const propFotoPreview = document.getElementById('prop-foto-preview');
  propFotoPreview.src = p && p.foto_documento ? p.foto_documento : '';
  propFotoPreview.style.display = 'none';
  document.getElementById('alerta-prop-ok').style.display    = 'none';
  document.getElementById('alerta-prop-err').style.display   = 'none';

  // Mostrar foto actual del documento con opción de eliminar
  const propFotoActual = document.getElementById('prop-foto-actual');
  if (propFotoActual) {
    if (p && p.foto_documento) {
      propFotoActual.innerHTML = '<div style="position:relative;display:inline-block">'
        + '<img src="' + p.foto_documento + '" onerror="imgError(this)" style="height:70px;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + p.foto_documento + '\')">'
        + '<button onclick="eliminarDocPropietario(' + (p ? p.id_propietario : 0) + ', true)" style="position:absolute;top:-6px;right:-6px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>'
        + '</div>';
    } else {
      propFotoActual.innerHTML = '';
    }
  }
  const infoEl = document.getElementById('prop-cedula-info');
  if (infoEl) infoEl.style.display = 'none';
  abrirModal('modal-propietario');
  focusFirstField('modal-propietario');
}

async function guardarPropietario() {
  const id = document.getElementById('prop-id').value;
  if (id && !puedo('PROPIETARIOS','EDITAR')) { alert('No tiene permiso para editar propietarios.'); return; }
  if (!id && !puedo('PROPIETARIOS','CREAR')) { alert('No tiene permiso para registrar propietarios.'); return; }
  const tipDoc  = document.getElementById('prop-tipo-doc').value;
  const numDoc  = document.getElementById('prop-num-doc').value.trim();
  const nombre  = document.getElementById('prop-nombre').value.trim();
  const tel     = document.getElementById('prop-telefono').value.trim();
  const correo  = document.getElementById('prop-correo').value.trim();
  const dir     = document.getElementById('prop-direccion').value.trim();
  const emp     = document.getElementById('prop-empresa').value.trim();
  const rif     = document.getElementById('prop-rif-civil').value.trim();
  const tipoContrib = document.getElementById('prop-tipo-contribuyente').value;
  const fotoFile= document.getElementById('prop-foto-file').files[0];
  const okEl    = document.getElementById('alerta-prop-ok');
  const errEl   = document.getElementById('alerta-prop-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!nombre || !numDoc) {
    errEl.textContent = 'Nombre y número de documento son obligatorios.';
    errEl.style.display = 'block'; return;
  }

  // Capitalizar nombre correctamente
  const nombreFinal = capitalizarNombre(nombre);

  try {
    let fotoUrl = id ? (propietariosCache.find(function(p) { return p.id_propietario == id; })?.foto_documento || null) : null;
    if (fotoFile) fotoUrl = await subirFoto(fotoFile, 'propietarios');

    const datos = {
      tipo_doc: tipDoc, numero_doc: numDoc, nombre_completo: nombreFinal,
      rif: rif || null, telefono: tel || null, correo: correo || null,
      direccion: dir || null, empresa: emp || null,
      tipo_contribuyente: tipoContrib || null,
      foto_documento: fotoUrl, id_usuario: sesionActual.correo_usuario,
      id_empresa: _empresaActiva ? _empresaActiva.id_empresa : null
    };

    if (id) {
      await api('propietarios', 'PATCH', datos, '?id_propietario=eq.' + id);
      okEl.textContent = '✓ Propietario actualizado.';
    } else {
      await api('propietarios', 'POST', datos);
      okEl.textContent = '✓ Propietario registrado.';
    }
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-propietario');
      document.getElementById('contenido-principal').innerHTML = '';
      renderPropietarios();
    }, 1200);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function eliminarPropietario(id, nombre) {
  if (!puedo('PROPIETARIOS','ELIMINAR')) { alert('No tiene permiso para eliminar propietarios.'); return; }
  if (!confirm('¿Eliminar al propietario "' + nombre + '"?\nVerifique que no tenga vehículos activos asignados.')) return;
  try {
    await api('vehiculos_propietarios_hist', 'DELETE', null, '?id_propietario=eq.' + id);
    await api('propietarios', 'DELETE', null, '?id_propietario=eq.' + id);
    document.getElementById('contenido-principal').innerHTML = '';
    renderPropietarios();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function verFichaPropietario(id) {
  if (!sesionActual?.administrador && !puedo('PROPIETARIOS','VER')) {
    alert('No tiene permiso para ver la ficha del propietario.');
    return;
  }
  const p = propietariosCache.find(function(x) { return x.id_propietario == id; });
  if (!p) return;
  const vehs = await api('vehiculos', 'GET', null, '?id_propietario=eq.' + id + '&select=*');

  const vehsHTML = vehs.length ? vehs.map(function(v) {
    return '<div style="background:var(--gris3);border-radius:6px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">'
      + '<div>'
      + '<div style="font-weight:500;font-size:14px">' + v.placa + ' — ' + v.marca + ' ' + v.modelo + ' ' + v.anio + '</div>'
      + '<div style="font-size:11px;color:var(--suave)">' + (v.color || '') + ' · ' + (v.tipo_carroceria || '') + '</div>'
      + '</div>'
      + '<button class="btn-secundario" style="font-size:11px" onclick="cerrarModal(\'modal-ficha-prop\');verFichaVehiculo(' + v.id_vehiculo + ')">Ver</button>'
      + '</div>';
  }).join('') : '<div style="color:var(--suave);font-size:13px">Sin vehículos registrados</div>';

  // Configurar botones footer
  var btnPropEditar = document.getElementById('ficha-prop-btn-editar');
  var btnPropElim   = document.getElementById('ficha-prop-btn-eliminar');
  if (btnPropEditar) { btnPropEditar._id = id; btnPropEditar.onclick = function() { cerrarModal('modal-ficha-prop'); abrirPropietario(this._id); };                            btnPropEditar.style.display = puedo('PROPIETARIOS','EDITAR') ? '' : 'none'; }
  if (btnPropElim)   { btnPropElim._id = id;   btnPropElim._nombre = p.nombre_completo; btnPropElim.onclick = function() { cerrarModal('modal-ficha-prop'); eliminarPropietario(this._id, this._nombre); }; btnPropElim.style.display = puedo('PROPIETARIOS','ELIMINAR') ? '' : 'none'; }

  const verDatosProp = sesionActual?.administrador || puedo('PROPIETARIOS','VER_DATOS_PERSONALES');
  document.getElementById('ficha-prop-contenido').innerHTML =
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">'
    + (p.foto_documento ? '<img src="' + p.foto_documento + '" onerror="imgError(this)" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:2px solid var(--borde);cursor:zoom-in" onclick="abrirVisor(\'' + p.foto_documento + '\')">' : '')
    + '<div>'
    + '<div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + p.nombre_completo + '</div>'
    + (verDatosProp ? '<div style="font-size:13px;color:var(--suave)">' + p.tipo_doc + '-' + p.numero_doc + '</div>' : '<div style="font-size:13px;color:#555">🔒 Restringido</div>')
    + '</div></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
    + (verDatosProp ? '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Teléfono</div><div style="font-size:13px">' + (p.telefono || '—') + '</div></div>' : '')
    + (verDatosProp ? '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Correo</div><div style="font-size:13px">' + (p.correo || '—') + '</div></div>' : '')
    + '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Empresa</div><div style="font-size:13px">' + (p.empresa || '—') + '</div></div>'
    + '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Tipo Contribuyente</div>'
    + '<div>' + (p.tipo_contribuyente ? '<span class="badge ' + ({'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris'}[p.tipo_contribuyente]||'badge-gris') + '">' + ({'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal'}[p.tipo_contribuyente]||p.tipo_contribuyente) + '</span>' : '<span style="color:var(--suave);font-size:12px">No especificado</span>') + '</div></div>'
    + (verDatosProp ? '<div><div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div style="font-size:13px">' + (p.direccion || '—') + '</div></div>' : '')
    + '</div>'
    + '<div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Vehículos (' + vehs.length + ')</div>'
    + vehsHTML;

  abrirModal('modal-ficha-prop');
  focusFirstField('modal-ficha-prop');
}

function verVehiculosPropietario(id) {
  if (!sesionActual?.administrador && !modulosAcceso.includes('VEHICULOS')) {
    alert('No tiene acceso al módulo de Vehículos.');
    return;
  }
  mostrarModulo('vehiculos', document.getElementById('nav-VEHICULOS'));
  setTimeout(function() { filtrarVehiculosPorPropietario(id); }, 500);
}

// ══════════════════════════════
// MÓDULO VEHÍCULOS
// ══════════════════════════════
let vehiculosCache = [];
let propietariosSimple = [];

async function renderVehiculos() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('VEHICULOS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando vehículos...</div>';
  propietariosSimple = await api('propietarios', 'GET', null, '?select=id_propietario,tipo_doc,numero_doc,nombre_completo&order=nombre_completo.asc'+emisorQ());
  await cargarVehiculos(null, null); // Sin filtros al cargar
}

async function cargarVehiculos(filtro, propId) {
  const c = document.getElementById('contenido-principal');

  // Si el panel ya existe, solo actualizar la tabla — no reconstruir el header
  const panelYaExiste = !!document.getElementById('buscar-veh');

  if (!panelYaExiste) {
    // Primera carga: construir el panel completo con header y tabla vacía
    c.innerHTML =
      '<div class="panel" id="panel-vehiculos">'
      + '<div class="panel-header">'
      + '<h3 id="veh-contador">Vehículos</h3>'
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<input type="text" id="buscar-veh" placeholder="Buscar placa, marca, modelo..." '
      + 'onkeyup="buscarVehiculos(this.value)" '
      + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();buscarVehiculos(this.value)}else if(event.key===\'Escape\'){this.value=\'\';buscarVehiculos(\'\')}" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;width:240px">'
      + '<select id="filtro-prop-veh" onchange="filtrarVehiculosPorPropietario(this.value || null)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none">'
      + '<option value="">Todos los propietarios</option>'
      + propietariosSimple.map(function(p) { return '<option value="' + p.id_propietario + '">' + p.nombre_completo + '</option>'; }).join('')
      + '</select>'
      + (puedo('VEHICULOS','CREAR') ? '<button class="btn-primario" onclick="abrirVehiculo(null)">+ Nuevo Vehículo</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" id="tabla-vehiculos-cont"><div class="loading"><div class="spinner"></div> Cargando...</div></div>'
      + '</div>';
  }

  // Actualizar el select de propietarios si ya existe
  const selProp = document.getElementById('filtro-prop-veh');
  if (selProp && propId !== undefined) {
    selProp.value = propId || '';
  }

  const tablaCont = document.getElementById('tabla-vehiculos-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  try {
    let query = '?select=*&order=fecha_registro.desc' + emisorQ();
    if (filtro && filtro.trim()) {
      const f = encodeURIComponent(filtro.trim());
      query += '&or=(placa.ilike.*' + f + '*,marca.ilike.*' + f + '*,modelo.ilike.*' + f + '*)';
    }
    if (propId) query += '&id_propietario=eq.' + propId;

    const [vehs, todosProp, todasFotos] = await Promise.all([
      api('vehiculos', 'GET', null, query),
      api('propietarios', 'GET', null, '?select=id_propietario,tipo_doc,numero_doc,nombre_completo'+emisorQ()),
      api('vehiculos_fotos', 'GET', null, '?select=id_vehiculo,url_foto,orden&order=orden.asc')
    ]);

    vehiculosCache = vehs;

    vehs.forEach(function(v) {
      v.propietarios = todosProp.find(function(p) { return p.id_propietario === v.id_propietario; }) || null;
      v.vehiculos_fotos = todasFotos.filter(function(f) { return f.id_vehiculo === v.id_vehiculo; });
    });

    const filas = vehs.map(function(v) {
      const prop  = v.propietarios;
      const fotos = v.vehiculos_fotos ? v.vehiculos_fotos.sort(function(a,b){return a.orden-b.orden;}) : [];
      const foto  = fotos.length ? fotos[0].url_foto : null;
      return '<tr>'
        + '<td>'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + (foto
          ? '<img src="' + foto + '" onerror="imgError(this)" style="width:44px;height:34px;object-fit:cover;border-radius:4px;border:1px solid var(--borde);flex-shrink:0">'
          : '<div style="width:44px;height:34px;background:var(--gris3);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🚗</div>')
        + '<div>'
        + '<div style="font-family:var(--font-mono);font-weight:700;color:var(--naranja);font-size:13px">' + v.placa + '</div>'
        + '<div style="font-size:11px;color:var(--suave)">' + v.marca + ' ' + v.modelo + '</div>'
        + '</div></div></td>'
        + '<td style="font-size:12px">' + v.anio + '</td>'
        + '<td style="font-size:12px;color:var(--suave)">' + (v.color || '—') + ' · ' + (v.tipo_carroceria || '—') + '</td>'
        + '<td>'
        + (prop
          ? '<div style="font-size:12px;font-weight:500">' + prop.nombre_completo + '</div>'
          + '<div style="font-size:11px;color:var(--suave)">' + prop.tipo_doc + '-' + prop.numero_doc + '</div>'
          : '<span style="color:#444;font-size:12px">Sin propietario</span>')
        + '</td>'
        + '<td style="font-size:12px;text-align:center">' + fotos.length + ' 📷</td>'
        + '<td><span class="badge ' + (v.estado_vehiculo === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + v.estado_vehiculo + '</span></td>'
        + '<td>'
        + '<div style="display:flex;gap:6px">'
        + '<button class="btn-secundario" onclick="verFichaVehiculo(' + v.id_vehiculo + ')">Ver</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');

    const contador = document.getElementById('veh-contador');
    if (contador) contador.textContent = 'Vehículos (' + vehs.length + ')';

    const tabla = document.getElementById('tabla-vehiculos-cont');
    if (tabla) tabla.innerHTML =
      '<table><thead><tr>'
      + '<th>Vehículo</th><th>Año</th><th>Color · Tipo</th><th>Propietario</th><th>Fotos</th><th>Estado</th><th>Acción</th>'
      + '</tr></thead>'
      + '<tbody>' + (filas || '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--suave)">No hay vehículos registrados</td></tr>') + '</tbody>'
      + '</table>';

  } catch(e) {
    const tabla = document.getElementById('tabla-vehiculos-cont');
    if (tabla) tabla.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}


// Helper: buscar por texto respetando filtro de propietario activo
function buscarVehiculos(texto) {
  // Si hay texto, limpiar el filtro de propietario
  if (texto && texto.trim()) {
    const selProp = document.getElementById('filtro-prop-veh');
    if (selProp) selProp.value = '';
  }
  cargarVehiculos(texto || null, null);
}

// Helper: filtrar por propietario — limpia el texto de búsqueda
function filtrarVehiculosPorPropietario(propId) {
  const sel = document.getElementById('filtro-prop-veh');
  if (sel) sel.value = propId || '';
  // Si hay propietario seleccionado, limpiar búsqueda de texto
  if (propId) {
    const buscarEl = document.getElementById('buscar-veh');
    if (buscarEl) buscarEl.value = '';
  }
  cargarVehiculos(null, propId || null);
}

async function abrirVehiculo(id) {
  if (id && !puedo('VEHICULOS','EDITAR')) { alert('No tiene permiso para editar vehículos.'); return; }
  if (!id && !puedo('VEHICULOS','CREAR')) { alert('No tiene permiso para registrar vehículos.'); return; }
  const v = id ? vehiculosCache.find(function(x) { return x.id_vehiculo === id; }) : null;
  document.getElementById('modal-veh-titulo').textContent = v ? 'EDITAR VEHÍCULO' : 'NUEVO VEHÍCULO';
  document.getElementById('veh-id').value            = v ? v.id_vehiculo       : '';
  document.getElementById('veh-placa').value         = v ? v.placa             : '';
  document.getElementById('veh-marca').value         = v ? v.marca             : '';
  document.getElementById('veh-modelo').value        = v ? v.modelo            : '';
  document.getElementById('veh-anio').value          = v ? v.anio              : new Date().getFullYear();
  document.getElementById('veh-color').value         = v ? (v.color || '')     : '';
  document.getElementById('veh-carroceria').value    = v ? (v.tipo_carroceria || '') : '';
  document.getElementById('veh-motor').value         = v ? (v.numero_motor || '')   : '';
  document.getElementById('veh-chasis').value        = v ? (v.numero_chasis || '')  : '';
  document.getElementById('veh-km').value            = v ? (v.kilometraje || 0)     : 0;
  document.getElementById('veh-estado').value        = v ? v.estado_vehiculo        : 'ACTIVO';
  document.getElementById('veh-propietario').value   = v && v.id_propietario ? v.id_propietario : '';
  document.getElementById('veh-carnet-preview').style.display = 'none';
  document.getElementById('alerta-veh-ok').style.display  = 'none';
  document.getElementById('alerta-veh-err').style.display = 'none';
  document.getElementById('veh-fotos-preview').innerHTML  = '';

  // Mostrar carnet actual con opción de eliminar
  const carnetDiv = document.getElementById('veh-carnet-actual');
  if (v && v.foto_carnet) {
    carnetDiv.innerHTML = '<div style="position:relative;display:inline-block">'
      + '<img src="' + v.foto_carnet + '" onerror="imgError(this)" style="height:70px;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + v.foto_carnet + '\')">'
      + '<button onclick="eliminarCarnet(' + (v ? v.id_vehiculo : 0) + ', true)" style="position:absolute;top:-6px;right:-6px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>'
      + '</div>';
  } else {
    carnetDiv.innerHTML = '';
  }

  // Mostrar fotos actuales con opción de eliminar
  const fotosDiv = document.getElementById('veh-fotos-actuales');
  if (v && v.id_vehiculo) {
    api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + v.id_vehiculo + '&order=orden.asc').then(function(fotos) {
      if (fotos.length) {
        fotosDiv.innerHTML = fotos.map(function(f) {
          return '<div style="position:relative">'
            + '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:100%;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + f.url_foto + '\')">'
            + '<button onclick="eliminarFotoEditar(' + f.id_foto + ',' + v.id_vehiculo + ')" style="position:absolute;top:-5px;right:-5px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>'
            + '</div>';
        }).join('');
      } else {
        fotosDiv.innerHTML = '<div style="font-size:11px;color:var(--suave)">Sin fotos registradas</div>';
      }
    });
  } else {
    fotosDiv.innerHTML = '';
  }

  // Populate propietarios dropdown
  const sel = document.getElementById('veh-propietario');
  sel.innerHTML = '<option value="">Sin propietario</option>'
    + propietariosSimple.map(function(p) {
        return '<option value="' + p.id_propietario + '" ' + (v && v.id_propietario == p.id_propietario ? 'selected' : '') + '>'
          + p.tipo_doc + '-' + p.numero_doc + ' · ' + p.nombre_completo + '</option>';
      }).join('');

  abrirModal('modal-vehiculo');
  focusFirstField('modal-vehiculo');
}

async function guardarVehiculo() {
  const id = document.getElementById('veh-id').value;
  if (id && !puedo('VEHICULOS','EDITAR')) { alert('No tiene permiso para editar vehículos.'); return; }
  if (!id && !puedo('VEHICULOS','CREAR')) { alert('No tiene permiso para registrar vehículos.'); return; }
  const placa    = document.getElementById('veh-placa').value.trim().toUpperCase();
  const marca    = document.getElementById('veh-marca').value.trim();
  const modelo   = document.getElementById('veh-modelo').value.trim();
  const anio     = parseInt(document.getElementById('veh-anio').value);
  const color    = document.getElementById('veh-color').value.trim();
  const carr     = document.getElementById('veh-carroceria').value.trim();
  const motor    = document.getElementById('veh-motor').value.trim();
  const chasis   = document.getElementById('veh-chasis').value.trim();
  const km       = parseInt(document.getElementById('veh-km').value) || 0;
  const estado   = document.getElementById('veh-estado').value;
  const propId   = document.getElementById('veh-propietario').value || null;
  const carnetF  = document.getElementById('veh-carnet-file').files[0];
  const fotosF   = document.getElementById('veh-fotos-files').files;
  const okEl     = document.getElementById('alerta-veh-ok');
  const errEl    = document.getElementById('alerta-veh-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!placa || !marca || !modelo || !anio) {
    errEl.textContent = 'Placa, marca, modelo y año son obligatorios.';
    errEl.style.display = 'block'; return;
  }

  try {
    let carnetUrl = id ? (vehiculosCache.find(function(v) { return v.id_vehiculo == id; })?.foto_carnet || null) : null;
    if (carnetF) carnetUrl = await subirFoto(carnetF, 'carnets');

    const datos = {
      placa, marca, modelo, anio, color: color || null,
      tipo_carroceria: carr || null, numero_motor: motor || null,
      numero_chasis: chasis || null, kilometraje: km,
      estado_vehiculo: estado,
      id_propietario: propId ? parseInt(propId) : null,
      foto_carnet: carnetUrl,
      id_usuario: sesionActual.correo_usuario
    };

    let vehId = id;
    if (id) {
      await api('vehiculos', 'PATCH', datos, '?id_vehiculo=eq.' + id);
    } else {
      const res = await api('vehiculos', 'POST', datos);
      if (res && res[0]) vehId = res[0].id_vehiculo;
    }

    // Subir fotos adicionales
    if (fotosF && fotosF.length > 0 && vehId) {
      const fotosExistentes = await api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + vehId + '&select=orden&order=orden.desc&limit=1');
      let ordenInicial = fotosExistentes.length ? (fotosExistentes[0].orden + 1) : 1;
      for (let i = 0; i < Math.min(fotosF.length, 8); i++) {
        const url = await subirFoto(fotosF[i], 'vehiculos/' + vehId);
        await api('vehiculos_fotos', 'POST', { id_vehiculo: parseInt(vehId), url_foto: url, orden: ordenInicial + i });
      }
    }

    // Registrar en historial de propietarios si cambió
    if (propId && vehId) {
      await api('vehiculos_propietarios_hist', 'PATCH', { activo: false, fecha_hasta: new Date().toISOString().split('T')[0] },
        '?id_vehiculo=eq.' + vehId + '&activo=eq.true&id_propietario=neq.' + propId);
      const histActivo = await api('vehiculos_propietarios_hist', 'GET', null,
        '?id_vehiculo=eq.' + vehId + '&activo=eq.true&select=id_hist');
      if (!histActivo.length) {
        await api('vehiculos_propietarios_hist', 'POST', {
          id_vehiculo: parseInt(vehId), id_propietario: parseInt(propId),
          fecha_desde: new Date().toISOString().split('T')[0], activo: true,
          id_usuario: sesionActual.correo_usuario
        });
      }
    }

    okEl.textContent = '✓ Vehículo guardado correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() {
      cerrarModal('modal-vehiculo');
      document.getElementById('contenido-principal').innerHTML = '';
      renderVehiculos();
    }, 1200);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function verFichaVehiculo(id) {
  if (!sesionActual?.administrador && !puedo('VEHICULOS','VER')) {
    alert('No tiene permiso para ver la ficha del vehículo.');
    return;
  }
  try {
  // Buscar directo en Supabase para tener datos completos
  let v = vehiculosCache.find(function(x) { return x.id_vehiculo == id; });
  if (!v) {
    const res = await api('vehiculos', 'GET', null, '?id_vehiculo=eq.' + id + '&select=*,propietarios(id_propietario,tipo_doc,numero_doc,nombre_completo)');
    if (!res || !res.length) { alert('Vehículo no encontrado'); return; }
    v = res[0];
  }
  const [fotos, histProp] = await Promise.all([
    api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + id + '&order=orden.asc'),
    api('vehiculos_propietarios_hist', 'GET', null, '?id_vehiculo=eq.' + id + '&select=*,propietarios(nombre_completo,tipo_doc,numero_doc)&order=fecha_desde.desc')
  ]);

  const fotosHTML = fotos.length
    ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">'
      + fotos.map(function(f) {
          return '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:100%;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + f.url_foto + '\')">';
        }).join('')
    : '<div style="color:var(--suave);font-size:12px;margin-bottom:20px">Sin fotos registradas</div>';

  // Solo mostrar propietarios anteriores (no el actual)
  const histAnterior = histProp.filter(function(h) { return !h.activo; });
  const histHTML = histAnterior.length
    ? histAnterior.map(function(h) {
        const p = h.propietarios;
        return '<div style="padding:8px 0;border-bottom:1px solid var(--borde)">'
          + '<div style="font-size:12px;font-weight:500">' + (p ? p.nombre_completo : '—') + '</div>'
          + '<div style="font-size:11px;color:var(--suave);margin-top:3px">' + fmtFecha(h.fecha_desde) + ' → ' + (h.fecha_hasta || 'Desconocido') + '</div>'
          + '</div>';
      }).join('')
    : '<div style="color:var(--suave);font-size:12px">Sin propietarios anteriores</div>';

  const prop = v.propietarios;
  // Configurar botones footer
  var btnVehEditar = document.getElementById('ficha-veh-btn-editar');
  var btnVehElim   = document.getElementById('ficha-veh-btn-eliminar');
  if (btnVehEditar)  { btnVehEditar._id = id;  btnVehEditar.onclick = function() { cerrarModal('modal-ficha-veh'); abrirVehiculo(this._id); };  btnVehEditar.style.display = puedo('VEHICULOS','EDITAR') ? '' : 'none'; }
  if (btnVehElim)    { btnVehElim._id = id;    btnVehElim.onclick = async function() {
    // Necesitamos la placa — buscar en cache o desde la BD
    var vCached = vehiculosCache.find(function(x){return x.id_vehiculo==id;});
    var placa = vCached ? vCached.placa : 'este vehículo';
    cerrarModal('modal-ficha-veh');
    eliminarVehiculo(id, placa);
  }; btnVehElim.style.display = puedo('VEHICULOS','ELIMINAR') ? '' : 'none'; }

  document.getElementById('ficha-veh-contenido').innerHTML =
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">'
    + (v.foto_carnet ? '<img src="' + v.foto_carnet + '" onerror="imgError(this)" style="height:80px;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + v.foto_carnet + '\')">'
      : '<span style="font-size:12px;color:var(--suave)">Sin carnet registrado</span>')
    + '<div>'
    + '<div style="font-family:var(--font-display);font-size:24px;color:var(--naranja)">' + v.placa + '</div>'
    + '<div style="font-size:16px;font-weight:500">' + v.marca + ' ' + v.modelo + ' ' + v.anio + '</div>'
    + '<div style="font-size:12px;color:var(--suave)">' + (v.color || '') + ' · ' + (v.tipo_carroceria || '') + '</div>'
    + '</div></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Motor</div><div style="font-size:13px;font-family:var(--font-mono)">' + (v.numero_motor || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Chasis</div><div style="font-size:13px;font-family:var(--font-mono)">' + (v.numero_chasis || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Kilometraje</div><div style="font-size:13px">' + (v.kilometraje || 0).toLocaleString() + ' km</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px">Estado</div><span class="badge ' + (v.estado_vehiculo === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + v.estado_vehiculo + '</span></div>'
    + '</div>'
    + (prop ? '<div style="background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:6px;padding:12px 16px;margin-bottom:20px">'
      + '<div style="font-size:9px;color:var(--naranja);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Propietario Actual</div>'
      + '<div style="font-weight:500">' + prop.nombre_completo + '</div>'
      + '<div style="font-size:11px;color:var(--suave)">' + prop.tipo_doc + '-' + prop.numero_doc + '</div>'
      + '</div>' : '')
    + '<div style="width:100%">'
    + '<div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Fotos del Vehículo</div>'
    + fotosHTML
    + '</div>'
    + '<div style="width:100%;margin-top:20px">'
    + '<div style="font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Propietarios Anteriores</div>'
    + histHTML
    + '</div>';

  abrirModal('modal-ficha-veh');
  focusFirstField('modal-ficha-veh');
  } catch(e) { alert('Error abriendo ficha: ' + e.message); console.error(e); }
}

async function eliminarVehiculo(id, placa) {
  if (!puedo('VEHICULOS','ELIMINAR')) { alert('No tiene permiso para eliminar vehículos.'); return; }
  if (!confirm('¿Eliminar el vehículo con placa "' + placa + '"?\nSe eliminarán también sus fotos y el historial de propietarios.')) return;
  try {
    await Promise.all([
      api('vehiculos_fotos', 'DELETE', null, '?id_vehiculo=eq.' + id),
      api('vehiculos_propietarios_hist', 'DELETE', null, '?id_vehiculo=eq.' + id),
    ]);
    await api('vehiculos', 'DELETE', null, '?id_vehiculo=eq.' + id);
    document.getElementById('contenido-principal').innerHTML = '';
    renderVehiculos();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function verFotosVehiculo(id) {
  const fotos = await api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + id + '&order=orden.asc');
  document.getElementById('gal-veh-id').value = id;
  const cont = document.getElementById('galeria-fotos-cont');
  cont.innerHTML = fotos.length
    ? fotos.map(function(f) {
        return '<div style="position:relative;border-radius:6px;overflow:hidden">'
          + '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:100%;height:120px;object-fit:cover;cursor:pointer" onclick="abrirVisor(\'' + f.url_foto + '\')">'
          + '<button onclick="eliminarFoto(' + f.id_foto + ')" style="position:absolute;top:4px;right:4px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px">✕</button>'
          + '</div>';
      }).join('')
    : '<div style="color:var(--suave);font-size:13px;text-align:center;padding:20px">Sin fotos registradas</div>';
  document.getElementById('alerta-gal-ok').style.display  = 'none';
  document.getElementById('alerta-gal-err').style.display = 'none';
  abrirModal('modal-galeria');
  focusFirstField('modal-galeria');
}

async function subirMasFotos() {
  const id    = document.getElementById('gal-veh-id').value;
  const files = document.getElementById('gal-fotos-files').files;
  const okEl  = document.getElementById('alerta-gal-ok');
  const errEl = document.getElementById('alerta-gal-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!files.length) { errEl.textContent = 'Selecciona al menos una foto.'; errEl.style.display = 'block'; return; }

  try {
    const existentes = await api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + id + '&select=id_foto');
    if (existentes.length >= 8) { errEl.textContent = 'Máximo 8 fotos por vehículo.'; errEl.style.display = 'block'; return; }
    const disponibles = 8 - existentes.length;
    const orden = existentes.length + 1;
    for (let i = 0; i < Math.min(files.length, disponibles); i++) {
      const url = await subirFoto(files[i], 'vehiculos/' + id);
      await api('vehiculos_fotos', 'POST', { id_vehiculo: parseInt(id), url_foto: url, orden: orden + i });
    }
    okEl.textContent = '✓ Fotos subidas correctamente.';
    okEl.style.display = 'block';
    setTimeout(function() { verFotosVehiculo(id); }, 800);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block';
  }
}

async function eliminarFoto(idFoto) {
  if (!confirm('¿Eliminar esta foto?')) return;
  await api('vehiculos_fotos', 'DELETE', null, '?id_foto=eq.' + idFoto);
  const id = document.getElementById('gal-veh-id').value;
  verFotosVehiculo(id);
}




// ─── ELIMINAR FOTOS ───
async function eliminarFotoEditar(idFoto, id_vehiculo) {
  if (!confirm('¿Eliminar esta foto?')) return;
  try {
    await api('vehiculos_fotos', 'DELETE', null, '?id_foto=eq.' + idFoto);
    // Refresh fotos in edit modal
    const fotos = await api('vehiculos_fotos', 'GET', null, '?id_vehiculo=eq.' + id_vehiculo + '&order=orden.asc');
    const fotosDiv = document.getElementById('veh-fotos-actuales');
    if (fotos.length) {
      fotosDiv.innerHTML = fotos.map(function(f) {
        return '<div style="position:relative">'
          + '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:100%;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--borde)">'
          + '<button onclick="eliminarFotoEditar(' + f.id_foto + ',' + id_vehiculo + ')" style="position:absolute;top:-5px;right:-5px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>'
          + '</div>';
      }).join('');
    } else {
      fotosDiv.innerHTML = '<div style="font-size:11px;color:var(--suave)">Sin fotos registradas</div>';
    }
  } catch(e) { alert('Error: ' + e.message); }
}


async function eliminarFotoFicha(idFoto, id_vehiculo) {
  if (!confirm('¿Eliminar esta foto?')) return;
  try {
    await api('vehiculos_fotos', 'DELETE', null, '?id_foto=eq.' + idFoto);
    verFichaVehiculo(id_vehiculo);
  } catch(e) { alert('Error: ' + e.message); }
}


async function eliminarCarnet(id_vehiculo, desdeEditar) {
  if (!confirm('¿Eliminar el carnet de circulación?')) return;
  try {
    await api('vehiculos', 'PATCH', { foto_carnet: null }, '?id_vehiculo=eq.' + id_vehiculo);
    const v = vehiculosCache.find(function(x) { return x.id_vehiculo == id_vehiculo; });
    if (v) v.foto_carnet = null;
    if (desdeEditar) {
      document.getElementById('veh-carnet-actual').innerHTML = '';
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarDocPropietario(id_propietario, desdeEditar) {
  if (!confirm('¿Eliminar la foto del documento de identidad?')) return;
  try {
    await api('propietarios', 'PATCH', { foto_documento: null }, '?id_propietario=eq.' + id_propietario);
    const p = propietariosCache.find(function(x) { return x.id_propietario == id_propietario; });
    if (p) p.foto_documento = null;
    if (desdeEditar) {
      const div = document.getElementById('prop-foto-actual');
      if (div) div.innerHTML = '';
    }
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── VISOR DE IMAGEN ───
function abrirVisor(url) {
  document.getElementById('visor-imagen-src').src = url;
  document.getElementById('visor-imagen').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function cerrarVisor() {
  document.getElementById('visor-imagen').style.display = 'none';
  document.getElementById('visor-imagen-src').src = '';
  document.body.style.overflow = '';
}

// Cerrar con tecla ESC
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') cerrarVisor();
});


