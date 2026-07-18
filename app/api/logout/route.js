import { NextResponse } from 'next/server';

export async function GET(request) {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.delete('worcer_auth');
  return response;
}
