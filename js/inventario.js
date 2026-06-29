// ─── S&D Systems — Módulo: INVENTARIO ───
// ══════════════════════════════════════════════════════════════
//  HISTORIAL DE MOVIMIENTOS DE STOCK (ENTRADAS Y SALIDAS)
// ══════════════════════════════════════════════════════════════

async function verHistorialStock(id_articulo, nombreArt) {
  const tieneAcceso = sesionActual?.administrador
    || puedo('INVENTARIO','VER')
    || puedo('INVENTARIO','ENTRADA_STOCK')
    || puedo('INVENTARIO','SALIDA_STOCK');
  if (!tieneAcceso) { alert('No tiene permiso.'); return; }

  console.log('[SYD] verHistorialStock id:', id_articulo, 'nombre:', nombreArt);

  const elNombre = document.getElementById('historial-art-nombre');
  const elCont   = document.getElementById('historial-contenido');
  const elId     = document.getElementById('historial-id-articulo');

  if (!elNombre || !elCont || !elId) {
    console.error('[SYD] verHistorialStock: elementos del modal no encontrados');
    return;
  }

  elNombre.textContent = nombreArt || '—';
  elCont.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando historial...</div>';
  elId.value = id_articulo;

  // Asegurar que _fichaInvActual esté seteado para el Retornar
  if (!_fichaInvActual || !_fichaInvActual.id) {
    _fichaInvActual = { id: id_articulo, nombre: nombreArt || '' };
  }

  abrirModal('modal-historial-stock');
  focusFirstField('modal-historial-stock');

  try {
    await recargarHistorial(id_articulo);
  } catch(e) {
    console.error('[SYD] recargarHistorial error:', e.message);
    elCont.innerHTML = '<div style="color:#fc8181;padding:16px">Error: ' + e.message + '</div>';
  }
}

