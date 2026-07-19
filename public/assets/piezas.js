const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };

const state = {
  clientes: [],
  clienteSeleccionado: null,
  piezas: [],
  piezasPorLinea: new Map(),
  lineasDisponibles: [],
  itemsCrudos: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  clienteInput: document.getElementById('f-cliente'),
  clienteId: document.getElementById('f-cliente-id'),
  suggestions: document.getElementById('cliente-suggestions'),
  linea: document.getElementById('f-linea'),
  pieza: document.getElementById('f-pieza'),
  desde: document.getElementById('f-desde'),
  hasta: document.getElementById('f-hasta'),
  buscarBtn: document.getElementById('buscar-btn'),
  limpiarBtn: document.getElementById('limpiar-btn'),
  resumen: document.getElementById('resumen'),
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

// --- Autocompletar cliente ---
els.clienteInput.addEventListener('input', () => {
  state.clienteSeleccionado = null;
  els.clienteId.value = '';

  const q = els.clienteInput.value.trim().toLowerCase();
  if (q.length < 2) {
    els.suggestions.classList.remove('show');
    return;
  }
  const matches = state.clientes
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
      state.clienteSeleccionado = c;
      els.clienteId.value = c.id;
      els.clienteInput.value = c.nombre;
      els.suggestions.classList.remove('show');
    });
  });
});
document.addEventListener('click', (e) => {
  if (!els.suggestions.contains(e.target) && e.target !== els.clienteInput) {
    els.suggestions.classList.remove('show');
  }
});

// --- Filtro de línea -> pieza ---
els.linea.addEventListener('change', () => {
  const opciones = state.piezasPorLinea.get(els.linea.value) || state.piezas;
  els.pieza.innerHTML = '<option value="">Todas</option>' + opciones.map((p) => `<option value="${p.id}">${escapeHtml(piezaLabel(p))}</option>`).join('');
});

els.buscarBtn.addEventListener('click', buscar);
els.limpiarBtn.addEventListener('click', () => {
  els.clienteInput.value = '';
  els.clienteId.value = '';
  state.clienteSeleccionado = null;
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

  const clienteIdFiltro = els.clienteId.value ? Number(els.clienteId.value) : null;
  const lineaFiltro = els.linea.value || null;
  const piezaIdFiltro = els.pieza.value ? Number(els.pieza.value) : null;
  const desde = els.desde.value || null;
  const hasta = els.hasta.value || null;

  const filtrados = data.filter((item) => {
    if (!item.facturas || !item.piezas) return false;
    if (clienteIdFiltro && item.facturas.cliente_id !== clienteIdFiltro) return false;
    if (lineaFiltro && item.piezas.linea !== lineaFiltro) return false;
    if (piezaIdFiltro && item.pieza_id !== piezaIdFiltro) return false;
    if (desde && item.facturas.fecha < desde) return false;
    if (hasta && item.facturas.fecha > hasta) return false;
    return true;
  });

  renderResumen(filtrados);
  renderTabla(filtrados);
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

function renderTabla(items) {
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
