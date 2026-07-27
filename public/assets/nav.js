(function () {
  const btn = document.getElementById('hamburger-btn');
  const dropdown = document.getElementById('nav-dropdown');
  if (!btn || !dropdown) return;

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
