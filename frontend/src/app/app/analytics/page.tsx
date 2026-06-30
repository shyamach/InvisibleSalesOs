import { Header } from "@/components/layout/header";
import { InquiriesChart } from "@/components/dashboard/inquiries-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { dashboardMetrics } from "@/lib/mock-data";

export default function AnalyticsPage() {
  return (
    <>
      <Header
        title="Analytics"
        description="Deep-dive performance metrics and attribution modeling"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardMetrics.map((metric) => (
              <MetricCard key={metric.title} {...metric} />
            ))}
          </div>

          <InquiriesChart />

          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                title: "Channel Attribution",
                rows: [
                  { channel: "WhatsApp", share: "62%", leads: "1,765" },
                  { channel: "Email", share: "28%", leads: "798" },
                  { channel: "Direct", share: "10%", leads: "284" },
                ],
              },
              {
                title: "Reply Performance",
                rows: [
                  { channel: "< 1 min", share: "74%", leads: "13,610" },
                  { channel: "1–5 min", share: "19%", leads: "3,494" },
                  { channel: "> 5 min", share: "7%", leads: "1,288" },
                ],
              },
            ].map((block) => (
              <div
                key={block.title}
                className="rounded-xl border border-border/60 bg-card/50 p-6 ring-1 ring-border/40"
              >
                <h3 className="text-sm font-medium tracking-tight">
                  {block.title}
                </h3>
                <div className="mt-4 space-y-3">
                  {block.rows.map((row) => (
                    <div
                      key={row.channel}
                      className="flex items-center justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                    >
                      <span className="text-sm text-muted-foreground">
                        {row.channel}
                      </span>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">
                          {row.share}
                        </span>
                        <span className="text-sm font-medium tabular-nums">
                          {row.leads}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
