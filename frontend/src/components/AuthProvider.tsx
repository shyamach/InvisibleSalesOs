"use client";

/**
 * AuthProvider — wraps the app and manages Supabase session state.
 * Use the `useAuth()` hook to access user + session in any component.
 * Use `getAuthHeaders()` to get headers for authenticated backend API calls.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
  signOut: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  tenant: null,
  loading: true,
  signOut: async () => {},
  getAuthHeaders: () => ({}),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) fetchTenant(session.access_token);
      else setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) fetchTenant(session.access_token);
      else { setTenant(null); setLoading(false); }
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
    window.location.href = "/login";
  }

  function getAuthHeaders(): Record<string, string> {
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }

  return (
    <AuthContext.Provider value={{ session, user, tenant, loading, signOut, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
