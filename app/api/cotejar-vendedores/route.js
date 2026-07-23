import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { cotejarDia } from '../../../lib/cotejarVendedor.js';

function getSessionUser(request) {
  const cookie = request.cookies.get('worcer_auth');
  if (!cookie) return null;
  const parts = cookie.value.split(':');
  if (parts.length !== 3) return null;
  const [username, exp, sig] = parts;
  if (Date.now() > Number(exp)) return null;
  const payload = `${username}:${exp}`;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  return expected === sig ? username : null;
}

// Corre el cruce: para cada día con facturas sin vendedor asignado Y pedidos
// de vendedor cargados ese día, busca la/las formas de repartir las facturas
// entre los vendedores para que cada total cierre exacto. Lo que sale igual
// en todas las combinaciones posibles se guarda solo; lo que varía queda sin
// tocar y se devuelve para revisar a mano.
export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
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

    return NextResponse.json({
      ok: true,
      dias_cotejados: diasCotejados,
      dias_sin_solucion: diasSinSolucion,
      facturas_asignadas: asignadas,
      dias_ambiguos: diasAmbiguos,
    });
  } finally {
    await client.end();
  }
}

// Asignación manual de una factura puntual (casos ambiguos que Víctor
// resuelve a mano viendo a qué cliente pertenece cada una).
export async function PATCH(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { facturaId, vendedor } = await request.json();
  if (!facturaId || !vendedor) {
    return NextResponse.json({ error: 'Falta facturaId o vendedor' }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `update public.facturas set vendedor = $1, vendedor_fuente = 'manual' where id = $2`,
      [vendedor, facturaId]
    );
    return NextResponse.json({ ok: true });
  } finally {
    await client.end();
  }
}
