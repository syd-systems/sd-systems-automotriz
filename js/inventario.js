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
          const anulada = !!m.anulada;
          const areaRec = m.area_receptora || m.param_areas;
          const area = areaRec ? areaRec.nombre + (areaRec.codigo ? ' (' + areaRec.codigo + ')' : '') : '—';
          return '<tr style="opacity:' + (anulada ? '0.5' : '1') + '">'
            + '<td style="padding:8px 0;font-size:12px;color:var(--suave)">' + (m.fecha||'—') + '</td>'
            + '<td style="padding:8px"><span class="badge ' + (esEntrada ? 'badge-verde' : 'badge-rojo') + '">'
            + (esEntrada ? '▲ Entrada' : '▼ Salida') + '</span>'
            + (anulada ? '<div style="font-size:10px;color:#fc8181;margin-top:2px">Anulada</div>' : '') + '</td>'
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
            + (anulada
                ? '<span style="font-size:10px;font-weight:600;color:#fc8181">Anulada</span>'
                : '<span style="font-size:10px;color:#22c55e">Activa</span>')
            + '</td>'
            + '<td style="text-align:center;padding:8px 0">'
            + (function() {
                if (anulada) return '<span style="color:var(--suave);font-size:11px">—</span>';
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
  cerrarModal('modal-edit-movimiento');
  // Flujo 3: siempre volver al Historial de Movimientos
  if (_fichaInvActual && _fichaInvActual.id) {
    verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
  }
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
  let m = null;
  try {
    if (tipo === 'ENTRADA') {
      const res = await api('stock_entradas', 'GET', null,
        '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo)');
      m = res[0];
    } else {
      const res = await api('stock_salidas', 'GET', null,
        '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo)');
      m = res[0];
    }
  } catch(err) { alert('Error cargando movimiento: ' + err.message); return; }
  if (!m) return;

  // Cargar áreas y proveedores en paralelo
  let areas = [], proveedores = [];
  try {
    [areas, proveedores] = await Promise.all([
      api('param_areas',    'GET', null, '?estado=eq.ACTIVO&order=codigo.asc,nombre.asc'),
      api('proveedores',    'GET', null, '?estado=eq.ACTIVO&order=nombre.asc&select=id_proveedor,nombre,rif')
    ]);
  } catch(e) {}

  // Campos básicos
  document.getElementById('edit-mov-tipo').value        = tipo;
  document.getElementById('edit-mov-id').value          = idMovimiento;
  document.getElementById('edit-mov-id-articulo').value = id_articulo;
  document.getElementById('edit-mov-cantidad').value    = parseFloat(m.cantidad || 0).toFixed(2);
  const obsEl = document.getElementById('edit-mov-observaciones') || document.getElementById('edit-mov-obs');
  if (obsEl) obsEl.value = m.observaciones || '';
  const okEl  = document.getElementById('alerta-edit-mov-ok')  || document.getElementById('alerta-es-ok');
  const errEl = document.getElementById('alerta-edit-mov-err') || document.getElementById('alerta-es-err');
  if (okEl)  okEl.style.display  = 'none';
  if (errEl) errEl.style.display = 'none';

  // Artículo y Stock
  const artNombreEl = document.getElementById('edit-mov-art-nombre');
  const artStockEl  = document.getElementById('edit-mov-stock-actual');
  try {
    const artData = await api('inventario_almacen','GET',null,'?id_articulo=eq.'+id_articulo+'&select=nombre_articulo,stock_actual_articulo&limit=1');
    if (artData && artData[0]) {
      if (artNombreEl) artNombreEl.textContent = artData[0].nombre_articulo || '—';
      if (artStockEl)  artStockEl.textContent  = parseFloat(artData[0].stock_actual_articulo||0).toFixed(2) + ' UND';
    }
  } catch(e) {}

  // Tasa BCV y montos calculados (solo para ENTRADA)
  if (tipo === 'ENTRADA') {
    const tasaEl = document.getElementById('edit-mov-tasa-bcv');
    const tasa   = parseFloat(m.tasa_bcv_usada || m.tasa_bcv || 0);
    if (tasaEl) tasaEl.value = tasa > 0 ? tasa.toFixed(4) : '';
    const precio   = parseFloat(m.precio_costo_moneda || 0);
    const cantidad = parseFloat(m.cantidad || 0);
    const montoTotal = precio * cantidad;
    const montoTotalEl = document.getElementById('edit-mov-monto-total');
    if (montoTotalEl) montoTotalEl.value = fmtBs(montoTotal);
    const moneda = m.moneda_compra || 'USD';
    const calcEl = document.getElementById('edit-mov-precio-usd-calc');
    if (calcEl && tasa > 0) {
      calcEl.value = moneda === 'VES' ? fmtBs(montoTotal / tasa) : fmtBs(montoTotal * tasa);
    }
    // Tasa cont y tributos
    const tasaCont = document.getElementById('edit-mov-tasa-cont');
    if (tasaCont) tasaCont.style.display = '';
  }

  // Usuario confirmación
  const recNombreEl = document.getElementById('edit-mov-receptor-nombre');
  const recAreaEl   = document.getElementById('edit-mov-receptor-area');
  if (recNombreEl) recNombreEl.textContent = sesionActual?.nombre || sesionActual?.correo_usuario || '—';
  if (recAreaEl)   recAreaEl.textContent   = sesionActual?.nombre_area || '';

  // Reset completo de campos dinámicos antes de cargar
  ['edit-mov-proveedor-cont','edit-mov-cliente-cont','edit-mov-area-origen-cont',
   'edit-mov-pago-cont','edit-mov-precios-cont','edit-mov-moneda-cont',
   'edit-mov-motivo-cont','edit-mov-precio-cont'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Título
  const modoLabel = soloLectura ? '👁 FICHA ENTRADA' : (tipo === 'ENTRADA' ? '✏ EDITAR ENTRADA' : '✏ EDITAR SALIDA');
  document.getElementById('edit-mov-titulo').textContent = modoLabel + ' DE STOCK';

  // Mostrar/ocultar campos según tipo
  const camposEntrada = ['edit-mov-moneda-cont','edit-mov-motivo-cont','edit-mov-precios-cont'];
  camposEntrada.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = tipo === 'ENTRADA' ? '' : 'none';
  });

  // Botón Anular — visible si no está anulada y tiene permiso
  const btnAnular = document.getElementById('btn-anular-movimiento');
  if (btnAnular) {
    const permAnular = tipo === 'ENTRADA'
      ? (sesionActual?.administrador || puedo('INVENTARIO','ANULAR_ENTRADA'))
      : (sesionActual?.administrador || puedo('INVENTARIO','ANULAR_SALIDA'));
    btnAnular.style.display = (!m.anulada && permAnular) ? '' : 'none';
  }

  // Fecha — siempre visible para ENTRADA y SALIDA
  const fechaNeg = document.getElementById('edit-mov-fecha-negociacion');
  const fechaLbl = document.getElementById('edit-mov-fecha-label');
  if (tipo === 'ENTRADA') {
    if (fechaLbl) fechaLbl.textContent = 'Fecha Negociación *';
    if (fechaNeg) fechaNeg.value = m.fecha_negociacion || m.fecha_entrada?.slice(0,10) || getHoyVzla();
  } else {
    if (fechaLbl) fechaLbl.textContent = 'Fecha de Salida *';
    if (fechaNeg) fechaNeg.value = m.fecha_salida?.slice(0,10) || getHoyVzla();
  }

  // Campos solo para ENTRADA
  const esEntrada = tipo === 'ENTRADA';
  document.getElementById('edit-mov-precios-cont').style.display   = esEntrada ? '' : 'none';
  document.getElementById('edit-mov-pago-cont').style.display      = esEntrada ? '' : 'none';

  if (esEntrada) {
    // Moneda
    const selMoneda = document.getElementById('edit-mov-moneda');
    if (selMoneda) selMoneda.value = m.moneda_compra || 'USD';
    const lblMoneda = document.getElementById('edit-mov-label-moneda');
    if (lblMoneda) lblMoneda.textContent = '(' + (m.moneda_compra || 'USD') + ')';

    // Precio
    document.getElementById('edit-mov-precio').value = m.precio_costo_moneda
      ? parseFloat(m.precio_costo_moneda).toFixed(2) : '0.00';
    // Precio Venta
    const pvEl = document.getElementById('edit-mov-precio-venta');
    if (pvEl) pvEl.value = m.precio_venta_moneda ? parseFloat(m.precio_venta_moneda).toFixed(2) : '';

    // Transacción (motivo) — inferir si es null en registros anteriores
    let motivoInferido = m.motivo || '';
    if (!motivoInferido) {
      if (m.id_proveedor)   motivoInferido = 'compra';
      else if (m.cliente_nombre) motivoInferido = 'devolucion';
      else if (m.id_area_origen) motivoInferido = 'transferencia';
    }
    const selMotivo = document.getElementById('edit-mov-motivo');
    if (selMotivo) selMotivo.value = motivoInferido;

    // Mostrar campo dinámico según motivo
    const motivo = motivoInferido;
    document.getElementById('edit-mov-proveedor-cont').style.display    = motivo === 'compra'        ? '' : 'none';
    document.getElementById('edit-mov-cliente-cont').style.display      = motivo === 'devolucion'    ? '' : 'none';
    document.getElementById('edit-mov-area-origen-cont').style.display  = motivo === 'transferencia' ? '' : 'none';

    // Mostrar tributos IVA si es compra
    const tribuCont = document.getElementById('edit-mov-tributos-cont');
    if (tribuCont) tribuCont.style.display = motivo === 'compra' ? '' : 'none';

    // Proveedor
    const selProv = document.getElementById('edit-mov-proveedor');
    if (selProv) {
      selProv.innerHTML = '<option value="">— Seleccionar proveedor —</option>'
        + proveedores.map(function(p) {
            return '<option value="' + p.id_proveedor + '"' + (m.id_proveedor == p.id_proveedor ? ' selected' : '') + '>'
              + p.nombre + (p.rif ? ' (' + p.rif + ')' : '') + '</option>';
          }).join('');
    }
    // Cliente
    const clienteEl = document.getElementById('edit-mov-cliente');
    if (clienteEl) clienteEl.value = m.cliente_nombre || '';
    // Área origen
    const selOrig = document.getElementById('edit-mov-area-origen');
    if (selOrig) {
      selOrig.innerHTML = '<option value="">— Seleccionar área —</option>'
        + areas.map(function(a) {
            return '<option value="' + a.id + '"' + (m.id_area_origen == a.id ? ' selected' : '') + '>'
              + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
          }).join('');
    }
    // Precio Venta
    // Modalidad de Pago — inferir desde CxP si es null
    let esquemaPago = m.esquema_pago || '';
    if (!esquemaPago) {
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&select=id_cxp&limit=2');
        esquemaPago = (cxps && cxps.length > 1) ? 'CREDITO' : (cxps && cxps.length === 1 ? 'CONTADO' : '');
      } catch(e) {}
    }
    const selPago = document.getElementById('edit-mov-esquema-pago');
    if (selPago) selPago.value = esquemaPago;

    // Mostrar Condiciones de Crédito si aplica
    const creditoCont = document.getElementById('edit-mov-credito-cont');
    // Limpiar siempre los campos de crédito antes de cargar
    const numElC  = document.getElementById('edit-mov-cuotas-num');
    const fechaElC = document.getElementById('edit-mov-cuotas-fecha');
    const montoElC = document.getElementById('edit-mov-cuotas-monto');
    const intElC  = document.getElementById('edit-mov-cuotas-intervalo');
    const prevElC = document.getElementById('edit-mov-cuotas-preview');
    if (numElC)   numElC.value   = '';
    if (fechaElC) fechaElC.value = '';
    if (montoElC) montoElC.value = '';
    if (intElC)   intElC.value   = '30';
    if (prevElC)  prevElC.innerHTML = '';

    if (creditoCont) creditoCont.style.display = esquemaPago === 'CREDITO' ? '' : 'none';
    if (esquemaPago === 'CREDITO') {
      try {
        const _urlCuotas = '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&order=fecha_vencimiento.asc&select=monto_usd,fecha_vencimiento';
        console.log('[SYD] buscando cuotas URL:', _urlCuotas);
        const cuotasExist = await api('cont_cxp', 'GET', null, _urlCuotas);
        console.log('[SYD] cuotasExist:', JSON.stringify(cuotasExist));
        if (cuotasExist && cuotasExist.length > 0) {
          const numEl   = document.getElementById('edit-mov-cuotas-num');
          const fechaEl = document.getElementById('edit-mov-cuotas-fecha');
          const montoEl = document.getElementById('edit-mov-cuotas-monto');
          if (numEl)   numEl.value   = cuotasExist.length;
          if (fechaEl) fechaEl.value = cuotasExist[0].fecha_vencimiento?.slice(0,10) || '';
          if (montoEl) montoEl.value = parseFloat(cuotasExist[0].monto_usd || 0).toFixed(2);
          // Intervalo: calcular desde fechas si hay más de una cuota
          if (cuotasExist.length > 1) {
            const f1 = new Date(cuotasExist[0].fecha_vencimiento + 'T00:00:00');
            const f2 = new Date(cuotasExist[1].fecha_vencimiento + 'T00:00:00');
            const diff = Math.round((f2 - f1) / (1000*60*60*24));
            const intEl = document.getElementById('edit-mov-cuotas-intervalo');
            if (intEl && diff > 0) intEl.value = diff;
          }
          setTimeout(calcularCuotasEdit, 150);
        }
      } catch(e) {}
    }
  }  // fin if (esEntrada)

  // Área receptora
  const selArea = document.getElementById('edit-mov-area');
  if (selArea) {
    selArea.innerHTML = '<option value="">— Seleccionar área —</option>'
      + areas.map(function(a) {
          return '<option value="' + a.id + '"' + (m.id_area == a.id ? ' selected' : '') + '>'
            + a.nombre + (a.codigo ? ' (' + a.codigo + ')' : '') + '</option>';
        }).join('');
  }

  // Empleado receptor
  if (m.id_area) {
    await cargarEmpleadosPorArea(m.id_area, 'edit-mov-empleado');
    const empEl = document.getElementById('edit-mov-empleado'); if (empEl) empEl.value = m.id_empleado || '';
  } else {
    const empEl2 = document.getElementById('edit-mov-empleado'); if (empEl2) empEl2.innerHTML = '<option value="">— Seleccionar área primero —</option>';
  }

  // ── Modo solo lectura ──
  const campos = ['edit-mov-fecha-negociacion','edit-mov-moneda','edit-mov-cantidad',
    'edit-mov-precio','edit-mov-precio-venta','edit-mov-motivo','edit-mov-proveedor',
    'edit-mov-cliente','edit-mov-area-origen','edit-mov-area','edit-mov-empleado',
    'edit-mov-esquema-pago','edit-mov-obs'];
  campos.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = !!soloLectura;
  });

  const claveBox   = document.getElementById('edit-mov-clave-cont');
  const btnGuardar = document.querySelector('#modal-edit-movimiento .btn-primario');
  const badgePago  = document.getElementById('edit-mov-badge-pago');

  if (soloLectura) {
    if (claveBox)   claveBox.style.display   = 'none';
    if (btnGuardar) btnGuardar.style.display = 'none';
    if (badgePago) {
      badgePago.textContent = '✅ PAGADO';
      badgePago.style.cssText = 'display:inline-block;color:#22c55e;background:rgba(34,197,94,0.12);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:700';
    }
  } else {
    if (claveBox)   claveBox.style.display   = '';
    if (btnGuardar) btnGuardar.style.display = '';
    if (badgePago)  badgePago.style.display  = 'none';
    const claveEl = document.getElementById('edit-mov-clave');
    if (claveEl) claveEl.value = '';
  }

  const modalHist = document.getElementById('modal-historial-stock');
  if (modalHist) { modalHist.classList.remove('abierto'); modalHist.style.display = 'none'; }
  abrirModal('modal-edit-movimiento');
  focusFirstField('modal-edit-movimiento');
}

