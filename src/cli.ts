#!/usr/bin/env node
// static import so the bundler inlines the version — a runtime require would
// break the published single-file bundle when run outside the package dir
import pkg from '../package.json' with { type: 'json' };
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeAdvice, headlineText, percentile, type Advice } from './advice.js';
import { EXPLAIN, HELP, parseArgs } from './args.js';
import { claudeProjectsDir } from './discover.js';
import { readConfiguredMcpServers } from './mcpconfig.js';
import {
  CACHE_READ_MULT, CACHE_WRITE_1H_MULT, CACHE_WRITE_5M_MULT,
  costOfTotals, resolvePricing,
} from './pricing.js';
import { renderHtmlReport } from './report.js';
import { buildReportData, computeCost, type CostSummary } from './reportdata.js';
import { scan, type ScanResult, type TokenTotals } from './scan.js';
import { bold, header, money, note, warn } from './style.js';

const fmt = (n: number): string => n.toLocaleString('en-US');

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function bar(part: number, whole: number, width = 20): string {
  const filled = whole === 0 ? 0 : Math.round((part / whole) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`quotaburn: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const args = parsed.args;
  if (args.help) { console.log(HELP); return; }
  if (args.version) { console.log(pkg.version); return; }
  if (args.explain) { console.log(EXPLAIN); return; }

  const root = claudeProjectsDir();
  const started = performance.now();
  const r = await scan(root, {
    cutoffMs: args.days !== undefined ? Date.now() - args.days * 86_400_000 : undefined,
    projectFilter: args.project,
  });

  if (r.files === 0) {
    console.error(`quotaburn: no Claude Code session logs found under ${root}${args.project ? ` for project "${args.project}"` : ''}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(toJson(r, root), null, 2));
    return;
  }

  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  const mb = (r.bytes / 1024 / 1024).toFixed(0);
  const scope = [
    args.days !== undefined ? `last ${args.days} days` : 'full history',
    args.project ? `project: ${args.project}` : null,
  ].filter(Boolean).join(' · ');

  if (args.html) {
    const file = await writeHtmlReport(r, root, scope, Number(mb));
    console.log(`quotaburn: report written to ${file} — opening in your browser…`);
    openInBrowser(file);
    return;
  }

  console.log(`\n${bold(`quotaburn v${pkg.version}`)} — ${scope} — ${note(root)}`);
  console.log(note(`${r.files} files (${mb} MB) · ${fmt(r.stats.lines)} lines · ${fmt(r.stats.skipped)} skipped · ${elapsed}s`) + '\n');

  console.log(`sessions: ${r.sessions} · assistant turns: ${fmt(r.assistantTurns)} · subagent output share: ${pct(r.subagentTotals.output, r.totals.output)}\n`);

  printTotals(r.totals);
  const cost = computeCost(r);
  printCost(cost);

  console.log(header('by model:'));
  for (const [model, t] of [...r.byModel.entries()].sort((a, b) => b[1].output - a[1].output)) {
    const p = resolvePricing(model);
    const dollars = p ? `$${costOfTotals(t, p).total.toFixed(2)}`.padStart(10) : '         —';
    console.log(`  ${model.padEnd(28)} out ${fmt(t.output).padStart(12)}   cache-read ${fmt(t.cacheRead).padStart(15)}  ${dollars}`);
  }

  printTopSessions(r);

  const totalResidency = r.tools.reduce((s, t) => s + t.residencyCost, 0);
  console.log(`\n${header('top context eaters')} ${note(`(tokens added × turns they stayed in context · ${r.contextResets} context resets detected)`)}`);
  for (const t of r.tools.slice(0, 12)) {
    console.log(
      `  ${bar(t.residencyCost, totalResidency)} ${pct(t.residencyCost, totalResidency).padStart(6)}  ` +
      `${t.name.padEnd(24)} ${fmt(t.calls).padStart(7)} calls  +${fmt(t.addedTokens).padStart(12)} tok  cost ${fmt(t.residencyCost).padStart(15)}`,
    );
  }

  console.log(`\n${header('repeated file reads')} ${note('(same file, same context window)')}`);
  for (const rr of r.repeatedReads.slice(0, 10)) {
    console.log(`  ${String(rr.reads).padStart(3)}× ${shorten(rr.filePath, 70).padEnd(72)} ~${fmt(rr.wastedTokens).padStart(10)} tok wasted`);
  }

  printStartupTax(r);
  await printMcpAudit(r);
  printSubagents(r);

  const c = r.cache;
  console.log(`\n${header('cache expiry')} ${note('(idle gap > TTL → cache died, you paid to rebuild it)')}`);
  console.log(`  expiry events                ${fmt(c.expiryEvents).padStart(12)}`);
  console.log(`  rebuilt after idle           ${fmt(c.recreationTokens).padStart(12)} tok  ≈ ${money(`$${c.recreationDollars.toFixed(2)}`)} at API prices`);
  console.log(`  avoidable with 1h TTL        ${fmt(c.avoidableWith1h).padStart(12)} tok  ${note('(#46829)')}`);
  console.log('  top idle burns:');
  for (const e of c.topEvents.slice(0, 8)) {
    const when = e.timestamp.slice(0, 16).replace('T', ' ');
    console.log(`    ${note(when)}  idle ${warn(gapHuman(e.gapMinutes).padStart(8))}  ttl ${e.ttl}  rebuild ${fmt(e.recreationTokens).padStart(10)} tok  ${note(e.project)}`);
  }

  const advice = computeAdvice(r, cost.sum);
  printFixes(advice);
  // the headline: one copy-paste-friendly sentence, deliberately unstyled
  console.log(`\n  "${headlineText(advice.headline)}"`);
  console.log();
}

