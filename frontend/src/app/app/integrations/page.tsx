"use client";

import { Mail, MessageCircle } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// WhatsApp connection is set up by our team, not self-serve: the backend
// runs a single shared WhatsApp session today, not one per tenant, so a
// self-serve QR/status view here could expose or disrupt another tenant's
// live connection. Swapped for a concierge panel until per-tenant session
// isolation exists (2026-08-23).
function WhatsAppConciergePanel() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-foreground/[0.02] px-6 py-10">
      <div className="flex size-12 items-center justify-center rounded-full border border-border/60 bg-background">
        <MessageCircle
          className="size-5 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </div>
      <p className="mt-4 text-center text-sm font-medium text-foreground/80">
        We connect this with you personally
      </p>
      <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
        To make sure it&apos;s linked correctly, our team sets up your
        WhatsApp connection rather than a self-serve scan.
      </p>
      <a
        href="https://wa.me/447767902011"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ size: "sm", className: "mt-4" })}
      >
        Message us on WhatsApp
      </a>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <>
      <Header
        title="Integrations"
        description="Connect and manage your revenue channels"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 md:grid-cols-2">
            {/* WhatsApp Guerrilla Engine */}
            <Card className="border-border/60 shadow-none ring-1 ring-border/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03]">
                    <MessageCircle
                      className="size-5 text-foreground/70"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <CardTitle>WhatsApp Guerrilla Engine</CardTitle>
                    <CardDescription className="mt-0.5">
                      Headless browser session for inbound capture
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <WhatsAppConciergePanel />
              </CardContent>
            </Card>

            {/* Email Ingestion */}
            <Card className="border-border/60 shadow-none ring-1 ring-border/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03]">
                    <Mail
                      className="size-5 text-foreground/70"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <CardTitle>Email Ingestion</CardTitle>
                    <CardDescription className="mt-0.5">
                      IMAP listener &amp; SMTP relay configuration
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    IMAP (Inbound)
                  </p>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="imap-host" className="text-xs">
                        Host
                      </Label>
                      <Input
                        id="imap-host"
                        placeholder="imap.company.com"
                        className="h-9 border-border/80"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="imap-port" className="text-xs">
                          Port
                        </Label>
                        <Input
                          id="imap-port"
                          placeholder="993"
                          className="h-9 border-border/80"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="imap-user" className="text-xs">
                          Username
                        </Label>
                        <Input
                          id="imap-user"
                          placeholder="inbox@company.com"
                          className="h-9 border-border/80"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    SMTP (Outbound)
                  </p>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-host" className="text-xs">
                        Host
                      </Label>
                      <Input
                        id="smtp-host"
                        placeholder="smtp.company.com"
                        className="h-9 border-border/80"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-port" className="text-xs">
                          Port
                        </Label>
                        <Input
                          id="smtp-port"
                          placeholder="587"
                          className="h-9 border-border/80"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-user" className="text-xs">
                          Username
                        </Label>
                        <Input
                          id="smtp-user"
                          placeholder="noreply@company.com"
                          className="h-9 border-border/80"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/50">
                <Button size="sm">Save Configuration</Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
