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

const ESTADO_LABEL = { pendiente: 'Pendiente', aprobado: 'Aprobado', comprado: 'Comprado', rechazado: 'Rechazado' };

const state = {
  currentUser: null,
  proveedores: [],
  solicitudes: [],
  filtroEstado: '',
  search: '',
  openDetalle: new Set(),
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  kpiGrid: document.getElementById('kpi-grid'),
  filtroEstado: document.getElementById('f-estado'),
  search: document.getElementById('f-search'),
  contador: document.getElementById('contador'),
  tbody: document.getElementById('tbody'),
  btnNueva: document.getElementById('btn-nueva-solicitud'),
  modalOverlay: document.getElementById('modal-overlay'),
  formNueva: document.getElementById('form-nueva-solicitud'),
  btnCancelar: document.getElementById('btn-cancelar'),
  formError: document.getElementById('form-error'),
  datalistProveedores: document.getElementById('proveedores-datalist'),
};

function fmtPesos(n) { return n == null ? '·' : '$' + Math.round(Number(n)).toLocaleString('es-AR'); }
function fmtFecha(f) { return f ? new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sinAcentos(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Mismo criterio que public/assets/proveedores.js — duplicado a propósito
// (convención del proyecto: cada pantalla es un script plano, sin módulos).
function capitalizarNombre(s) {
  if (!s) return s;
  return s.trim().toLowerCase().replace(/(^|[\s/-])(\S)/g, (_, sep, letra) => sep + letra.toUpperCase());
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  state.currentUser = me.nombre || me.user;
  els.userSubtitle.textContent = `Sesión: ${state.currentUser}`;
}

async function cargarDatos() {
  const [{ data: proveedores, error: e1 }, { data: solicitudes, error: e2 }] = await Promise.all([
    fetchAll(() => client.from('proveedores').select('id, nombre').order('nombre', { ascending: true }).order('id', { ascending: true })),
    fetchAll(() => client.from('solicitudes_compra')
      .select('id, estado, fecha_pedido, cantidad, descripcion, proveedor_id, proveedor_sugerido, precio_unitario, monto_total, forma_pago, fecha_necesidad, numero_factura, fecha_compra, fecha_recepcion, solicitante, supervisa, aprobado_por, compra_proveedor_id')
      .order('fecha_pedido', { ascending: false })
      .order('id', { ascending: true })),
  ]);
  if (e1 || e2) {
    els.tbody.innerHTML = `<tr><td class="empty-state" colspan="9">Error al cargar: ${(e1 || e2).message}</td></tr>`;
    return;
  }
  state.proveedores = proveedores || [];
  state.solicitudes = solicitudes || [];
  els.datalistProveedores.innerHTML = state.proveedores.map((p) => `<option value="${escapeHtml(p.nombre)}"></option>`).join('');
  renderKpis();
  render();
}

function renderKpis() {
  const hoyStr = new Date().toISOString().slice(0, 7);
  const cuenta = { pendiente: 0, aprobado: 0, comprado: 0, rechazado: 0 };
  let compradoEsteMes = 0;
  for (const s of state.solicitudes) {
    cuenta[s.estado] = (cuenta[s.estado] || 0) + 1;
    if (s.estado === 'comprado' && (s.fecha_compra || '').slice(0, 7) === hoyStr) compradoEsteMes += 1;
  }
  els.kpiGrid.innerHTML = [
    { label: 'Pendientes', value: fmt0(cuenta.pendiente), alerta: cuenta.pendiente > 0 },
    { label: 'Aprobados, falta comprar', value: fmt0(cuenta.aprobado) },
    { label: 'Comprados este mes', value: fmt0(compradoEsteMes) },
    { label: 'Rechazados', value: fmt0(cuenta.rechazado) },
  ].map((k) => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value${k.alerta ? ' kpi-alerta' : ''}">${k.value}</div>
    </div>
  `).join('');
}
function fmt0(n) { return String(n || 0); }

function coincide(s, q) {
  if (!q) return true;
  const nombreProveedor = state.proveedores.find((p) => p.id === s.proveedor_id)?.nombre || s.proveedor_sugerido || '';
  const texto = sinAcentos(`${s.descripcion} ${nombreProveedor}`);
  return texto.includes(sinAcentos(q));
}

function render() {
  const filtrados = state.solicitudes
    .filter((s) => !state.filtroEstado || s.estado === state.filtroEstado)
    .filter((s) => coincide(s, state.search));
  els.contador.textContent = `${filtrados.length} solicitud(es)`;

  if (filtrados.length === 0) {
    els.tbody.innerHTML = '<tr><td class="empty-state" colspan="9">Sin solicitudes — usá "+ Nueva solicitud" para cargar la primera.</td></tr>';
    return;
  }

  let html = '';
  for (const s of filtrados) {
    const nombreProveedor = state.proveedores.find((p) => p.id === s.proveedor_id)?.nombre || s.proveedor_sugerido || '';
    const abierto = state.openDetalle.has(s.id);
    html += `
      <tr data-solicitud="${s.id}">
        <td>${fmtFecha(s.fecha_pedido)}</td>
        <td class="col-grupo"><input type="text" class="contacto-input campo-solicitud" data-field="proveedor" data-id="${s.id}" list="proveedores-datalist" value="${escapeHtml(nombreProveedor)}" placeholder="Proveedor" /></td>
        <td class="col-grupo"><input type="text" class="contacto-input campo-solicitud" data-field="descripcion" data-id="${s.id}" value="${escapeHtml(s.descripcion || '')}" /></td>
        <td><input type="number" step="0.01" class="contacto-input campo-solicitud campo-numero" data-field="cantidad" data-id="${s.id}" value="${s.cantidad ?? ''}" /></td>
        <td><input type="number" step="0.01" class="contacto-input campo-solicitud campo-numero" data-field="precio_unitario" data-id="${s.id}" value="${s.precio_unitario ?? ''}" /></td>
        <td>${fmtPesos(s.monto_total)}</td>
        <td><input type="date" class="contacto-input campo-solicitud" data-field="fecha_necesidad" data-id="${s.id}" value="${s.fecha_necesidad || ''}" /></td>
        <td>
          <select class="contacto-input campo-solicitud estado-select estado-${s.estado}" data-field="estado" data-id="${s.id}">
            ${Object.entries(ESTADO_LABEL).map(([v, l]) => `<option value="${v}" ${v === s.estado ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </td>
        <td><button type="button" class="toggle-historial" data-id="${s.id}">${abierto ? 'Ocultar' : 'Más detalles'}</button></td>
      </tr>`;
    if (abierto) html += detalleHtml(s);
  }
  els.tbody.innerHTML = html;
  wireRowEvents();
}

function detalleHtml(s) {
  return `
    <tr class="historial-detail-row">
      <td colspan="9">
        <div class="historial-detail">
          <div class="mas-datos-form">
            <label>Forma de pago
              <input type="text" class="contacto-input campo-solicitud" data-field="forma_pago" data-id="${s.id}" value="${escapeHtml(s.forma_pago || '')}" />
            </label>
            <label>Nº Factura
              <input type="text" class="contacto-input campo-solicitud" data-field="numero_factura" data-id="${s.id}" value="${escapeHtml(s.numero_factura || '')}" />
            </label>
            <label>Fecha de compra
              <input type="date" class="contacto-input campo-solicitud" data-field="fecha_compra" data-id="${s.id}" value="${s.fecha_compra || ''}" />
            </label>
            <label>Fecha de recepción
              <input type="date" class="contacto-input campo-solicitud" data-field="fecha_recepcion" data-id="${s.id}" value="${s.fecha_recepcion || ''}" />
            </label>
            <label>Solicitante
              <input type="text" class="contacto-input campo-solicitud" data-field="solicitante" data-id="${s.id}" value="${escapeHtml(s.solicitante || '')}" />
            </label>
            <label>Supervisa
              <input type="text" class="contacto-input campo-solicitud" data-field="supervisa" data-id="${s.id}" value="${escapeHtml(s.supervisa || '')}" />
            </label>
            <label>Aprobado por
              <input type="text" class="contacto-input campo-solicitud" data-field="aprobado_por" data-id="${s.id}" value="${escapeHtml(s.aprobado_por || '')}" />
            </label>
          </div>
        </div>
      </td>
    </tr>`;
}

// Busca un proveedor existente por nombre exacto (sin acentos/mayúsculas) o
// lo da de alta si no existe — carga manual en vivo, no hace falta el
// desempate por fuerza de match que usan los imports masivos (lib/clienteMatching.js).
async function resolverProveedor(nombreEscrito) {
  const nombre = capitalizarNombre(nombreEscrito.trim());
  if (!nombre) return null;
  const existente = state.proveedores.find((p) => sinAcentos(p.nombre) === sinAcentos(nombre));
  if (existente) return existente.id;

  const { data, error } = await client.from('proveedores').insert({ nombre, cargado_por: state.currentUser }).select('id, nombre').single();
  if (error) { alert(`No se pudo crear el proveedor: ${error.message}`); return null; }
  state.proveedores.push(data);
  els.datalistProveedores.innerHTML += `<option value="${escapeHtml(data.nombre)}"></option>`;
  return data.id;
}

// Cuando una solicitud pasa a "comprado" se suma sola al historial del
// proveedor en compras_proveedor (pedido de Víctor 29/09/26) — una sola vez
// por solicitud, guardado en compra_proveedor_id para no duplicar si se
// cambia el estado para adelante y para atrás.
async function vincularComoCompra(s) {
  if (s.compra_proveedor_id) return s.compra_proveedor_id;
  let proveedorId = s.proveedor_id;
  if (!proveedorId && s.proveedor_sugerido) proveedorId = await resolverProveedor(s.proveedor_sugerido);
  if (!proveedorId) { alert('Para marcarla como "Comprado" hace falta un proveedor.'); return null; }

  const fecha = s.fecha_compra || new Date().toISOString().slice(0, 10);
  const { data, error } = await client.from('compras_proveedor').insert({
    proveedor_id: proveedorId,
    fecha,
    cantidad: s.cantidad,
    descripcion: s.descripcion,
    monto: s.monto_total,
    cargado_por: state.currentUser,
  }).select('id').single();
  if (error) { alert(`No se pudo cargar la compra en el proveedor: ${error.message}`); return null; }

  await client.from('solicitudes_compra').update({ proveedor_id: proveedorId, fecha_compra: fecha, compra_proveedor_id: data.id }).eq('id', s.id);
  s.proveedor_id = proveedorId;
  s.fecha_compra = fecha;
  s.compra_proveedor_id = data.id;
  return data.id;
}

async function guardarCampo(id, field, valorCrudo) {
  const s = state.solicitudes.find((x) => x.id === id);
  if (!s) return;

  if (field === 'proveedor') {
    const proveedorId = await resolverProveedor(valorCrudo);
    await client.from('solicitudes_compra').update({ proveedor_id: proveedorId, proveedor_sugerido: valorCrudo.trim() || null }).eq('id', id);
    s.proveedor_id = proveedorId;
    s.proveedor_sugerido = valorCrudo.trim() || null;
    return;
  }

  const esNumero = ['cantidad', 'precio_unitario'].includes(field);
  const valor = esNumero ? (valorCrudo === '' ? null : Number(valorCrudo)) : (valorCrudo.trim() || null);
  const update = { [field]: valor };

  if (esNumero) {
    s[field] = valor;
    const total = (s.cantidad || 0) * (s.precio_unitario || 0);
    update.monto_total = total || null;
    s.monto_total = update.monto_total;
  } else {
    s[field] = valor;
  }

  const { error } = await client.from('solicitudes_compra').update(update).eq('id', id);
  if (error) { alert(`No se pudo guardar: ${error.message}`); return; }

  if (field === 'estado' && valor === 'comprado') {
    await vincularComoCompra(s);
  }
  renderKpis();
}

function wireRowEvents() {
  els.tbody.querySelectorAll('.campo-solicitud').forEach((input) => {
    const evento = input.tagName === 'SELECT' ? 'change' : 'blur';
    input.addEventListener(evento, async (e) => {
      const id = Number(e.target.dataset.id);
      await guardarCampo(id, e.target.dataset.field, e.target.value);
      if (e.target.dataset.field === 'estado') {
        e.target.className = `contacto-input campo-solicitud estado-select estado-${e.target.value}`;
      }
      if (e.target.dataset.field === 'cantidad' || e.target.dataset.field === 'precio_unitario') render();
    });
  });

  els.tbody.querySelectorAll('.toggle-historial').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = Number(e.target.dataset.id);
      if (state.openDetalle.has(id)) state.openDetalle.delete(id);
      else state.openDetalle.add(id);
      render();
    });
  });
}

