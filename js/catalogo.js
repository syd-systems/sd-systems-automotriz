// ─── S&D Systems — Módulo: CATALOGO ───
// ══════════════════════════════════════════════════════════════
//  FASE 3 — CATÁLOGO DE SERVICIOS
// ══════════════════════════════════════════════════════════════
let catalogoCache = [];

async function renderCatalogo(filtro, categoria) {
  if (!sesionActual?.administrador && !modulosAcceso.includes('CATALOGO')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }

  const c = document.getElementById('contenido-principal');
  const panelYaExiste = !!document.getElementById('buscar-cat');

  if (!panelYaExiste) {
    c.innerHTML = '<div class="panel" id="panel-catalogo">'
      + '<div class="panel-header"><h3 id="cat-contador">Catálogo de Servicios</h3>'
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<input type="text" id="buscar-cat" placeholder="Buscar por grupo, servicio..." '
      + 'onkeyup="renderCatalogo(this.value, document.getElementById(\'filtro-cat-cat\').value||null)" '
      + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();renderCatalogo(this.value,document.getElementById(\'filtro-cat-cat\').value||null)}else if(event.key===\'Escape\'){this.value=\'\';renderCatalogo(\'\',document.getElementById(\'filtro-cat-cat\').value||null)}" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none;width:200px">'
      + '<select id="filtro-cat-cat" onchange="renderCatalogo(document.getElementById(\'buscar-cat\').value||null,this.value||null)" '
      + 'style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:8px 14px;border-radius:5px;outline:none">'
      + '<option value="">Todas las categorías</option>'
      + ['MECÁNICA','ELÉCTRICA','CARROCERÍA','FRENOS','SUSPENSIÓN','AIRES','TRANSMISIÓN','DIAGNÓSTICO','OTROS'].map(function(cat) { return '<option value="' + cat + '">' + cat + '</option>'; }).join('')
      + '</select>'
      + (puedo('CATALOGO','CREAR') ? '<button class="btn-primario" onclick="abrirNuevoCatalogo()">+ Nuevo Servicio</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container" id="tabla-cat-cont"><div class="loading"><div class="spinner"></div> Cargando...</div></div>'
      + '</div>';
  }

  // Sync filter values if panel exists
  const selCat = document.getElementById('filtro-cat-cat');
  if (selCat && categoria !== undefined) selCat.value = categoria || '';

  const tablaCont = document.getElementById('tabla-cat-cont');
  if (tablaCont) tablaCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  try {
    const items = await api('servicios_catalogo', 'GET', null, '?order=grupo.asc,nombre.asc&select=*'+emisorQ());
    catalogoCache = items;

    const itemsFiltrados = items.filter(function(s) {
      const matchTexto = !filtro || !filtro.trim() || 
        s.nombre.toLowerCase().includes(filtro.toLowerCase()) || 
        (s.descripcion || '').toLowerCase().includes(filtro.toLowerCase()) ||
        (s.grupo || '').toLowerCase().includes(filtro.toLowerCase());
      const matchCat = !categoria || s.categoria === categoria;
      return matchTexto && matchCat;
    });

    const filas = itemsFiltrados.map(function(s) {
      return '<tr>'
        + '<td><div style="font-size:13px;font-weight:700;color:var(--naranja)">' + (s.grupo || '—') + '</div></td>'
        + '<td><div style="font-weight:600;font-size:14px;color:var(--texto)">' + s.nombre + '</div>'
        + (s.descripcion ? '<div style="font-size:12px;color:var(--suave);margin-top:2px">' + s.descripcion + '</div>' : '')
        + '</td>'
        + '<td><span class="badge badge-gris" style="font-size:12px;font-weight:600">' + (s.tipo_carroceria || 'Todas') + '</span></td>'
        + '<td style="font-family:var(--font-mono);font-size:14px;font-weight:700">'
        + (s.moneda_precio === 'VES'
            ? '<span style="color:var(--naranja)">' + fmtBs(parseFloat(s.precio_usd||0)) + ' Bs</span>'
              + '<div style="font-size:10px;font-weight:400;color:var(--suave)">$ ' + fmtUSD(_tasaVigente > 0 ? parseFloat(s.precio_usd||0) / _tasaVigente : 0) + ' USD</div>'
            : '<span style="color:var(--naranja)">' + fmtBs(parseFloat(s.precio_usd||0) * _tasaVigente) + ' Bs</span>'
              + '<div style="font-size:10px;font-weight:400;color:var(--suave)">$ ' + fmtUSD(s.precio_usd) + ' USD</div>'
          )
        + '</td>'
        + '<td><span class="badge ' + (s.activo ? 'badge-verde' : 'badge-rojo') + '" style="font-size:12px">' + (s.activo ? 'Activo' : 'Inactivo') + '</span></td>'
        + '<td><div style="display:flex;gap:8px">'
        + '<button class="btn-secundario" onclick="(async()=>{if(!catalogoCache.length)await renderCatalogo();verFichaCatalogo(' + s.id_servicio + ');})();">Ver</button>'

        + '</div></td>'
        + '</tr>';
    }).join('');

    const contador = document.getElementById('cat-contador');
    if (contador) contador.textContent = 'Catálogo de Servicios (' + itemsFiltrados.length + ')';

    const tabla = document.getElementById('tabla-cat-cont');
    if (tabla) tabla.innerHTML = '<table><thead><tr>'
      + '<th style="font-size:13px">Grupo</th><th style="font-size:13px">Servicio</th><th style="font-size:13px">Carrocería</th><th style="font-size:13px">Precio</th><th style="font-size:13px">Estado</th><th style="font-size:13px">Acción</th>'
      + '</tr></thead><tbody>' + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px;font-size:14px">Sin servicios registrados</td></tr>') + '</tbody></table>';

  } catch(e) {
    const tabla = document.getElementById('tabla-cat-cont');
    if (tabla) tabla.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function verFichaCatalogo(id) {
  const s = catalogoCache.find(function(x) { return x.id_servicio === parseInt(id); });
  if (!s) { console.log('No encontrado id:', id, 'cache:', catalogoCache.length); return; }

  document.getElementById('ficha-cat-contenido').innerHTML =
    '<div style="margin-bottom:20px">'
    + '<div style="font-size:12px;color:var(--naranja);letter-spacing:2px;font-weight:700;margin-bottom:4px">' + (s.grupo || 'Sin grupo') + '</div>'
    + '<div style="font-family:var(--font-display);font-size:22px;color:var(--texto)">' + s.nombre + '</div>'
    + (s.descripcion ? '<div style="font-size:13px;color:var(--suave);margin-top:4px">' + s.descripcion + '</div>' : '')
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Precio</div>'
    + (s.moneda_precio === 'VES'
        ? '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + fmtBs(parseFloat(s.precio_usd||0)) + ' Bs</div>'
          + '<div style="font-size:12px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(_tasaVigente > 0 ? parseFloat(s.precio_usd||0) / _tasaVigente : 0) + ' USD</div>'
        : '<div style="font-family:var(--font-display);font-size:28px;color:var(--naranja)">' + fmtBs(parseFloat(s.precio_usd||0) * _tasaVigente) + ' Bs</div>'
          + '<div style="font-size:12px;color:var(--suave);margin-top:2px">$ ' + fmtUSD(s.precio_usd) + ' USD</div>'
      )
    + '</div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Estado</div>'
    + '<span class="badge ' + (s.activo ? 'badge-verde' : 'badge-rojo') + '">' + (s.activo ? 'Activo' : 'Inactivo') + '</span></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Categoría</div>'
    + '<div style="font-size:13px">' + (s.categoria || '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Tipo Carrocería</div>'
    + '<div style="font-size:13px">' + (s.tipo_carroceria || 'Todas') + '</div></div>'
    + '</div>';

  var btnEditar = document.getElementById('ficha-cat-btn-editar');
  var btnEliminar = document.getElementById('ficha-cat-btn-eliminar');
  if (btnEditar)  { btnEditar._id = s.id_servicio;  btnEditar.onclick = function() { cerrarModal('modal-ficha-cat'); abrirEditarCatalogo(this._id); };  btnEditar.style.display = puedo('CATALOGO','EDITAR') ? '' : 'none'; }
  if (btnEliminar){ btnEliminar._id = s.id_servicio; btnEliminar._nombre = s.nombre; btnEliminar.onclick = function() { cerrarModal('modal-ficha-cat'); eliminarCatalogo(this._id, this._nombre); }; btnEliminar.style.display = puedo('CATALOGO','ELIMINAR') ? '' : 'none'; }

  abrirModal('modal-ficha-cat');
  focusFirstField('modal-ficha-cat');
}

async function abrirNuevoCatalogo() {
  document.getElementById('cat-id').value = '';
  document.getElementById('cat-grupo').value = '';
  document.getElementById('cat-nombre').innerHTML = '<option value="">— Seleccionar servicio —</option>';
  document.getElementById('cat-descripcion').value = '';
  document.getElementById('cat-categoria').value = '';
  document.getElementById('cat-carroceria').value = '';
  document.getElementById('cat-precio').value = '';
  document.getElementById('cat-activo').value = 'true';
  // Poblar selector de moneda
  const catSel = document.getElementById('cat-moneda');
  if (catSel) {
    const mpC = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const msC = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const lblC = { VES:'Bolívar', USD:'Dólar', EUR:'Euro' };
    catSel.innerHTML = '<option value="'+mpC+'">'+mpC+' — '+(lblC[mpC]||mpC)+'</option>' +
      (msC !== mpC ? '<option value="'+msC+'">'+msC+' — '+(lblC[msC]||msC)+'</option>' : '');
    catSel.value = mpC;
  }
  document.getElementById('modal-cat-titulo').textContent = 'NUEVO SERVICIO';
  const btnElimCat = document.getElementById('cat-btn-eliminar');
  if (btnElimCat) btnElimCat.style.display = 'none';
  // Modo crear: input texto visible, select oculto
  const catNombreSelect = document.getElementById('cat-nombre');
  const catNombreInput  = document.getElementById('cat-nombre-nuevo');
  if (catNombreSelect) catNombreSelect.style.display = 'none';
  if (catNombreInput)  { catNombreInput.style.display = ''; catNombreInput.value = ''; }
  document.getElementById('alerta-cat-ok').style.display = 'none';
  document.getElementById('alerta-cat-err').style.display = 'none';
  await cargarGruposSelect();
  abrirModal('modal-catalogo');
  focusFirstField('modal-catalogo');
}

async function abrirEditarCatalogo(id) {
  const s = catalogoCache.find(function(x) { return x.id_servicio === parseInt(id); });
  console.log('[catalogo] abrirEditarCatalogo id:', id, '| s:', JSON.stringify(s));
  if (!s) return;
  document.getElementById('cat-id').value = s.id_servicio;
  document.getElementById('cat-descripcion').value = s.descripcion || '';
  document.getElementById('cat-categoria').value = s.categoria || '';
  document.getElementById('cat-carroceria').value = s.tipo_carroceria || '';
  document.getElementById('cat-precio').value = s.precio_usd ? fmtBs(s.precio_usd) : '';
  const catSelE = document.getElementById('cat-moneda');
  if (catSelE) {
    const mpE = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const msE = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const lblE = { VES:'Bolívar', USD:'Dólar', EUR:'Euro' };
    catSelE.innerHTML = '<option value="'+mpE+'">'+mpE+' — '+(lblE[mpE]||mpE)+'</option>' +
      (msE !== mpE ? '<option value="'+msE+'">'+msE+' — '+(lblE[msE]||msE)+'</option>' : '');
    catSelE.value = s.moneda_precio || mpE;
  }
  document.getElementById('cat-activo').value = s.activo ? 'true' : 'false';
  document.getElementById('modal-cat-titulo').textContent = 'EDITAR SERVICIO';
  // Modo editar: select visible, input oculto
  const catNombreSel2 = document.getElementById('cat-nombre');
  const catNombreInp2 = document.getElementById('cat-nombre-nuevo');
  if (catNombreSel2) catNombreSel2.style.display = '';
  if (catNombreInp2) catNombreInp2.style.display = 'none';
  const btnElimCatE = document.getElementById('cat-btn-eliminar');
  if (btnElimCatE) { btnElimCatE.style.display = ''; window._catServicioId = s.id_servicio; }
  document.getElementById('alerta-cat-ok').style.display = 'none';
  document.getElementById('alerta-cat-err').style.display = 'none';
  await cargarGruposSelect(s.grupo || '');
  // Asignar grupo explícitamente después de cargar las opciones
  if (s.grupo) {
    const selGrupo = document.getElementById('cat-grupo');
    if (selGrupo) selGrupo.value = s.grupo;
    console.log('[catalogo] s.grupo:', JSON.stringify(s.grupo), '| selGrupo.value después:', selGrupo?.value, '| opciones:', Array.from(selGrupo?.options||[]).map(o=>o.value));
  }
  // Cargar servicios usando el grupo del servicio directamente (no del select)
  const grupoParaCargar = s.grupo || document.getElementById('cat-grupo')?.value || '';
  console.log('[catalogo] grupoParaCargar:', JSON.stringify(grupoParaCargar));
  await cargarServiciosSelect(grupoParaCargar, s.nombre);
  abrirModal('modal-catalogo');
  focusFirstField('modal-catalogo');
}

async function eliminarServicioCat() {
  const id = window._catServicioId;
  if (!id) return;
  const nombre = document.getElementById('cat-nombre')?.value || 'este servicio';
  // Verificar si tiene OS asociadas
  try {
    const os = await api('os_servicios','GET',null,'?id_servicio=eq.'+id+'&select=id_os_serv&limit=1');
    if (os.length > 0) {
      alert('No se puede eliminar "'+nombre+'" porque tiene Órdenes de Servicio asociadas.');
      return;
    }
  } catch(e) {}
  if (!confirm('¿Eliminar el servicio "'+nombre+'"? Esta acción no se puede deshacer.')) return;
  try {
    await api('servicios_catalogo','DELETE',null,'?id_servicio=eq.'+id);
    cerrarModal('modal-catalogo');
    renderCatalogo();
  } catch(e) { alert('Error al eliminar: '+e.message); }
}

async function guardarCatalogo() {
  const id = document.getElementById('cat-id').value;
  if (id && !puedo('CATALOGO','EDITAR')) { alert('No tiene permiso para editar servicios.'); return; }
  if (!id && !puedo('CATALOGO','CREAR')) { alert('No tiene permiso para crear servicios.'); return; }
  const grupo       = (document.getElementById('cat-grupo')?.value || '').trim();
  const esNuevo    = document.getElementById('cat-id').value === '';
  const nombre     = esNuevo
    ? (document.getElementById('cat-nombre-nuevo')?.value || '').trim()
    : document.getElementById('cat-nombre').value.trim();
  const desc       = document.getElementById('cat-descripcion').value.trim();
  const cat        = document.getElementById('cat-categoria').value.trim();
  const carroceria = document.getElementById('cat-carroceria').value.trim();
  const precioRaw  = (document.getElementById('cat-precio').value || '0')
    .replace(/\./g, '').replace(',', '.');  // Limpiar formato venezolano
  const precio     = parseFloat(parseFloat(precioRaw).toFixed(2)) || 0;
  const monedaServ = document.getElementById('cat-moneda')?.value || ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
  const activo     = document.getElementById('cat-activo').value === 'true';
  const okEl       = document.getElementById('alerta-cat-ok');
  const errEl      = document.getElementById('alerta-cat-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!nombre) { errEl.textContent = 'El nombre del servicio es obligatorio.'; errEl.style.display = 'block'; return; }

  const nombreFinal = capitalizarNombre(nombre);
  const grupoFinal  = (grupo && grupo.trim() !== '') ? grupo.trim() : null;

  // Validar duplicado solo si es registro verdaderamente nuevo (sin id y sin match en caché del mismo grupo)
  if (!id) {
    const duplicado = catalogoCache.find(function(s) {
      return s.nombre.toLowerCase() === nombreFinal.toLowerCase()
        && (grupoFinal ? s.grupo === grupoFinal : true);
    });
    if (duplicado) {
      // Si ya existe, actualizar ese registro en lugar de crear uno nuevo
      const datos = { descripcion: desc || null, categoria: cat || null,
        tipo_carroceria: carroceria || null, precio_usd: precio,
        moneda_precio: monedaServ, activo,
        grupo: grupoFinal ?? duplicado.grupo,
        id_emisor: _empresaActiva?.id_emisor,
        id_usuario: sesionActual.correo_usuario };
      try {
        await api('servicios_catalogo', 'PATCH', datos, '?id_servicio=eq.' + duplicado.id_servicio);
        okEl.textContent = '✓ Servicio actualizado correctamente.'; okEl.style.display = 'block';
        setTimeout(function() { cerrarModal('modal-catalogo'); document.getElementById('contenido-principal').innerHTML=''; renderCatalogo(); }, 1000);
      } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
      return;
    }
  }

  try {
    // Si estamos editando y grupoFinal es null, preservar el grupo que ya tiene en BD
    const grupoParaGuardar = (id && grupoFinal === null)
      ? (catalogoCache.find(function(s){ return s.id_servicio === parseInt(id); })?.grupo ?? null)
      : grupoFinal;

    const datos = { nombre: nombreFinal, grupo: grupoParaGuardar, descripcion: desc || null, categoria: cat || null,
      tipo_carroceria: carroceria || null, precio_usd: precio, moneda_precio: monedaServ, activo,
      id_emisor: _empresaActiva?.id_emisor,
      id_usuario: sesionActual.correo_usuario };
    if (id) {
      await api('servicios_catalogo', 'PATCH', datos, '?id_servicio=eq.' + id);
    } else {
      await api('servicios_catalogo', 'POST', datos);
    }
    okEl.textContent = '✓ Servicio guardado.'; okEl.style.display = 'block';
    setTimeout(async function() {
      cerrarModal('modal-catalogo');
      // Si venimos de modal-servicios-cat, refrescar esa lista
      const modalServ = document.getElementById('modal-servicios-cat');
      if (modalServ && modalServ.classList.contains('activo')) {
        const grupo = document.getElementById('cat-grupo')?.value || '';
        await renderListaServicios(grupo);
      } else {
        // Limpiar caché para forzar recarga completa
        catalogoCache = [];
        gruposCatalogo = [];
        await renderCatalogo();
      }
    }, 1000);
  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
}

// ─── GESTIÓN DE SERVICIOS DEL CATÁLOGO ───
async function gestionarServiciosCatalogo() {
  try {
    catalogoCache = await api('servicios_catalogo', 'GET', null, '?order=grupo.asc,nombre.asc&select=*'+emisorQ());
  } catch(e) {}

  const grupoEl = document.getElementById('cat-grupo');
  const grupo   = grupoEl ? grupoEl.value : '';
  const titulo  = grupo ? 'SERVICIOS — ' + grupo : 'TODOS LOS SERVICIOS';
  document.getElementById('modal-servicios-cat-titulo').textContent = titulo;
  document.getElementById('nuevo-servicio-nombre').value = '';
  document.getElementById('msg-nuevo-servicio').style.display = 'none';
  await renderListaServicios(grupo);
  abrirModal('modal-servicios-cat');
  focusFirstField('modal-servicios-cat');
}

async function renderListaServicios(grupo) {
  const lista = document.getElementById('lista-servicios-cat');
  if (!lista) return;
  lista.innerHTML = '<div style="color:var(--suave);font-size:12px;padding:10px">Cargando...</div>';

  try {
    // Recargar desde Supabase para tener datos frescos
    let query = '?order=nombre.asc&select=*'+emisorQ();
    if (grupo) query += '&grupo=eq.' + encodeURIComponent(grupo);
    const servicios = await api('servicios_catalogo', 'GET', null, query);
    // Actualizar cache
    if (!grupo) catalogoCache = servicios;

    if (!servicios.length) {
      lista.innerHTML = '<div style="color:var(--suave);font-size:13px;text-align:center;padding:24px">'
        + (grupo ? 'Sin servicios en el grupo "' + grupo + '"' : 'Sin servicios registrados') + '</div>';
      return;
    }

    lista.innerHTML = servicios.map(function(s) {
      return '<div id="serv-row-' + s.id_servicio + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gris2);border-radius:6px;margin-bottom:8px">'
        + '<div style="flex:1">'
        + '<div style="font-size:14px;font-weight:600;color:var(--texto)">' + s.nombre + '</div>'
        + '<div style="font-size:11px;color:var(--suave);margin-top:2px">'
        + (s.grupo ? '<span style="color:var(--naranja)">' + s.grupo + '</span> · ' : '')
        + (s.categoria || 'Sin categoría') + ' · '
        + '<span style="font-family:var(--font-mono);color:var(--naranja)">'
        + (s.moneda_precio === 'VES'
            ? fmtBs(parseFloat(s.precio_usd||0)) + ' Bs'
            : fmtBs(parseFloat(s.precio_usd||0) * _tasaVigente) + ' Bs · $ ' + fmtUSD(s.precio_usd)
          )
        + '</span>'
        + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-shrink:0">'
        + '<button class="btn-secundario" onclick="editarServicioEnLinea(' + s.id_servicio + ')" style="font-size:11px;padding:5px 10px">✏️ Editar</button>'
        + '<button class="btn-peligro" onclick="eliminarServicioEnLinea(' + s.id_servicio + ',\'' + s.nombre.replace(/'/g, "\\'") + '\')" style="font-size:11px;padding:5px 10px">🗑</button>'
        + '</div></div>';
    }).join('');
  } catch(e) {
    lista.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

async function agregarServicioDesdeGestion() {
  const nombreRaw = document.getElementById('nuevo-servicio-nombre').value.trim();
  const nombre    = capitalizarNombre(nombreRaw);
  const grupo     = document.getElementById('cat-grupo').value || null;
  const msg       = document.getElementById('msg-nuevo-servicio');

  if (!nombre) {
    msg.innerHTML = '<span style="color:#fc8181">El nombre es obligatorio.</span>';
    msg.style.display = 'block'; return;
  }

  const existe = catalogoCache.find(function(s) { return s.nombre.toLowerCase() === nombre.toLowerCase(); });
  if (existe) {
    msg.innerHTML = '<span style="color:#fc8181">Ya existe un servicio con ese nombre.</span>';
    msg.style.display = 'block'; return;
  }

  try {
    await api('servicios_catalogo', 'POST', {
      nombre, grupo, precio_usd: 0, activo: true,
      id_usuario: sesionActual.correo_usuario
    });
    msg.innerHTML = '<span style="color:#68d391">✓ Servicio agregado.</span>';
    msg.style.display = 'block';
    document.getElementById('nuevo-servicio-nombre').value = '';

    const nuevos = await api('servicios_catalogo', 'GET', null, '?order=grupo.asc,nombre.asc&select=*'+emisorQ());
    catalogoCache = nuevos;
    await renderListaServicios(grupo);
    await cargarServiciosSelect(grupo, nombre);

    setTimeout(function() { msg.style.display = 'none'; }, 2000);
  } catch(e) {
    msg.innerHTML = '<span style="color:#fc8181">Error: ' + e.message + '</span>';
    msg.style.display = 'block';
  }
}

function editarServicioEnLinea(id) {
  const s = catalogoCache.find(function(x) { return x.id_servicio === parseInt(id); });
  if (!s) return;
  const row = document.getElementById('serv-row-' + id);
  if (!row) return;

  row.innerHTML = '<div style="flex:1;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<input type="text" id="edit-nombre-' + id + '" value="' + s.nombre + '" style="flex:1;min-width:140px;background:var(--gris3);border:1px solid var(--naranja);color:var(--texto);font-family:var(--font-body);font-size:13px;font-weight:600;padding:7px 10px;border-radius:5px;outline:none">'
    + '</div>'
    + '<div style="display:flex;gap:6px;flex-shrink:0">'
    + '<button class="btn-primario" onclick="guardarServicioEnLinea(' + id + ')" style="font-size:11px;padding:5px 10px">💾 Guardar</button>'
    + '<button class="btn-secundario" onclick="renderListaServicios(document.getElementById(\'cat-grupo\').value)" style="font-size:11px;padding:5px 10px">Retornar</button>'
    + '</div>';
}

async function guardarServicioEnLinea(id) {
  const nombre = capitalizarNombre(document.getElementById('edit-nombre-' + id).value.trim());
  if (!nombre) { alert('El nombre es obligatorio.'); return; }

  const existe = catalogoCache.find(function(s) { return s.nombre.toLowerCase() === nombre.toLowerCase() && s.id_servicio !== id; });
  if (existe) { alert('Ya existe un servicio con ese nombre.'); return; }

  try {
    await api('servicios_catalogo', 'PATCH', { nombre }, '?id_servicio=eq.' + id);
    const grupo = document.getElementById('cat-grupo') ? document.getElementById('cat-grupo').value || null : null;
    const nuevos = await api('servicios_catalogo', 'GET', null, '?order=grupo.asc,nombre.asc&select=*'+emisorQ());
    catalogoCache = nuevos;
    await renderListaServicios(grupo);
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarServicioEnLinea(id, nombre) {
  if (!confirm('¿Eliminar el servicio "' + nombre + '"?')) return;
  try {
    await api('servicios_catalogo', 'DELETE', null, '?id_servicio=eq.' + id);
    catalogoCache = catalogoCache.filter(function(s) { return s.id_servicio !== id; });
    const grupo = document.getElementById('cat-grupo').value || null;
    await renderListaServicios(grupo);
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── GESTIÓN DE GRUPOS DEL CATÁLOGO ───
let gruposCatalogo = [];

async function crearNuevoGrupo(selectEl) {
  const nombre = prompt('Nombre del nuevo grupo:');
  if (!nombre || !nombre.trim()) { selectEl.value = ''; return; }
  const nombreTrim = nombre.trim().toUpperCase();
  try {
    await api('param_grupos_servicio','POST',{
      nombre: nombreTrim,
      estado: 'ACTIVO',
      id_emisor: _empresaActiva?.id_emisor
    });
    await cargarGruposSelect(nombreTrim);
    cargarServiciosSelect(nombreTrim);
  } catch(e) { alert('Error al crear grupo: '+e.message); selectEl.value = ''; }
}

async function cargarGruposSelect(valorActual) {
  try {
    let unicos = [];
    // Intentar desde param_grupos_servicio (tabla con RLS)
    try {
      const res = await api('param_grupos_servicio', 'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre' + emisorQ());
      unicos = res.map(function(r) { return r.nombre; }).sort();
    } catch(e) {}
    // Fallback: grupos distintos del caché de servicios (siempre disponible)
    if (!unicos.length && catalogoCache.length) {
      const set = {};
      catalogoCache.forEach(function(s) { if (s.grupo) set[s.grupo] = true; });
      unicos = Object.keys(set).sort();
    }
    // Fallback 2: si el caché tampoco tiene, cargar servicios frescos
    if (!unicos.length) {
      try {
        const svcs = await api('servicios_catalogo', 'GET', null, '?order=grupo.asc&select=grupo' + emisorQ());
        const set = {};
        svcs.forEach(function(s) { if (s.grupo) set[s.grupo] = true; });
        unicos = Object.keys(set).sort();
      } catch(e2) {}
    }
    gruposCatalogo = unicos;
    const sel = document.getElementById('cat-grupo');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar Grupo —</option>'
      + unicos.map(function(g) {
          return '<option value="' + g + '"' + (g === valorActual ? ' selected' : '') + '>' + g + '</option>';
        }).join('');
    if (valorActual) sel.value = valorActual;
  } catch(e) { console.warn('cargarGruposSelect error:', e); }
}

function cargarDatosServicioSeleccionado(nombre) {
  if (!nombre) {
    // Limpiar campos
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-descripcion').value = '';
    document.getElementById('cat-categoria').value = '';
    document.getElementById('cat-carroceria').value = '';
    document.getElementById('cat-precio').value = '';
    document.getElementById('cat-activo').value = 'true';
    document.getElementById('modal-cat-titulo').textContent = 'NUEVO SERVICIO';
    return;
  }
  const s = catalogoCache.find(function(x) { return x.nombre === nombre; });
  if (!s) return;
  document.getElementById('cat-id').value = s.id_servicio;
  document.getElementById('cat-descripcion').value = s.descripcion || '';
  document.getElementById('cat-categoria').value = s.categoria || '';
  document.getElementById('cat-carroceria').value = s.tipo_carroceria || '';
  document.getElementById('cat-precio').value = s.precio_usd ? fmtBs(s.precio_usd) : '';
  const catSelE = document.getElementById('cat-moneda');
  if (catSelE) {
    const mpE = ((_empresaActiva?.moneda_principal)||'VES').toUpperCase();
    const msE = ((_empresaActiva?.moneda_secundaria)||'USD').toUpperCase();
    const lblE = { VES:'Bolívar', USD:'Dólar', EUR:'Euro' };
    catSelE.innerHTML = '<option value="'+mpE+'">'+mpE+' — '+(lblE[mpE]||mpE)+'</option>' +
      (msE !== mpE ? '<option value="'+msE+'">'+msE+' — '+(lblE[msE]||msE)+'</option>' : '');
    catSelE.value = s.moneda_precio || mpE;
  }
  document.getElementById('cat-activo').value = s.activo ? 'true' : 'false';
  document.getElementById('modal-cat-titulo').textContent = 'EDITAR SERVICIO';
  // Modo editar: select visible, input oculto
  const catNombreSel2 = document.getElementById('cat-nombre');
  const catNombreInp2 = document.getElementById('cat-nombre-nuevo');
  if (catNombreSel2) catNombreSel2.style.display = '';
  if (catNombreInp2) catNombreInp2.style.display = 'none';
  const btnElimCatE = document.getElementById('cat-btn-eliminar');
  if (btnElimCatE) { btnElimCatE.style.display = ''; window._catServicioId = s.id_servicio; }
}

async function cargarServiciosSelect(grupo, valorActual) {
  const sel = document.getElementById('cat-nombre');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar servicio —</option>';
  if (!grupo) { console.warn('[catalogo] cargarServiciosSelect: grupo vacío'); return; }
  try {
    const query = '?grupo=eq.' + encodeURIComponent(grupo) + '&order=nombre.asc&select=id_servicio,nombre,activo' + emisorQ();
    console.log('[catalogo] cargarServiciosSelect grupo:', grupo, '| valorActual:', valorActual, '| query:', query);
    const servicios = await api('servicios_catalogo', 'GET', null, query);
    console.log('[catalogo] servicios retornados:', servicios);
    servicios.forEach(function(s) {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = s.nombre + (s.activo ? '' : ' (inactivo)');
      sel.appendChild(opt);
    });
    if (valorActual) {
      sel.value = valorActual;
      console.log('[catalogo] sel.value después de asignar:', sel.value, '| opciones:', Array.from(sel.options).map(o=>o.value));
      if (!sel.value) {
        const match = Array.from(sel.options).find(function(o) {
          return o.value.trim().toLowerCase() === valorActual.trim().toLowerCase();
        });
        if (match) sel.value = match.value;
        console.log('[catalogo] fallback match:', match?.value);
      }
    }
  } catch(e) { console.warn('cargarServiciosSelect error:', e); }
}

function gestionarGruposCatalogo() {
  renderListaGrupos();
  abrirModal('modal-grupos-cat');
  focusFirstField('modal-grupos-cat');
}

function renderListaGrupos() {
  const lista = document.getElementById('lista-grupos-cat');
  if (!lista) return;
  if (!gruposCatalogo.length) {
    lista.innerHTML = '<div style="color:var(--suave);font-size:13px;text-align:center;padding:20px">Sin grupos registrados</div>';
    return;
  }
  lista.innerHTML = gruposCatalogo.map(function(g) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--gris2);border-radius:6px;margin-bottom:8px">'
      + '<span style="font-size:14px;font-weight:600;color:var(--texto)">' + g + '</span>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn-secundario" onclick="editarGrupoCatalogo(\'' + g + '\')" style="font-size:11px;padding:5px 10px">✏️ Editar</button>'
      + '<button class="btn-peligro" onclick="eliminarGrupoCatalogo(\'' + g + '\')" style="font-size:11px;padding:5px 10px">🗑 Eliminar</button>'
      + '</div></div>';
  }).join('');
}

async function agregarGrupoCatalogo() {
  const input = document.getElementById('nuevo-grupo-cat');
  const nombre = input.value.trim().toUpperCase();
  if (!nombre) return;

  if (gruposCatalogo.includes(nombre)) {
    alert('Ya existe un grupo con ese nombre.');
    return;
  }

  // Guardar en param_grupos_servicio
  try {
    await api('param_grupos_servicio','POST',{
      nombre: nombre,
      estado: 'ACTIVO',
      id_emisor: _empresaActiva?.id_emisor
    });
  } catch(e) {
    alert('Error al guardar grupo: ' + e.message);
    return;
  }

  gruposCatalogo.push(nombre);
  gruposCatalogo.sort();
  input.value = '';
  renderListaGrupos();

  // Actualizar el select del modal principal
  const sel = document.getElementById('cat-grupo');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = nombre; opt.textContent = nombre;
    sel.appendChild(opt);
    sel.value = nombre;
  }
}

async function editarGrupoCatalogo(grupoActual) {
  const nuevoNombre = prompt('Nuevo nombre para el grupo "' + grupoActual + '":', grupoActual);
  if (!nuevoNombre || nuevoNombre.trim() === grupoActual) return;
  const nuevo = nuevoNombre.trim().toUpperCase();

  if (gruposCatalogo.includes(nuevo)) { alert('Ya existe un grupo con ese nombre.'); return; }

  try {
    // Actualizar todos los servicios de ese grupo
    await api('servicios_catalogo', 'PATCH', { grupo: nuevo }, '?grupo=eq.' + encodeURIComponent(grupoActual));
    gruposCatalogo = gruposCatalogo.map(function(g) { return g === grupoActual ? nuevo : g; }).sort();
    renderListaGrupos();
    await cargarGruposSelect(nuevo);
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarGrupoCatalogo(grupo) {
  const count = catalogoCache.filter(function(s) { return s.grupo === grupo; }).length;
  if (!confirm('¿Eliminar el grupo "' + grupo + '"?' + (count > 0 ? '\n' + count + ' servicio(s) quedarán sin grupo.' : ''))) return;
  try {
    await api('servicios_catalogo', 'PATCH', { grupo: null }, '?grupo=eq.' + encodeURIComponent(grupo));
    await api('param_grupos_servicio', 'DELETE', null, '?nombre=eq.' + encodeURIComponent(grupo) + '&id_emisor=eq.' + (_empresaActiva?.id_emisor||0));
    gruposCatalogo = gruposCatalogo.filter(function(g) { return g !== grupo; });
    renderListaGrupos();
    await cargarGruposSelect();
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarCatalogo(id, nombre) {
  if (!puedo('CATALOGO','ELIMINAR')) { alert('No tiene permiso para eliminar servicios.'); return; }
  if (!confirm('¿Eliminar "' + nombre + '"?')) return;
  try {
    await api('servicios_catalogo', 'DELETE', null, '?id_servicio=eq.' + id);
    document.getElementById('contenido-principal').innerHTML='';
    renderCatalogo();
  } catch(e) { alert('Error: ' + e.message); }
}


