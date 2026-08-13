const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Supabase/PostgREST corta cada respuesta a 1000 filas — paginar con .range().
async function fetchAll(buildQuery, pageSize = 1000) {
  let desde = 0;
  let todos = [];
  while (true) {
    const { data, error } = await buildQuery().range(desde, desde + pageSize - 1);
    if (error) return { data: null, error };
    todos = todos.concat(data);
    if (data.length < pageSize) break;
    desde += pageSize;
  }
  return { data: todos, error: null };
}

const MESES_TC = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  resumen: document.getElementById('resumen'),
  tbodyPrecios: document.getElementById('tbody-precios'),
  tbodyDescuentos: document.getElementById('tbody-descuentos'),
  notaPie: document.getElementById('nota-pie'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
  tcMes: document.getElementById('tc-mes'),
  tcValor: document.getElementById('tc-valor'),
  tcStatus: document.getElementById('tc-status'),
  tcGuardarBtn: document.getElementById('tc-guardar-btn'),
  tcFormError: document.getElementById('tc-form-error'),
  tcMesesList: document.getElementById('tc-meses-list'),
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPesos(n) {
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtFecha(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR');
}

// Cerámica y Porcelanas facturan al 21% general. Presupuesto vende SIEMPRE
// sin IVA (confirmado con los reportes reales de "Importar ventas": la
// columna "Exento" de Presupuesto es igual a "Total" en todas las facturas),
// pero el precio de lista no siempre coincide con lo realmente cobrado — a
// veces se le suma un plus al neto, a veces no — así que para Presupuesto no
// hay fórmula: se muestra el precio real de la última factura de esa pieza,
// tal cual se cobró (confirmado con Víctor 12/08/26).
const IVA_CERAMICA_PORCELANAS = 0.21;

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  if (me.rol === 'analisis') {
    els.tcGuardarBtn.disabled = true;
    els.tcFormError.textContent = 'Tu usuario es de solo lectura — no podés cargar tipo de cambio.';
  }
}

// --- Tipo de cambio (antes era una pantalla aparte, se unificó acá para no
// tener una pantalla por cada cosa — pedido de Víctor 13/08/26) ---

function tcMesLabel(ym) {
  const [anio, mes] = ym.split('-');
  return `${MESES_TC[Number(mes) - 1]} ${anio}`;
}

async function tcInit() {
  const hoy = new Date();
  els.tcMes.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  await tcLoadMeses();
}

async function tcLoadMeses() {
  els.tcMesesList.innerHTML = '<div class="loading">Cargando…</div>';

  const [{ data: tc, error: e1 }, { data: facturas, error: e2 }] = await Promise.all([
    client.from('tipo_cambio').select('mes, valor, cargado_por').order('mes', { ascending: false }),
    fetchAll(() => client.from('facturas').select('fecha, tipo_cambio')),
  ]);
  if (e1 || e2) { els.tcMesesList.innerHTML = `<div class="loading">Error: ${(e1 || e2).message}</div>`; return; }

  const porMes = new Map();
  for (const f of facturas) {
    if (!f.fecha) continue;
    const ym = f.fecha.slice(0, 7);
    if (!porMes.has(ym)) porMes.set(ym, { conTc: 0, sinTc: 0 });
    const g = porMes.get(ym);
    if (f.tipo_cambio == null) g.sinTc += 1;
    else g.conTc += 1;
  }
  const tcPorMes = new Map((tc || []).map((r) => [r.mes.slice(0, 7), r]));

  const meses = [...new Set([...porMes.keys(), ...tcPorMes.keys()])].sort().reverse();

  if (meses.length === 0) {
    els.tcMesesList.innerHTML = '<div class="loading">Todavía no hay facturas cargadas.</div>';
    return;
  }

  els.tcMesesList.innerHTML = meses.map((ym) => {
    const g = porMes.get(ym) || { conTc: 0, sinTc: 0 };
    const cargado = tcPorMes.get(ym);
    const pendiente = g.sinTc > 0;
    return `<div class="recientes-item">
      <div>
        <div class="nombre">${tcMesLabel(ym)}${cargado ? ` — TC $${Number(cargado.valor).toLocaleString('es-AR')}` : ''}</div>
        <div class="meta">${g.conTc} factura(s) con dólar${pendiente ? ` · <strong class="tc-pendiente">${g.sinTc} pendiente(s)</strong>` : ''}${cargado ? ` · cargado por ${escapeHtml(cargado.cargado_por || '')}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function tcGuardar() {
  els.tcFormError.textContent = '';
  const mes = els.tcMes.value;
  const valor = Number(els.tcValor.value);
  if (!mes) { els.tcFormError.textContent = 'Elegí el mes.'; return; }
  if (!valor || valor <= 0) { els.tcFormError.textContent = 'Cargá el valor del tipo de cambio.'; return; }

  els.tcGuardarBtn.disabled = true;
  els.tcGuardarBtn.textContent = 'Guardando…';
  els.tcStatus.textContent = '';

  try {
    const res = await fetch('/api/aplicar-tipo-cambio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes, valor }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    els.tcStatus.textContent = `✓ Guardado. ${data.actualizadas} factura(s) de ${tcMesLabel(mes)} actualizada(s) con TC $${valor.toLocaleString('es-AR')}.`;
    els.tcValor.value = '';
    await tcLoadMeses();
  } catch (err) {
    els.tcFormError.textContent = 'Error al guardar: ' + err.message;
  } finally {
    els.tcGuardarBtn.disabled = false;
    els.tcGuardarBtn.textContent = 'Guardar y aplicar';
  }
}

els.tcGuardarBtn.addEventListener('click', tcGuardar);

async function cargar() {
  const { data: listas, error: e1 } = await client
    .from('listas_precios')
    .select('id, fecha_vigencia, tipo_cambio, nota, created_at')
    .order('fecha_vigencia', { ascending: false })
    .limit(1);

  if (e1 || !listas || listas.length === 0) {
    els.resumen.innerHTML = '<p class="empty-state">No hay ninguna lista de precios cargada todavía.</p>';
    els.tbodyPrecios.innerHTML = '';
    els.tbodyDescuentos.innerHTML = '';
    return;
  }

  const lista = listas[0];
  if (lista.created_at) {
    const ultima = new Date(lista.created_at);
    const fechaStr = ultima.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaStr = ultima.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    els.ultimaActualizacion.textContent = `Última actualización: ${fechaStr}, ${horaStr} hs.`;
  }
  els.resumen.innerHTML = `
    <div><strong>${fmtFecha(lista.fecha_vigencia)}</strong><span class="label">vigente desde</span></div>
    ${lista.tipo_cambio ? `<div><strong>${fmtPesos(lista.tipo_cambio)}</strong><span class="label">tipo de cambio</span></div>` : ''}
  `;
  els.notaPie.textContent = lista.nota || '';

  const { data: items, error: e2 } = await client
    .from('lista_precios_items')
    .select('pieza_id, precio_sin_iva, piezas(linea, tipo_pieza, variante)')
    .eq('lista_id', lista.id)
    .order('piezas(linea)');

  if (e2) {
    els.tbodyPrecios.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${escapeHtml(e2.message)}</td></tr>`;
  } else if (!items || items.length === 0) {
    els.tbodyPrecios.innerHTML = '<tr><td colspan="5" class="empty-state">Sin piezas cargadas en esta lista.</td></tr>';
  } else {
    // Último precio real facturado como Presupuesto, por pieza — solo para
    // las piezas que están en esta lista (no hace falta traer todo el
    // catálogo de factura_items).
    const piezaIds = items.map((it) => it.pieza_id);
    const { data: ventasPresupuesto, error: e2b } = await client
      .from('factura_items')
      .select('pieza_id, precio_unitario, facturas!inner(empresa, fecha)')
      .in('pieza_id', piezaIds)
      .eq('facturas.empresa', 'Presupuesto')
      .order('facturas(fecha)', { ascending: false });

    const ultimoPresupuestoPorPieza = new Map();
    if (!e2b) {
      for (const v of (ventasPresupuesto || [])) {
        if (!ultimoPresupuestoPorPieza.has(v.pieza_id)) {
          ultimoPresupuestoPorPieza.set(v.pieza_id, { precio: v.precio_unitario, fecha: v.facturas.fecha });
        }
      }
    }

    const ordenados = [...items].sort((a, b) => (a.piezas.linea + a.piezas.tipo_pieza).localeCompare(b.piezas.linea + b.piezas.tipo_pieza));
    els.tbodyPrecios.innerHTML = ordenados.map((it) => {
      const conIva = Number(it.precio_sin_iva) * (1 + IVA_CERAMICA_PORCELANAS);
      const presupuesto = ultimoPresupuestoPorPieza.get(it.pieza_id);
      const celdaPresupuesto = presupuesto
        ? `${fmtPesos(presupuesto.precio)}<br><span class="sub-value">${fmtFecha(presupuesto.fecha)}</span>`
        : '<span class="sub-value">Sin ventas de Presupuesto</span>';
      return `
      <tr>
        <td>${escapeHtml(it.piezas.linea)}</td>
        <td>${escapeHtml(it.piezas.tipo_pieza)}${it.piezas.variante ? ` (${escapeHtml(it.piezas.variante)})` : ''}</td>
        <td class="col-precio">${fmtPesos(it.precio_sin_iva)}</td>
        <td class="col-precio">${fmtPesos(conIva)}</td>
        <td class="col-precio">${celdaPresupuesto}</td>
      </tr>
    `;
    }).join('');
  }

  const { data: descuentos, error: e3 } = await client
    .from('lista_precios_descuentos')
    .select('monto_desde, monto_hasta, descuento, plazo_pago')
    .eq('lista_id', lista.id)
    .order('monto_desde');

  if (e3) {
    els.tbodyDescuentos.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${escapeHtml(e3.message)}</td></tr>`;
  } else if (!descuentos || descuentos.length === 0) {
    els.tbodyDescuentos.innerHTML = '<tr><td colspan="4" class="empty-state">Sin descuentos cargados.</td></tr>';
  } else {
    els.tbodyDescuentos.innerHTML = descuentos.map((d) => `
      <tr>
        <td>${fmtPesos(d.monto_desde)}</td>
        <td>${d.monto_hasta ? fmtPesos(d.monto_hasta) : 'Sin techo'}</td>
        <td>${(d.descuento * 100).toLocaleString('es-AR')}%</td>
        <td>${escapeHtml(d.plazo_pago || '')}</td>
      </tr>
    `).join('');
  }
}

initUser().then(() => Promise.all([cargar(), tcInit()]));