async function anularDesdeEdicion() {
  const tipo        = document.getElementById('edit-mov-tipo').value;
  const id          = parseInt(document.getElementById('edit-mov-id').value);
  const id_articulo = parseInt(document.getElementById('edit-mov-id-articulo').value);
  const cantidad    = parseFloat(document.getElementById('edit-mov-cantidad').value) || 0;

  if (!confirm('¿Anular este movimiento? Esta acción revertirá el stock y los asientos contables.')) return;

  // Cerrar modal de edición antes de abrir modal de anulación
  cerrarModal('modal-edit-movimiento');

  if (tipo === 'ENTRADA') {
    await reversarMovimiento('ENTRADA', id, cantidad, id_articulo);
  } else {
    await reversarSalida(id, id_articulo, cantidad);
  }
}


async function guardarEdicionMovimiento() {
  const tipo        = document.getElementById('edit-mov-tipo').value;
  const id_area     = parseInt(document.getElementById('edit-mov-area').value) || null;
  const idEmp       = parseInt(document.getElementById('edit-mov-empleado').value) || null;
  const obs         = document.getElementById('edit-mov-obs').value.trim();
  const clave       = document.getElementById('edit-mov-clave')?.value || '';
  const okEl        = document.getElementById('alerta-edit-mov-ok');
  const errEl       = document.getElementById('alerta-edit-mov-err');
  okEl.style.display = 'none'; errEl.style.display = 'none';

  const mostrarError = function(msg, focusId) {
    errEl.textContent = msg; errEl.style.display = 'block';
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
  };

  // ── Validaciones en orden de pantalla ──
  if (tipo === 'ENTRADA') {
    const fechaNeg = document.getElementById('edit-mov-fecha-negociacion')?.value;
    const hoy      = getHoyVzla();
    if (!fechaNeg)         return mostrarError('Seleccione la Fecha Negociación.', 'edit-mov-fecha-negociacion');
    if (fechaNeg > hoy)    return mostrarError('La Fecha Negociación no puede ser mayor al día de hoy.', 'edit-mov-fecha-negociacion');
    const monedaSel = document.getElementById('edit-mov-moneda')?.value;
    if (!monedaSel)        return mostrarError('Seleccione la Moneda Negociación.', 'edit-mov-moneda');
  }
  if (!cantidad || cantidad <= 0) return mostrarError('La cantidad debe ser mayor a cero.', 'edit-mov-cantidad');
  if (tipo === 'ENTRADA') {
    const precioVal = parseFloat(document.getElementById('edit-mov-precio')?.value) || 0;
    if (precioVal <= 0)    return mostrarError('Ingrese el Precio Negociación.', 'edit-mov-precio');
    const motivoSel = document.getElementById('edit-mov-motivo')?.value;
    if (!motivoSel)        return mostrarError('Seleccione la Transacción.', 'edit-mov-motivo');
    if (motivoSel === 'compra' && !document.getElementById('edit-mov-proveedor')?.value)
                           return mostrarError('Seleccione el Proveedor.', 'edit-mov-proveedor');
    if (motivoSel === 'devolucion' && !document.getElementById('edit-mov-cliente')?.value?.trim())
                           return mostrarError('Ingrese el nombre del cliente.', 'edit-mov-cliente');
    if (motivoSel === 'transferencia' && !document.getElementById('edit-mov-area-origen')?.value)
                           return mostrarError('Seleccione el Área de Origen.', 'edit-mov-area-origen');
    const pagoSel = document.getElementById('edit-mov-esquema-pago')?.value;
    if (!pagoSel) return mostrarError('Seleccione la Modalidad de Pago.', 'edit-mov-esquema-pago');
    if (pagoSel === 'CREDITO') {
      const numCuotasVal  = parseInt(document.getElementById('edit-mov-cuotas-num')?.value) || 0;
      const fechaCuotaVal = document.getElementById('edit-mov-cuotas-fecha')?.value || '';
      if (!numCuotasVal || numCuotasVal < 1) return mostrarError('Ingrese el número de cuotas.', 'edit-mov-cuotas-num');
      if (!fechaCuotaVal) return mostrarError('Ingrese la Fecha de la Primera Cuota.', 'edit-mov-cuotas-fecha');
      if (fechaCuotaVal <= getHoyVzla()) return mostrarError('La Fecha de la Primera Cuota tiene que ser mayor que el día de hoy.', 'edit-mov-cuotas-fecha');
    }
  }
  if (!clave) return mostrarError('Ingrese su contraseña para autorizar.', 'edit-mov-clave');

  // ── Verificar contraseña ──
  try {
    const verifEdit = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verifEdit.ok) return mostrarError('Contraseña incorrecta.', 'edit-mov-clave');
  } catch(eV) { return mostrarError('Error verificando contraseña: ' + eV.message); }

  try {
    const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });

    const datos = {
      cantidad:      cantidad,
      id_area:       id_area,
      id_empleado:   idEmp,
      observaciones: obs || null,
    };

    if (tipo === 'ENTRADA') {
      const precioRaw  = document.getElementById('edit-mov-precio').value;
      const precio     = precioRaw !== '' && !isNaN(precioRaw) ? parseFloat(precioRaw) : null;
      const monedaEdit = document.getElementById('edit-mov-moneda')?.value || 'USD';
      const fechaNeg   = document.getElementById('edit-mov-fecha-negociacion')?.value || getHoyVzla();
      const motivoEdit = document.getElementById('edit-mov-motivo')?.value || '';
      const provEdit   = parseInt(document.getElementById('edit-mov-proveedor')?.value) || null;
      const clienteEdit = document.getElementById('edit-mov-cliente')?.value?.trim() || null;
      const areaOrig   = parseInt(document.getElementById('edit-mov-area-origen')?.value) || null;
      const pagoEdit   = document.getElementById('edit-mov-esquema-pago')?.value || '';
      const pvEdit     = parseFloat(document.getElementById('edit-mov-precio-venta')?.value) || null;

      if (precio !== null) datos.precio_costo_moneda = precio;
      datos.moneda_compra       = monedaEdit;
      datos.fecha_negociacion   = fechaNeg;
      datos.motivo              = motivoEdit;
      datos.id_proveedor        = provEdit;
      datos.cliente_nombre      = clienteEdit;
      datos.id_area_origen      = areaOrig;
      datos.esquema_pago        = pagoEdit;
      if (pvEdit) datos.precio_venta_moneda = pvEdit;

      // ── Leer cantidad original y stock ANTES de parchear ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_entradas', 'GET', null, '?id_entrada=eq.' + id + '&select=cantidad'),
        api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=stock_actual_articulo,precio_costo_moneda'),
      ]);
      const cantOriginal = parseFloat(movOrigArr[0]?.cantidad || cantidad);
      const art = artArr[0];

      // ── PATCH a stock_entradas ──
      await api('stock_entradas', 'PATCH', datos, '?id_entrada=eq.' + id);

      // ── Recalcular stock y CPP en inventario_almacen ──
      if (art) {
        const stockActual = parseFloat(art.stock_actual_articulo) || 0;
        const nuevoStock  = Math.max(0, parseFloat((stockActual - cantOriginal + cantidad).toFixed(4)));
        const patchInv    = { stock_actual_articulo: nuevoStock };
        if (pvEdit) patchInv.precio_venta_moneda = pvEdit;

        if (precio !== null && !isNaN(precio)) {
          const stockPrevio = Math.max(0, stockActual - cantOriginal);
          const valorPrevio = stockPrevio > 0 ? stockPrevio * (parseFloat(art.precio_costo_moneda) || 0) : 0;
          const cpp         = nuevoStock > 0 ? (valorPrevio + cantidad * precio) / nuevoStock : precio;
          patchInv.precio_costo_moneda        = parseFloat(cpp.toFixed(4));
          patchInv.precio_costo_ultimo_moneda = precio;
        }
        await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);
      }

      // ── Corregir asiento contable ──
      try {
        const ref = 'ENT-' + id;
        const asientos = await api('cont_asientos', 'GET', null,
          '?referencia=eq.' + ref + emisorQ() + '&estado=neq.ANULADO&select=id_asiento,tasa_bcv');
        if (asientos && asientos.length) {
          const idAst   = asientos[0].id_asiento;
          const tasaAst = parseFloat(asientos[0].tasa_bcv) || 1;
          const precioFinal = precio !== null ? precio : parseFloat(art?.precio_costo_moneda || 0);
          const montoUSD = parseFloat((cantidad * precioFinal).toFixed(2));
          const montoVES = parseFloat((montoUSD * tasaAst).toFixed(2));
          const lineas = await api('cont_asiento_lineas', 'GET', null,
            '?id_asiento=eq.' + idAst + '&order=orden.asc&select=id_linea,debe_usd,haber_usd,debe_ves,haber_ves');
          for (const linea of (lineas || [])) {
            const pl = {};
            if (parseFloat(linea.debe_usd)  > 0) pl.debe_usd  = montoUSD;
            if (parseFloat(linea.haber_usd) > 0) pl.haber_usd = montoUSD;
            if (parseFloat(linea.debe_ves)  > 0) pl.debe_ves  = montoVES;
            if (parseFloat(linea.haber_ves) > 0) pl.haber_ves = montoVES;
            if (Object.keys(pl).length) await api('cont_asiento_lineas', 'PATCH', pl, '?id_linea=eq.' + linea.id_linea);
          }
          await api('cont_asientos', 'PATCH',
            { fecha: fechaNeg, descripcion: 'Compra Inventario (editado): ' + (r?.nombre_articulo || '') },
            '?id_asiento=eq.' + idAst);
        }
      } catch(eAstEdit) { console.warn('Error corrigiendo asiento:', eAstEdit); }

      // ── Actualizar CxP asociada ──
      try {
        const numDocBase = 'ENT-' + id;
        const artNom = r?.nombre_articulo || ('Art#' + id_articulo);
        const precioFinal2 = precio !== null ? precio : parseFloat(art?.precio_costo_moneda || 0);
        const nuevoMontoUSD = parseFloat((cantidad * precioFinal2).toFixed(2));

        // Eliminar CxP existentes PENDIENTES para esta entrada
        const cxpsExist = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent(numDocBase + '*') + emisorQ() + '&estado=eq.PENDIENTE&select=id_cxp');
        for (const cx of (cxpsExist || [])) {
          await api('cont_cxp', 'DELETE', null, '?id_cxp=eq.' + cx.id_cxp);
        }

        const idProvEdit = provEdit || null;
        const tasaEdit = parseFloat(art?.tasa_bcv || 1);

        if (pagoEdit === 'CREDITO') {
          // Crear cuotas desde el preview
          const prevEl = document.getElementById('edit-mov-cuotas-preview');
          const cuotasData = prevEl?.dataset?.cuotas ? JSON.parse(prevEl.dataset.cuotas) : [];
          if (cuotasData.length) {
            for (const c of cuotasData) {
              await api('cont_cxp', 'POST', {
                id_proveedor:    idProvEdit,
                id_empresa:      _empresaActiva?.id_empresa || null,
                id_cuenta_gasto: r?.id_cuenta_costo_gasto || null,
                tipo:            'COMPRA_ARTICULO_CREDITO',
                numero_doc:      numDocBase + '-C' + c.num,
                fecha_emision:   fechaNeg,
                fecha_vencimiento: c.fecha,
                moneda_pago:     monedaEdit || 'USD',
                estado:          'PENDIENTE',
                monto_usd:       parseFloat(c.monto.toFixed(2)),
                monto_ves:       parseFloat((c.monto * tasaEdit).toFixed(2)),
                tasa_bcv:        tasaEdit,
                tasa_bcv_compra: tasaEdit,
                pagado_usd:      0,
                saldo_usd:       parseFloat(c.monto.toFixed(2)),
                observaciones:   artNom + ' x ' + cantidad + ' uds.',
                esquema_pago:    'CREDITO',
                id_usuario:      sesionActual?.correo_usuario || null
              });
            }
          }
        } else {
          // CONTADO — una sola CxP
          await api('cont_cxp', 'POST', {
            id_proveedor:    idProvEdit,
            id_empresa:      _empresaActiva?.id_empresa || null,
            id_cuenta_gasto: r?.id_cuenta_costo_gasto || null,
            tipo:            'COMPRA_ARTICULO',
            numero_doc:      numDocBase,
            fecha_emision:   fechaNeg,
            fecha_vencimiento: fechaNeg,
            moneda_pago:     monedaEdit || 'USD',
            estado:          'PENDIENTE',
            monto_usd:       nuevoMontoUSD,
            monto_ves:       parseFloat((nuevoMontoUSD * tasaEdit).toFixed(2)),
            tasa_bcv:        tasaEdit,
            tasa_bcv_compra: tasaEdit,
            pagado_usd:      0,
            saldo_usd:       nuevoMontoUSD,
            observaciones:   artNom + ' x ' + cantidad + ' uds.',
            esquema_pago:    'CONTADO',
            id_usuario:      sesionActual?.correo_usuario || null
          });
        }
      } catch(eCxPEdit) { console.warn('Error actualizando CxP:', eCxPEdit); }

    } else {
      // ── SALIDA ──
      const [movOrigArr, artArr] = await Promise.all([
        api('stock_salidas',     'GET', null, '?id_salida=eq.'    + id          + '&select=cantidad'),
        api('inventario_almacen','GET', null, '?id_articulo=eq.'  + id_articulo + '&select=stock_actual_articulo'),
      ]);
      const cantOriginal = parseFloat(movOrigArr[0]?.cantidad || cantidad);
      const art = artArr[0];
      await api('stock_salidas', 'PATCH', datos, '?id_salida=eq.' + id);
      if (art) {
        const stockActual = parseFloat(art.stock_actual_articulo) || 0;
        const nuevoStock  = Math.max(0, parseFloat((stockActual + cantOriginal - cantidad).toFixed(4)));
        await api('inventario_almacen', 'PATCH',
          { stock_actual_articulo: nuevoStock }, '?id_articulo=eq.' + id_articulo);
      }
    }

    // ── Actualizar cache ──
    try {
      const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
      if (fresh && fresh[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
        if (i !== -1) inventarioCache[i] = fresh[0];
      }
    } catch(e) {}

    okEl.textContent = '✓ Movimiento actualizado correctamente.';
    okEl.style.display = 'block';
    if (document.getElementById('edit-mov-clave')) document.getElementById('edit-mov-clave').value = '';

    setTimeout(async function() {
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      cerrarModal('modal-edit-movimiento');
      if (_fichaInvActual && _fichaInvActual.id) verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
    }, 900);

  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
  }
}


