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
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  tbodyAnual: document.getElementById('tbody-anual'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
};

// Las dos tablas (cantidad y $) se muestran siempre juntas, completas, en
// vez de una sola tabla con pestaña para alternar — cada una con sus
// propios elementos de resumen/thead/tbody/nota.
const TABLAS = {
  cantidad: {
    campo: 'cantidad',
    campoProy: 'proyectado_cantidad',
    fmtCelda: fmt,
    resumen: document.getElementById('resumen-cantidad'),
    thead: document.getElementById('thead-cantidad'),
    tbody: document.getElementById('tbody-cantidad'),
    notaPie: document.getElementById('nota-pie-cantidad'),
  },
  monto: {
    campo: 'monto_ars',
    campoProy: 'proyectado_monto',
    fmtCelda: fmtPesos,
    resumen: document.getElementById('resumen-monto'),
    thead: document.getElementById('thead-monto'),
    tbody: document.getElementById('tbody-monto'),
    notaPie: document.getElementById('nota-pie-monto'),
  },
};

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtPesos(n) {
  return '$' + fmt(n);
}
// Celda de la tabla pivot: '·' para cero, en rojo si es negativo (corrección/cancelación).
function celda(val, fmtFn) {
  if (val === 0) return `<td class="zero">·</td>`;
  return `<td class="${val < 0 ? 'neg' : ''}">${fmtFn(val)}</td>`;
}
// % de participación de un vendedor sobre el total de todos — 100% = la venta total.
function fmtPct(val, totalGeneral) {
  if (!totalGeneral) return '·';
  return (val / totalGeneral * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
}
// Clase para pintar Total/Proyectado/% igual que las celdas diarias: amarillo
// si no hay nada cargado (0 o sin dato), celeste si hay algo.
function claseVacio(val) {
  return (val === 0 || val === null || val === undefined) ? 'zero' : '';
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

// La fecha/hora de la fila más reciente (updated_at) de cualquiera de las
// dos tablas que carga "Cargar pedidos" — se actualiza siempre juntas en
// la misma importación, así que el máximo de las dos es "la última carga".
async function cargarUltimaActualizacion() {
  const [{ data: a }, { data: b }] = await Promise.all([
    client.from('pedidos_vendedor').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    client.from('pedidos_vendedor_proyeccion').select('updated_at').order('updated_at', { ascending: false }).limit(1),
  ]);
  const fechas = [a?.[0]?.updated_at, b?.[0]?.updated_at].filter(Boolean).map((f) => new Date(f));
  if (fechas.length === 0) { els.ultimaActualizacion.textContent = ''; return; }
  const ultima = new Date(Math.max(...fechas));
  const fechaStr = ultima.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = ultima.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.ultimaActualizacion.textContent = `Última carga de archivo: ${fechaStr}, ${horaStr} hs.`;
}

async function cargarDatos() {
  const [{ data: filas, error: e1 }, { data: proyecciones, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('pedidos_vendedor').select('vendedor, fecha, cantidad, monto_ars').order('fecha')),
    fetchAll(() => client.from('pedidos_vendedor_proyeccion').select('vendedor, mes, proyectado_cantidad, proyectado_monto')),
  ]);
  if (e1 || e2) {
    const msg = `<tr><td class="empty-state">Error al cargar: ${(e1 || e2).message}</td></tr>`;
    TABLAS.cantidad.tbody.innerHTML = msg;
    TABLAS.monto.tbody.innerHTML = msg;
    return;
  }
  state.filas = filas || [];
  state.proyecciones = proyecciones || [];

  const meses = [...new Set(state.filas.map((f) => f.fecha.slice(0, 7)))].sort();
  els.mes.innerHTML = meses.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (meses.length) els.mes.value = meses[meses.length - 1]; // último mes con datos por defecto

  render();
  renderAnual();
}

// Total acumulado de TODO lo cargado (todos los meses juntos), sin filtro de
// mes — cantidad y monto en la misma tabla, no depende de la pestaña Cantidad/Monto.
function renderAnual() {
  if (state.filas.length === 0) {
    els.tbodyAnual.innerHTML = '<tr><td class="empty-state">Sin datos cargados todavía.</td></tr>';
    return;
  }
  const porVendedor = new Map();
  for (const f of state.filas) {
    if (!porVendedor.has(f.vendedor)) porVendedor.set(f.vendedor, { cantidad: 0, monto_ars: 0 });
    const g = porVendedor.get(f.vendedor);
    g.cantidad += f.cantidad;
    g.monto_ars += f.monto_ars;
  }
  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, g]) => ({ vendedor, ...g }))
    .sort((a, b) => b.monto_ars - a.monto_ars);
  const total = vendedores.reduce((a, v) => ({ cantidad: a.cantidad + v.cantidad, monto_ars: a.monto_ars + v.monto_ars }), { cantidad: 0, monto_ars: 0 });

  els.tbodyAnual.innerHTML = vendedores.map((v) => `<tr>
      <td class="col-grupo">${escapeHtml(v.vendedor)}</td>
      <td class="${v.cantidad < 0 ? 'neg' : ''}">${fmt(v.cantidad)}</td>
      <td class="${v.monto_ars < 0 ? 'neg' : ''}">${fmtPesos(v.monto_ars)}</td>
      <td>${fmtPct(v.monto_ars, total.monto_ars)}</td>
    </tr>`).join('') + `
    <tr class="fila-total">
      <td class="col-grupo">Total</td>
      <td class="${total.cantidad < 0 ? 'neg' : ''}">${fmt(total.cantidad)}</td>
      <td class="${total.monto_ars < 0 ? 'neg' : ''}">${fmtPesos(total.monto_ars)}</td>
      <td>100%</td>
    </tr>`;
}