function printCost({ sum, unknown }: CostSummary): void {
  const usd = (n: number): string => `$${n.toFixed(2)}`.padStart(12);
  console.log(header('estimated cost at API list prices:'));
  console.log(`  total             ${money(usd(sum.total))}`);
  console.log(`    cache read      ${usd(sum.cacheRead)}   ${note(`(${CACHE_READ_MULT}× input price)`)}`);
  console.log(`    cache write     ${usd(sum.cacheWrite)}   ${note(`(${CACHE_WRITE_5M_MULT}× 5m / ${CACHE_WRITE_1H_MULT}× 1h)`)}`);
  console.log(`    output          ${usd(sum.output)}`);
  console.log(`    input (uncached)${usd(sum.input)}`);
  if (unknown.length > 0) console.log(warn(`  excluded (no pricing data): ${unknown.join(', ')}`));
  console.log(note('  note: subscription plans do not bill per token — this is the API-price value of your usage') + '\n');
}

function printFixes(a: Advice): void {
  if (a.fixes.length === 0) return;
  console.log(`\n${header('top fixes')} ${note(`(savings projected from your last ${Math.round(a.windowDays)} days at your blended API rates)`)}`);
  a.fixes.forEach((f, i) => {
    const tag = f.monthlyDollars !== null ? money(`~$${f.monthlyDollars.toFixed(0)}/mo`) : '';
    console.log(`  ${bold(String(i + 1))}. ${f.title}${tag ? `  ${tag}` : ''}`);
    console.log(`     ${f.subtitle}`);
    console.log(`     ${note(f.mathLine)}`);
  });
}

async function writeHtmlReport(r: ScanResult, root: string, scope: string, mb: number): Promise<string> {
  const data = await buildReportData(r, { version: pkg.version, scope, root, mb });
  const html = renderHtmlReport(data);
  let file = join(process.cwd(), 'quotaburn-report.html');
  try {
    writeFileSync(file, html, 'utf8');
  } catch {
    file = join(tmpdir(), 'quotaburn-report.html');
    writeFileSync(file, html, 'utf8');
  }
  return file;
}

function openInBrowser(file: string): void {
  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { detached: true, stdio: 'ignore' });
  child.unref();
}

function toJson(r: ScanResult, root: string): Record<string, unknown> {
  return {
    quotaburnVersion: pkg.version,
    root,
    files: r.files,
    bytes: r.bytes,
    parse: r.stats,
    sessions: r.sessions,
    assistantTurns: r.assistantTurns,
    contextResets: r.contextResets,
    totals: r.totals,
    subagentTotals: r.subagentTotals,
    byModel: Object.fromEntries(r.byModel),
    tools: r.tools,
    repeatedReads: r.repeatedReads,
    cache: r.cache,
    startups: r.startups,
    mcpCalls: Object.fromEntries(r.mcpCalls),
    subagentGroups: r.subagentGroups,
    sessionStats: r.sessionStats,
  };
}

function printTotals(t: TokenTotals): void {
  console.log(header('tokens:'));
  console.log(`  output            ${fmt(t.output).padStart(15)}`);
  console.log(`  input (uncached)  ${fmt(t.inputUncached).padStart(15)}`);
  console.log(`  cache read        ${fmt(t.cacheRead).padStart(15)}`);
  console.log(`  cache write (5m)  ${fmt(t.cacheCreation5m).padStart(15)}`);
  console.log(`  cache write (1h)  ${fmt(t.cacheCreation1h).padStart(15)}\n`);
}

