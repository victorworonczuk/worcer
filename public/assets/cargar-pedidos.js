const state = {
  archivo: null, // File | null
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
  els.fileList.innerHTML = state.archivo
    ? `<li>${state.archivo.name} <button type="button" class="quitar-archivo">✕</button></li>`
    : '';
  const btn = els.fileList.querySelector('.quitar-archivo');
  if (btn) {
    btn.addEventListener('click', () => {
      state.archivo = null;
      renderFileList();
      els.btnImportar.disabled = true;
    });
  }
}

function elegirArchivo(fileListLike) {
  const f = fileListLike[0];
  if (!f || !f.name.toLowerCase().endsWith('.xlsx')) return;
  state.archivo = f;
  renderFileList();
  els.btnImportar.disabled = false;
}

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => elegirArchivo(e.target.files));

els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('dragover');
  elegirArchivo(e.dataTransfer.files);
});

els.btnImportar.addEventListener('click', async () => {
  if (!state.archivo) return;

  els.btnImportar.disabled = true;
  els.btnImportar.textContent = 'Importando...';
  els.resultado.innerHTML = '';

  const formData = new FormData();
  formData.append('archivo', state.archivo);

  try {
    const res = await fetch('/api/import-pedidos', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    const sinMapearHtml = data.sin_mapear.length
      ? `<p class="resultado-warn">⚠ ${data.sin_mapear.length} nombre(s) de vendedor no se pudieron reconocer (no se cargaron esas filas):</p>
         <ul>${data.sin_mapear.map((n) => `<li>${n}</li>`).join('')}</ul>`
      : '';

    els.resultado.innerHTML = `
      <p class="resultado-ok">✓ Importación terminada.</p>
      <ul>
        <li>Filas leídas (vendedor × día): ${data.filas_leidas}</li>
        <li>Filas cargadas/actualizadas: ${data.filas_cargadas}</li>
        <li>Proyecciones de cierre de mes cargadas: ${data.proyecciones_cargadas}</li>
      </ul>
      ${sinMapearHtml}
    `;
    state.archivo = null;
    renderFileList();
  } catch (err) {
    els.resultado.innerHTML = `<p class="resultado-error">✗ No se pudo importar: ${err.message}</p>`;
  } finally {
    els.btnImportar.disabled = !state.archivo;
    els.btnImportar.textContent = 'Importar';
  }
});

initUser();
