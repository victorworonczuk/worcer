const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const PAGE_SIZE = 50;

const state = {
  all: [],
  filtered: [],
  page: 1,
  filters: { q: '', segmento: '', provincia: '', localidad: '', confianza: '', estado: '', rubro: '', vendedor: '', canalCaptacion: '', soloVencidos: false, soloContactadosSemana: false },
  facturasByCliente: new Map(),
  openFacturas: new Set(),
  interaccionesByCliente: new Map(),
  openHistorial: new Set(),
  openDescripcion: new Set(),
  vendedorOtro: new Set(),
  currentUser: null,
  currentUserRol: null,
  currentUserNombre: null,
};

const CANAL_LABEL = { llamado: '☎ Llamado', whatsapp: 'WhatsApp', email: 'Email', otro: 'Otro' };
const RESULTADO_LABEL = { contactado: 'Contactado', recuperado: 'Recuperado', descartado: 'Descartado' };

const PROVINCIAS = [
  'Bs As', 'Capital', 'Catamarca', 'Chaco', 'Corrientes', 'Córdoba', 'Entre Ríos', 'Formosa',
  'Jujuy', 'La Pampa', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan',
  'San Luis', 'Santa Cruz', 'Santa Fe', 'Sgo Estero', 'T.Fuego', 'Tucumán',
];

const RUBROS = ['Distribuidor', 'Venta online', 'Sanitario', 'Corralón', 'Ferretería', 'Otros'];

const META_CONTACTOS_SEMANAL = 50;

const VENDEDORES = [
  'Sergio Nastaskin', 'Hernán Acosta', 'Walter Vernola', 'Alejandro Vernola', 'Jose Gil',
  'Javier Viglino', 'Francisco Baez', 'Martín Argento', 'Darío Frank', 'Walter Fogar',
  'Mariano Cabarrus', 'Sebastián Guerra', 'Horacio Vostrosky', 'Víctor W.',
];

const CANALES_CAPTACION = [
  'Contacto telefónico', 'Visita comercial', 'Referido', 'Feria/evento',
  'Redes sociales/Web', 'Cliente histórico', 'Otro',
];

const FROM_BY_ROL = {
  ventas: 'ventas@porcelanasalberti.com.ar',
  facturacion: 'administracion@porcelanasalberti.com.ar',
  admin: 'ventas@porcelanasalberti.com.ar',
};

const els = {
  tbody: document.getElementById('tbody'),
  stats: document.getElementById('stats'),
  search: document.getElementById('f-search'),
  segmento: document.getElementById('f-segmento'),
  provincia: document.getElementById('f-provincia'),
  localidad: document.getElementById('f-localidad'),
  confianza: document.getElementById('f-confianza'),
  estado: document.getElementById('f-estado'),
  rubro: document.getElementById('f-rubro'),
  vendedor: document.getElementById('f-vendedor'),
  canalCaptacion: document.getElementById('f-canal-captacion'),
  resultCount: document.getElementById('result-count'),
  pageInfo: document.getElementById('page-info'),
  prevBtn: document.getElementById('prev-page'),
  nextBtn: document.getElementById('next-page'),
  btnNuevoCliente: document.getElementById('btn-nuevo-cliente'),
  modalOverlay: document.getElementById('modal-overlay'),
  formNuevoCliente: document.getElementById('form-nuevo-cliente'),
  btnCancelarNuevoCliente: document.getElementById('btn-cancelar-nuevo-cliente'),
  ncError: document.getElementById('nc-error'),
};

const LEGAL_SUFFIX_RE = /\s+(s\.?\s*a\.?(\s*u\.?)?|s\.?\s*r\.?\s*l\.?|s\.?\s*c\.?\s*a\.?|s\.?\s*a\.?\s*s\.?|s\.?\s*h\.?|sociedad\s+an[oó]nima|sociedad\s+de\s+responsabilidad\s+limitada|sociedad\s+de\s+hecho|sociedad\s+simple)\s*$/i;

function tituloCase(str) {
  return str.toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, (m, sep, chr) => sep + chr.toUpperCase());
}

function cleanNombre(nombre) {
  if (!nombre) return 'estimado cliente';
  const sinSufijo = nombre.trim().replace(LEGAL_SUFFIX_RE, '');
  return tituloCase(sinSufijo || nombre).trim() || 'estimado cliente';
}

const MESSAGE_TEMPLATES = {
  A: (nombre) => `Hola ${nombre}, te escribimos de Worcer. Actualizamos la lista de precios y quería avisarte por si la necesitás para tu próximo pedido. Gracias por seguir eligiéndonos, cualquier cosa que necesites contános.`,
  B: (nombre) => `Hola ${nombre}, soy de Worcer. Vi que hace un par de meses no nos hacés pedidos — ¿va todo bien con el stock? Te paso la lista actualizada por las dudas necesites algo.`,
  C: (nombre) => `Hola ${nombre}, te escribo de Worcer porque hace unos meses que no pasás pedido y quería saber si hay algo que podamos mejorar de nuestro lado — precio, plazos de entrega, algo puntual. Contame.`,
  D: (nombre) => `Hola ${nombre}, te contacto de Worcer — hace un tiempo que no trabajamos juntos y quería reconectar. Tenemos condiciones especiales para retomar el pedido. ¿Tenés 5 minutos esta semana?`,
  E: (nombre) => `Hola ${nombre}, somos Worcer — hace bastante que no tenemos novedades tuyas. Actualizamos precios y catálogo de nuestras dos líneas (económica y media). Te dejamos la lista actualizada por si querés retomar pedidos.`,
  F: (nombre) => `Hola, somos Worcer, fabricamos sanitarios y juegos de baño de loza. Facturamos con ${nombre} hace un tiempo y queríamos reconectar — ¿siguen comprando para el rubro?`,
};

function buildMessage(r) {
  const letter = (r.segmento || 'F').trim()[0].toUpperCase();
  const fn = MESSAGE_TEMPLATES[letter] || MESSAGE_TEMPLATES.F;
  return fn(cleanNombre(r.nombre));
}

