const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };

const state = {
  clientes: [],
  clientesSeleccionados: [],
  piezas: [],
  piezasPorLinea: new Map(),
  lineasDisponibles: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  clienteInput: document.getElementById('f-cliente'),
  suggestions: document.getElementById('cliente-suggestions'),
  clienteChips: document.getElementById('cliente-chips'),
  linea: document.getElementById('f-linea'),
  pieza: document.getElementById('f-pieza'),
  desde: document.getElementById('f-desde'),
  hasta: document.getElementById('f-hasta'),
  buscarBtn: document.getElementById('buscar-btn'),
  limpiarBtn: document.getElementById('limpiar-btn'),
  resumen: document.getElementById('resumen'),
  thead: document.getElementById('thead'),
  tbody: document.getElementById('tbody'),
};

function piezaLabel(p) {
  const variante = p.variante ? ` (${p.variante})` : '';
  return `${p.tipo_pieza}${variante} — ${CALIDAD_LABEL[p.calidad] || p.calidad}`;
}

async function init() {
  const meRes = await fetch('/api/me');
  const me = await meRes.json();
  if (!me.user) {
    window.location.href = '/login';
    return;
  }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  const { data: clientesData } = await client.from('clientes').select('id, cuit, nombre').limit(2000);
  state.clientes = clientesData || [];

  const { data: piezasData } = await client.from('piezas').select('id, linea, tipo_pieza, variante, calidad').eq('activo', true);
  state.piezas = piezasData || [];
  state.lineasDisponibles = [...new Set(state.piezas.map((p) => p.linea))].sort();
  state.piezasPorLinea = new Map();
  for (const p of state.piezas) {
    const list = state.piezasPorLinea.get(p.linea) || [];
    list.push(p);
    state.piezasPorLinea.set(p.linea, list);
  }
  els.linea.innerHTML = '<option value="">Todas</option>' + state.lineasDisponibles.map((l) => `<option value="${l}">${l}</option>`).join('');

  buscar();
}

// --- Autocompletar / selección múltiple de cliente ---
els.clienteInput.addEventListener('input', () => {
  const q = els.clienteInput.value.trim().toLowerCase();
  if (q.length < 2) {
    els.suggestions.classList.remove('show');
    return;
  }
  const yaElegidos = new Set(state.clientesSeleccionados.map((c) => c.id));
  const matches = state.clientes
    .filter((c) => !yaElegidos.has(c.id))
    .filter((c) => (c.nombre || '').toLowerCase().includes(q) || (c.cuit || '').toLowerCase().includes(q))
    .slice(0, 8);
  if (matches.length === 0) {
    els.suggestions.classList.remove('show');
    return;
  }
  els.suggestions.innerHTML = matches
    .map((c) => `<div class="suggestion-item" data-id="${c.id}">${escapeHtml(c.nombre)}<br><span class="cuit">${escapeHtml(c.cuit || 'sin CUIT')}</span></div>`)
    .join('');
  els.suggestions.classList.add('show');
  els.suggestions.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = Number(item.dataset.id);
      const c = state.clientes.find((x) => x.id === id);
      if (c && !state.clientesSeleccionados.some((s) => s.id === id)) {
        state.clientesSeleccionados.push(c);
        renderChips();
        buscar();
      }
      els.clienteInput.value = '';
      els.suggestions.classList.remove('show');
    });
  });
});
document.addEventListener('click', (e) => {
  if (!els.suggestions.contains(e.target) && e.target !== els.clienteInput) {
    els.suggestions.classList.remove('show');
  }
});

function renderChips() {
  els.clienteChips.innerHTML = state.clientesSeleccionados
    .map((c) => `<span class="cliente-chip">${escapeHtml(c.nombre)}<button type="button" data-id="${c.id}" title="Quitar">✕</button></span>`)
    .join('');
  els.clienteChips.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      state.clientesSeleccionados = state.clientesSeleccionados.filter((c) => c.id !== id);
      renderChips();
      buscar();
    });
  });
}

// --- Filtro de línea -> pieza ---
els.linea.addEventListener('change', () => {
  const opciones = state.piezasPorLinea.get(els.linea.value) || state.piezas;
  els.pieza.innerHTML = '<option value="">Todas</option>' + opciones.map((p) => `<option value="${p.id}">${escapeHtml(piezaLabel(p))}</option>`).join('');
});

els.buscarBtn.addEventListener('click', buscar);
els.limpiarBtn.addEventListener('click', () => {
  els.clienteInput.value = '';
  state.clientesSeleccionados = [];
  renderChips();
  els.linea.value = '';
  els.pieza.innerHTML = '<option value="">Todas</option>';
  els.desde.value = '';
  els.hasta.value = '';
  buscar();
});

