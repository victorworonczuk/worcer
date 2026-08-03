const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  resumen: document.getElementById('resumen'),
  tbodyPrecios: document.getElementById('tbody-precios'),
  tbodyDescuentos: document.getElementById('tbody-descuentos'),
  notaPie: document.getElementById('nota-pie'),
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPesos(n) {
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtFecha(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR');
}

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

async function cargar() {
  const { data: listas, error: e1 } = await client
    .from('listas_precios')
    .select('id, fecha_vigencia, tipo_cambio, nota')
    .order('fecha_vigencia', { ascending: false })
    .limit(1);

  if (e1 || !listas || listas.length === 0) {
    els.resumen.innerHTML = '<p class="empty-state">No hay ninguna lista de precios cargada todavía.</p>';
    els.tbodyPrecios.innerHTML = '';
    els.tbodyDescuentos.innerHTML = '';
    return;
  }

  const lista = listas[0];
  els.resumen.innerHTML = `
    <div><strong>${fmtFecha(lista.fecha_vigencia)}</strong><span class="label">vigente desde</span></div>
    ${lista.tipo_cambio ? `<div><strong>${fmtPesos(lista.tipo_cambio)}</strong><span class="label">tipo de cambio</span></div>` : ''}
  `;
  els.notaPie.textContent = lista.nota || '';

  const { data: items, error: e2 } = await client
    .from('lista_precios_items')
    .select('precio_sin_iva, piezas(linea, tipo_pieza, variante)')
    .eq('lista_id', lista.id)
    .order('piezas(linea)');

  if (e2) {
    els.tbodyPrecios.innerHTML = `<tr><td colspan="3" class="empty-state">Error: ${escapeHtml(e2.message)}</td></tr>`;
  } else if (!items || items.length === 0) {
    els.tbodyPrecios.innerHTML = '<tr><td colspan="3" class="empty-state">Sin piezas cargadas en esta lista.</td></tr>';
  } else {
    const ordenados = [...items].sort((a, b) => (a.piezas.linea + a.piezas.tipo_pieza).localeCompare(b.piezas.linea + b.piezas.tipo_pieza));
    els.tbodyPrecios.innerHTML = ordenados.map((it) => `
      <tr>
        <td>${escapeHtml(it.piezas.linea)}</td>
        <td>${escapeHtml(it.piezas.tipo_pieza)}${it.piezas.variante ? ` (${escapeHtml(it.piezas.variante)})` : ''}</td>
        <td class="col-precio">${fmtPesos(it.precio_sin_iva)}</td>
      </tr>
    `).join('');
  }

  const { data: descuentos, error: e3 } = await client
    .from('lista_precios_descuentos')
    .select('monto_desde, monto_hasta, descuento, plazo_pago')
    .eq('lista_id', lista.id)
    .order('monto_desde');

  if (e3) {
    els.tbodyDescuentos.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${escapeHtml(e3.message)}</td></tr>`;
  } else if (!descuentos || descuentos.length === 0) {
    els.tbodyDescuentos.innerHTML = '<tr><td colspan="4" class="empty-state">Sin descuentos cargados.</td></tr>';
  } else {
    els.tbodyDescuentos.innerHTML = descuentos.map((d) => `
      <tr>
        <td>${fmtPesos(d.monto_desde)}</td>
        <td>${d.monto_hasta ? fmtPesos(d.monto_hasta) : 'Sin techo'}</td>
        <td>${(d.descuento * 100).toLocaleString('es-AR')}%</td>
        <td>${escapeHtml(d.plazo_pago || '')}</td>
      </tr>
    `).join('');
  }
}

initUser().then(cargar);