const EMAIL_TEMPLATES = {
  A: (nombre) => ({
    subject: 'Lista de precios actualizada — gracias por seguir eligiendo Worcer',
    body: `Hola ${nombre},<br><br>Queríamos avisarte que actualizamos la lista de precios de nuestras líneas — te la dejamos disponible por si la necesitás para tu próximo pedido.<br><br>Gracias por seguir confiando en Worcer. Cualquier cosa que necesites, estamos para ayudarte.`,
  }),
  B: (nombre) => ({
    subject: '¿Va todo bien? Hace un tiempo no tenemos pedidos tuyos',
    body: `Hola ${nombre},<br><br>Notamos que hace un par de meses no nos hacés pedidos — ¿va todo bien con el stock?<br><br>Te dejamos la lista de precios actualizada por si necesitás algo. Cualquier consulta, escribinos.`,
  }),
  C: (nombre) => ({
    subject: 'Queremos saber cómo podemos ayudarte',
    body: `Hola ${nombre},<br><br>Hace unos meses que no pasás pedido y queríamos saber si hay algo que podamos mejorar de nuestro lado — precio, plazos de entrega, algo puntual.<br><br>Contanos y vemos cómo ayudarte.`,
  }),
  D: (nombre) => ({
    subject: 'Volvamos a trabajar juntos — condiciones especiales',
    body: `Hola ${nombre},<br><br>Hace un tiempo que no trabajamos juntos y queríamos reconectar. Tenemos condiciones especiales para retomar el pedido.<br><br>¿Tenés unos minutos esta semana para charlar?`,
  }),
  E: (nombre) => ({
    subject: 'Actualizamos nuestro catálogo — ¿retomamos?',
    body: `Hola ${nombre},<br><br>Hace bastante que no tenemos novedades tuyas. Actualizamos precios y catálogo de nuestras dos líneas (económica y media).<br><br>Te dejamos la lista actualizada por si querés retomar pedidos con nosotros.`,
  }),
  F: (nombre) => ({
    subject: 'Worcer — fabricantes de sanitarios, reconectemos',
    body: `Hola,<br><br>Somos Worcer, fabricamos sanitarios y juegos de baño de loza. Facturamos con ${nombre} hace un tiempo y queríamos reconectar.<br><br>¿Siguen comprando para el rubro? Nos encantaría retomar el contacto.`,
  }),
};

