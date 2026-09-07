const state = {
  archivos: [], // File[]
  soloLectura: false,
};

const els = {
  userSubtitle: document.getElementById('user-subtitle'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  fileList: document.getElementById('file-list'),
  btnImportar: document.getElementById('btn-importar'),
  resultado: document.getElementById('resultado'),
};

async function initUser() {
  const res = await fetch('/api/me');
  const me = await res.json();
  if (!me.user) { window.location.href = '/login'; return; }
  els.userSubtitle.textContent = `Sesión: ${me.nombre || me.user}`;

  if (me.rol === 'analisis') {
    state.soloLectura = true;
    els.dropzone.classList.add('dropzone-disabled');
    els.resultado.innerHTML = '<p class="resultado-error">Tu usuario es de solo lectura — no podés importar cuentas a cobrar.</p>';
  }
}

function renderFileList() {
  els.fileList.innerHTML = state.archivos
    .map((f, i) => `<li>${f.name} <button type="button" class="quitar-archivo" data-i="${i}">✕</button></li>`)
    .join('');
  els.fileList.querySelectorAll('.quitar-archivo').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const i = Number(e.target.dataset.i);
      state.archivos.splice(i, 1);
      renderFileList();
      els.btnImportar.disabled = state.archivos.length === 0;
    });
  });
}

function agregarArchivos(fileListLike) {
  if (state.soloLectura) return;
  for (const f of fileListLike) {
    if (!f.name.toLowerCase().endsWith('.xlsx')) continue;
    if (state.archivos.some((a) => a.name === f.name)) continue;
    state.archivos.push(f);
  }
  renderFileList();
  els.btnImportar.disabled = state.archivos.length === 0;
}

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => agregarArchivos(e.target.files));

els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('dragover');
  agregarArchivos(e.dataTransfer.files);
});

function fmtPesos(n) { return n == null ? '' : '$' + Math.round(Number(n)).toLocaleString('es-AR'); }

els.btnImportar.addEventListener('click', async () => {
  if (state.archivos.length === 0) return;

  els.btnImportar.disabled = true;
  els.btnImportar.textContent = 'Importando...';
  els.resultado.innerHTML = '';

  const formData = new FormData();
  state.archivos.forEach((f) => formData.append('archivos', f));

  try {
    const res = await fetch('/api/import-cuentas-cobrar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    const sinVincularHtml = data.clientes_sin_vincular.length
      ? `<p class="resultado-warn">⚠ ${data.clientes_sin_vincular_total} fila(s) no se pudieron vincular a un cliente (nombre no encontrado${data.clientes_sin_vincular.some((r) => r.ambiguo) ? ', o encontrado más de una vez' : ''}):</p>
         <ul>${data.clientes_sin_vincular.map((r) => `<li>${r.cliente_nombre} — ${r.empresa || ''} ${r.numero_factura || ''} — ${fmtPesos(r.monto)}${r.ambiguo ? ' (ambiguo)' : ''}</li>`).join('')}</ul>`
      : '';

    const vendedorAmbiguoHtml = data.vendedor_ambiguo.length
      ? `<p class="resultado-warn">⚠ ${data.vendedor_ambiguo_total} fila(s) con vendedor ambiguo ("Walter" sin apellido):</p>
         <ul>${data.vendedor_ambiguo.map((r) => `<li>${r.cliente_nombre} — ${r.empresa || ''} ${r.numero_factura || ''} — vendedor cargado como "${r.vendedor_crudo}"</li>`).join('')}</ul>`
      : '';

    els.resultado.innerHTML = `
      <p class="resultado-ok">✓ Importación terminada.</p>
      <ul>
        <li>Cuentas a cobrar leídas: ${data.cuentas_leidas} · nuevas: ${data.cuentas_nuevas}</li>
        <li>Cheques rechazados leídos: ${data.cheques_leidos} · nuevos: ${data.cheques_nuevos}</li>
      </ul>
      ${sinVincularHtml}
      ${vendedorAmbiguoHtml}
    `;
    state.archivos = [];
    renderFileList();
  } catch (err) {
    els.resultado.innerHTML = `<p class="resultado-error">✗ No se pudo importar: ${err.message}</p>`;
  } finally {
    els.btnImportar.disabled = state.archivos.length === 0;
    els.btnImportar.textContent = 'Importar';
  }
});

initUser();
