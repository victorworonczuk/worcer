const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  btnCotejar: document.getElementById('btn-cotejar'),
  resultado: document.getElementById('resultado'),
  ambiguos: document.getElementById('ambiguos'),
};

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;
}

function fmtPesos(n) {
  return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function renderDiaAmbiguo(dia) {
  const div = document.createElement('div');
  div.className = 'dia-ambiguo';
  div.innerHTML = `
    <h3>${dia.fecha}</h3>
    <p class="targets">${dia.demasiadoComplejo ? '⚠ Demasiadas facturas ese día para buscar todas las combinaciones — revisar todo a mano. ' : ''}Vendedores ese día: ${dia.vendedoresTarget.map((v) => `${escapeHtml(v.vendedor)} (${Math.abs(v.monto) < 0.02 ? 'ya cubierto con lo asignado antes' : fmtPesos(v.monto) + ' pendiente'})`).join(', ')}</p>
    <table>
      <thead><tr><th>Cliente</th><th>Empresa</th><th class="importe">Importe</th><th>Asignar a</th><th></th></tr></thead>
      <tbody>
        ${dia.facturas.map((f) => `<tr data-factura="${f.id}">
          <td>${escapeHtml(f.nombre_facturado || '')}</td>
          <td>${escapeHtml(f.empresa || '')}</td>
          <td class="importe">${fmtPesos(f.importe_ars)}</td>
          <td>
            <select class="select-vendedor">
              <option value="">— elegir —</option>
              ${f.candidatos.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
          </td>
          <td><button type="button" class="btn-guardar-factura">Guardar</button><span class="guardado"></span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
  div.querySelectorAll('.btn-guardar-factura').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const facturaId = Number(tr.dataset.factura);
      const vendedor = tr.querySelector('.select-vendedor').value;
      if (!vendedor) return;
      btn.disabled = true;
      const res = await fetch('/api/cotejar-vendedores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facturaId, vendedor }),
      });
      if (res.ok) {
        tr.querySelector('.guardado').textContent = '✓ guardado';
        tr.querySelector('.select-vendedor').disabled = true;
      } else {
        btn.disabled = false;
        tr.querySelector('.guardado').textContent = '✗ error';
      }
    });
  });
  return div;
}

els.btnCotejar.addEventListener('click', async () => {
  els.btnCotejar.disabled = true;
  els.btnCotejar.textContent = 'Cotejando...';
  els.resultado.innerHTML = '';
  els.ambiguos.innerHTML = '';

  try {
    const res = await fetch('/api/cotejar-vendedores', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    els.resultado.innerHTML = `
      <p class="resultado-ok">✓ Cruce terminado.</p>
      <ul>
        <li>Días cotejados: ${data.dias_cotejados}</li>
        <li>Facturas asignadas automáticamente: ${data.facturas_asignadas}</li>
        <li>Días sin ninguna combinación posible (no se tocó nada): ${data.dias_sin_solucion}</li>
        <li>Días con casos ambiguos para revisar abajo: ${data.dias_ambiguos.length}</li>
      </ul>
    `;

    els.ambiguos.innerHTML = '';
    for (const dia of data.dias_ambiguos) {
      els.ambiguos.appendChild(renderDiaAmbiguo(dia));
    }
  } catch (err) {
    els.resultado.innerHTML = `<p class="resultado-error">✗ No se pudo cotejar: ${err.message}</p>`;
  } finally {
    els.btnCotejar.disabled = false;
    els.btnCotejar.textContent = 'Ejecutar cruce';
  }
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

initUser();