function buildEmail(r) {
  const letter = (r.segmento || 'F').trim()[0].toUpperCase();
  const fn = EMAIL_TEMPLATES[letter] || EMAIL_TEMPLATES.F;
  const { subject, body } = fn(cleanNombre(r.nombre));
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;color:#1c2126;line-height:1.6;">
    <p style="font-size:20px;font-weight:700;margin:0 0 16px;">Worcer</p>
    <p>${body}</p>
    <p style="margin-top:24px;color:#6b7280;font-size:13px;">Equipo Worcer · Sanitarios y juegos de baño de loza</p>
  </div>`;
  return { subject, html };
}

async function onSendEmail(e) {
  const id = Number(e.target.dataset.id);
  const rec = state.all.find((r) => r.id === id);
  if (!rec || !rec.email) return;

  const { subject, html } = buildEmail(rec);
  const from = FROM_BY_ROL[state.currentUserRol] || FROM_BY_ROL.admin;

  const confirmed = confirm(`¿Enviar email a ${rec.nombre} <${rec.email}>?\n\nAsunto: ${subject}\nDesde: ${from}`);
  if (!confirmed) return;

  const original = e.target.textContent;
  e.target.disabled = true;
  e.target.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: rec.email, subject, html, from }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');
    e.target.textContent = '✓ Enviado';
    setTimeout(() => {
      e.target.textContent = original;
      e.target.disabled = false;
    }, 2000);
  } catch (err) {
    alert('No se pudo enviar el email: ' + err.message);
    e.target.textContent = original;
    e.target.disabled = false;
  }
}

function segClass(segmento) {
  if (!segmento) return 'badge-seg-f';
  const letter = segmento.trim()[0].toLowerCase();
  return `badge-seg-${letter}`;
}

function confClass(conf) {
  if (!conf) return 'badge-conf-sin';
  return `badge-conf-${conf}`;
}

function estadoClass(estado) {
  return `estado-${estado || 'pendiente'}`;
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '';
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// Supabase/PostgREST corta cada respuesta en 1000 filas por más que se pida un
// .limit() más alto — hay que pedir de a páginas con .range() hasta que la
// página vuelva incompleta. Sin esto, en cuanto una tabla cruza las 1000 filas
// (pasó con clientes al cargar los Llamados, y ya le pasaba a facturas hace
// rato sin que nadie lo notara) el resto queda silenciosamente afuera.
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

// El subtítulo mostraba "873 registros" fijo en el texto, aunque la base ya
// tenía muchos más (quedó de cuando arrancó el proyecto) — ahora se arma con
// el total real, y se llama tanto al conocer el usuario como al terminar de
// cargar los clientes (lo que termine último es lo que se termina mostrando).
function actualizarSubtitulo() {
  const subtitle = document.getElementById('user-subtitle');
  if (!subtitle || !state.currentUserNombre) return;
  const cantidad = state.all.length
    ? ` — ${state.all.length.toLocaleString('es-AR')} registros`
    : '';
  subtitle.textContent = `Sesión: ${state.currentUserNombre} · Base histórica y activa unificada${cantidad}`;
}

async function loadData() {
  els.tbody.innerHTML = `<tr><td colspan="11" class="loading">Cargando clientes…</td></tr>`;
  const { data, error } = await fetchAll(() =>
    client
      .from('clientes')
      .select('*')
      .order('segmento', { ascending: true })
      .order('usd_total_2025_2026', { ascending: false, nullsFirst: false })
  );

  if (error) {
    els.tbody.innerHTML = `<tr><td colspan="11" class="empty-state">Error cargando datos: ${error.message}</td></tr>`;
    console.error(error);
    return;
  }
  state.all = data;
  actualizarSubtitulo();

  const { data: facturas, error: facturasError } = await fetchAll(() =>
    client
      .from('facturas')
      .select('cliente_id, fecha, empresa, mes, importe_ars, importe_usd')
      .not('cliente_id', 'is', null)
      .order('fecha', { ascending: false })
  );

  if (facturasError) {
    console.error('Error cargando facturas', facturasError);
  } else {
    state.facturasByCliente = new Map();
    for (const f of facturas) {
      const list = state.facturasByCliente.get(f.cliente_id) || [];
      list.push(f);
      state.facturasByCliente.set(f.cliente_id, list);
    }
  }

  const { data: interacciones, error: interaccionesError } = await fetchAll(() =>
    client
      .from('interacciones')
      .select('id, cliente_id, usuario, canal, resultado, nota, created_at')
      .order('created_at', { ascending: false })
  );

  if (interaccionesError) {
    console.error('Error cargando interacciones', interaccionesError);
  } else {
    state.interaccionesByCliente = new Map();
    for (const i of interacciones) {
      const list = state.interaccionesByCliente.get(i.cliente_id) || [];
      list.push(i);
      state.interaccionesByCliente.set(i.cliente_id, list);
    }
  }

  populateFilterOptions();
  renderStats();
  applyFilters();
}

function populateFilterOptions() {
  const provincias = [...new Set(state.all.map((r) => r.provincia).filter(Boolean))].sort();
  els.provincia.innerHTML =
    '<option value="">Todas las provincias</option>' +
    provincias.map((p) => `<option value="${p}">${p}</option>`).join('');

  const localidades = [...new Set(state.all.map((r) => r.localidad).filter(Boolean))].sort();
  const localidadActual = els.localidad.value;
  els.localidad.innerHTML =
    '<option value="">Todas las localidades</option>' +
    localidades.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  els.localidad.value = localidadActual;

  const vendedores = [...new Set(state.all.map((r) => r.vendedor).filter(Boolean))].sort();
  const vendedorActual = els.vendedor.value;
  els.vendedor.innerHTML =
    '<option value="">Todos los vendedores</option>' +
    vendedores.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  els.vendedor.value = vendedorActual;
}

function inicioSemana() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0 = domingo, 1 = lunes, ...
  const diff = dia === 0 ? 6 : dia - 1; // días desde el lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diff);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function contactosEstaSemana() {
  const desde = inicioSemana();
  let count = 0;
  for (const lista of state.interaccionesByCliente.values()) {
    for (const i of lista) {
      if (new Date(i.created_at) >= desde) count += 1;
    }
  }
  return count;
}

function clienteContactadoEstaSemana(clienteId) {
  const desde = inicioSemana();
  const lista = state.interaccionesByCliente.get(clienteId);
  if (!lista) return false;
  return lista.some((i) => new Date(i.created_at) >= desde);
}

function renderStats() {
  const segCounts = {};
  const estadoCounts = {};
  let conContacto = 0;
  let vencidos = 0;
  let clientesReales = 0;
  let personas = 0;
  for (const r of state.all) {
    const seg = (r.segmento || '?').trim()[0];
    segCounts[seg] = (segCounts[seg] || 0) + 1;
    const est = r.estado_contacto || 'pendiente';
    estadoCounts[est] = (estadoCounts[est] || 0) + 1;
    if (r.telefono || r.whatsapp || r.email) conContacto += 1;
    if (esVencido(proximoSeguimientoDe(r.id))) vencidos += 1;
    // "Cliente" = compró al menos una vez (tiene alguna factura vinculada).
    // Sin ninguna factura todavía es un contacto/lead, no un cliente real —
    // distinción que se volvió relevante con el import de Llamados (582
    // contactos nuevos, la mayoría sin ninguna compra todavía).
    if ((state.facturasByCliente.get(r.id) || []).length > 0) clientesReales += 1;
    else personas += 1;
  }

  const contactosSemana = contactosEstaSemana();
  const faltan = Math.max(0, META_CONTACTOS_SEMANAL - contactosSemana);
  const metaLabel = faltan === 0
    ? `🎯 Contactos esta semana · ¡Meta cumplida!`
    : `🎯 Contactos esta semana · Faltan ${faltan}`;

  const cards = [
    { label: 'Clientes', value: clientesReales },
    { label: 'Personas', value: personas },
    { label: 'Con dato de contacto', value: conContacto },
    { label: '📅 Seguimientos vencidos', value: vencidos, id: 'card-vencidos', special: true },
    { label: metaLabel, value: `${contactosSemana} / ${META_CONTACTOS_SEMANAL}`, id: 'card-contactados-semana', clickMeta: true, metaCumplida: faltan === 0 },
    { label: 'Recuperados', value: estadoCounts.recuperado || 0 },
    { label: 'Contactados', value: estadoCounts.contactado || 0 },
    { label: 'Descartados', value: estadoCounts.descartado || 0 },
    { label: 'Seg. A · Activo sano', value: segCounts.A || 0 },
    { label: 'Seg. B · Alerta temprana', value: segCounts.B || 0 },
    { label: 'Seg. C · Riesgo medio', value: segCounts.C || 0 },
    { label: 'Seg. D · Riesgo alto', value: segCounts.D || 0 },
    { label: 'Seg. E · Muy frío', value: segCounts.E || 0 },
    { label: 'Seg. F · Dormido total', value: segCounts.F || 0 },
  ];

  els.stats.innerHTML = cards
    .map(
      (c) =>
        `<div class="stat-card${c.special ? ' stat-card-clickable' : ''}${c.clickMeta ? ' stat-card-clickable-meta' : ''}${c.metaCumplida ? ' stat-card-success' : ''}${state.filters.soloVencidos && c.id === 'card-vencidos' ? ' active' : ''}${state.filters.soloContactadosSemana && c.id === 'card-contactados-semana' ? ' active' : ''}" ${c.id ? `id="${c.id}"` : ''}><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`
    )
    .join('');

  const cardVencidos = document.getElementById('card-vencidos');
  if (cardVencidos) {
    cardVencidos.addEventListener('click', () => {
      state.filters.soloVencidos = !state.filters.soloVencidos;
      applyFilters();
      renderStats();
    });
  }

  const cardContactadosSemana = document.getElementById('card-contactados-semana');
  if (cardContactadosSemana) {
    cardContactadosSemana.addEventListener('click', () => {
      state.filters.soloContactadosSemana = !state.filters.soloContactadosSemana;
      applyFilters();
      renderStats();
    });
  }
}

function applyFilters() {
  const { q, segmento, provincia, localidad, confianza, estado, rubro, vendedor, canalCaptacion, soloVencidos, soloContactadosSemana } = state.filters;
  const qLower = q.trim().toLowerCase();

  state.filtered = state.all.filter((r) => {
    if (segmento && !(r.segmento || '').startsWith(segmento)) return false;
    if (provincia && r.provincia !== provincia) return false;
    if (localidad && r.localidad !== localidad) return false;
    if (confianza && r.confianza_dato !== confianza) return false;
    if (estado && (r.estado_contacto || 'pendiente') !== estado) return false;
    if (rubro && !rubrosDe(r).includes(rubro)) return false;
    if (vendedor && r.vendedor !== vendedor) return false;
    if (canalCaptacion && r.canal_captacion !== canalCaptacion) return false;
    if (soloVencidos && !esVencido(proximoSeguimientoDe(r.id))) return false;
    if (soloContactadosSemana && !clienteContactadoEstaSemana(r.id)) return false;
    if (qLower) {
      const hay = `${r.nombre || ''} ${r.nombre_fantasia || ''} ${r.localidad || ''} ${r.domicilio || ''} ${r.cuit || ''}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  state.page = 1;
  renderTable();
}

