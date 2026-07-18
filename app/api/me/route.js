import { NextResponse } from 'next/server';
import crypto from 'crypto';

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

  return NextResponse.json({ user: username });
}
