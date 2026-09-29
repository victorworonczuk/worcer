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

const RUBROS_PROVEEDOR = [
  'Materia prima',
  'Insumos y repuestos',
  'Transporte / Fletes',
  'Servicios',
  'Mantenimiento',
  'Combustible',
  'Maquinaria y herramientas',
  'Otros',
];

const state = {
  currentUser: null,
  proveedores: [],
  comprasByProveedor: new Map(), // proveedor_id -> [compra, ...]
  comprasFlat: [], // todas las compras con el proveedor ya embebido, para el buscador de artículos
  openHistorial: new Set(),
  search: '',
  busquedaArticulo: '',
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  search: document.getElementById('f-search'),
  contador: document.getElementById('contador'),
  tbody: document.getElementById('tbody'),
  btnNuevo: document.getElementById('btn-nuevo-proveedor'),
  modalOverlay: document.getElementById('modal-overlay'),
  formNuevo: document.getElementById('form-nuevo-proveedor'),
  btnCancelar: document.getElementById('btn-cancelar'),
  formError: document.getElementById('form-error'),
  busquedaArticulo: document.getElementById('f-busqueda-articulo'),
  wrapBusquedaArticulo: document.getElementById('wrap-busqueda-articulo'),
  tbodyBusquedaArticulo: document.getElementById('tbody-busqueda-articulo'),
};

