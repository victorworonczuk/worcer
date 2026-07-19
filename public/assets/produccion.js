const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TIPO_LABEL = { produccion: 'Producción', venta: 'Venta', rotura: 'Rotura' };

const state = {
  rows: [],            // {fecha, tipo, cantidad, linea, tipo_pieza, variante, calidad}
  lineas: [],
  tipo: 'produccion',  // métrica activa de la tabla
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  linea: document.getElementById('f-linea'),
  agrupar: document.getElementById('f-agrupar'),
  calidad: document.getElementById('f-calidad'),
  desde: document.getElementById('f-desde'),
  hasta: document.getElementById('f-hasta'),
  limpiarBtn: document.getElementById('limpiar-btn'),
  resumen: document.getElementById('resumen'),
  metricTabs: document.getElementById('metric-tabs'),
  thead: document.getElementById('thead'),
  tbody: document.getElementById('tbody'),
  notaPie: document.getElementById('nota-pie'),
};

function fmt(n) { return Math.round(n).toLocaleString('es-AR'); }
function mesDe(fecha) { return Number(fecha.slice(5, 7)) - 1; } // 0-11
function anioDe(fecha) { return fecha.slice(0, 4); }

async function init() {
  const me = await (await fetch('/api/me')).json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  // Traer producción unida al catálogo de piezas. Supabase limita las respuestas
  // REST a 1000 filas, así que se pagina con .range() hasta traer todo.
  const PAGE = 1000;
  let data = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await client
      .from('produccion')
      .select('fecha, tipo, cantidad, piezas(linea, tipo_pieza, variante, calidad, precio_ars)')
      .order('fecha', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      els.tbody.innerHTML = `<tr><td class="empty-state">Error al cargar: ${error.message}</td></tr>`;
      return;
    }
    data = data.concat(page || []);
    if (!page || page.length < PAGE) break;
  }

  state.rows = data
    .filter((r) => r.piezas)
    .map((r) => ({
      fecha: r.fecha, tipo: r.tipo, cantidad: r.cantidad,
      linea: r.piezas.linea, tipo_pieza: r.piezas.tipo_pieza,
      variante: r.piezas.variante, calidad: r.piezas.calidad,
      precio: r.piezas.precio_ars != null ? Number(r.piezas.precio_ars) : null,
    }));

  state.lineas = [...new Set(state.rows.map((r) => r.linea))].sort();
  els.linea.innerHTML = '<option value="">Todas</option>' +
    state.lineas.map((l) => `<option value="${l}">${l}</option>`).join('');

  render();
}

function filtrar() {
  const linea = els.linea.value || null;
  const calidad = els.calidad.value || null;
  const desde = els.desde.value || null;
  const hasta = els.hasta.value || null;
  return state.rows.filter((r) => {
    if (linea && r.linea !== linea) return false;
    if (calidad && r.calidad !== calidad) return false;
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    return true;
  });
}

function grupoDe(r) {
  const modo = els.agrupar.value;
  if (modo === 'linea') return { key: r.linea, label: r.linea };
  const variante = r.variante ? ` (${r.variante})` : '';
  if (modo === 'pieza_calidad') {
    return {
      key: `${r.linea}|${r.tipo_pieza}|${r.variante || ''}|${r.calidad}`,
      label: `${r.linea} · ${r.tipo_pieza}${variante} — ${CALIDAD_LABEL[r.calidad] || r.calidad}`,
    };
  }
  return { key: `${r.linea}|${r.tipo_pieza}|${r.variante || ''}`, label: `${r.linea} · ${r.tipo_pieza}${variante}` };
}

function render() {
  const items = filtrar();
  renderResumen(items);
  if (state.tipo === 'stock') renderStock();
  else renderPivot(items);
}

function renderResumen(items) {
  const tot = { produccion: 0, venta: 0, rotura: 0 };
  for (const r of items) {
    if (r.tipo === 'produccion') tot.produccion += r.cantidad;
    else if (r.tipo === 'venta') tot.venta += r.cantidad;
    else if (r.tipo === 'rotura' || r.tipo === 'rotura_deposito') tot.rotura += r.cantidad;
  }
  const ratio = tot.produccion > 0 ? (tot.venta / tot.produccion) * 100 : 0;
  els.resumen.innerHTML = `
    <div><strong>${fmt(tot.produccion)}</strong><span class="label">producción</span></div>
    <div><strong>${fmt(tot.venta)}</strong><span class="label">venta</span></div>
    <div><strong>${fmt(tot.rotura)}</strong><span class="label">rotura</span></div>
    <div><strong>${fmt(ratio)}%</strong><span class="label">venta / producción</span></div>
  `;
}

