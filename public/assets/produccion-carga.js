const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };
const TIPOS = ['produccion', 'venta', 'rotura'];

const state = {
  currentUser: null,
  piezas: [],        // catálogo ordenado
  lineas: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  fecha: document.getElementById('f-fecha'),
  linea: document.getElementById('f-linea'),
  status: document.getElementById('carga-status'),
  guardarBtn: document.getElementById('guardar-btn'),
  tbody: document.getElementById('tbody'),
  formError: document.getElementById('form-error'),
  recientesList: document.getElementById('recientes-list'),
};

function piezaLabel(p) {
  const variante = p.variante ? ` (${p.variante})` : '';
  return `${p.tipo_pieza}${variante}`;
}

async function init() {
  const me = await (await fetch('/api/me')).json();
  if (!me.user) { window.location.href = '/login'; return; }
  state.currentUser = me.user;
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  els.fecha.value = new Date().toISOString().slice(0, 10);

  const { data, error } = await client
    .from('piezas')
    .select('id, linea, tipo_pieza, variante, calidad, activo')
    .eq('activo', true);
  if (error) {
    els.tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error al cargar piezas: ${error.message}</td></tr>`;
    return;
  }
  const ordenCalidad = { '1era': 0, comercial: 1, '3era': 2 };
  state.piezas = (data || []).sort((a, b) =>
    a.linea.localeCompare(b.linea) ||
    a.tipo_pieza.localeCompare(b.tipo_pieza) ||
    (a.variante || '').localeCompare(b.variante || '') ||
    (ordenCalidad[a.calidad] ?? 9) - (ordenCalidad[b.calidad] ?? 9)
  );
  state.lineas = [...new Set(state.piezas.map((p) => p.linea))].sort();
  els.linea.innerHTML = '<option value="">Todas</option>' +
    state.lineas.map((l) => `<option value="${l}">${l}</option>`).join('');

  renderGrid();
  await prefill();
  loadRecientes();
}

function renderGrid() {
  const lineaFiltro = els.linea.value || null;
  const piezas = state.piezas.filter((p) => !lineaFiltro || p.linea === lineaFiltro);
  if (piezas.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay piezas.</td></tr>';
    return;
  }
  let html = '';
  let lineaActual = null;
  for (const p of piezas) {
    if (p.linea !== lineaActual) {
      lineaActual = p.linea;
      html += `<tr class="linea-header"><td colspan="5">${escapeHtml(p.linea)}</td></tr>`;
    }
    html += `<tr data-pieza="${p.id}">
      <td class="col-pieza">${escapeHtml(piezaLabel(p))}</td>
      <td class="col-cal">${CALIDAD_LABEL[p.calidad] || p.calidad}</td>
      ${TIPOS.map((t) => `<td><input type="number" min="0" step="1" class="cell-input" data-tipo="${t}" data-pieza="${p.id}" /></td>`).join('')}
    </tr>`;
  }
  els.tbody.innerHTML = html;
}

async function prefill() {
  // Limpiar inputs visibles
  els.tbody.querySelectorAll('.cell-input').forEach((i) => { i.value = ''; });
  const fecha = els.fecha.value;
  if (!fecha) return;
  els.status.textContent = 'Cargando datos del día…';
  const { data, error } = await client
    .from('produccion')
    .select('pieza_id, tipo, cantidad')
    .eq('fecha', fecha)
    .limit(2000);
  if (error) { els.status.textContent = ''; return; }
  const byKey = new Map();
  for (const r of (data || [])) byKey.set(`${r.pieza_id}|${r.tipo}`, r.cantidad);
  els.tbody.querySelectorAll('.cell-input').forEach((inp) => {
    const k = `${inp.dataset.pieza}|${inp.dataset.tipo}`;
    if (byKey.has(k)) inp.value = byKey.get(k);
  });
  const n = data ? data.length : 0;
  els.status.textContent = n ? `${n} registro(s) ya cargados para esta fecha.` : 'Sin datos cargados para esta fecha todavía.';
}

async function guardar() {
  els.formError.textContent = '';
  const fecha = els.fecha.value;
  if (!fecha) { els.formError.textContent = 'Elegí una fecha.'; return; }

  const filas = [];
  els.tbody.querySelectorAll('.cell-input').forEach((inp) => {
    if (inp.value === '') return; // en blanco: no se toca
    const cantidad = Number(inp.value);
    if (Number.isNaN(cantidad) || cantidad < 0) return;
    filas.push({
      fecha,
      pieza_id: Number(inp.dataset.pieza),
      tipo: inp.dataset.tipo,
      cantidad,
      cargado_por: state.currentUser,
    });
  });

  if (filas.length === 0) { els.formError.textContent = 'No cargaste ninguna cantidad.'; return; }

  els.guardarBtn.disabled = true;
  els.guardarBtn.textContent = 'Guardando…';
  const { error } = await client
    .from('produccion')
    .upsert(filas, { onConflict: 'fecha,pieza_id,tipo' });
  els.guardarBtn.disabled = false;
  els.guardarBtn.textContent = 'Guardar día';

  if (error) { els.formError.textContent = 'Error al guardar: ' + error.message; return; }

  els.status.textContent = `✓ Guardado: ${filas.length} valor(es) para el ${new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR')}.`;
  loadRecientes();
}

async function loadRecientes() {
  // Últimas fechas con carga manual (cargado_por no nulo).
  const { data, error } = await client
    .from('produccion')
    .select('fecha, tipo, cantidad, cargado_por, created_at')
    .not('cargado_por', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { els.recientesList.innerHTML = `<div class="loading">Error: ${error.message}</div>`; return; }
  if (!data || !data.length) {
    els.recientesList.innerHTML = '<div class="loading">Todavía no se cargó producción a mano.</div>';
    return;
  }
  // Agrupar por fecha
  const porFecha = new Map();
  for (const r of data) {
    if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, { prod: 0, venta: 0, rotura: 0, por: r.cargado_por });
    const g = porFecha.get(r.fecha);
    if (r.tipo === 'produccion') g.prod += r.cantidad;
    else if (r.tipo === 'venta') g.venta += r.cantidad;
    else if (r.tipo === 'rotura') g.rotura += r.cantidad;
  }
  const fechas = [...porFecha.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 15);
  els.recientesList.innerHTML = fechas.map(([fecha, g]) => `<div class="recientes-item">
      <div>
        <div class="nombre">${new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR')}</div>
        <div class="meta">Prod ${g.prod} · Venta ${g.venta} · Rotura ${g.rotura} · ${escapeHtml(g.por || '')}</div>
      </div>
    </div>`).join('');
}

els.fecha.addEventListener('change', prefill);
els.linea.addEventListener('change', async () => { renderGrid(); await prefill(); });
els.guardarBtn.addEventListener('click', guardar);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
