/**
 * lib/supabase.ts — Single Supabase client for the Next.js frontend.
 *
 * Uses createBrowserClient from @supabase/ssr so that the session is stored
 * in cookies (not just localStorage). This is required for the Next.js
 * middleware to read the session server-side and protect /app/* routes.
 *
 * If you use createClient from @supabase/supabase-js, sessions go to
 * localStorage only — the middleware can never see them → infinite /login redirect.
 */
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend .env.local'
  );
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
