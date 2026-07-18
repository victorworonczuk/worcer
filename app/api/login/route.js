import { NextResponse } from 'next/server';

export async function POST(request) {
  const formData = await request.formData();
  const username = formData.get('username');
  const password = formData.get('password');

  if (username === process.env.BASIC_AUTH_USER && password === process.env.BASIC_AUTH_PASS) {
    const response = NextResponse.redirect(new URL('/', request.url), 303);
    response.cookies.set('worcer_auth', process.env.SESSION_SECRET, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
}
