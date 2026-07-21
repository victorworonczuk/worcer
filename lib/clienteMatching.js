// Matching de nombres para no duplicar clientes. Compara por palabras completas
// (no substring — un primer intento con substring hacía que nombres cortos como
// "SA" matchearan cualquier cosa que empezara con "SAN...", ver README).
const STOPWORDS = new Set([
  'SA', 'SRL', 'SH', 'SAS', 'SACI', 'SCA', 'DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y', 'S', 'H',
]);

export function normalizarNombre(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensSignificativos(nombreNormalizado) {
  return nombreNormalizado.split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// true si a y b son "el mismo nombre" con suficiente confianza: iguales, o el
// más corto tiene 2+ palabras significativas y todas aparecen en el más largo.
export function esMatchFuerte(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = new Set(tokensSignificativos(a));
  const tb = new Set(tokensSignificativos(b));
  const corta = ta.size <= tb.size ? ta : tb;
  const larga = ta.size <= tb.size ? tb : ta;
  if (corta.size < 2) return false;
  for (const tok of corta) {
    if (!larga.has(tok)) return false;
  }
  return true;
}

// Busca, entre clientes sin CUIT cargado, uno cuyo nombre matchee con fuerza
// razonable contra el nombre facturado. Devuelve el cliente ({id, nombre}) o null.
export function buscarClienteSinCuitPorNombre(nombreFacturado, clientesSinCuit) {
  const norm = normalizarNombre(nombreFacturado);
  if (!norm) return null;
  return clientesSinCuit.find((c) => esMatchFuerte(norm, normalizarNombre(c.nombre))) || null;
}