async function recargarHistorial(id_articulo) {
  if (!id_articulo) id_articulo = document.getElementById('historial-id-articulo').value;
  const cont = document.getElementById('historial-contenido');
  try {
    // Filtrar por área si usuario no es admin
    let id_areaH = null;
    if (_invSaldoArea !== null) {
      const empH = await api('empleados','GET',null,'?correo=eq.'+encodeURIComponent(sesionActual.correo_usuario)+'&select=id_area&limit=1').catch(function(){ return []; });
      id_areaH = empH?.[0]?.id_area || null;
    }
    const qEnt = '?id_articulo=eq.' + id_articulo + (id_areaH ? '&id_area=eq.'+id_areaH : '') + '&order=fecha_registro.desc&select=*,area_receptora:id_area(nombre,codigo),area_origen:id_area_origen(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),proveedores(nombre)';
    const qSal = '?id_articulo=eq.' + id_articulo + (id_areaH ? '&or=(id_area.eq.'+id_areaH+',id_area_entrega.eq.'+id_areaH+')' : '') + '&order=fecha_registro.desc&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),empleado_entrega:id_empleado_entrega(nombre_completo)';
    const [entradas, salidas] = await Promise.all([
      api('stock_entradas', 'GET', null, qEnt),
      api('stock_salidas',  'GET', null, qSal),
    ]);

    // Combinar y ordenar por fecha_registro desc
    const movimientos = [
      ...entradas.map(function(e) { return { ...e, tipo: 'ENTRADA', fecha: e.fecha_entrada, fecha_reg: e.fecha_registro }; }),
      ...salidas.map(function(s)  {
        // Si el area del usuario es el DESTINO (id_area), es una ENTRADA para él
        const tipoMov = id_areaH && s.id_area === id_areaH ? 'ENTRADA' : 'SALIDA';
        return { ...s, tipo: tipoMov, fecha: s.fecha_salida, fecha_reg: s.fecha_registro };
      }),
    ].sort(function(a, b) { return new Date(b.fecha_reg) - new Date(a.fecha_reg); });

    if (!movimientos.length) {
      cont.innerHTML = '<div style="text-align:center;padding:32px;color:var(--suave)">Sin movimientos registrados</div>';
      return;
    }

    cont.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px;letter-spacing:1px">FECHA</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">TIPO</th>'
      + '<th style="text-align:center;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">CANTIDAD</th>'
      + '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">ÁREA / DETALLE</th>'
      + '<th style="text-align:center;padding:8px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">ESTADO</th>'
      + '<th style="text-align:center;padding:8px 0;border-bottom:1px solid var(--borde);color:var(--suave);font-size:10px">ACCIÓN</th>'
      + '</tr></thead><tbody>'
      + movimientos.map(function(m) {
          const esEntrada = m.tipo === 'ENTRADA';
          const reversada = !!m.reversada;
          const areaRec = m.area_receptora || m.param_areas;
          const area = areaRec ? areaRec.nombre + (areaRec.codigo ? ' (' + areaRec.codigo + ')' : '') : '—';
          return '<tr style="opacity:' + (reversada ? '0.5' : '1') + '">'
            + '<td style="padding:8px 0;font-size:12px;color:var(--suave)">' + (m.fecha||'—') + '</td>'
            + '<td style="padding:8px"><span class="badge ' + (esEntrada ? 'badge-verde' : 'badge-rojo') + '">'
            + (esEntrada ? '▲ Entrada' : '▼ Salida') + '</span>'
            + (reversada ? '<div style="font-size:10px;color:#fc8181;margin-top:2px">Reversada</div>' : '') + '</td>'
            + '<td style="text-align:center;padding:8px;font-family:var(--font-mono);font-weight:600;color:' + (esEntrada ? '#22c55e' : '#fc8181') + '">'
            + (esEntrada ? '+' : '-') + m.cantidad + '</td>'
            + '<td style="padding:8px;font-size:12px">'
            + (esEntrada
              ? '<div>' + (m.area_receptora ? m.area_receptora.nombre + (m.area_receptora.codigo ? ' (' + m.area_receptora.codigo + ')' : '') : '—') + '</div>'
                + (m.area_origen ? '<div style="font-size:11px;color:#60a5fa">↩ Origen: ' + m.area_origen.nombre + (m.area_origen.codigo ? ' (' + m.area_origen.codigo + ')' : '') + '</div>' : '')
                + (m.proveedores ? '<div style="font-size:11px;color:#a78bfa">🏭 ' + m.proveedores.nombre + '</div>' : '')
                + (m.precio_costo_moneda ? '<div style="font-size:11px;color:var(--suave)">$ ' + fmtUSD(m.precio_costo_moneda) + ' / u</div>' : '')
              : '<div>' + area + '</div>')
            + ((esEntrada ? m.empleado_recibe : m.empleado_recibe) ? '<div style="font-size:11px;color:#60a5fa">👤 Recibe: ' + (m.empleado_recibe?.nombre_completo||'') + '</div>' : '')
            + ((!esEntrada && m.empleado_entrega) ? '<div style="font-size:11px;color:#fb923c">👤 Entrega: ' + m.empleado_entrega.nombre_completo + '</div>' : '')
            + (m.observaciones ? '<div style="font-size:11px;color:var(--suave)">' + m.observaciones + '</div>' : '')
            + '</td>'
            + '<td style="text-align:center;padding:8px 0">'
            + (reversada
                ? '<span style="font-size:10px;font-weight:600;color:#fc8181">Reversada</span>'
                : '<span style="font-size:10px;color:#22c55e">Activa</span>')
            + '</td>'
            + '<td style="text-align:center;padding:8px 0">'
            + (function() {
                if (reversada) return '<span style="color:var(--suave);font-size:11px">—</span>';
                const soloLec = (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')) ? 'true' : 'false';
                if (m.id_entrada) return '<button class="btn-secundario" style="font-size:11px;padding:5px 10px" onclick="verFichaEntradaStock(' + m.id_entrada + ',' + m.id_articulo + ')">👁 Ver</button>';
                return '<button class="btn-secundario" style="font-size:11px;padding:5px 10px" onclick="editarMovimiento(\'SALIDA\',' + m.id_salida + ',' + m.id_articulo + ',' + soloLec + ')">👁 Ver</button>';
              })()
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } catch(err) {
    cont.innerHTML = '<div class="alerta alerta-error" style="display:block">Error: ' + err.message + '</div>';
  }
}

function retornarDesdeEditMovimiento() {
  const tipo = document.getElementById('edit-mov-tipo')?.value;
  cerrarModal('modal-edit-movimiento');
  if (tipo === 'ENTRADA' && _fichaInvActual && _fichaInvActual.id) {
    // Entradas: volver al historial
    verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
  }
  // Salidas y cualquier otro: quedar en Inventario General (no hace nada más)
}

async function verFichaEntradaStock(id_entrada, id_articulo) {
  // Verificar si existe CxP asociada y su estado de pago
  let estaPagado = false;
  try {
    const numDoc = 'ENT-' + id_entrada;
    const cxps = await api('cont_cxp', 'GET', null,
      '?numero_doc=like.' + encodeURIComponent(numDoc) + '%' + emisorQ() + '&select=id_cxp,estado,saldo_usd');
    if (cxps && cxps.length > 0) {
      // Pagado si TODAS las cuotas están PAGADA o saldo = 0
      estaPagado = cxps.every(function(c) {
        return c.estado === 'PAGADA' || parseFloat(c.saldo_usd || 0) <= 0;
      });
    }
  } catch(e) { console.warn('verFichaEntradaStock CxP check:', e.message); }

  await editarMovimiento('ENTRADA', id_entrada, id_articulo,
    estaPagado || (!sesionActual?.administrador && !puedo('INVENTARIO','EDITAR_STOCK')));
}

async function editarMovimiento(tipo, idMovimiento, id_articulo, soloLectura) {
  // Cargar datos del movimiento
  let m = null;
  try {
    if (tipo === 'ENTRADA') {
      const res = await api('stock_entradas', 'GET', null, '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),area_origen:id_area_origen(nombre,codigo),empleado_recibe:id_empleado(nombre_completo)');
      m = res[0];
    } else {
      const res = await api('stock_salidas', 'GET', null, '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),area_entrega:id_area_entrega(nombre,codigo),empleado_recibe:id_empleado(nombre_completo),empleado_entrega:id_empleado_entrega(nombre_completo)');
      m = res[0];
    }
  } catch(err) { alert('Error cargando movimiento: ' + err.message); return; }
  if (!m) return;

  // Cargar áreas
  let areas = [];
  try { areas = await api('param_areas', 'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'); } catch(e) {}

  document.getElementById('edit-mov-tipo').value        = tipo;
  document.getElementById('edit-mov-id').value          = idMovimiento;
  document.getElementById('edit-mov-id-articulo').value = id_articulo;
  document.getElementById('edit-mov-cantidad').value    = m.cantidad;
  document.getElementById('edit-mov-obs').value         = m.observaciones || '';

  // Título según modo
  const modoLabel = soloLectura ? '👁 FICHA ENTRADA' : (tipo === 'ENTRADA' ? '✏ EDITAR ENTRADA' : '✏ EDITAR SALIDA');
  document.getElementById('edit-mov-titulo').textContent = modoLabel + ' DE STOCK';
  document.getElementById('alerta-edit-mov-ok').style.display  = 'none';
  document.getElementById('alerta-edit-mov-err').style.display = 'none';

  // Precio costo solo para entradas
  const precioCont = document.getElementById('edit-mov-precio-cont');
  if (precioCont) precioCont.style.display = tipo === 'ENTRADA' ? 'block' : 'none';
  if (tipo === 'ENTRADA') {
    document.getElementById('edit-mov-precio').value = m.precio_costo_moneda ? parseFloat(m.precio_costo_moneda).toFixed(2) : '0.00';
    document.getElementById('edit-mov-moneda-cont') && (document.getElementById('edit-mov-moneda-cont').style.display = '');
    if (document.getElementById('edit-mov-moneda')) document.getElementById('edit-mov-moneda').value = m.moneda_compra || 'USD';
  }

  // Cargar áreas en selector
  const selArea = document.getElementById('edit-mov-area');
  selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
    + areas.map(function(a) {
        return '<option value="' + a.id + '"' + (m.id_area === a.id ? ' selected' : '') + '>'
          + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
      }).join('');

  // Cargar empleados del área actual
  if (m.id_area) {
    await cargarEmpleadosPorArea(m.id_area, 'edit-mov-empleado');
    document.getElementById('edit-mov-empleado').value = m.id_empleado || '';
  } else {
    document.getElementById('edit-mov-empleado').innerHTML = '<option value="">— Seleccionar área primero —</option>';
  }

  // ── Modo solo lectura: deshabilitar campos y ocultar contraseña/guardar ──
  const camposEditables = ['edit-mov-cantidad','edit-mov-precio','edit-mov-moneda','edit-mov-area','edit-mov-empleado','edit-mov-obs'];
  camposEditables.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = !!soloLectura;
  });
  const claveBox  = document.getElementById('edit-mov-clave')?.closest('.form-campo') || document.getElementById('edit-mov-clave')?.parentElement;
  const btnGuardar = document.querySelector('#modal-edit-movimiento .btn-primario');
  const badgePago  = document.getElementById('edit-mov-badge-pago');

  if (soloLectura) {
    if (claveBox)  claveBox.style.display  = 'none';
    if (btnGuardar) btnGuardar.style.display = 'none';
    if (badgePago) { badgePago.textContent = '✅ PAGADO'; badgePago.style.display = 'inline-block'; badgePago.style.color = '#22c55e'; badgePago.style.background = 'rgba(34,197,94,0.12)'; badgePago.style.borderRadius = '4px'; badgePago.style.padding = '3px 10px'; badgePago.style.fontSize = '11px'; badgePago.style.fontWeight = '700'; }
  } else {
    if (claveBox)  claveBox.style.display  = '';
    if (btnGuardar) btnGuardar.style.display = '';
    if (badgePago) badgePago.style.display = 'none';
    if (document.getElementById('edit-mov-clave')) document.getElementById('edit-mov-clave').value = '';
  }

  cerrarModal('modal-historial-stock');
  abrirModal('modal-edit-movimiento');
  focusFirstField('modal-edit-movimiento');
}

async function guardarEdicionMovimiento() {
  const tipo       = document.getElementById('edit-mov-tipo').value;
  const id         = document.getElementById('edit-mov-id').value;
  const id_articulo = parseInt(document.getElementById('edit-mov-id-articulo').value);
  const cantidad   = parseFloat(document.getElementById('edit-mov-cantidad').value);
  const id_area     = parseInt(document.getElementById('edit-mov-area').value) || null;
  const idEmp      = parseInt(document.getElementById('edit-mov-empleado').value) || null;
  const obs        = document.getElementById('edit-mov-obs').value.trim();
  const clave      = document.getElementById('edit-mov-clave')?.value || '';
  const okEl       = document.getElementById('alerta-edit-mov-ok');
  const errEl      = document.getElementById('alerta-edit-mov-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  if (!cantidad || cantidad <= 0) {
    errEl.textContent = 'La cantidad debe ser mayor a cero.';
    errEl.style.display = 'block';
    document.getElementById('edit-mov-cantidad')?.focus(); return;
  }

  // ── Validar contraseña del usuario que edita ──
  if (!clave) {
    errEl.textContent = 'Debe ingresar su contraseña para autorizar la modificación.';
    errEl.style.display = 'block';
    document.getElementById('edit-mov-clave')?.focus(); return;
  }
  try {
    const usuArr = await api('usuarios', 'GET', null,
      '?correo_usuario=eq.' + encodeURIComponent(sesionActual.correo_usuario) + '&select=contrasena');
    const verifEdit = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verifEdit.ok) {
      errEl.textContent = 'Contraseña incorrecta. No se puede autorizar la modificación.';
      errEl.style.display = 'block';
      document.getElementById('edit-mov-clave')?.focus(); return;
    }
  } catch(eV) {
    errEl.textContent = 'Error verificando contraseña: ' + eV.message;
    errEl.style.display = 'block'; return;
  }

  try {
    const datos = {
      cantidad:      cantidad,
      id_area:       id_area,
      id_empleado:   idEmp,
      observaciones: obs || null,
    };

    if (tipo === 'ENTRADA') {
      const precioRaw = document.getElementById('edit-mov-precio').value;
      const precio = precioRaw !== '' && !isNaN(precioRaw) ? parseFloat(precioRaw) : null;
      if (precio !== null) datos.precio_costo_moneda = precio;
      const monedaEdit = document.getElementById('edit-mov-moneda')?.value || 'USD';
      datos.moneda_compra = monedaEdit;

      // ── Leer cantidad original y stock ANTES de parchear ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_entradas', 'GET', null, '?id_entrada=eq.' + id + '&select=cantidad'),
        api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=stock_actual_articulo,precio_costo_moneda'),
      ]);
      const cantOriginal = parseFloat(movOrigArr[0]?.cantidad || cantidad);
      const art = artArr[0];

      // ── Aplicar PATCH a stock_entradas ──
      await api('stock_entradas', 'PATCH', datos, '?id_entrada=eq.' + id);

      // ── Recalcular stock y CPP ──
      if (art) {
        const stockActual = parseFloat(art.stock_actual_articulo) || 0;
        // stockActual en BD ya incluye cantOriginal — revertir y aplicar nueva cantidad
        const nuevoStock  = Math.max(0, parseFloat((stockActual - cantOriginal + cantidad).toFixed(4)));
        const patchInv    = { stock_actual_articulo: nuevoStock };

        if (precio !== null && !isNaN(precio)) {
          // Stock previo a esta entrada (sin contar cantOriginal)
          const stockPrevio     = Math.max(0, stockActual - cantOriginal);
          const valorPrevio     = stockPrevio > 0 ? stockPrevio * (parseFloat(art.precio_costo_moneda) || 0) : 0;
          const cpp             = nuevoStock > 0 ? (valorPrevio + cantidad * precio) / nuevoStock : precio;
          patchInv.precio_costo_moneda        = parseFloat(cpp.toFixed(4));
          patchInv.precio_costo_ultimo_moneda = precio;
        }

        await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);
      }
    } else {
      // ── Leer cantidad original y stock ANTES de parchear ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_salidas',     'GET', null, '?id_salida=eq.'   + id          + '&select=cantidad'),
        api('inventario_almacen','GET', null, '?id_articulo=eq.' + id_articulo + '&select=stock_actual_articulo'),
      ]);
      const cantOriginal = parseFloat(movOrigArr[0]?.cantidad || cantidad);
      const art = artArr[0];

      await api('stock_salidas', 'PATCH', datos, '?id_salida=eq.' + id);

      if (art) {
        const stockActual = parseFloat(art.stock_actual_articulo) || 0;
        // Salida: devolver la original y descontar la nueva
        const nuevoStock = stockActual + cantOriginal - cantidad;
        await api('inventario_almacen', 'PATCH',
          { stock_actual_articulo: Math.max(0, parseFloat(nuevoStock.toFixed(4))) },
          '?id_articulo=eq.' + id_articulo);
      }
    }

    okEl.textContent = '✓ Movimiento actualizado correctamente.';
    okEl.style.display = 'block';
    if (document.getElementById('edit-mov-clave')) document.getElementById('edit-mov-clave').value = '';
    setTimeout(async function() {
      // Refrescar cache del artículo desde BD
      try {
        const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
        if (fresh && fresh[0]) {
          const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
          if (i !== -1) inventarioCache[i] = fresh[0];
        }
      } catch(e) {}
      // Refrescar tabla principal en background
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      // Regresar al historial del artículo
      cerrarModal('modal-edit-movimiento');
      if (_fichaInvActual && _fichaInvActual.id) {
        verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
      }
    }, 900);
  } catch(err) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
}