async function buscar() {
  els.tbody.innerHTML = '<tr><td colspan="6" class="loading">Buscando…</td></tr>';

  const { data, error } = await client
    .from('factura_items')
    .select('cantidad, factura_id, pieza_id, facturas(fecha, cliente_id, nombre_facturado), piezas(linea, tipo_pieza, variante, calidad)')
    .limit(5000);

  if (error) {
    els.tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Error: ${error.message}</td></tr>`;
    return;
  }

  const idsSeleccionados = new Set(state.clientesSeleccionados.map((c) => c.id));
  const lineaFiltro = els.linea.value || null;
  const piezaIdFiltro = els.pieza.value ? Number(els.pieza.value) : null;
  const desde = els.desde.value || null;
  const hasta = els.hasta.value || null;

  const filtrados = data.filter((item) => {
    if (!item.facturas || !item.piezas) return false;
    if (idsSeleccionados.size > 0 && !idsSeleccionados.has(item.facturas.cliente_id)) return false;
    if (lineaFiltro && item.piezas.linea !== lineaFiltro) return false;
    if (piezaIdFiltro && item.pieza_id !== piezaIdFiltro) return false;
    if (desde && item.facturas.fecha < desde) return false;
    if (hasta && item.facturas.fecha > hasta) return false;
    return true;
  });

  renderResumen(filtrados);

  if (state.clientesSeleccionados.length >= 2) {
    renderComparativa(filtrados);
  } else {
    renderTablaSimple(filtrados);
  }
}

function renderResumen(items) {
  const totalPiezas = items.reduce((sum, it) => sum + it.cantidad, 0);
  const totalFacturas = new Set(items.map((it) => it.factura_id)).size;
  const totalClientes = new Set(items.map((it) => it.facturas.cliente_id).filter(Boolean)).size;
  els.resumen.innerHTML = `
    <div><strong>${totalPiezas}</strong><span class="label">piezas totales</span></div>
    <div><strong>${totalFacturas}</strong><span class="label">facturas involucradas</span></div>
    <div><strong>${totalClientes}</strong><span class="label">clientes distintos</span></div>
  `;
}

function renderTablaSimple(items) {
  els.thead.innerHTML = `<tr>
    <th>Cliente</th><th>Línea</th><th>Pieza</th><th>Calidad</th><th>Cantidad total</th><th>N° de facturas</th>
  </tr>`;

  if (items.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay piezas cargadas que coincidan con estos filtros.</td></tr>';
    return;
  }

  const grupos = new Map();
  for (const it of items) {
    const clienteNombre = it.facturas.nombre_facturado || 'Sin nombre';
    const clienteId = it.facturas.cliente_id || `sin-id-${clienteNombre}`;
    const key = [clienteId, it.piezas.linea, it.piezas.tipo_pieza, it.piezas.variante || '', it.piezas.calidad].join('|');
    if (!grupos.has(key)) {
      grupos.set(key, {
        clienteNombre,
        linea: it.piezas.linea,
        tipoPieza: it.piezas.tipo_pieza,
        variante: it.piezas.variante,
        calidad: it.piezas.calidad,
        cantidad: 0,
        facturaIds: new Set(),
      });
    }
    const g = grupos.get(key);
    g.cantidad += it.cantidad;
    g.facturaIds.add(it.factura_id);
  }

  const filas = [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad);

  els.tbody.innerHTML = filas
    .map(
      (g) => `<tr>
        <td>${escapeHtml(g.clienteNombre)}</td>
        <td>${escapeHtml(g.linea)}</td>
        <td>${escapeHtml(g.tipoPieza)}${g.variante ? ' (' + escapeHtml(g.variante) + ')' : ''}</td>
        <td>${escapeHtml(CALIDAD_LABEL[g.calidad] || g.calidad)}</td>
        <td><strong>${g.cantidad}</strong></td>
        <td>${g.facturaIds.size}</td>
      </tr>`
    )
    .join('');
}

function renderComparativa(items) {
  const clientesCols = state.clientesSeleccionados;

  els.thead.innerHTML = `<tr>
    <th>Pieza</th>
    ${clientesCols.map((c) => `<th>${escapeHtml(c.nombre)}</th>`).join('')}
    <th>Total</th>
  </tr>`;

  if (items.length === 0) {
    els.tbody.innerHTML = `<tr><td colspan="${clientesCols.length + 2}" class="empty-state">No hay piezas cargadas que coincidan con estos filtros para los clientes elegidos.</td></tr>`;
    return;
  }

  const filas = new Map();
  for (const it of items) {
    const piezaKey = [it.piezas.linea, it.piezas.tipo_pieza, it.piezas.variante || '', it.piezas.calidad].join('|');
    if (!filas.has(piezaKey)) {
      filas.set(piezaKey, {
        linea: it.piezas.linea,
        tipoPieza: it.piezas.tipo_pieza,
        variante: it.piezas.variante,
        calidad: it.piezas.calidad,
        porCliente: new Map(),
      });
    }
    const fila = filas.get(piezaKey);
    const clienteId = it.facturas.cliente_id;
    fila.porCliente.set(clienteId, (fila.porCliente.get(clienteId) || 0) + it.cantidad);
  }

  const filasOrdenadas = [...filas.values()].sort((a, b) => {
    const totalA = [...a.porCliente.values()].reduce((s, v) => s + v, 0);
    const totalB = [...b.porCliente.values()].reduce((s, v) => s + v, 0);
    return totalB - totalA;
  });

  els.tbody.innerHTML = filasOrdenadas
    .map((fila) => {
      const cantidades = clientesCols.map((c) => fila.porCliente.get(c.id) || 0);
      const total = cantidades.reduce((s, v) => s + v, 0);
      const piezaTexto = `${fila.linea} — ${fila.tipoPieza}${fila.variante ? ' (' + fila.variante + ')' : ''} — ${CALIDAD_LABEL[fila.calidad] || fila.calidad}`;
      return `<tr>
        <td>${escapeHtml(piezaTexto)}</td>
        ${cantidades.map((n) => `<td>${n > 0 ? `<strong>${n}</strong>` : '<span class="none">—</span>'}</td>`).join('')}
        <td><strong>${total}</strong></td>
      </tr>`;
    })
    .join('');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