function onCambioEsquemaPagoEdit() {
  const esquema = document.getElementById('edit-mov-esquema-pago')?.value;
  const cont    = document.getElementById('edit-mov-credito-cont');
  if (cont) cont.style.display = esquema === 'CREDITO' ? '' : 'none';
  if (esquema === 'CREDITO') calcularCuotasEdit();
}

function calcularCuotasEdit() {
  const numCuotas   = parseInt(document.getElementById('edit-mov-cuotas-num')?.value) || 0;
  const fechaInicio = document.getElementById('edit-mov-cuotas-fecha')?.value || '';
  const intervalo   = parseInt(document.getElementById('edit-mov-cuotas-intervalo')?.value) || 30;
  const precio      = parseFloat(document.getElementById('edit-mov-precio')?.value) || 0;
  const cantidad    = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const montoCuotaInput = parseFloat(document.getElementById('edit-mov-cuotas-monto')?.value) || 0;
  // Calcular total: precio*cantidad si disponible, o monto cuota * num cuotas como fallback
  let totalUSD = parseFloat((precio * cantidad).toFixed(2));
  if (!totalUSD && montoCuotaInput && numCuotas) totalUSD = parseFloat((montoCuotaInput * numCuotas).toFixed(2));
  const preview = document.getElementById('edit-mov-cuotas-preview');
  if (!preview) return;

  if (!numCuotas || !fechaInicio) { preview.innerHTML = ''; return; }

  const montoCuota = montoCuotaInput > 0 ? montoCuotaInput : parseFloat((totalUSD / numCuotas).toFixed(2));

  const montoEl = document.getElementById('edit-mov-cuotas-monto');
  if (montoEl && !montoEl.value && totalUSD > 0) montoEl.value = montoCuota;

  function ajustarHabilLunes(d) {
    var dia = d.getDay();
    if (dia === 6) d.setDate(d.getDate() + 2);
    if (dia === 0) d.setDate(d.getDate() + 1);
    return d;
  }

  const cuotas = [];
  let fecha = ajustarHabilLunes(new Date(fechaInicio + 'T00:00:00'));
  for (let i = 0; i < numCuotas; i++) {
    if (i > 0) {
      fecha = ajustarHabilLunes(new Date(new Date(cuotas[i-1].fecha + 'T00:00:00').setDate(
        new Date(cuotas[i-1].fecha + 'T00:00:00').getDate() + intervalo
      )));
    }
    cuotas.push({
      num:   i + 1,
      fecha: fecha.toISOString().split('T')[0],
      monto: i === numCuotas - 1
        ? parseFloat((totalUSD - montoCuota * (numCuotas - 1)).toFixed(2))
        : montoCuota
    });
  }

  const total = cuotas.reduce(function(s,c){ return s + c.monto; }, 0);
  const diff  = parseFloat((totalUSD - total).toFixed(2));

  preview.innerHTML =
    '<div style="font-size:11px;color:var(--suave);margin-bottom:8px">Vista previa — Total: $ '+fmtUSD(total)
    +(diff !== 0 ? ' <span style="color:#fc8181">(diferencia: $ '+fmtUSD(Math.abs(diff))+')</span>' : ' <span style="color:#22c55e">✓</span>')+'</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Cuota</th>'
    +'<th style="padding:6px 8px;text-align:left;color:var(--suave);font-size:10px">Fecha Vencimiento</th>'
    +'<th style="padding:6px 8px;text-align:right;color:var(--suave);font-size:10px">Monto USD</th>'
    +'</tr></thead><tbody>'
    + cuotas.map(function(c) {
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">'
          +'<td style="padding:6px 8px;font-weight:600">Cuota '+c.num+'</td>'
          +'<td style="padding:6px 8px;font-family:var(--font-mono)">'+c.fecha+'</td>'
          +'<td style="padding:6px 8px;text-align:right;font-family:var(--font-mono)">$ '+fmtUSD(c.monto)+'</td>'
          +'</tr>';
      }).join('')
    +'</tbody></table></div>';

  // Guardar cuotas en dataset para usarlas al guardar
  preview.dataset.cuotas = JSON.stringify(cuotas);
}

