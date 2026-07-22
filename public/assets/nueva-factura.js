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

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const EMPRESA_CONFIG = {
  Ceramica: { empresa: 'Ceramica', tipo_comprobante: 'F A' },
  Porcelanas: { empresa: 'Porcelanas', tipo_comprobante: 'F A' },
  Presupuesto: { empresa: 'Presupuesto', tipo_comprobante: 'Remito X' },
};

const CALIDAD_LABEL = { '1era': '1ª', comercial: 'Comercial', '3era': '3ª' };

const state = {
  currentUser: null,
  clientes: [],
  clienteSeleccionado: null,
  piezas: [],
  piezasPorLinea: new Map(),
  lineasDisponibles: [],
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  clienteInput: document.getElementById('cliente-input'),
  clienteId: document.getElementById('cliente-id'),
  clienteSelected: document.getElementById('cliente-selected'),
  suggestions: document.getElementById('cliente-suggestions'),
  fecha: document.getElementById('fecha-input'),
  numero: document.getElementById('numero-input'),
  ars: document.getElementById('ars-input'),
  arsHint: document.getElementById('ars-hint'),
  usd: document.getElementById('usd-input'),
  piezasRows: document.getElementById('piezas-rows'),
  addPiezaBtn: document.getElementById('add-pieza-btn'),
  form: document.getElementById('factura-form'),
  formError: document.getElementById('form-error'),
  submitBtn: document.getElementById('submit-btn'),
  recientesList: document.getElementById('recientes-list'),
};

async function init() {
  const meRes = await fetch('/api/me');
  const me = await meRes.json();
  if (!me.user) {
    window.location.href = '/login';
    return;
  }
  state.currentUser = me.user;
  els.userSubtitle.textContent = `Sesión: ${me.user}`;

  els.fecha.value = new Date().toISOString().slice(0, 10);

  const { data: clientesData, error: clientesError } = await fetchAll(() => client.from('clientes').select('id, cuit, nombre'));
  if (!clientesError) state.clientes = clientesData;

  const { data: piezasData, error: piezasError } = await client
    .from('piezas')
    .select('id, linea, tipo_pieza, variante, calidad, precio_ars')
    .eq('activo', true);
  if (!piezasError) {
    state.piezas = piezasData;
    state.lineasDisponibles = [...new Set(piezasData.map((p) => p.linea))].sort();
    state.piezasPorLinea = new Map();
    for (const p of piezasData) {
      const list = state.piezasPorLinea.get(p.linea) || [];
      list.push(p);
      state.piezasPorLinea.set(p.linea, list);
    }
  }

  addPiezaRow();
  loadRecientes();
}

// --- Autocompletar cliente ---

els.clienteInput.addEventListener('input', () => {
  state.clienteSeleccionado = null;
  els.clienteId.value = '';
  els.clienteSelected.textContent = '';
  els.clienteSelected.className = 'selected-hint';

  const q = els.clienteInput.value.trim().toLowerCase();
  if (q.length < 2) {
    els.suggestions.classList.remove('show');
    return;
  }
  const matches = state.clientes
    .filter((c) => (c.nombre || '').toLowerCase().includes(q) || (c.cuit || '').toLowerCase().includes(q))
    .slice(0, 8);

  if (matches.length === 0) {
    els.suggestions.classList.remove('show');
    return;
  }
  els.suggestions.innerHTML = matches
    .map((c) => `<div class="suggestion-item" data-id="${c.id}">${escapeHtml(c.nombre)}<br><span class="cuit">${escapeHtml(c.cuit || 'sin CUIT')}</span></div>`)
    .join('');
  els.suggestions.classList.add('show');

  els.suggestions.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = Number(item.dataset.id);
      const c = state.clientes.find((x) => x.id === id);
      state.clienteSeleccionado = c;
      els.clienteId.value = c.id;
      els.clienteInput.value = c.nombre;
      els.clienteSelected.textContent = `✓ Cliente vinculado (${c.cuit || 'sin CUIT'})`;
      els.clienteSelected.className = 'selected-hint';
      els.suggestions.classList.remove('show');
    });
  });
});

document.addEventListener('click', (e) => {
  if (!els.suggestions.contains(e.target) && e.target !== els.clienteInput) {
    els.suggestions.classList.remove('show');
  }
});

