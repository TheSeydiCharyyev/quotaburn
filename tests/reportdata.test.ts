import { describe, expect, test } from 'vitest';
import { renderHtmlReport } from '../src/report.js';
import { buildReportData, computeCost } from '../src/reportdata.js';
import { emptyTotals, type ScanResult } from '../src/scan.js';

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    files: 1,
    bytes: 1024,
    stats: { lines: 0, parsed: 0, skipped: 0 },
    sessions: 1,
    assistantTurns: 10,
    totals: { ...emptyTotals(), output: 1000, cacheRead: 1000 },
    subagentTotals: emptyTotals(),
    byModel: new Map(),
    tools: [],
    repeatedReads: [],
    cache: { expiryEvents: 0, recreationTokens: 0, avoidableWith1h: 0, recreationDollars: 0, topEvents: [] },
    startups: [],
    mcpCalls: new Map(),
    subagentGroups: [],
    sessionStats: [],
    contextResets: 0,
    firstTimestamp: '2026-01-01T00:00:00.000Z',
    lastTimestamp: '2026-01-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeCost', () => {
  test('sums per-model dollars and lists unknown models instead of guessing', () => {
    const r = makeResult({
      byModel: new Map([
        ['claude-opus-4-8', { ...emptyTotals(), output: 1_000_000 }], // $25/M output → $25
        ['claude-haiku-4-5', { ...emptyTotals(), output: 1_000_000 }], // $5/M output → $5
        ['totally-unknown-model', { ...emptyTotals(), output: 1_000_000 }], // excluded
      ]),
    });
    const { sum, unknown } = computeCost(r);
    expect(sum.output).toBeCloseTo(30, 5);
    expect(sum.total).toBeCloseTo(30, 5);
    expect(unknown).toContain('totally-unknown-model');
  });

  test('cache read and write use their multipliers', () => {
    const r = makeResult({
      byModel: new Map([
        // opus input $5/M: cache read 0.1× → $0.50, 1h write 2× → $10.00 per 1M
        ['claude-opus-4-8', { ...emptyTotals(), cacheRead: 1_000_000, cacheCreation1h: 1_000_000 }],
      ]),
    });
    const { sum } = computeCost(r);
    expect(sum.cacheRead).toBeCloseTo(0.5, 5);
    expect(sum.cacheWrite).toBeCloseTo(10.0, 5);
    expect(sum.total).toBeCloseTo(10.5, 5);
  });
});

describe('renderHtmlReport escaping', () => {
  test('a script payload in any user-controlled field cannot break out of the JSON island', async () => {
    const payload = '</script><script>alert(1)</script>';
    const r = makeResult({
      byModel: new Map([['claude-opus-4-8', { ...emptyTotals(), output: 1000 }]]),
      sessionStats: [
        { sessionId: 's1', project: 'P', title: payload, dollars: 5, turns: 1, firstTimestamp: null, lastTimestamp: null },
      ],
      repeatedReads: [{ filePath: payload, reads: 3, wastedTokens: 1000 }],
      subagentGroups: [
        {
          kind: 'workflow', id: 'wf', name: payload, agentDescriptions: [payload],
          project: 'P', agents: 1, totals: emptyTotals(), firstTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const data = await buildReportData(r, { version: '0.0.0', scope: 'test', root: '/tmp', mb: 1 });
    const html = renderHtmlReport(data);

    // the literal closing-script sequence must never appear — every < is < in the island
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('\\u003c/script>');
  });

  test('webview options inject a CSP nonce and initial theme', async () => {
    const data = await buildReportData(makeResult(), { version: '0.0.0', scope: 'test', root: '/tmp', mb: 1 });
    const html = renderHtmlReport(data, { nonce: 'abc123', csp: "script-src 'nonce-abc123'", defaultTheme: 'dark' });
    expect(html).toContain('nonce="abc123"');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('data-theme="dark"');
  });
});