// ── Abre el modal de reverso con datos del movimiento ──
async function reversarMovimiento(tipo, idMovimiento, cantidad, id_articulo) {
  // Verificar permiso
  const permiso = tipo === 'ENTRADA' ? 'REVERSAR_ENTRADA' : 'REVERSAR_SALIDA';
  if (!sesionActual?.administrador && !puedo('INVENTARIO', permiso)) {
    alert('No tiene permiso para reversar ' + (tipo === 'ENTRADA' ? 'entradas' : 'salidas') + ' de stock.');
    return;
  }

  // Cargar datos del movimiento para mostrar en el modal
  let movOrig = null;
  try {
    if (tipo === 'ENTRADA') {
      const rows = await api('stock_entradas', 'GET', null,
        '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].anulada) { alert('Este movimiento ya fue anulado.'); return; }
      movOrig = rows[0];
    } else {
      const rows = await api('stock_salidas', 'GET', null,
        '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) { alert('Movimiento no encontrado.'); return; }
      if (rows[0].anulada) { alert('Este movimiento ya fue anulado.'); return; }
      movOrig = rows[0];
    }
  } catch(e) { alert('Error cargando movimiento: ' + e.message); return; }

  // Rellenar modal
  const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
  document.getElementById('anulacion-tipo').value          = tipo;
  document.getElementById('anulacion-id-movimiento').value = idMovimiento;
  document.getElementById('anulacion-id-articulo').value   = id_articulo;
  document.getElementById('anulacion-cantidad').value      = cantidad;
  document.getElementById('anulacion-titulo').textContent  = '⚠ ANULAR ' + tipo + ' DE STOCK';
  document.getElementById('anulacion-info-tipo').textContent     = tipo;
  document.getElementById('anulacion-info-cantidad').textContent = cantidad + ' ' + (r?.unidad || 'UND');
  document.getElementById('anulacion-info-articulo').textContent = r?.nombre_articulo || '—';
  const areaInfo = movOrig.area_receptora
    ? movOrig.area_receptora.nombre + (movOrig.area_receptora.codigo ? ' (' + movOrig.area_receptora.codigo + ')' : '')
    : '—';
  document.getElementById('anulacion-info-area').textContent  = areaInfo;
  const fecha = tipo === 'ENTRADA' ? (movOrig.fecha_entrada || movOrig.fecha_registro) : (movOrig.fecha_salida || movOrig.fecha_registro);
  document.getElementById('anulacion-info-fecha').textContent = fecha ? fecha.slice(0,10) : '—';
  document.getElementById('anulacion-clave').value = '';
  document.getElementById('alerta-anulacion-ok').style.display  = 'none';
  document.getElementById('alerta-anulacion-err').style.display = 'none';

  abrirModal('modal-anulacion-stock');
}

// ── Ejecuta el reverso tras validar contraseña ──
async function confirmarReverso() {
  const okEl   = document.getElementById('alerta-anulacion-ok');
  const errEl  = document.getElementById('alerta-anulacion-err');
  okEl.style.display = errEl.style.display = 'none';

  const tipo          = document.getElementById('anulacion-tipo').value;
  const idMovimiento  = parseInt(document.getElementById('anulacion-id-movimiento').value);
  const id_articulo   = parseInt(document.getElementById('anulacion-id-articulo').value);
  const cantidad      = parseFloat(document.getElementById('anulacion-cantidad').value);
  const clave         = document.getElementById('anulacion-clave').value;

  if (!clave) { errEl.textContent = 'Ingrese su contraseña para autorizar.'; errEl.style.display = 'block'; return; }

  const btnConfirmar = document.querySelector('#modal-anulacion-stock .btn-peligro');
  const resetBtn = function() { if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = '⚠ CONFIRMAR ANULACIÓN'; } };
  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = 'Procesando...'; }

  try {
    // 1. Validar contraseña usando bcrypt via RPC
    const verifReverso = await verificarContrasena(sesionActual.correo_usuario, clave);
    if (!verifReverso.ok) throw new Error('Contraseña incorrecta.');

    // 2. Leer artículo fresco
    const artArr = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
    const art = artArr[0];
    if (!art) throw new Error('Artículo no encontrado.');

    // 3. Leer movimiento original
    let movOrig = null;
    if (tipo === 'ENTRADA') {
      const rows = await api('stock_entradas', 'GET', null, '?id_entrada=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo)');
      if (!rows || !rows[0]) throw new Error('Movimiento no encontrado.');
      if (rows[0].anulada) throw new Error('Este movimiento ya fue anulado.');
      movOrig = rows[0];

      // ── Validar que la CxP no esté pagada ──
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=ilike.' + encodeURIComponent('ENT-' + idMovimiento + '*') + emisorQ() + '&select=id_cxp,estado,numero_doc');
        if (cxps && cxps.length) {
          const pagadas = cxps.filter(function(c) { return c.estado === 'PAGADA' || c.estado === 'PARCIAL'; });
          if (pagadas.length > 0) {
            throw new Error('No se puede anular esta entrada porque la CxP "' + pagadas[0].numero_doc + '" tiene estado ' + pagadas[0].estado + '. Debe reversar el pago primero.');
          }
        }
      } catch(eCxPCheck) {
        if (eCxPCheck.message.includes('No se puede anular')) throw eCxPCheck;
        console.warn('Error verificando CxP:', eCxPCheck);
      }
    } else {
      const rows = await api('stock_salidas', 'GET', null, '?id_salida=eq.' + idMovimiento + '&select=*,area_receptora:id_area(nombre,codigo),empleado_recibe:id_empleado(nombre_completo,correo,id_area,param_areas:id_area(nombre))');
      if (!rows || !rows[0]) throw new Error('Movimiento no encontrado.');
      if (rows[0].anulada) throw new Error('Este movimiento ya fue anulado.');
      movOrig = rows[0];
    }

    // 4. Recalcular stock desde cero contando movimientos activos
    let nuevoStock = 0;
    try {
      const [entradas, salidas] = await Promise.all([
        api('stock_entradas','GET',null,'?id_articulo=eq.'+id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada,cantidad'),
        api('stock_salidas','GET',null,'?id_articulo=eq.'+id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_salida,cantidad')
      ]);
      // Sumar entradas activas (excluyendo la que se está anulando si es ENTRADA)
      const totalEntradas = (entradas||[]).reduce(function(s,e){
        return s + (tipo === 'ENTRADA' && parseInt(e.id_entrada||0) === idMovimiento ? 0 : parseFloat(e.cantidad||0));
      }, 0);
      // Restar salidas activas (excluyendo la que se está anulando si es SALIDA)
      const totalSalidas = (salidas||[]).reduce(function(s,e){
        return s + (tipo === 'SALIDA' && parseInt(e.id_salida||0) === idMovimiento ? 0 : parseFloat(e.cantidad||0));
      }, 0);
      nuevoStock = totalEntradas - totalSalidas;
    } catch(eStock) {
      // Fallback al método anterior si falla
      const stockActual = parseFloat(art.stock_actual_articulo) || 0;
      nuevoStock = tipo === 'ENTRADA' ? stockActual - cantidad : stockActual + cantidad;
    }
    if (tipo === 'ENTRADA' && nuevoStock < 0) {
      throw new Error('Stock resultante negativo (' + nuevoStock.toFixed(2) + '). No se puede anular porque ya se realizaron salidas de este inventario.');
    }

    // 5. Actualizar stock y recalcular CPP
    const patchInv = { stock_actual_articulo: Math.max(0, nuevoStock) };

    // Recalcular CPP desde entradas activas
    if (nuevoStock <= 0) {
      patchInv.precio_costo_moneda        = 0;
      patchInv.precio_costo_ultimo_moneda = 0;
    } else {
      // CPP = Σ(cantidad × precio) entradas activas / Σ(cantidad) entradas activas
      try {
        const entradasActivas = await api('stock_entradas','GET',null,
          '?id_articulo=eq.'+id_articulo+'&or=(anulada.eq.false,anulada.is.null)&select=id_entrada,cantidad,precio_costo_moneda');
        let sumaCantidad = 0;
        let sumaValor    = 0;
        (entradasActivas||[]).forEach(function(e) {
          // Excluir la entrada que se está anulando
          if (tipo === 'ENTRADA' && parseInt(e.id_entrada||0) === idMovimiento) return;
          const cant   = parseFloat(e.cantidad || 0);
          const precio = parseFloat(e.precio_costo_moneda || 0);
          sumaCantidad += cant;
          sumaValor    += cant * precio;
        });
        if (sumaCantidad > 0) {
          patchInv.precio_costo_moneda = parseFloat((sumaValor / sumaCantidad).toFixed(4));
        } else {
          patchInv.precio_costo_moneda = 0;
        }
      } catch(eCPP) { console.warn('Error recalculando CPP:', eCPP); }
    }
    await api('inventario_almacen', 'PATCH', patchInv, '?id_articulo=eq.' + id_articulo);

    // 6. Marcar movimiento como anulado
    if (tipo === 'ENTRADA') {
      await api('stock_entradas', 'PATCH',
        { anulada: true, id_usuario_reversa: sesionActual.correo_usuario },
        '?id_entrada=eq.' + idMovimiento);
    } else {
      await api('stock_salidas', 'PATCH',
        { anulada: true, id_usuario_reversa: sesionActual.correo_usuario },
        '?id_salida=eq.' + idMovimiento);
    }

    // 7. Anular asiento contable original
    try {
      const ref = tipo === 'ENTRADA' ? 'ENT-' + idMovimiento : 'SAL-' + idMovimiento;
      const asientos = await api('cont_asientos', 'GET', null,
        '?referencia=eq.' + ref + emisorQ() + '&select=id_asiento,descripcion&estado=neq.ANULADO');
      if (asientos && asientos.length) {
        await api('cont_asientos', 'PATCH',
          { estado: 'ANULADO', descripcion: '[ANULADO] ' + (asientos[0].descripcion || '') },
          '?id_asiento=eq.' + asientos[0].id_asiento);
      }
    } catch(eAst) { console.warn('Error anulando asiento:', eAst); }

    // 8. Anular CxP si es entrada por compra
    if (tipo === 'ENTRADA') {
      try {
        const cxps = await api('cont_cxp', 'GET', null,
          '?numero_doc=eq.' + encodeURIComponent('ENT-' + idMovimiento) + emisorQ() + '&estado=eq.PENDIENTE&select=id_cxp');
        if (cxps && cxps.length) {
          await api('cont_cxp', 'PATCH',
            { estado: 'ANULADA', observaciones: '[ANULADO] Entrada de stock anulada.' },
            '?id_cxp=eq.' + cxps[0].id_cxp);
        }
      } catch(eCxP) { console.warn('Error anulando CxP:', eCxP); }
    }

    // 9. Notificaciones para SALIDAS
    if (tipo === 'SALIDA') {
      const r = inventarioCache.find(function(x) { return x.id_articulo === id_articulo; });
      const nomArt = r ? r.nombre_articulo : 'Artículo #' + id_articulo;

      // 9a. Notificación interna al empleado que recibió
      if (movOrig.id_empleado) {
        try {
          await api('notificaciones', 'POST', {
            id_empresa:   _empresaActiva?.id_empresa,
            id_empleado:  movOrig.id_empleado,
            tipo:         'REVERSO_SALIDA',
            titulo:       '⚠ Reverso de Salida de Inventario',
            mensaje:      'La salida de ' + cantidad + ' unidades de "' + nomArt + '" registrada a su nombre ha sido anulada. El inventario debe retornar al almacén.',
            leida:        false,
            id_usuario:   sesionActual.correo_usuario,
            fecha_registro: new Date().toISOString()
          });
        } catch(eNot) { console.warn('Error creando notificación interna:', eNot); }
      }

      // 9b. Correo al responsable del área receptora
      if (movOrig.id_area) {
        try {
          // Buscar responsable del área (empleado con nivel jerárquico más alto del área)
          const responsables = await api('empleados', 'GET', null,
            '?id_area=eq.' + movOrig.id_area + '&id_nivel_jerarquico=not.is.null&order=id_nivel_jerarquico.asc&select=correo,nombre_completo&limit=1'
            + (_empresaActiva ? '&id_empresa=eq.' + _empresaActiva.id_empresa : ''));
          if (responsables && responsables[0] && responsables[0].correo) {
            const resp = responsables[0];
            const areaName = movOrig.area_receptora ? movOrig.area_receptora.nombre : 'Área #' + movOrig.id_area;
            await fetch(SUPABASE_URL + '/functions/v1/send-email', {
              method: 'POST',
              headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to:      resp.correo,
                subject: '⚠ Reverso de Salida de Inventario — ' + areaName,
                html:    '<p>Estimado/a <strong>' + resp.nombre_completo + '</strong>,</p>'
                       + '<p>Se ha anulado una salida de inventario registrada para su área.</p>'
                       + '<table style="border-collapse:collapse;width:100%">'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Artículo</strong></td><td style="padding:6px;border:1px solid #ddd">' + nomArt + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Cantidad</strong></td><td style="padding:6px;border:1px solid #ddd">' + cantidad + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Área</strong></td><td style="padding:6px;border:1px solid #ddd">' + areaName + '</td></tr>'
                       + '<tr><td style="padding:6px;border:1px solid #ddd"><strong>Anulado por</strong></td><td style="padding:6px;border:1px solid #ddd">' + sesionActual.correo_usuario + '</td></tr>'
                       + '</table>'
                       + '<p>El inventario debe retornar al almacén. Por favor coordine la devolución.</p>'
              })
            });
          }
        } catch(eEmail) { console.warn('Error enviando correo responsable:', eEmail); }
      }
    }

    // 10. Actualizar cache y vistas
    try {
      const fresh = await api('inventario_almacen', 'GET', null, '?id_articulo=eq.' + id_articulo + '&select=*');
      if (fresh && fresh[0]) {
        const i = inventarioCache.findIndex(function(x) { return x.id_articulo === id_articulo; });
        if (i !== -1) inventarioCache[i] = fresh[0];
      }
    } catch(e) {}

    okEl.textContent = '✓ Movimiento anulado correctamente. Stock actualizado.';
    okEl.style.display = 'block';
    resetBtn();

    setTimeout(async function() {
      cerrarModal('modal-anulacion-stock');
      await calcularInvSaldoArea();
      if (document.getElementById('tabla-inv-cont')) invRenderVista(inventarioCache, _invVista);
      if (_fichaInvActual && _fichaInvActual.id) {
        await recargarHistorial(id_articulo);
        verHistorialStock(_fichaInvActual.id, _fichaInvActual.nombre);
      }
    }, 1500);

  } catch(err) {
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
    resetBtn();
  }
}