function render() {
  renderTabla(TABLAS.cantidad);
  renderTabla(TABLAS.monto);
}

function renderTabla(cfg) {
  const mes = els.mes.value;
  if (!mes) {
    cfg.resumen.innerHTML = '';
    cfg.thead.innerHTML = '';
    cfg.tbody.innerHTML = '<tr><td class="empty-state">Sin datos cargados todavía. Subilos desde "Cargar pedidos".</td></tr>';
    cfg.notaPie.textContent = '';
    return;
  }

  const { campo, campoProy, fmtCelda } = cfg;

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

  cfg.resumen.innerHTML = `
    <div><strong>${fmtCelda(totalGeneral)}</strong><span class="label">total acumulado del mes</span></div>
    <div><strong>${fmtCelda(proyectadoGeneral)}</strong><span class="label">proyectado a fin de mes</span></div>
    <div><strong>${escapeHtml(vendedores[0]?.vendedor || '—')}</strong><span class="label">mejor vendedor</span></div>
  `;

  cfg.thead.innerHTML = `<tr>
    <th class="col-grupo">Vendedor</th>
    ${dias.map((d) => `<th>${d.slice(8, 10)}</th>`).join('')}
    <th class="col-total">Total</th>
    <th class="col-total">Proyectado</th>
    <th class="col-total">%</th>
  </tr>`;

  cfg.tbody.innerHTML = vendedores.map((v) => `<tr>
      <td class="col-grupo">${escapeHtml(v.vendedor)}</td>
      ${dias.map((d) => celda(v.porDia[d] || 0, fmtCelda)).join('')}
      <td class="col-total ${claseVacio(v.total)} ${v.total < 0 ? 'neg' : ''}">${fmtCelda(v.total)}</td>
      <td class="col-total ${claseVacio(v.proyectado)} ${v.proyectado < 0 ? 'neg' : ''}">${v.proyectado != null ? fmtCelda(v.proyectado) : '·'}</td>
      <td class="col-total ${claseVacio(v.proyectado)}">${fmtPct(v.proyectado || 0, proyectadoGeneral)}</td>
    </tr>`).join('') + `
    <tr class="fila-total">
      <td class="col-grupo">Total</td>
      ${dias.map((d) => celda(totalPorDia[d], fmtCelda)).join('')}
      <td class="col-total ${claseVacio(totalGeneral)} ${totalGeneral < 0 ? 'neg' : ''}">${fmtCelda(totalGeneral)}</td>
      <td class="col-total ${claseVacio(proyectadoGeneral)} ${proyectadoGeneral < 0 ? 'neg' : ''}">${fmtCelda(proyectadoGeneral)}</td>
      <td class="col-total">100%</td>
    </tr>`;

  cfg.notaPie.textContent = 'Cargado desde el "Tablero de pedidos de venta" mensual. "Proyectado" es el valor que ya trae el Excel (total acumulado / días hábiles transcurridos × días hábiles del mes), no se recalcula acá. Los valores negativos (si los hay) reflejan correcciones/cancelaciones del propio archivo de origen.';
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