function fmtPesos(n) { return n == null ? '·' : '$' + Math.round(Number(n)).toLocaleString('es-AR'); }
function fmtFecha(f) { return f ? new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Sin acentos y en minúscula, para que buscar "arcilla" encuentre "Arcilla" y
// "teflon" encuentre "teflón" (pedido de Víctor 29/09/26: cualquiera de la
// oficina tiene que poder encontrarlo escribiendo como le salga).
function sinAcentos(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Si el rubro actual no está en la lista fija (ej. algo tipeado antes de que
// existiera este select), se agrega igual como opción para no perder el dato.
function rubroOptionsHtml(valorActual) {
  const opciones = RUBROS_PROVEEDOR.includes(valorActual) || !valorActual
    ? RUBROS_PROVEEDOR
    : [...RUBROS_PROVEEDOR, valorActual];
  return '<option value="">—</option>' + opciones
    .map((r) => `<option value="${escapeHtml(r)}" ${r === valorActual ? 'selected' : ''}>${escapeHtml(r)}</option>`)
    .join('');
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  state.currentUser = me.user;
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargarDatos() {
  const [{ data: proveedores, error: e1 }, { data: compras, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('proveedores').select('id, nombre, cuit, rubro, telefono, email, localidad').order('nombre', { ascending: true }).order('id', { ascending: true })),
    fetchAll(() => client.from('compras_proveedor').select('id, proveedor_id, fecha, descripcion, monto').order('fecha', { ascending: false }).order('id', { ascending: true })),
  ]);
  if (e1 || e2) {
    els.tbody.innerHTML = `<tr><td class="empty-state" colspan="6">Error al cargar: ${(e1 || e2).message}</td></tr>`;
    return;
  }
  state.proveedores = proveedores || [];
  state.comprasByProveedor = new Map();
  const proveedorPorId = new Map(state.proveedores.map((p) => [p.id, p]));
  state.comprasFlat = [];
  for (const c of (compras || [])) {
    const lista = state.comprasByProveedor.get(c.proveedor_id) || [];
    lista.push(c);
    state.comprasByProveedor.set(c.proveedor_id, lista);
    state.comprasFlat.push({ ...c, proveedor: proveedorPorId.get(c.proveedor_id) || null });
  }
  render();
  renderBusquedaArticulo();
}

function renderBusquedaArticulo() {
  const q = sinAcentos(state.busquedaArticulo.trim());
  if (!q) {
    els.wrapBusquedaArticulo.hidden = true;
    els.tbodyBusquedaArticulo.innerHTML = '';
    return;
  }
  els.wrapBusquedaArticulo.hidden = false;

  const resultados = state.comprasFlat
    .filter((c) => sinAcentos(c.descripcion).includes(q) || sinAcentos(c.proveedor?.nombre).includes(q) || sinAcentos(c.proveedor?.rubro).includes(q))
    .slice(0, 150); // ya vienen ordenadas por fecha desc desde cargarDatos

  els.tbodyBusquedaArticulo.innerHTML = resultados.length
    ? resultados.map((c) => `
        <tr>
          <td>${fmtFecha(c.fecha)}</td>
          <td class="col-grupo">${escapeHtml(c.descripcion || '')}</td>
          <td class="col-grupo">${escapeHtml(c.proveedor?.nombre || '(proveedor eliminado)')}</td>
          <td class="col-grupo">${escapeHtml(c.proveedor?.telefono || '')} ${escapeHtml(c.proveedor?.email || '')}</td>
          <td>${fmtPesos(c.monto)}</td>
        </tr>
      `).join('')
    : '<tr><td class="empty-state" colspan="5">Sin resultados para esa búsqueda.</td></tr>';
}

function coincide(p, q) {
  if (!q) return true;
  const texto = `${p.nombre} ${p.cuit || ''} ${p.rubro || ''} ${p.localidad || ''}`.toLowerCase();
  return texto.includes(q.toLowerCase());
}

function render() {
  const filtrados = state.proveedores.filter((p) => coincide(p, state.search));
  els.contador.textContent = `${filtrados.length} proveedor(es)`;

  if (filtrados.length === 0) {
    els.tbody.innerHTML = '<tr><td class="empty-state" colspan="6">Sin proveedores todavía — usá "+ Nuevo proveedor" para cargar el primero.</td></tr>';
    return;
  }

  let html = '';
  for (const p of filtrados) {
    const compras = state.comprasByProveedor.get(p.id) || [];
    const abierto = state.openHistorial.has(p.id);
    html += `
      <tr data-proveedor="${p.id}">
        <td class="col-grupo"><input type="text" class="contacto-input" data-field="nombre" data-id="${p.id}" value="${escapeHtml(p.nombre)}" /></td>
        <td><input type="text" class="contacto-input" data-field="cuit" data-id="${p.id}" value="${escapeHtml(p.cuit || '')}" placeholder="CUIT" /></td>
        <td><select class="contacto-input" data-field="rubro" data-id="${p.id}">${rubroOptionsHtml(p.rubro)}</select></td>
        <td class="col-grupo">
          <input type="text" class="contacto-input" data-field="telefono" data-id="${p.id}" value="${escapeHtml(p.telefono || '')}" placeholder="Teléfono" />
          <input type="email" class="contacto-input" data-field="email" data-id="${p.id}" value="${escapeHtml(p.email || '')}" placeholder="Email" />
        </td>
        <td><input type="text" class="contacto-input" data-field="localidad" data-id="${p.id}" value="${escapeHtml(p.localidad || '')}" placeholder="Localidad" /></td>
        <td><button type="button" class="toggle-historial" data-id="${p.id}">${abierto ? 'Ocultar' : 'Compras'} (${compras.length})</button></td>
      </tr>`;
    if (abierto) html += historialComprasHtml(p, compras);
  }
  els.tbody.innerHTML = html;
  wireRowEvents();
}

function historialComprasHtml(p, compras) {
  const filas = compras.map((c) => `
    <tr>
      <td>${fmtFecha(c.fecha)}</td>
      <td>${escapeHtml(c.descripcion || '')}</td>
      <td>${fmtPesos(c.monto)}</td>
      <td><button type="button" class="eliminar-compra" data-compra="${c.id}">✕</button></td>
    </tr>`).join('');
  return `
    <tr class="historial-detail-row">
      <td colspan="6">
        <div class="historial-detail">
          <table class="pivot">
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Monto</th><th></th></tr></thead>
            <tbody>${filas || '<tr><td class="empty-state" colspan="4">Sin compras cargadas.</td></tr>'}</tbody>
          </table>
          <div class="nueva-compra-form">
            <input type="date" class="nc-fecha" value="${new Date().toISOString().slice(0, 10)}" />
            <input type="text" class="nc-descripcion" placeholder="Descripción" />
            <input type="number" step="0.01" class="nc-monto" placeholder="Monto $" />
            <button type="button" class="guardar-compra" data-proveedor="${p.id}">Agregar compra</button>
          </div>
        </div>
      </td>
    </tr>`;
}

async function saveField(id, field, value) {
  const { error } = await client.from('proveedores').update({ [field]: value || null }).eq('id', id);
  if (error) alert(`No se pudo guardar: ${error.message}`);
  const p = state.proveedores.find((x) => x.id === id);
  if (p) p[field] = value || null;
}

function wireRowEvents() {
  els.tbody.querySelectorAll('.contacto-input').forEach((input) => {
    // 'change' para el <select> de rubro (guarda apenas se elige una
    // opción); 'blur' para los <input> de texto (guarda al salir del campo).
    const evento = input.tagName === 'SELECT' ? 'change' : 'blur';
    input.addEventListener(evento, (e) => {
      const id = Number(e.target.dataset.id);
      saveField(id, e.target.dataset.field, e.target.value.trim());
    });
  });

  els.tbody.querySelectorAll('.toggle-historial').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = Number(e.target.dataset.id);
      if (state.openHistorial.has(id)) state.openHistorial.delete(id);
      else state.openHistorial.add(id);
      render();
    });
  });

  els.tbody.querySelectorAll('.guardar-compra').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const proveedorId = Number(e.target.dataset.proveedor);
      const row = e.target.closest('.historial-detail');
      const fecha = row.querySelector('.nc-fecha').value;
      const descripcion = row.querySelector('.nc-descripcion').value.trim();
      const monto = row.querySelector('.nc-monto').value;
      if (!fecha) { alert('Elegí una fecha.'); return; }
      e.target.disabled = true;
      const { error } = await client.from('compras_proveedor').insert({
        proveedor_id: proveedorId,
        fecha,
        descripcion: descripcion || null,
        monto: monto ? Number(monto) : null,
        cargado_por: state.currentUser,
      });
      e.target.disabled = false;
      if (error) { alert(`No se pudo guardar: ${error.message}`); return; }
      await cargarDatos();
    });
  });

  els.tbody.querySelectorAll('.eliminar-compra').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      if (!confirm('¿Eliminar esta compra?')) return;
      const compraId = Number(e.target.dataset.compra);
      const { error } = await client.from('compras_proveedor').delete().eq('id', compraId);
      if (error) { alert(`No se pudo eliminar: ${error.message}`); return; }
      await cargarDatos();
    });
  });
}

