import { describe, expect, it } from 'vitest';
import { computeAdvice, headlineText } from '../src/advice.js';
import type { CostBreakdown } from '../src/pricing.js';
import { emptyTotals, type ScanResult } from '../src/scan.js';

// 15-day window: 2026-01-01 → 2026-01-16, so $X over the window ⇒ $2X/mo
function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    files: 1,
    bytes: 0,
    stats: { lines: 0, parsed: 0, skipped: 0 },
    sessions: 3,
    assistantTurns: 1000,
    totals: { ...emptyTotals(), cacheRead: 1_000_000 },
    subagentTotals: emptyTotals(),
    byModel: new Map(),
    tools: [],
    repeatedReads: [],
    cache: { expiryEvents: 0, recreationTokens: 0, avoidableWith1h: 0, recreationDollars: 0, topEvents: [] },
    startups: [],
    mcpCalls: new Map(),
    subagentGroups: [],
    sessionStats: [],
    contextResets: 0,
    firstTimestamp: '2026-01-01T00:00:00.000Z',
    lastTimestamp: '2026-01-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeCost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1000, ...overrides };
}

describe('computeAdvice', () => {
  it('projects idle-rebuild savings to a month from the data window', () => {
    const r = makeResult({
      cache: {
        expiryEvents: 10,
        recreationTokens: 5_000_000,
        avoidableWith1h: 0,
        recreationDollars: 100, // 10% of total → above the 5% gate
        topEvents: [],
      },
    });
    const advice = computeAdvice(r, makeCost());
    expect(advice.windowDays).toBeCloseTo(15, 5);
    const fix = advice.fixes.find((f) => f.id === 'idle-rebuilds');
    expect(fix).toBeDefined();
    expect(fix!.monthlyDollars).toBeCloseTo(200, 5); // $100 over 15 days = $200/mo
  });

  it('gates the idle-rebuild fix below a 5% share', () => {
    const r = makeResult({
      cache: { expiryEvents: 2, recreationTokens: 1000, avoidableWith1h: 0, recreationDollars: 10, topEvents: [] },
    });
    const advice = computeAdvice(r, makeCost());
    expect(advice.fixes.find((f) => f.id === 'idle-rebuilds')).toBeUndefined();
  });

  it('prices the startup prefix as cache reads carried on every turn', () => {
    // 30k median × 1,000 turns × $0.50/M cache-read = $15 over 15 days → trim ⅓ → $10/mo
    const r = makeResult({
      startups: [
        { project: 'p', sessionId: 'a', inputUncached: 0, cacheRead: 30_000, cacheCreation: 0 },
        { project: 'p', sessionId: 'b', inputUncached: 0, cacheRead: 30_000, cacheCreation: 0 },
        { project: 'p', sessionId: 'c', inputUncached: 0, cacheRead: 30_000, cacheCreation: 0 },
      ],
    });
    const advice = computeAdvice(r, makeCost({ cacheRead: 0.5 }));
    const fix = advice.fixes.find((f) => f.id === 'startup-tax');
    expect(fix).toBeDefined();
    expect(fix!.monthlyDollars).toBeCloseTo(10, 5);
  });

  it('builds the headline from the top fix', () => {
    const r = makeResult({
      cache: {
        expiryEvents: 10,
        recreationTokens: 5_000_000,
        avoidableWith1h: 0,
        recreationDollars: 300,
        topEvents: [],
      },
    });
    const advice = computeAdvice(r, makeCost());
    expect(headlineText(advice.headline)).toContain('rebuild expired cache');
    expect(headlineText(advice.headline)).toContain('$300.00');
  });

  it('falls back to a clean-burn headline when nothing triggers', () => {
    const advice = computeAdvice(makeResult(), makeCost());
    expect(advice.fixes).toHaveLength(0);
    expect(headlineText(advice.headline)).toContain('Clean burn');
  });
});
