import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { peticionDeAppDelGuardia } from './app/_lib/app-del-guardia';

const ROLE_PATHS = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  GUARDIA: 'guardia',
} as const;

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('sentrycore_access')?.value;
  const refreshToken = request.cookies.get('sentrycore_refresh')?.value;
  const requestedRole = request.nextUrl.pathname.split('/')[2];
  const guardApp = peticionDeAppDelGuardia(request.headers);
  const role = accessToken ? await resolveSession(request, accessToken) : null;
  if (role) {
    if (role === 'GUARDIA' && !guardApp) {
      return clearSessionAndRedirect(request);
    }

    const expectedPath = ROLE_PATHS[role];

    if (requestedRole !== expectedPath) {
      return NextResponse.redirect(new URL(`/app/${expectedPath}`, request.url));
    }

    return NextResponse.next();
  }

  // A guard's WebView can resume while another tab is already rotating the
  // refresh cookie. Let the home screen recover it using the browser's lock.
  if (guardApp && (requestedRole === 'guardia' || request.cookies.has('sentrycore_company'))) {
    return redirectToHome(request);
  }
  if (refreshToken) {
    return refreshSession(request, refreshToken);
  }
  return clearSessionAndRedirect(request);
}

async function resolveSession(
  request: NextRequest,
  accessToken: string,
): Promise<keyof typeof ROLE_PATHS | null> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) return null;

  try {
    const response = await fetch(`${apiUrl}/auth/session`, {
      headers: {
        cookie: `sentrycore_access=${accessToken}`,
        'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID(),
      },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const result = (await response.json()) as {
      user?: { role?: string } | null;
    };
    return result.user?.role && result.user.role in ROLE_PATHS
      ? (result.user.role as keyof typeof ROLE_PATHS)
      : null;
  } catch {
    return null;
  }
}

async function refreshSession(request: NextRequest, refreshToken: string) {
  const apiUrl = process.env.API_INTERNAL_URL;
  const webOrigin = process.env.WEB_ORIGIN || process.env.WEB_PUBLIC_URL;
  if (!apiUrl || !webOrigin) return redirectToHome(request);

  try {
    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `sentrycore_refresh=${refreshToken}`,
        origin: new URL(webOrigin).origin,
      },
      cache: 'no-store',
    });
    if (response.status === 401) return clearSessionAndRedirect(request);
    if (!response.ok) return redirectToHome(request);

    const cookies = response.headers.get('set-cookie')?.split(/, (?=sentrycore_)/) ?? [];
    if (!cookies.some(cookie => cookie.startsWith('sentrycore_access='))) return redirectToHome(request);
    const redirect = NextResponse.redirect(request.nextUrl);
    for (const cookie of cookies) {
      redirect.headers.append('set-cookie', cookie);
    }
    return redirect;
  } catch {
    return redirectToHome(request);
  }
}

function redirectToHome(request: NextRequest) {
  return NextResponse.redirect(new URL('/', request.url));
}

function clearSessionAndRedirect(request: NextRequest) {
  const response = redirectToHome(request);
  response.cookies.delete('sentrycore_access');
  response.cookies.delete('sentrycore_refresh');
  return response;
}

export const config = {
  matcher: ['/app/:path*'],
};
