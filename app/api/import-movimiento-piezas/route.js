import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseMovimientoPiezasXlsx, LINEAS_IMPORTADAS } from '../../../lib/movimientoPiezasXlsx.js';

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

async function upsertPorLotes(client, tabla, columnas, columnasConflicto, filas, setExtra = []) {
  const TAMANO_LOTE = 500;
  let cargadas = 0;
  const setClause = columnas
    .filter((c) => !columnasConflicto.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .concat(setExtra)
    .join(', ');
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    const valores = [];
    const placeholders = lote.map((f, idx) => {
      const base = idx * columnas.length;
      columnas.forEach((c) => valores.push(f[c]));
      return `(${columnas.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    await client.query(
      `insert into public.${tabla} (${columnas.join(', ')})
       values ${placeholders.join(', ')}
       on conflict (${columnasConflicto.join(', ')}) do update set ${setClause}`,
      valores
    );
    cargadas += lote.length;
  }
  return cargadas;
}

export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const formData = await request.formData();
  const archivos = formData.getAll('archivos');
  if (!archivos.length) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  let registros, sinMapear;
  try {
    const files = await Promise.all(
      archivos.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))
    );
    ({ registros, sinMapear } = await parseMovimientoPiezasXlsx(files));
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (registros.length === 0) {
    return NextResponse.json({ error: 'No se encontraron renglones reconocibles en los archivos subidos.' }, { status: 400 });
  }

  // Agrupar por (factura, pieza) antes de tocar la base: una factura puede
  // traer dos renglones del mismo producto — mismo criterio que
  // scripts/import-salidas-stock.cjs, para que este import quede idempotente.
  const grupos = new Map();
  for (const r of registros) {
    const key = `${r.empresa}|${r.tipo_comprobante}|${r.numero_comprobante}|${r.linea}|${r.tipo_pieza}|${r.variante}|${r.calidad}|${r.ubicacion}`;
    const actual = grupos.get(key);
    if (actual) {
      actual.cantidad += r.cantidad;
      actual.precio_vta = r.precio_vta ?? actual.precio_vta;
    } else {
      grupos.set(key, { ...r });
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: facturaRows } = await client.query(
      `select id, fecha, empresa, tipo_comprobante, numero_comprobante from public.facturas`
    );
    const facturasPorClave = new Map();
    for (const f of facturaRows) {
      facturasPorClave.set(`${f.empresa}|${f.tipo_comprobante}|${f.numero_comprobante}`, f);
    }

    const { rows: piezaRows } = await client.query(
      `select id, linea, tipo_pieza, variante, calidad from public.piezas`
    );
    const piezasPorClave = new Map();
    for (const p of piezaRows) {
      piezasPorClave.set(`${p.linea}|${p.tipo_pieza}|${p.variante}|${p.calidad}`, p.id);
    }

    const paraCargar = [];
    let sinFactura = 0;
    let sinPieza = 0;
    const facturasSinMatch = new Set();

    for (const r of grupos.values()) {
      const factura = facturasPorClave.get(`${r.empresa}|${r.tipo_comprobante}|${r.numero_comprobante}`);
      if (!factura) {
        sinFactura += 1;
        facturasSinMatch.add(`${r.empresa} ${r.tipo_comprobante} ${r.numero_comprobante}`);
        continue;
      }
      const piezaId = piezasPorClave.get(`${r.linea}|${r.tipo_pieza}|${r.variante}|${r.calidad}`);
      if (!piezaId) {
        sinPieza += 1;
        continue;
      }
      paraCargar.push({
        factura_id: factura.id,
        pieza_id: piezaId,
        ubicacion: r.ubicacion,
        cantidad: r.cantidad,
        precio_unitario: r.precio_vta,
        fecha: factura.fecha,
        linea: r.linea,
      });
    }

    const cargados = await upsertPorLotes(
      client, 'factura_items', ['factura_id', 'pieza_id', 'ubicacion', 'cantidad', 'precio_unitario'], ['factura_id', 'pieza_id'],
      paraCargar
    );

    // Líneas importadas (Belmond, Lira): sincronizar producción (tipo='venta')
    // con lo recién cargado, igual que scripts/import-salidas-stock.cjs.
    const piezaIdsImportadas = [...new Set(
      paraCargar.filter((r) => LINEAS_IMPORTADAS.has(r.linea)).map((r) => r.pieza_id)
    )];
    const fechasImportadas = [...new Set(
      paraCargar.filter((r) => LINEAS_IMPORTADAS.has(r.linea)).map((r) => r.fecha)
    )];

    let produccionSincronizada = 0;
    if (piezaIdsImportadas.length > 0) {
      // Se agrupa también por ubicación (factura_items.ubicacion) para que
      // una venta de Belmond/Lira desde Lanús no se mezcle con la de
      // Alberti en el mismo día — ver schema_piezas.sql.
      const { rows: sumaRows } = await client.query(
        `select fi.pieza_id, f.fecha, fi.ubicacion, sum(fi.cantidad) as total
         from public.factura_items fi
         join public.facturas f on f.id = fi.factura_id
         where fi.pieza_id = any($1::int[]) and f.fecha = any($2::date[])
         group by fi.pieza_id, f.fecha, fi.ubicacion`,
        [piezaIdsImportadas, fechasImportadas]
      );
      const filasProduccion = sumaRows.map((s) => ({
        fecha: s.fecha,
        pieza_id: s.pieza_id,
        tipo: 'venta',
        ubicacion: s.ubicacion,
        cantidad: Number(s.total || 0),
        cargado_por: 'sync-salidas-stock',
      }));
      produccionSincronizada = await upsertPorLotes(
        client, 'produccion', ['fecha', 'pieza_id', 'tipo', 'ubicacion', 'cantidad', 'cargado_por'], ['fecha', 'pieza_id', 'tipo', 'ubicacion'],
        filasProduccion
      );
    }

    return NextResponse.json({
      ok: true,
      renglones_leidos: registros.length,
      renglones_agrupados: grupos.size,
      cargados,
      sin_factura: sinFactura,
      sin_factura_ejemplos: [...facturasSinMatch].slice(0, 10),
      sin_pieza: sinPieza,
      sin_mapear: sinMapear,
      produccion_sincronizada: produccionSincronizada,
    });
  } finally {
    await client.end();
  }
}