// ── Alias para el botón Reversar en Historial de Salidas ──
async function reversarSalida(id_salida, id_articulo, cantidad) {
  await reversarMovimiento('SALIDA', id_salida, cantidad, id_articulo);
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
        + '<td><button class="btn-naranja" onclick="verFichaProveedor(' + p.id_proveedor + ')">Ver</button>'
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

  // Buscar nombre de categoría
  let catNombre = '—';
  if (p.id_categoria) {
    try {
      const cats = await api('param_categorias_proveedor','GET',null,'?id=eq.'+p.id_categoria+'&select=nombre&limit=1');
      if (cats && cats[0]) catNombre = cats[0].nombre;
    } catch(e) {}
  }

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




// ── Funciones para EDITAR ENTRADA DE STOCK ──
async function onCambiarFechaNegEdit() {
  const fecha  = document.getElementById('edit-mov-fecha-negociacion')?.value;
  const moneda = document.getElementById('edit-mov-moneda')?.value || 'USD';
  if (!fecha || moneda === 'VES') return;
  try {
    const tasas = await api('tasas','GET',null,'?fecha_valor=lte.'+fecha+'&moneda_origen=eq.USD&order=fecha_valor.desc&limit=1&select=tipo_cambio,fecha_valor');
    if (tasas && tasas[0]) {
      document.getElementById('edit-mov-tasa-bcv').value = parseFloat(tasas[0].tipo_cambio).toFixed(4);
      onCambiarPrecioEdit();
    }
  } catch(e) {}
}

async function onCambiarMonedaEdit() {
  const moneda = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const lblMoneda = document.getElementById('edit-mov-label-moneda');
  if (lblMoneda) lblMoneda.textContent = '(' + moneda + ')';
  const lblMonto = document.getElementById('edit-mov-label-monto-total');
  if (lblMonto) lblMonto.textContent = 'Monto en ' + moneda;
  const lblUSD = document.getElementById('edit-mov-label-precio-usd');
  if (lblUSD) lblUSD.textContent = moneda === 'VES' ? 'Monto en USD' : 'Monto en VES';
  await onCambiarFechaNegEdit();
  onCambiarPrecioEdit();
}

function onCambiarPrecioEdit() {
  const moneda   = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const precio   = parseFloat(document.getElementById('edit-mov-precio')?.value) || 0;
  const cantidad = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const tasa     = parseFloat(document.getElementById('edit-mov-tasa-bcv')?.value) || 0;
  const elMonto  = document.getElementById('edit-mov-monto-total');
  const elCalc   = document.getElementById('edit-mov-precio-usd-calc');
  const montoTotal = precio * cantidad;
  if (elMonto) elMonto.value = fmtBs(montoTotal);
  if (elCalc && tasa > 0) {
    elCalc.value = moneda === 'VES' ? fmtBs(montoTotal / tasa) : fmtBs(montoTotal * tasa);
  }
  calcularTributosEdit();
}

function onCambiarMotivoEdit() {
  const motivo = document.getElementById('edit-mov-motivo')?.value;
  const esCompra = motivo === 'compra';
  const tribuCont = document.getElementById('edit-mov-tributos-cont');
  if (tribuCont) tribuCont.style.display = esCompra ? '' : 'none';
  document.querySelectorAll('input[name="edit-exento-iva"]').forEach(function(r){ r.checked = false; });
  document.querySelectorAll('input[name="edit-incluye-iva"]').forEach(function(r){ r.checked = false; });
  document.getElementById('edit-mov-exento-iva-val').value = '';
  document.getElementById('edit-mov-incluye-iva-val').value = '';
  const ivaContEl = document.getElementById('edit-mov-incluye-iva-cont');
  if (ivaContEl) ivaContEl.style.display = 'none';
  const prev = document.getElementById('edit-mov-tributos-preview');
  if (prev) prev.style.display = 'none';
  // Mostrar/ocultar proveedor
  const provCont = document.getElementById('edit-mov-proveedor-cont');
  if (provCont) provCont.style.display = esCompra ? '' : 'none';
}

function onCambioExentoIVAEdit() {
  const exento = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
  const ivaContEl = document.getElementById('edit-mov-incluye-iva-cont');
  if (ivaContEl) ivaContEl.style.display = exento ? 'none' : '';
  document.getElementById('edit-mov-incluye-iva-val').value = '';
  document.querySelectorAll('input[name="edit-incluye-iva"]').forEach(function(r){ r.checked = false; });
  const prev = document.getElementById('edit-mov-tributos-preview');
  if (prev) prev.style.display = 'none';
  calcularTributosEdit();
}

function calcularTributosEdit() {
  const exento    = document.getElementById('edit-mov-exento-iva-val')?.value === 'SI';
  const ivaVal    = document.getElementById('edit-mov-incluye-iva-val')?.value;
  const prev      = document.getElementById('edit-mov-tributos-preview');
  const moneda    = document.getElementById('edit-mov-moneda')?.value || 'USD';
  const tasa      = parseFloat(document.getElementById('edit-mov-tasa-bcv')?.value) || 0;
  const precio    = parseFloat(document.getElementById('edit-mov-precio')?.value) || 0;
  const cantidad  = parseFloat(document.getElementById('edit-mov-cantidad')?.value) || 0;
  const montoTotal = precio * cantidad;
  const sim = moneda === 'VES' ? 'Bs.' : '$';
  const IVA_RATE = 0.16;

  if (!montoTotal) { if (prev) prev.style.display = 'none'; return; }

  let base, iva, total;
  if (exento) {
    base = montoTotal; iva = 0; total = montoTotal;
  } else if (!ivaVal) {
    if (prev) prev.style.display = 'none'; return;
  } else if (ivaVal === 'SI') {
    base  = parseFloat((montoTotal / (1 + IVA_RATE)).toFixed(4));
    iva   = parseFloat((montoTotal - base).toFixed(4));
    total = montoTotal;
  } else {
    base  = montoTotal;
    iva   = parseFloat((montoTotal * IVA_RATE).toFixed(4));
    total = parseFloat((montoTotal + iva).toFixed(4));
  }

  document.getElementById('edit-trib-base').textContent  = sim + ' ' + fmtBs(base);
  document.getElementById('edit-trib-iva').textContent   = iva > 0 ? sim + ' ' + fmtBs(iva) : '—';
  document.getElementById('edit-trib-total').textContent = sim + ' ' + fmtBs(total);
  if (tasa > 0 && moneda !== 'VES') {
    document.getElementById('edit-trib-base-ves').textContent  = 'Bs. ' + fmtBs(base * tasa);
    document.getElementById('edit-trib-iva-ves').textContent   = iva > 0 ? 'Bs. ' + fmtBs(iva * tasa) : '—';
    document.getElementById('edit-trib-total-ves').textContent = 'Bs. ' + fmtBs(total * tasa);
  }
  if (prev) prev.style.display = '';
}
