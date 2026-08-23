"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  MessageCircle,
  ServerOff,
} from "lucide-react";
import QRCode from "react-qr-code";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const STATUS_ENDPOINT = "/api/status";
const POLL_INTERVAL_MS = 3000;

type EngineStatus = "disconnected" | "awaiting_scan" | "connected";

interface EngineStatusResponse {
  status: EngineStatus;
  qr?: string;
}

function WhatsAppStatusBadge({ status }: { status: EngineStatus }) {
  if (status === "connected") {
    return (
      <Badge
        variant="default"
        className="bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400"
      >
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
        🟢 Channel Live
      </Badge>
    );
  }

  if (status === "awaiting_scan") {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400"
      >
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500" />
        Awaiting Scan
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="bg-muted text-muted-foreground"
    >
      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-muted-foreground" />
      Disconnected
    </Badge>
  );
}

function WhatsAppEnginePanel({
  status,
  qrPayload,
}: {
  status: EngineStatus;
  qrPayload: string | null;
}) {
  if (status === "disconnected") {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-foreground/[0.02] px-6 py-10"
      >
        <div className="flex size-12 items-center justify-center rounded-full border border-border/60 bg-background">
          <ServerOff
            className="size-5 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </div>
        <p className="mt-4 text-center text-sm font-medium text-foreground/80">
          WhatsApp isn&apos;t connected yet
        </p>
        <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
          We&apos;re reaching out to set up your connection. A QR code will
          appear here as soon as it&apos;s ready to scan.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          Checking connection status automatically
        </div>
      </div>
    );
  }

  if (status === "awaiting_scan") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-foreground/[0.02] px-6 py-10">
        <div
          className="flex size-40 items-center justify-center rounded-lg border border-border/60 bg-white p-3"
          role="img"
          aria-label="WhatsApp authentication QR code. Open WhatsApp on your phone, go to Linked Devices, and scan this code."
        >
          {qrPayload ? (
            <QRCode
              value={qrPayload}
              size={148}
              level="M"
              className="h-auto max-w-full"
            />
          ) : (
            <div className="size-[148px] animate-pulse rounded-md bg-muted" />
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Scan this code with WhatsApp to connect your number
        </p>
        <p className="mt-1 text-center text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
          This code refreshes automatically if it expires
        </p>
        <p className="sr-only" aria-live="polite">
          Awaiting WhatsApp scan. The QR code will update automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-10">
      <div className="flex size-12 items-center justify-center rounded-full border border-emerald-500/30 bg-background">
        <CheckCircle2
          className="size-6 text-emerald-600 dark:text-emerald-400"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </div>
      <p className="mt-4 text-center text-sm font-medium text-foreground/90">
        WhatsApp is connected
      </p>
      <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
        Your WhatsApp number is linked and ready to send and receive
        messages. No QR scan is needed unless the connection drops.
      </p>
      <p className="sr-only" aria-live="polite">
        WhatsApp channel is live and connected.
      </p>
    </div>
  );
}

export default function IntegrationsPage() {
  const [engineStatus, setEngineStatus] =
    useState<EngineStatus>("disconnected");
  const [qrPayload, setQrPayload] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const response = await fetch(STATUS_ENDPOINT);

        if (!response.ok) {
          throw new Error(`Status request failed: ${response.status}`);
        }

        const data = (await response.json()) as EngineStatusResponse;

        if (cancelled) return;

        setEngineStatus(data.status);
        setQrPayload(data.qr ?? null);
      } catch {
        if (cancelled) return;

        setEngineStatus("disconnected");
        setQrPayload(null);
      }
    };

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <>
      <Header
        title="Integrations"
        description="Connect and manage your revenue channels"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 md:grid-cols-2">
            {/* WhatsApp Connection */}
            <Card className="border-border/60 shadow-none ring-1 ring-border/40">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03]">
                      <MessageCircle
                        className="size-5 text-foreground/70"
                        strokeWidth={1.5}
                      />
                    </div>
                    <div>
                      <CardTitle>WhatsApp Connection</CardTitle>
                      <CardDescription className="mt-0.5">
                        Send and receive customer messages on WhatsApp
                      </CardDescription>
                    </div>
                  </div>
                  <WhatsAppStatusBadge status={engineStatus} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <WhatsAppEnginePanel
                  status={engineStatus}
                  qrPayload={qrPayload}
                />
              </CardContent>
              <CardFooter className="flex gap-2 border-t border-border/50">
                <Button variant="outline" size="sm" disabled>
                  Disconnect
                </Button>
                <Button variant="ghost" size="sm" disabled>
                  Refresh QR
                </Button>
              </CardFooter>
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
