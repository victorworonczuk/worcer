import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parsePedidosVendedorXlsx } from '../../../lib/pedidosVendedorXlsx.js';

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

export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const formData = await request.formData();
  const archivo = formData.get('archivo');
  if (!archivo) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  let filas, proyecciones, sinMapear;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    ({ filas, proyecciones, sinMapear } = await parsePedidosVendedorXlsx(buffer));
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (filas.length === 0) {
    return NextResponse.json({ error: 'No se encontraron hojas con el formato esperado (nombradas AAAA-MM, con las tablas "CANTIDAD DE PEDIDOS" y "PEDIDOS VALORIZADOS").' }, { status: 400 });
  }

  // Insert por lotes (una sola query por lote, no una por fila): con ~1700
  // filas típicas de un año de tablero, uno por fila tardaba minutos por la
  // latencia de red a la base remota.
  async function upsertPorLotes(client, tabla, columnas, columnasConflicto, filas) {
    const TAMANO_LOTE = 500;
    let cargadas = 0;
    const setClause = columnas
      .filter((c) => !columnasConflicto.includes(c) && c !== 'cargado_por')
      .map((c) => `${c} = excluded.${c}`)
      .concat(['cargado_por = excluded.cargado_por', 'updated_at = now()'])
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

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const cargadas = await upsertPorLotes(
      client, 'pedidos_vendedor', ['vendedor', 'fecha', 'cantidad', 'monto_ars', 'cargado_por'], ['vendedor', 'fecha'],
      filas.map((f) => ({ ...f, cargado_por: user }))
    );
    const proyeccionesCargadas = await upsertPorLotes(
      client, 'pedidos_vendedor_proyeccion', ['vendedor', 'mes', 'proyectado_cantidad', 'proyectado_monto', 'cargado_por'], ['vendedor', 'mes'],
      proyecciones.map((p) => ({ ...p, cargado_por: user }))
    );

    return NextResponse.json({
      ok: true,
      filas_leidas: filas.length,
      filas_cargadas: cargadas,
      proyecciones_cargadas: proyeccionesCargadas,
      sin_mapear: sinMapear,
    });
  } finally {
    await client.end();
  }
}
