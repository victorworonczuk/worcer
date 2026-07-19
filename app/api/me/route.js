import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { Client } from 'pg';

export async function GET(request) {
  const cookie = request.cookies.get('worcer_auth');
  if (!cookie) return NextResponse.json({ user: null });

  const parts = cookie.value.split(':');
  if (parts.length !== 3) return NextResponse.json({ user: null });
  const [username, exp, sig] = parts;
  if (Date.now() > Number(exp)) return NextResponse.json({ user: null });

  const payload = `${username}:${exp}`;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  if (expected !== sig) return NextResponse.json({ user: null });

  let rol = null;
  let nombre = null;
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const { rows } = await client.query('select rol, nombre from public.usuarios where username = $1', [username]);
    await client.end();
    if (rows[0]) {
      rol = rows[0].rol;
      nombre = rows[0].nombre;
    }
  } catch (err) {
    console.error('Error consultando rol de usuario', err);
  }

  return NextResponse.json({ user: username, rol, nombre });
}
