// Builds the ReportData consumed by the HTML report — shared by the CLI (--html)
// and the VS Code extension, so both surfaces render the exact same dashboard.
import { computeAdvice, percentile } from './advice.js';
import { readConfiguredMcpServers } from './mcpconfig.js';
import { costOfTotals, resolvePricing, type CostBreakdown } from './pricing.js';
import type { ReportData } from './report.js';
import type { ScanResult } from './scan.js';

export interface CostSummary {
  sum: CostBreakdown;
  unknown: string[];
}

export function computeCost(r: ScanResult): CostSummary {
  const sum: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const unknown: string[] = [];
  for (const [model, t] of r.byModel) {
    const p = resolvePricing(model);
    if (!p) {
      if (t.output > 0 || t.cacheRead > 0) unknown.push(model);
      continue;
    }
    const c = costOfTotals(t, p);
    sum.input += c.input;
    sum.output += c.output;
    sum.cacheRead += c.cacheRead;
    sum.cacheWrite += c.cacheWrite;
    sum.total += c.total;
  }
  return { sum, unknown };
}

export async function buildReportData(
  r: ScanResult,
  meta: { version: string; scope: string; root: string; mb: number },
): Promise<ReportData> {
  const cost = computeCost(r);
  const advice = computeAdvice(r, cost.sum);
  const sizes = r.startups
    .map((s) => s.inputUncached + s.cacheRead + s.cacheCreation)
    .sort((a, b) => a - b);

  const configured = await readConfiguredMcpServers();
  const seen = new Set<string>();
  const mcp = configured.map((s) => {
    seen.add(s.name);
    const calls = r.mcpCalls.get(s.name) ?? 0;
    return {
      name: s.name,
      scope: s.scopes.includes('global') ? 'global' : `${s.scopes.length} project(s)`,
      calls,
      dead: calls === 0,
    };
  });
  for (const [name, calls] of r.mcpCalls) {
    if (!seen.has(name)) mcp.push({ name, scope: '(not in config)', calls, dead: false });
  }

  return {
    version: meta.version,
    scope: meta.scope,
    root: meta.root,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    files: r.files,
    mb: meta.mb,
    sessions: r.sessions,
    turns: r.assistantTurns,
    contextResets: r.contextResets,
    windowDays: advice.windowDays,
    headline: advice.headline,
    fixes: advice.fixes,
    cost: {
      total: cost.sum.total,
      cacheRead: cost.sum.cacheRead,
      cacheWrite: cost.sum.cacheWrite,
      output: cost.sum.output,
      input: cost.sum.input,
    },
    totals: r.totals,
    byModel: [...r.byModel.entries()]
      .sort((a, b) => b[1].output - a[1].output)
      .map(([model, t]) => {
        const p = resolvePricing(model);
        return { model, output: t.output, cacheRead: t.cacheRead, dollars: p ? costOfTotals(t, p).total : null };
      }),
    tools: r.tools,
    repeatedReads: r.repeatedReads,
    cache: r.cache,
    startup: { count: sizes.length, median: percentile(sizes, 50), p90: percentile(sizes, 90) },
    subagentOutputShare: r.totals.output > 0 ? r.subagentTotals.output / r.totals.output : 0,
    topSessions: r.sessionStats.slice(0, 8).map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      dollars: s.dollars,
      turns: s.turns,
    })),
    sessionCount: r.sessionStats.length,
    mcp,
    subagentGroups: r.subagentGroups.slice(0, 10).map((g) => ({
      kind: g.kind,
      id: g.id,
      name: g.name,
      agentDescriptions: g.agentDescriptions,
      agents: g.agents,
      output: g.totals.output,
      cacheRead: g.totals.cacheRead,
      cacheWrite: g.totals.cacheCreation5m + g.totals.cacheCreation1h,
      date: g.firstTimestamp.slice(0, 10),
    })),
  };
}
