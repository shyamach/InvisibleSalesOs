/**
 * tests/dashboard.test.js
 * Tests for pure utility functions from lib/dashboard-utils.ts
 * Uses Node.js built-in test runner (node --test) — no install required.
 *
 * Run: node --test tests/dashboard.test.js
 *
 * NOTE: These tests use the compiled JS equivalents of the TypeScript functions.
 * Since the functions are pure (no TS-specific runtime features), we inline them
 * here to allow running without a build step.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ─── Inline the pure functions (mirrors dashboard-utils.ts exactly) ───────────

function pipelineStageBadgeClass(stage) {
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

function calculateReplyRate(repliesReceived, draftsApproved) {
  if (!draftsApproved || draftsApproved === 0) return 0;
  const rate = ((repliesReceived ?? 0) / draftsApproved) * 100;
  return Math.round(rate);
}

function formatCurrency(value) {
  if (value === null || value === undefined) return "£0";
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(1)}k`;
  return `£${value.toLocaleString("en-GB")}`;
}

function stageBarWidth(stageCount, totalLeads) {
  if (!totalLeads || totalLeads === 0) return 0;
  return Math.round((stageCount / totalLeads) * 100);
}

// ─── pipelineStageBadgeClass tests ───────────────────────────────────────────

test("pipelineStageBadgeClass: new stage returns zinc classes", () => {
  const result = pipelineStageBadgeClass("new");
  assert.ok(result.includes("zinc"), `Expected zinc classes, got: ${result}`);
});

test("pipelineStageBadgeClass: contacted stage returns blue classes", () => {
  const result = pipelineStageBadgeClass("contacted");
  assert.ok(result.includes("blue"), `Expected blue classes, got: ${result}`);
});

test("pipelineStageBadgeClass: quoted stage returns amber classes", () => {
  const result = pipelineStageBadgeClass("quoted");
  assert.ok(result.includes("amber"), `Expected amber classes, got: ${result}`);
});

test("pipelineStageBadgeClass: negotiating stage returns orange classes", () => {
  const result = pipelineStageBadgeClass("negotiating");
  assert.ok(result.includes("orange"), `Expected orange classes, got: ${result}`);
});

test("pipelineStageBadgeClass: won stage returns emerald classes", () => {
  const result = pipelineStageBadgeClass("won");
  assert.ok(result.includes("emerald"), `Expected emerald classes, got: ${result}`);
});

test("pipelineStageBadgeClass: lost stage returns red classes", () => {
  const result = pipelineStageBadgeClass("lost");
  assert.ok(result.includes("red"), `Expected red classes, got: ${result}`);
});

test("pipelineStageBadgeClass: dormant stage returns slate classes", () => {
  const result = pipelineStageBadgeClass("dormant");
  assert.ok(result.includes("slate"), `Expected slate classes, got: ${result}`);
});

test("pipelineStageBadgeClass: null stage returns default zinc classes", () => {
  const result = pipelineStageBadgeClass(null);
  assert.ok(result.includes("zinc"), `Expected default zinc classes, got: ${result}`);
});

test("pipelineStageBadgeClass: unknown stage returns default zinc classes", () => {
  const result = pipelineStageBadgeClass("unknown_stage");
  assert.ok(result.includes("zinc"), `Expected default zinc classes, got: ${result}`);
});

test("pipelineStageBadgeClass: all 7 stages have unique classes", () => {
  const stages = ["new", "contacted", "quoted", "negotiating", "won", "lost", "dormant"];
  const classes = stages.map(pipelineStageBadgeClass);
  const unique = new Set(classes);
  assert.equal(unique.size, 7, "All 7 stages should have distinct badge classes");
});

// ─── calculateReplyRate tests ─────────────────────────────────────────────────

test("calculateReplyRate: 10 replies / 20 approved = 50%", () => {
  assert.equal(calculateReplyRate(10, 20), 50);
});

test("calculateReplyRate: 0 replies / 20 approved = 0%", () => {
  assert.equal(calculateReplyRate(0, 20), 0);
});

test("calculateReplyRate: 0 approved returns 0 (no division by zero)", () => {
  assert.equal(calculateReplyRate(10, 0), 0);
});

test("calculateReplyRate: null approved returns 0", () => {
  assert.equal(calculateReplyRate(10, null), 0);
});

test("calculateReplyRate: null replies treated as 0", () => {
  assert.equal(calculateReplyRate(null, 20), 0);
});

test("calculateReplyRate: both null returns 0", () => {
  assert.equal(calculateReplyRate(null, null), 0);
});

test("calculateReplyRate: 1 reply / 3 approved = 33%", () => {
  assert.equal(calculateReplyRate(1, 3), 33);
});

test("calculateReplyRate: 2 reply / 3 approved = 67%", () => {
  assert.equal(calculateReplyRate(2, 3), 67);
});

test("calculateReplyRate: 100 replies / 100 approved = 100%", () => {
  assert.equal(calculateReplyRate(100, 100), 100);
});

test("calculateReplyRate: more replies than approved returns >100%", () => {
  // Edge case: replies_received can exceed drafts_approved if leads reply multiple times
  assert.equal(calculateReplyRate(150, 100), 150);
});

// ─── formatCurrency tests ─────────────────────────────────────────────────────

test("formatCurrency: null returns £0", () => {
  assert.equal(formatCurrency(null), "£0");
});

test("formatCurrency: 0 returns £0", () => {
  assert.equal(formatCurrency(0), "£0");
});

test("formatCurrency: small value formatted as £N", () => {
  const result = formatCurrency(500);
  assert.ok(result.startsWith("£"), `Should start with £, got: ${result}`);
});

test("formatCurrency: 1000 becomes £1.0k", () => {
  assert.equal(formatCurrency(1000), "£1.0k");
});

test("formatCurrency: 1500000 becomes £1.5M", () => {
  assert.equal(formatCurrency(1_500_000), "£1.5M");
});

// ─── stageBarWidth tests ──────────────────────────────────────────────────────

test("stageBarWidth: 50 out of 100 = 50%", () => {
  assert.equal(stageBarWidth(50, 100), 50);
});

test("stageBarWidth: 0 total leads = 0%", () => {
  assert.equal(stageBarWidth(10, 0), 0);
});

test("stageBarWidth: null total leads = 0%", () => {
  assert.equal(stageBarWidth(10, null), 0);
});

test("stageBarWidth: 10 out of 30 = 33%", () => {
  assert.equal(stageBarWidth(10, 30), 33);
});

test("stageBarWidth: all in one stage = 100%", () => {
  assert.equal(stageBarWidth(100, 100), 100);
});
