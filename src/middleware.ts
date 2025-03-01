import { NextRequest, NextResponse } from 'next/server';
import { clerkMiddleware, clerkClient } from '@clerk/nextjs/server';
import createMiddleware from 'next-intl/middleware';

const intlMiddleware = createMiddleware({
  locales: ['en', 'ar'],
  defaultLocale: 'en',
  localePrefix: 'always', // Force locale prefix for consistency
});

const publicRoutes = ['/sign-in', '/en/sign-in', '/ar/sign-in'];
const protectedRoutes = {
  TEACHER: ['/admin', '/class-subjects', '/teacherProgress', '/teacherCreation', '/studentsManage'],
};

export default clerkMiddleware(async (auth, req) => {
  console.log("Middleware started for:", req.nextUrl.pathname);
  console.log("Base URL from env:", process.env.NEXT_PUBLIC_BASE_URL);
  console.log("Request URL:", req.url);
  console.log("Request Host:", req.headers.get('host'));
  console.log("Next URL:", req.nextUrl.href);
  console.log("Clerk after sign-out URL:", process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL);

  try {
    const pathname = req.nextUrl.pathname;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ashrafdev.com';

    // Redirect root /sign-in to /en/sign-in
    if (pathname === '/sign-in') {
      const signInUrl = new URL(`${baseUrl}/en/sign-in`);
      console.log("Redirecting root /sign-in to:", signInUrl.toString());
      return NextResponse.redirect(signInUrl);
    }

    // Apply intlMiddleware first to ensure locale resolution
    const intlResponse = intlMiddleware(req);
    if (intlResponse) {
      // Check if it's a public route after intl middleware
      if (publicRoutes.some(route => pathname.startsWith(route))) {
        console.log("Public route accessed:", pathname);
        return intlResponse;
      }
    }

    // Check authentication
    const session = auth();
    if (!session || !session.userId) {
      const host = req.headers.get('host') || 'ashrafdev.com';
      const protocol = req.headers.get('x-forwarded-proto') || 'https';
      const requestBaseUrl = `${protocol}://${host}`;
      const signInUrl = new URL(`${baseUrl}/en/sign-in`);

      if (!publicRoutes.some(route => pathname.startsWith(route)) && pathname !== '/') {
        signInUrl.searchParams.set('redirect_url', requestBaseUrl + req.nextUrl.pathname);
        console.log("Appending redirect_url:", requestBaseUrl + req.nextUrl.pathname);
      }
      console.log("Redirecting to:", signInUrl.toString());
      return NextResponse.redirect(signInUrl);
    }

    // Fetch user details
    const user = await clerkClient.users.getUser(session.userId);
    if (!user) {
      console.log("User not found in Clerk.");
      return NextResponse.redirect(new URL('/error', req.url));
    }

    const userRole = user.publicMetadata.role;
    const userSchool = user.publicMetadata.school || 'default';
    console.log(`User Role: ${userRole}, User School: ${userSchool}`);

    // Set school cookie
    const response = intlResponse || NextResponse.next();
    response.cookies.set({
      name: 'x-school',
      value: userSchool.toString(),
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
    });

    // Protect teacher-only routes
    if (userRole === 'TEACHER' && protectedRoutes.TEACHER.includes(pathname)) {
      console.log("Teacher accessing protected route.");
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }

    console.log("Middleware completed successfully.");
    return response;
  } catch (error) {
    console.error('Middleware error:', error);
    return NextResponse.redirect(new URL('/error', req.url));
  }
});

export const config = {
  matcher: [
    '/',
    '/(ar|en)/:path*',
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};