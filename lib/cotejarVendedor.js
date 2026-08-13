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

// Corre el cruce completo contra la base: para cada día con facturas sin
// vendedor asignado Y pedidos de vendedor cargados ese día, busca la/las
// formas de repartir las facturas entre los vendedores para que cada total
// cierre exacto. Lo que sale igual en todas las combinaciones posibles se
// guarda solo; lo que varía queda sin tocar y se devuelve para revisar a
// mano. Recibe un `client` de `pg` ya conectado (no lo cierra) — así se
// puede llamar tanto desde /api/cotejar-vendedores como automáticamente al
// final de un import de ventas o de pedidos, reusando la misma conexión.
export async function ejecutarCotejo(client) {
  // Paso 1: el cliente ya tiene un vendedor fijo asignado (cartera fija,
  // confirmado con Víctor) — es la vía más segura, ni siquiera hace falta
  // cotejar importes. Se hace antes del cruce por día para que además esas
  // facturas no compliquen la búsqueda de combinaciones del resto.
  const { rowCount: asignadasPorCliente } = await client.query(`
    update public.facturas f
    set vendedor = c.vendedor, vendedor_fuente = 'cliente_asignado'
    from public.clientes c
    where f.cliente_id = c.id and f.vendedor is null and c.vendedor is not null
  `);

  const { rows: facturas } = await client.query(
    `select id, fecha, importe_ars, nombre_facturado, empresa
     from public.facturas
     where vendedor is null and fecha is not null and importe_ars is not null
     order by fecha`
  );
  const { rows: pedidos } = await client.query(
    `select vendedor, fecha, monto_ars from public.pedidos_vendedor where monto_ars <> 0`
  );
  // Facturas que ya tienen vendedor (de una corrida anterior, o cargadas a
  // mano) — hay que descontarlas del total del día antes de buscar entre
  // las que faltan, si no el total ya no cierra con las que quedan.
  const { rows: yaAsignadas } = await client.query(
    `select fecha, vendedor, sum(importe_ars) as suma
     from public.facturas
     where vendedor is not null and fecha is not null
     group by fecha, vendedor`
  );

  const facturasPorFecha = new Map();
  for (const f of facturas) {
    const fecha = f.fecha.toISOString().slice(0, 10);
    if (!facturasPorFecha.has(fecha)) facturasPorFecha.set(fecha, []);
    facturasPorFecha.get(fecha).push(f);
  }
  const yaAsignadoPorFechaVendedor = new Map(); // "fecha|vendedor" -> suma
  for (const a of yaAsignadas) {
    const fecha = a.fecha.toISOString().slice(0, 10);
    yaAsignadoPorFechaVendedor.set(`${fecha}|${a.vendedor}`, Number(a.suma));
  }
  const pedidosPorFecha = new Map();
  for (const p of pedidos) {
    const fecha = p.fecha.toISOString().slice(0, 10);
    if (!pedidosPorFecha.has(fecha)) pedidosPorFecha.set(fecha, []);
    const yaAsignado = yaAsignadoPorFechaVendedor.get(`${fecha}|${p.vendedor}`) || 0;
    pedidosPorFecha.get(fecha).push({ vendedor: p.vendedor, monto: Number(p.monto_ars) - yaAsignado });
  }

  const asignacionesTotales = []; // { facturaId, vendedor }
  const diasAmbiguos = [];
  let diasCotejados = 0;
  let diasSinSolucion = 0;

  for (const [fecha, facturasDelDia] of facturasPorFecha) {
    const vendedoresTarget = pedidosPorFecha.get(fecha);
    if (!vendedoresTarget || vendedoresTarget.length === 0) continue; // sin datos del tablero ese día, no hay con qué cotejar
    if (facturasDelDia.length > 20) continue; // día demasiado grande, no vale la pena buscar combinaciones a ciegas

    diasCotejados += 1;
    const resultado = cotejarDia(
      facturasDelDia.map((f) => ({ id: f.id, monto: Number(f.importe_ars) })),
      vendedoresTarget
    );

    if (resultado.sinSolucion) { diasSinSolucion += 1; continue; }

    asignacionesTotales.push(...resultado.asignaciones);

    if (resultado.ambiguas.length > 0) {
      const porId = new Map(facturasDelDia.map((f) => [f.id, f]));
      diasAmbiguos.push({
        fecha,
        demasiadoComplejo: resultado.demasiadoComplejo,
        vendedoresTarget,
        facturas: resultado.ambiguas.map(({ facturaId, candidatos }) => {
          const f = porId.get(facturaId);
          return {
            id: facturaId,
            nombre_facturado: f.nombre_facturado,
            empresa: f.empresa,
            importe_ars: f.importe_ars,
            candidatos,
          };
        }),
      });
    }
  }

  // Update por lotes (una query por cada ~500 filas).
  const TAMANO_LOTE = 500;
  let asignadas = 0;
  for (let i = 0; i < asignacionesTotales.length; i += TAMANO_LOTE) {
    const lote = asignacionesTotales.slice(i, i + TAMANO_LOTE);
    const valores = [];
    const casos = lote.map((a, idx) => {
      valores.push(a.facturaId, a.vendedor);
      return `when id = $${idx * 2 + 1} then $${idx * 2 + 2}`;
    });
    const ids = lote.map((a) => a.facturaId);
    await client.query(
      `update public.facturas set vendedor = case ${casos.join(' ')} end, vendedor_fuente = 'cotejo_automatico'
       where id = any($${lote.length * 2 + 1}::bigint[])`,
      [...valores, ids]
    );
    asignadas += lote.length;
  }

  return {
    facturas_asignadas_por_cliente: asignadasPorCliente,
    dias_cotejados: diasCotejados,
    dias_sin_solucion: diasSinSolucion,
    facturas_asignadas: asignadas,
    dias_ambiguos: diasAmbiguos,
  };
}