function renderPivot(items) {
  const deTipo = items.filter((r) => r.tipo === state.tipo || (state.tipo === 'rotura' && r.tipo === 'rotura_deposito'));

  // Meses presentes (col) a partir de los datos filtrados de esta métrica.
  const mesesSet = new Set(deTipo.map((r) => `${anioDe(r.fecha)}-${String(mesDe(r.fecha)).padStart(2, '0')}`));
  const meses = [...mesesSet].sort(); // 'YYYY-MM' index de mes 0-based
  const colLabel = (ym) => `${MESES[Number(ym.slice(5, 7))]} ${ym.slice(2, 4)}`;

  els.thead.innerHTML = `<tr>
    <th class="col-grupo">${els.agrupar.value === 'linea' ? 'Línea' : 'Pieza'}</th>
    ${meses.map((m) => `<th>${colLabel(m)}</th>`).join('')}
    <th class="col-total">Total</th>
  </tr>`;

  if (deTipo.length === 0) {
    els.tbody.innerHTML = `<tr><td class="empty-state" colspan="${meses.length + 2}">No hay ${TIPO_LABEL[state.tipo].toLowerCase()} con estos filtros.</td></tr>`;
    els.notaPie.textContent = '';
    return;
  }

  // grupo -> { label, porMes: Map(ym->cant), total }
  const grupos = new Map();
  for (const r of deTipo) {
    const g = grupoDe(r);
    const ym = `${anioDe(r.fecha)}-${String(mesDe(r.fecha)).padStart(2, '0')}`;
    if (!grupos.has(g.key)) grupos.set(g.key, { label: g.label, porMes: new Map(), total: 0 });
    const item = grupos.get(g.key);
    item.porMes.set(ym, (item.porMes.get(ym) || 0) + r.cantidad);
    item.total += r.cantidad;
  }

  const filas = [...grupos.values()].sort((a, b) => b.total - a.total);

  const totalPorMes = meses.map((m) => filas.reduce((s, f) => s + (f.porMes.get(m) || 0), 0));
  const granTotal = totalPorMes.reduce((s, v) => s + v, 0);

  const filasHtml = filas.map((f) => `<tr>
    <td class="col-grupo">${escapeHtml(f.label)}</td>
    ${meses.map((m) => {
      const v = f.porMes.get(m) || 0;
      return `<td class="${v ? '' : 'zero'}">${v ? fmt(v) : '·'}</td>`;
    }).join('')}
    <td class="col-total"><strong>${fmt(f.total)}</strong></td>
  </tr>`).join('');

  const filaTotal = `<tr class="fila-total">
    <td class="col-grupo">TOTAL</td>
    ${totalPorMes.map((v) => `<td>${fmt(v)}</td>`).join('')}
    <td class="col-total">${fmt(granTotal)}</td>
  </tr>`;

  els.tbody.innerHTML = filasHtml + filaTotal;

  if (state.tipo === 'rotura') {
    els.notaPie.textContent = 'La rotura del histórico 2026 se cargó como total mensual (el Excel no la registraba por día ni por calidad).';
  } else {
    els.notaPie.textContent = '';
  }
}

function fmtPesos(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }

function piezaKeyDe(r) { return `${r.linea}|${r.tipo_pieza}|${r.variante || ''}|${r.calidad}`; }

