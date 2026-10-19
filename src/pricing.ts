import type { TokenTotals } from './scan.js';

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  /** Cache hits and refreshes as a fraction of the base input price. */
  cacheReadMult: number;
}

// Anthropic API list prices per 1M tokens, verified against
// platform.claude.com/docs/en/about-claude/pricing on 2026-10-19.
// Cache writes are 1.25× (5m) and 2× (1h) of base input for every model.
// Cache reads are 0.1× for most models, 0.05× on Opus 5.5 / Sonnet 5.5,
// and 0.025× on Fable 5.1 / Mythos 5.1 — so the rate lives per model.
export const CACHE_WRITE_5M_MULT = 1.25;
export const CACHE_WRITE_1H_MULT = 2;
export const CACHE_READ_MULT_DEFAULT = 0.1;
/** Lowest and highest cache-read rates in the table, for honest labelling. */
export const CACHE_READ_MULT_RANGE = [0.025, 0.1] as const;

const PRICING: Record<string, ModelPricing> = {
  // Current lineup
  'claude-fable-5-1': { inputPerM: 10, outputPerM: 50, cacheReadMult: 0.025 },
  'claude-opus-5-5': { inputPerM: 4, outputPerM: 20, cacheReadMult: 0.05 },
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10, cacheReadMult: 0.05 },
  // Haiku 5.5 is tiered by prompt size; this is the ≤100k-token tier, which is
  // what Claude Code's auxiliary requests fall into. See docs/METHODOLOGY.md.
  'claude-haiku-5-5': { inputPerM: 0.1, outputPerM: 0.5, cacheReadMult: 0.1 },
  // Legacy, still served
  'claude-fable-5': { inputPerM: 10, outputPerM: 50, cacheReadMult: 0.1 },
  'claude-opus-5': { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
  'claude-opus-4-5': { inputPerM: 5, outputPerM: 25, cacheReadMult: 0.1 },
  'claude-sonnet-5': { inputPerM: 2, outputPerM: 10, cacheReadMult: 0.1 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheReadMult: 0.1 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15, cacheReadMult: 0.1 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5, cacheReadMult: 0.1 },
  // Retired on the Claude API, still served on Bedrock and/or Google Cloud
  'claude-opus-4-1': { inputPerM: 15, outputPerM: 75, cacheReadMult: 0.1 },
  'claude-opus-4': { inputPerM: 15, outputPerM: 75, cacheReadMult: 0.1 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15, cacheReadMult: 0.1 },
  'claude-haiku-3-5': { inputPerM: 0.8, outputPerM: 4, cacheReadMult: 0.1 },
  // Mythos 5 / 5.1 are deliberately absent: Anthropic publishes no model ID
  // for them, so there is nothing to match. They stay excluded, not guessed.
};

/** Bedrock sends `anthropic.claude-opus-5-5`, regional endpoints `us.anthropic.…`. */
const PROVIDER_PREFIX = /^(?:[a-z]{2,6}\.)?anthropic\./;

/**
 * Exact match first, then the longest prefix that ends on a version boundary.
 * `claude-haiku-4-5-20251001` resolves to `claude-haiku-4-5`, while a future
 * `claude-opus-50` does not borrow `claude-opus-5`'s price.
 */
export function resolvePricing(model: string): ModelPricing | null {
  const id = model.replace(PROVIDER_PREFIX, '');
  const exact = PRICING[id];
  if (exact) return exact;
  let best: ModelPricing | null = null;
  let bestLen = 0;
  for (const [prefix, pricing] of Object.entries(PRICING)) {
    if (id.startsWith(`${prefix}-`) && prefix.length > bestLen) {
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
  const cacheRead = (t.cacheRead / 1e6) * p.inputPerM * p.cacheReadMult;
  const cacheWrite =
    (t.cacheCreation5m / 1e6) * p.inputPerM * CACHE_WRITE_5M_MULT +
    (t.cacheCreation1h / 1e6) * p.inputPerM * CACHE_WRITE_1H_MULT;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}
