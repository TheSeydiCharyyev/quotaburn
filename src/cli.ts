#!/usr/bin/env node
import { claudeProjectsDir } from './discover.js';
import { readConfiguredMcpServers } from './mcpconfig.js';
import { scan, type TokenTotals } from './scan.js';

const fmt = (n: number): string => n.toLocaleString('en-US');

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function bar(part: number, whole: number, width = 20): string {
  const filled = whole === 0 ? 0 : Math.round((part / whole) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main(): Promise<void> {
  const root = claudeProjectsDir();
  const started = performance.now();
  const r = await scan(root);

  if (r.files === 0) {
    console.error(`No Claude Code session logs found under ${root}`);
    process.exitCode = 1;
    return;
  }

  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  const mb = (r.bytes / 1024 / 1024).toFixed(0);

  console.log(`\nccwhy v0.0.1 — scan of ${root}`);
  console.log(`${r.files} files (${mb} MB) · ${fmt(r.stats.lines)} lines · ${fmt(r.stats.skipped)} skipped · ${elapsed}s\n`);

  console.log(`sessions: ${r.sessions} · assistant turns: ${fmt(r.assistantTurns)}`);
  console.log(`subagent share of output tokens: ${pct(r.subagentTotals.output, r.totals.output)}\n`);

  printTotals(r.totals);

  console.log('by model:');
  for (const [model, t] of [...r.byModel.entries()].sort((a, b) => b[1].output - a[1].output)) {
    console.log(`  ${model.padEnd(28)} out ${fmt(t.output).padStart(12)}   cache-read ${fmt(t.cacheRead).padStart(15)}`);
  }

  const totalResidency = r.tools.reduce((s, t) => s + t.residencyCost, 0);
  console.log(`\ntop context eaters (residency-weighted — tokens added × turns they stayed · ${r.contextResets} context resets detected):`);
  for (const t of r.tools.slice(0, 12)) {
    console.log(
      `  ${bar(t.residencyCost, totalResidency)} ${pct(t.residencyCost, totalResidency).padStart(6)}  ` +
      `${t.name.padEnd(24)} ${fmt(t.calls).padStart(7)} calls  +${fmt(t.addedTokens).padStart(12)} tok  cost ${fmt(t.residencyCost).padStart(15)}`,
    );
  }

  console.log('\nrepeated file reads (same file, same context window):');
  for (const rr of r.repeatedReads.slice(0, 10)) {
    console.log(`  ${String(rr.reads).padStart(3)}× ${shorten(rr.filePath, 70).padEnd(72)} ~${fmt(rr.wastedTokens).padStart(10)} tok wasted`);
  }

  printStartupTax(r);
  await printMcpAudit(r);
  printSubagents(r);

  const c = r.cache;
  console.log('\ncache expiry (idle gap > TTL → cache died, you paid to rebuild it):');
  console.log(`  expiry events                ${fmt(c.expiryEvents).padStart(12)}`);
  console.log(`  rebuilt after idle           ${fmt(c.recreationTokens).padStart(12)} tok`);
  console.log(`  avoidable with 1h TTL        ${fmt(c.avoidableWith1h).padStart(12)} tok  (#46829)`);
  console.log('  top idle burns:');
  for (const e of c.topEvents.slice(0, 8)) {
    const when = e.timestamp.slice(0, 16).replace('T', ' ');
    console.log(`    ${when}  idle ${gapHuman(e.gapMinutes).padStart(8)}  ttl ${e.ttl}  rebuild ${fmt(e.recreationTokens).padStart(10)} tok  ${e.project}`);
  }
  console.log();
}

function printTotals(t: TokenTotals): void {
  console.log('tokens:');
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function printStartupTax(r: Awaited<ReturnType<typeof scan>>): void {
  const sizes = r.startups
    .map((s) => s.inputUncached + s.cacheRead + s.cacheCreation)
    .sort((a, b) => a - b);
  // a fresh start writes the whole standing config into cache; a warm start mostly reads it back
  const fresh = r.startups.filter((s) => s.cacheRead < 10_000);
  const freshWrites = fresh.reduce((s, x) => s + x.cacheCreation, 0);

  console.log('\nsession startup tax (context already spent before your first word does anything):');
  console.log(`  main sessions analyzed       ${fmt(sizes.length).padStart(12)}`);
  console.log(`  context at turn 1            median ${fmt(percentile(sizes, 50))} · p90 ${fmt(percentile(sizes, 90))} tok`);
  console.log(`  fresh starts (cold cache)    ${fmt(fresh.length).padStart(12)}  paying ${fmt(freshWrites)} tok of cache writes total`);
}

function printSubagents(r: Awaited<ReturnType<typeof scan>>): void {
  const groups = r.subagentGroups;
  console.log('\nsubagents & workflows:');
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
    const label = g.kind === 'workflow' ? `workflow ${g.id}` : `subagents of ${g.id.slice(0, 8)}`;
    console.log(
      `    ${when}  ${label.padEnd(34)} ${String(g.agents).padStart(3)} agents  ` +
      `out ${fmt(g.totals.output).padStart(10)}  cache-read ${fmt(g.totals.cacheRead).padStart(13)}  cache-write ${fmt(g.totals.cacheCreation5m + g.totals.cacheCreation1h).padStart(11)}`,
    );
  }
}

async function printMcpAudit(r: Awaited<ReturnType<typeof scan>>): Promise<void> {
  const configured = await readConfiguredMcpServers();
  console.log('\nMCP servers — configured vs actually used (all history):');
  if (configured.length === 0 && r.mcpCalls.size === 0) {
    console.log('  none configured in .claude.json · no mcp__ tool calls in logs — nothing to audit');
    return;
  }
  const seen = new Set<string>();
  for (const server of configured) {
    seen.add(server.name);
    const calls = r.mcpCalls.get(server.name) ?? 0;
    const scope = server.scopes.includes('global') ? 'global' : `${server.scopes.length} project(s)`;
    const flag = calls === 0 ? '  ← dead weight: loaded every session, never called' : '';
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
