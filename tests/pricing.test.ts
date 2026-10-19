import { describe, expect, test } from 'vitest';
import { costOfTotals, resolvePricing } from '../src/pricing.js';

describe('resolvePricing', () => {
  test('exact match', () => {
    expect(resolvePricing('claude-opus-4-8')).toEqual({ inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 });
    expect(resolvePricing('claude-fable-5')).toEqual({ inputPerM: 10, outputPerM: 50, cacheReadMult: 0.1 });
  });

  test('current lineup is priced, including its reduced cache-read rates', () => {
    expect(resolvePricing('claude-opus-5-5')).toEqual({ inputPerM: 4, outputPerM: 20, cacheReadMult: 0.05 });
    expect(resolvePricing('claude-sonnet-5-5')).toEqual({ inputPerM: 2, outputPerM: 10, cacheReadMult: 0.05 });
    expect(resolvePricing('claude-fable-5-1')).toEqual({ inputPerM: 10, outputPerM: 50, cacheReadMult: 0.025 });
    expect(resolvePricing('claude-haiku-5-5')).toEqual({ inputPerM: 0.1, outputPerM: 0.5, cacheReadMult: 0.1 });
  });

  test('a point release does not inherit the previous row', () => {
    // claude-opus-5 is $5/$25 at 0.1× reads; 5.5 is cheaper and reads at 0.05×
    expect(resolvePricing('claude-opus-5')).toEqual({ inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 });
    expect(resolvePricing('claude-sonnet-5')).toEqual({ inputPerM: 2, outputPerM: 10, cacheReadMult: 0.1 });
    expect(resolvePricing('claude-fable-5-1')).not.toEqual(resolvePricing('claude-fable-5'));
  });

  test('longest-prefix match handles dated IDs', () => {
    expect(resolvePricing('claude-haiku-4-5-20251001')).toEqual({ inputPerM: 1, outputPerM: 5, cacheReadMult: 0.1 });
  });

  test('cloud provider IDs resolve to the same row', () => {
    expect(resolvePricing('anthropic.claude-opus-5-5')).toEqual(resolvePricing('claude-opus-5-5'));
    expect(resolvePricing('us.anthropic.claude-sonnet-4-5')).toEqual(resolvePricing('claude-sonnet-4-5'));
  });

  test('prefix match stops at a version boundary', () => {
    // a hypothetical future id must not borrow claude-opus-5's price
    expect(resolvePricing('claude-opus-50')).toBeNull();
    expect(resolvePricing('claude-sonnet-55')).toBeNull();
  });

  test('unknown models return null instead of a guess', () => {
    expect(resolvePricing('<synthetic>')).toBeNull();
    expect(resolvePricing('gpt-4o')).toBeNull();
    // Mythos has no published model id, so it must not be guessed
    expect(resolvePricing('claude-mythos-5-1')).toBeNull();
  });
});

describe('costOfTotals', () => {
  test('applies cache multipliers to the input price', () => {
    const c = costOfTotals(
      {
        output: 1_000_000,        // × $25
        inputUncached: 1_000_000, // × $5
        cacheRead: 1_000_000,     // × $5 × 0.1
        cacheCreation5m: 1_000_000, // × $5 × 1.25
        cacheCreation1h: 1_000_000, // × $5 × 2
      },
      { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
    );
    expect(c.output).toBe(25);
    expect(c.input).toBe(5);
    expect(c.cacheRead).toBeCloseTo(0.5);
    expect(c.cacheWrite).toBeCloseTo(6.25 + 10);
    expect(c.total).toBeCloseTo(25 + 5 + 0.5 + 16.25);
  });

  test('cache reads use the model rate, not a fixed 0.1×', () => {
    const totals = {
      output: 0,
      inputUncached: 0,
      cacheRead: 1_000_000,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
    };
    // Fable 5.1: $10 input, reads at 0.025× → $0.25, not $1.00
    expect(costOfTotals(totals, resolvePricing('claude-fable-5-1')!).cacheRead).toBeCloseTo(0.25);
    // Opus 5.5: $4 input, reads at 0.05× → $0.20
    expect(costOfTotals(totals, resolvePricing('claude-opus-5-5')!).cacheRead).toBeCloseTo(0.2);
    // Opus 5: $5 input at the standard 0.1× → $0.50
    expect(costOfTotals(totals, resolvePricing('claude-opus-5')!).cacheRead).toBeCloseTo(0.5);
  });
});
