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

function fmt(n) { return Math.round(n).toLocaleString('es-AR'); }
function fmtPesos(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }
function fmtPct(n) { return `${(n * 100).toFixed(0)}%`; }

// --- Semana ISO 8601 (lunes a domingo) ---
function isoWeekToRange(isoWeekStr) {
  const [yearStr, weekStr] = isoWeekStr.split('-W');
  const year = Number(yearStr);
  const week = Number(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { desde: monday.toISOString().slice(0, 10), hasta: sunday.toISOString().slice(0, 10), monday };
}

function dateToIsoWeekStr(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function fmtFechaCorta(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

const state = {
  facturas: [],       // todas las facturas (se filtra en memoria por semana)
  factura_items: [],  // con pieza embebida
  descuentos: [],      // escalas de la lista de precios
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  semana: document.getElementById('f-semana'),
  rango: document.getElementById('semanal-rango'),
  btnAnterior: document.getElementById('semana-anterior'),
  btnSiguiente: document.getElementById('semana-siguiente'),
  btnActual: document.getElementById('semana-actual'),
  kpiGrid: document.getElementById('kpi-grid'),
  descuentoHint: document.getElementById('descuento-hint'),
  descuentoChart: document.getElementById('descuento-chart'),
  tendenciaChart: document.getElementById('tendencia-chart'),
  tendenciaLegend: document.getElementById('tendencia-legend'),
  piezasTbody: document.getElementById('piezas-tbody'),
};

async function init() {
  const me = await (await fetch('/api/me')).json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  els.semana.value = dateToIsoWeekStr(new Date());

  const [{ data: facturas, error: e1 }, { data: items, error: e2 }, { data: descuentos, error: e3 }] = await Promise.all([
    fetchAll(() => client.from('facturas').select('id, fecha, importe_ars, cliente_id, empresa')),
    fetchAll(() => client.from('factura_items').select('factura_id, cantidad, precio_unitario, piezas(linea, tipo_pieza, variante, calidad)')),
    client.from('lista_precios_descuentos').select('monto_desde, monto_hasta, descuento, plazo_pago').order('monto_desde'),
  ]);
  if (e1 || e2 || e3) {
    els.kpiGrid.innerHTML = `<div class="empty-state">Error al cargar: ${(e1 || e2 || e3).message}</div>`;
    return;
  }
  state.facturas = facturas.filter((f) => f.fecha);
  state.factura_items = items;
  state.descuentos = descuentos || [];

  render();
}

function render() {
  const { desde, hasta, monday } = isoWeekToRange(els.semana.value);
  els.rango.textContent = `${fmtFechaCorta(desde)} al ${fmtFechaCorta(hasta)}`;

  const facturasSemana = state.facturas.filter((f) => f.fecha >= desde && f.fecha <= hasta);
  const facturaIdsSemana = new Set(facturasSemana.map((f) => f.id));
  const itemsSemana = state.factura_items.filter((it) => facturaIdsSemana.has(it.factura_id));

  renderKpis(facturasSemana, itemsSemana);
  renderDescuentos(facturasSemana);
  renderTendencia(monday);
  renderPiezas(itemsSemana);
}

function renderKpis(facturasSemana, itemsSemana) {
  const totalFacturado = facturasSemana.reduce((s, f) => s + Number(f.importe_ars || 0), 0);
  const piezasVendidas = itemsSemana.reduce((s, it) => s + Number(it.cantidad || 0), 0);
  const clientes = new Set(facturasSemana.filter((f) => f.cliente_id).map((f) => f.cliente_id));

  const kpis = [
    { label: 'Facturado', value: fmtPesos(totalFacturado) },
    { label: 'Piezas vendidas', value: fmt(piezasVendidas) },
    { label: 'Clientes que compraron', value: fmt(clientes.size) },
    { label: 'Facturas emitidas', value: fmt(facturasSemana.length) },
  ];
  els.kpiGrid.innerHTML = kpis.map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
    </div>
  `).join('');
}

// --- Escalas de descuento: cada escala de lista_precios_descuentos define un
// rango de $ de factura con un % de descuento y plazo de pago asociado (ver
// schema_listas_precios.sql). Se clasifica cada factura de la semana según
// su importe_ars real contra esas escalas — no hay forma de reconstruir el
// "% de descuento efectivamente aplicado" pieza por pieza porque la lista de
// precios solo tiene 9 de las ~35 piezas cargadas, así que se usa el monto
// de la factura tal cual, que es exactamente el criterio que define la
// escala ("descuento por escala de monto de la factura").
function escalaDe(importe, descuentos) {
  for (const d of descuentos) {
    const desde = Number(d.monto_desde);
    const hasta = d.monto_hasta == null ? Infinity : Number(d.monto_hasta);
    if (importe >= desde && importe < hasta) return d;
  }
  return null;
}

function renderDescuentos(facturasSemana) {
  if (state.descuentos.length === 0) {
    els.descuentoChart.innerHTML = '<p class="empty-state">No hay escalas de descuento cargadas (ver Lista de precios).</p>';
    els.descuentoHint.textContent = '';
    return;
  }
  const porEscala = state.descuentos.map((d) => ({ ...d, n: 0 }));
  let sinEscala = 0;
  for (const f of facturasSemana) {
    const importe = Number(f.importe_ars || 0);
    const match = escalaDe(importe, state.descuentos);
    if (!match) { sinEscala += 1; continue; }
    const row = porEscala.find((d) => d.monto_desde === match.monto_desde);
    if (row) row.n += 1;
  }
  const total = facturasSemana.length;
  els.descuentoHint.textContent = total > 0
    ? `Clasificadas según el monto real de cada factura contra las escalas de la lista de precios vigente (25%/29%/32%/34%). ${total} factura${total === 1 ? '' : 's'} en la semana${sinEscala ? `, ${sinEscala} fuera de escala` : ''}.`
    : 'No hay facturas en esta semana.';

  const W = 720, H = 220, ML = 46, MR = 16, MT = 20, MB = 44;
  const PW = W - ML - MR, PH = H - MT - MB;
  const maxN = Math.max(...porEscala.map((d) => d.n), 1);
  const barW = Math.min(70, (PW / porEscala.length) * 0.55);
  const step = PW / porEscala.length;

  const barsHtml = porEscala.map((d, i) => {
    const h = maxN > 0 ? (d.n / maxN) * PH : 0;
    const x = ML + step * i + (step - barW) / 2;
    const y = MT + PH - h;
    const pct = total > 0 ? d.n / total : 0;
    const label = `${(Number(d.descuento) * 100).toFixed(0)}%`;
    return `
      <g class="descuento-barra-grupo" data-idx="${i}">
        <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 1)}" rx="4" class="descuento-barra" />
        <rect x="${x}" y="${MT}" width="${barW}" height="${PH}" fill="transparent" class="descuento-hitarea" data-idx="${i}" />
        <text x="${x + barW / 2}" y="${y - 8}" class="descuento-valor" text-anchor="middle">${d.n}</text>
        <text x="${x + barW / 2}" y="${MT + PH + 20}" class="comparativo-axis-x" text-anchor="middle">${label}</text>
        <text x="${x + barW / 2}" y="${MT + PH + 36}" class="descuento-plazo" text-anchor="middle">${escapeHtml(d.plazo_pago || '')}</text>
      </g>`;
  }).join('');

  els.descuentoChart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="comparativo-svg descuento-svg" id="descuento-svg" preserveAspectRatio="xMinYMin meet">
      <line x1="${ML}" y1="${MT + PH}" x2="${W - MR}" y2="${MT + PH}" class="comparativo-grid" />
      ${barsHtml}
    </svg>
    <div class="comparativo-tooltip" id="descuento-tooltip" style="display:none"></div>
  `;

  const svg = document.getElementById('descuento-svg');
  const tooltip = document.getElementById('descuento-tooltip');
  svg.querySelectorAll('.descuento-hitarea').forEach((rect) => {
    rect.addEventListener('pointerenter', (e) => {
      const d = porEscala[Number(rect.dataset.idx)];
      const pct = total > 0 ? fmtPct(d.n / total) : '0%';
      tooltip.innerHTML = '';
      const titulo = document.createElement('div');
      titulo.className = 'comparativo-tooltip-titulo';
      titulo.textContent = `Escala ${(Number(d.descuento) * 100).toFixed(0)}%`;
      const row1 = document.createElement('div');
      row1.className = 'comparativo-tooltip-row';
      row1.innerHTML = `<strong>${d.n}</strong>`;
      row1.appendChild(document.createTextNode(' '));
      const lbl1 = document.createElement('span');
      lbl1.className = 'comparativo-tooltip-label';
      lbl1.textContent = `factura(s) · ${pct} de la semana`;
      row1.appendChild(lbl1);
      const row2 = document.createElement('div');
      row2.className = 'comparativo-tooltip-row';
      const lbl2 = document.createElement('span');
      lbl2.className = 'comparativo-tooltip-label';
      lbl2.textContent = `Desde ${fmtPesos(d.monto_desde)}${d.monto_hasta ? ` hasta ${fmtPesos(d.monto_hasta)}` : ' sin techo'} · plazo ${d.plazo_pago || '—'}`;
      row2.appendChild(lbl2);
      tooltip.appendChild(titulo);
      tooltip.appendChild(row1);
      tooltip.appendChild(row2);
      const rect2 = rect.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const pctLeft = ((rect2.left + rect2.width / 2 - svgRect.left) / svgRect.width) * 100;
      tooltip.style.display = '';
      tooltip.style.left = `${Math.min(Math.max(pctLeft, 12), 88)}%`;
      tooltip.style.top = '0px';
    });
    rect.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
  });
}

// --- Tendencia: últimas 8 semanas terminando en la semana elegida ---
function renderTendencia(monday) {
  const semanas = [];
  for (let i = 7; i >= 0; i--) {
    const m = new Date(monday);
    m.setUTCDate(monday.getUTCDate() - i * 7);
    const s = new Date(m);
    s.setUTCDate(m.getUTCDate() + 6);
    semanas.push({ desde: m.toISOString().slice(0, 10), hasta: s.toISOString().slice(0, 10), label: dateToIsoWeekStr(m) });
  }

  const totales = semanas.map((s) => state.facturas
    .filter((f) => f.fecha >= s.desde && f.fecha <= s.hasta)
    .reduce((acc, f) => acc + Number(f.importe_ars || 0), 0));

  els.tendenciaLegend.innerHTML = `<span class="legend-item"><span class="legend-swatch" style="background:#2e6ea0"></span>Facturado por semana</span>`;

  const W = 880, H = 240, ML = 60, MR = 16, MT = 12, MB = 28;
  const PW = W - ML - MR, PH = H - MT - MB;
  const maxVal = niceMax(Math.max(...totales, 1));
  const xAt = (i) => semanas.length === 1 ? ML + PW / 2 : ML + (PW * i) / (semanas.length - 1);
  const yAt = (v) => MT + PH - (v / maxVal) * PH;

  const yTicks = 4;
  const gridHtml = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (maxVal / yTicks) * i;
    const y = yAt(v);
    return `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" class="comparativo-grid" />
      <text x="${ML - 8}" y="${y}" class="comparativo-axis-y" text-anchor="end" dominant-baseline="middle">${fmtPesosCorto(v)}</text>`;
  }).join('');

  const xLabelsHtml = semanas.map((s, i) => `
    <text x="${xAt(i)}" y="${H - 6}" class="comparativo-axis-x" text-anchor="middle">${fmtFechaCorta(s.desde)}</text>`).join('');

  const d = totales.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(v)}`).join(' ');
  const dots = totales.map((v, i) => `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="4" fill="#2e6ea0" stroke="var(--surface)" stroke-width="2" />`).join('');
  const lineHtml = `<path d="${d}" fill="none" stroke="#2e6ea0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />${dots}`;

  els.tendenciaChart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="comparativo-svg" id="tendencia-svg" preserveAspectRatio="xMinYMin meet">
      ${gridHtml}
      ${lineHtml}
      ${xLabelsHtml}
      <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="transparent" id="tendencia-hitarea" />
      <line x1="0" y1="${MT}" x2="0" y2="${MT + PH}" class="comparativo-crosshair" id="tendencia-crosshair" style="display:none" />
    </svg>
    <div class="comparativo-tooltip" id="tendencia-tooltip" style="display:none"></div>
  `;

  wireTendenciaHover({ semanas, totales, xAt, ML, MR, W });
}

function wireTendenciaHover({ semanas, totales, xAt, ML, MR, W }) {
  const svg = document.getElementById('tendencia-svg');
  const hitArea = document.getElementById('tendencia-hitarea');
  const crosshair = document.getElementById('tendencia-crosshair');
  const tooltip = document.getElementById('tendencia-tooltip');
  if (!svg || !hitArea) return;

  function nearestIndex(svgX) {
    let best = 0, bestDist = Infinity;
    semanas.forEach((_, i) => {
      const dist = Math.abs(xAt(i) - svgX);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  hitArea.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    const i = nearestIndex(svgX);
    const x = xAt(i);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.style.display = '';

    tooltip.innerHTML = '';
    const titulo = document.createElement('div');
    titulo.className = 'comparativo-tooltip-titulo';
    titulo.textContent = `Semana del ${fmtFechaCorta(semanas[i].desde)}`;
    tooltip.appendChild(titulo);
    const row = document.createElement('div');
    row.className = 'comparativo-tooltip-row';
    const key = document.createElement('span');
    key.className = 'comparativo-tooltip-key';
    key.style.background = '#2e6ea0';
    const val = document.createElement('strong');
    val.textContent = fmtPesos(totales[i]);
    row.appendChild(key);
    row.appendChild(val);
    tooltip.appendChild(row);

    const pctLeft = ((x - ML) / (W - ML - MR)) * 100;
    tooltip.style.display = '';
    tooltip.style.left = `${Math.min(Math.max(pctLeft, 8), 92)}%`;
    tooltip.style.top = '4px';
  });
  hitArea.addEventListener('pointerleave', () => {
    crosshair.style.display = 'none';
    tooltip.style.display = 'none';
  });
}

function niceMax(v) {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function fmtPesosCorto(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

// --- Piezas más vendidas de la semana ---
function piezaLabelDe(p) {
  const variante = p.variante ? ` (${p.variante})` : '';
  const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };
  return `${p.linea} · ${p.tipo_pieza}${variante} — ${CALIDAD_LABEL[p.calidad] || p.calidad}`;
}

function renderPiezas(itemsSemana) {
  const porPieza = new Map();
  for (const it of itemsSemana) {
    if (!it.piezas) continue;
    const key = piezaLabelDe(it.piezas);
    if (!porPieza.has(key)) porPieza.set(key, { label: key, cantidad: 0, facturado: 0 });
    const g = porPieza.get(key);
    g.cantidad += Number(it.cantidad || 0);
    g.facturado += Number(it.cantidad || 0) * Number(it.precio_unitario || 0);
  }
  const filas = [...porPieza.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 12);

  if (filas.length === 0) {
    document.getElementById('piezas-tbody').innerHTML = '<tr><td class="empty-state" colspan="3">No hay piezas vendidas en esta semana.</td></tr>';
    return;
  }

  const maxCantidad = Math.max(...filas.map((f) => f.cantidad), 1);
  document.getElementById('piezas-tbody').innerHTML = filas.map((f) => `
    <tr>
      <td class="col-grupo">${escapeHtml(f.label)}</td>
      <td class="bar-cell" style="--bar-pct:${Math.round((f.cantidad / maxCantidad) * 100)}%"><strong>${fmt(f.cantidad)}</strong></td>
      <td>${fmtPesos(f.facturado)}</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Eventos ---
els.semana.addEventListener('change', render);
els.btnAnterior.addEventListener('click', () => {
  const { monday } = isoWeekToRange(els.semana.value);
  monday.setUTCDate(monday.getUTCDate() - 7);
  els.semana.value = dateToIsoWeekStr(monday);
  render();
});
els.btnSiguiente.addEventListener('click', () => {
  const { monday } = isoWeekToRange(els.semana.value);
  monday.setUTCDate(monday.getUTCDate() + 7);
  els.semana.value = dateToIsoWeekStr(monday);
  render();
});
els.btnActual.addEventListener('click', () => {
  els.semana.value = dateToIsoWeekStr(new Date());
  render();
});

init();
