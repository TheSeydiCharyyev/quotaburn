import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { scan, type ScanResult } from '../src/scan.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'naming', 'projects');

describe('session leaderboard and human names', () => {
  let r: ScanResult;
  beforeAll(async () => {
    r = await scan(FIXTURES);
  });

  test('sessions ranked by dollars, subagent spend folded into the parent', () => {
    // opus output $25/M: s2 = 2M out = $50; s1 = 1M main + 0.5M subagent + 0.1M workflow = $40
    expect(r.sessionStats.map((s) => s.sessionId)).toEqual(['s2', 's1']);
    expect(r.sessionStats[0]!.dollars).toBeCloseTo(50, 5);
    expect(r.sessionStats[1]!.dollars).toBeCloseTo(40, 5);
  });

  test('subagent turns are not counted as session turns', () => {
    expect(r.sessionStats[1]!.turns).toBe(1);
  });

  test('ai-title wins over last-prompt; last-prompt is the fallback', () => {
    const s1 = r.sessionStats.find((s) => s.sessionId === 's1');
    const s2 = r.sessionStats.find((s) => s.sessionId === 's2');
    expect(s1?.title).toBe('Fix the login bug');
    expect(s2?.title).toBe('please refactor everything in the project');
  });

  test('workflow group named from the wf_*.json sidecar', () => {
    const wf = r.subagentGroups.find((g) => g.kind === 'workflow');
    expect(wf?.name).toBe('demo-workflow');
    expect(wf?.agentDescriptions).toEqual(['survey competitors']);
  });

  test('standalone subagent group named after the parent session ai-title', () => {
    const sa = r.subagentGroups.find((g) => g.kind === 'subagents');
    expect(sa?.name).toBe('Fix the login bug');
    expect(sa?.agentDescriptions).toEqual(['map the auth flow']);
  });
});