// --- Filas de piezas vendidas (dinámicas) ---

function piezaLabel(p) {
  const variante = p.variante ? ` (${p.variante})` : '';
  return `${p.tipo_pieza}${variante} — ${CALIDAD_LABEL[p.calidad] || p.calidad}`;
}

function addPiezaRow() {
  const row = document.createElement('div');
  row.className = 'pieza-row';

  const lineaSelect = document.createElement('select');
  lineaSelect.className = 'pieza-linea-select';
  lineaSelect.innerHTML =
    '<option value="">Línea...</option>' + state.lineasDisponibles.map((l) => `<option value="${l}">${l}</option>`).join('');

  const piezaSelect = document.createElement('select');
  piezaSelect.className = 'pieza-select';
  piezaSelect.innerHTML = '<option value="">Elegí una línea primero</option>';
  piezaSelect.disabled = true;

  const cantidadInput = document.createElement('input');
  cantidadInput.type = 'number';
  cantidadInput.min = '1';
  cantidadInput.step = '1';
  cantidadInput.placeholder = 'Cant.';
  cantidadInput.className = 'pieza-cantidad';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-pieza-btn';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Quitar esta pieza';
  removeBtn.addEventListener('click', () => row.remove());

  lineaSelect.addEventListener('change', () => {
    const opciones = state.piezasPorLinea.get(lineaSelect.value) || [];
    if (opciones.length === 0) {
      piezaSelect.innerHTML = '<option value="">Sin piezas para esta línea</option>';
      piezaSelect.disabled = true;
      return;
    }
    piezaSelect.innerHTML =
      '<option value="">Elegí pieza y calidad...</option>' +
      opciones.map((p) => `<option value="${p.id}">${escapeHtml(piezaLabel(p))}</option>`).join('');
    piezaSelect.disabled = false;
    recalcularImporteAutomatico();
  });
  piezaSelect.addEventListener('change', recalcularImporteAutomatico);
  cantidadInput.addEventListener('input', recalcularImporteAutomatico);
  removeBtn.addEventListener('click', () => setTimeout(recalcularImporteAutomatico, 0));

  row.appendChild(lineaSelect);
  row.appendChild(piezaSelect);
  row.appendChild(cantidadInput);
  row.appendChild(removeBtn);
  els.piezasRows.appendChild(row);
}

els.addPiezaBtn.addEventListener('click', addPiezaRow);

function recalcularImporteAutomatico() {
  const items = recolectarPiezasSeleccionadas();
  if (items.length === 0) {
    els.arsHint.textContent = '';
    els.arsHint.className = 'ars-hint';
    return;
  }

  let total = 0;
  let faltaPrecio = false;
  for (const it of items) {
    const pieza = state.piezas.find((p) => p.id === it.pieza_id);
    if (!pieza || pieza.precio_ars == null) {
      faltaPrecio = true;
      continue;
    }
    total += Number(pieza.precio_ars) * it.cantidad;
  }

  els.ars.value = total.toFixed(2);
  if (faltaPrecio) {
    els.arsHint.textContent = '⚠ Alguna pieza no tiene precio cargado — el total puede estar incompleto. Revisalo.';
    els.arsHint.className = 'ars-hint warn';
  } else {
    els.arsHint.textContent = `Calculado automáticamente desde las piezas cargadas (podés ajustarlo a mano si hace falta).`;
    els.arsHint.className = 'ars-hint';
  }
}

function recolectarPiezasSeleccionadas() {
  const items = [];
  els.piezasRows.querySelectorAll('.pieza-row').forEach((row) => {
    const piezaSelect = row.querySelector('.pieza-select');
    const cantidadInput = row.querySelector('.pieza-cantidad');
    const piezaId = piezaSelect.value ? Number(piezaSelect.value) : null;
    const cantidad = cantidadInput.value ? Number(cantidadInput.value) : null;
    if (piezaId && cantidad && cantidad > 0) {
      const pieza = state.piezas.find((p) => p.id === piezaId);
      items.push({ pieza_id: piezaId, cantidad, precio_unitario: pieza ? pieza.precio_ars : null });
    }
  });
  return items;
}

