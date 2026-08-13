// Menú único, centralizado acá: antes cada página tenía su propia lista de
// links a mano (y con el tiempo quedaron todas distintas e incompletas). El
// contenido de #nav-dropdown en el HTML de cada página queda vacío — este
// script lo arma siempre igual, agrupado por Clientes / Ventas / Producción,
// y remarca el ítem de la página actual.
const NAV_GROUPS = [
  {
    title: 'Clientes',
    items: [
      { href: '/index.html', label: 'Dashboard', title: 'Volver al listado de clientes.' },
      { href: '/index.html#nueva-persona', label: '+ Nueva persona', title: 'Cargá acá un contacto sin compras todavía. Pasa a ser cliente solo cuando se le carga la primera factura.' },
    ],
  },
  {
    title: 'Ventas',
    items: [
      { href: '/importar-ventas.html', label: '+ Importar ventas', title: 'Subí acá los reportes .xml de facturas del sistema de facturación (Cerámica, Porcelanas y/o Presupuesto).' },
      { href: '/cargar-pedidos.html', label: '+ Cargar pedidos', title: 'Subí acá el Tablero de pedidos de venta (Excel, una hoja por mes) cuando haya una versión nueva.' },
      { href: '/pedidos-vendedor.html', label: 'Pedidos por vendedor', title: 'Reporte de pedidos cargados por vendedor y día. Solo consulta, no se carga nada acá.' },
      { href: '/lista-precios.html', label: 'Lista de precios', title: 'Lista de precios vigente, descuentos por escala, y carga del tipo de cambio del mes.' },
      { href: '/analisis-semanal.html', label: 'Análisis semanal', title: 'Facturación, piezas y escalas de descuento por semana. Solo consulta, no se carga nada acá.' },
      { href: '/piezas.html', label: 'Análisis de piezas', title: 'Reporte de piezas vendidas por cliente y período. Solo consulta, no se carga nada acá.' },
    ],
  },
  {
    title: 'Producción',
    items: [
      { href: '/produccion.html', label: 'Producción (stock)', title: 'Reporte consolidado de producción, venta, rotura y stock por pieza y depósito. Solo consulta, no se carga nada acá.' },
      { href: '/produccion-carga.html', label: '+ Cargar producción', title: 'Cargá acá, día por día, las cantidades de producción, venta y rotura por pieza, calidad y depósito.' },
      { href: '/recuento.html', label: 'Recuento', title: 'Cargá acá un conteo físico de stock por depósito — fija el stock del sistema a esa fecha.' },
      { href: '/traslado.html', label: 'Traslado entre depósitos', title: 'Registrá el envío de piezas por expreso entre Alberti y Lanús Oeste.' },
      { href: '/movimiento-piezas.html', label: '+ Movimiento de piezas', title: 'Subí acá los reportes "Salidas de Stocks" (.xlsx) — siempre después de Importar ventas, nunca antes.' },
    ],
  },
];

function renderNav(dropdown) {
  const path = location.pathname;
  const gruposHtml = NAV_GROUPS.map((grupo) => {
    const itemsHtml = grupo.items.map((it) => {
      const activo = it.href === path ? ' active' : '';
      return `<a href="${it.href}" class="nav-item${activo}" title="${it.title.replace(/"/g, '&quot;')}">${it.label}</a>`;
    }).join('');
    return `<div class="nav-section-title">${grupo.title}</div>${itemsHtml}`;
  }).join('');
  dropdown.innerHTML = `${gruposHtml}<div class="nav-section-divider"></div><a href="/api/logout" class="nav-item">Cerrar sesión</a>`;
}

(function () {
  const btn = document.getElementById('hamburger-btn');
  const dropdown = document.getElementById('nav-dropdown');
  if (!btn || !dropdown) return;

  renderNav(dropdown);

  function closeMenu() {
    dropdown.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const isOpen = dropdown.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  dropdown.querySelectorAll('a, button').forEach((el) => {
    el.addEventListener('click', closeMenu);
  });
})();
