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

// Mismas dos empresas propias que en Análisis semanal — una factura entre
// ellas no es una venta real a un cliente (ver analisis-semanal.js).
const CUITS_PROPIOS = new Set(['30709413208', '30714033189']);

const META_CONTACTOS_SEMANAL = 50; // debe estar sincronizado con app.js

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  ultimaActualizacion: document.getElementById('ultima-actualizacion'),
  kpiGrid: document.getElementById('kpi-grid'),
};

function fmt(n) { return Math.round(n).toLocaleString('es-AR'); }
function fmtPesos(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }

function primerYUltimoDiaMes(d) {
  const primero = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { desde: primero.toISOString().slice(0, 10), hasta: ultimo.toISOString().slice(0, 10) };
}

function inicioSemana() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0 = domingo, 1 = lunes, ...
  const diff = dia === 0 ? 6 : dia - 1;
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diff);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function esVencido(fechaStr, hoyStr) {
  if (!fechaStr) return false;
  return fechaStr <= hoyStr;
}

// Réplica exacta del cálculo de "stock actual" de produccion.js (unificado
// entre depósitos): para cada pieza+depósito, ancla en el último recuento y
// suma los movimientos posteriores. Acá solo interesa cuántas piezas
// (sumadas entre depósitos) quedan en negativo — esa es la señal de alerta.
function contarPiezasEnNegativo(rows) {
  // El stock se ancla en el último recuento por pieza+calidad+depósito (esa
  // es la unidad real que se cuenta físicamente), pero para el número final
  // se suma agrupando SIN calidad (línea+pieza+variante) — igual que la
  // vista por default de "Producción (stock)" ("Agrupar por: Pieza", no
  // "Pieza y calidad"). Si acá se agrupara distinto, el número de este KPI
  // podía no coincidir con lo que Víctor ve al entrar a esa pantalla desde
  // acá (bug real detectado 13/08/26 probando esto: con calidad daba 2
  // piezas en negativo, la pantalla de Producción por default muestra 1
  // porque ahí una calidad con stock positivo compensa a otra en negativo).
  const porPiezaCalidadUbic = new Map();
  for (const r of rows) {
    const grupoKey = `${r.linea}|${r.tipo_pieza}|${r.variante || ''}`;
    const piezaCalidadKey = `${grupoKey}|${r.calidad}`;
    const k = `${piezaCalidadKey}|${r.ubicacion}`;
    if (!porPiezaCalidadUbic.has(k)) porPiezaCalidadUbic.set(k, { grupoKey, rows: [] });
    porPiezaCalidadUbic.get(k).rows.push(r);
  }
  const stockPorPieza = new Map();
  for (const { grupoKey, rows: rs } of porPiezaCalidadUbic.values()) {
    const recuentos = rs.filter((r) => r.tipo === 'recuento');
    let baseFecha = null, baseQty = 0;
    if (recuentos.length) {
      const ult = recuentos.reduce((a, b) => (b.fecha > a.fecha ? b : a));
      baseFecha = ult.fecha; baseQty = ult.cantidad;
    }
    let prod = 0, venta = 0, rotura = 0, trasladoIn = 0, trasladoOut = 0;
    for (const r of rs) {
      if (r.tipo === 'recuento') continue;
      if (baseFecha && r.fecha <= baseFecha) continue;
      if (r.tipo === 'produccion') prod += r.cantidad;
      else if (r.tipo === 'venta') venta += r.cantidad;
      else if (r.tipo === 'rotura' || r.tipo === 'rotura_deposito') rotura += r.cantidad;
      else if (r.tipo === 'traslado_entrada') trasladoIn += r.cantidad;
      else if (r.tipo === 'traslado_salida') trasladoOut += r.cantidad;
    }
    const stockUbic = baseQty + prod + trasladoIn - venta - rotura - trasladoOut;
    stockPorPieza.set(grupoKey, (stockPorPieza.get(grupoKey) || 0) + stockUbic);
  }
  let negativas = 0;
  for (const stock of stockPorPieza.values()) if (stock < 0) negativas += 1;
  return negativas;
}

