const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Supabase/PostgREST corta cada respuesta a 1000 filas aunque se pida un
// .limit() más alto — hay que paginar con .range() hasta que la página
// vuelva incompleta (ver la misma nota en public/assets/app.js).
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

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };

const state = { currentUser: null, piezas: [], lineas: [] };

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
    els.tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Error al cargar piezas: ${error.message}</td></tr>`;
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
    els.tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No hay piezas.</td></tr>';
    return;
  }
  let html = '';
  let lineaActual = null;
  for (const p of piezas) {
    if (p.linea !== lineaActual) {
      lineaActual = p.linea;
      html += `<tr class="linea-header"><td colspan="3">${escapeHtml(p.linea)}</td></tr>`;
    }
    html += `<tr data-pieza="${p.id}">
      <td class="col-pieza">${escapeHtml(piezaLabel(p))}</td>
      <td class="col-cal">${CALIDAD_LABEL[p.calidad] || p.calidad}</td>
      <td><input type="number" min="0" step="1" class="cell-input" data-pieza="${p.id}" /></td>
    </tr>`;
  }
  els.tbody.innerHTML = html;
}

async function prefill() {
  els.tbody.querySelectorAll('.cell-input').forEach((i) => { i.value = ''; });
  const fecha = els.fecha.value;
  if (!fecha) return;
  els.status.textContent = 'Cargando recuento de la fecha…';
  const { data, error } = await client
    .from('produccion')
    .select('pieza_id, cantidad')
    .eq('fecha', fecha)
    .eq('tipo', 'recuento')
    .limit(2000);
  if (error) { els.status.textContent = ''; return; }
  const byPieza = new Map();
  for (const r of (data || [])) byPieza.set(String(r.pieza_id), r.cantidad);
  els.tbody.querySelectorAll('.cell-input').forEach((inp) => {
    if (byPieza.has(inp.dataset.pieza)) inp.value = byPieza.get(inp.dataset.pieza);
  });
  const n = data ? data.length : 0;
  els.status.textContent = n ? `${n} pieza(s) ya tienen recuento en esta fecha.` : 'Sin recuento cargado para esta fecha todavía.';
}

async function guardar() {
  els.formError.textContent = '';
  const fecha = els.fecha.value;
  if (!fecha) { els.formError.textContent = 'Elegí la fecha del recuento.'; return; }

  const filas = [];
  els.tbody.querySelectorAll('.cell-input').forEach((inp) => {
    if (inp.value === '') return;
    const cantidad = Number(inp.value);
    if (Number.isNaN(cantidad) || cantidad < 0) return;
    filas.push({ fecha, pieza_id: Number(inp.dataset.pieza), tipo: 'recuento', cantidad, cargado_por: state.currentUser });
  });

  if (filas.length === 0) { els.formError.textContent = 'No cargaste ninguna cantidad contada.'; return; }

  els.guardarBtn.disabled = true;
  els.guardarBtn.textContent = 'Guardando…';
  const { error } = await client
    .from('produccion')
    .upsert(filas, { onConflict: 'fecha,pieza_id,tipo' });
  els.guardarBtn.disabled = false;
  els.guardarBtn.textContent = 'Guardar recuento';

  if (error) { els.formError.textContent = 'Error al guardar: ' + error.message; return; }

  els.status.textContent = `✓ Recuento guardado: ${filas.length} pieza(s) para el ${new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR')}.`;
  loadRecientes();
}

async function loadRecientes() {
  const { data, error } = await fetchAll(() =>
    client
      .from('produccion')
      .select('fecha, cantidad, cargado_por')
      .eq('tipo', 'recuento')
      .order('fecha', { ascending: false })
  );
  if (error) { els.recientesList.innerHTML = `<div class="loading">Error: ${error.message}</div>`; return; }
  if (!data || !data.length) {
    els.recientesList.innerHTML = '<div class="loading">Todavía no se cargó ningún recuento.</div>';
    return;
  }
  const porFecha = new Map();
  for (const r of data) {
    if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, { piezas: 0, total: 0, por: r.cargado_por });
    const g = porFecha.get(r.fecha);
    g.piezas += 1;
    g.total += r.cantidad;
  }
  const fechas = [...porFecha.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 15);
  els.recientesList.innerHTML = fechas.map(([fecha, g]) => `<div class="recientes-item">
      <div>
        <div class="nombre">${new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR')}</div>
        <div class="meta">${g.piezas} pieza(s) · ${g.total} u. contadas · ${escapeHtml(g.por || '')}</div>
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
