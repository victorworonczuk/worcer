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

const state = {
  filas: [], // { vendedor, fecha, cantidad, monto_ars }
  tipo: 'cantidad', // 'cantidad' | 'monto'
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  desde: document.getElementById('f-desde'),
  hasta: document.getElementById('f-hasta'),
  limpiarBtn: document.getElementById('limpiar-btn'),
  resumen: document.getElementById('resumen'),
  metricTabs: document.getElementById('metric-tabs'),
  thead: document.getElementById('thead'),
  tbody: document.getElementById('tbody'),
  notaPie: document.getElementById('nota-pie'),
};

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtPesos(n) {
  return '$' + fmt(n);
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarDatos() {
  const { data, error } = await fetchAll(() =>
    client.from('pedidos_vendedor').select('vendedor, fecha, cantidad, monto_ars').order('fecha')
  );
  if (error) {
    els.tbody.innerHTML = `<tr><td class="empty-state">Error al cargar: ${error.message}</td></tr>`;
    return;
  }
  state.filas = data || [];
  render();
}

function filasFiltradas() {
  const desde = els.desde.value;
  const hasta = els.hasta.value;
  return state.filas.filter((f) => (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta));
}

function mesDe(fecha) {
  return fecha.slice(0, 7); // "AAAA-MM"
}

function render() {
  const filas = filasFiltradas();
  if (filas.length === 0) {
    els.resumen.innerHTML = '';
    els.thead.innerHTML = '';
    els.tbody.innerHTML = '<tr><td class="empty-state">Sin datos cargados para este período. Subilos desde "Cargar pedidos".</td></tr>';
    els.notaPie.textContent = '';
    return;
  }

  const meses = [...new Set(filas.map((f) => mesDe(f.fecha)))].sort();
  const campo = state.tipo === 'cantidad' ? 'cantidad' : 'monto_ars';

  const porVendedor = new Map();
  for (const f of filas) {
    if (!porVendedor.has(f.vendedor)) porVendedor.set(f.vendedor, {});
    const g = porVendedor.get(f.vendedor);
    const mes = mesDe(f.fecha);
    g[mes] = (g[mes] || 0) + f[campo];
  }

  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, porMes]) => ({
      vendedor,
      porMes,
      total: Object.values(porMes).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const totalGeneral = vendedores.reduce((a, v) => a + v.total, 0);
  const totalPorMes = {};
  for (const mes of meses) totalPorMes[mes] = vendedores.reduce((a, v) => a + (v.porMes[mes] || 0), 0);

  const fmtCelda = state.tipo === 'cantidad' ? fmt : fmtPesos;

  els.resumen.innerHTML = `
    <div><strong>${fmtCelda(totalGeneral)}</strong><span class="label">total del período</span></div>
    <div><strong>${escapeHtml(vendedores[0]?.vendedor || '—')}</strong><span class="label">mejor vendedor</span></div>
    <div><strong>${vendedores.length}</strong><span class="label">vendedores con pedidos</span></div>
  `;

  els.thead.innerHTML = `<tr>
    <th class="col-grupo">Vendedor</th>
    ${meses.map((m) => `<th>${m}</th>`).join('')}
    <th class="col-total">Total</th>
  </tr>`;

  els.tbody.innerHTML = vendedores.map((v) => `<tr>
      <td class="col-grupo">${escapeHtml(v.vendedor)}</td>
      ${meses.map((m) => {
        const val = v.porMes[m] || 0;
        return `<td class="${val === 0 ? 'zero' : ''}">${val === 0 ? '·' : fmtCelda(val)}</td>`;
      }).join('')}
      <td class="col-total">${fmtCelda(v.total)}</td>
    </tr>`).join('') + `
    <tr class="fila-total">
      <td class="col-grupo">Total</td>
      ${meses.map((m) => `<td>${fmtCelda(totalPorMes[m])}</td>`).join('')}
      <td class="col-total">${fmtCelda(totalGeneral)}</td>
    </tr>`;

  els.notaPie.textContent = 'Cargado desde el "Tablero de pedidos de venta" mensual. Los valores negativos (si los hay) reflejan correcciones/cancelaciones del propio archivo de origen.';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

els.desde.addEventListener('change', render);
els.hasta.addEventListener('change', render);
els.limpiarBtn.addEventListener('click', () => {
  els.desde.value = '';
  els.hasta.value = '';
  render();
});
els.metricTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.metric-tab');
  if (!tab) return;
  els.metricTabs.querySelectorAll('.metric-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  state.tipo = tab.dataset.tipo;
  render();
});

(async () => {
  await initUser();
  await cargarDatos();
})();
