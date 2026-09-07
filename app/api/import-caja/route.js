import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseCajaXlsx } from '../../../lib/cajaXlsx.js';

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
  const archivos = formData.getAll('archivos');
  if (!archivos.length) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  let registros;
  try {
    const files = await Promise.all(
      archivos.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))
    );
    registros = await parseCajaXlsx(files);
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (registros.length === 0) {
    return NextResponse.json({ error: 'No se encontraron filas reconocibles (¿el archivo tiene hojas con encabezado Fecha/Cuenta/Detalle/Entrada/Salida/Saldo?).' }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let nuevos = 0;
    const TAMANO_LOTE = 500;
    for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
      const lote = registros.slice(i, i + TAMANO_LOTE);
      const columnas = ['fecha', 'cuenta', 'detalle', 'entrada', 'salida', 'saldo', 'es_saldo_inicial', 'cargado_por'];
      const valores = [];
      const placeholders = lote.map((r, idx) => {
        const base = idx * columnas.length;
        valores.push(r.fecha, r.cuenta, r.detalle, r.entrada, r.salida, r.saldo, r.es_saldo_inicial, 'import-caja');
        return `(${columnas.map((_, j) => `$${base + j + 1}`).join(', ')})`;
      });
      const { rowCount } = await client.query(
        `insert into public.caja (${columnas.join(', ')})
         values ${placeholders.join(', ')}
         on conflict (fecha, cuenta, detalle, entrada, salida, saldo) do nothing`,
        valores
      );
      nuevos += rowCount;
    }

    return NextResponse.json({
      ok: true,
      leidos: registros.length,
      nuevos,
      existentes: registros.length - nuevos,
    });
  } finally {
    await client.end();
  }
}
