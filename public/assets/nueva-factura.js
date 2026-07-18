const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const LINEA_CONFIG = {
  Ceramica: { empresa: 'Ceramica', tipo_comprobante: 'F A' },
  Porcelanas: { empresa: 'Porcelanas', tipo_comprobante: 'F A' },
  Presupuesto: { empresa: 'Presupuesto', tipo_comprobante: 'Remito X' },
};

const state = {
  currentUser: null,
  clientes: [],
  clienteSeleccionado: null,
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
  usd: document.getElementById('usd-input'),
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

  const { data, error } = await client.from('clientes').select('id, cuit, nombre').limit(2000);
  if (!error) state.clientes = data;

  loadRecientes();
}

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

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';

  const nombreInput = els.clienteInput.value.trim();
  const lineaEl = document.querySelector('input[name="linea"]:checked');
  const fecha = els.fecha.value;
  const ars = els.ars.value ? Number(els.ars.value) : null;
  const usd = els.usd.value ? Number(els.usd.value) : null;

  if (!nombreInput || !lineaEl || !fecha || !ars) {
    els.formError.textContent = 'Completá cliente, línea, fecha e importe.';
    return;
  }

  if (!state.clienteSeleccionado) {
    els.clienteSelected.textContent = '⚠ Cliente no vinculado a la base — se carga solo con el nombre escrito';
    els.clienteSelected.className = 'selected-hint warn';
  }

  const linea = LINEA_CONFIG[lineaEl.value];
  const mesIdx = new Date(fecha + 'T00:00:00').getMonth();
  const nombreFacturado = state.clienteSeleccionado ? state.clienteSeleccionado.nombre : nombreInput;
  const cuitOriginal = state.clienteSeleccionado ? state.clienteSeleccionado.cuit : null;
  const cuitNormalizado = cuitOriginal ? cuitOriginal.replace(/[^0-9]/g, '') : null;

  const payload = {
    cuit_normalizado: cuitNormalizado,
    cuit_original: cuitOriginal,
    nombre_facturado: nombreFacturado,
    empresa: linea.empresa,
    fecha,
    mes: MESES[mesIdx],
    tipo_comprobante: linea.tipo_comprobante,
    numero_comprobante: els.numero.value.trim() || null,
    importe_ars: ars,
    importe_usd: usd,
    tipo_cambio: usd ? Number((ars / usd).toFixed(4)) : null,
    cliente_id: state.clienteSeleccionado ? state.clienteSeleccionado.id : null,
    cargado_por: state.currentUser,
  };

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Cargando...';

  const { error } = await client.from('facturas').insert(payload);

  els.submitBtn.disabled = false;
  els.submitBtn.textContent = 'Cargar factura';

  if (error) {
    els.formError.textContent = 'Error al guardar: ' + error.message;
    return;
  }

  els.form.reset();
  els.fecha.value = new Date().toISOString().slice(0, 10);
  state.clienteSeleccionado = null;
  els.clienteId.value = '';
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
