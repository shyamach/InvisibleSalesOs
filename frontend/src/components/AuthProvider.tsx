"use client";

/**
 * AuthProvider — wraps the app and manages Supabase session state.
 * Use the `useAuth()` hook to access user + session in any component.
 * Use `getAuthHeaders()` to get headers for authenticated backend API calls.
 */

import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  trial_started_at: string | null;
  owner_email: string;
  settings: Record<string, unknown>;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  tenant: TenantInfo | null;
  loading: boolean;
  /**
   * True once /api/proxy/auth/me has resolved for a real session and come
   * back with no tenant — an authenticated user (almost always someone who
   * just came through Google/Microsoft OAuth on /login, since the
   * email/password /signup flow always provisions a tenant before it ever
   * lets anyone reach /app/*) who still needs to complete their profile.
   * frontend/src/app/app/layout.tsx redirects to /onboarding/complete-profile
   * on this — kept here rather than fetched again there, so there's exactly
   * one /api/proxy/auth/me call per session change, not two.
   */
  onboardingRequired: boolean;
  /** True only for the hardcoded platform-operator email (see requireAdmin,
   * lib/authMiddleware.js on the backend) — gates internal ops UI like the
   * /app/system sidebar link, not a tenant-level permission. */
  isPlatformAdmin: boolean;
  signOut: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  tenant: null,
  loading: true,
  onboardingRequired: false,
  isPlatformAdmin: false,
  signOut: async () => {},
  getAuthHeaders: () => ({}),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // supabase-js's onAuthStateChange fires synchronously right after
    // subscribe with an INITIAL_SESSION event carrying the current session
    // — the same session supabase.auth.getSession() would resolve to. This
    // used to be fetched twice (once via an explicit getSession() call here,
    // once via that INITIAL_SESSION event below), each call independently
    // running setSession(session) with a *new* session object, each of
    // which changed getAuthHeaders' identity (it's memoized on `session`)
    // and re-fired every effect across the app that depends on it —
    // doubling /api/proxy/auth/me itself plus every downstream fetch that
    // reads auth headers (sidebar draft count, trial badge, and every
    // page's own data load). The single onAuthStateChange subscription
    // below already covers both the initial load and subsequent changes,
    // so there's no need for a separate getSession() call.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) fetchTenant(session.access_token);
      else { setTenant(null); setOnboardingRequired(false); setIsPlatformAdmin(false); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchTenant(token: string) {
    try {
      const res = await fetch("/api/proxy/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTenant(data.tenant ?? null);
        setOnboardingRequired(!!data.onboarding_required);
        setIsPlatformAdmin(!!data.isPlatformAdmin);
      }
    } catch {
      // Non-fatal — tenant info is cosmetic at this stage
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setTenant(null);
    setOnboardingRequired(false);
    setIsPlatformAdmin(false);
    window.location.href = "/login";
  }

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [session]);

  return (
    <AuthContext.Provider value={{ session, user, tenant, loading, onboardingRequired, isPlatformAdmin, signOut, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
