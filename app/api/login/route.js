import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';

export async function POST(request) {
  const formData = await request.formData();
  const username = (formData.get('username') || '').toString().trim().toLowerCase();
  const password = (formData.get('password') || '').toString();

  const invalidResponse = () => NextResponse.redirect(new URL('/login?error=1', request.url), 303);

  if (!username || !password) return invalidResponse();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let user;
  try {
    await client.connect();
    const { rows } = await client.query('select * from public.usuarios where username = $1', [username]);
    user = rows[0];
  } finally {
    await client.end();
  }

  if (!user) return invalidResponse();

  const computedHash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  const storedHash = Buffer.from(user.password_hash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  const valid = storedHash.length === computedBuffer.length && crypto.timingSafeEqual(storedHash, computedBuffer);
  if (!valid) return invalidResponse();

  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 días
  const payload = `${user.username}:${exp}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  const token = `${payload}:${sig}`;

  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set('worcer_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
