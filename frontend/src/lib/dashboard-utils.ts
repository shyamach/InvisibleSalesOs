/**
 * dashboard-utils.ts
 * Pure functions for dashboard metrics and display logic.
 * Exported so they can be tested in isolation (tests/dashboard.test.js).
 */

export type PipelineStage =
  | "new"
  | "contacted"
  | "quoted"
  | "negotiating"
  | "won"
  | "lost"
  | "dormant";

/**
 * Returns the Tailwind badge class for a given pipeline stage.
 */
export function pipelineStageBadgeClass(stage: PipelineStage | string | null): string {
  switch (stage) {
    case "new":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "contacted":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400";
    case "quoted":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400";
    case "negotiating":
      return "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400";
    case "won":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400";
    case "lost":
      return "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400";
    case "dormant":
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

/**
 * Calculates reply rate as a percentage.
 * reply_rate = (replies_received / drafts_approved) * 100
 * Returns 0 if drafts_approved is 0 or null to avoid division by zero.
 */
export function calculateReplyRate(
  repliesReceived: number | null,
  draftsApproved: number | null
): number {
  if (!draftsApproved || draftsApproved === 0) return 0;
  const rate = ((repliesReceived ?? 0) / draftsApproved) * 100;
  return Math.round(rate);
}

/**
 * Formats a monetary value as GBP currency string.
 */
export function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "£0";
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(1)}k`;
  return `£${value.toLocaleString("en-GB")}`;
}

/**
 * Returns the bar width percentage for a pipeline stage breakdown chart.
 * Each stage count relative to the total.
 */
export function stageBarWidth(stageCount: number, totalLeads: number): number {
  if (!totalLeads || totalLeads === 0) return 0;
  return Math.round((stageCount / totalLeads) * 100);
}

/**
 * Returns a human-readable time-ago string from an ISO timestamp.
 */
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
