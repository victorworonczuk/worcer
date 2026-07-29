const state = {
  archivos: [], // File[]
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

els.btnImportar.addEventListener('click', async () => {
  if (state.archivos.length === 0) return;

  els.btnImportar.disabled = true;
  els.btnImportar.textContent = 'Importando...';
  els.resultado.innerHTML = '';

  const formData = new FormData();
  state.archivos.forEach((f) => formData.append('archivos', f));

  try {
    const res = await fetch('/api/import-movimiento-piezas', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    const sinFacturaHtml = data.sin_factura > 0
      ? `<p class="resultado-warn">⚠ ${data.sin_factura} renglón(es) sin la factura correspondiente todavía cargada (subilos primero desde "Importar ventas"):</p>
         <ul>${data.sin_factura_ejemplos.map((n) => `<li>${n}</li>`).join('')}${data.sin_factura > data.sin_factura_ejemplos.length ? `<li>… y ${data.sin_factura - data.sin_factura_ejemplos.length} más</li>` : ''}</ul>`
      : '';

    const sinMapearHtml = data.sin_mapear.length
      ? `<p class="resultado-warn">⚠ ${data.sin_mapear.length} ítem(s) del archivo no están en el catálogo de piezas (no se cargaron esos renglones):</p>
         <ul>${data.sin_mapear.map((n) => `<li>${n}</li>`).join('')}</ul>`
      : '';

    els.resultado.innerHTML = `
      <p class="resultado-ok">✓ Importación terminada.</p>
      <ul>
        <li>Renglones leídos: ${data.renglones_leidos}</li>
        <li>Renglones agrupados por factura+pieza: ${data.renglones_agrupados}</li>
        <li>Cargados/actualizados: ${data.cargados}</li>
        <li>Sin pieza reconocida en el catálogo: ${data.sin_pieza}</li>
        <li>Producción sincronizada (líneas importadas): ${data.produccion_sincronizada}</li>
      </ul>
      ${sinFacturaHtml}
      ${sinMapearHtml}
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