els.search.addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});

els.busquedaArticulo.addEventListener('input', (e) => {
  state.busquedaArticulo = e.target.value;
  renderBusquedaArticulo();
});

els.btnNuevo.addEventListener('click', () => {
  els.formNuevo.reset();
  document.getElementById('np-rubro').innerHTML = rubroOptionsHtml('');
  els.formError.textContent = '';
  els.modalOverlay.classList.remove('hidden');
});
els.btnCancelar.addEventListener('click', () => els.modalOverlay.classList.add('hidden'));
els.modalOverlay.addEventListener('click', (e) => {
  if (e.target === els.modalOverlay) els.modalOverlay.classList.add('hidden');
});

els.formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';
  const nombre = document.getElementById('np-nombre').value.trim();
  if (!nombre) { els.formError.textContent = 'Falta el nombre.'; return; }

  const nuevo = {
    nombre,
    cuit: document.getElementById('np-cuit').value.trim() || null,
    rubro: document.getElementById('np-rubro').value.trim() || null,
    localidad: document.getElementById('np-localidad').value.trim() || null,
    telefono: document.getElementById('np-telefono').value.trim() || null,
    email: document.getElementById('np-email').value.trim() || null,
    cargado_por: state.currentUser,
  };

  const submitBtn = els.formNuevo.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { error } = await client.from('proveedores').insert(nuevo);
  submitBtn.disabled = false;
  if (error) { els.formError.textContent = `No se pudo guardar: ${error.message}`; return; }

  els.modalOverlay.classList.add('hidden');
  await cargarDatos();
});

(async () => {
  await initUser();
  await cargarDatos();
})();
