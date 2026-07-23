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
  proyecciones: [], // { vendedor, mes, proyectado_cantidad, proyectado_monto }
  tipo: 'cantidad', // 'cantidad' | 'monto'
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
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
  const [{ data: filas, error: e1 }, { data: proyecciones, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('pedidos_vendedor').select('vendedor, fecha, cantidad, monto_ars').order('fecha')),
    fetchAll(() => client.from('pedidos_vendedor_proyeccion').select('vendedor, mes, proyectado_cantidad, proyectado_monto')),
  ]);
  if (e1 || e2) {
    els.tbody.innerHTML = `<tr><td class="empty-state">Error al cargar: ${(e1 || e2).message}</td></tr>`;
    return;
  }
  state.filas = filas || [];
  state.proyecciones = proyecciones || [];

  const meses = [...new Set(state.filas.map((f) => f.fecha.slice(0, 7)))].sort();
  els.mes.innerHTML = meses.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (meses.length) els.mes.value = meses[meses.length - 1]; // último mes con datos por defecto

  render();
}

function render() {
  const mes = els.mes.value;
  if (!mes) {
    els.resumen.innerHTML = '';
    els.thead.innerHTML = '';
    els.tbody.innerHTML = '<tr><td class="empty-state">Sin datos cargados todavía. Subilos desde "Cargar pedidos".</td></tr>';
    els.notaPie.textContent = '';
    return;
  }

  const campo = state.tipo === 'cantidad' ? 'cantidad' : 'monto_ars';
  const campoProy = state.tipo === 'cantidad' ? 'proyectado_cantidad' : 'proyectado_monto';
  const fmtCelda = state.tipo === 'cantidad' ? fmt : fmtPesos;

  const filasDelMes = state.filas.filter((f) => f.fecha.slice(0, 7) === mes);
  // Solo los días que realmente tienen alguna fila cargada (evita mostrar
  // columnas vacías para sábados/domingos/feriados, que el archivo no trae).
  const dias = [...new Set(filasDelMes.map((f) => f.fecha))].sort();

  const porVendedor = new Map();
  for (const f of filasDelMes) {
    if (!porVendedor.has(f.vendedor)) porVendedor.set(f.vendedor, {});
    porVendedor.get(f.vendedor)[f.fecha] = (porVendedor.get(f.vendedor)[f.fecha] || 0) + f[campo];
  }
  const proyectadoPorVendedor = new Map();
  for (const p of state.proyecciones) {
    if (p.mes === mes && p[campoProy] != null) proyectadoPorVendedor.set(p.vendedor, p[campoProy]);
  }

  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, porDia]) => ({
      vendedor,
      porDia,
      total: Object.values(porDia).reduce((a, b) => a + b, 0),
      proyectado: proyectadoPorVendedor.get(vendedor) ?? null,
    }))
    .sort((a, b) => b.total - a.total);

  const totalGeneral = vendedores.reduce((a, v) => a + v.total, 0);
  const proyectadoGeneral = vendedores.reduce((a, v) => a + (v.proyectado || 0), 0);
  const totalPorDia = {};
  for (const dia of dias) totalPorDia[dia] = vendedores.reduce((a, v) => a + (v.porDia[dia] || 0), 0);

  els.resumen.innerHTML = `
    <div><strong>${fmtCelda(totalGeneral)}</strong><span class="label">total acumulado del mes</span></div>
    <div><strong>${fmtCelda(proyectadoGeneral)}</strong><span class="label">proyectado a fin de mes</span></div>
    <div><strong>${escapeHtml(vendedores[0]?.vendedor || '—')}</strong><span class="label">mejor vendedor</span></div>
  `;

  els.thead.innerHTML = `<tr>
    <th class="col-grupo">Vendedor</th>
    ${dias.map((d) => `<th>${d.slice(8, 10)}</th>`).join('')}
    <th class="col-total">Total</th>
    <th class="col-total">Proyectado</th>
  </tr>`;

  els.tbody.innerHTML = vendedores.map((v) => `<tr>
      <td class="col-grupo">${escapeHtml(v.vendedor)}</td>
      ${dias.map((d) => {
        const val = v.porDia[d] || 0;
        return `<td class="${val === 0 ? 'zero' : ''}">${val === 0 ? '·' : fmtCelda(val)}</td>`;
      }).join('')}
      <td class="col-total">${fmtCelda(v.total)}</td>
      <td class="col-total">${v.proyectado != null ? fmtCelda(v.proyectado) : '·'}</td>
    </tr>`).join('') + `
    <tr class="fila-total">
      <td class="col-grupo">Total</td>
      ${dias.map((d) => `<td>${fmtCelda(totalPorDia[d])}</td>`).join('')}
      <td class="col-total">${fmtCelda(totalGeneral)}</td>
      <td class="col-total">${fmtCelda(proyectadoGeneral)}</td>
    </tr>`;

  els.notaPie.textContent = 'Cargado desde el "Tablero de pedidos de venta" mensual. "Proyectado" es el valor que ya trae el Excel (total acumulado / días hábiles transcurridos × días hábiles del mes), no se recalcula acá. Los valores negativos (si los hay) reflejan correcciones/cancelaciones del propio archivo de origen.';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

els.mes.addEventListener('change', render);
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
