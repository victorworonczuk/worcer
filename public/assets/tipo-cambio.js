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

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  mes: document.getElementById('f-mes'),
  valor: document.getElementById('f-valor'),
  status: document.getElementById('carga-status'),
  guardarBtn: document.getElementById('guardar-btn'),
  formError: document.getElementById('form-error'),
  mesesList: document.getElementById('meses-list'),
};

function mesLabel(ym) {
  const [anio, mes] = ym.split('-');
  return `${MESES[Number(mes) - 1]} ${anio}`;
}

async function init() {
  const me = await (await fetch('/api/me')).json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  if (me.rol === 'analisis') {
    els.guardarBtn.disabled = true;
    els.formError.textContent = 'Tu usuario es de solo lectura — no podés cargar tipo de cambio.';
  }

  const hoy = new Date();
  els.mes.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  await loadMeses();
}

async function loadMeses() {
  els.mesesList.innerHTML = '<div class="loading">Cargando…</div>';

  const [{ data: tc, error: e1 }, { data: facturas, error: e2 }] = await Promise.all([
    client.from('tipo_cambio').select('mes, valor, cargado_por').order('mes', { ascending: false }),
    fetchAll(() => client.from('facturas').select('fecha, tipo_cambio')),
  ]);
  if (e1 || e2) { els.mesesList.innerHTML = `<div class="loading">Error: ${(e1 || e2).message}</div>`; return; }

  // Agrupar facturas por mes: cuántas tienen TC y cuántas no.
  const porMes = new Map();
  for (const f of facturas) {
    if (!f.fecha) continue;
    const ym = f.fecha.slice(0, 7);
    if (!porMes.has(ym)) porMes.set(ym, { conTc: 0, sinTc: 0 });
    const g = porMes.get(ym);
    if (f.tipo_cambio == null) g.sinTc += 1;
    else g.conTc += 1;
  }
  const tcPorMes = new Map((tc || []).map((r) => [r.mes.slice(0, 7), r]));

  const meses = [...new Set([...porMes.keys(), ...tcPorMes.keys()])].sort().reverse();

  if (meses.length === 0) {
    els.mesesList.innerHTML = '<div class="loading">Todavía no hay facturas cargadas.</div>';
    return;
  }

  els.mesesList.innerHTML = meses.map((ym) => {
    const g = porMes.get(ym) || { conTc: 0, sinTc: 0 };
    const cargado = tcPorMes.get(ym);
    const pendiente = g.sinTc > 0;
    return `<div class="recientes-item">
      <div>
        <div class="nombre">${mesLabel(ym)}${cargado ? ` — TC $${Number(cargado.valor).toLocaleString('es-AR')}` : ''}</div>
        <div class="meta">${g.conTc} factura(s) con dólar${pendiente ? ` · <strong class="tc-pendiente">${g.sinTc} pendiente(s)</strong>` : ''}${cargado ? ` · cargado por ${escapeHtml(cargado.cargado_por || '')}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function guardar() {
  els.formError.textContent = '';
  const mes = els.mes.value;
  const valor = Number(els.valor.value);
  if (!mes) { els.formError.textContent = 'Elegí el mes.'; return; }
  if (!valor || valor <= 0) { els.formError.textContent = 'Cargá el valor del tipo de cambio.'; return; }

  els.guardarBtn.disabled = true;
  els.guardarBtn.textContent = 'Guardando…';
  els.status.textContent = '';

  try {
    const res = await fetch('/api/aplicar-tipo-cambio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes, valor }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    els.status.textContent = `✓ Guardado. ${data.actualizadas} factura(s) de ${mesLabel(mes)} actualizada(s) con TC $${valor.toLocaleString('es-AR')}.`;
    els.valor.value = '';
    await loadMeses();
  } catch (err) {
    els.formError.textContent = 'Error al guardar: ' + err.message;
  } finally {
    els.guardarBtn.disabled = false;
    els.guardarBtn.textContent = 'Guardar y aplicar';
  }
}

els.guardarBtn.addEventListener('click', guardar);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
