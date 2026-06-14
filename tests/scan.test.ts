import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { discoverSessionFiles } from '../src/discover.js';
import { scan, type ScanResult } from '../src/scan.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'projects');

describe('discover', () => {
  test('finds all jsonl files and classifies them', async () => {
    const files = await discoverSessionFiles(FIXTURES);
    expect(files).toHaveLength(4);

    const main = files.find((f) => f.path.endsWith('fixture-session-1.jsonl'));
    expect(main).toMatchObject({ project: 'Test-Project', isSubagent: false });

    const standalone = files.find((f) => f.path.endsWith('agent-a1.jsonl'));
    expect(standalone).toMatchObject({
      isSubagent: true,
      parentSession: 'fixture-session-1',
      workflowId: undefined,
      isAgentTranscript: true,
    });

    const workflowAgent = files.find((f) => f.path.endsWith('agent-a2.jsonl'));
    expect(workflowAgent).toMatchObject({ isSubagent: true, workflowId: 'wf_test-1', isAgentTranscript: true });

    const journal = files.find((f) => f.path.endsWith('journal.jsonl'));
    expect(journal).toMatchObject({ isSubagent: true, workflowId: 'wf_test-1', isAgentTranscript: false });
  });
});

describe('scan on fixtures', () => {
  let r: ScanResult;
  beforeAll(async () => {
    r = await scan(FIXTURES);
  });

  test('counts sessions, turns, and skips malformed lines', () => {
    expect(r.sessions).toBe(1);
    // main: 4 deduped turns (m1 spans 2 records) + 1 standalone subagent + 1 workflow agent
    expect(r.assistantTurns).toBe(6);
    expect(r.stats.skipped).toBeGreaterThanOrEqual(1); // the non-JSON line
  });

  test('streamed progressive usage: output counted as final value, input once', () => {
    // m1 chunks report output 5 then 50 → 50 total, not 5 and not 55
    // main outputs: 50 + 10 + 20 + 7 = 87; subagents: 100 + 30
    expect(r.totals.output).toBe(87 + 100 + 30);
    // input counted once per message: main 100+50+10+5 + subagents 10+1
    expect(r.totals.inputUncached).toBe(165 + 11);
    expect(r.totals.cacheRead).toBe(41100 + 0 + 5);
  });

  test('legacy flat cache_creation lands in the 5m bucket', () => {
    // standalone subagent has cache_creation_input_tokens: 200 with no breakdown object
    expect(r.totals.cacheCreation5m).toBe(200);
    expect(r.totals.cacheCreation1h).toBe(1000 + 500 + 30000);
  });

  test('subagent share and groups', () => {
    expect(r.subagentTotals.output).toBe(130);
    expect(r.subagentGroups).toHaveLength(2);
    const wf = r.subagentGroups.find((g) => g.kind === 'workflow');
    expect(wf).toMatchObject({ id: 'wf_test-1', agents: 1 }); // journal not counted as agent
    expect(wf?.totals.output).toBe(30);
    const sa = r.subagentGroups.find((g) => g.kind === 'subagents');
    expect(sa).toMatchObject({ id: 'fixture-session-1', agents: 1 });
    expect(sa?.totals.output).toBe(100);
  });

  test('residency attribution settles at the compact boundary', () => {
    // tool results: tu1 10tok@turn1, tu2 10tok@turn2, tu3 50tok@turn3;
    // compact marker arrives at turn 3 → costs 10×(3-1) + 10×(3-2) = 30 for Read, 50×0 = 0 for MCP
    const read = r.tools.find((t) => t.name === 'Read');
    expect(read).toMatchObject({ calls: 2, addedTokens: 20, residencyCost: 30 });
    const mcp = r.tools.find((t) => t.name === 'MCP: github');
    expect(mcp).toMatchObject({ calls: 1, addedTokens: 50, residencyCost: 0 });
    expect(r.contextResets).toBe(1);
  });

  test('repeated reads of the same file are detected', () => {
    expect(r.repeatedReads).toHaveLength(1);
    expect(r.repeatedReads[0]).toMatchObject({ filePath: '/tmp/a.txt', reads: 2, wastedTokens: 10 });
  });

  test('cache expiry: 2h gap with 1h TTL bills the rebuild', () => {
    expect(r.cache.expiryEvents).toBe(1);
    // the turn writes 30000 cache_creation, but the context before the gap was only
    // 21550 tok (input 50 + cache_read 21000 + cache_creation 500) — the rebuild is
    // capped at what was actually cached; the extra 8450 is new content, not a rebuild
    expect(r.cache.recreationTokens).toBe(21550);
    expect(r.cache.avoidableWith1h).toBe(0); // TTL was already 1h
    // 21550 tok × $5/M input × 2 (1h write) = $0.2155
    expect(r.cache.recreationDollars).toBeCloseTo(0.2155, 5);
    expect(r.cache.topEvents[0]).toMatchObject({ ttl: '1h', model: 'claude-opus-4-8', gapMinutes: 120 });
  });

  test('startup tax: first turn of the main session only', () => {
    expect(r.startups).toHaveLength(1);
    expect(r.startups[0]).toMatchObject({ inputUncached: 100, cacheRead: 20000, cacheCreation: 1000 });
  });

  test('mcp calls are grouped by server', () => {
    expect(r.mcpCalls.get('github')).toBe(1);
  });

  test('per-model totals', () => {
    expect(r.byModel.get('claude-opus-4-8')?.output).toBe(87);
    expect(r.byModel.get('claude-haiku-4-5-20251001')?.output).toBe(100);
    expect(r.byModel.get('claude-fable-5')?.output).toBe(30);
  });
});
