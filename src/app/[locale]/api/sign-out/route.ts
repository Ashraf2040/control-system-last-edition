import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET(req) {
  const { signOut } = auth();
  
  try {
    await signOut(); // Signs out the user
    return NextResponse.redirect(new URL('/sign-in', req.url));
  } catch (error) {
    console.error('Sign-out error:', error);
    return new NextResponse('Sign-out failed', { status: 500 });
  }
}