els.filtroEstado.addEventListener('change', (e) => { state.filtroEstado = e.target.value; render(); });
els.search.addEventListener('input', (e) => { state.search = e.target.value; render(); });

els.btnNueva.addEventListener('click', () => {
  els.formNueva.reset();
  els.formError.textContent = '';
  document.getElementById('ns-solicitante').value = state.currentUser || '';
  els.modalOverlay.classList.remove('hidden');
});
els.btnCancelar.addEventListener('click', () => els.modalOverlay.classList.add('hidden'));
els.modalOverlay.addEventListener('click', (e) => {
  if (e.target === els.modalOverlay) els.modalOverlay.classList.add('hidden');
});

els.formNueva.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';
  const descripcion = document.getElementById('ns-descripcion').value.trim();
  if (!descripcion) { els.formError.textContent = 'Falta la descripción.'; return; }

  const proveedorTexto = document.getElementById('ns-proveedor').value.trim();
  const cantidad = document.getElementById('ns-cantidad').value ? Number(document.getElementById('ns-cantidad').value) : null;
  const precio_unitario = document.getElementById('ns-precio-unitario').value ? Number(document.getElementById('ns-precio-unitario').value) : null;

  const submitBtn = els.formNueva.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const proveedorId = proveedorTexto ? await resolverProveedor(proveedorTexto) : null;

  const nuevo = {
    descripcion,
    cantidad,
    precio_unitario,
    monto_total: (cantidad || 0) * (precio_unitario || 0) || null,
    proveedor_id: proveedorId,
    proveedor_sugerido: proveedorTexto || null,
    fecha_necesidad: document.getElementById('ns-fecha-necesidad').value || null,
    forma_pago: document.getElementById('ns-forma-pago').value.trim() || null,
    solicitante: document.getElementById('ns-solicitante').value.trim() || null,
    cargado_por: state.currentUser,
  };

  const { error } = await client.from('solicitudes_compra').insert(nuevo);
  submitBtn.disabled = false;
  if (error) { els.formError.textContent = `No se pudo guardar: ${error.message}`; return; }

  els.modalOverlay.classList.add('hidden');
  state.filtroEstado = '';
  els.filtroEstado.value = '';
  state.search = descripcion;
  els.search.value = descripcion;
  await cargarDatos();
  els.tbody.querySelector('tr[data-solicitud]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

(async () => {
  await initUser();
  await cargarDatos();
})();
