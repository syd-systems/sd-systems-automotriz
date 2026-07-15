// ─── S&D Systems — Módulo: PARAMETROS ───
// ══════════════════════════════════════════════════════════════
//  MÓDULO PARÁMETROS DEL SISTEMA — TABLAS MAESTRAS
// ══════════════════════════════════════════════════════════════

// Definición de todas las tablas maestras
const TABLAS_MAESTRAS = [
  { key: 'areas',              tabla: 'param_areas',   pk: 'id',              nombre: 'Áreas',                  icono: '🏢', tieneCodigo: true,  tieneArea: false, tieneAreaPadre: true },
  { key: 'cargos',             tabla: 'param_cargos',   pk: 'id',             nombre: 'Cargos',                 icono: '👔', tieneCodigo: false, tieneArea: true  },
  { key: 'tipos_contrato',     tabla: 'param_tipos_contrato',   pk: 'id',     nombre: 'Tipos de Contrato',      icono: '📄', tieneCodigo: false, tieneArea: false },
  { key: 'tipos_salario',      tabla: 'param_tipos_salario',   pk: 'id',      nombre: 'Tipos de Salario',       icono: '💰', tieneCodigo: false, tieneArea: false },
  { key: 'calculos_salario',   tabla: 'param_calculos_salario',   pk: 'id',   nombre: 'Cálculo del Salario',    icono: '🧮', tieneCodigo: false, tieneArea: false, tieneDescripcion: true },
  { key: 'frecuencias_pago',   tabla: 'param_frecuencias_pago',   pk: 'id',   nombre: 'Frecuencias de Pago',    icono: '📅', tieneCodigo: false, tieneArea: false },
  { key: 'niveles_educativos', tabla: 'param_niveles_educativos',   pk: 'id', nombre: 'Niveles Educativos',     icono: '🎓', tieneCodigo: false, tieneArea: false },
  { key: 'estados_civiles',    tabla: 'param_estados_civiles',   pk: 'id',    nombre: 'Estados Civiles',        icono: '💍', tieneCodigo: false, tieneArea: false },
  { key: 'sexos',              tabla: 'param_sexos',   pk: 'id',              nombre: 'Sexos',                  icono: '⚧',  tieneCodigo: false, tieneArea: false },
  { key: 'cat_prov', tabla: 'param_categorias_proveedor', pk: 'id', nombre: 'Categorías de Proveedores', icono: '🏷', tieneCodigo: true, tieneEstado: true },
  { key: 'bancos',             tabla: 'param_bancos',   pk: 'id',             nombre: 'Instituciones Financieras', icono: '🏦', tieneCodigo: true,  tieneArea: false, tieneTipoSector: true },
  { key: 'niveles_jerarquicos', tabla: 'param_niveles_jerarquicos', pk: 'id_jerarquicos', nombre: 'Niveles Jerárquicos', icono: '🏅', tieneCodigo: false, tieneArea: false, tieneDescripcion: true, campoNombre: 'nivel_jerarquicos', campoDescripcion: 'descripcion_jerarquicos' },
  { key: 'metodos_pago', tabla: 'param_metodos_pago', pk: 'id_metodo', nombre: 'Métodos de Pago', icono: '💳', tieneMoneda: true, tieneCuentaContable: true, tieneTipoCanal: true },
];

// Cache de áreas para el selector de cargos
let _paramAreasCache = [];

