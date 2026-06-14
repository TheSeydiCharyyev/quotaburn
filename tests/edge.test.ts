import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { scan, type ScanResult, type TokenTotals } from '../src/scan.js';

async function makeProject(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ccwhy-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, 'P', rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

function expectFinite(t: TokenTotals): void {
  for (const v of Object.values(t)) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  }
}

function expectSane(r: ScanResult): void {
  expectFinite(r.totals);
  expectFinite(r.subagentTotals);
  expect(Number.isFinite(r.cache.recreationTokens)).toBe(true);
  expect(Number.isFinite(r.cache.recreationDollars)).toBe(true);
  for (const tool of r.tools) {
    expect(Number.isFinite(tool.residencyCost)).toBe(true);
    expect(tool.residencyCost).toBeGreaterThanOrEqual(0);
  }
}

const asst = (over: Record<string, unknown>, usage?: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    uuid: Math.random().toString(36).slice(2),
    message: { id: 'm', model: 'claude-opus-4-8', role: 'assistant', content: [], usage },
    ...over,
  });

describe('edge cases never crash and never produce absurd numbers', () => {
  test('empty file', async () => {
    const r = await scan(await makeProject({ 'a.jsonl': '' }));
    expect(r.files).toBe(1);
    expect(r.sessions).toBe(0);
    expectSane(r);
  });

  test('whitespace and blank lines only', async () => {
    const r = await scan(await makeProject({ 'a.jsonl': '\n\n   \n\t\n' }));
    expect(r.assistantTurns).toBe(0);
    expectSane(r);
  });

  test('binary garbage', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const r = await scan(await makeProject({ 'a.jsonl': bytes }));
    expect(r.assistantTurns).toBe(0);
    expectSane(r);
  });

  test('assistant records with missing fields', async () => {
    const lines = [
      asst({ uuid: 'e1' }), // no usage at all
      JSON.stringify({ type: 'assistant', uuid: 'e2' }), // no message
      JSON.stringify({ type: 'assistant', uuid: 'e3', message: { role: 'assistant', content: 'plain string' } }),
      JSON.stringify({ type: 'user', uuid: 'e4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'orphan', content: 'x' }] } }),
      JSON.stringify({ type: 'user', uuid: 'e5', message: { role: 'user', content: [{ type: 'tool_result' }] } }),
    ].join('\n');
    const r = await scan(await makeProject({ 'a.jsonl': lines }));
    expect(r.totals.output).toBe(0);
    expectSane(r);
  });

  test('garbage and missing timestamps', async () => {
    const lines = [
      asst({ uuid: 't1', requestId: 'r1', timestamp: 'not-a-date' }, { input_tokens: 5, output_tokens: 5 }),
      asst({ uuid: 't2', requestId: 'r2', message: { id: 'm2', model: 'claude-opus-4-8', role: 'assistant', content: [], usage: { input_tokens: 5, output_tokens: 5 } } }), // no timestamp
    ].join('\n');
    const r = await scan(await makeProject({ 'a.jsonl': lines }));
    expect(r.assistantTurns).toBe(2);
    expect(r.cache.expiryEvents).toBe(0);
    expectSane(r);
  });

  test('clock skew: second turn timestamped before the first', async () => {
    const mk = (id: string, ts: string): string =>
      JSON.stringify({
        type: 'assistant', sessionId: 's1', uuid: id, requestId: id, timestamp: ts,
        message: {
          id, model: 'claude-opus-4-8', role: 'assistant', content: [],
          usage: {
            input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0,
            cache_creation_input_tokens: 50000,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50000 },
          },
        },
      });
    const lines = [mk('k1', '2026-01-01T12:00:00.000Z'), mk('k2', '2026-01-01T09:00:00.000Z')].join('\n');
    const r = await scan(await makeProject({ 'a.jsonl': lines }));
    // a negative gap is not an idle gap — must not be billed as cache expiry
    expect(r.cache.expiryEvents).toBe(0);
    expectSane(r);
  });

  test('huge single line', async () => {
    const big = 'a'.repeat(2 * 1024 * 1024);
    const line = JSON.stringify({
      type: 'user', sessionId: 's1', uuid: 'big1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'nope', content: big }] },
    });
    const r = await scan(await makeProject({ 'a.jsonl': line }));
    expectSane(r); // orphan tool_result (no matching tool_use) is ignored
  });

  test('post-idle rebuild is capped at the prior context size', async () => {
    const turn = (id: string, ts: string, cacheCreation: number): string =>
      JSON.stringify({
        type: 'assistant', sessionId: 's1', uuid: id, requestId: id, timestamp: ts,
        message: {
          id, model: 'claude-opus-4-8', role: 'assistant', content: [],
          usage: {
            input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: cacheCreation, ephemeral_1h_input_tokens: 0 },
          },
        },
      });
    // turn 1 establishes a ~100k context; turn 2, after a 10-min idle gap (> 5m TTL),
    // writes 500k of cache — but 400k of that is a document pasted during the pause,
    // not a rebuild. the rebuild can't exceed the ~100k that was cached before.
    const lines = [
      turn('c1', '2026-01-01T12:00:00.000Z', 100_000),
      turn('c2', '2026-01-01T12:10:00.000Z', 500_000),
    ].join('\n');
    const r = await scan(await makeProject({ 'a.jsonl': lines }));
    expect(r.cache.expiryEvents).toBe(1);
    // prevCtxSize after turn 1 = input 1 + cache_read 0 + cache_creation 100000
    expect(r.cache.recreationTokens).toBe(100_001);
    // a 5m TTL with a ≤1h gap → fully counted as what a 1h TTL would have saved (#46829)
    expect(r.cache.avoidableWith1h).toBe(100_001);
    expectSane(r);
  });

  test('usage with absent output on later chunks never goes negative', async () => {
    const chunk = (out: number | undefined): string =>
      JSON.stringify({
        type: 'assistant', sessionId: 's1', uuid: `c${out}`, requestId: 'rr',
        message: {
          id: 'mm', model: 'claude-opus-4-8', role: 'assistant', content: [],
          usage: out === undefined ? { input_tokens: 3 } : { input_tokens: 3, output_tokens: out },
        },
      });
    const lines = [chunk(40), chunk(undefined), chunk(10)].join('\n');
    const r = await scan(await makeProject({ 'a.jsonl': lines }));
    // later chunks reporting less (or no) output must not subtract
    expect(r.totals.output).toBe(40);
    expectSane(r);
  });
});
