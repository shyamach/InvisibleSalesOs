"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  FileText,
  Receipt,
  Package,
  LifeBuoy,
  Sparkles,
  Newspaper,
  CreditCard,
  Zap,
  Plug,
  Settings,
  LogOut,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

// ─── Trial badge ──────────────────────────────────────────────────────────────

function TrialBadge() {
  const { getAuthHeaders } = useAuth();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/billing/current", { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.trial_days_remaining === "number") {
          setDaysLeft(data.trial_days_remaining);
        }
      })
      .catch(() => { /* non-fatal */ });
  }, [getAuthHeaders]);

  if (daysLeft === null || daysLeft <= 0) return null;

  return (
    <div
      className="mx-3 mb-3 flex items-center justify-between rounded-lg px-3 py-2.5"
      style={{ background: 'rgba(200, 121, 65, 0.12)', border: '1px solid rgba(200, 121, 65, 0.3)' }}
    >
      <span className="text-xs" style={{ color: '#c87941' }}>
        Trial: {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
      </span>
      <Link
        href="/pricing"
        className="text-[10px] font-semibold underline underline-offset-2 transition-colors"
        style={{ color: '#c87941' }}
      >
        Upgrade
      </Link>
    </div>
  );
}

// ─── Live draft count badge ────────────────────────────────────────────────────
// 2026-08-18 audit fix (Phase B item B2) — both badges below previously
// instantiated their own throwaway anon-key Supabase client and queried
// smart_interactions with no tenant filter at all, on every /app/* page
// load (this component is rendered unconditionally in the app shell). Now
// call the authenticated GET /api/drafts/count, with the Realtime
// subscription (trigger for a refetch) running on the shared,
// session-authenticated singleton instead of a fresh anon client.

