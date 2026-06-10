import { describe, expect, test } from 'vitest';
import { costOfTotals, resolvePricing } from '../src/pricing.js';

describe('resolvePricing', () => {
  test('exact match', () => {
    expect(resolvePricing('claude-opus-4-8')).toEqual({ inputPerM: 5, outputPerM: 25 });
    expect(resolvePricing('claude-fable-5')).toEqual({ inputPerM: 10, outputPerM: 50 });
  });

  test('longest-prefix match handles dated IDs', () => {
    expect(resolvePricing('claude-haiku-4-5-20251001')).toEqual({ inputPerM: 1, outputPerM: 5 });
  });

  test('unknown models return null instead of a guess', () => {
    expect(resolvePricing('<synthetic>')).toBeNull();
    expect(resolvePricing('gpt-4o')).toBeNull();
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
      { inputPerM: 5, outputPerM: 25 },
    );
    expect(c.output).toBe(25);
    expect(c.input).toBe(5);
    expect(c.cacheRead).toBeCloseTo(0.5);
    expect(c.cacheWrite).toBeCloseTo(6.25 + 10);
    expect(c.total).toBeCloseTo(25 + 5 + 0.5 + 16.25);
  });
});
