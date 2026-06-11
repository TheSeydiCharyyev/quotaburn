// The "— and how to stop it" layer, shared by the terminal report and the HTML report:
// the savings ledger (each fix priced in $/month at the user's own blended API rates)
// and the headline (one copy-paste-friendly sentence summarizing the biggest finding).
// All math is transparent: every fix carries the calculation line it was derived from.
import type { CostBreakdown } from './pricing.js';
import type { ScanResult } from './scan.js';

export type FixId = 'idle-rebuilds' | 'startup-tax' | 'repeated-reads' | 'read-dominance';

export interface Fix {
  id: FixId;
  title: string;
  /** one-line plain-language consequence, shown before any numbers */
  subtitle: string;
  /** projected savings at the user's blended API rates; null = real but not quantifiable */
  monthlyDollars: number | null;
  /** the transparent calculation behind monthlyDollars */
  mathLine: string;
  detail: string[];
  severity: number;
}

export interface HeadlinePart {
  text: string;
  strong?: boolean;
}

export interface Advice {
  headline: HeadlinePart[];
  fixes: Fix[];
  /** actual span of the scanned data in days — the basis for $/month projections */
  windowDays: number;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const usd = (n: number): string => `$${n.toFixed(2)}`;

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function headlineText(parts: HeadlinePart[]): string {
  return parts.map((p) => p.text).join('');
}

function windowLabel(days: number): string {
  return days >= 2 ? `${Math.round(days)} days` : '1 day';
}

function gapHuman(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 60 / 24).toFixed(1)}d`;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function computeAdvice(r: ScanResult, cost: CostBreakdown): Advice {
  const first = r.firstTimestamp ? Date.parse(r.firstTimestamp) : NaN;
  const last = r.lastTimestamp ? Date.parse(r.lastTimestamp) : NaN;
  const windowDays =
    Number.isFinite(first) && Number.isFinite(last) && last > first
      ? Math.max(1, (last - first) / 86_400_000)
      : 30;
  const perMonth = (dollars: number): number => (dollars * 30) / windowDays;
  const win = windowLabel(windowDays);

  // blended $/Mtok the user actually pays, derived from their own model mix
  const cacheWriteTokens = r.totals.cacheCreation5m + r.totals.cacheCreation1h;
  const readRatePerM = r.totals.cacheRead > 0 ? cost.cacheRead / (r.totals.cacheRead / 1e6) : 0;
  const writeRatePerM = cacheWriteTokens > 0 ? cost.cacheWrite / (cacheWriteTokens / 1e6) : 0;

  const fixes: Fix[] = [];

  // 1) cache rebuilt after idle gaps — pure, directly avoidable waste
  const c = r.cache;
  if (cost.total > 0 && c.recreationDollars / cost.total > 0.05) {
    const share = (c.recreationDollars / cost.total) * 100;
    const monthly = perMonth(c.recreationDollars);
    const worst = c.topEvents[0];
    fixes.push({
      id: 'idle-rebuilds',
      title: "Don't resume idle sessions — start fresh with a short handoff",
      subtitle: `${usd(c.recreationDollars)} (${share.toFixed(1)}% of everything) went to rebuilding cache that expired while you were away.`,
      monthlyDollars: monthly,
      mathLine: `${fmt(c.expiryEvents)} rebuilds → ${fmt(c.recreationTokens)} tok rewritten → ${usd(c.recreationDollars)} over ${win} ≈ $${monthly.toFixed(0)}/mo`,
      detail: [
        'Cached context expires after at most 1 hour of silence. Every return to a stale session makes the very next message pay to rewrite the whole context from scratch.',
        worst
          ? `Worst single case: ${fmt(worst.recreationTokens)} tokens rebuilt after ${gapHuman(worst.gapMinutes)} idle. End sessions with a short handoff note and start fresh — it re-reads only what it needs.`
          : 'End sessions with a short handoff note and start fresh — it re-reads only what it needs.',
      ],
      severity: (c.recreationDollars / cost.total) * 2,
    });
  }

  // 2) startup tax — the standing prefix is re-sent (as cache reads) on every later turn
  const sizes = r.startups
    .map((s) => s.inputUncached + s.cacheRead + s.cacheCreation)
    .sort((a, b) => a - b);
  const startupMedian = percentile(sizes, 50);
  if (startupMedian > 20_000 && r.assistantTurns > 0 && readRatePerM > 0) {
    const carryDollars = (startupMedian / 1e6) * r.assistantTurns * readRatePerM;
    const monthly = perMonth(carryDollars) / 3; // conservative: assume a third is trimmable
    fixes.push({
      id: 'startup-tax',
      title: 'Trim your session startup',
      subtitle: `Every session opens ~${fmt(startupMedian)} tokens deep before your first word — and that prefix rides along on every later turn.`,
      monthlyDollars: monthly,
      mathLine: `${fmt(startupMedian)} tok prefix × ${fmt(r.assistantTurns)} turns × $${readRatePerM.toFixed(2)}/M cache-read ≈ ${usd(carryDollars)} over ${win} — trim ⅓ → ~$${monthly.toFixed(0)}/mo`,
      detail: [
        'System prompt, tool definitions, skills and CLAUDE.md/memory load at the top of every session and are re-sent as cache reads with every turn.',
        `It's remarkably consistent (median ${fmt(startupMedian)}, p90 ${fmt(percentile(sizes, 90))}), so this cost is structural: every instruction you prune and every unused skill or MCP server you drop pays off in every future session.`,
      ],
      severity: Math.min(0.5, startupMedian / 200_000),
    });
  }

  // 3) repeated file reads — each extra copy is cache-written once, then carried turn after turn
  const wasted = r.repeatedReads.reduce((s, x) => s + x.wastedTokens, 0);
  if (wasted > 100_000) {
    const readTool = r.tools.find((t) => t.name === 'Read');
    const carryTurns =
      readTool && readTool.addedTokens > 0 ? readTool.residencyCost / readTool.addedTokens : 0;
    const dollars = (wasted / 1e6) * (writeRatePerM + carryTurns * readRatePerM);
    const monthly = perMonth(dollars);
    const top = r.repeatedReads[0];
    fixes.push({
      id: 'repeated-reads',
      title: 'Stop re-reading the same files',
      subtitle: `~${fmt(wasted)} tokens went to files that were already sitting in the context window.`,
      monthlyDollars: monthly,
      mathLine: `${fmt(wasted)} tok re-read × ($${writeRatePerM.toFixed(2)}/M write + ${carryTurns.toFixed(0)} carried turns × $${readRatePerM.toFixed(2)}/M read) ≈ ${usd(dollars)} over ${win} ≈ $${monthly.toFixed(0)}/mo`,
      detail: [
        'Each re-read adds another full copy of the file, and every copy is re-sent on every later turn until the session ends or compacts.',
        top
          ? `Worst offender: ${basename(top.filePath)} read ${top.reads}× in one session — ~${fmt(top.wastedTokens)} tok wasted. Trust the copy already in context; re-read only after a file actually changes.`
          : 'Trust the copy already in context; re-read only after a file actually changes.',
      ],
      severity: Math.min(0.5, wasted / 10_000_000),
    });
  }

  // 4) Read dominance — real, but not directly billable; only pad out a short list
  if (fixes.length < 3 && r.tools[0]?.name === 'Read') {
    const totalResidency = r.tools.reduce((s, t) => s + t.residencyCost, 0);
    const share = totalResidency > 0 ? r.tools[0].residencyCost / totalResidency : 0;
    if (share > 0.6) {
      fixes.push({
        id: 'read-dominance',
        title: 'Read selectively',
        subtitle: `File reads carry ${(share * 100).toFixed(1)}% of your context residency — most of what every turn re-sends is file contents.`,
        monthlyDollars: null,
        mathLine: `${fmt(r.tools[0].residencyCost)} of ${fmt(totalResidency)} residency token-turns come from Read results`,
        detail: [
          'Read with offsets/limits, grep before opening whole files, and prefer fresh sessions over ever-growing ones.',
        ],
        severity: 0.15,
      });
    }
  }

  fixes.sort((a, b) => b.severity - a.severity);
  const top = fixes.slice(0, 4);

  return { headline: buildHeadline(r, cost, top), fixes: top, windowDays };
}