function resetPiezasRows() {
  els.piezasRows.innerHTML = '';
  addPiezaRow();
  els.arsHint.textContent = '';
  els.arsHint.className = 'ars-hint';
}

// --- Envío del formulario ---

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';

  const nombreInput = els.clienteInput.value.trim();
  const empresaEl = document.querySelector('input[name="empresa"]:checked');
  const fecha = els.fecha.value;
  const ars = els.ars.value ? Number(els.ars.value) : null;
  const usd = els.usd.value ? Number(els.usd.value) : null;
  const piezasSeleccionadas = recolectarPiezasSeleccionadas();

  if (!nombreInput || !empresaEl || !fecha || !ars) {
    els.formError.textContent = 'Completá cliente, empresa, fecha e importe.';
    return;
  }

  if (!state.clienteSeleccionado) {
    els.clienteSelected.textContent = '⚠ Cliente no vinculado a la base — se carga solo con el nombre escrito';
    els.clienteSelected.className = 'selected-hint warn';
  }

  const empresaCfg = EMPRESA_CONFIG[empresaEl.value];
  const mesIdx = new Date(fecha + 'T00:00:00').getMonth();
  const nombreFacturado = state.clienteSeleccionado ? state.clienteSeleccionado.nombre : nombreInput;
  const cuitOriginal = state.clienteSeleccionado ? state.clienteSeleccionado.cuit : null;
  const cuitNormalizado = cuitOriginal ? cuitOriginal.replace(/[^0-9]/g, '') : null;

  const payload = {
    cuit_normalizado: cuitNormalizado,
    cuit_original: cuitOriginal,
    nombre_facturado: nombreFacturado,
    empresa: empresaCfg.empresa,
    fecha,
    mes: MESES[mesIdx],
    tipo_comprobante: empresaCfg.tipo_comprobante,
    numero_comprobante: els.numero.value.trim() || null,
    importe_ars: ars,
    importe_usd: usd,
    tipo_cambio: usd ? Number((ars / usd).toFixed(4)) : null,
    cliente_id: state.clienteSeleccionado ? state.clienteSeleccionado.id : null,
    cargado_por: state.currentUser,
  };

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Cargando...';

  const { data: facturaInsertada, error } = await client.from('facturas').insert(payload).select('id').single();

  if (error) {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = 'Cargar factura';
    els.formError.textContent = 'Error al guardar: ' + error.message;
    return;
  }

  if (piezasSeleccionadas.length > 0) {
    const itemsPayload = piezasSeleccionadas.map((it) => ({ ...it, factura_id: facturaInsertada.id }));
    const { error: itemsError } = await client.from('factura_items').insert(itemsPayload);
    if (itemsError) {
      els.formError.textContent = 'La factura se guardó, pero hubo un error guardando las piezas: ' + itemsError.message;
    }
  }

  els.submitBtn.disabled = false;
  els.submitBtn.textContent = 'Cargar factura';

  els.form.reset();
  els.fecha.value = new Date().toISOString().slice(0, 10);
  state.clienteSeleccionado = null;
  els.clienteId.value = '';
  resetPiezasRows();
  els.clienteSelected.textContent = '✓ Factura cargada correctamente';
  els.clienteSelected.className = 'selected-hint';
  setTimeout(() => {
    els.clienteSelected.textContent = '';
  }, 2500);

  loadRecientes();
});

async function loadRecientes() {
  const { data, error } = await client
    .from('facturas')
    .select('nombre_facturado, empresa, importe_ars, fecha, cargado_por, created_at')
    .not('cargado_por', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    els.recientesList.innerHTML = `<div class="loading">Error: ${error.message}</div>`;
    return;
  }
  if (!data.length) {
    els.recientesList.innerHTML = '<div class="loading">Todavía no se cargó ninguna factura manualmente.</div>';
    return;
  }
  els.recientesList.innerHTML = data
    .map(
      (f) => `<div class="recientes-item">
        <div>
          <div class="nombre">${escapeHtml(f.nombre_facturado || '')}</div>
          <div class="meta">${escapeHtml(f.empresa || '')} · ${f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-AR') : ''} · cargado por ${escapeHtml(f.cargado_por || '')}</div>
        </div>
        <div class="meta">$${Number(f.importe_ars || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
      </div>`
    )
    .join('');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
