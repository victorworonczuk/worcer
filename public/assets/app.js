const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const PAGE_SIZE = 50;

const state = {
  all: [],
  filtered: [],
  page: 1,
  filters: { q: '', segmento: '', provincia: '', confianza: '', estado: '', soloVencidos: false },
  facturasByCliente: new Map(),
  openFacturas: new Set(),
  interaccionesByCliente: new Map(),
  openHistorial: new Set(),
  currentUser: null,
  currentUserRol: null,
};

const CANAL_LABEL = { llamado: '☎ Llamado', whatsapp: 'WhatsApp', email: 'Email', otro: 'Otro' };
const RESULTADO_LABEL = { contactado: 'Contactado', recuperado: 'Recuperado', descartado: 'Descartado' };

const PROVINCIAS = [
  'Bs As', 'Capital', 'Catamarca', 'Chaco', 'Corrientes', 'Córdoba', 'Entre Ríos', 'Formosa',
  'Jujuy', 'La Pampa', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan',
  'San Luis', 'Santa Cruz', 'Santa Fe', 'Sgo Estero', 'T.Fuego', 'Tucumán',
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
  confianza: document.getElementById('f-confianza'),
  estado: document.getElementById('f-estado'),
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

async function loadData() {
  els.tbody.innerHTML = `<tr><td colspan="10" class="loading">Cargando clientes…</td></tr>`;
  const { data, error } = await client
    .from('clientes')
    .select('*')
    .order('segmento', { ascending: true })
    .order('usd_total_2025_2026', { ascending: false, nullsFirst: false })
    .limit(2000);

  if (error) {
    els.tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Error cargando datos: ${error.message}</td></tr>`;
    console.error(error);
    return;
  }
  state.all = data;

  const { data: facturas, error: facturasError } = await client
    .from('facturas')
    .select('cliente_id, fecha, empresa, mes, importe_ars, importe_usd')
    .not('cliente_id', 'is', null)
    .order('fecha', { ascending: false })
    .limit(3000);

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

  const { data: interacciones, error: interaccionesError } = await client
    .from('interacciones')
    .select('id, cliente_id, usuario, canal, resultado, nota, created_at')
    .order('created_at', { ascending: false })
    .limit(3000);

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
}

function renderStats() {
  const total = state.all.length;
  const segCounts = {};
  const estadoCounts = {};
  let conContacto = 0;
  let vencidos = 0;
  for (const r of state.all) {
    const seg = (r.segmento || '?').trim()[0];
    segCounts[seg] = (segCounts[seg] || 0) + 1;
    const est = r.estado_contacto || 'pendiente';
    estadoCounts[est] = (estadoCounts[est] || 0) + 1;
    if (r.telefono || r.whatsapp || r.email) conContacto += 1;
    if (esVencido(proximoSeguimientoDe(r.id))) vencidos += 1;
  }

  const cards = [
    { label: 'Total clientes', value: total },
    { label: 'Con dato de contacto', value: conContacto },
    { label: '📅 Seguimientos vencidos', value: vencidos, id: 'card-vencidos', special: true },
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
        `<div class="stat-card${c.special ? ' stat-card-clickable' : ''}${state.filters.soloVencidos && c.id === 'card-vencidos' ? ' active' : ''}" ${c.id ? `id="${c.id}"` : ''}><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`
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
}

function applyFilters() {
  const { q, segmento, provincia, confianza, estado, soloVencidos } = state.filters;
  const qLower = q.trim().toLowerCase();

  state.filtered = state.all.filter((r) => {
    if (segmento && !(r.segmento || '').startsWith(segmento)) return false;
    if (provincia && r.provincia !== provincia) return false;
    if (confianza && r.confianza_dato !== confianza) return false;
    if (estado && (r.estado_contacto || 'pendiente') !== estado) return false;
    if (soloVencidos && !esVencido(proximoSeguimientoDe(r.id))) return false;
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
    els.tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No hay clientes que coincidan con estos filtros.</td></tr>`;
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
  els.tbody.querySelectorAll('.ubicacion-select').forEach((sel) => {
    sel.addEventListener('change', onUbicacionChange);
  });
  els.tbody.querySelectorAll('.ubicacion-input').forEach((input) => {
    input.addEventListener('blur', onUbicacionChange);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
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
  els.tbody.querySelectorAll('.copy-message').forEach((btn) => {
    btn.addEventListener('click', onCopyMessage);
  });
  els.tbody.querySelectorAll('.send-email').forEach((btn) => {
    btn.addEventListener('click', onSendEmail);
  });
  els.tbody.querySelectorAll('.delete-cliente').forEach((btn) => {
    btn.addEventListener('click', onDeleteCliente);
  });
}

async function onCopyMessage(e) {
  const id = Number(e.target.dataset.id);
  const rec = state.all.find((r) => r.id === id);
  if (!rec) return;
  const text = buildMessage(rec);
  try {
    await navigator.clipboard.writeText(text);
    const original = e.target.textContent;
    e.target.textContent = '✓ Copiado';
    setTimeout(() => {
      e.target.textContent = original;
    }, 1500);
  } catch (err) {
    console.error('No se pudo copiar', err);
    alert(text);
  }
}

function facturasDetailHtml(r) {
  const facturas = state.facturasByCliente.get(r.id) || [];
  if (facturas.length === 0) {
    return `<tr class="factura-detail-row"><td colspan="10">Sin facturas registradas.</td></tr>`;
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
      <td colspan="10">
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
      </tr>`
    )
    .join('');

  return `
    <tr class="historial-detail-row">
      <td colspan="10">
        <div class="historial-form">
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
        </div>
        ${
          filas
            ? `<table class="historial-table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Canal</th><th>Resultado</th><th>Nota</th><th>Próximo seguimiento</th></tr></thead>
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

async function onGuardarInteraccion(e) {
  const id = Number(e.target.dataset.id);
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

function contactLinks(r) {
  const links = [];
  if (r.telefono) links.push(`<a href="tel:${r.telefono.replace(/[^0-9+]/g, '')}">☎ ${escapeHtml(r.telefono)}</a>`);
  if (r.whatsapp) {
    const num = r.whatsapp.replace(/[^0-9]/g, '');
    const text = encodeURIComponent(buildMessage(r));
    links.push(`<a href="https://wa.me/${num}?text=${text}" target="_blank" rel="noopener">WhatsApp</a>`);
  }
  if (r.email) {
    links.push(`<a href="mailto:${r.email}">${escapeHtml(r.email)}</a>`);
    links.push(`<button type="button" class="send-email" data-id="${r.id}">✉ Enviar email</button>`);
  }
  if (r.web) links.push(`<a href="${r.web.startsWith('http') ? r.web : 'https://' + r.web}" target="_blank" rel="noopener">Web/redes</a>`);
  links.push(`<button type="button" class="copy-message" data-id="${r.id}">📋 Copiar mensaje</button>`);
  if (links.length > 1) return links.join('<br>');
  const esDormido = (r.segmento || '').trim().startsWith('F');
  const sinDatos = esDormido
    ? '<span class="none">Sin datos</span>'
    : '<span class="none">Pendiente: exportar de tu sistema de facturación</span>';
  return `${sinDatos}<br>${links[0]}`;
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
        <strong>${escapeHtml(r.nombre)}</strong>
        <span class="cuit">${escapeHtml(r.cuit || '')}</span>
        <button type="button" class="delete-cliente" data-id="${r.id}" title="Eliminar cliente">🗑 Eliminar</button>
      </td>
      <td class="ubicacion-cell">
        <select class="ubicacion-select" data-field="provincia">
          <option value="">Sin provincia</option>
          ${PROVINCIAS.map((p) => `<option value="${p}" ${r.provincia === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input type="text" class="ubicacion-input" data-field="localidad" value="${escapeHtml(r.localidad || '')}" placeholder="Localidad" />
        <span class="save-indicator">✓</span>
      </td>
      <td><span class="badge ${segClass(r.segmento)}">${segLabel}</span></td>
      <td><span class="badge ${confClass(r.confianza_dato)}">${escapeHtml(r.confianza_dato || 'sin_datos')}</span></td>
      <td class="contact-links">${contactLinks(r)}</td>
      <td>${escapeHtml(r.rubro || '')}</td>
      <td class="desc-cell">${escapeHtml(r.descripcion || '')}</td>
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

async function onUbicacionChange(e) {
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const field = e.target.dataset.field;
  const value = e.target.value.trim() || null;
  await saveField(id, field, value, e.target);
  const rec = state.all.find((r) => String(r.id) === String(id));
  if (rec) rec[field] = value;
  if (field === 'provincia') populateFilterOptions();
}

async function saveField(id, field, value, targetEl) {
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
els.confianza.addEventListener('change', (e) => {
  state.filters.confianza = e.target.value;
  applyFilters();
});
els.estado.addEventListener('change', (e) => {
  state.filters.estado = e.target.value;
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
      const subtitle = document.getElementById('user-subtitle');
      subtitle.textContent = `Sesión: ${me.nombre || me.user} · Base histórica y activa unificada — 873 registros`;
    }
  } catch (err) {
    console.error('No se pudo obtener el usuario', err);
  }
}

loadUser();
loadData();