async function init() {
  const me = await (await fetch('/api/me')).json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  const hoy = new Date();
  const hoyStr = hoy.toISOString().slice(0, 10);
  const { desde, hasta } = primerYUltimoDiaMes(hoy);

  const [
    { data: facturasTodas, error: e1 },
    { data: interacciones, error: e2 },
    { data: produccionRows, error: e3 },
  ] = await Promise.all([
    // Se trae TODO el historial (no solo el mes) porque "clientes nuevos"
    // necesita saber cuál fue la primera compra de cada uno alguna vez, no
    // solo dentro del mes actual.
    fetchAll(() => client.from('facturas').select('id, fecha, importe_ars, cliente_id, cuit_normalizado')),
    fetchAll(() => client.from('interacciones').select('cliente_id, created_at, proximo_seguimiento')),
    fetchAll(() => client.from('produccion').select('fecha, tipo, ubicacion, cantidad, piezas(linea, tipo_pieza, variante, calidad)')),
  ]);

  if (e1 || e2 || e3) {
    els.kpiGrid.innerHTML = `<div class="empty-state">Error al cargar: ${(e1 || e2 || e3).message}</div>`;
    return;
  }

  // --- Facturado / Piezas vendidas / Clientes que compraron (mes actual) ---
  const facturasReales = (facturasTodas || []).filter((f) => f.fecha && !CUITS_PROPIOS.has(f.cuit_normalizado));
  const facturasMesReales = facturasReales.filter((f) => f.fecha >= desde && f.fecha <= hasta);
  const facturaIds = facturasMesReales.map((f) => f.id);
  const totalFacturado = facturasMesReales.reduce((s, f) => s + Number(f.importe_ars || 0), 0);
  const clientesQueCompraron = new Set(facturasMesReales.filter((f) => f.cliente_id).map((f) => f.cliente_id));

  // Cliente "nuevo" = su primera compra EN TODA LA HISTORIA cayó en este mes
  // (no tenía ninguna factura de antes).
  const primeraCompraPorCliente = new Map();
  for (const f of facturasReales) {
    if (!f.cliente_id) continue;
    const actual = primeraCompraPorCliente.get(f.cliente_id);
    if (!actual || f.fecha < actual) primeraCompraPorCliente.set(f.cliente_id, f.fecha);
  }
  let clientesNuevos = 0;
  for (const clienteId of clientesQueCompraron) {
    const primera = primeraCompraPorCliente.get(clienteId);
    if (primera && primera >= desde && primera <= hasta) clientesNuevos += 1;
  }

  let piezasVendidas = 0;
  if (facturaIds.length > 0) {
    const { data: items, error: e4 } = await fetchAll(() =>
      client.from('factura_items').select('factura_id, cantidad').in('factura_id', facturaIds)
    );
    if (!e4) piezasVendidas = (items || []).reduce((s, it) => s + Number(it.cantidad || 0), 0);
  }

  // --- Seguimientos vencidos / Contactos esta semana (mismo criterio que app.js) ---
  const interaccionesPorCliente = new Map();
  for (const i of (interacciones || [])) {
    const lista = interaccionesPorCliente.get(i.cliente_id) || [];
    lista.push(i);
    interaccionesPorCliente.set(i.cliente_id, lista);
  }
  let seguimientosVencidos = 0;
  for (const lista of interaccionesPorCliente.values()) {
    lista.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (esVencido(lista[0].proximo_seguimiento, hoyStr)) seguimientosVencidos += 1;
  }
  const semanaDesde = inicioSemana();
  let contactosSemana = 0;
  for (const i of (interacciones || [])) {
    if (new Date(i.created_at) >= semanaDesde) contactosSemana += 1;
  }
  const faltanContactos = Math.max(0, META_CONTACTOS_SEMANAL - contactosSemana);

  // --- Piezas con stock negativo (unificado Alberti + Lanús) ---
  const rowsConPieza = (produccionRows || [])
    .filter((r) => r.piezas)
    .map((r) => ({ fecha: r.fecha, tipo: r.tipo, ubicacion: r.ubicacion, cantidad: r.cantidad, ...r.piezas }));
  const piezasEnNegativo = contarPiezasEnNegativo(rowsConPieza);

  const kpis = [
    { label: 'Facturado este mes', value: fmtPesos(totalFacturado), href: '/analisis-semanal.html' },
    { label: 'Piezas vendidas este mes', value: fmt(piezasVendidas), href: '/analisis-semanal.html' },
    { label: 'Clientes que compraron este mes', value: fmt(clientesQueCompraron.size), href: '/analisis-semanal.html' },
    { label: 'Clientes nuevos que compraron', value: fmt(clientesNuevos), href: '/index.html' },
    { label: '📅 Seguimientos vencidos', value: fmt(seguimientosVencidos), href: '/index.html', alerta: seguimientosVencidos > 0 },
    { label: '🎯 Contactos esta semana', value: `${contactosSemana} / ${META_CONTACTOS_SEMANAL}`, href: '/index.html', sub: faltanContactos === 0 ? '¡Meta cumplida!' : `Faltan ${faltanContactos}` },
    { label: '📦 Piezas con stock negativo', value: fmt(piezasEnNegativo), href: '/produccion.html', alerta: piezasEnNegativo > 0 },
  ];

  els.kpiGrid.innerHTML = kpis.map((k) => `
    <a class="kpi-card kpi-card-link" href="${k.href}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value${k.alerta ? ' kpi-alerta' : ''}">${k.value}</div>
      ${k.sub ? `<div class="kpi-label">${k.sub}</div>` : ''}
    </a>
  `).join('');

  cargarUltimaActualizacion();
}

// Última carga de cualquier tipo (factura nueva o movimiento de producción) —
// mismo criterio que las otras pantallas, para saber si los KPI están al día.
async function cargarUltimaActualizacion() {
  const [{ data: a }, { data: b }] = await Promise.all([
    client.from('facturas').select('created_at').order('created_at', { ascending: false }).limit(1),
    client.from('produccion').select('created_at').order('created_at', { ascending: false }).limit(1),
  ]);
  const fechas = [a?.[0]?.created_at, b?.[0]?.created_at].filter(Boolean).map((f) => new Date(f));
  if (fechas.length === 0) { els.ultimaActualizacion.textContent = ''; return; }
  const ultima = new Date(Math.max(...fechas));
  const fechaStr = ultima.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = ultima.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.ultimaActualizacion.textContent = `Última actualización de datos: ${fechaStr}, ${horaStr} hs.`;
}

init();
