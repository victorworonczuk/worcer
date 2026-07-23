// Cruza facturas contra pedidos_vendedor (tablero de pedidos, un total de $
// por vendedor y día) para descubrir qué vendedor vendió cada factura: el
// tablero no tiene una fila por factura, tiene un total diario por vendedor,
// así que hay que encontrar qué combinación de facturas de ese día suma
// exacto ese total (para cada vendedor activo ese día, al mismo tiempo).
//
// Puede no haber una única forma de repartir las facturas (ej. dos facturas
// del mismo importe a clientes distintos el mismo día) — en ese caso NO se
// adivina: se prueban todas las combinaciones válidas y solo se toma como
// segura la asignación de una factura si es la MISMA en absolutamente todas
// las combinaciones encontradas. Las que varían quedan para revisar a mano.

const EPS = 0.02; // tolerancia por redondeo de centavos
const MAX_SOLUCIONES = 300; // más que esto: el día queda para revisión manual completa, no vale la pena seguir buscando

// facturas: [{ id, monto }] (monto = importe_ars, puede ser negativo: notas de crédito)
// vendedoresTarget: [{ vendedor, monto }] (de pedidos_vendedor.monto_ars para ese día)
// Devuelve { asignaciones: [{facturaId, vendedor}], ambiguas: [{facturaId, candidatos}], sinSolucion, demasiadoComplejo }
export function cotejarDia(facturas, vendedoresTarget) {
  const nombres = vendedoresTarget.map((v) => v.vendedor);
  const targetsIniciales = Object.fromEntries(vendedoresTarget.map((v) => [v.vendedor, v.monto]));
  const n = facturas.length;

  // Suma máxima/mínima alcanzable desde la posición i en adelante (poda).
  const maxSuf = new Array(n + 1).fill(0);
  const minSuf = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    maxSuf[i] = maxSuf[i + 1] + Math.max(facturas[i].monto, 0);
    minSuf[i] = minSuf[i + 1] + Math.min(facturas[i].monto, 0);
  }

  function alcanzable(restantes, i) {
    for (const nom of nombres) {
      const r = restantes[nom];
      if (r < minSuf[i] - EPS || r > maxSuf[i] + EPS) return false;
    }
    return true;
  }

  const soluciones = [];
  const asignacionActual = new Array(n).fill(null);

  function backtrack(i, restantes) {
    if (soluciones.length >= MAX_SOLUCIONES) return;
    if (i === n) {
      if (nombres.every((nom) => Math.abs(restantes[nom]) < EPS)) {
        soluciones.push(asignacionActual.slice());
      }
      return;
    }
    if (!alcanzable(restantes, i)) return;
    const monto = facturas[i].monto;
    for (const nom of nombres) {
      asignacionActual[i] = nom;
      restantes[nom] -= monto;
      backtrack(i + 1, restantes);
      restantes[nom] += monto;
    }
    asignacionActual[i] = null;
    backtrack(i + 1, restantes);
  }

  backtrack(0, { ...targetsIniciales });

  if (soluciones.length === 0) {
    return { asignaciones: [], ambiguas: [], sinSolucion: true, demasiadoComplejo: false };
  }
  if (soluciones.length >= MAX_SOLUCIONES) {
    return {
      asignaciones: [],
      ambiguas: facturas.map((f) => ({ facturaId: f.id, candidatos: nombres })),
      sinSolucion: false,
      demasiadoComplejo: true,
    };
  }

  const asignaciones = [];
  const ambiguas = [];
  for (let i = 0; i < n; i++) {
    const valores = new Set(soluciones.map((s) => s[i]));
    if (valores.size === 1) {
      const v = [...valores][0];
      if (v != null) asignaciones.push({ facturaId: facturas[i].id, vendedor: v });
    } else {
      ambiguas.push({ facturaId: facturas[i].id, candidatos: [...valores].filter(Boolean) });
    }
  }
  return { asignaciones, ambiguas, sinSolucion: false, demasiadoComplejo: false };
}
