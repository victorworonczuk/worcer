import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';

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

// Carga (o actualiza) el tipo de cambio de un mes y completa importe_usd de
// las facturas de ese mes que todavía no lo tengan (el importador automático
// de "Importar ventas" nunca calcula el valor en dólares — ver
// schema_tipo_cambio.sql). No toca facturas que ya tenían su propio tipo de
// cambio (carga histórica o "Cargar factura" a mano).
export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { mes, valor } = await request.json();
  if (!/^\d{4}-\d{2}$/.test(mes || '')) {
    return NextResponse.json({ error: 'Mes inválido' }, { status: 400 });
  }
  const valorNum = Number(valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    return NextResponse.json({ error: 'El valor del tipo de cambio tiene que ser mayor a 0' }, { status: 400 });
  }
  const mesInicio = `${mes}-01`;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `insert into public.tipo_cambio (mes, valor, cargado_por)
       values ($1, $2, $3)
       on conflict (mes) do update set valor = excluded.valor, cargado_por = excluded.cargado_por, updated_at = now()`,
      [mesInicio, valorNum, user]
    );

    const upd = await client.query(
      `update public.facturas
       set importe_usd = importe_ars / $1, tipo_cambio = $1
       where tipo_cambio is null
         and fecha >= $2::date and fecha < ($2::date + interval '1 month')`,
      [valorNum, mesInicio]
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, actualizadas: upd.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.end();
  }
}
