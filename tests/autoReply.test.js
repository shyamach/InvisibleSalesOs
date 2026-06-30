/**
 * tests/autoReply.test.js
 * Rule #1 coverage for the auto-reply decision engine (lib/autoReply.js).
 * Pure functions — no mocks, no network, deterministic via injected clock.
 */
import { describe, it, expect } from 'vitest';
import {
  decideAutoReply,
  normalisePriority,
  DEFAULT_AUTO_REPLY,
} from '../lib/autoReply.js';

const FIXED_NOW = new Date('2026-06-28T12:00:00.000Z');

// A fully-enabled tenant config following the board's default rules.
const enabledCfg = {
  enabled: true,
  priority_rules: { HIGH: 'manual', MEDIUM: 'window', LOW: 'auto' },
  window_minutes: 30,
};

describe('normalisePriority', () => {
  it('passes through HIGH/MEDIUM/LOW (case-insensitive)', () => {
    expect(normalisePriority('high')).toBe('HIGH');
    expect(normalisePriority('Medium')).toBe('MEDIUM');
    expect(normalisePriority('LOW')).toBe('LOW');
  });

  it('maps parser NORMAL to MEDIUM', () => {
    expect(normalisePriority('NORMAL')).toBe('MEDIUM');
  });

  it('falls back to score bands when priority is unknown', () => {
    expect(normalisePriority(null, 85)).toBe('HIGH');
    expect(normalisePriority(undefined, 55)).toBe('MEDIUM');
    expect(normalisePriority('???', 10)).toBe('LOW');
  });

  it('defaults to MEDIUM when nothing usable is supplied', () => {
    expect(normalisePriority(null, null)).toBe('MEDIUM');
    expect(normalisePriority('')).toBe('MEDIUM');
  });
});

describe('decideAutoReply — HIGH safety rule', () => {
  it('forces HIGH to manual even when tenant routes HIGH to auto', () => {
    const cfg = { ...enabledCfg, priority_rules: { ...enabledCfg.priority_rules, HIGH: 'auto' } };
    const d = decideAutoReply({ priority: 'HIGH', tenantAutoReply: cfg, now: FIXED_NOW });
    expect(d.action).toBe('manual');
    expect(d.status).toBe('manual_review');
    expect(d.scheduled_dispatch_at).toBeNull();
    expect(d.reason).toMatch(/HIGH/);
  });

  it('forces HIGH to manual even from a high numeric score', () => {
    const d = decideAutoReply({ score: 95, tenantAutoReply: enabledCfg, now: FIXED_NOW });
    expect(d.priority).toBe('HIGH');
    expect(d.action).toBe('manual');
  });
});

describe('decideAutoReply — master toggle', () => {
  it('routes everything to manual when disabled', () => {
    for (const priority of ['LOW', 'MEDIUM', 'HIGH']) {
      const d = decideAutoReply({ priority, tenantAutoReply: { ...enabledCfg, enabled: false }, now: FIXED_NOW });
      expect(d.action).toBe('manual');
    }
  });

  it('treats a null/absent tenant config as disabled (manual)', () => {
    expect(decideAutoReply({ priority: 'LOW', tenantAutoReply: null, now: FIXED_NOW }).action).toBe('manual');
    expect(decideAutoReply({ priority: 'LOW', now: FIXED_NOW }).action).toBe('manual');
  });
});

describe('decideAutoReply — per-priority routing (enabled)', () => {
  it('LOW → immediate auto-dispatch', () => {
    const d = decideAutoReply({ priority: 'LOW', tenantAutoReply: enabledCfg, now: FIXED_NOW });
    expect(d.action).toBe('auto_dispatch');
    expect(d.status).toBe('dispatched');
    expect(d.scheduled_dispatch_at).toBeNull();
    expect(d.window_minutes).toBeNull();
  });

  it('MEDIUM → scheduled with a correctly computed window timestamp', () => {
    const d = decideAutoReply({ priority: 'MEDIUM', tenantAutoReply: enabledCfg, now: FIXED_NOW });
    expect(d.action).toBe('scheduled');
    expect(d.status).toBe('scheduled');
    expect(d.window_minutes).toBe(30);
    expect(d.scheduled_dispatch_at).toBe('2026-06-28T12:30:00.000Z');
  });

  it('honours a custom window_minutes value', () => {
    const d = decideAutoReply({
      priority: 'MEDIUM',
      tenantAutoReply: { ...enabledCfg, window_minutes: 90 },
      now: FIXED_NOW,
    });
    expect(d.window_minutes).toBe(90);
    expect(d.scheduled_dispatch_at).toBe('2026-06-28T13:30:00.000Z');
  });
});

describe('decideAutoReply — malformed config resilience', () => {
  it('falls back to defaults for garbage fields without throwing', () => {
    const d = decideAutoReply({
      priority: 'MEDIUM',
      tenantAutoReply: { enabled: 'yes', priority_rules: 'nope', window_minutes: -5 },
      now: FIXED_NOW,
    });
    // enabled:'yes' is not a boolean → falls back to default (false) → manual
    expect(d.action).toBe('manual');
  });

  it('ignores invalid per-priority modes and falls back to default rule', () => {
    const d = decideAutoReply({
      priority: 'LOW',
      tenantAutoReply: { enabled: true, priority_rules: { LOW: 'explode' }, window_minutes: 30 },
      now: FIXED_NOW,
    });
    // invalid LOW mode → default LOW rule is 'auto'
    expect(d.action).toBe('auto_dispatch');
  });

  it('always returns the documented structured shape (Rule #2)', () => {
    const d = decideAutoReply({ priority: 'MEDIUM', tenantAutoReply: enabledCfg, now: FIXED_NOW });
    expect(d).toMatchObject({
      action: expect.any(String),
      status: expect.any(String),
      priority: expect.any(String),
      auto_reply_enabled: expect.any(Boolean),
      reason: expect.any(String),
    });
    expect(d).toHaveProperty('scheduled_dispatch_at');
    expect(d).toHaveProperty('window_minutes');
  });
});

describe('DEFAULT_AUTO_REPLY', () => {
  it('matches the board-agreed defaults and is frozen', () => {
    expect(DEFAULT_AUTO_REPLY).toEqual({
      enabled: false,
      priority_rules: { HIGH: 'manual', MEDIUM: 'window', LOW: 'auto' },
      window_minutes: 30,
    });
    expect(Object.isFrozen(DEFAULT_AUTO_REPLY)).toBe(true);
  });
});
