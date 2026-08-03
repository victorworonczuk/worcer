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

const MESES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const state = {
  facturas: [],
  items: [],
  clientesPorId: new Map(),
  costosPorPiezaId: new Map(),
  gastosGenerales: [],
  obligaciones: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  cobertura: document.getElementById('cobertura'),
  resumen: document.getElementById('resumen'),
  notaResultado: document.getElementById('nota-resultado'),
  tbodyPiezas: document.getElementById('tbody-piezas'),
  tbodyVendedor: document.getElementById('tbody-vendedor'),
  tbodySegmento: document.getElementById('tbody-segmento'),
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtPesos(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return (n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarDatos() {
  const [{ data: facturas }, { data: items }, { data: clientes }, { data: costos }, { data: gastos }, { data: obligaciones }] = await Promise.all([
    fetchAll(() => client.from('facturas').select('id, fecha, importe_ars, tipo_comprobante, cliente_id, vendedor').like('tipo_comprobante', 'F %')),
    fetchAll(() => client.from('factura_items').select('factura_id, cantidad, precio_unitario, pieza_id, piezas(linea, tipo_pieza, variante, calidad)')),
    fetchAll(() => client.from('clientes').select('id, segmento')),
    fetchAll(() => client.from('costos_piezas').select('pieza_id, ctu_ars')),
    fetchAll(() => client.from('gastos_generales_mensuales').select('anio, mes, empresa, monto')),
    fetchAll(() => client.from('obligaciones_financieras').select('anio, mes, prestamos, arca')),
  ]);

  state.facturas = facturas || [];
  state.items = items || [];
  state.clientesPorId = new Map((clientes || []).map((c) => [c.id, c]));
  state.costosPorPiezaId = new Map((costos || []).map((c) => [c.pieza_id, Number(c.ctu_ars)]));
  state.gastosGenerales = gastos || [];
  state.obligaciones = obligaciones || [];
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

function calcularYRenderizar() {
  const clave = els.mes.value;
  if (!clave) return;
  const [anio, mes] = clave.split('-').map(Number);

  const facturasDelMes = state.facturas.filter((f) => f.fecha.slice(0, 7) === clave);
  const idsFacturas = new Set(facturasDelMes.map((f) => f.id));
  const itemsDelMes = state.items.filter((it) => idsFacturas.has(it.factura_id));

  const ventasTotales = facturasDelMes.reduce((a, f) => a + Number(f.importe_ars || 0), 0);

  // Cobertura: cuánto de la facturación del mes tiene al menos un ítem cargado.
  const facturasConItem = new Set(itemsDelMes.map((it) => it.factura_id));
  const ventasCubiertas = facturasDelMes
    .filter((f) => facturasConItem.has(f.id))
    .reduce((a, f) => a + Number(f.importe_ars || 0), 0);
  const cobertura = ventasTotales > 0 ? ventasCubiertas / ventasTotales : null;

  // Costo variable: solo ítems con costo cargado (costos_piezas).
  let facturadoConCosto = 0;
  let costoVariable = 0;
  const porPieza = new Map(); // clave -> { label, unidades, facturado, costo, tieneCosto }
  for (const it of itemsDelMes) {
    const cantidad = Number(it.cantidad || 0);
    const precio = Number(it.precio_unitario || 0);
    const facturadoItem = cantidad * precio;
    const ctu = state.costosPorPiezaId.has(it.pieza_id) ? state.costosPorPiezaId.get(it.pieza_id) : null;
    const p = it.piezas || {};
    const claveP = `${p.linea}|${p.tipo_pieza}|${p.variante}`;
    const label = `${p.linea || '?'} · ${p.tipo_pieza || '?'}${p.variante ? ` (${p.variante})` : ''}`;
    if (!porPieza.has(claveP)) porPieza.set(claveP, { label, unidades: 0, facturado: 0, costo: 0, tieneCosto: true });
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
  const costosFijos = (gastosGeneralesTotal != null || obligacionesTotal != null)
    ? (gastosGeneralesTotal || 0) + (obligacionesTotal || 0)
    : null;

  const resultado = (contribucionMarginal != null && costosFijos != null) ? contribucionMarginal - costosFijos : null;
  const puntoEquilibrio = (costosFijos != null && margenPct) ? costosFijos / margenPct : null;

  // --- Resumen (tarjetas) ---
  els.cobertura.textContent = cobertura != null
    ? `Cobertura de detalle de piezas: ${fmtPct(cobertura)} de la facturación del mes`
    : '';

  const tarjetas = [
    { label: 'Facturación del mes', value: fmtPesos(ventasTotales) },
    { label: 'Costo variable (estimado)', value: fmtPesos(margenPct != null ? ventasTotales * (1 - margenPct) : null) },
    { label: 'Contribución marginal', value: fmtPesos(contribucionMarginal) },
    { label: 'Costos fijos (gastos + préstamos/ARCA)', value: fmtPesos(costosFijos) },
    { label: 'Resultado del mes', value: fmtPesos(resultado), clase: resultado != null ? (resultado >= 0 ? 'valor-positivo' : 'valor-negativo') : '' },
    { label: 'Punto de equilibrio (facturación necesaria)', value: fmtPesos(puntoEquilibrio) },
  ];
  els.resumen.innerHTML = tarjetas.map((t) => `
    <div><strong class="${t.clase || ''}">${t.value}</strong><span class="label">${t.label}</span></div>
  `).join('');

  const notas = [];
  if (gastosGeneralesTotal == null) notas.push('sin gastos generales cargados para este mes');
  if (obligacionesTotal == null) notas.push('sin dato de préstamos/ARCA para este mes');
  if (margenPct == null) notas.push('sin piezas con costo cargado en las facturas de este mes');
  els.notaResultado.textContent = notas.length ? `Dato incompleto: ${notas.join('; ')}. Los cálculos de arriba pueden no ser representativos.` : '';

  // --- Piezas más vendidas ---
  const piezasOrdenadas = [...porPieza.values()].sort((a, b) => b.facturado - a.facturado).slice(0, 15);
  els.tbodyPiezas.innerHTML = piezasOrdenadas.length
    ? piezasOrdenadas.map((p) => `
        <tr>
          <td>${escapeHtml(p.label)}</td>
          <td class="col-num">${p.unidades.toLocaleString('es-AR')}</td>
          <td class="col-num">${fmtPesos(p.facturado)}</td>
          <td class="col-num">${p.tieneCosto ? fmtPesos(p.facturado - p.costo) : '—'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="empty-state">Sin piezas cargadas este mes.</td></tr>';

  // --- Por vendedor ---
  const porVendedor = new Map();
  for (const f of facturasDelMes) {
    const v = f.vendedor || 'Sin asignar';
    porVendedor.set(v, (porVendedor.get(v) || 0) + Number(f.importe_ars || 0));
  }
  const vendedoresOrdenados = [...porVendedor.entries()].sort((a, b) => b[1] - a[1]);
  els.tbodyVendedor.innerHTML = vendedoresOrdenados.length
    ? vendedoresOrdenados.map(([v, monto]) => `
        <tr><td>${escapeHtml(v)}</td><td class="col-num">${fmtPesos(monto)}</td><td class="col-num">${fmtPct(ventasTotales ? monto / ventasTotales : null)}</td></tr>
      `).join('')
    : '<tr><td colspan="3" class="empty-state">Sin datos.</td></tr>';

  // --- Por segmento ---
  const porSegmento = new Map();
  for (const f of facturasDelMes) {
    const cli = state.clientesPorId.get(f.cliente_id);
    const seg = (cli && cli.segmento ? cli.segmento.trim()[0] : null) || 'Sin dato';
    porSegmento.set(seg, (porSegmento.get(seg) || 0) + Number(f.importe_ars || 0));
  }
  const segmentosOrdenados = [...porSegmento.entries()].sort((a, b) => b[1] - a[1]);
  els.tbodySegmento.innerHTML = segmentosOrdenados.length
    ? segmentosOrdenados.map(([s, monto]) => `
        <tr><td>${escapeHtml(s)}</td><td class="col-num">${fmtPesos(monto)}</td><td class="col-num">${fmtPct(ventasTotales ? monto / ventasTotales : null)}</td></tr>
      `).join('')
    : '<tr><td colspan="3" class="empty-state">Sin datos.</td></tr>';
}

els.mes.addEventListener('change', calcularYRenderizar);

initUser().then(async () => {
  await cargarDatos();
  poblarSelectorMeses();
  calcularYRenderizar();
});
