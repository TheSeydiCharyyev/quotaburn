import { discoverSessionFiles } from './discover.js';
import { parseSessionFile, type ParseStats } from './parser.js';
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

export async function scan(root: string): Promise<ScanResult> {
  const files = await discoverSessionFiles(root);
  const stats: ParseStats = { lines: 0, parsed: 0, skipped: 0 };
  const totals = emptyTotals();
  const subagentTotals = emptyTotals();
  const byModel = new Map<string, TokenTotals>();
  const toolAgg = new Map<string, { calls: number; addedTokens: number; residencyCost: number }>();
  const readAgg = new Map<string, { reads: number; tokensPerRead: number[] }>();
  const sessions = new Set<string>();
  let assistantTurns = 0;
  let bytes = 0;

  for (const file of files) {
    bytes += file.sizeBytes;
    await scanFile(file, {
      stats, totals, subagentTotals, byModel, toolAgg, readAgg, sessions,
      onTurn: () => assistantTurns++,
    });
  }

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
    totals, subagentTotals, byModel, tools, repeatedReads,
  };
}

interface FileScanContext {
  stats: ParseStats;
  totals: TokenTotals;
  subagentTotals: TokenTotals;
  byModel: Map<string, TokenTotals>;
  toolAgg: Map<string, { calls: number; addedTokens: number; residencyCost: number }>;
  readAgg: Map<string, { reads: number; tokensPerRead: number[] }>;
  sessions: Set<string>;
  onTurn: () => void;
}

async function scanFile(file: SessionFile, ctx: FileScanContext): Promise<void> {
  // per-file state: each .jsonl is one context window (main session or subagent)
  const toolUseNames = new Map<string, string>();
  const toolUseReadPath = new Map<string, string>();
  const pending: PendingResult[] = [];
  const seenUsage = new Set<string>();
  let turn = 0;

  for await (const record of parseSessionFile(file.path, ctx.stats)) {
    if (record.sessionId) ctx.sessions.add(record.sessionId);

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
          if (tu.name === 'Read' && typeof tu.input?.['file_path'] === 'string') {
            toolUseReadPath.set(tu.id, tu.input['file_path'] as string);
          }
        }
      }
      if (msg.usage) {
        // one assistant message can span several JSONL records sharing message.id —
        // count its usage only once (same dedup problem ccusage solves)
        const usageKey = `${msg.id ?? record.uuid}:${record.requestId ?? ''}`;
        if (!seenUsage.has(usageKey)) {
          seenUsage.add(usageKey);
          turn++;
          ctx.onTurn();
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

  // residency: a result added at turn i is re-sent on every later turn of the session.
  // v0 ignores /compact and context resets — numbers are an upper bound; --explain will say so.
  for (const p of pending) {
    const agg = ctx.toolAgg.get(p.displayName);
    if (!agg) continue;
    agg.addedTokens += p.tokens;
    agg.residencyCost += p.tokens * Math.max(0, turn - p.turnAdded);
  }
}
