import { NextResponse } from 'next/server';
import crypto from 'crypto';

const ALLOWED_FROM = new Set([
  'ventas@porcelanasalberti.com.ar',
  'administracion@porcelanasalberti.com.ar',
]);

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

  const body = await request.json();
  const { to, subject, html, from } = body;

  if (!to || !subject || !html || !from) {
    return NextResponse.json({ error: 'Faltan campos (to, subject, html, from)' }, { status: 400 });
  }
  if (!ALLOWED_FROM.has(from)) {
    return NextResponse.json({ error: `Remitente no permitido: ${from}` }, { status: 400 });
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Worcer <${from}>`,
      to: [to],
      subject,
      html,
    }),
  });

  const data = await resendRes.json();

  if (!resendRes.ok) {
    return NextResponse.json({ error: data.message || 'Error al enviar', detail: data }, { status: resendRes.status });
  }

  return NextResponse.json({ ok: true, id: data.id, enviado_por: user });
}