function DraftCount() {
  const { getAuthHeaders } = useAuth();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      const res = await fetch("/api/drafts/count", { headers: getAuthHeaders() });
      const json = await res.json();
      setCount(json.success ? json.count : 0);
    };

    fetchCount();

    const channel = supabase
      .channel("sidebar-draft-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "smart_interactions" }, fetchCount)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [getAuthHeaders]);

  if (!count) return null;
  return (
    <span
      className="ml-auto flex size-5 items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
      style={{ background: '#c87941', color: '#ffffff' }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ─── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: "draft";
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "WORKSPACE",
    items: [
      { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/leads",     label: "Leads",     icon: Users },
      { href: "/app/drafts",    label: "Drafts",    icon: MessageSquare, badge: "draft" },
    ],
  },
  {
    label: "PIPELINE",
    items: [
      { href: "/app/quotes",      label: "Quotes",    icon: FileText },
      { href: "/app/invoices",    label: "Invoices",  icon: Receipt },
      { href: "/app/catalogue",   label: "Catalogue", icon: Package },
      { href: "/app/escalations", label: "Handoffs",  icon: LifeBuoy },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { href: "/onboarding/brand-dna",   label: "Brand DNA",   icon: Sparkles },
      { href: "/app/integrations",       label: "Integrations", icon: Plug },
      { href: "/app/digest-preview",     label: "Digest",      icon: Newspaper },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { href: "/app/settings/auto-reply", label: "Auto-reply", icon: Zap },
      { href: "/app/settings/team",       label: "Team",       icon: Users },
      { href: "/app/billing",   label: "Billing",  icon: CreditCard },
      { href: "/app/system",    label: "System",   icon: Activity },
      { href: "/app/settings",  label: "Settings", icon: Settings },
    ],
  },
];

// All items flat — for mobile bottom nav
const allNavItems = navSections.flatMap((s) => s.items);
const mobileNavItems = allNavItems.slice(0, 5);

// ─── Nav item component ────────────────────────────────────────────────────────

function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-r-lg py-2 pl-3 pr-3 text-sm transition-colors"
      style={
        isActive
          ? {
              background: '#2a1f17',
              borderLeft: '3px solid #c87941',
              color: '#fdf3e7',
              marginLeft: '-1px',
            }
          : {
              color: '#8a7060',
              borderLeft: '3px solid transparent',
              marginLeft: '-1px',
            }
      }
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLAnchorElement).style.color = '#a89070';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLAnchorElement).style.color = '#8a7060';
        }
      }}
    >
      <Icon
        className="size-4 shrink-0"
        strokeWidth={1.5}
        style={{ color: isActive ? '#c87941' : 'inherit' }}
      />
      <span className="font-medium flex-1">{item.label}</span>
      {item.badge === "draft" && <DraftCount />}
    </Link>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut, isPlatformAdmin } = useAuth();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  // "System" is Shyama's own internal ops view (shared WhatsApp/Claude/IMAP
  // infrastructure status, platform-wide log rollups) -- not customer-facing
  // product. Hide it from every tenant except the platform operator; the
  // backend independently enforces this with requireAdmin regardless of
  // what's rendered here.
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.href !== "/app/system" || isPlatformAdmin),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex h-full flex-col"
        style={{
          width: '220px',
          minWidth: '220px',
          background: '#1c1612',
          borderRight: '1px solid #2a1f17',
        }}
      >
        {/* Logo header */}
        <div
          className="flex items-center gap-3 px-4"
          style={{
            borderBottom: '1px solid #2a1f17',
            padding: '16px',
            minHeight: '60px',
          }}
        >
          {/* IS monogram */}
          <div
            className="flex shrink-0 items-center justify-center rounded-lg text-white text-sm font-bold"
            style={{ background: '#c87941', width: '32px', height: '32px', borderRadius: '8px' }}
          >
            IS
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className="text-sm font-semibold leading-tight truncate"
              style={{ color: '#f0ebe4' }}
            >
              Invisible Sales OS
            </span>
            <span
              className="text-[10px] tracking-wider uppercase"
              style={{ color: '#6a5a4a' }}
            >
              Revenue Intelligence
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 pl-1">
          {visibleSections.map((section) => (
            <div key={section.label} className="mb-2">
              {/* Section label */}
              <p
                style={{
                  color: '#6a5a4a',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  padding: '12px 12px 4px',
                }}
              >
                {section.label}
              </p>
              {/* Items */}
              {section.items.map((item) => (
                <NavItemLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* Trial badge + user footer */}
        <div style={{ borderTop: '1px solid #2a1f17' }}>
          <TrialBadge />
          {user && (
            <div className="flex items-center gap-2.5 px-4 py-3">
              {/* Avatar */}
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{ background: '#2a1f17', color: '#c87941' }}
              >
                {user.email?.[0]?.toUpperCase() ?? "U"}
              </div>
              {/* Email */}
              <span
                className="flex-1 min-w-0 truncate text-xs"
                style={{ color: '#6a5a4a' }}
              >
                {user.email}
              </span>
              {/* Sign out */}
              <button
                onClick={signOut}
                title="Sign out"
                className="transition-colors shrink-0"
                style={{ color: '#6a5a4a' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#a89070'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#6a5a4a'; }}
              >
                <LogOut className="size-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex lg:hidden items-center justify-around border-t px-2 py-2 safe-area-inset-bottom"
        style={{ background: '#1c1612', borderColor: '#2a1f17' }}
      >
        {mobileNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-lg p-2.5 text-[10px] transition-colors"
              )}
              style={{ color: active ? '#c87941' : '#8a7060' }}
            >
              <Icon
                className="size-5"
                strokeWidth={1.5}
              />
              {item.badge === "draft" && <DraftCountDot />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** Minimal dot badge for mobile bottom nav */
function DraftCountDot() {
  const { getAuthHeaders } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const res = await fetch("/api/drafts/count", { headers: getAuthHeaders() });
      const json = await res.json();
      setCount(json.success ? json.count : 0);
    };
    fetchCount();
  }, [getAuthHeaders]);

  if (!count) return null;
  return (
    <span
      className="absolute right-1.5 top-1.5 flex size-2 rounded-full"
      style={{ background: '#c87941' }}
    />
  );
}
