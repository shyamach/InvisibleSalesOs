"use client";

/**
 * /app/settings — Workspace configuration.
 *
 * Was a fully static form: "Organization name" and "Domain" always showed
 * the same hardcoded placeholder values regardless of the real tenant
 * (matched this seed tenant's name by coincidence, but "invisiblesales.io"
 * as the domain never did), the notification checkboxes weren't backed by
 * any stored preference, and "Save Changes" had no onClick at all — editing
 * any field and clicking Save silently discarded the change with zero
 * feedback. Found live 2026-08-25 QA pass.
 *
 * There's no backend endpoint for updating tenant org details or
 * notification preferences (checked server.js/controllers/*.js) — building
 * that is a scoped feature, not a QA fix. Organization name now at least
 * shows the real tenant name from AuthProvider instead of a fake default;
 * the rest of the form is left visibly read-only/disabled with an honest
 * note instead of pretending Save does something.
 */

import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/components/AuthProvider";

export default function SettingsPage() {
  const { tenant } = useAuth();

  return (
    <>
      <Header
        title="Settings"
        description="Workspace configuration and team preferences"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            These settings aren&apos;t editable yet — nothing here is saved.
          </div>

          <section className="rounded-xl border border-border/60 bg-card/50 p-6 ring-1 ring-border/40">
            <h2 className="text-sm font-medium tracking-tight">
              Organization
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              General workspace details
            </p>
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-name" className="text-xs">
                  Organization name
                </Label>
                <Input
                  id="org-name"
                  value={tenant?.name ?? "—"}
                  disabled
                  className="h-9 border-border/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-domain" className="text-xs">
                  Owner email
                </Label>
                <Input
                  id="org-domain"
                  value={tenant?.owner_email ?? "—"}
                  disabled
                  className="h-9 border-border/80"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border/60 bg-card/50 p-6 ring-1 ring-border/40">
            <h2 className="text-sm font-medium tracking-tight">
              Notifications
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Alert preferences for pipeline events — not yet configurable
            </p>
            <div className="mt-5 space-y-3">
              {[
                "New lead captured via WhatsApp",
                "Email ingestion failures",
                "Weekly revenue attribution report",
              ].map((item) => (
                <label
                  key={item}
                  className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3 opacity-60"
                >
                  <span className="text-sm text-foreground/80">{item}</span>
                  <input
                    type="checkbox"
                    defaultChecked
                    disabled
                    className="size-4 rounded border-border accent-foreground"
                  />
                </label>
              ))}
            </div>
          </section>

          <Separator className="opacity-60" />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled>
              Cancel
            </Button>
            <Button size="sm" disabled title="Not connected to a save endpoint yet">
              Save Changes
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
