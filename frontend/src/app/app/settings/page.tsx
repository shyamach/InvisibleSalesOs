import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  return (
    <>
      <Header
        title="Settings"
        description="Workspace configuration and team preferences"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-8">
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
                  defaultValue="Invisible Sales OS"
                  className="h-9 border-border/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-domain" className="text-xs">
                  Domain
                </Label>
                <Input
                  id="org-domain"
                  defaultValue="invisiblesales.io"
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
              Alert preferences for pipeline events
            </p>
            <div className="mt-5 space-y-3">
              {[
                "New lead captured via WhatsApp",
                "Email ingestion failures",
                "Weekly revenue attribution report",
              ].map((item) => (
                <label
                  key={item}
                  className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                >
                  <span className="text-sm text-foreground/80">{item}</span>
                  <input
                    type="checkbox"
                    defaultChecked
                    className="size-4 rounded border-border accent-foreground"
                  />
                </label>
              ))}
            </div>
          </section>

          <Separator className="opacity-60" />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Save Changes</Button>
          </div>
        </div>
      </main>
    </>
  );
}