function renderTable() {
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = state.filtered.slice(start, start + PAGE_SIZE);

  els.resultCount.textContent = `${total} cliente${total === 1 ? '' : 's'}`;
  els.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  els.prevBtn.disabled = state.page <= 1;
  els.nextBtn.disabled = state.page >= totalPages;

  if (pageRows.length === 0) {
    els.tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No hay clientes que coincidan con estos filtros.</td></tr>`;
    return;
  }

  els.tbody.innerHTML = pageRows
    .map((r) => {
      let out = rowHtml(r);
      if (state.openFacturas.has(r.id)) out += facturasDetailHtml(r);
      if (state.openHistorial.has(r.id)) out += historialDetailHtml(r);
      return out;
    })
    .join('');

  els.tbody.querySelectorAll('.estado-select').forEach((sel) => {
    sel.addEventListener('change', onEstadoChange);
  });
  els.tbody.querySelectorAll('.confianza-select').forEach((sel) => {
    sel.addEventListener('change', onConfianzaChange);
  });
  els.tbody.querySelectorAll('.ubicacion-select').forEach((sel) => {
    sel.addEventListener('change', onEditableFieldChange);
  });
  els.tbody.querySelectorAll('.rubro-checkbox').forEach((cb) => {
    cb.addEventListener('change', onRubroChange);
  });
  els.tbody.querySelectorAll('.vendedor-select').forEach((sel) => {
    sel.addEventListener('change', onVendedorSelectChange);
  });
  els.tbody.querySelectorAll('.canal-captacion-select').forEach((sel) => {
    sel.addEventListener('change', onEditableFieldChange);
  });
  els.tbody.querySelectorAll('.ubicacion-input, .contacto-input:not(.telefono-input), .vendedor-otro-input').forEach((input) => {
    input.addEventListener('blur', onEditableFieldChange);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  });
  els.tbody.querySelectorAll('.descripcion-input').forEach((textarea) => {
    textarea.addEventListener('blur', onEditableFieldChange);
  });
  els.tbody.querySelectorAll('.toggle-descripcion').forEach((btn) => {
    btn.addEventListener('click', onToggleDescripcion);
  });
  els.tbody.querySelectorAll('.telefono-input').forEach((input) => {
    input.addEventListener('blur', onTelefonoChange);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  });
  els.tbody.querySelectorAll('.add-telefono').forEach((btn) => {
    btn.addEventListener('click', onAddTelefono);
  });
  els.tbody.querySelectorAll('.toggle-facturas').forEach((btn) => {
    btn.addEventListener('click', onToggleFacturas);
  });
  els.tbody.querySelectorAll('.toggle-historial').forEach((btn) => {
    btn.addEventListener('click', onToggleHistorial);
  });
  els.tbody.querySelectorAll('.guardar-interaccion').forEach((btn) => {
    btn.addEventListener('click', onGuardarInteraccion);
  });
  els.tbody.querySelectorAll('.eliminar-interaccion').forEach((btn) => {
    btn.addEventListener('click', onDeleteInteraccion);
  });
  els.tbody.querySelectorAll('.delete-cliente').forEach((btn) => {
    btn.addEventListener('click', onDeleteCliente);
  });

  if (esSoloLecturaClientes()) {
    els.tbody.querySelectorAll('select, input, textarea').forEach((el) => {
      el.disabled = true;
    });
    els.tbody.querySelectorAll('.delete-cliente, .add-telefono, .guardar-interaccion, .eliminar-interaccion').forEach((el) => {
      el.style.display = 'none';
    });
  }
}

function facturasDetailHtml(r) {
  const facturas = state.facturasByCliente.get(r.id) || [];
  if (facturas.length === 0) {
    return `<tr class="factura-detail-row"><td colspan="11">Sin facturas registradas.</td></tr>`;
  }
  const rows = facturas
    .map(
      (f) => `<tr>
        <td>${f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-AR') : ''}</td>
        <td>${escapeHtml(f.empresa || '')}</td>
        <td>${fmtMoney(f.importe_ars)}</td>
        <td>US$ ${f.importe_usd ? Number(f.importe_usd).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : ''}</td>
      </tr>`
    )
    .join('');
  return `
    <tr class="factura-detail-row">
      <td colspan="11">
        <table class="factura-table">
          <thead><tr><th>Fecha</th><th>Línea</th><th>Importe ARS</th><th>Importe USD</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </td>
    </tr>
  `;
}

function onToggleFacturas(e) {
  const id = Number(e.target.dataset.id);
  if (state.openFacturas.has(id)) {
    state.openFacturas.delete(id);
  } else {
    state.openFacturas.add(id);
  }
  renderTable();
}

function fmtFecha(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR');
}

const SEGMENTO_CRITERIO = {
  A: 'compró en el último mes',
  B: 'compró hace 2 meses',
  C: 'compró hace 3-4 meses',
  D: 'compró hace 5-8 meses',
  E: 'compró hace 9 meses o más',
  F: 'nunca compró (sin facturas registradas)',
};

function segmentoTooltip(r) {
  const letter = (r.segmento || 'F').trim()[0].toUpperCase();
  const criterio = SEGMENTO_CRITERIO[letter] || SEGMENTO_CRITERIO.F;
  const meses = r.meses_sin_comprar;
  const detalle = r.ultima_compra
    ? `Última compra: ${fmtFecha(r.ultima_compra)} (${meses} ${meses === 1 ? 'mes' : 'meses'} sin comprar)`
    : 'Sin compras registradas en el sistema';
  return `Segmento ${letter}: ${criterio}.\n${detalle}`;
}

function esMismoDiaLocal(fechaA, fechaB) {
  return fechaA.getFullYear() === fechaB.getFullYear()
    && fechaA.getMonth() === fechaB.getMonth()
    && fechaA.getDate() === fechaB.getDate();
}

function clienteContactadoHoy(clienteId) {
  const hoy = new Date();
  const lista = state.interaccionesByCliente.get(clienteId) || [];
  return lista.find((i) => esMismoDiaLocal(new Date(i.created_at), hoy)) || null;
}

function historialDetailHtml(r) {
  const interacciones = state.interaccionesByCliente.get(r.id) || [];
  const filas = interacciones
    .map(
      (i) => `<tr>
        <td>${new Date(i.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${escapeHtml(i.usuario)}</td>
        <td>${CANAL_LABEL[i.canal] || escapeHtml(i.canal)}</td>
        <td><span class="badge estado-${i.resultado}">${RESULTADO_LABEL[i.resultado] || escapeHtml(i.resultado)}</span></td>
        <td>${escapeHtml(i.nota || '')}</td>
        <td>${i.proximo_seguimiento ? fmtFecha(i.proximo_seguimiento) : ''}</td>
        <td><button type="button" class="eliminar-interaccion" data-id="${r.id}" data-interaccion-id="${i.id}" title="Eliminar interacción">🗑</button></td>
      </tr>`
    )
    .join('');

  const contactoHoy = clienteContactadoHoy(r.id);
  const formHtml = contactoHoy
    ? `<div class="historial-bloqueado">Ya se registró un contacto hoy con este cliente (${CANAL_LABEL[contactoHoy.canal] || contactoHoy.canal} · ${escapeHtml(contactoHoy.usuario)}). Si fue un error, eliminalo abajo para poder cargar uno nuevo.</div>`
    : `<div class="historial-form">
          <select class="int-canal">
            <option value="llamado">☎ Llamado</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="otro">Otro</option>
          </select>
          <select class="int-resultado">
            <option value="contactado">Contactado</option>
            <option value="recuperado">Recuperado</option>
            <option value="descartado">Descartado</option>
          </select>
          <input type="text" class="int-nota" placeholder="Nota breve (opcional)" />
          <label class="int-fecha-label">Volver a contactar el
            <input type="date" class="int-fecha" />
          </label>
          <button type="button" class="guardar-interaccion" data-id="${r.id}">Guardar</button>
        </div>`;

  return `
    <tr class="historial-detail-row">
      <td colspan="11">
        ${formHtml}
        ${
          filas
            ? `<table class="historial-table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Canal</th><th>Resultado</th><th>Nota</th><th>Próximo seguimiento</th><th></th></tr></thead>
                <tbody>${filas}</tbody>
              </table>`
            : '<div class="none">Todavía no hay interacciones registradas con este cliente.</div>'
        }
      </td>
    </tr>
  `;
}

function onToggleHistorial(e) {
  const id = Number(e.target.dataset.id);
  if (state.openHistorial.has(id)) {
    state.openHistorial.delete(id);
  } else {
    state.openHistorial.add(id);
  }
  renderTable();
}

function onToggleDescripcion(e) {
  const id = Number(e.target.dataset.id);
  if (state.openDescripcion.has(id)) {
    state.openDescripcion.delete(id);
  } else {
    state.openDescripcion.add(id);
  }
  renderTable();
}

async function onGuardarInteraccion(e) {
  if (esSoloLecturaClientes()) {
    alert('Tu usuario no puede modificar datos de clientes.');
    return;
  }
  const id = Number(e.target.dataset.id);
  if (clienteContactadoHoy(id)) {
    alert('Ya se registró un contacto hoy con este cliente.');
    renderTable();
    return;
  }
  const row = e.target.closest('.historial-detail-row');
  const canal = row.querySelector('.int-canal').value;
  const resultado = row.querySelector('.int-resultado').value;
  const nota = row.querySelector('.int-nota').value.trim() || null;
  const proximo_seguimiento = row.querySelector('.int-fecha').value || null;

  e.target.disabled = true;
  e.target.textContent = 'Guardando...';

  const { data, error } = await client
    .from('interacciones')
    .insert({ cliente_id: id, usuario: state.currentUser, canal, resultado, nota, proximo_seguimiento })
    .select()
    .single();

  if (error) {
    alert('No se pudo guardar la interacción: ' + error.message);
    e.target.disabled = false;
    e.target.textContent = 'Guardar';
    return;
  }

  const list = state.interaccionesByCliente.get(id) || [];
  list.unshift(data);
  state.interaccionesByCliente.set(id, list);

  await client.from('clientes').update({ estado_contacto: resultado }).eq('id', id);
  const rec = state.all.find((r) => r.id === id);
  if (rec) rec.estado_contacto = resultado;

  renderStats();
  renderTable();
}

async function onDeleteInteraccion(e) {
  if (esSoloLecturaClientes()) {
    alert('Tu usuario no puede modificar datos de clientes.');
    return;
  }
  const clienteId = Number(e.target.dataset.id);
  const interaccionId = Number(e.target.dataset.interaccionId);
  if (!confirm('¿Eliminar esta interacción?')) return;

  const { error } = await client.from('interacciones').delete().eq('id', interaccionId);
  if (error) {
    alert('No se pudo eliminar la interacción: ' + error.message);
    return;
  }

  const lista = (state.interaccionesByCliente.get(clienteId) || []).filter((i) => i.id !== interaccionId);
  state.interaccionesByCliente.set(clienteId, lista);

  const nuevoResultado = lista[0]?.resultado || null;
  await client.from('clientes').update({ estado_contacto: nuevoResultado }).eq('id', clienteId);
  const rec = state.all.find((r) => r.id === clienteId);
  if (rec) rec.estado_contacto = nuevoResultado;

  renderStats();
  renderTable();
}

function openNuevoClienteModal() {
  els.formNuevoCliente.reset();
  els.ncError.textContent = '';
  els.modalOverlay.classList.remove('hidden');
  document.getElementById('nc-nombre').focus();
}

function closeNuevoClienteModal() {
  els.modalOverlay.classList.add('hidden');
}

async function onSubmitNuevoCliente(e) {
  e.preventDefault();
  const nombre = document.getElementById('nc-nombre').value.trim();
  if (!nombre) {
    els.ncError.textContent = 'La razón social / nombre es obligatoria.';
    return;
  }

  const nuevo = {
    nombre,
    cuit: document.getElementById('nc-cuit').value.trim() || null,
    provincia: document.getElementById('nc-provincia').value || null,
    localidad: document.getElementById('nc-localidad').value.trim() || null,
    domicilio: document.getElementById('nc-domicilio').value.trim() || null,
    telefono: document.getElementById('nc-telefono').value.trim() || null,
    whatsapp: document.getElementById('nc-whatsapp').value.trim() || null,
    email: document.getElementById('nc-email').value.trim() || null,
    rubro: document.getElementById('nc-rubro').value.trim() || null,
    canal_captacion: document.getElementById('nc-canal-captacion').value || null,
    confianza_dato: 'alta',
    origen: 'Alta manual',
  };

  const submitBtn = els.formNuevoCliente.querySelector('.btn-primary');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';
  els.ncError.textContent = '';

  const { data, error } = await client.from('clientes').insert(nuevo).select().single();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Guardar cliente';

  if (error) {
    els.ncError.textContent = 'No se pudo guardar: ' + error.message;
    return;
  }

  state.all.unshift(data);
  populateFilterOptions();
  renderStats();
  applyFilters();
  closeNuevoClienteModal();
}

async function onDeleteCliente(e) {
  if (esSoloLecturaClientes()) {
    alert('Tu usuario no puede modificar datos de clientes.');
    return;
  }
  const id = Number(e.target.dataset.id);
  const rec = state.all.find((r) => r.id === id);
  if (!rec) return;

  const confirmed = confirm(`¿Eliminar a "${rec.nombre}" de la base? Esta acción no se puede deshacer.`);
  if (!confirmed) return;

  e.target.disabled = true;

  const { error } = await client.from('clientes').delete().eq('id', id);

  if (error) {
    e.target.disabled = false;
    if (error.code === '23503') {
      alert(`No se puede eliminar a "${rec.nombre}" porque tiene facturas cargadas. Primero habría que borrar esas facturas.`);
    } else {
      alert('No se pudo eliminar: ' + error.message);
    }
    return;
  }

  state.all = state.all.filter((r) => r.id !== id);
  state.facturasByCliente.delete(id);
  state.interaccionesByCliente.delete(id);
  populateFilterOptions();
  renderStats();
  applyFilters();
}

function telefonosDe(r) {
  return (r.telefono || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function rubrosDe(r) {
  return (r.rubro || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function rubroCellHtml(r) {
  const actuales = rubrosDe(r);
  const checks = RUBROS.map((op) => `
    <label class="rubro-check">
      <input type="checkbox" class="rubro-checkbox" value="${escapeHtml(op)}" ${actuales.includes(op) ? 'checked' : ''} />
      ${escapeHtml(op)}
    </label>
  `).join('');
  return `<div class="rubro-group">${checks}<span class="save-indicator">✓</span></div>`;
}

function vendedorCellHtml(r) {
  const esOtro = r.vendedor && !VENDEDORES.includes(r.vendedor);
  const mostrarOtro = esOtro || state.vendedorOtro.has(r.id);
  const otroInput = mostrarOtro
    ? `<input type="text" class="vendedor-otro-input" data-field="vendedor" value="${escapeHtml(esOtro ? r.vendedor : '')}" placeholder="Nombre del vendedor" />`
    : '';
  return `
    <select class="vendedor-select" data-field="vendedor">
      <option value="">Sin vendedor</option>
      ${VENDEDORES.map((v) => `<option value="${escapeHtml(v)}" ${r.vendedor === v ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}
      <option value="__otro__" ${mostrarOtro ? 'selected' : ''}>Otro</option>
    </select>
    ${otroInput}
    <span class="save-indicator">✓</span>
  `;
}

function canalCaptacionCellHtml(r) {
  return `
    <select class="canal-captacion-select" data-field="canal_captacion">
      <option value="">Sin dato</option>
      ${CANALES_CAPTACION.map((c) => `<option value="${escapeHtml(c)}" ${r.canal_captacion === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
    </select>
    <span class="save-indicator">✓</span>
  `;
}

function telefonoRowHtml(valor) {
  return `<div class="contacto-row telefono-row">
    <input type="text" class="contacto-input telefono-input" value="${escapeHtml(valor)}" placeholder="Teléfono" />
  </div>`;
}

function contactLinks(r) {
  const telefonos = telefonosDe(r);
  const telefonosHtml = (telefonos.length ? telefonos : ['']).map(telefonoRowHtml).join('')
    + `<button type="button" class="add-telefono" data-id="${r.id}">+ Agregar otro teléfono</button>`;
  let waAction = '';
  if (r.whatsapp) {
    const num = r.whatsapp.replace(/[^0-9]/g, '');
    const text = encodeURIComponent(buildMessage(r));
    waAction = `<a class="contacto-action" href="https://wa.me/${num}?text=${text}" target="_blank" rel="noopener" title="Abrir WhatsApp">💬</a>`;
  }

  return `
    <div class="contacto-block">
      <div class="telefono-group" data-id="${r.id}">${telefonosHtml}</div>
      <div class="contacto-row">
        <input type="text" class="contacto-input" data-field="whatsapp" value="${escapeHtml(r.whatsapp || '')}" placeholder="WhatsApp (549...)" />
        ${waAction}
      </div>
      <div class="contacto-row">
        <input type="email" class="contacto-input" data-field="email" value="${escapeHtml(r.email || '')}" placeholder="Email" />
      </div>
      <div class="contacto-row">
        <input type="text" class="contacto-input" data-field="web" value="${escapeHtml(r.web || '')}" placeholder="Web / redes" />
      </div>
      <span class="save-indicator">✓</span>
    </div>
  `;
}

function facturacionCell(r) {
  const n = state.facturasByCliente.get(r.id)?.length || 0;
  const total = r.usd_total_2025_2026
    ? `US$ ${Number(r.usd_total_2025_2026).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
    : '';
  const meses = r.meses_compra_2025_2026 ? `${r.meses_compra_2025_2026} meses activos` : '';
  const toggle = n > 0 ? `<button type="button" class="toggle-facturas" data-id="${r.id}">${state.openFacturas.has(r.id) ? '▾' : '▸'} ${n} factura${n === 1 ? '' : 's'}</button>` : '<span class="none">Sin facturas</span>';
  return `${total ? `<strong>${total}</strong><br>` : ''}${meses ? `<span class="cuit">${meses}</span><br>` : ''}${toggle}`;
}

function rowHtml(r) {
  const segLabel = (r.segmento || '').split(' - ')[0] || '?';
  return `
    <tr data-id="${r.id}">
      <td class="nombre-cell">
        <div class="nombre-row">
          <strong>${escapeHtml(r.nombre)}</strong>
          <button type="button" class="toggle-descripcion ${r.descripcion ? 'has-desc' : ''}" data-id="${r.id}" title="Ver/editar descripción">📝</button>
        </div>
        <span class="cuit">${escapeHtml(r.cuit || '')}</span>
        ${state.openDescripcion.has(r.id) ? `
        <div class="descripcion-panel">
          <textarea class="descripcion-input" data-field="descripcion" rows="2" placeholder="Sin descripción">${escapeHtml(r.descripcion || '')}</textarea>
          <span class="save-indicator">✓</span>
        </div>` : ''}
        <button type="button" class="delete-cliente" data-id="${r.id}" title="Eliminar cliente">🗑 Eliminar</button>
      </td>
      <td class="ubicacion-cell">
        <select class="ubicacion-select" data-field="provincia">
          <option value="">Sin provincia</option>
          ${PROVINCIAS.map((p) => `<option value="${p}" ${r.provincia === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input type="text" class="ubicacion-input" data-field="localidad" value="${escapeHtml(r.localidad || '')}" placeholder="Localidad" />
        <input type="text" class="ubicacion-input" data-field="domicilio" value="${escapeHtml(r.domicilio || '')}" placeholder="Domicilio" />
        <span class="save-indicator">✓</span>
      </td>
      <td><span class="badge ${segClass(r.segmento)}" title="${escapeHtml(segmentoTooltip(r))}">${segLabel}</span></td>
      <td>
        <select class="confianza-select ${confClass(r.confianza_dato)}" data-field="confianza_dato">
          <option value="alta" ${r.confianza_dato === 'alta' ? 'selected' : ''}>Alta</option>
          <option value="media" ${r.confianza_dato === 'media' ? 'selected' : ''}>Media</option>
          <option value="baja" ${r.confianza_dato === 'baja' ? 'selected' : ''}>Baja</option>
          <option value="sin_datos" ${!r.confianza_dato || r.confianza_dato === 'sin_datos' ? 'selected' : ''}>Sin datos</option>
        </select>
        <span class="save-indicator">✓</span>
      </td>
      <td class="contact-links">${contactLinks(r)}</td>
      <td class="rubro-cell">${rubroCellHtml(r)}</td>
      <td class="vendedor-cell">${vendedorCellHtml(r)}</td>
      <td class="canal-captacion-cell">${canalCaptacionCellHtml(r)}</td>
      <td class="factura-cell">${facturacionCell(r)}</td>
      <td>
        <select class="estado-select ${estadoClass(r.estado_contacto)}" data-field="estado_contacto">
          <option value="pendiente" ${r.estado_contacto === 'pendiente' || !r.estado_contacto ? 'selected' : ''}>Pendiente</option>
          <option value="contactado" ${r.estado_contacto === 'contactado' ? 'selected' : ''}>Contactado</option>
          <option value="recuperado" ${r.estado_contacto === 'recuperado' ? 'selected' : ''}>Recuperado</option>
          <option value="descartado" ${r.estado_contacto === 'descartado' ? 'selected' : ''}>Descartado</option>
        </select>
        <span class="save-indicator">✓</span>
      </td>
      <td class="historial-cell">${historialCell(r)}</td>
    </tr>
  `;
}

function proximoSeguimientoDe(clienteId) {
  const lista = state.interaccionesByCliente.get(clienteId);
  if (!lista || lista.length === 0) return null;
  return lista[0].proximo_seguimiento || null;
}

function esVencido(fechaStr) {
  if (!fechaStr) return false;
  return fechaStr <= todayStr();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function historialCell(r) {
  const n = state.interaccionesByCliente.get(r.id)?.length || 0;
  const abierto = state.openHistorial.has(r.id);
  const label = n > 0 ? `${abierto ? '▾' : '▸'} ${n} interacci${n === 1 ? 'ón' : 'ones'}` : 'Registrar contacto';
  const proximo = proximoSeguimientoDe(r.id);
  const seguimientoHtml = proximo
    ? `<br><span class="seguimiento-tag ${esVencido(proximo) ? 'vencido' : ''}">📅 ${fmtFecha(proximo)}</span>`
    : '';
  return `<button type="button" class="toggle-historial" data-id="${r.id}">${label}</button>${seguimientoHtml}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function onEstadoChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const value = e.target.value;
  e.target.className = `estado-select ${estadoClass(value)}`;
  await saveField(id, 'estado_contacto', value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec.estado_contacto = value;
  renderStats();
}

async function onConfianzaChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const value = e.target.value;
  e.target.className = `confianza-select ${confClass(value)}`;
  await saveField(id, 'confianza_dato', value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec.confianza_dato = value;
}

const CAMPOS_CONTACTO = ['whatsapp', 'email'];

async function onEditableFieldChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const field = e.target.dataset.field;
  const value = e.target.value.trim() || null;
  await saveField(id, field, value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec[field] = value;
  if (field === 'provincia') populateFilterOptions();
  if (CAMPOS_CONTACTO.includes(field)) renderTable();
}

async function onRubroChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const group = e.target.closest('.rubro-group');
  const seleccionados = [...group.querySelectorAll('.rubro-checkbox:checked')].map((cb) => cb.value);
  const value = seleccionados.length ? seleccionados.join(', ') : null;
  await saveField(id, 'rubro', value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec.rubro = value;
}

async function onVendedorSelectChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const value = e.target.value;
  if (value === '__otro__') {
    state.vendedorOtro.add(Number(id));
    renderTable();
    return;
  }
  state.vendedorOtro.delete(Number(id));
  await saveField(id, 'vendedor', value || null, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec.vendedor = value || null;
  populateFilterOptions();
}

async function onTelefonoChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const group = e.target.closest('.telefono-group');
  const valores = [...group.querySelectorAll('.telefono-input')].map((i) => i.value.trim()).filter(Boolean);
  const value = valores.length ? valores.join(', ') : null;
  await saveField(id, 'telefono', value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec.telefono = value;
  renderTable();
}

function onAddTelefono(e) {
  const btn = e.target;
  const row = document.createElement('div');
  row.className = 'contacto-row telefono-row';
  row.innerHTML = '<input type="text" class="contacto-input telefono-input" value="" placeholder="Teléfono" />';
  btn.parentElement.insertBefore(row, btn);
  const input = row.querySelector('.telefono-input');
  input.addEventListener('blur', onTelefonoChange);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });
  input.focus();
}

// El rol "facturacion" es para tareas de back-office (cargar facturas,
// producción, recuento) sin tocar los datos de relación del cliente — a
// diferencia de "ventas", que sí necesita poder actualizarlos. Esto es un
// límite del lado del cliente, no hay RLS de por medio (mismo criterio que el
// resto de la base: protegido por el login del sitio, no por la base) — pero
// alcanza para el caso de uso real (evitar ediciones accidentales/fuera de
// tarea, no defenderse de alguien que abre la consola a propósito).
function esSoloLecturaClientes() {
  return state.currentUserRol === 'facturacion';
}

async function saveField(id, field, value, targetEl) {
  if (esSoloLecturaClientes()) {
    alert('Tu usuario no puede modificar datos de clientes.');
    return;
  }
  const { error } = await client.from('clientes').update({ [field]: value }).eq('id', id);
  if (error) {
    console.error('Error guardando', field, error);
    alert('No se pudo guardar el cambio: ' + error.message);
    return;
  }
  const indicator = targetEl.closest('td')?.querySelector('.save-indicator');
  if (indicator) {
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 1200);
  }
}

els.search.addEventListener('input', (e) => {
  state.filters.q = e.target.value;
  applyFilters();
});
els.segmento.addEventListener('change', (e) => {
  state.filters.segmento = e.target.value;
  applyFilters();
});
els.provincia.addEventListener('change', (e) => {
  state.filters.provincia = e.target.value;
  applyFilters();
});
els.localidad.addEventListener('change', (e) => {
  state.filters.localidad = e.target.value;
  applyFilters();
});
els.confianza.addEventListener('change', (e) => {
  state.filters.confianza = e.target.value;
  applyFilters();
});
els.estado.addEventListener('change', (e) => {
  state.filters.estado = e.target.value;
  applyFilters();
});
els.rubro.addEventListener('change', (e) => {
  state.filters.rubro = e.target.value;
  applyFilters();
});
els.vendedor.addEventListener('change', (e) => {
  state.filters.vendedor = e.target.value;
  applyFilters();
});
els.canalCaptacion.addEventListener('change', (e) => {
  state.filters.canalCaptacion = e.target.value;
  applyFilters();
});
els.prevBtn.addEventListener('click', () => {
  state.page -= 1;
  renderTable();
});
els.nextBtn.addEventListener('click', () => {
  state.page += 1;
  renderTable();
});
els.btnNuevoCliente.addEventListener('click', openNuevoClienteModal);
els.btnCancelarNuevoCliente.addEventListener('click', closeNuevoClienteModal);
els.modalOverlay.addEventListener('click', (e) => {
  if (e.target === els.modalOverlay) closeNuevoClienteModal();
});
els.formNuevoCliente.addEventListener('submit', onSubmitNuevoCliente);

async function loadUser() {
  try {
    const res = await fetch('/api/me');
    const me = await res.json();
    if (me.user) {
      state.currentUser = me.user;
      state.currentUserRol = me.rol;
      state.currentUserNombre = me.nombre || me.user;
      actualizarSubtitulo();
    }
  } catch (err) {
    console.error('No se pudo obtener el usuario', err);
  }
}

// Se espera loadUser() antes de loadData() para saber el rol (y así si hay
// que renderizar en modo solo-lectura) antes del primer renderTable() — si
// corrieran en paralelo, un usuario restringido podía ver la tabla editable
// por un instante hasta que se supiera su rol.
(async () => {
  await loadUser();
  loadData();
})();