async function reversarMovimiento(tipo, idMovimiento, cantidad, id_articulo) {
  if (!confirm('¿Reversar este movimiento de ' + cantidad + ' unidades? Se ajustará el stock y se anulará el asiento contable original.')) return;

  try {
    // 1. Leer artículo fresco desde BD
    const artArr = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
    const art = artArr[0];
    if (!art) { alert('Artículo no encontrado.'); return; }

    // 2. Verificar que no esté ya reversado
    let movOrig = null;
    if (tipo === 'ENTRADA') {
      const rows = await api('stock_entradas', 'GET', null,
        '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].reversada) { alert('Este movimiento ya fue reversado.'); return; }
      movOrig = rows[0];
    } else {
      const rows = await api('stock_salidas', 'GET', null,
        '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].reversada) { alert('Este movimiento ya fue reversado.'); return; }
      movOrig = rows[0];
    }

    // 3. Calcular nuevo stock
    const stockActual = parseFloat(art.stock_actual_articulo) || 0;
    let nuevoStock;
    if (tipo === 'ENTRADA') {
      nuevoStock = stockActual - parseFloat(cantidad);
      if (nuevoStock < 0) { alert('No se puede reversar: stock resultante negativo (' + nuevoStock.toFixed(2) + ').'); return; }
    } else {
      nuevoStock = stockActual + parseFloat(cantidad);
    }

    // 4. Actualizar stock + limpiar precios si queda en 0
    const patchInv = { stock_actual_articulo: nuevoStock };
    if (nuevoStock <= 0) {
      patchInv.stock_actual_articulo            = 0;
      patchInv.precio_costo_moneda        = 0;
      patchInv.precio_costo_ultimo_moneda = 0;
      patchInv.precio_venta_moneda        = 0;
    }
    await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);

    // 5. Marcar movimiento como reversado
    if (tipo === 'ENTRADA') {
      await api('stock_entradas', 'PATCH',
        { reversada: true, id_usuario_reversa: sesionActual?.correo_usuario || null },
        '?id_entrada=eq.' + idMovimiento);
    } else {
      await api('stock_salidas', 'PATCH',
        { reversada: true },
        '?id_salida=eq.' + idMovimiento);
    }

    // 6. Anular asiento contable original
    const refBuscar = tipo === 'ENTRADA' ? 'ENT-' + idMovimiento : 'SAL-' + idMovimiento;
    try {
      const asientos = await api('cont_asientos', 'GET', null,
        '?referencia=eq.' + refBuscar + emisorQ() + '&select=id_asiento,descripcion&estado=neq.ANULADO');
      if (asientos && asientos.length) {
        await api('cont_asientos', 'PATCH',
          { estado: 'ANULADO', descripcion: '[REVERSADO] ' + (asientos[0].descripcion || '') },
          '?id_asiento=eq.' + asientos[0].id_asiento);
      } else {
        console.warn('Reverso: no se encontró asiento activo para ' + refBuscar);
      }
    } catch(eAst) { console.warn('Error anulando asiento en reverso:', eAst); }

    // 6B. Anular CxP asociada si es reverso de entrada por compra
    if (tipo === 'ENTRADA') {
      try {
        const numDoc = 'ENT-' + idMovimiento;
        const cxps = await api('cont_cxp','GET',null,
          '?numero_doc=eq.'+encodeURIComponent(numDoc)+emisorQ()+'&estado=eq.PENDIENTE&select=id_cxp');
        if (cxps && cxps.length) {
          await api('cont_cxp','PATCH',
            { estado: 'ANULADA', observaciones: '[REVERSADO] ' },
            '?id_cxp=eq.' + cxps[0].id_cxp);
        }
      } catch(eCxP) { console.warn('Error anulando CxP en reverso:', eCxP); }
    }

    // 7. Actualizar cache con datos frescos desde BD
    try {
      const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
      if (fresh && fresh[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
        if (i !== -1) inventarioCache[i] = fresh[0];
      }
    } catch(e) {}

    // 8. Recargar vistas
    await recargarHistorial(id_articulo);
    renderInventario();

  } catch(err) { alert('Error al reversar: ' + err.message); }
}


// ══════════════════════════════════════════════════════════════
//  MÓDULO PROVEEDORES
// ══════════════════════════════════════════════════════════════
let proveedoresCache = [];

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
        + '<td><button class="btn-secundario" onclick="verFichaProveedor(' + p.id_proveedor + ')">Ver</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    c.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px">'
      + '<div class="tarjeta-stat" style="padding:14px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Total</div><div style="font-family:var(--font-display);font-size:26px;color:var(--naranja)">' + proveedores.length + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:14px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Activos</div><div style="font-family:var(--font-display);font-size:26px;color:var(--naranja)">' + activos + '</div></div>'
      + '<div class="tarjeta-stat" style="padding:14px"><div style="font-size:10px;color:var(--suave);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Inactivos</div><div style="font-family:var(--font-display);font-size:26px;color:var(--naranja)">' + inactivos + '</div></div>'
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
      + '<div class="tabla-container"><table style="table-layout:fixed;width:100%"><thead><tr>'
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
  if (!_empParamCache.bancos || !_empParamCache.bancos.length) {
    try {
      const bancos = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
      _empParamCache.bancos = bancos || [];
    } catch(e) { _empParamCache.bancos = []; }
  }

  const tipoLabel = { 'ORDINARIO':'Contribuyente Ordinario','ESPECIAL':'Contribuyente Especial','FORMAL':'Contribuyente Formal' };
  const tipoColor = { 'ORDINARIO':'badge-naranja','ESPECIAL':'badge-verde','FORMAL':'badge-gris' };

  document.getElementById('ficha-prov-contenido').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Nombre</div><div style="font-weight:600;font-size:15px">' + p.nombre + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">RIF</div><div style="font-family:var(--font-mono)">' + (p.rif||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Contribuyente</div><div>' + (p.tipo_contribuyente ? '<span class="badge ' + (tipoColor[p.tipo_contribuyente]||'badge-gris') + '">' + (tipoLabel[p.tipo_contribuyente]||p.tipo_contribuyente) + '</span>' : '—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo Proveedor</div><div><span class="badge ' + (p.tipo_proveedor === 'NACIONAL' ? 'badge-naranja' : 'badge-gris') + '">' + (p.tipo_proveedor||'NACIONAL') + '</span></div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Teléfono</div><div>' + (p.telefono||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Correo</div><div>' + (p.correo||'—') + '</div></div>'
    + '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Dirección</div><div>' + (p.direccion||'—') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Moneda Facturación</div><div style="font-family:var(--font-mono)">' + (p.moneda_facturacion||'USD') + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Días de Crédito</div><div>' + (p.dias_credito||0) + ' días</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Límite de Crédito</div><div style="font-family:var(--font-mono);color:var(--naranja)">$ ' + fmtUSD(p.limite_credito||0) + '</div></div>'
    + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Estado</div><div><span class="badge ' + (p.estado === 'ACTIVO' ? 'badge-verde' : 'badge-rojo') + '">' + (p.estado||'ACTIVO') + '</span></div></div>'
    + (p.observaciones ? '<div style="grid-column:1/-1"><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Observaciones</div><div style="background:var(--gris2);border-radius:6px;padding:10px 14px;font-size:13px">' + p.observaciones + '</div></div>' : '')
    // ── Datos Bancarios ──
    + (p.id_banco || p.numero_cuenta ? '<div style="grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid var(--borde)"><div style="font-size:10px;color:var(--naranja);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;font-weight:600">🏦 Datos Bancarios</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Institución Financiera</div><div>' + ((_empParamCache.bancos||[]).find(function(b){return b.id===p.id_banco;})?.nombre || '—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Tipo de Cuenta</div><div>' + (p.tipo_cuenta||'—') + '</div></div>'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Número de Cuenta</div><div style="font-family:var(--font-mono)">' + (p.numero_cuenta||'—') + '</div></div>'
      + '</div></div>' : '')
    // ── Pago Móvil ──
    + (p.pm_id_banco || p.pm_celular ? '<div style="grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid var(--borde)"><div style="font-size:10px;color:var(--naranja);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;font-weight:600">📱 Pago Móvil</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">'
      + '<div><div style="font-size:9px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Banco</div><div>' + ((_empParamCache.bancos||[]).find(function(b){return b.id===p.pm_id_banco;})?.nombre || '—') + '</div></div>'
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


// ── Helpers banco proveedor ──
function onSelBancoProveedor() {
  var sel     = document.getElementById('prov-banco');
  var codEl   = document.getElementById('prov-cod-banco');
  var restoEl = document.getElementById('prov-num-cuenta-resto');
  if (!sel || !codEl) return;
  var id_banco = parseInt(sel.value);
  var banco   = (_empParamCache.bancos || []).find(function(b){ return b.id === id_banco; });
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
  var bancos = _empParamCache.bancos || [];
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
  if (!_empParamCache.bancos || !_empParamCache.bancos.length) {
    try {
      const bancos = await api('param_bancos','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
      _empParamCache.bancos = bancos || [];
    } catch(e) { _empParamCache.bancos = []; }
  }
  cargarBancosProveedor(p ? (p.id_banco||null) : null, p ? (p.pm_id_banco||null) : null);
  // Cargar categorías de proveedor
  try {
    const cats = await api('param_categorias_proveedor','GET',null,'?estado=eq.ACTIVO&order=nombre.asc&select=id,nombre,codigo');
    const selCat = document.getElementById('prov-categoria');
    if (selCat) {
      selCat.innerHTML = '<option value="">— Seleccionar —</option>'
        + (cats||[]).map(function(c){
            return '<option value="'+c.id+'"'+(c.id===(p?.id_categoria_articulo)?' selected':'')+'>'+c.nombre+'</option>';
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



