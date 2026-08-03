const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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

const MESES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const COLORES_CANAL = ['#2E6EA0', '#1a9d5c', '#e07c1a', '#6b7280', '#8b5cf6'];

const state = {
  facturas: [],
  items: [],
  clientesPorId: new Map(),
  costosPorPiezaId: new Map(),
  gastosGenerales: [],
  obligaciones: [],
  descuentos: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  titular: document.getElementById('titular'),
  bajada: document.getElementById('bajada'),
  cobertura: document.getElementById('cobertura-nota'),
  kpiGrid: document.getElementById('kpi-grid'),
  s1Texto: document.getElementById('s1-texto'),
  barrasEquilibrio: document.getElementById('barras-equilibrio'),
  cascada: document.getElementById('cascada-resultado'),
  s2Texto: document.getElementById('s2-texto'),
  tbodyDescuentos: document.getElementById('tbody-descuentos'),
  s3Texto: document.getElementById('s3-texto'),
  barrasPiezas: document.getElementById('barras-piezas'),
  s4Texto: document.getElementById('s4-texto'),
  stackCanal: document.getElementById('stack-canal'),
  stackCanalLeyenda: document.getElementById('stack-canal-leyenda'),
  oportunidades: document.getElementById('oportunidades'),
  metaCallout: document.getElementById('meta-callout'),
  fuente: document.getElementById('fuente'),
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtPesos(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtM(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return '$' + (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M';
}
function fmtPct(n, decimales = 1) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return (n * 100).toLocaleString('es-AR', { maximumFractionDigits: decimales }) + '%';
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarDatos() {
  const [{ data: facturas }, { data: items }, { data: clientes }, { data: costos }, { data: gastos }, { data: obligaciones }, { data: descuentos }] = await Promise.all([
    fetchAll(() => client.from('facturas').select('id, fecha, importe_ars, tipo_comprobante, cliente_id, vendedor, empresa').like('tipo_comprobante', 'F %')),
    fetchAll(() => client.from('factura_items').select('factura_id, cantidad, precio_unitario, pieza_id, piezas(linea, tipo_pieza, variante, calidad)')),
    fetchAll(() => client.from('clientes').select('id, segmento')),
    fetchAll(() => client.from('costos_piezas').select('pieza_id, ctu_ars')),
    fetchAll(() => client.from('gastos_generales_mensuales').select('anio, mes, empresa, monto')),
    fetchAll(() => client.from('obligaciones_financieras').select('anio, mes, prestamos, arca')),
    fetchAll(() => client.from('lista_precios_descuentos').select('lista_id, monto_desde, monto_hasta, descuento, plazo_pago').order('monto_desde')),
  ]);

  state.facturas = facturas || [];
  state.items = items || [];
  state.clientesPorId = new Map((clientes || []).map((c) => [c.id, c]));
  state.costosPorPiezaId = new Map((costos || []).map((c) => [c.pieza_id, Number(c.ctu_ars)]));
  state.gastosGenerales = gastos || [];
  state.obligaciones = obligaciones || [];
  // Solo la lista de precios más reciente (la de items no importa acá, solo descuentos).
  if (descuentos && descuentos.length) {
    const ultimaListaId = descuentos.reduce((max, d) => Math.max(max, d.lista_id), 0);
    state.descuentos = descuentos.filter((d) => d.lista_id === ultimaListaId).sort((a, b) => a.monto_desde - b.monto_desde);
  }
}

function poblarSelectorMeses() {
  const claves = new Set(state.facturas.map((f) => f.fecha.slice(0, 7)));
  const ordenadas = [...claves].sort().reverse();
  els.mes.innerHTML = ordenadas.map((c) => {
    const [anio, mes] = c.split('-').map(Number);
    return `<option value="${c}">${MESES_LABEL[mes]} ${anio}</option>`;
  }).join('');
  if (ordenadas.length) els.mes.value = ordenadas[0];
}

// --- Cálculo central ---
function calcular(clave) {
  const [anio, mes] = clave.split('-').map(Number);

  const facturasDelMes = state.facturas.filter((f) => f.fecha.slice(0, 7) === clave);
  const idsFacturas = new Set(facturasDelMes.map((f) => f.id));
  const itemsDelMes = state.items.filter((it) => idsFacturas.has(it.factura_id));

  const ventasTotales = facturasDelMes.reduce((a, f) => a + Number(f.importe_ars || 0), 0);
  const cantidadFacturas = facturasDelMes.length;
  const ticketPromedio = cantidadFacturas > 0 ? ventasTotales / cantidadFacturas : null;

  const facturasConItem = new Set(itemsDelMes.map((it) => it.factura_id));
  const ventasCubiertas = facturasDelMes.filter((f) => facturasConItem.has(f.id)).reduce((a, f) => a + Number(f.importe_ars || 0), 0);
  const cobertura = ventasTotales > 0 ? ventasCubiertas / ventasTotales : null;

  let facturadoConCosto = 0;
  let costoVariable = 0;
  const porPieza = new Map();
  for (const it of itemsDelMes) {
    const cantidad = Number(it.cantidad || 0);
    const precio = Number(it.precio_unitario || 0);
    const facturadoItem = cantidad * precio;
    const ctu = state.costosPorPiezaId.has(it.pieza_id) ? state.costosPorPiezaId.get(it.pieza_id) : null;
    const p = it.piezas || {};
    const claveP = `${p.linea}|${p.tipo_pieza}|${p.variante}`;
    const label = `${p.linea || '?'} · ${p.tipo_pieza || '?'}${p.variante ? ` (${p.variante})` : ''}`;
    if (!porPieza.has(claveP)) porPieza.set(claveP, { label, linea: p.linea || '?', unidades: 0, facturado: 0, costo: 0, tieneCosto: true });
    const acc = porPieza.get(claveP);
    acc.unidades += cantidad;
    acc.facturado += facturadoItem;
    if (ctu != null) {
      acc.costo += cantidad * ctu;
      facturadoConCosto += facturadoItem;
      costoVariable += cantidad * ctu;
    } else {
      acc.tieneCosto = false;
    }
  }

  const margenPct = facturadoConCosto > 0 ? (facturadoConCosto - costoVariable) / facturadoConCosto : null;
  const contribucionMarginal = margenPct != null ? ventasTotales * margenPct : null;

  const gastosDelMes = state.gastosGenerales.filter((g) => g.anio === anio && g.mes === mes);
  const gastosGeneralesTotal = gastosDelMes.length ? gastosDelMes.reduce((a, g) => a + Number(g.monto), 0) : null;
  const obligacionDelMes = state.obligaciones.find((o) => o.anio === anio && o.mes === mes);
  const obligacionesTotal = obligacionDelMes ? Number(obligacionDelMes.prestamos) + Number(obligacionDelMes.arca) : null;
  const costosFijos = (gastosGeneralesTotal != null || obligacionesTotal != null) ? (gastosGeneralesTotal || 0) + (obligacionesTotal || 0) : null;

  const resultado = (contribucionMarginal != null && costosFijos != null) ? contribucionMarginal - costosFijos : null;
  const puntoEquilibrio = (costosFijos != null && margenPct) ? costosFijos / margenPct : null;
  const brecha = (puntoEquilibrio != null) ? puntoEquilibrio - ventasTotales : null;

  // Resultado acumulado del año hasta el mes elegido.
  let resultadoAcumulado = 0;
  let resultadoAcumuladoCompleto = true;
  for (let m = 1; m <= mes; m++) {
    if (m === mes) { resultadoAcumulado += (resultado ?? 0); if (resultado == null) resultadoAcumuladoCompleto = false; continue; }
    const claveM = `${anio}-${String(m).padStart(2, '0')}`;
    if (!state.facturas.some((f) => f.fecha.slice(0, 7) === claveM)) continue; // mes sin facturas, no existía todavía
    const r = calcularResultadoSimple(anio, m);
    if (r == null) { resultadoAcumuladoCompleto = false; continue; }
    resultadoAcumulado += r;
  }

  // Piezas ordenadas por facturado.
  const piezasOrdenadas = [...porPieza.values()].sort((a, b) => b.facturado - a.facturado);

  // Concentración.
  const facturadoTotalConCosto = piezasOrdenadas.reduce((a, p) => a + p.facturado, 0);
  const porLinea = new Map();
  for (const p of piezasOrdenadas) porLinea.set(p.linea, (porLinea.get(p.linea) || 0) + p.facturado);
  const lineaTop = [...porLinea.entries()].sort((a, b) => b[1] - a[1])[0];
  const skuTop = piezasOrdenadas[0];
  const concentracionLinea = lineaTop && facturadoTotalConCosto > 0 ? { nombre: lineaTop[0], pct: lineaTop[1] / facturadoTotalConCosto } : null;
  const concentracionSku = skuTop && facturadoTotalConCosto > 0 ? { nombre: skuTop.label, pct: skuTop.facturado / facturadoTotalConCosto } : null;

  // Por canal (empresa).
  const porCanal = new Map();
  for (const f of facturasDelMes) {
    const emp = f.empresa || 'Sin dato';
    porCanal.set(emp, (porCanal.get(emp) || 0) + Number(f.importe_ars || 0));
  }
  const canalesOrdenados = [...porCanal.entries()].sort((a, b) => b[1] - a[1]);

  // Productos en caída vs. promedio de los 3 meses previos.
  const mesesPrevios = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(anio, mes - 1 - i, 1);
    mesesPrevios.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const unidadesPorPiezaPrevias = new Map();
  for (const claveMes of mesesPrevios) {
    const facturasPrev = state.facturas.filter((f) => f.fecha.slice(0, 7) === claveMes);
    const idsPrev = new Set(facturasPrev.map((f) => f.id));
    for (const it of state.items) {
      if (!idsPrev.has(it.factura_id)) continue;
      const p = it.piezas || {};
      const claveP = `${p.linea}|${p.tipo_pieza}|${p.variante}`;
      unidadesPorPiezaPrevias.set(claveP, (unidadesPorPiezaPrevias.get(claveP) || 0) + Number(it.cantidad || 0));
    }
  }
  const caidas = [];
  for (const [claveP, prevTotal] of unidadesPorPiezaPrevias) {
    const promedioPrevio = prevTotal / 3;
    if (promedioPrevio < 3) continue; // ignorar piezas de bajo volumen, no es representativo
    const actual = porPieza.get(claveP)?.unidades || 0;
    const caidaPct = (promedioPrevio - actual) / promedioPrevio;
    if (caidaPct >= 0.6) {
      caidas.push({ label: porPieza.get(claveP)?.label || claveP, promedioPrevio, actual, caidaPct });
    }
  }
  caidas.sort((a, b) => b.caidaPct - a.caidaPct);

  return {
    anio, mes, ventasTotales, cantidadFacturas, ticketPromedio, cobertura,
    costoVariable, margenPct, contribucionMarginal, gastosGeneralesTotal, obligacionesTotal, costosFijos,
    resultado, puntoEquilibrio, brecha, resultadoAcumulado, resultadoAcumuladoCompleto,
    piezasOrdenadas, concentracionLinea, concentracionSku, canalesOrdenados, caidas,
  };
}

// Versión liviana para el acumulado (evita recalcular todo lo demás).
function calcularResultadoSimple(anio, mes) {
  const clave = `${anio}-${String(mes).padStart(2, '0')}`;
  const facturasDelMes = state.facturas.filter((f) => f.fecha.slice(0, 7) === clave);
  if (facturasDelMes.length === 0) return null;
  const idsFacturas = new Set(facturasDelMes.map((f) => f.id));
  const itemsDelMes = state.items.filter((it) => idsFacturas.has(it.factura_id));
  const ventasTotales = facturasDelMes.reduce((a, f) => a + Number(f.importe_ars || 0), 0);
  let facturadoConCosto = 0;
  let costoVariable = 0;
  for (const it of itemsDelMes) {
    const cantidad = Number(it.cantidad || 0);
    const precio = Number(it.precio_unitario || 0);
    const ctu = state.costosPorPiezaId.get(it.pieza_id);
    if (ctu == null) continue;
    facturadoConCosto += cantidad * precio;
    costoVariable += cantidad * ctu;
  }
  if (facturadoConCosto === 0) return null;
  const margenPct = (facturadoConCosto - costoVariable) / facturadoConCosto;
  const contribucionMarginal = ventasTotales * margenPct;
  const gastosDelMes = state.gastosGenerales.filter((g) => g.anio === anio && g.mes === mes);
  const obligacionDelMes = state.obligaciones.find((o) => o.anio === anio && o.mes === mes);
  if (!gastosDelMes.length && !obligacionDelMes) return null;
  const costosFijos = (gastosDelMes.length ? gastosDelMes.reduce((a, g) => a + Number(g.monto), 0) : 0) + (obligacionDelMes ? Number(obligacionDelMes.prestamos) + Number(obligacionDelMes.arca) : 0);
  return contribucionMarginal - costosFijos;
}

// --- Render ---
function render(d) {
  // Titular + bajada.
  let titular, bajada;
  if (d.resultado == null) {
    titular = 'Diagnóstico incompleto para este mes';
    bajada = 'Falta algún dato (costos, gastos generales o préstamos/ARCA) para calcular el resultado de este mes.';
  } else if (d.resultado < 0) {
    titular = 'Del rojo al equilibrio: es volumen, no margen';
    bajada = `Tu margen (${fmtPct(d.margenPct)}) es sano. Lo que falta para no perder plata es facturar más, no vender más barato.`;
  } else {
    titular = 'Mes en verde: así se sostiene';
    bajada = `Facturaste por encima del punto de equilibrio. Cada peso extra por encima del equilibrio deja ~${fmtPct(d.margenPct)} de ganancia.`;
  }
  els.titular.textContent = titular;
  els.bajada.textContent = `${bajada} Diagnóstico de ${MESES_LABEL[d.mes]} ${d.anio}, sobre tus costos y lista de precios reales.`;

  // KPIs.
  const kpis = [
    { label: 'Venta del mes (facturado)', value: fmtPesos(d.ventasTotales), tag: `${d.cantidadFacturas} facturas` },
    { label: 'Punto de equilibrio', value: fmtPesos(d.puntoEquilibrio), tag: 'meta mínima del mes' },
    { label: d.brecha != null && d.brecha > 0 ? 'Brecha a cubrir' : 'Por encima del equilibrio', value: fmtPesos(d.brecha != null ? Math.abs(d.brecha) : null), tag: d.ventasTotales ? `${fmtPct(Math.abs(d.brecha || 0) / d.ventasTotales)} de ventas` : '', clase: d.brecha > 0 ? 'kpi-rojo' : 'kpi-verde' },
    { label: 'Contribución marginal', value: fmtPct(d.margenPct), tag: d.margenPct != null ? (d.margenPct > 0.5 ? 'margen alto y sano' : 'margen ajustado') : '' },
  ];
  els.kpiGrid.innerHTML = kpis.map((k) => `
    <div class="kpi-card ${k.clase || ''}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      ${k.tag ? `<div class="kpi-tag">${escapeHtml(k.tag)}</div>` : ''}
    </div>
  `).join('');

  // Cobertura / avisos.
  const notas = [];
  if (d.cobertura != null) notas.push(`cobertura de detalle de piezas: ${fmtPct(d.cobertura)} de la facturación del mes`);
  if (d.gastosGeneralesTotal == null) notas.push('sin gastos generales cargados para este mes');
  if (d.obligacionesTotal == null) notas.push('sin dato de préstamos/ARCA para este mes');
  els.cobertura.textContent = notas.length ? `Nota: ${notas.join('; ')}.` : '';

  // --- Sección 01 ---
  els.s1Texto.textContent = d.margenPct != null
    ? `Fijos + margen ${d.margenPct > 0.5 ? 'alto' : 'moderado'} = ${d.margenPct > 0.5 ? 'alto apalancamiento operativo' : 'hay que cuidar el volumen'}. Cada peso por encima del equilibrio deja ~${fmtPct(d.margenPct, 0)} de ganancia.`
    : 'No hay piezas con costo cargado este mes — no se puede calcular el apalancamiento.';

  const escalaMax = Math.max(d.ventasTotales || 0, d.puntoEquilibrio || 0) * 1.05;
  const barras = [
    { label: 'Venta del mes', valor: d.ventasTotales, color: d.brecha > 0 ? '#e07c1a' : '#1a9d5c' },
    { label: 'Punto de equilibrio', valor: d.puntoEquilibrio, color: '#6b7280', esLinea: true },
  ];
  els.barrasEquilibrio.innerHTML = barras.map((b) => {
    const pct = escalaMax ? Math.min(100, (b.valor || 0) / escalaMax * 100) : 0;
    return `
      <div class="barra-row">
        <div class="barra-label">${b.label}</div>
        <div class="barra-track">
          <div class="barra-fill" style="width:${pct}%; background:${b.color}"></div>
          ${d.puntoEquilibrio && escalaMax ? `<div class="barra-linea" style="left:${Math.min(100, d.puntoEquilibrio / escalaMax * 100)}%"></div>` : ''}
        </div>
        <div class="barra-valor">${fmtM(b.valor)}</div>
      </div>
    `;
  }).join('') + `<div class="barra-escala">Escala 0 – ${fmtM(escalaMax)}</div>`;

  const filasCascada = [
    { label: 'Ventas reales (facturado)', valor: d.ventasTotales, tipo: 'base' },
    { label: `− Costo variable (${d.margenPct != null ? fmtPct(1 - d.margenPct) : '—'})`, valor: -(d.costoVariable ? (d.ventasTotales * (1 - (d.margenPct || 0))) : null), tipo: 'resta' },
    { label: `= Contribución marginal (${fmtPct(d.margenPct)})`, valor: d.contribucionMarginal, tipo: 'subtotal' },
    { label: '− Costos fijos (gastos + préstamos/ARCA)', valor: d.costosFijos != null ? -d.costosFijos : null, tipo: 'resta' },
    { label: '= Resultado del mes', valor: d.resultado, tipo: 'total' },
  ];
  els.cascada.innerHTML = filasCascada.map((f) => `
    <div class="cascada-row cascada-${f.tipo}">
      <span>${f.label}</span>
      <strong class="${f.valor != null && f.valor < 0 && f.tipo !== 'resta' ? 'valor-negativo' : ''}">${fmtPesos(f.valor)}</strong>
    </div>
  `).join('') + (d.resultadoAcumulado != null ? `
    <div class="cascada-pie">
      Resultado acumulado del año hasta ${MESES_LABEL[d.mes]}: <strong class="${d.resultadoAcumulado < 0 ? 'valor-negativo' : 'valor-positivo'}">${fmtPesos(d.resultadoAcumulado)}</strong>
      ${!d.resultadoAcumuladoCompleto ? ' (algún mes del año sin datos completos — parcial)' : ''}
    </div>` : '');

  // --- Sección 02 ---
  if (state.descuentos.length && d.margenPct != null) {
    els.s2Texto.textContent = `Aun en el descuento máximo, la contribución que te queda es la que ves abajo, calculada sobre tu margen real de este mes (${fmtPct(d.margenPct)}).`;
    els.tbodyDescuentos.innerHTML = state.descuentos.map((desc) => {
      const contribTrasDescuento = 1 - (1 - d.margenPct) / (1 - desc.descuento);
      return `
        <tr>
          <td>${fmtPesos(desc.monto_desde)} – ${desc.monto_hasta ? fmtPesos(desc.monto_hasta) : 'sin techo'}</td>
          <td>${fmtPct(desc.descuento, 0)}</td>
          <td>${escapeHtml(desc.plazo_pago || '')}</td>
          <td class="col-num ${contribTrasDescuento < 0.15 ? 'valor-negativo' : 'valor-positivo'}">${fmtPct(contribTrasDescuento)}</td>
        </tr>
      `;
    }).join('');
  } else {
    els.s2Texto.textContent = 'Sin lista de descuentos cargada, o sin margen calculado para este mes.';
    els.tbodyDescuentos.innerHTML = '<tr><td colspan="4" class="empty-state">Sin datos.</td></tr>';
  }

  // --- Sección 03 ---
  const top = d.piezasOrdenadas.slice(0, 8);
  els.s3Texto.textContent = d.concentracionLinea
    ? `Contribución del mes, a precio facturado. La línea ${d.concentracionLinea.nombre} concentra ${fmtPct(d.concentracionLinea.pct, 0)} de lo vendido.`
    : 'Sin piezas cargadas este mes.';
  const maxFacturado = top.length ? top[0].facturado : 0;
  els.barrasPiezas.innerHTML = top.length ? top.map((p) => `
    <div class="barra-row">
      <div class="barra-label">${escapeHtml(p.label)} <span class="barra-sub">${p.unidades.toLocaleString('es-AR')} u</span></div>
      <div class="barra-track">
        <div class="barra-fill" style="width:${maxFacturado ? p.facturado / maxFacturado * 100 : 0}%; background:#1a9d5c"></div>
      </div>
      <div class="barra-valor">${fmtM(p.facturado)}</div>
    </div>
  `).join('') : '<p class="empty-state">Sin piezas cargadas este mes.</p>';

  // --- Sección 04 ---
  const totalCanal = d.canalesOrdenados.reduce((a, [, v]) => a + v, 0);
  els.s4Texto.textContent = d.canalesOrdenados.length
    ? `Composición del mes por empresa/canal de facturación.${d.canalesOrdenados.some(([n]) => n === 'Presupuesto') ? ' "Presupuesto" son comprobantes tipo remito/cotización — a confirmar con vos qué representan exactamente en tu operación.' : ''}`
    : 'Sin datos de facturación este mes.';
  els.stackCanal.innerHTML = d.canalesOrdenados.map(([nombre, monto], i) => {
    const pct = totalCanal ? monto / totalCanal * 100 : 0;
    return `<div class="stack-seg" style="width:${pct}%; background:${COLORES_CANAL[i % COLORES_CANAL.length]}" title="${escapeHtml(nombre)} ${fmtPct(monto / totalCanal)}">${pct > 8 ? `${escapeHtml(nombre)} ${fmtPct(monto / totalCanal, 0)}` : ''}</div>`;
  }).join('');
  els.stackCanalLeyenda.innerHTML = d.canalesOrdenados.map(([nombre], i) => `
    <span class="stack-leyenda-item"><span class="dot" style="background:${COLORES_CANAL[i % COLORES_CANAL.length]}"></span>${escapeHtml(nombre)}</span>
  `).join('');

  // --- Sección 05 ---
  const tarjetas = [];
  if (d.caidas.length) {
    const c = d.caidas[0];
    tarjetas.push({
      tag: 'FUGA', tipo: 'demanda', titulo: `${c.label}: caída fuerte de ventas`,
      valor: `${fmtPct(c.caidaPct, 0)} menos que el promedio previo`,
      texto: `Vendías ~${Math.round(c.promedioPrevio)} u/mes en los últimos meses, este mes ${c.actual}. Revisar si es stock, precio o demanda.`,
    });
  }
  if (d.concentracionLinea && d.concentracionLinea.pct > 0.4) {
    tarjetas.push({
      tag: 'A REVISAR', tipo: 'concentracion', titulo: `${fmtPct(d.concentracionLinea.pct, 0)} depende de la línea ${d.concentracionLinea.nombre}`,
      valor: d.concentracionSku ? `${fmtPct(d.concentracionSku.pct, 0)} en un solo producto` : '',
      texto: `${d.concentracionSku ? d.concentracionSku.nombre + ' concentra buena parte de la venta. ' : ''}Bueno para foco, riesgoso para depender. Diversificar clientes/productos reduce el riesgo.`,
    });
  }
  els.oportunidades.innerHTML = tarjetas.length ? tarjetas.map((t) => `
    <div class="oportunidad-card oportunidad-${t.tipo}">
      <span class="oportunidad-tag">${t.tag}</span>
      <h4>${escapeHtml(t.titulo)}</h4>
      ${t.valor ? `<div class="oportunidad-valor">${escapeHtml(t.valor)}</div>` : ''}
      <p>${escapeHtml(t.texto)}</p>
    </div>
  `).join('') : '<p class="empty-state">No se detectaron fugas ni concentraciones fuertes este mes con los datos cargados.</p>';

  if (d.brecha != null && d.brecha > 0 && d.ticketPromedio) {
    const pedidos = Math.ceil(d.brecha / d.ticketPromedio);
    els.metaCallout.innerHTML = `
      <div class="meta-kicker">META QUE ORDENA TODA LA CAPTACIÓN</div>
      <div class="meta-titulo">No es "más clientes" en abstracto</div>
      <p>Es sumar <strong>${pedidos} pedido${pedidos === 1 ? '' : 's'} nuevo${pedidos === 1 ? '' : 's'} por mes</strong> (ticket promedio ~${fmtPesos(d.ticketPromedio)}) para cruzar el equilibrio. A partir de ahí, cada pedido extra deja ~${fmtPct(d.margenPct, 0)} de ganancia.</p>
      <div class="meta-numero">+${fmtPesos(d.brecha)}</div>
      <div class="meta-numero-label">de facturación por mes para dejar de perder</div>
    `;
    els.metaCallout.style.display = '';
  } else {
    els.metaCallout.style.display = 'none';
  }

  els.fuente.innerHTML = `<strong>Fuente:</strong> facturas, piezas y costos cargados en el CRM. Contribución = ventas − costo de materia prima por pieza (no descuenta comisiones ni descuentos comerciales aplicados, que ya están reflejados en el precio facturado real). Estimación para decisión comercial, no cierre contable.`;
}

els.mes.addEventListener('change', () => render(calcular(els.mes.value)));

initUser().then(async () => {
  await cargarDatos();
  poblarSelectorMeses();
  if (els.mes.value) render(calcular(els.mes.value));
});
