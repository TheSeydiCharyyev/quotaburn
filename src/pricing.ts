import type { TokenTotals } from './scan.js';

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
}

// Anthropic API list prices per 1M tokens, cached 2026-06-10.
// Cache multipliers per Anthropic docs: read 0.1×, 5m write 1.25×, 1h write 2× of input price.
export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_5M_MULT = 1.25;
export const CACHE_WRITE_1H_MULT = 2;

const PRICING: Record<string, ModelPricing> = {
  'claude-fable-5': { inputPerM: 10, outputPerM: 50 },
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-5': { inputPerM: 5, outputPerM: 25 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
};

/** Exact match first, then longest prefix — handles dated IDs like claude-haiku-4-5-20251001. */
export function resolvePricing(model: string): ModelPricing | null {
  const exact = PRICING[model];
  if (exact) return exact;
  let best: ModelPricing | null = null;
  let bestLen = 0;
  for (const [prefix, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = pricing;
      bestLen = prefix.length;
    }
  }
  return best;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function costOfTotals(t: TokenTotals, p: ModelPricing): CostBreakdown {
  const input = (t.inputUncached / 1e6) * p.inputPerM;
  const output = (t.output / 1e6) * p.outputPerM;
  const cacheRead = (t.cacheRead / 1e6) * p.inputPerM * CACHE_READ_MULT;
  const cacheWrite =
    (t.cacheCreation5m / 1e6) * p.inputPerM * CACHE_WRITE_5M_MULT +
    (t.cacheCreation1h / 1e6) * p.inputPerM * CACHE_WRITE_1H_MULT;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}
