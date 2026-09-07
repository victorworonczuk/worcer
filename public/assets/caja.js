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

const state = { filas: [] };

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
  kpiGrid: document.getElementById('kpi-grid'),
  tbodyCategorias: document.getElementById('tbody-categorias'),
  tbodyMovimientos: document.getElementById('tbody-movimientos'),
};

function fmt(n) { return Math.round(n).toLocaleString('es-AR'); }
function fmtPesos(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarUltimaActualizacion() {
  const { data } = await client.from('caja').select('created_at').order('created_at', { ascending: false }).limit(1);
  const fecha = data?.[0]?.created_at;
  if (!fecha) { els.ultimaActualizacion.textContent = ''; return; }
  const d = new Date(fecha);
  const fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.ultimaActualizacion.textContent = `Última carga de archivo: ${fechaStr}, ${horaStr} hs.`;
}

async function cargarDatos() {
  // .order('id') al final: 'fecha' se repite entre movimientos del mismo día,
  // y sin un desempate único fetchAll() puede saltear o repetir filas al
  // paginar en tablas de más de 1000 filas (bug real encontrado 26/08/26).
  const { data, error } = await fetchAll(() =>
    client.from('caja')
      .select('id, fecha, cuenta, detalle, entrada, salida, saldo, es_saldo_inicial')
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
  );
  if (error) {
    els.tbodyMovimientos.innerHTML = `<tr><td class="empty-state" colspan="6">Error al cargar: ${error.message}</td></tr>`;
    return;
  }
  state.filas = data || [];

  const meses = [...new Set(state.filas.map((f) => f.fecha.slice(0, 7)))].sort();
  els.mes.innerHTML = meses.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (meses.length) els.mes.value = meses[meses.length - 1];

  render();
}

function render() {
  const mes = els.mes.value;
  if (!mes) {
    els.kpiGrid.innerHTML = '<div class="empty-state">Sin datos cargados todavía. Subilos desde "Importar caja".</div>';
    els.tbodyCategorias.innerHTML = '';
    els.tbodyMovimientos.innerHTML = '';
    return;
  }

  const filasDelMes = state.filas.filter((f) => f.fecha.slice(0, 7) === mes);
  const saldoInicial = filasDelMes.find((f) => f.es_saldo_inicial)?.saldo ?? null;
  const movimientos = filasDelMes.filter((f) => !f.es_saldo_inicial);
  const totalEntradas = movimientos.reduce((s, f) => s + Number(f.entrada || 0), 0);
  const totalSalidas = movimientos.reduce((s, f) => s + Number(f.salida || 0), 0);
  const ultimaFila = filasDelMes[filasDelMes.length - 1];
  const saldoFinal = ultimaFila ? ultimaFila.saldo : null;

  const kpis = [
    { label: 'Saldo inicial', value: saldoInicial != null ? fmtPesos(saldoInicial) : '—' },
    { label: 'Entradas', value: fmtPesos(totalEntradas) },
    { label: 'Salidas', value: fmtPesos(totalSalidas) },
    { label: 'Saldo final', value: saldoFinal != null ? fmtPesos(saldoFinal) : '—' },
  ];
  els.kpiGrid.innerHTML = kpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
    </div>
  `).join('');

  const porCuenta = new Map();
  for (const f of movimientos) {
    if (!porCuenta.has(f.cuenta)) porCuenta.set(f.cuenta, { cuenta: f.cuenta, entradas: 0, salidas: 0 });
    const g = porCuenta.get(f.cuenta);
    g.entradas += Number(f.entrada || 0);
    g.salidas += Number(f.salida || 0);
  }
  const categorias = [...porCuenta.values()].sort((a, b) => (b.entradas - b.salidas === a.entradas - a.salidas ? 0 : (Math.abs(b.entradas - b.salidas) - Math.abs(a.entradas - a.salidas))));
  els.tbodyCategorias.innerHTML = categorias.length
    ? categorias.map((c) => `
        <tr>
          <td class="col-grupo">${escapeHtml(c.cuenta || '(sin categoría)')}</td>
          <td>${fmtPesos(c.entradas)}</td>
          <td>${fmtPesos(c.salidas)}</td>
          <td class="${c.entradas - c.salidas < 0 ? 'neg' : ''}">${fmtPesos(c.entradas - c.salidas)}</td>
        </tr>
      `).join('')
    : '<tr><td class="empty-state" colspan="4">Sin movimientos este mes.</td></tr>';

  els.tbodyMovimientos.innerHTML = filasDelMes.length
    ? filasDelMes.map((f) => `
        <tr>
          <td>${new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
          <td class="col-grupo">${escapeHtml(f.cuenta || '')}</td>
          <td class="col-grupo">${escapeHtml(f.detalle || '')}</td>
          <td>${f.entrada ? fmtPesos(f.entrada) : '·'}</td>
          <td>${f.salida ? fmtPesos(f.salida) : '·'}</td>
          <td>${f.saldo != null ? fmtPesos(f.saldo) : '·'}</td>
        </tr>
      `).join('')
    : '<tr><td class="empty-state" colspan="6">Sin movimientos este mes.</td></tr>';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

els.mes.addEventListener('change', render);

(async () => {
  await initUser();
  await Promise.all([cargarDatos(), cargarUltimaActualizacion()]);
})();