// El stock es "actual": para cada pieza toma el último recuento como base y suma
// los movimientos posteriores. No depende del rango de fechas del filtro.
function renderStock() {
  const lineaFiltro = els.linea.value || null;
  const calidadFiltro = els.calidad.value || null;
  const base = state.rows.filter((r) =>
    (!lineaFiltro || r.linea === lineaFiltro) && (!calidadFiltro || r.calidad === calidadFiltro));

  // 1) Calcular por pieza individual (con calidad = pieza_id), usando el ancla del recuento.
  const porPieza = new Map();
  for (const r of base) {
    const k = piezaKeyDe(r);
    if (!porPieza.has(k)) porPieza.set(k, { rows: [], grupo: grupoDe(r), precio: r.precio });
    porPieza.get(k).rows.push(r);
  }
  let faltaPrecio = false;
  let hayRecuento = false;
  const piezasCalc = [];
  for (const { rows, grupo, precio } of porPieza.values()) {
    const recuentos = rows.filter((r) => r.tipo === 'recuento');
    let baseFecha = null, baseQty = 0;
    if (recuentos.length) {
      hayRecuento = true;
      const ult = recuentos.reduce((a, b) => (b.fecha > a.fecha ? b : a));
      baseFecha = ult.fecha; baseQty = ult.cantidad;
    }
    let prod = 0, venta = 0, rotura = 0;
    for (const r of rows) {
      if (r.tipo === 'recuento') continue;
      if (baseFecha && r.fecha <= baseFecha) continue; // solo movimientos posteriores al recuento
      if (r.tipo === 'produccion') prod += r.cantidad;
      else if (r.tipo === 'venta') venta += r.cantidad;
      else if (r.tipo === 'rotura' || r.tipo === 'rotura_deposito') rotura += r.cantidad;
    }
    const stock = baseQty + prod - venta - rotura;
    const valorProd = precio != null ? precio * prod : 0;
    const valorRoto = precio != null ? precio * rotura : 0;
    if (precio == null && (prod || rotura)) faltaPrecio = true;
    piezasCalc.push({ grupo, baseQty, prod, venta, rotura, stock, valorProd, valorRoto });
  }

  // 2) Agrupar según "Agrupar por".
  const grupos = new Map();
  for (const p of piezasCalc) {
    if (!grupos.has(p.grupo.key)) grupos.set(p.grupo.key, { label: p.grupo.label, base: 0, prod: 0, venta: 0, rotura: 0, stock: 0, valorProd: 0, valorRoto: 0 });
    const g = grupos.get(p.grupo.key);
    g.base += p.baseQty; g.prod += p.prod; g.venta += p.venta; g.rotura += p.rotura;
    g.stock += p.stock; g.valorProd += p.valorProd; g.valorRoto += p.valorRoto;
  }
  const filas = [...grupos.values()]
    .map((g) => ({ ...g, pctRotura: g.prod > 0 ? (g.rotura / g.prod) * 100 : 0 }))
    .sort((a, b) => b.prod - a.prod);

  els.thead.innerHTML = `<tr>
    <th class="col-grupo">${els.agrupar.value === 'linea' ? 'Línea' : 'Pieza'}</th>
    <th>Base recuento</th><th>Producción</th><th>Venta</th><th>Rotura</th>
    <th>Stock actual</th><th>% Rotura</th>
    <th>Valor producido</th><th>Pérdida rotura</th>
  </tr>`;

  if (filas.length === 0) {
    els.tbody.innerHTML = '<tr><td class="empty-state" colspan="9">No hay datos con estos filtros.</td></tr>';
    els.notaPie.textContent = '';
    return;
  }

  const t = filas.reduce((a, f) => ({
    base: a.base + f.base, prod: a.prod + f.prod, venta: a.venta + f.venta, rotura: a.rotura + f.rotura,
    stock: a.stock + f.stock, valorProd: a.valorProd + f.valorProd, valorRoto: a.valorRoto + f.valorRoto,
  }), { base: 0, prod: 0, venta: 0, rotura: 0, stock: 0, valorProd: 0, valorRoto: 0 });
  const pctRoturaTotal = t.prod > 0 ? (t.rotura / t.prod) * 100 : 0;

  els.tbody.innerHTML = filas.map((f) => `<tr>
    <td class="col-grupo">${escapeHtml(f.label)}</td>
    <td>${f.base ? fmt(f.base) : '·'}</td>
    <td>${fmt(f.prod)}</td>
    <td>${fmt(f.venta)}</td>
    <td>${fmt(f.rotura)}</td>
    <td class="${f.stock < 0 ? 'stock-neg' : ''}"><strong>${fmt(f.stock)}</strong></td>
    <td>${f.pctRotura.toFixed(1)}%</td>
    <td>${f.valorProd ? fmtPesos(f.valorProd) : '·'}</td>
    <td class="${f.valorRoto ? 'stock-neg' : ''}">${f.valorRoto ? fmtPesos(f.valorRoto) : '·'}</td>
  </tr>`).join('') + `<tr class="fila-total">
    <td class="col-grupo">TOTAL</td>
    <td>${t.base ? fmt(t.base) : '·'}</td>
    <td>${fmt(t.prod)}</td><td>${fmt(t.venta)}</td><td>${fmt(t.rotura)}</td>
    <td>${fmt(t.stock)}</td><td>${pctRoturaTotal.toFixed(1)}%</td>
    <td>${fmtPesos(t.valorProd)}</td><td>${fmtPesos(t.valorRoto)}</td>
  </tr>`;

  const notas = [];
  if (hayRecuento) notas.push('Stock actual = último recuento + producción − venta − roturas posteriores. Producción/Venta/Rotura son desde el último recuento.');
  else notas.push('Stock = Producción − Venta − Rotura desde enero (sin recuento todavía: cargá el stock inicial en "Recuento" para corregir los negativos). Rotura incluye fábrica + depósito.');
  notas.push('No depende del rango de fechas.');
  if (faltaPrecio) notas.push('Algunas piezas de 3ª calidad no tienen precio — su valorización no se cuenta.');
  els.notaPie.textContent = notas.join(' ');
}

// --- Eventos ---
els.metricTabs.querySelectorAll('.metric-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    els.metricTabs.querySelectorAll('.metric-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.tipo = tab.dataset.tipo;
    render();
  });
});
[els.linea, els.agrupar, els.calidad, els.desde, els.hasta].forEach((el) => el.addEventListener('change', render));
els.limpiarBtn.addEventListener('click', () => {
  els.linea.value = ''; els.agrupar.value = 'pieza'; els.calidad.value = '';
  els.desde.value = ''; els.hasta.value = '';
  render();
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
