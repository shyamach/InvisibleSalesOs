import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  // Optional — no page currently has a real week-over-week trend computed
  // server-side. Analytics used to hardcode a plausible-looking change/trend
  // for every card (see frontend/src/lib/mock-data.ts, removed 2026-08-25);
  // making these optional lets real-data callers show a bare number instead
  // of fabricating a percentage that has no basis.
  change?: string;
  trend?: "up" | "down";
  description: string;
}

export function MetricCard({
  title,
  value,
  change,
  trend,
  description,
}: MetricCardProps) {
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="border-border/60 bg-card/50 shadow-none ring-1 ring-border/40">
      <CardHeader className="pb-0">
        <CardTitle className="text-xs font-normal uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <div className="flex items-end justify-between">
          <p className="text-2xl font-medium tracking-tight text-foreground">
            {value}
          </p>
          {change && (
            <div
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                trend === "up" ? "text-foreground/70" : "text-muted-foreground"
              )}
            >
              <TrendIcon className="size-3.5" strokeWidth={1.5} />
              {change}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
