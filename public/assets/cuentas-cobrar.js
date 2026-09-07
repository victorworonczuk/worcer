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

const state = { cuentas: [], cheques: [] };

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
  kpiGrid: document.getElementById('kpi-grid'),
  soloVencidas: document.getElementById('f-solo-vencidas'),
  tbodyPendientes: document.getElementById('tbody-pendientes'),
  tbodyMorosos: document.getElementById('tbody-morosos'),
  tbodyCheques: document.getElementById('tbody-cheques'),
};

function fmtPesos(n) { return n == null ? '·' : '$' + Math.round(Number(n)).toLocaleString('es-AR'); }
function fmtFecha(f) { return f ? new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '·'; }
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarUltimaActualizacion() {
  const { data } = await client.from('cuentas_cobrar').select('created_at').order('created_at', { ascending: false }).limit(1);
  const fecha = data?.[0]?.created_at;
  if (!fecha) { els.ultimaActualizacion.textContent = ''; return; }
  const d = new Date(fecha);
  const fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.ultimaActualizacion.textContent = `Última carga de archivo: ${fechaStr}, ${horaStr} hs.`;
}

async function cargarDatos() {
  // .order('id') al final en ambas: sin desempate único, fetchAll() puede
  // saltear o repetir filas al paginar en tablas de más de 1000 filas (bug
  // real encontrado 26/08/26).
  const [{ data: cuentas, error: e1 }, { data: cheques, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('cuentas_cobrar')
      .select('id, empresa, fecha_emision, numero_factura, cliente_nombre, cliente_id, monto, fecha_estimada_pago, vendedor, origen')
      .order('fecha_estimada_pago', { ascending: true })
      .order('id', { ascending: true })),
    fetchAll(() => client.from('cheques_rechazados')
      .select('id, empresa, fecha_nd, cliente_nombre, monto_debido, monto_recuperado, saldo, estado, vendedor')
      .order('fecha_nd', { ascending: false })
      .order('id', { ascending: true })),
  ]);
  if (e1 || e2) {
    els.kpiGrid.innerHTML = `<div class="empty-state">Error al cargar: ${(e1 || e2).message}</div>`;
    return;
  }
  state.cuentas = cuentas || [];
  state.cheques = cheques || [];
  render();
}

function render() {
  const hoyStr = new Date().toISOString().slice(0, 10);
  const pendientes = state.cuentas.filter((c) => c.origen === 'pendiente');
  const morosos = state.cuentas.filter((c) => c.origen === 'moroso');
  const vencidas = pendientes.filter((c) => c.fecha_estimada_pago && c.fecha_estimada_pago < hoyStr);

  const totalPendiente = pendientes.reduce((s, c) => s + Number(c.monto || 0), 0);
  const totalVencido = vencidas.reduce((s, c) => s + Number(c.monto || 0), 0);
  const totalChequesSaldo = state.cheques.reduce((s, c) => s + Number(c.saldo || 0), 0);

  els.kpiGrid.innerHTML = [
    { label: 'Pendiente de cobro', value: fmtPesos(totalPendiente), sub: `${pendientes.length} factura(s)` },
    { label: 'Vencido', value: fmtPesos(totalVencido), sub: `${vencidas.length} factura(s)`, alerta: vencidas.length > 0 },
    { label: 'Morosos', value: fmtPesos(morosos.reduce((s, c) => s + Number(c.monto || 0), 0)), sub: `${morosos.length} factura(s)` },
    { label: 'Cheques rechazados sin recuperar', value: fmtPesos(totalChequesSaldo), sub: `${state.cheques.length} cheque(s)`, alerta: totalChequesSaldo > 0 },
  ].map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value${k.alerta ? ' kpi-alerta' : ''}">${k.value}</div>
      <div class="kpi-label">${k.sub}</div>
    </div>
  `).join('');

  const filaCuenta = (c) => {
    const venc = c.fecha_estimada_pago && c.fecha_estimada_pago < hoyStr;
    return `
      <tr>
        <td>${escapeHtml(c.empresa || '')}</td>
        <td>${fmtFecha(c.fecha_emision)}</td>
        <td>${escapeHtml(c.numero_factura || '')}</td>
        <td class="col-grupo">${escapeHtml(c.cliente_nombre)}${!c.cliente_id ? ' <span class="empty-state">(sin vincular)</span>' : ''}</td>
        <td>${fmtPesos(c.monto)}</td>
        <td class="${venc ? 'neg' : ''}">${fmtFecha(c.fecha_estimada_pago)}</td>
        <td class="col-grupo">${escapeHtml(c.vendedor || '')}</td>
      </tr>
    `;
  };

  const pendientesFiltradas = els.soloVencidas.checked ? vencidas : pendientes;
  els.tbodyPendientes.innerHTML = pendientesFiltradas.length
    ? pendientesFiltradas.map(filaCuenta).join('')
    : '<tr><td class="empty-state" colspan="7">Sin facturas pendientes.</td></tr>';

  els.tbodyMorosos.innerHTML = morosos.length
    ? morosos.map(filaCuenta).join('')
    : '<tr><td class="empty-state" colspan="7">Sin clientes morosos cargados.</td></tr>';

  els.tbodyCheques.innerHTML = state.cheques.length
    ? state.cheques.map((c) => `
        <tr>
          <td>${escapeHtml(c.empresa || '')}</td>
          <td>${fmtFecha(c.fecha_nd)}</td>
          <td class="col-grupo">${escapeHtml(c.cliente_nombre)}</td>
          <td>${fmtPesos(c.monto_debido)}</td>
          <td>${fmtPesos(c.monto_recuperado)}</td>
          <td class="${Number(c.saldo) < 0 || Number(c.saldo) > 0 ? 'neg' : ''}">${fmtPesos(c.saldo)}</td>
          <td>${escapeHtml(c.estado || '')}</td>
          <td class="col-grupo">${escapeHtml(c.vendedor || '')}</td>
        </tr>
      `).join('')
    : '<tr><td class="empty-state" colspan="8">Sin cheques rechazados cargados.</td></tr>';
}

els.soloVencidas.addEventListener('change', render);

(async () => {
  await initUser();
  await Promise.all([cargarDatos(), cargarUltimaActualizacion()]);
})();
