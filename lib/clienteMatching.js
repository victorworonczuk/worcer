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

// Cuántas palabras significativas del más corto aparecen TODAS en el más
// largo (0 si falta alguna — no es match). Es la base de esMatchFuerte y de
// buscarClientePorNombre, que ordena por esta fuerza para preferir el match
// más específico cuando hay varios candidatos débiles (ver ahí el porqué).
function fuerzaDeMatch(a, b) {
  if (!a || !b) return 0;
  if (a === b) return Infinity; // idénticos: siempre gana, sin importar cuántos tokens tengan
  const ta = new Set(tokensSignificativos(a));
  const tb = new Set(tokensSignificativos(b));
  const corta = ta.size <= tb.size ? ta : tb;
  const larga = ta.size <= tb.size ? tb : ta;
  for (const tok of corta) {
    if (!larga.has(tok)) return 0;
  }
  return corta.size;
}

// true si a y b son "el mismo nombre" con suficiente confianza: iguales, o el
// más corto tiene `minTokens`+ palabras significativas y todas aparecen en
// el más largo. minTokens=2 por defecto (uso normal: cotejo contra CUIT ya
// confirmado, donde el nombre solo desempata entre candidatos sin CUIT).
export function esMatchFuerte(a, b, minTokens = 2) {
  return fuerzaDeMatch(a, b) >= minTokens;
}

// Busca, entre clientes sin CUIT cargado, uno cuyo nombre matchee con fuerza
// razonable contra el nombre facturado. Devuelve el cliente ({id, nombre}) o null.
export function buscarClienteSinCuitPorNombre(nombreFacturado, clientesSinCuit) {
  const norm = normalizarNombre(nombreFacturado);
  if (!norm) return null;
  return clientesSinCuit.find((c) => esMatchFuerte(norm, normalizarNombre(c.nombre))) || null;
}

// Para archivos sin CUIT en absoluto (ej. Cuentas a cobrar) — busca contra
// TODA la base de clientes, no solo los sin CUIT, permitiendo un match de un
// solo token (porque acá el nombre es la única señal disponible), pero se
// queda con el candidato de MAYOR fuerza en vez de aceptar cualquiera: un
// token suelto muy común (un nombre de pila como "Gustavo", o una palabra de
// rubro como "Sanitarios") puede matchear débil contra varios clientes que
// no tienen nada que ver, mientras el candidato correcto matchea fuerte por
// 2+ palabras — sin este desempate, ese ruido de un solo token bastaba para
// declarar "ambiguo" un caso que en realidad era clarísimo (bug real
// encontrado 07/09/26: "Eckert Gustavo" quedaba ambiguo por un cliente
// llamado solo "Gustavo", aun existiendo "ECKERT GUSTAVO JAVIER" exacto).
// Sigue quedando ambiguo cuando el empate real es entre candidatos de la
// MISMA fuerza (ahí sí hay que preguntar — ver "Diego", "Fenix", "Silveyra").
export function buscarClientePorNombre(nombre, clientesTodos) {
  const norm = normalizarNombre(nombre);
  if (!norm) return { cliente: null, ambiguo: false };

  const candidatos = clientesTodos
    .map((c) => ({ cliente: c, fuerza: fuerzaDeMatch(norm, normalizarNombre(c.nombre)) }))
    .filter((x) => x.fuerza > 0);
  if (candidatos.length === 0) return { cliente: null, ambiguo: false };

  const maxFuerza = Math.max(...candidatos.map((x) => x.fuerza));
  const mejores = candidatos.filter((x) => x.fuerza === maxFuerza);
  if (mejores.length === 1) return { cliente: mejores[0].cliente, ambiguo: false };
  return { cliente: null, ambiguo: true };
}
