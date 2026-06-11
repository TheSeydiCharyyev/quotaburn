import { discoverSessionFiles } from './discover.js';
import { parseSessionFile, type ParseStats } from './parser.js';
import { CACHE_WRITE_1H_MULT, CACHE_WRITE_5M_MULT, resolvePricing } from './pricing.js';
import type { SessionFile, ToolResultBlock, ToolUseBlock, Usage } from './types.js';

export interface TokenTotals {
  output: number;
  inputUncached: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

export interface ToolAttribution {
  /** display name: built-in tool name, or "MCP: <server>" */
  name: string;
  calls: number;
  /** tokens the tool's results added to context (estimated) */
  addedTokens: number;
  /** added tokens × turns they stayed in context — what they actually cost */
  residencyCost: number;
}

export interface RepeatedRead {
  filePath: string;
  reads: number;
  /** estimated tokens of the redundant reads (all but the first) */
  wastedTokens: number;
}

export interface CacheExpiryEvent {
  sessionId: string;
  project: string;
  /** when the session resumed after the idle gap */
  timestamp: string;
  gapMinutes: number;
  /** TTL the session's cache entries had when the gap started */
  ttl: '5m' | '1h';
  /** cache_creation tokens spent on the first turn after the gap — the re-creation bill */
  recreationTokens: number;
  model?: string;
}

export interface CacheAnalysis {
  /** idle gaps longer than the live TTL — each one means the cache died and was re-billed */
  expiryEvents: number;
  /** cache_creation tokens spent on first turns after expiry gaps */
  recreationTokens: number;
  /** subset of recreationTokens where gap ≤ 1h and TTL was 5m — what a 1h TTL would have saved (#46829) */
  avoidableWith1h: number;
  /** API-list-price cost of post-idle rebuilds (events with unknown model pricing excluded) */
  recreationDollars: number;
  topEvents: CacheExpiryEvent[];
}

/** Context composition of a main session's first assistant turn — the cost of just showing up. */
export interface SessionStartup {
  project: string;
  sessionId: string;
  inputUncached: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Aggregated spend of one workflow run or one session's standalone subagents. */
export interface SubagentGroup {
  kind: 'workflow' | 'subagents';
  /** wf_* run id, or the parent session id for standalone subagents */
  id: string;
  project: string;
  agents: number;
  totals: TokenTotals;
  firstTimestamp: string;
}

export interface ScanResult {
  files: number;
  bytes: number;
  stats: ParseStats;
  sessions: number;
  assistantTurns: number;
  totals: TokenTotals;
  subagentTotals: TokenTotals;
  byModel: Map<string, TokenTotals>;
  tools: ToolAttribution[];
  repeatedReads: RepeatedRead[];
  cache: CacheAnalysis;
  startups: SessionStartup[];
  /** calls per MCP server name (the <server> in mcp__<server>__<tool>) */
  mcpCalls: Map<string, number>;
  subagentGroups: SubagentGroup[];
  /** compaction/context-reset boundaries found (markers + context-drop heuristic) */
  contextResets: number;
  /** ISO timestamps of the earliest/latest counted assistant turn — the actual data window */
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export function emptyTotals(): TokenTotals {
  return { output: 0, inputUncached: 0, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0 };
}

function addUsage(t: TokenTotals, u: Usage): void {
  t.output += u.output_tokens ?? 0;
  t.inputUncached += u.input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  const cc = u.cache_creation;
  if (cc) {
    t.cacheCreation5m += cc.ephemeral_5m_input_tokens ?? 0;
    t.cacheCreation1h += cc.ephemeral_1h_input_tokens ?? 0;
  } else {
    // older log versions only have the flat field; bucket it as 5m (the default TTL)
    t.cacheCreation5m += u.cache_creation_input_tokens ?? 0;
  }
}

/** ~4 chars per token — fine for ranking; we are attributing, not billing. */
function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.round(text.length / 4);
}

function displayName(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const server = toolName.split('__')[1] ?? toolName;
    return `MCP: ${server}`;
  }
  return toolName;
}

interface PendingResult {
  tokens: number;
  turnAdded: number;
  displayName: string;
}

export interface ScanOptions {
  /** only count records at or after this time */
  cutoffMs?: number;
  /** only scan projects whose encoded dir name contains this (already normalized) */
  projectFilter?: string;
}

/** Claude Code encodes project paths into dir names: C:\Users\me → C--Users-me */
export function normalizeProjectFilter(input: string): string {
  return input.replace(/[:\\/. ]/g, '-').toLowerCase();
}

export async function scan(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  let files = await discoverSessionFiles(root);
  if (options.projectFilter) {
    const needle = normalizeProjectFilter(options.projectFilter);
    files = files.filter((f) => f.project.toLowerCase().includes(needle));
  }
  if (options.cutoffMs !== undefined) {
    // mtime older than the cutoff ⇒ every record in the file is older too
    files = files.filter((f) => f.mtimeMs >= options.cutoffMs!);
  }
  const stats: ParseStats = { lines: 0, parsed: 0, skipped: 0 };
  const totals = emptyTotals();
  const subagentTotals = emptyTotals();
  const byModel = new Map<string, TokenTotals>();
  const toolAgg = new Map<string, { calls: number; addedTokens: number; residencyCost: number }>();
  const readAgg = new Map<string, { reads: number; tokensPerRead: number[] }>();
  const sessions = new Set<string>();
  const cacheEvents: CacheExpiryEvent[] = [];
  const startups: SessionStartup[] = [];
  const mcpCalls = new Map<string, number>();
  let assistantTurns = 0;
  let bytes = 0;
  let contextResets = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  const groups = new Map<string, SubagentGroup>();

  for (const file of files) {
    bytes += file.sizeBytes;
    const fileResult = await scanFile(file, {
      stats, totals, subagentTotals, byModel, toolAgg, readAgg, sessions, cacheEvents, startups, mcpCalls,
      cutoffMs: options.cutoffMs,
      onTurn: () => assistantTurns++,
      onContextReset: () => contextResets++,
    });

    // ISO-8601 strings compare correctly as strings
    if (fileResult.firstTimestamp && (!firstTimestamp || fileResult.firstTimestamp < firstTimestamp)) {
      firstTimestamp = fileResult.firstTimestamp;
    }
    if (fileResult.lastTimestamp && (!lastTimestamp || fileResult.lastTimestamp > lastTimestamp)) {
      lastTimestamp = fileResult.lastTimestamp;
    }

    if (file.isSubagent) {
      const key = file.workflowId ? `wf:${file.workflowId}` : `sa:${file.parentSession ?? '?'}`;
      const group = groups.get(key) ?? {
        kind: file.workflowId ? ('workflow' as const) : ('subagents' as const),
        id: file.workflowId ?? file.parentSession ?? '?',
        project: file.project,
        agents: 0,
        totals: emptyTotals(),
        firstTimestamp: '',
      };
      if (file.isAgentTranscript) group.agents++;
      mergeTotals(group.totals, fileResult.totals);
      if (fileResult.firstTimestamp && (!group.firstTimestamp || fileResult.firstTimestamp < group.firstTimestamp)) {
        group.firstTimestamp = fileResult.firstTimestamp;
      }
      groups.set(key, group);
    }
  }

  const subagentGroups = [...groups.values()].sort((a, b) => b.totals.output - a.totals.output);

  const cache: CacheAnalysis = {
    expiryEvents: cacheEvents.length,
    recreationTokens: cacheEvents.reduce((s, e) => s + e.recreationTokens, 0),
    avoidableWith1h: cacheEvents
      .filter((e) => e.ttl === '5m' && e.gapMinutes <= 60)
      .reduce((s, e) => s + e.recreationTokens, 0),
    recreationDollars: cacheEvents.reduce((s, e) => {
      const p = e.model ? resolvePricing(e.model) : null;
      if (!p) return s;
      const mult = e.ttl === '1h' ? CACHE_WRITE_1H_MULT : CACHE_WRITE_5M_MULT;
      return s + (e.recreationTokens / 1e6) * p.inputPerM * mult;
    }, 0),
    topEvents: [...cacheEvents].sort((a, b) => b.recreationTokens - a.recreationTokens).slice(0, 10),
  };

  const tools: ToolAttribution[] = [...toolAgg.entries()]
    .map(([name, a]) => ({ name, ...a }))
    .sort((a, b) => b.residencyCost - a.residencyCost);

  const repeatedReads: RepeatedRead[] = [...readAgg.entries()]
    .filter(([, a]) => a.reads > 1)
    .map(([filePath, a]) => {
      const total = a.tokensPerRead.reduce((s, n) => s + n, 0);
      const avg = total / a.tokensPerRead.length;
      return { filePath, reads: a.reads, wastedTokens: Math.round(avg * (a.reads - 1)) };
    })
    .sort((a, b) => b.wastedTokens - a.wastedTokens);

  return {
    files: files.length, bytes, stats,
    sessions: sessions.size, assistantTurns,
    totals, subagentTotals, byModel, tools, repeatedReads, cache, startups, mcpCalls, subagentGroups,
    contextResets,
    firstTimestamp, lastTimestamp,
  };
}

function mergeTotals(into: TokenTotals, from: TokenTotals): void {
  into.output += from.output;
  into.inputUncached += from.inputUncached;
  into.cacheRead += from.cacheRead;
  into.cacheCreation5m += from.cacheCreation5m;
  into.cacheCreation1h += from.cacheCreation1h;
}

interface FileScanContext {
  stats: ParseStats;
  totals: TokenTotals;
  subagentTotals: TokenTotals;
  byModel: Map<string, TokenTotals>;
  toolAgg: Map<string, { calls: number; addedTokens: number; residencyCost: number }>;
  readAgg: Map<string, { reads: number; tokensPerRead: number[] }>;
  sessions: Set<string>;
  cacheEvents: CacheExpiryEvent[];
  startups: SessionStartup[];
  mcpCalls: Map<string, number>;
  cutoffMs?: number;
  onTurn: () => void;
  onContextReset: () => void;
}

/** context shrank to less than half of a ≥80k base — almost certainly a compaction/reset */
const RESET_MIN_BASE_TOKENS = 80_000;

const TTL_5M_MS = 5 * 60 * 1000;
const TTL_1H_MS = 60 * 60 * 1000;

function cacheCreationTotal(u: Usage): number {
  const cc = u.cache_creation;
  if (cc) return (cc.ephemeral_5m_input_tokens ?? 0) + (cc.ephemeral_1h_input_tokens ?? 0);
  return u.cache_creation_input_tokens ?? 0;
}

async function scanFile(
  file: SessionFile,
  ctx: FileScanContext,
): Promise<{ totals: TokenTotals; firstTimestamp: string | null; lastTimestamp: string | null }> {
  // per-file state: each .jsonl is one context window (main session or subagent)
  const toolUseNames = new Map<string, string>();
  const toolUseReadPath = new Map<string, string>();
  const pending: PendingResult[] = [];
  // message.id+requestId → highest output_tokens seen so far for that message.
  // Streamed messages are logged as several records with PROGRESSIVE usage:
  // output_tokens grows per record while input/cache fields stay constant, so
  // input-side counts once per message and output-side accumulates deltas.
  const seenUsage = new Map<string, number>();
  const fileTotals = emptyTotals();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let turn = 0;
  let prevTurnTs: number | null = null;
  let prevCtxSize = 0;

  // a compaction/reset boundary means earlier tool results left the context:
  // close out their residency up to the given turn and stop charging them
  const settleResidency = (uptoTurn: number): void => {
    for (const p of pending) {
      const agg = ctx.toolAgg.get(p.displayName);
      if (!agg) continue;
      agg.addedTokens += p.tokens;
      agg.residencyCost += p.tokens * Math.max(0, uptoTurn - p.turnAdded);
    }
    pending.length = 0;
  };
  // TTL of the cache entries this session has been writing; reads refresh a TTL,
  // they don't change it, so the mode only moves 5m → 1h when a 1h write appears
  let ttlMode: '5m' | '1h' = '5m';

  for await (const record of parseSessionFile(file.path, ctx.stats)) {
    // --days window: drop pre-cutoff records entirely; their tool_use ids are never
    // registered, so matching tool_results fall out as orphans — consistent exclusion
    if (
      ctx.cutoffMs !== undefined &&
      record.timestamp &&
      Date.parse(record.timestamp) < ctx.cutoffMs
    ) {
      continue;
    }
    if (record.sessionId) ctx.sessions.add(record.sessionId);

    const isCompactMarker =
      record.type === 'summary' ||
      (record.type === 'user' && record.isCompactSummary === true) ||
      (record.type === 'system' && record.subtype === 'compact_boundary');
    if (isCompactMarker) {
      settleResidency(turn);
      prevCtxSize = 0;
      ctx.onContextReset();
      continue;
    }

    if (record.type === 'assistant' && record.message) {
      const msg = record.message;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          const tu = block as ToolUseBlock;
          toolUseNames.set(tu.id, tu.name);
          const name = displayName(tu.name);
          const agg = ctx.toolAgg.get(name) ?? { calls: 0, addedTokens: 0, residencyCost: 0 };
          agg.calls++;
          ctx.toolAgg.set(name, agg);
          if (tu.name.startsWith('mcp__')) {
            const server = tu.name.split('__')[1] ?? tu.name;
            ctx.mcpCalls.set(server, (ctx.mcpCalls.get(server) ?? 0) + 1);
          }
          if (tu.name === 'Read' && typeof tu.input?.['file_path'] === 'string') {
            toolUseReadPath.set(tu.id, tu.input['file_path'] as string);
          }
        }
      }
      if (msg.usage) {
        const usageKey = `${msg.id ?? record.uuid}:${record.requestId ?? ''}`;
        const prevOutput = seenUsage.get(usageKey);
        if (prevOutput !== undefined) {
          // later record of an already-counted message: take only the output growth
          const current = msg.usage.output_tokens ?? 0;
          if (current > prevOutput) {
            const delta = current - prevOutput;
            seenUsage.set(usageKey, current);
            ctx.totals.output += delta;
            fileTotals.output += delta;
            if (file.isSubagent) ctx.subagentTotals.output += delta;
            if (msg.model) {
              const m = ctx.byModel.get(msg.model);
              if (m) m.output += delta;
            }
          }
        } else {
          seenUsage.set(usageKey, msg.usage.output_tokens ?? 0);

          // heuristic reset detection: context size collapsed vs the previous turn
          const ctxSize =
            (msg.usage.input_tokens ?? 0) +
            (msg.usage.cache_read_input_tokens ?? 0) +
            cacheCreationTotal(msg.usage);
          if (prevCtxSize >= RESET_MIN_BASE_TOKENS && ctxSize < prevCtxSize / 2) {
            settleResidency(turn);
            ctx.onContextReset();
          }
          prevCtxSize = ctxSize;

          turn++;
          ctx.onTurn();

          if (record.timestamp) {
            if (firstTimestamp === null) firstTimestamp = record.timestamp;
            lastTimestamp = record.timestamp;
          }
          addUsage(fileTotals, msg.usage);

          const ts = record.timestamp ? Date.parse(record.timestamp) : NaN;
          if (!Number.isNaN(ts)) {
            if (prevTurnTs !== null) {
              const gapMs = ts - prevTurnTs;
              const ttlMs = ttlMode === '1h' ? TTL_1H_MS : TTL_5M_MS;
              if (gapMs > ttlMs) {
                const recreation = cacheCreationTotal(msg.usage);
                if (recreation > 0) {
                  ctx.cacheEvents.push({
                    sessionId: record.sessionId ?? '?',
                    project: file.project,
                    timestamp: record.timestamp ?? '',
                    gapMinutes: Math.round(gapMs / 60000),
                    ttl: ttlMode,
                    recreationTokens: recreation,
                    model: msg.model,
                  });
                }
              }
            }
            prevTurnTs = ts;
          }
          if ((msg.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMode = '1h';

          if (turn === 1 && !file.isSubagent) {
            ctx.startups.push({
              project: file.project,
              sessionId: record.sessionId ?? '?',
              inputUncached: msg.usage.input_tokens ?? 0,
              cacheRead: msg.usage.cache_read_input_tokens ?? 0,
              cacheCreation: cacheCreationTotal(msg.usage),
            });
          }

          addUsage(ctx.totals, msg.usage);
          if (file.isSubagent) addUsage(ctx.subagentTotals, msg.usage);
          if (msg.model) {
            const m = ctx.byModel.get(msg.model) ?? emptyTotals();
            addUsage(m, msg.usage);
            ctx.byModel.set(msg.model, m);
          }
        }
      }
    } else if (record.type === 'user' && record.message && Array.isArray(record.message.content)) {
      for (const block of record.message.content) {
        if (block.type !== 'tool_result') continue;
        const tr = block as ToolResultBlock;
        const toolName = toolUseNames.get(tr.tool_use_id);
        if (!toolName) continue;
        const tokens = estimateTokens(tr.content);
        pending.push({ tokens, turnAdded: turn, displayName: displayName(toolName) });
        const readPath = toolUseReadPath.get(tr.tool_use_id);
        if (readPath) {
          const r = ctx.readAgg.get(readPath) ?? { reads: 0, tokensPerRead: [] };
          r.reads++;
          r.tokensPerRead.push(tokens);
          ctx.readAgg.set(readPath, r);
        }
      }
    }
  }

  // residency: a result added at turn i is re-sent on every later turn of the session,
  // until a compaction/reset boundary (handled above) or the session ends here
  settleResidency(turn);

  return { totals: fileTotals, firstTimestamp, lastTimestamp };
}
