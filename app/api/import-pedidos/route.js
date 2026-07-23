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

  let filas, sinMapear;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    ({ filas, sinMapear } = await parsePedidosVendedorXlsx(buffer));
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (filas.length === 0) {
    return NextResponse.json({ error: 'No se encontraron hojas con el formato esperado (nombradas AAAA-MM, con las tablas "CANTIDAD DE PEDIDOS" y "PEDIDOS VALORIZADOS").' }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Insert por lotes (una sola query por lote, no una por fila): con ~1700
    // filas típicas de un año de tablero, uno por fila tardaba minutos por la
    // latencia de red a la base remota.
    const TAMANO_LOTE = 500;
    let cargadas = 0;
    for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
      const lote = filas.slice(i, i + TAMANO_LOTE);
      const valores = [];
      const placeholders = lote.map((f, idx) => {
        const base = idx * 5;
        valores.push(f.vendedor, f.fecha, f.cantidad, f.monto_ars, user);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      await client.query(
        `insert into public.pedidos_vendedor (vendedor, fecha, cantidad, monto_ars, cargado_por)
         values ${placeholders.join(', ')}
         on conflict (vendedor, fecha) do update
           set cantidad = excluded.cantidad, monto_ars = excluded.monto_ars,
               cargado_por = excluded.cargado_por, updated_at = now()`,
        valores
      );
      cargadas += lote.length;
    }

    return NextResponse.json({
      ok: true,
      filas_leidas: filas.length,
      filas_cargadas: cargadas,
      sin_mapear: sinMapear,
    });
  } finally {
    await client.end();
  }
}
