import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/login', '/manifest.json'];

// El manifest de PWA y los íconos los pide el navegador/SO al mostrar "Agregar
// a pantalla de inicio" y para el favicon/apple-touch-icon del propio login
// — tienen que responder sin sesión, si no el middleware los redirige a
// /login y el navegador nunca consigue mostrar el ícono ni el manifest.
function esPublico(pathname) {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/icons/');
}

async function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [username, exp, sig] = parts;
  if (!username || !exp || !sig) return null;
  if (Date.now() > Number(exp)) return null;

  const payload = `${username}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedSig = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return expectedSig === sig ? username : null;
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (esPublico(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get('worcer_auth');
  const username = await verifyToken(cookie?.value, process.env.SESSION_SECRET);
  if (username) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
