const state = {
  archivo: null,
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
    els.resultado.innerHTML = '<p class="resultado-error">Tu usuario es de solo lectura — no podés importar compras.</p>';
  }
}

function renderFileList() {
  els.fileList.innerHTML = state.archivo
    ? `<li>${state.archivo.name} <button type="button" id="quitar-archivo">✕</button></li>`
    : '';
  const btn = document.getElementById('quitar-archivo');
  if (btn) btn.addEventListener('click', () => {
    state.archivo = null;
    renderFileList();
    els.btnImportar.disabled = true;
  });
}

function elegirArchivo(fileListLike) {
  if (state.soloLectura) return;
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
    const res = await fetch('/api/import-compras-proveedor', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    els.resultado.innerHTML = `
      <p class="resultado-ok">✓ Importación terminada.</p>
      <ul>
        <li>Filas leídas: ${data.leidas}</li>
        <li>Compras nuevas cargadas: ${data.nuevas}</li>
        <li>Ya existían (se saltearon): ${data.existentes}</li>
        <li>Proveedores nuevos dados de alta: ${data.proveedores_nuevos}</li>
        <li>Filas no aprobadas (Estado ≠ OK), sin contar: ${data.no_aprobadas}</li>
        <li>Filas aprobadas pero sin fecha de compra todavía, sin contar: ${data.sin_f_compra}</li>
        <li>Filas sin proveedor cargado, sin contar: ${data.sin_proveedor}</li>
      </ul>
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
