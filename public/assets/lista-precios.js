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

// Cerámica y Porcelanas facturan al 21% general — Presupuesto al 10,5%, pero
// no siempre se lo suman al valor de lista (a veces sale al mismo precio de
// lista, sin IVA), así que para Presupuesto no hay fórmula: se muestra el
// precio real de la última factura de Presupuesto de esa pieza, tal cual se
// cobró (confirmado con Víctor 12/08/26).
const IVA_CERAMICA_PORCELANAS = 0.21;

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
    .select('pieza_id, precio_sin_iva, piezas(linea, tipo_pieza, variante)')
    .eq('lista_id', lista.id)
    .order('piezas(linea)');

  if (e2) {
    els.tbodyPrecios.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${escapeHtml(e2.message)}</td></tr>`;
  } else if (!items || items.length === 0) {
    els.tbodyPrecios.innerHTML = '<tr><td colspan="5" class="empty-state">Sin piezas cargadas en esta lista.</td></tr>';
  } else {
    // Último precio real facturado como Presupuesto, por pieza — solo para
    // las piezas que están en esta lista (no hace falta traer todo el
    // catálogo de factura_items).
    const piezaIds = items.map((it) => it.pieza_id);
    const { data: ventasPresupuesto, error: e2b } = await client
      .from('factura_items')
      .select('pieza_id, precio_unitario, facturas!inner(empresa, fecha)')
      .in('pieza_id', piezaIds)
      .eq('facturas.empresa', 'Presupuesto')
      .order('facturas(fecha)', { ascending: false });

    const ultimoPresupuestoPorPieza = new Map();
    if (!e2b) {
      for (const v of (ventasPresupuesto || [])) {
        if (!ultimoPresupuestoPorPieza.has(v.pieza_id)) {
          ultimoPresupuestoPorPieza.set(v.pieza_id, { precio: v.precio_unitario, fecha: v.facturas.fecha });
        }
      }
    }

    const ordenados = [...items].sort((a, b) => (a.piezas.linea + a.piezas.tipo_pieza).localeCompare(b.piezas.linea + b.piezas.tipo_pieza));
    els.tbodyPrecios.innerHTML = ordenados.map((it) => {
      const conIva = Number(it.precio_sin_iva) * (1 + IVA_CERAMICA_PORCELANAS);
      const presupuesto = ultimoPresupuestoPorPieza.get(it.pieza_id);
      const celdaPresupuesto = presupuesto
        ? `${fmtPesos(presupuesto.precio)}<br><span class="sub-value">${fmtFecha(presupuesto.fecha)}</span>`
        : '<span class="sub-value">Sin ventas de Presupuesto</span>';
      return `
      <tr>
        <td>${escapeHtml(it.piezas.linea)}</td>
        <td>${escapeHtml(it.piezas.tipo_pieza)}${it.piezas.variante ? ` (${escapeHtml(it.piezas.variante)})` : ''}</td>
        <td class="col-precio">${fmtPesos(it.precio_sin_iva)}</td>
        <td class="col-precio">${fmtPesos(conIva)}</td>
        <td class="col-precio">${celdaPresupuesto}</td>
      </tr>
    `;
    }).join('');
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
