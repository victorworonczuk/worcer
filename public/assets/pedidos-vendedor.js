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

// CUITs propios de Víctor (Cerámica Sanitaria 8 de Julio SRL, Porcelanas
// Alberti SRL) — una factura entre ellas no es una venta real a un cliente.
const CUITS_PROPIOS = new Set(['30709413208', '30714033189']);

// Hasta el 29/09/26 estas tablas salían de pedidos_vendedor (carga manual
// desde "Cargar pedidos") — se desincronizaba fácil, mismo problema que ya
// resolvimos en Análisis semanal e Inicio (ver commit 41b1bf4). Ahora "un
// pedido" es directamente una factura real, agrupada por el vendedor ACTUAL
// del cliente (cartera fija) — nunca puede faltar mientras la factura esté
// cargada, y no hace falta que nadie tipee nada acá.
const state = {
  facturas: [], // { id, fecha, importe_ars, vendedor }
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  tbodyAnual: document.getElementById('tbody-anual'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
};

const TABLAS = {
  cantidad: {
    campo: 'cantidad',
    fmtCelda: fmt,
    resumen: document.getElementById('resumen-cantidad'),
    thead: document.getElementById('thead-cantidad'),
    tbody: document.getElementById('tbody-cantidad'),
    notaPie: document.getElementById('nota-pie-cantidad'),
  },
  monto: {
    campo: 'monto_ars',
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
function celda(val, fmtFn) {
  if (!val) return `<td class="zero">·</td>`;
  return `<td class="${val < 0 ? 'neg' : ''}">${fmtFn(val)}</td>`;
}
function fmtPct(val, totalGeneral) {
  if (!totalGeneral) return '·';
  return (val / totalGeneral * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
}
function claseVacio(val) {
  return (!val) ? 'zero' : '';
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarUltimaActualizacion() {
  const { data } = await client.from('facturas').select('created_at').order('created_at', { ascending: false }).limit(1);
  const fecha = data?.[0]?.created_at;
  if (!fecha) { els.ultimaActualizacion.textContent = ''; return; }
  const d = new Date(fecha);
  const fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.ultimaActualizacion.textContent = `Última carga de archivo: ${fechaStr}, ${horaStr} hs.`;
}

async function cargarDatos() {
  // .order('id') al final: sin desempate único, fetchAll() puede saltear o
  // repetir filas al paginar en tablas de más de 1000 filas (bug real
  // encontrado 26/08/26).
  const [{ data: facturas, error: e1 }, { data: clientes, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('facturas').select('id, fecha, importe_ars, cliente_id, cuit_normalizado').order('fecha').order('id', { ascending: true })),
    fetchAll(() => client.from('clientes').select('id, vendedor').order('id', { ascending: true })),
  ]);
  if (e1 || e2) {
    const msg = `<tr><td class="empty-state">Error al cargar: ${(e1 || e2).message}</td></tr>`;
    TABLAS.cantidad.tbody.innerHTML = msg;
    TABLAS.monto.tbody.innerHTML = msg;
    return;
  }

  const vendedorPorCliente = new Map((clientes || []).map((c) => [c.id, c.vendedor]));
  state.facturas = (facturas || [])
    .filter((f) => f.fecha && f.cliente_id && !CUITS_PROPIOS.has(f.cuit_normalizado))
    .map((f) => ({ ...f, vendedor: vendedorPorCliente.get(f.cliente_id) }))
    .filter((f) => f.vendedor);

  const meses = [...new Set(state.facturas.map((f) => f.fecha.slice(0, 7)))].sort();
  els.mes.innerHTML = meses.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (meses.length) els.mes.value = meses[meses.length - 1]; // último mes con datos por defecto

  render();
  renderAnual();
}

// Total acumulado del año calendario actual (no "todo lo cargado alguna
// vez" — con facturas como fuente, eso sería todo el historial).
function renderAnual() {
  const anioActual = String(new Date().getFullYear());
  const facturasDelAnio = state.facturas.filter((f) => f.fecha.slice(0, 4) === anioActual);
  if (facturasDelAnio.length === 0) {
    els.tbodyAnual.innerHTML = '<tr><td class="empty-state">Sin facturas de clientes con vendedor asignado este año.</td></tr>';
    return;
  }
  const porVendedor = new Map();
  for (const f of facturasDelAnio) {
    if (!porVendedor.has(f.vendedor)) porVendedor.set(f.vendedor, { cantidad: 0, monto_ars: 0 });
    const g = porVendedor.get(f.vendedor);
    g.cantidad += 1;
    g.monto_ars += Number(f.importe_ars || 0);
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

// Proyección lineal simple a fin de mes: total acumulado / días
// transcurridos × días totales del mes. Si el mes ya terminó, no se
// extrapola — el "proyectado" es directamente el total real.
function proyectarFinDeMes(mes, totalAcumulado) {
  const [anio, mesNum] = mes.split('-').map(Number);
  const totalDias = new Date(anio, mesNum, 0).getDate();
  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() + 1 === mesNum;
  if (!esMesActual) {
    const esMesFuturo = new Date(anio, mesNum - 1, 1) > hoy;
    return esMesFuturo ? null : totalAcumulado;
  }
  const diasTranscurridos = hoy.getDate();
  if (diasTranscurridos <= 0) return null;
  return totalAcumulado / diasTranscurridos * totalDias;
}

function renderTabla(cfg) {
  const mes = els.mes.value;
  if (!mes) {
    cfg.resumen.innerHTML = '';
    cfg.thead.innerHTML = '';
    cfg.tbody.innerHTML = '<tr><td class="empty-state">Sin facturas de clientes con vendedor asignado todavía.</td></tr>';
    cfg.notaPie.textContent = '';
    return;
  }

  const { campo, fmtCelda } = cfg;

  const facturasDelMes = state.facturas.filter((f) => f.fecha.slice(0, 7) === mes);
  // Solo los días que realmente tienen alguna factura (evita columnas vacías
  // para sábados/domingos/feriados sin ventas).
  const dias = [...new Set(facturasDelMes.map((f) => f.fecha))].sort();

  const porVendedor = new Map();
  for (const f of facturasDelMes) {
    if (!porVendedor.has(f.vendedor)) porVendedor.set(f.vendedor, {});
    const valor = campo === 'cantidad' ? 1 : Number(f.importe_ars || 0);
    porVendedor.get(f.vendedor)[f.fecha] = (porVendedor.get(f.vendedor)[f.fecha] || 0) + valor;
  }

  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, porDia]) => {
      const total = Object.values(porDia).reduce((a, b) => a + b, 0);
      return { vendedor, porDia, total, proyectado: proyectarFinDeMes(mes, total) };
    })
    .sort((a, b) => b.total - a.total);

  const totalGeneral = vendedores.reduce((a, v) => a + v.total, 0);
  const proyectadoGeneral = proyectarFinDeMes(mes, totalGeneral);
  const totalPorDia = {};
  for (const dia of dias) totalPorDia[dia] = vendedores.reduce((a, v) => a + (v.porDia[dia] || 0), 0);

  cfg.resumen.innerHTML = `
    <div><strong>${fmtCelda(totalGeneral)}</strong><span class="label">total acumulado del mes</span></div>
    <div><strong>${proyectadoGeneral != null ? fmtCelda(proyectadoGeneral) : '·'}</strong><span class="label">proyectado a fin de mes</span></div>
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
      <td class="col-total ${claseVacio(proyectadoGeneral)} ${proyectadoGeneral < 0 ? 'neg' : ''}">${proyectadoGeneral != null ? fmtCelda(proyectadoGeneral) : '·'}</td>
      <td class="col-total">100%</td>
    </tr>`;

  cfg.notaPie.textContent = 'Cada "pedido" es una factura real de un cliente con vendedor asignado — se arma solo con las facturas ya importadas, no hace falta cargar nada acá. "Proyectado" es una proyección lineal simple (acumulado / días pasados × días del mes). Los valores negativos (si los hay) son notas de crédito.';
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