function shorten(p: string, max: number): string {
  return p.length <= max ? p : '…' + p.slice(-(max - 1));
}

function gapHuman(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 60 / 24).toFixed(1)}d`;
}

function printStartupTax(r: Awaited<ReturnType<typeof scan>>): void {
  const sizes = r.startups
    .map((s) => s.inputUncached + s.cacheRead + s.cacheCreation)
    .sort((a, b) => a - b);
  // a fresh start writes the whole standing config into cache; a warm start mostly reads it back
  const fresh = r.startups.filter((s) => s.cacheRead < 10_000);
  const freshWrites = fresh.reduce((s, x) => s + x.cacheCreation, 0);

  console.log(`\n${header('session startup tax')} ${note('(context already spent before your first word does anything)')}`);
  console.log(`  main sessions analyzed       ${fmt(sizes.length).padStart(12)}`);
  console.log(`  context at turn 1            median ${fmt(percentile(sizes, 50))} · p90 ${fmt(percentile(sizes, 90))} tok`);
  console.log(`  fresh starts (cold cache)    ${fmt(fresh.length).padStart(12)}  paying ${fmt(freshWrites)} tok of cache writes total`);
}

function truncTitle(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function printTopSessions(r: ScanResult): void {
  if (r.sessionStats.length === 0) return;
  const top = r.sessionStats.slice(0, 5);
  const topSum = top.reduce((s, x) => s + x.dollars, 0);
  const all = r.sessionStats.reduce((s, x) => s + x.dollars, 0);
  console.log(`\n${header('top sessions')} ${note(`(top ${top.length} = ${pct(topSum, all)} of all spend · subagent spend folded in)`)}`);
  for (const s of top) {
    const name = s.title ?? s.sessionId.slice(0, 8);
    console.log(`  ${money(`$${s.dollars.toFixed(2)}`.padStart(9))}  ${truncTitle(name, 56).padEnd(58)} ${note(`${fmt(s.turns)} turns`)}`);
  }
}

function printSubagents(r: Awaited<ReturnType<typeof scan>>): void {
  const groups = r.subagentGroups;
  console.log(`\n${header('subagents & workflows:')}`);
  if (groups.length === 0) {
    console.log('  no subagent activity found');
    return;
  }
  const workflows = groups.filter((g) => g.kind === 'workflow');
  const standalone = groups.filter((g) => g.kind === 'subagents');
  const agents = (gs: typeof groups): number => gs.reduce((s, g) => s + g.agents, 0);
  console.log(`  workflow runs: ${workflows.length} (${agents(workflows)} agents) · sessions with standalone subagents: ${standalone.length} (${agents(standalone)} agents)`);
  console.log('  top burners:');
  for (const g of groups.slice(0, 8)) {
    const when = g.firstTimestamp.slice(0, 10);
    const label = g.kind === 'workflow'
      ? `workflow "${truncTitle(g.name ?? g.id, 30)}"`
      : `subagents of "${truncTitle(g.name ?? g.id.slice(0, 8), 28)}"`;
    console.log(
      `    ${when}  ${label.padEnd(34)} ${String(g.agents).padStart(3)} agents  ` +
      `out ${fmt(g.totals.output).padStart(10)}  cache-read ${fmt(g.totals.cacheRead).padStart(13)}  cache-write ${fmt(g.totals.cacheCreation5m + g.totals.cacheCreation1h).padStart(11)}`,
    );
  }
}

async function printMcpAudit(r: Awaited<ReturnType<typeof scan>>): Promise<void> {
  const configured = await readConfiguredMcpServers();
  console.log(`\n${header('MCP servers — configured vs actually used:')}`);
  if (configured.length === 0 && r.mcpCalls.size === 0) {
    console.log(note('  none configured in .claude.json · no mcp__ tool calls in logs — nothing to audit'));
    return;
  }
  const seen = new Set<string>();
  for (const server of configured) {
    seen.add(server.name);
    const calls = r.mcpCalls.get(server.name) ?? 0;
    const scope = server.scopes.includes('global') ? 'global' : `${server.scopes.length} project(s)`;
    const flag = calls === 0 ? warn('  ← dead weight: loaded every session, never called') : '';
    console.log(`  ${server.name.padEnd(32)} ${scope.padEnd(14)} ${fmt(calls).padStart(8)} calls${flag}`);
  }
  for (const [name, calls] of [...r.mcpCalls.entries()].sort((a, b) => b[1] - a[1])) {
    if (!seen.has(name)) {
      console.log(`  ${name.padEnd(32)} ${'(not in config)'.padEnd(14)} ${fmt(calls).padStart(8)} calls`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
