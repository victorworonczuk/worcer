import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/login'];

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get('worcer_auth');
  if (cookie && cookie.value === process.env.SESSION_SECRET) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
