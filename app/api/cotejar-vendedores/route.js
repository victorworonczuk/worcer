import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { ejecutarCotejo } from '../../../lib/cotejarVendedor.js';

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

// Corre el cruce (lib/cotejarVendedor.js:ejecutarCotejo) contra la base y
// devuelve el resultado. El mismo cruce también se dispara solo al final de
// un import de ventas o de pedidos (ver esos routes) — esta ruta queda para
// que la pantalla lo vuelva a correr on-demand (ej. al revisar los días
// ambiguos) sin tener que resubir ningún archivo.
export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const resultado = await ejecutarCotejo(client);
    return NextResponse.json({ ok: true, ...resultado });
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