async function renderParametros() {
  if (!sesionActual?.administrador) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Este módulo es exclusivo para Administradores del Sistema.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando parámetros...</div>';

  // Cargar áreas para el selector de cargos
  try {
    _paramAreasCache = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc');
  } catch(e) { _paramAreasCache = []; }

  // Construir UI con tabs para cada tabla
  c.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>⚙️ Parámetros del Sistema — Tablas Maestras</h3>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:16px 24px;border-bottom:1px solid var(--borde);background:var(--gris2)">
        ${TABLAS_MAESTRAS.map(function(t) {
          return '<button class="param-tab btn-secundario" id="tab-' + t.key + '" onclick="mostrarTablaParam(\'' + t.key + '\')" style="font-size:12px">'
            + t.icono + ' ' + t.nombre + '</button>';
        }).join('')}
      </div>
      <div id="param-tabla-cont" style="padding:24px">
        <div style="color:var(--suave);font-size:13px;text-align:center;padding:32px">
          Selecciona una tabla para gestionar
        </div>
      </div>
    </div>`;

  // Mostrar primera tabla por defecto
  mostrarTablaParam('areas');
}

// Tab activo actual
var _paramTabActivo = null;

async function mostrarTablaParam(key) {
  _paramTabActivo = key;
  const def = TABLAS_MAESTRAS.find(function(t) { return t.key === key; });
  if (!def) return;

  // Resaltar tab activo
  document.querySelectorAll('.param-tab').forEach(function(b) {
    b.style.background = '';
    b.style.color = '';
    b.style.borderColor = '';
  });
  const tabBtn = document.getElementById('tab-' + key);
  if (tabBtn) {
    tabBtn.style.background = 'var(--naranja)';
    tabBtn.style.color = '#fff';
    tabBtn.style.borderColor = 'var(--naranja)';
  }

  const cont = document.getElementById('param-tabla-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
  try {

    var orderCampo = key === 'areas' ? 'codigo.asc,nombre.asc' : ((def.campoNombre || 'nombre') + '.asc');
    var query = key === 'areas' ? '?order=codigo.asc,nombre.asc&select=*' : '?order=' + orderCampo + '&select=*';
    var items = await api(def.tabla, 'GET', null, query);

    // Para Cargos: ordenar por código jerárquico del área
    if (key === 'cargos') {
      // Asegurar que tenemos las áreas cargadas con sus códigos
      if (!_paramAreasCache.length) {
        try { _paramAreasCache = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}
      }
      var areaCodigoMap = {};
      _paramAreasCache.forEach(function(a) { areaCodigoMap[a.id] = a.codigo || '999'; });
      items = items.slice().sort(function(a, b) {
        // Ordenar por código de área (jerárquico) y luego por nombre del cargo
        var codA = areaCodigoMap[a.id_area] || '999';
        var codB = areaCodigoMap[b.id_area] || '999';
        // Comparación numérica por segmentos del código (01 < 01.01 < 01.01.01)
        var segsA = codA.split('.').map(Number);
        var segsB = codB.split('.').map(Number);
        var maxLen = Math.max(segsA.length, segsB.length);
        for (var i = 0; i < maxLen; i++) {
          var sa = segsA[i] !== undefined ? segsA[i] : -1;
          var sb = segsB[i] !== undefined ? segsB[i] : -1;
          if (sa !== sb) return sa - sb;
        }
        return a.nombre.localeCompare(b.nombre);
      });
    }

    // Mapa de áreas para cargos y para área padre
    var areasMap = {};
    if (def.tieneArea || def.tieneAreaPadre) {
      _paramAreasCache.forEach(function(a) { areasMap[a.id] = a; });
      if (key === 'areas') items.forEach(function(a) { areasMap[a.id] = a; });
    }

    var filas = '';
    if (key === 'areas') {
      items.forEach(function(item) {
        var nivel = item.codigo ? item.codigo.split('.').length - 1 : 0;
        var indent = nivel > 0 ? 'padding-left:' + (nivel * 20 + 12) + 'px' : 'padding-left:12px';
        var padre = item.id_area_padre ? areasMap[item.id_area_padre] : null;
        filas += '<tr>'
          + '<td style="font-family:var(--font-mono);font-size:12px;color:var(--naranja);white-space:nowrap;padding:10px 12px">' + (item.codigo || '—') + '</td>'
          + '<td style="' + indent + ';font-size:13px;font-weight:' + (nivel === 0 ? '600' : '400') + '">'
          + (nivel > 0 ? '<span style="color:var(--borde);margin-right:4px">└</span>' : '')
          + item.nombre + '</td>'
          + '<td style="font-size:11px;color:var(--suave)">' + (padre ? '<span style="font-family:var(--font-mono);color:var(--suave)">' + padre.codigo + '</span> ' + padre.nombre : '—') + '</td>'
          + '<td><span class="badge ' + (item.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (item.estado || 'ACTIVO') + '</span></td>'
          + '<td><div style="display:flex;gap:6px">'
          + (puedo('PARAMETROS','EDITAR') ? '<button class="btn-naranja" onclick="abrirParamItem(\'' + key + '\',' + item[def.pk] + ')" style="font-size:11px;padding:5px 10px">Ver</button>' : '')
          + '</div></td>'
          + '</tr>';
      });
    } else {
      // Build categorias map for inv_articulos_tipo
      var catsMap = {};
      if (def.tieneCategoria) {
        try {
          const cats = await api('inv_categorias','GET',null,'?estado=eq.ACTIVO&select=id,nombre,codigo');
          cats.forEach(function(c){ catsMap[c.id] = c; });
        } catch(e) {}
      }
      filas = items.map(function(item) {
        const cat = def.tieneCategoria && item.id_categoria ? catsMap[item.id_categoria] : null;
        const nombreMostrar = item[def.campoNombre || 'nombre'] || item.nombre || '—';
        const descMostrar   = def.tieneDescripcion ? (item[def.campoDescripcion || 'descripcion'] || item.descripcion || '') : '';
        return '<tr>'
          + '<td style="font-size:13px;font-weight:500">' + (item.codigo ? '<span style="font-family:var(--font-mono);color:var(--naranja);margin-right:8px">' + item.codigo + '</span>' : '') + nombreMostrar + (descMostrar ? '<div style="font-size:11px;color:var(--suave);margin-top:2px">' + descMostrar + '</div>' : '') + '</td>'
          + (def.tieneArea ? '<td style="font-size:12px;color:var(--suave)">' + (areasMap[item.id_area] ? areasMap[item.id_area].nombre : '—') + '</td>' : '')
          + (def.tieneTipoSector ? '<td style="font-size:12px;color:var(--suave)">' + (item.tipo_sector || '—') + '</td>' : '')
          + (def.tieneTipoCanal ? '<td style="font-size:12px;color:var(--suave)">' + (item.tipo_canal || '—') + '</td>' : '')
          + (def.tieneCategoria ? '<td style="font-size:12px;color:var(--suave)">' + (cat ? (cat.codigo?cat.codigo+' — ':'')+cat.nombre : '—') + '</td>' : '')
          + (def.tieneCuentaContable ? '<td style="font-size:12px;color:var(--suave)">' + (item.id_cuenta_contable ? '— cuenta asignada —' : '—') + '</td>' : '')
          + '<td><span class="badge ' + (item.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (item.estado || 'ACTIVO') + '</span></td>'
          + '<td><div style="display:flex;gap:6px">'
          + (puedo('PARAMETROS','EDITAR') ? '<button class="btn-naranja" onclick="abrirParamItem(\'' + key + '\',' + item[def.pk] + ')" style="font-size:11px;padding:5px 10px">Ver</button>' : '')
          + '</div></td>'
          + '</tr>';
      }).join('');
    }

    var thead = key === 'areas'
      ? '<th style="width:100px">Código</th><th>Nombre</th><th>Nivel Superior</th><th>Estado</th><th>Acción</th>'
      : (def.tieneCodigo ? '<th>Código · Nombre</th>' : (def.tieneMoneda ? '<th>Moneda · Nombre</th>' : '<th>Nombre</th>')) + (def.tieneArea ? '<th>Área</th>' : '') + (def.tieneTipoSector ? '<th>Tipo / Sector</th>' : '') + (def.tieneTipoCanal ? '<th>Tipo de Canal</th>' : '') + (def.tieneCategoria ? '<th>Categoría</th>' : '') + (def.tieneCuentaContable ? '<th>Cuenta Contable</th>' : '') + '<th>Estado</th><th>Acción</th>';
    var colspan = key === 'areas' ? 5 : (2 + (def.tieneArea?1:0) + (def.tieneTipoSector?1:0));

    cont.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<div style="font-family:var(--font-display);font-size:20px;letter-spacing:1px">' + def.icono + ' ' + def.nombre + ' <span style="font-size:14px;color:var(--suave)">(' + items.length + ')</span></div>'
      + (puedo('PARAMETROS','EDITAR') ? '<button class="btn-primario" onclick="abrirParamItem(\'' + key + '\',null)" style="font-size:12px">+ Nuevo</button>' : '')
      + '</div>'
      + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>' + thead + '</tr></thead><tbody>'
      + (filas || '<tr><td colspan="' + colspan + '" style="text-align:center;padding:32px;color:var(--suave)">Sin registros</td></tr>')
      + '</tbody></table></div>';

  } catch(e) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

async function abrirParamItem(key, id) {
  if (!puedo('PARAMETROS','VER') && !puedo('PARAMETROS','EDITAR')) { alert('No tiene permiso.'); return; }
  const def = TABLAS_MAESTRAS.find(function(t) { return t.key === key; });
  if (!def) return;

  let item = null;
  if (id) {
    try {
      const res = await api(def.tabla, 'GET', null, '?' + def.pk + '=eq.' + parseInt(id));
      item = res[0] || null;
    } catch(e) {}
  }

  // Cargar áreas para selector de área padre (solo en áreas)
  var todasAreas = [];
  if (def.tieneAreaPadre) {
    try { todasAreas = await api('param_areas', 'GET', null, '?order=codigo.asc,nombre.asc&select=*'); } catch(e) {}
  }

  // Construir formulario dinámico
  var camposHTML = '';

  // Área: código + nombre + área padre
  if (key === 'areas') {
    camposHTML += '<div class="form-campo"><label>Código Jerárquico</label><input type="text" id="param-item-codigo" value="' + (item ? (item.codigo||'') : '') + '" placeholder="Ej: 01 / 01.01 / 01.01.01" style="font-family:var(--font-mono)"></div>';
    camposHTML += '<div class="form-campo form-full"><label>Nombre del Área</label><input type="text" id="param-item-nombre" value="' + (item ? item.nombre : '') + '" placeholder="Nombre del área"></div>';
    var opcPadre = todasAreas.filter(function(a) { return !item || a.id !== item.id; }).map(function(a) {
      return '<option value="' + a.id + '"' + (item && item.id_area_padre === a.id ? ' selected' : '') + '>'
        + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
    }).join('');
    camposHTML += '<div class="form-campo form-full"><label>Nivel Superior</label>'
      + '<select id="param-item-area-padre" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
      + '<option value="">— Sin área padre (nivel raíz) —</option>' + opcPadre + '</select></div>';
  } else {
    if (def.tieneCodigo) {
      camposHTML += '<div class="form-campo form-full"><label>Código</label><input type="text" id="param-item-codigo" value="' + (item ? (item.codigo||'') : '') + '" placeholder="Ej: 0102" style="text-transform:uppercase"></div>';
    }
    if (def.tieneMoneda) {
      camposHTML += '<div class="form-campo form-full"><label>Moneda *</label><select id="param-item-moneda" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
        + '<option value="">— Seleccione Moneda —</option>'
        + '<option value="USD"' + (item && item.codigo === 'USD' ? ' selected' : '') + '>USD — Dólar</option>'
        + '<option value="VES"' + (item && item.codigo === 'VES' ? ' selected' : '') + '>VES — Bolívar</option>'
        + '<option value="EUR"' + (item && item.codigo === 'EUR' ? ' selected' : '') + '>EUR — Euro</option>'
        + '</select></div>';
    }
    camposHTML += '<div class="form-campo form-full"><label>' + (def.campoNombre ? 'Nivel' : 'Nombre') + '</label><input type="text" id="param-item-nombre" value="' + (item ? (item[def.campoNombre||'nombre']||'') : '') + '" placeholder="' + (def.campoNombre ? 'Nombre del nivel jerárquico' : 'Nombre del registro') + '"></div>';
    if (def.tieneDescripcion) {
      camposHTML += '<div class="form-campo form-full"><label>Descripción</label><textarea id="param-item-descripcion" placeholder="Descripción opcional..." style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:10px 14px;border-radius:5px;outline:none;resize:vertical;min-height:70px;width:100%">' + (item ? (item[def.campoDescripcion||'descripcion']||'') : '') + '</textarea></div>';
    }
    if (def.tieneTipoSector) {
      camposHTML += '<div class="form-campo form-full"><label>Tipo / Sector</label><select id="param-item-tipo-sector" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
        + '<option value="">— Seleccionar —</option>'
        + '<option value="PÚBLICO"'    + (item && item.tipo_sector === 'PÚBLICO'    ? ' selected' : '') + '>Público</option>'
        + '<option value="PRIVADO"'    + (item && item.tipo_sector === 'PRIVADO'    ? ' selected' : '') + '>Privado</option>'
        + '<option value="MICROFINANCIERO"' + (item && item.tipo_sector === 'MICROFINANCIERO' ? ' selected' : '') + '>Microfinanciero</option>'
        + '<option value="EXTRANJERO"' + (item && item.tipo_sector === 'EXTRANJERO' ? ' selected' : '') + '>Extranjero</option>'
        + '</select></div>';
    }
    if (def.tieneTipoCanal) {
      camposHTML += '<div class="form-campo form-full"><label>Tipo de Canal *</label><select id="param-item-tipo-canal" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%">'
        + '<option value="">— Seleccionar —</option>'
        + '<option value="EFECTIVO"'     + (item && item.tipo_canal === 'EFECTIVO'     ? ' selected' : '') + '>Efectivo</option>'
        + '<option value="TRANSFERENCIA"'+ (item && item.tipo_canal === 'TRANSFERENCIA'? ' selected' : '') + '>Transferencia (permite elegir Cuenta Bancaria o Pago Móvil del proveedor)</option>'
        + '<option value="OTRO"'         + (item && item.tipo_canal === 'OTRO'         ? ' selected' : '') + '>Otro (ej. Afiliación Bancaria — no muestra info del proveedor)</option>'
        + '</select></div>';
    }
    if (def.tieneArea) {
      const opcAreas = _paramAreasCache.map(function(a) {
        return '<option value="' + a.id + '"' + (item && item.id_area === a.id ? ' selected' : '') + '>' + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
      }).join('');
      camposHTML += '<div class="form-campo form-full"><label>Área</label><select id="param-item-area" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="">— Sin área —</option>' + opcAreas + '</select></div>';
    }
    if (def.tieneCategoria) {
      var opcCats = [];
      try {
        const cats = await api('inv_categorias','GET',null,'?estado=eq.ACTIVO&order=nombre.asc' + (_empresaActiva ? '&id_empresa=eq.'+_empresaActiva.id_empresa : ''));
        opcCats = cats.map(function(c) {
          return '<option value="' + c.id + '"' + (item && item.id_categoria === c.id ? ' selected' : '') + '>' + (c.codigo ? c.codigo + ' — ' : '') + c.nombre + '</option>';
        });
      } catch(e) {}
      camposHTML += '<div class="form-campo form-full"><label>Categoría *</label><select id="param-item-categoria" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="">— Seleccionar categoría —</option>' + opcCats.join('') + '</select></div>';
    }
    if (def.tieneCuentaContable) {
      var opcCuentas = [];
      try {
        const ctas = await api('cont_cuentas','GET',null,'?codigo=ilike.1.1.01%25&estado=eq.ACTIVA&permite_movimiento=eq.true&order=codigo.asc&select=id_cuenta,codigo,nombre');
        opcCuentas = ctas.map(function(c) {
          return '<option value="' + c.id_cuenta + '"' + (item && item.id_cuenta_contable == c.id_cuenta ? ' selected' : '') + '>' + c.codigo + ' — ' + c.nombre + '</option>';
        });
      } catch(e) {}
      camposHTML += '<div class="form-campo form-full"><label>Cuenta Contable *</label><select id="param-item-cuenta-contable" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="">— Seleccionar cuenta —</option>' + opcCuentas.join('') + '</select></div>';
    }
  }
  camposHTML += '<div class="form-campo form-full"><label>Estado</label><select id="param-item-estado" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:13px;padding:11px 14px;border-radius:5px;outline:none;width:100%"><option value="ACTIVO"' + (!item || item.estado==='ACTIVO' ? ' selected' : '') + '>Activo</option><option value="INACTIVO"' + (item && item.estado==='INACTIVO' ? ' selected' : '') + '>Inactivo</option></select></div>';

  document.getElementById('modal-param-titulo').textContent = (id ? 'EDITAR' : 'NUEVO') + ' — ' + def.nombre.toUpperCase();
  document.getElementById('modal-param-footer-alertas').innerHTML =
    '<div class="alerta alerta-exito" id="alerta-param-ok" style="margin:0"></div>'
    + '<div class="alerta alerta-error" id="alerta-param-err" style="margin:0"></div>';
  document.getElementById('modal-param-body').innerHTML = ''
    + '<div class="form-grid">' + camposHTML + '</div>'
    + '<input type="hidden" id="param-item-id" value="' + (id||'') + '">'
    + '<input type="hidden" id="param-item-key" value="' + key + '">';

  document.getElementById('modal-param-guardar').onclick = function() { guardarParamItem(); };
  // Guardar key/id para eliminarParamItem
  window._paramKey = key;
  window._paramId  = id;
  const btnElimP = document.getElementById('modal-param-eliminar');
  const btnGuardP = document.getElementById('modal-param-guardar');
  if (btnElimP) btnElimP.style.display = (id && puedo('PARAMETROS','EDITAR')) ? '' : 'none';
  if (btnGuardP) btnGuardP.style.display = puedo('PARAMETROS','EDITAR') ? '' : 'none';
  const btnGR = document.getElementById('modal-param-guardar'); if (btnGR) { btnGR.disabled = false; btnGR.textContent = 'GUARDAR'; }
  abrirModal('modal-param');
  focusFirstField('modal-param');
  setTimeout(function() {
    var primerCampo = (def.tieneCodigo || key === 'areas')
      ? document.getElementById('param-item-codigo')
      : document.getElementById('param-item-nombre');
    if (primerCampo) primerCampo.focus();
  }, 100);
}

async function guardarParamItem() {
  if (!puedo('PARAMETROS','EDITAR')) { alert('No tiene permiso.'); return; }
  const btnGuardar = document.getElementById('modal-param-guardar');
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...'; }
  const resetBtn = function() {
    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'GUARDAR'; }
  };
  const id    = document.getElementById('param-item-id').value;
  const key   = document.getElementById('param-item-key').value;
  const nombre = document.getElementById('param-item-nombre')?.value.trim();
  const estado = document.getElementById('param-item-estado')?.value || 'ACTIVO';
  const okEl  = document.getElementById('alerta-param-ok');
  const errEl = document.getElementById('alerta-param-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }

  // Validar cuenta contable si aplica
  const defCheck = TABLAS_MAESTRAS.find(function(t) { return t.key === key; });
  if (defCheck?.tieneCuentaContable && !document.getElementById('param-item-cuenta-contable')?.value) {
    errEl.textContent = 'La Cuenta Contable es obligatoria.'; errEl.style.display = 'block'; resetBtn(); return;
  }
  if (defCheck?.tieneMoneda && !document.getElementById('param-item-moneda')?.value) {
    errEl.textContent = 'La Moneda es obligatoria.'; errEl.style.display = 'block'; resetBtn(); return;
  }
  if (defCheck?.tieneTipoCanal && !document.getElementById('param-item-tipo-canal')?.value) {
    errEl.textContent = 'El Tipo de Canal es obligatorio.'; errEl.style.display = 'block'; resetBtn(); return;
  }

  // Categorias e inv_articulos_tipo no estan en TABLAS_MAESTRAS
  if (key === 'inv_categorias' || key === 'inv_articulos_tipo') {
    const tabla = key === 'inv_categorias' ? 'inv_categorias' : 'inv_articulos_tipo';
    const datos2 = { nombre, estado };
    const descEl = document.getElementById('param-item-descripcion');
    if (descEl) datos2.descripcion = descEl.value.trim() || null;
    const codEl = document.getElementById('param-item-codigo');
    if (codEl) datos2.codigo = codEl.value.trim().toUpperCase() || null;
    if (!id) datos2.id_empresa = _empresaActiva?.id_empresa || null;
    try {
      if (id) await api(tabla,'PATCH',datos2,'?id=eq.'+id);
      else    await api(tabla,'POST',datos2);
      okEl.style.display = 'block'; okEl.textContent = id ? '✓ Actualizado.' : '✓ Creado.';
      _empParamCache = {}; _paramAreasCache = [];
      resetBtn();
      await new Promise(function(r){ setTimeout(r,300); });
      cerrarModal('modal-param');
      if (key === 'inv_categorias' && typeof invRenderCategorias === 'function') invRenderCategorias();
      if (key === 'inv_articulos_tipo' && typeof invRenderTipos === 'function') invRenderTipos();
    } catch(e2) { errEl.textContent = 'Error: '+e2.message; errEl.style.display='block'; resetBtn(); }
    return;
  }
  const def = TABLAS_MAESTRAS.find(function(t) { return t.key === key; });

  // ── Validar código obligatorio y único para áreas ──
  const codigo = (def.tieneCodigo || key === 'areas') ? (document.getElementById('param-item-codigo')?.value.trim() || '') : '';
  if (key === 'areas' && !codigo) {
    errEl.textContent = 'El código del área es obligatorio.';
    errEl.style.display = 'block'; return;
  }
  // Validar que se seleccione el Nivel Superior para áreas
  if (key === 'areas') {
    const idPadre = parseInt(document.getElementById('param-item-area-padre')?.value) || null;
  }

  // ── Validar duplicados ──
  try {
    const monedaVal  = def.tieneMoneda ? (document.getElementById('param-item-moneda')?.value || '') : '';
    const cuentaVal  = def.tieneCuentaContable ? (document.getElementById('param-item-cuenta-contable')?.value || '') : '';
    const pkNeq      = id ? ('&' + def.pk + '=neq.' + id) : '';
    const empFiltro  = _empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : '';
    let existeQuery  = '?nombre=ilike.' + encodeURIComponent(nombre) + pkNeq + empFiltro;
    if (def.tieneMoneda && monedaVal)          existeQuery += '&codigo=eq.' + monedaVal;
    if (def.tieneCuentaContable && cuentaVal)  existeQuery += '&id_cuenta_contable=eq.' + cuentaVal;
    const existe = await api(def.tabla, 'GET', null, existeQuery);
    if (existe && existe.length > 0) {
      errEl.textContent = 'Ya existe un método de pago con el mismo nombre, moneda y cuenta contable.';
      errEl.style.display = 'block'; resetBtn(); return;
    }
    // Duplicado por código (solo si tieneCodigo, no tieneMoneda)
    if (def.tieneCodigo && codigo) {
      const existeCod = await api(def.tabla, 'GET', null, '?codigo=ilike.' + encodeURIComponent(codigo) + pkNeq + empFiltro);
      if (existeCod && existeCod.length > 0) {
        errEl.textContent = 'Ya existe un registro con el código "' + codigo + '".';
        errEl.style.display = 'block'; resetBtn(); return;
      }
    }
  } catch(eDup) { console.warn('Error validando duplicado:', eDup); }
  const datos = {};
  // Usar campo nombre correcto según la definición
  datos[def.campoNombre || 'nombre'] = nombre;
  datos.estado = estado;
  if (key === 'areas') {
    datos.codigo        = document.getElementById('param-item-codigo')?.value.trim() || null;
    datos.id_area_padre = parseInt(document.getElementById('param-item-area-padre')?.value) || null;
  } else {
    if (def.tieneCodigo)          datos.codigo             = document.getElementById('param-item-codigo')?.value.trim().toUpperCase() || null;
    if (def.tieneMoneda)          datos.codigo             = document.getElementById('param-item-moneda')?.value || null;
    if (def.tieneArea)            datos.id_area            = parseInt(document.getElementById('param-item-area')?.value) || null;
    if (def.tieneDescripcion)     datos[def.campoDescripcion || 'descripcion'] = document.getElementById('param-item-descripcion')?.value.trim() || null;
    if (def.tieneTipoSector)      datos.tipo_sector        = document.getElementById('param-item-tipo-sector')?.value || null;
    if (def.tieneTipoCanal)       datos.tipo_canal         = document.getElementById('param-item-tipo-canal')?.value || null;
    if (def.tieneCategoria)       datos.id_categoria       = parseInt(document.getElementById('param-item-categoria')?.value) || null;
    if (def.tieneCuentaContable)  datos.id_cuenta_contable = parseInt(document.getElementById('param-item-cuenta-contable')?.value) || null;
    if (def.tieneEmisor)          datos.id_empresa         = _empresaActiva?.id_empresa || null;
    if (!id)                      datos.id_empresa         = datos.id_empresa || _empresaActiva?.id_empresa || null;
  }

  try {
    if (id) {
      await api(def.tabla, 'PATCH', datos, '?' + def.pk + '=eq.' + id);
      okEl.textContent = '✓ Registro actualizado.';
    } else {
      await api(def.tabla, 'POST', datos);
      okEl.textContent = '✓ Registro creado.';
      // Actualizar cache de áreas si se creó una nueva área
      if (key === 'areas') {
        _paramAreasCache = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc');
      }
    }
    okEl.style.display = 'block';
    _empParamCache = {}; // Invalidar cache empleados
    _paramAreasCache = []; // Invalidar cache areas
    resetBtn();
    // Esperar que BD confirme el cambio antes de recargar
    await new Promise(function(r){ setTimeout(r, 300); });
    cerrarModal('modal-param');
    await mostrarTablaParam(key);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    resetBtn();
  }
}

async function eliminarParamItem() {
  const key = window._paramKey;
  const id  = window._paramId;
  if (!key || !id) return;
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  if (key === 'inv_categorias') {
    try {
      const tipos = await api('inv_articulos_tipo','GET',null,'?id_categoria=eq.'+id+'&select=id_tipo&limit=1') || [];
      if (tipos.length) { alert('No se puede eliminar: esta categoría tiene tipos de artículo asociados. Elimine primero los tipos.'); return; }
      // Verificar artículos a través de los tipos de esta categoría
      const tiposTodos = await api('inv_articulos_tipo','GET',null,'?id_categoria=eq.'+id+'&select=id_tipo') || [];
      if (tiposTodos.length) {
        const idsStr = tiposTodos.map(function(t){ return t.id_tipo; }).join(',');
        const arts = await api('inventario_almacen','GET',null,'?id_tipo_articulo=in.('+idsStr+')&select=id_articulo&limit=1') || [];
        if (arts.length) { alert('No se puede eliminar: tiene artículos asociados a sus tipos. Reasigne o elimine los artículos primero.'); return; }
      }
      await api('inv_categorias','DELETE',null,'?id_categoria=eq.'+id);
      _invCategoriasCache=[];
      cerrarModal('modal-param');
      if(typeof invRenderCategorias==='function') invRenderCategorias();
    } catch(e) { alert('Error: '+e.message); } return;
  }
  if (key === 'inv_articulos_tipo') {
    try {
      const arts2 = await api('inventario_almacen','GET',null,'?id_tipo_articulo=eq.'+id+'&select=id_articulo&limit=1') || [];
      if (arts2.length) { alert('No se puede eliminar: este tipo tiene artículos asociados. Reasigne o elimine los artículos primero.'); return; }
      await api('inv_articulos_tipo','DELETE',null,'?id_tipo=eq.'+id);
      cerrarModal('modal-param');
      if(typeof invRenderTipos==='function') invRenderTipos();
    } catch(e) { alert('Error: '+e.message); } return;
  }
  // Validar dependencias antes de eliminar
  if (key === 'areas') {
    try {
      const cargos = await api('param_cargos','GET',null,'?id_area=eq.'+id+'&select=id&limit=1') || [];
      if (cargos.length) { alert('No se puede eliminar: esta área tiene cargos asociados. Elimine o reasigne los cargos primero.'); return; }
      const emps = await api('empleados','GET',null,'?id_area=eq.'+id+'&select=id_empleado&limit=1') || [];
      if (emps.length) { alert('No se puede eliminar: esta área tiene empleados asignados. Reasigne los empleados primero.'); return; }
      const subAreas = await api('param_areas','GET',null,'?id_area_padre=eq.'+id+'&select=id&limit=1') || [];
      if (subAreas.length) { alert('No se puede eliminar: esta área tiene subáreas dependientes. Elimine primero las subáreas.'); return; }
    } catch(eVal) { alert('Error al validar: '+eVal.message); return; }
  }
  if (key === 'cargos') {
    try {
      const emps2 = await api('empleados','GET',null,'?id_cargo=eq.'+id+'&select=id_empleado&limit=1') || [];
      if (emps2.length) { alert('No se puede eliminar: este cargo tiene empleados asignados. Reasigne los empleados primero.'); return; }
    } catch(eValC) { alert('Error al validar: '+eValC.message); return; }
  }
  var _empCampos = { 'tipos_contrato':'id_tipo_contrato','tipos_salario':'id_tipo_salario','calculos_salario':'id_calculo_salario','frecuencias_pago':'id_frecuencia_pago','niveles_educativos':'id_nivel_educativo','estados_civiles':'id_estado_civil','sexos':'id_sexo' };
  if (_empCampos[key]) {
    try {
      var empsD = await api('empleados','GET',null,'?'+_empCampos[key]+'=eq.'+id+'&select=id_empleado&limit=1') || [];
      if (empsD.length) { alert('No se puede eliminar: este registro está siendo usado por uno o más empleados. Reasigne los empleados primero.'); return; }
    } catch(eValD) { alert('Error al validar: '+eValD.message); return; }
  }
  if (key === 'cat_prov') {
    try {
      var provs = await api('proveedores','GET',null,'?id_categoria=eq.'+id+'&select=id_proveedor&limit=1') || [];
      if (provs.length) { alert('No se puede eliminar: esta categoría tiene proveedores asociados.'); return; }
    } catch(eValP) { alert('Error al validar: '+eValP.message); return; }
  }
  if (key === 'bancos') {
    try {
      var ctsB = await api('empleados_cuentas_bancarias','GET',null,'?id_banco=eq.'+id+'&select=id&limit=1') || [];
      if (ctsB.length) { alert('No se puede eliminar: este banco está siendo usado en cuentas bancarias.'); return; }
    } catch(eValB) { alert('Error al validar: '+eValB.message); return; }
  }
  const def = TABLAS_MAESTRAS.find(function(t){ return t.key === key; });
  if (!def) return;
  try {
    await api(def.tabla,'DELETE',null,'?'+def.pk+'=eq.'+id);
    _empParamCache = {}; // Invalidar cache empleados
    _paramAreasCache = []; // Invalidar cache areas
    cerrarModal('modal-param');
    mostrarTablaParam(key);
  } catch(e) { alert('Error: '+e.message); }
}


async function renderEmpleados() {
  if (!sesionActual?.administrador && !modulosAcceso.includes('EMPLEADOS')) {
    document.getElementById('contenido-principal').innerHTML = '<div class="alerta alerta-error" style="display:block">Sin acceso a este módulo.</div>';
    return;
  }
  const c = document.getElementById('contenido-principal');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando empleados...</div>';

  try {
    const empleados = await api('empleados', 'GET', null,
      '?order=nombre_completo.asc&select=*,param_areas(nombre,codigo),param_cargos(nombre)'+emisorQ());
    empleadosCache = empleados;

    const resumen = { ACTIVO:0, INACTIVO:0, SUSPENDIDO:0, RETIRADO:0, RENUNCIA:0 };
    empleados.forEach(function(e) { if (resumen[e.estatus] !== undefined) resumen[e.estatus]++; });

    const verDatosEmp = sesionActual?.administrador || puedo('EMPLEADOS','VER_DATOS_PERSONALES');

    const filas = empleados.map(function(e) {
      const est = ESTATUS_EMP[e.estatus] || { clase: 'badge-gris', label: e.estatus };
      return '<tr data-id="' + e.id_empleado + '">'
        + '<td>'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + (e.foto_documento
            ? '<img src="' + e.foto_documento + '" onerror="imgError(this)" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--borde)">'
            : '<div style="width:36px;height:36px;border-radius:50%;background:var(--gris3);display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>')
        + '<div>'
        + '<div style="font-weight:500">' + e.nombre_completo + '</div>'
        + (verDatosEmp ? '<div style="font-size:11px;color:var(--suave);font-family:var(--font-mono)">' + (e.tipo_doc||'V') + '-' + e.numero_doc + '</div>' : '')
        + '</div></div></td>'
        + '<td style="font-size:12px">' + (e.param_areas ? e.param_areas.nombre + (e.param_areas.codigo ? ' (' + e.param_areas.codigo + ')' : '') : '—') + '</td>'
        + '<td style="font-size:12px">' + (e.param_cargos ? e.param_cargos.nombre : '—') + '</td>'
        + '<td><span class="badge ' + est.clase + '">' + est.label + '</span></td>'
        + '<td style="font-size:11px;color:var(--suave)">' + (e.fecha_ingreso ? fmtFecha(e.fecha_ingreso) : '—') + '</td>'
        + '<td><button class="btn-naranja" onclick="verFichaEmpleado(' + e.id_empleado + ')">Ver</button></td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:24px">'
      + Object.entries(ESTATUS_EMP).map(function(entry) {
          return '<div class="tarjeta-stat" style="padding:14px">'
            + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">' + entry[1].label + '</div>'
            + '<div style="font-family:var(--font-display);font-size:26px;color:var(--naranja)">' + (resumen[entry[0]]||0) + '</div>'
            + '</div>';
        }).join('')
      + '<div class="tarjeta-stat" style="padding:14px">'
      + '<div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Total</div>'
      + '<div style="font-family:var(--font-display);font-size:26px;color:var(--naranja)">' + empleados.length + '</div>'
      + '</div></div>'
      + '<div class="panel">'
      + '<div class="panel-header" style="flex-wrap:wrap;gap:10px">'
      + '<h3 style="white-space:nowrap">Empleados</h3>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<select id="emp-filtro-estatus" onchange="filtrarTablaEmpleados()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 10px;border-radius:5px;outline:none;cursor:pointer">'
      + '<option value="">Todos los estatus</option>'
      + Object.entries(ESTATUS_EMP).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('')
      + '</select>'
      + '<input type="text" id="emp-buscar" placeholder="Buscar nombre o cédula..." oninput="filtrarTablaEmpleados()" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);font-family:var(--font-body);font-size:12px;padding:8px 12px;border-radius:5px;outline:none;width:200px">'
      + (puedo('EMPLEADOS','CREAR') ? '<button class="btn-primario" onclick="abrirEmpleado(null)">+ Nuevo Empleado</button>' : '')
      + '</div></div>'
      + '<div class="tabla-container"><table id="emp-tabla"><thead><tr>'
      + '<th>Empleado</th><th>Área</th><th>Cargo</th><th>Estatus</th><th>F. Ingreso</th><th>Acción</th>'
      + '</tr></thead><tbody id="emp-tbody">'
      + (filas || '<tr><td colspan="6" style="text-align:center;color:var(--suave);padding:32px">No hay empleados registrados</td></tr>')
      + '</tbody></table></div></div>';

  } catch(e) {
    c.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + e.message + '</div>';
  }
}

function filtrarTablaEmpleados() {
  const estatus = document.getElementById('emp-filtro-estatus')?.value || '';
  const buscar  = (document.getElementById('emp-buscar')?.value || '').toLowerCase().trim();
  const tbody   = document.getElementById('emp-tbody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(function(tr) {
    const eId = parseInt(tr.dataset.id);
    const e   = empleadosCache.find(function(x) { return x.id_empleado === eId; });
    if (!e) { tr.style.display = 'none'; return; }
    const matchEst    = !estatus || e.estatus === estatus;
    const matchBuscar = !buscar  || e.nombre_completo.toLowerCase().includes(buscar) || (e.numero_doc||'').includes(buscar);
    tr.style.display = matchEst && matchBuscar ? '' : 'none';
  });
}

// ─── CARGAR TABLAS MAESTRAS PARA SELECTORES ───
async function cargarParamEmpleados() {
  if (Object.keys(_empParamCache).length > 0) return; // ya cargado
  try {
    const [areas, cargos, contratos, salarios, calculos, frecuencias,
           niveles, civiles, sexos, bancos, nivelesJer] = await Promise.all([
      api('param_areas',              'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
      api('param_cargos',             'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_tipos_contrato',     'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_tipos_salario',      'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_calculos_salario',   'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_frecuencias_pago',   'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_niveles_educativos', 'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_estados_civiles',    'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_sexos',              'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_bancos',             'GET', null, '?estado=eq.ACTIVO&order=nombre.asc'),
      api('param_niveles_jerarquicos','GET', null, '?estado=eq.ACTIVO&order=nivel_jerarquicos.asc'),
    ]);
    _empParamCache = { areas, cargos, contratos, salarios, calculos, frecuencias, niveles, civiles, sexos, bancos, nivelesJer };
  } catch(e) { console.error('Error cargando parámetros empleados:', e); }
}

function selOpts(lista, valorActual, campoNombre) {
  campoNombre = campoNombre || 'nombre';
  return '<option value="">— Seleccionar —</option>'
    + (lista||[]).map(function(item) {
        return '<option value="' + item.id + '"' + (valorActual && valorActual == item.id ? ' selected' : '') + '>'
          + item[campoNombre] + (item.codigo ? ' (' + item.codigo + ')' : '') + '</option>';
      }).join('');
}

function onSelAreaEmpleado() {
  const id_area = parseInt(document.getElementById('emp-area')?.value) || null;
  const sel = document.getElementById('emp-cargo');
  if (!sel) return;
  const p = _empParamCache;
  const cargosArea = id_area
    ? (p.cargos||[]).filter(function(c){ return c.id_area === id_area; })
    : (p.cargos||[]);
  sel.innerHTML = selOpts(cargosArea, null);
}

// ─── ABRIR FORMULARIO EMPLEADO ───
async function abrirEmpleado(id) {
  // Cargar parámetros si no están en caché
  await cargarParamEmpleados();
  // Recargar permisos si es necesario
  if (!sesionActual?.administrador) {
    try {
      const perms = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario));
      permisosActuales = {};
      perms.forEach(function(p) {
        if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
        permisosActuales[p.modulo].push(p.accion);
      });
    } catch(eR) {}
  }
  if (id && !puedo('EMPLEADOS','EDITAR')) { alert('No tiene permiso para editar empleados.'); return; }
  if (!id && !puedo('EMPLEADOS','CREAR')) { alert('No tiene permiso para registrar empleados.'); return; }

  await cargarParamEmpleados();
  const p = _empParamCache;
  var e = null;
  if (id) {
    try {
      const resE = await api('empleados', 'GET', null, '?id_empleado=eq.' + id + '&select=*,emisores(id_empresa,nombre)');
      if (resE && resE[0]) e = resE[0];
    } catch(eEmp) {}
    if (!e) e = empleadosCache.find(function(x) { return x.id_empleado === id || x.id_empleado === parseInt(id); });
  }

  document.getElementById('modal-emp-titulo').textContent = e ? 'EDITAR EMPLEADO' : 'NUEVO EMPLEADO';
  document.getElementById('alerta-emp-ok').style.display  = 'none';
  document.getElementById('alerta-emp-err').style.display = 'none';

  // ── Datos Personales ──
  document.getElementById('emp-tipo-doc').value       = e ? (e.tipo_doc||'V') : 'V';
  document.getElementById('emp-numero-doc').value     = e ? (e.numero_doc||'') : '';
  document.getElementById('emp-nombre').value         = e ? (e.nombre_completo||'') : '';
  document.getElementById('emp-fecha-nac').value      = e ? (e.fecha_nacimiento||'') : '';
  document.getElementById('emp-correo').value         = e ? (e.correo||'') : '';
  document.getElementById('emp-tel-movil').value      = e ? (e.telefono_movil||'') : '';
  document.getElementById('emp-tel-fijo').value       = e ? (e.telefono_fijo||'') : '';
  document.getElementById('emp-direccion').value      = e ? (e.direccion||'') : '';
  document.getElementById('emp-estado-civil').innerHTML = selOpts(p.civiles, e?.id_estado_civil);
  document.getElementById('emp-sexo').innerHTML       = selOpts(p.sexos, e?.id_sexo);
  document.getElementById('emp-nivel-edu').innerHTML  = selOpts(p.niveles, e?.id_nivel_educativo);

  // Foto
  const fotoActual = document.getElementById('emp-foto-actual');
  fotoActual.innerHTML = e && e.foto_documento
    ? '<div style="position:relative;display:inline-block">'
      + '<img src="' + e.foto_documento + '" onerror="imgError(this)" style="height:70px;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="abrirVisor(\'' + e.foto_documento + '\')">'
      + '<button onclick="eliminarFotoEmp(' + (e?e.id_empleado:0) + ')" style="position:absolute;top:-6px;right:-6px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px">✕</button>'
      + '</div>'
    : '';

  // ── Contacto Emergencia ──
  document.getElementById('emp-emerg-nombre').value  = e ? (e.emergencia_nombre||'') : '';
  document.getElementById('emp-emerg-tel').value     = e ? (e.emergencia_telefono||'') : '';

  // ── Datos Laborales ──
  document.getElementById('emp-area').innerHTML      = selOpts(p.areas, e?.id_area);
  // Filtrar cargos por área seleccionada
  const cargosDelArea = e?.id_area
    ? (p.cargos||[]).filter(function(c){ return c.id_area === e.id_area; })
    : (p.cargos||[]);
  document.getElementById('emp-cargo').innerHTML = selOpts(cargosDelArea, e?.id_cargo);
  // Nivel Jerárquico
  const selNivJer = document.getElementById('emp-nivel-jerarquico');
  if (selNivJer) {
    selNivJer.innerHTML = '<option value="">— Sin nivel asignado —</option>'
      + (p.nivelesJer||[]).map(function(n) {
          const label = n.nivel_jerarquicos + (n.descripcion_jerarquicos ? ' — ' + n.descripcion_jerarquicos : '');
          return '<option value="' + n.id_jerarquicos + '"' + (e && e.id_nivel_jerarquico == n.id_jerarquicos ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
  }
  document.getElementById('emp-contrato').innerHTML  = selOpts(p.contratos, e?.id_tipo_contrato);
  document.getElementById('emp-tipo-sal').innerHTML  = selOpts(p.salarios, e?.id_tipo_salario);
  document.getElementById('emp-calc-sal').innerHTML  = selOpts(p.calculos, e?.id_calculo_salario);
  document.getElementById('emp-freq-pago').innerHTML = selOpts(p.frecuencias, e?.id_frecuencia_pago);
  document.getElementById('emp-monto-sal').value     = e ? (e.monto_salario||'') : '';
  document.getElementById('emp-moneda-calc').value   = e ? (e.moneda_calculo||'USD') : 'USD';
  document.getElementById('emp-moneda-pago').value   = e ? (e.moneda_pago||'VES') : 'VES';

  // Cargar selector de empresa
  try {
    const emisores = await api('emisores','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id_empresa,nombre');
    const selEmisor = document.getElementById('emp-emisor');
    if (selEmisor) {
      selEmisor.innerHTML = '<option value="">— Seleccionar empresa —</option>'
        + emisores.map(function(em){ return '<option value="'+em.id_empresa+'">'+ em.nombre+'</option>'; }).join('');
      if (e && e.id_empresa) selEmisor.value = e.id_empresa;
    }
  } catch(eEm) {}
  document.getElementById('emp-bono-ali').value      = e ? (e.bono_alimentacion||'') : '';
  document.getElementById('emp-bono-trans').value    = e ? (e.bono_transporte||'') : '';
  document.getElementById('emp-bono-prod').value     = e ? (e.bono_productividad||'') : '';
  document.getElementById('emp-comision').value      = e ? (e.comision_pct||'') : '';
  document.getElementById('emp-fecha-ingreso').value = e ? (e.fecha_ingreso||'') : '';
  document.getElementById('emp-estatus').value       = e ? (e.estatus||'ACTIVO') : 'ACTIVO';
  document.getElementById('emp-fecha-egreso').value  = e ? (e.fecha_egreso||'') : '';

  // ── Cuenta Nómina ──
  document.getElementById('emp-banco').innerHTML     = selOpts(p.bancos, e?.id_institucion);
  document.getElementById('emp-tipo-cuenta').value   = e ? (e.tipo_cuenta||'') : '';
  // Separar número de cuenta: primeros 4 = código banco, resto = dígitos
  var numCuenta = e ? (e.numero_cuenta||'') : '';
  var codBanco  = '';
  if (e && e.id_institucion) {
    var bancoSel = (p.bancos||[]).find(function(b) { return b.id === e.id_institucion; });
    codBanco = bancoSel && bancoSel.codigo ? bancoSel.codigo.replace(/\D/g,'').substring(0,4) : numCuenta.substring(0,4);
  }
  var restoCuenta = numCuenta.length > 4 ? numCuenta.substring(4) : (numCuenta.length === 4 ? '' : numCuenta);
  document.getElementById('emp-cod-banco').value        = codBanco;
  document.getElementById('emp-num-cuenta-resto').value = restoCuenta;
  document.getElementById('emp-num-cuenta').value       = numCuenta;
  // Si hay código de banco pero no hay dígitos restantes, posicionar cursor en el campo resto
  if (codBanco && !restoCuenta) {
    setTimeout(function() { document.getElementById('emp-num-cuenta-resto')?.focus(); }, 150);
  }

  document.getElementById('emp-id').value = e ? e.id_empleado : '';

  // Deshabilitar campos sensibles si no tiene permiso VER_DATOS_PERSONALES
  var tienePerm = sesionActual?.administrador || puedo('EMPLEADOS','VER_DATOS_PERSONALES');
  var camposSensibles = [
    'emp-numero-doc','emp-fecha-nac','emp-correo','emp-tel-movil','emp-tel-fijo',
    'emp-direccion','emp-monto-sal','emp-moneda-calc','emp-moneda-pago',
    'emp-bono-ali','emp-bono-trans','emp-bono-prod','emp-comision',
    'emp-banco','emp-tipo-cuenta','emp-num-cuenta','emp-cod-banco','emp-num-cuenta-resto'
  ];
  camposSensibles.forEach(function(cid) {
    var el = document.getElementById(cid);
    if (el) {
      el.disabled = !tienePerm;
      el.style.opacity = tienePerm ? '1' : '0.4';
      el.title = tienePerm ? '' : 'No tiene permiso para ver/editar este campo';
    }
  });
  // Mostrar aviso si no tiene permiso
  var avisoEl = document.getElementById('emp-aviso-datos');
  if (avisoEl) avisoEl.style.display = tienePerm ? 'none' : 'block';

  abrirModal('modal-empleado');
  focusFirstField('modal-empleado');
  setTimeout(function() { document.getElementById('emp-numero-doc')?.focus(); }, 100);
}

async function resetClaveEmpleado(id_empleado, correo) {
  if (!confirm('¿Resetear la clave del empleado "' + correo + '"? Se le asignará una clave temporal.')) return;
  const claveTemporal = Math.random().toString(36).slice(-8).toUpperCase();
  try {
    await api('usuarios','PATCH',{ clave: claveTemporal },'?correo_usuario=eq.'+encodeURIComponent(correo));
    alert('✓ Clave reseteada. Clave temporal: ' + claveTemporal + '. Comuníquela al empleado para que la cambie al ingresar.');
  } catch(e) { alert('Error al resetear clave: '+e.message); }
}

// ─── GUARDAR EMPLEADO ───
async function guardarEmpleado() {
  const id     = document.getElementById('emp-id').value;
  if (id && !puedo('EMPLEADOS','EDITAR')) { alert('No tiene permiso para editar empleados.'); return; }
  if (!id && !puedo('EMPLEADOS','CREAR')) { alert('No tiene permiso para crear empleados.'); return; }

  const numDoc  = document.getElementById('emp-numero-doc').value.trim();
  const nombre  = document.getElementById('emp-nombre').value.trim();
  const okEl    = document.getElementById('alerta-emp-ok');
  const errEl   = document.getElementById('alerta-emp-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!numDoc) { errEl.textContent = 'El número de documento es obligatorio.'; errEl.style.display = 'block'; return; }
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }
  const id_emisorEmp = parseInt(document.getElementById('emp-emisor')?.value) || null;
  if (!id_emisorEmp) { errEl.textContent = 'Debe seleccionar la empresa del empleado.'; errEl.style.display = 'block'; document.getElementById('emp-emisor')?.focus(); return; }

  // ── Validaciones de campos obligatorios ──
  var validaciones = [
    { id: 'emp-fecha-nac',    label: 'Fecha de Nacimiento' },
    { id: 'emp-estado-civil', label: 'Estado Civil' },
    { id: 'emp-sexo',         label: 'Sexo' },
    { id: 'emp-nivel-edu',    label: 'Nivel Educativo' },
    { id: 'emp-correo',       label: 'Correo Electrónico' },
    { id: 'emp-tel-movil',    label: 'Teléfono Móvil' },
    { id: 'emp-direccion',    label: 'Dirección' },
    { id: 'emp-emerg-nombre', label: 'Nombre del Contacto de Emergencia' },
    { id: 'emp-emerg-tel',    label: 'Teléfono del Contacto de Emergencia' },
    { id: 'emp-area',         label: 'Área' },
    { id: 'emp-cargo',        label: 'Cargo' },
    { id: 'emp-contrato',     label: 'Tipo de Contrato' },
    { id: 'emp-tipo-sal',     label: 'Tipo de Salario' },
    { id: 'emp-calc-sal',     label: 'Cálculo del Salario' },
    { id: 'emp-freq-pago',    label: 'Frecuencia de Pago' },
    { id: 'emp-monto-sal',    label: 'Monto del Salario' },
    { id: 'emp-moneda-calc',  label: 'Moneda de Cálculo' },
    { id: 'emp-moneda-pago',  label: 'Moneda de Pago' },
    { id: 'emp-fecha-ingreso',label: 'Fecha de Ingreso' },
    { id: 'emp-estatus',      label: 'Estatus' },
  ];
  for (var vi = 0; vi < validaciones.length; vi++) {
    var v = validaciones[vi];
    var el = document.getElementById(v.id);
    if (!el) continue;
    var val = el.value ? el.value.trim() : '';
    if (!val) {
      errEl.textContent = 'El campo "' + v.label + '" es obligatorio.';
      errEl.style.display = 'block';
      el.focus();
      // Scroll al campo
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  // Validar fecha de egreso si estatus es RETIRADO o RENUNCIA
  var estatusVal = document.getElementById('emp-estatus')?.value;
  if (estatusVal === 'RETIRADO' || estatusVal === 'RENUNCIA') {
    var fechaEgreso = document.getElementById('emp-fecha-egreso')?.value;
    if (!fechaEgreso) {
      errEl.textContent = 'La Fecha de Egreso es obligatoria cuando el estatus es "' + (estatusVal === 'RETIRADO' ? 'Retirado' : 'Renuncia') + '".';
      errEl.style.display = 'block';
      document.getElementById('emp-fecha-egreso')?.focus();
      document.getElementById('emp-fecha-egreso')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  // Validar Cuenta Nómina — todos los campos son obligatorios
  var id_bancoVal   = document.getElementById('emp-banco')?.value;
  var tipoCuentaVal = document.getElementById('emp-tipo-cuenta')?.value;
  var restoVal     = (document.getElementById('emp-num-cuenta-resto')?.value || '').replace(/\s/g,'');

  if (!id_bancoVal) {
    errEl.textContent = 'La Institución Financiera de la Cuenta Nómina es obligatoria.';
    errEl.style.display = 'block';
    document.getElementById('emp-banco')?.focus();
    document.getElementById('emp-banco')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!tipoCuentaVal) {
    errEl.textContent = 'El Tipo de Cuenta es obligatorio.';
    errEl.style.display = 'block';
    document.getElementById('emp-tipo-cuenta')?.focus();
    document.getElementById('emp-tipo-cuenta')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (restoVal.length !== 16) {
    errEl.textContent = 'El número de cuenta debe tener exactamente 16 dígitos después del código del banco.';
    errEl.style.display = 'block';
    document.getElementById('emp-num-cuenta-resto')?.focus();
    document.getElementById('emp-num-cuenta-resto')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!/^\d+$/.test(restoVal)) {
    errEl.textContent = 'El número de cuenta solo debe contener dígitos.';
    errEl.style.display = 'block';
    document.getElementById('emp-num-cuenta-resto')?.focus();
    return;
  }

  // Validar duplicado por documento
  try {
    const existe = await api('empleados', 'GET', null,
      '?numero_doc=eq.' + encodeURIComponent(numDoc) + (id ? '&id_empleado=neq.' + id : ''));
    if (existe && existe.length > 0) {
      errEl.textContent = 'Ya existe un empleado con el documento ' + numDoc + '.';
      errEl.style.display = 'block'; return;
    }
  } catch(eDup) {}

  const fotoFile = document.getElementById('emp-foto-file').files[0];
  let fotoUrl = id ? (empleadosCache.find(function(x){return x.id_empleado==id;})?.foto_documento || null) : null;
  if (fotoFile) {
    try { fotoUrl = await subirFoto(fotoFile, 'empleados'); } catch(eF) {}
  }

  const datos = {
    tipo_doc:           document.getElementById('emp-tipo-doc').value,
    numero_doc:         numDoc,
    nombre_completo:    capitalizarNombre(nombre),
    fecha_nacimiento:   document.getElementById('emp-fecha-nac').value || null,
    id_estado_civil:    parseInt(document.getElementById('emp-estado-civil').value) || null,
    id_sexo:            parseInt(document.getElementById('emp-sexo').value) || null,
    correo:             document.getElementById('emp-correo').value.trim() || null,
    telefono_movil:     document.getElementById('emp-tel-movil').value.trim() || null,
    telefono_fijo:      document.getElementById('emp-tel-fijo').value.trim() || null,
    direccion:          document.getElementById('emp-direccion').value.trim() || null,
    id_nivel_educativo: parseInt(document.getElementById('emp-nivel-edu').value) || null,
    foto_documento:     fotoUrl,
    emergencia_nombre:  document.getElementById('emp-emerg-nombre').value.trim() || null,
    emergencia_telefono:document.getElementById('emp-emerg-tel').value.trim() || null,
    id_area:            parseInt(document.getElementById('emp-area').value) || null,
    id_cargo:           parseInt(document.getElementById('emp-cargo').value) || null,
    id_nivel_jerarquico: parseInt(document.getElementById('emp-nivel-jerarquico')?.value) || null,
    id_tipo_contrato:   parseInt(document.getElementById('emp-contrato').value) || null,
    id_tipo_salario:    parseInt(document.getElementById('emp-tipo-sal').value) || null,
    id_calculo_salario: parseInt(document.getElementById('emp-calc-sal').value) || null,
    id_frecuencia_pago: parseInt(document.getElementById('emp-freq-pago').value) || null,
    monto_salario:      parseFloat(document.getElementById('emp-monto-sal').value) || 0,
    moneda_calculo:     document.getElementById('emp-moneda-calc').value || 'USD',
    moneda_pago:        document.getElementById('emp-moneda-pago').value || 'VES',
    bono_alimentacion:  parseFloat(document.getElementById('emp-bono-ali').value) || 0,
    bono_transporte:    parseFloat(document.getElementById('emp-bono-trans').value) || 0,
    bono_productividad: parseFloat(document.getElementById('emp-bono-prod').value) || 0,
    comision_pct:       parseFloat(document.getElementById('emp-comision').value) || 0,
    fecha_ingreso:      document.getElementById('emp-fecha-ingreso').value || null,
    estatus:            document.getElementById('emp-estatus').value || 'ACTIVO',
    fecha_egreso:       document.getElementById('emp-fecha-egreso').value || null,
    id_institucion:     parseInt(document.getElementById('emp-banco').value) || null,
    tipo_cuenta:        document.getElementById('emp-tipo-cuenta').value || null,
    numero_cuenta:      document.getElementById('emp-num-cuenta').value.trim() || null,
    id_empresa:          parseInt(document.getElementById('emp-emisor')?.value) || null,
    id_usuario:         sesionActual.correo_usuario,
  };

  try {
    var empIdFinal;
    if (id) {
      await api('empleados', 'PATCH', datos, '?id_empleado=eq.' + id);
      empIdFinal = parseInt(id);
      okEl.textContent = '✓ Empleado actualizado correctamente.';
    } else {
      const resPost = await api('empleados', 'POST', datos);
      empIdFinal = resPost && resPost[0] ? resPost[0].id_empleado : null;
      // Si POST no retorna id, buscarlo por documento
      if (!empIdFinal) {
        const busq = await api('empleados', 'GET', null, '?numero_doc=eq.' + encodeURIComponent(numDoc) + '&select=id_empleado&order=fecha_registro.desc&limit=1');
        if (busq && busq[0]) empIdFinal = busq[0].id_empleado;
      }
      okEl.textContent = '✓ Empleado registrado correctamente.';
    }

    // Subir fotos del empleado
    var fotosEmpFiles = document.getElementById('emp-foto-perfil-file')?.files;
    if (fotosEmpFiles && fotosEmpFiles.length > 0 && empIdFinal) {
      okEl.textContent = (id ? '✓ Empleado actualizado.' : '✓ Empleado registrado.') + ' Subiendo fotos...';
      okEl.style.display = 'block';
      var fotosSubidas = 0;
      for (var fi = 0; fi < Math.min(fotosEmpFiles.length, 5); fi++) {
        try {
          var urlFoto = await subirFoto(fotosEmpFiles[fi], 'empleados/' + empIdFinal);
          await api('emp_fotos', 'POST', { id_empleado: empIdFinal, url_foto: urlFoto });
          fotosSubidas++;
        } catch(eFoto) { console.error('Error subiendo foto:', eFoto); }
      }
      document.getElementById('emp-foto-perfil-file').value = '';
      okEl.textContent = (id ? '✓ Empleado actualizado.' : '✓ Empleado registrado.') + ' ' + fotosSubidas + ' foto(s) guardada(s).';
    } else {
      okEl.style.display = 'block';
    }

    setTimeout(function() { cerrarModal('modal-empleado'); renderEmpleados(); }, 1500);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
}

// ─── FICHA EMPLEADO ───
async function verFichaEmpleado(id) {
  try {
  if (!sesionActual?.administrador) {
    try {
      const perms = await api('usuarios_permisos', 'GET', null, '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario));
      permisosActuales = {};
      perms.forEach(function(p) {
        if (!permisosActuales[p.modulo]) permisosActuales[p.modulo] = [];
        permisosActuales[p.modulo].push(p.accion);
      });
    } catch(eR) {}
    if (!puedo('EMPLEADOS','VER')) {
      alert('Sin permiso.'); return;
    }
  }
  var e = null;
  try {
    const res = await api('empleados', 'GET', null, '?id_empleado=eq.' + id + '&select=*,param_areas(nombre,codigo),param_cargos(nombre)');
    if (res && res[0]) {
      e = res[0];
      // Cargar empresa por separado
      if (e.id_empresa) {
        try {
          const emRes = await api('emisores','GET',null,'?id_empresa=eq.'+e.id_empresa+'&select=id_empresa,nombre&limit=1');
          if (emRes && emRes[0]) e.emisores = emRes[0];
        } catch(eEm) {}
      }
    }
  } catch(eBusc) { alert('ERROR buscando empleado: ' + eBusc.message); return; }
  if (!e) { alert('No se encontró el empleado.'); return; }
  await cargarParamEmpleados();

  const p = _empParamCache;

  // Cargar fotos del empleado
  var fotosPerfilEmp = [];
  try {
    fotosPerfilEmp = await api('emp_fotos', 'GET', null, '?id_empleado=eq.' + id + '&order=fecha_registro.asc&select=id_foto,url_foto');
  } catch(eF) { console.error('Error cargando fotos:', eF); }

  function getNombre(lista, idVal) {
    var item = (lista||[]).find(function(x) { return x.id === idVal; });
    return item ? item.nombre : '—';
  }
  function getNombreCodigo(lista, idVal) {
    var item = (lista||[]).find(function(x) { return x.id === idVal; });
    return item ? item.nombre + (item.codigo ? ' (' + item.codigo + ')' : '') : '—';
  }

  const est = ESTATUS_EMP[e.estatus] || { clase: 'badge-gris', label: e.estatus };

  const verDatos = sesionActual?.administrador || puedo('EMPLEADOS','VER_DATOS_PERSONALES');

  document.getElementById('ficha-emp-contenido').innerHTML =
    // Cabecera
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">'
    + (e.foto_documento
        ? '<img src="' + e.foto_documento + '" onerror="imgError(this)" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid var(--naranja);cursor:pointer" onclick="abrirVisor(\'' + e.foto_documento + '\')">'
        : '<div style="width:70px;height:70px;border-radius:50%;background:var(--gris3);display:flex;align-items:center;justify-content:center;font-size:28px">👤</div>')
    + '<div>'
    + '<div style="font-family:var(--font-display);font-size:22px;color:var(--naranja)">' + e.nombre_completo + '</div>'
    + (verDatos ? '<div style="font-size:12px;color:var(--suave);font-family:var(--font-mono)">' + (e.tipo_doc||'V') + '-' + e.numero_doc + '</div>' : '<div style="font-size:12px;color:#555">🔒 Documento restringido</div>')
    + '<span class="badge ' + est.clase + '" style="margin-top:4px;display:inline-block">' + est.label + '</span>'
    + '</div></div>'
    + (fotosPerfilEmp && fotosPerfilEmp.length
        ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'
          + fotosPerfilEmp.map(function(f) { return '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick="window.abrirVisor(this.src)">'  ; }).join('')
          + '</div>'
        : '')

    // Datos Personales
    + '<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid var(--borde);padding-bottom:6px">Datos Personales</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Fecha Nacimiento</div><div style="font-size:13px">' + (e.fecha_nacimiento||'—') + '</div></div>' : '')
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Estado Civil</div><div style="font-size:13px">' + getNombre(p.civiles, e.id_estado_civil) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Sexo</div><div style="font-size:13px">' + getNombre(p.sexos, e.id_sexo) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nivel Educativo</div><div style="font-size:13px">' + getNombre(p.niveles, e.id_nivel_educativo) + '</div></div>'
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Correo</div><div style="font-size:13px">' + (e.correo||'—') + '</div></div>' : '')
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono Móvil</div><div style="font-size:13px">' + (e.telefono_movil||'—') + '</div></div>' : '')
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono Fijo</div><div style="font-size:13px">' + (e.telefono_fijo||'—') + '</div></div>' : '')
    + (verDatos ? '<div class="form-full" style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div style="font-size:13px">' + (e.direccion||'—') + '</div></div>' : '')
    + '</div>'

    // Contacto Emergencia
    + (e.emergencia_nombre ? '<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid var(--borde);padding-bottom:6px">Contacto de Emergencia</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nombre</div><div style="font-size:13px">' + e.emergencia_nombre + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono</div><div style="font-size:13px">' + (e.emergencia_telefono||'—') + '</div></div>'
      + '</div>' : '')

    // Datos Laborales
    + '<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid var(--borde);padding-bottom:6px">Datos Laborales</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Empresa</div><div style="font-size:13px;font-weight:600;color:var(--naranja)">' + (e.emisores ? e.emisores.nombre : '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Área</div><div style="font-size:13px">' + getNombreCodigo(p.areas, e.id_area) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Cargo</div><div style="font-size:13px">' + getNombre(p.cargos, e.id_cargo) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nivel Jerárquico</div><div style="font-size:13px">' + (function() { var n = (p.nivelesJer||[]).find(function(x){ return x.id_jerarquicos == e.id_nivel_jerarquico; }); return n ? n.nivel_jerarquicos + (n.descripcion_jerarquicos ? ' — ' + n.descripcion_jerarquicos : '') : '—'; })() + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Contrato</div><div style="font-size:13px">' + getNombre(p.contratos, e.id_tipo_contrato) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Salario</div><div style="font-size:13px">' + getNombre(p.salarios, e.id_tipo_salario) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Cálculo Salario</div><div style="font-size:13px">' + getNombre(p.calculos, e.id_calculo_salario) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Frecuencia Pago</div><div style="font-size:13px">' + getNombre(p.frecuencias, e.id_frecuencia_pago) + '</div></div>'
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Salario</div><div style="font-family:var(--font-mono);color:var(--naranja)">' + (e.monto_salario ? (e.moneda_calculo||'USD') + ' ' + fmtUSD(e.monto_salario) : '—') + '</div></div>' : '')
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Moneda Cálculo</div><div style="font-size:13px">' + (e.moneda_calculo||'—') + '</div></div>' : '')
    + (verDatos ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Moneda Pago</div><div style="font-size:13px">' + (e.moneda_pago||'—') + '</div></div>' : '')
    + (verDatos && e.bono_alimentacion ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Bono Alimentación</div><div style="font-family:var(--font-mono)">' + fmtUSD(e.bono_alimentacion) + '</div></div>' : '')
    + (verDatos && e.bono_transporte   ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Bono Transporte</div><div style="font-family:var(--font-mono)">' + fmtUSD(e.bono_transporte) + '</div></div>' : '')
    + (verDatos && e.bono_productividad? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Bono Productividad</div><div style="font-family:var(--font-mono)">' + fmtUSD(e.bono_productividad) + '</div></div>' : '')
    + (verDatos && e.comision_pct      ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Comisión</div><div style="font-family:var(--font-mono)">' + e.comision_pct + '%</div></div>' : '')
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">F. Ingreso</div><div style="font-size:13px">' + (e.fecha_ingreso||'—') + '</div></div>'
    + (e.fecha_egreso ? '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">F. Egreso</div><div style="font-size:13px">' + fmtFecha(e.fecha_egreso) + '</div></div>' : '')
    + '</div>'

    // Cuenta Nómina
    + (verDatos && e.id_institucion ? '<div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid var(--borde);padding-bottom:6px">Cuenta Nómina</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Institución</div><div style="font-size:13px">' + getNombre(p.bancos, e.id_institucion) + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Cuenta</div><div style="font-size:13px">' + (e.tipo_cuenta||'—') + '</div></div>'
      + '<div class="form-full" style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">N° Cuenta</div><div style="font-size:13px;font-family:var(--font-mono)">' + (e.numero_cuenta||'—') + '</div></div>'
      + '</div>' : '');

  // Botones footer
  var btnEditar     = document.getElementById('ficha-emp-btn-editar');
  var btnEliminar   = document.getElementById('ficha-emp-btn-eliminar');
  var btnResetClave = document.getElementById('ficha-emp-btn-reset-clave');
  if (btnEditar)     { btnEditar._id = e.id_empleado;     btnEditar.onclick     = function() { cerrarModal('modal-ficha-emp'); abrirEmpleado(this._id); };        btnEditar.style.display     = puedo('EMPLEADOS','EDITAR') ? '' : 'none'; }
  if (btnResetClave) { btnResetClave._id = e.id_empleado; btnResetClave._correo = e.correo; btnResetClave.onclick = function() { resetClaveEmpleado(this._id, this._correo); }; btnResetClave.style.display = (sesionActual?.administrador || puedo('EMPLEADOS','EDITAR')) ? '' : 'none'; }
  if (btnEliminar){
    btnEliminar._id = e.id_empleado;
    btnEliminar._nombre = e.nombre_completo;
    btnEliminar.onclick = function() { cerrarModal('modal-ficha-emp'); eliminarEmpleado(this._id, this._nombre); };
    var puedeEliminar = sesionActual?.administrador === true || puedo('EMPLEADOS','ELIMINAR');
    btnEliminar.style.display = puedeEliminar ? '' : 'none';
  }

  abrirModal('modal-ficha-emp');
  focusFirstField('modal-ficha-emp');
  } catch(eFicha) { alert('Error en ficha: ' + eFicha.message); console.error(eFicha); }
}

// ─── ELIMINAR EMPLEADO ───
async function eliminarEmpleado(id, nombre) {
  if (!puedo('EMPLEADOS','ELIMINAR')) { alert('No tiene permiso para eliminar empleados.'); return; }
  if (!confirm('¿Eliminar al empleado "' + nombre + '"?\\nEsta acción no se puede deshacer.')) return;
  try {
    await api('empleados', 'DELETE', null, '?id_empleado=eq.' + id);
    renderEmpleados();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── VALIDAR FECHA EGRESO SEGÚN ESTATUS ───
function validarFechaEgresoEmp() {
  var estatus  = document.getElementById('emp-estatus')?.value;
  var reqEl    = document.getElementById('emp-egreso-req');
  var inputEl  = document.getElementById('emp-fecha-egreso');
  var requiere = estatus === 'RETIRADO' || estatus === 'RENUNCIA';
  if (reqEl)   reqEl.style.display   = requiere ? 'inline' : 'none';
  if (inputEl) inputEl.style.borderColor = (requiere && !inputEl.value) ? '#fc8181' : '';
}

// ─── SELECTOR BANCO EMPLEADO ───
function onSelBancoEmpleado() {
  var sel     = document.getElementById('emp-banco');
  var codEl   = document.getElementById('emp-cod-banco');
  var restoEl = document.getElementById('emp-num-cuenta-resto');
  if (!sel || !codEl) return;

  var id_banco = parseInt(sel.value);
  var banco   = (_empParamCache.bancos || []).find(function(b) { return b.id === id_banco; });
  var codigo  = banco && banco.codigo ? banco.codigo.replace(/\D/g,'').substring(0,4) : '';

  codEl.value = codigo;
  // Limpiar el resto si cambió el banco
  if (restoEl) { restoEl.value = ''; restoEl.focus(); }
  sincronizarNumeroCuenta();
}

function sincronizarNumeroCuenta() {
  var cod   = document.getElementById('emp-cod-banco')?.value || '';
  var resto = document.getElementById('emp-num-cuenta-resto')?.value || '';
  var hidden = document.getElementById('emp-num-cuenta');
  if (hidden) hidden.value = (cod + resto).replace(/\s/g,'');
}

// ─── ELIMINAR FOTO PERFIL EMPLEADO ───
async function eliminarFotoPerfilEmp(idFoto, id_empleado) {
  if (!confirm('¿Eliminar esta foto?')) return;
  try {
    await api('emp_fotos', 'DELETE', null, '?id_foto=eq.' + idFoto);
    // Refrescar fotos
    const fotos = await api('emp_fotos', 'GET', null, '?id_empleado=eq.' + id_empleado + '&order=fecha_registro.asc');
    const div = document.getElementById('emp-foto-perfil-actual');
    if (div) {
      if (fotos && fotos.length) {
        div.innerHTML = fotos.map(function(f) {
          return '<div style="position:relative">'
            + '<img src="' + f.url_foto + '" onerror="imgError(this)" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--borde);cursor:pointer" onclick=\"abrirVisor(\'" + f.url_foto + "\')">'
            + '<button onclick="eliminarFotoPerfilEmp(' + f.id_foto + ',' + id_empleado + ')" style="position:absolute;top:-5px;right:-5px;background:rgba(229,62,62,0.85);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>'
            + '</div>';
        }).join('');
      } else {
        div.innerHTML = '<div style="font-size:11px;color:var(--suave)">Sin fotos registradas</div>';
      }
    }
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── ELIMINAR FOTO EMPLEADO ───
async function eliminarFotoEmp(id) {
  if (!confirm('¿Eliminar la foto del documento?')) return;
  try {
    await api('empleados', 'PATCH', { foto_documento: null }, '?id_empleado=eq.' + id);
    const emp = empleadosCache.find(function(x) { return x.id_empleado == id; });
    if (emp) emp.foto_documento = null;
    document.getElementById('emp-foto-actual').innerHTML = '';
  } catch(e) { alert('Error: ' + e.message); }
}