function buildHeadline(r: ScanResult, cost: CostBreakdown, fixes: Fix[]): HeadlinePart[] {
  const c = r.cache;
  switch (fixes[0]?.id) {
    case 'idle-rebuilds':
      return [
        { text: 'You paid to rebuild expired cache ' },
        { text: `${fmt(c.expiryEvents)} times`, strong: true },
        { text: ' — ' },
        { text: usd(c.recreationDollars), strong: true },
        { text: `, ${((c.recreationDollars / cost.total) * 100).toFixed(1)}% of everything you've ever spent.` },
      ];
    case 'startup-tax': {
      const sizes = r.startups
        .map((s) => s.inputUncached + s.cacheRead + s.cacheCreation)
        .sort((a, b) => a - b);
      return [
        { text: 'Every session starts ' },
        { text: `${fmt(percentile(sizes, 50))} tokens`, strong: true },
        { text: ' deep before your first word — you paid that toll ' },
        { text: `${fmt(r.startups.length)} times`, strong: true },
        { text: '.' },
      ];
    }
    case 'repeated-reads': {
      const wasted = r.repeatedReads.reduce((s, x) => s + x.wastedTokens, 0);
      return [
        { text: '~' },
        { text: `${fmt(wasted)} tokens`, strong: true },
        { text: ' went to re-reading files that were already sitting in your context window.' },
      ];
    }
    default:
      return [
        { text: usd(cost.total), strong: true },
        { text: ` of API-price value across ${fmt(r.sessions)} sessions — and no obvious waste found. Clean burn.` },
      ];
  }
}
