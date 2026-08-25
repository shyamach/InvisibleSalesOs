/**
 * /auth/callback — OAuth redirect target for Google/Microsoft sign-in.
 *
 * signInWithOAuth() used to redirectTo straight to /app/dashboard. That page
 * is matched by middleware.ts, which reads the session from cookies
 * server-side and redirects to /login if none is found. But the code
 * exchange (swapping the ?code=... param Google sends back for a real
 * session, writing the session cookies) only happens client-side, inside
 * the Supabase JS SDK, after the page's bundle loads — so on the very first
 * request back from Google, the middleware runs first, sees no session
 * cookie yet, and bounces the user straight back to /login before the
 * client ever gets a chance to complete the exchange. The one-time PKCE
 * code is wasted in that redirect. From the user's side this looks exactly
 * like the OAuth flow doing nothing: grant consent, land back on login as
 * if nothing happened.
 *
 * Fix: redirect here instead, exchange the code for a session server-side
 * (writing real session cookies via the response), then redirect to the
 * final destination — by which point middleware.ts sees a valid session.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/app/dashboard";

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
