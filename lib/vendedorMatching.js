// Normaliza nombres de vendedor cortos (como vienen en "Cuentas a cobrar.xlsx":
// "Mariano", "Sebastian", "Martin", etc.) al nombre completo tal cual está en
// VENDEDORES (public/assets/app.js) — deben coincidir exactamente, es la
// misma lista usada en clientes.vendedor / facturas.vendedor.
//
// "Walter" es el único caso ambiguo (hay Walter Vernola y Walter Fogar): si
// viene calificado ("Walter F", "Walter Fogar", "Walter Vernola") se resuelve
// solo; si viene pelado ("Walter" a secas) se deja sin resolver para
// preguntar, no se adivina (pedido de Víctor 07/09/26).
const MAPA_UNIVOCO = {
  SERGIO: 'Sergio Nastaskin',
  HERNAN: 'Hernán Acosta',
  ALEJANDRO: 'Alejandro Vernola',
  JOSE: 'Jose Gil',
  FRANCISCO: 'Francisco Baez',
  MARTIN: 'Martín Argento',
  DARIO: 'Darío Frank',
  MARIANO: 'Mariano Cabarrus',
  SEBASTIAN: 'Sebastián Guerra',
  HORACIO: 'Horacio Vostrosky',
  VICTOR: 'Víctor W.',
  CANTERO: 'Cantero',
};

function sinAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

// Devuelve { vendedor, ambiguo } — vendedor es null si no se pudo resolver
// (ambiguo, o directamente no reconocido).
export function resolverVendedor(nombreCorto) {
  if (!nombreCorto) return { vendedor: null, ambiguo: false };
  const norm = sinAcentos(nombreCorto);

  if (norm === 'WALTER') return { vendedor: null, ambiguo: true };
  if (norm.startsWith('WALTER') && (norm.includes('FOGAR') || norm.endsWith(' F'))) {
    return { vendedor: 'Walter Fogar', ambiguo: false };
  }
  if (norm.startsWith('WALTER') && norm.includes('VERNOLA')) {
    return { vendedor: 'Walter Vernola', ambiguo: false };
  }

  const primeraPalabra = norm.split(' ')[0];
  const canon = MAPA_UNIVOCO[primeraPalabra];
  return { vendedor: canon || null, ambiguo: false };
}
