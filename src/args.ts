export interface CliArgs {
  /** analyze only the last N days */
  days?: number;
  /** only sessions whose project matches this path/substring */
  project?: string;
  json: boolean;
  /** generate a self-contained HTML report and open it in the browser */
  html: boolean;
  explain: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): { args: CliArgs } | { error: string } {
  const args: CliArgs = { json: false, html: false, explain: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--json': args.json = true; break;
      case '--html': args.html = true; break;
      case '--explain': args.explain = true; break;
      case '--help': case '-h': args.help = true; break;
      case '--version': case '-v': args.version = true; break;
      case '--days': {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) return { error: '--days expects a positive number' };
        args.days = v;
        break;
      }
      case '--project': {
        const v = argv[++i];
        if (!v) return { error: '--project expects a path or name fragment' };
        args.project = v;
        break;
      }
      default:
        return { error: `unknown option: ${a} (see --help)` };
    }
  }
  return { args };
}

export const HELP = `quotaburn — find out WHERE your Claude Code quota burns, not just how much

usage: quotaburn [options]

  --days N          analyze only the last N days (default: full history)
  --project <path>  only sessions of the given project (path or fragment)
  --html            visual report: writes a self-contained HTML file and opens it
  --json            machine-readable output
  --explain         print methodology and honest caveats, then exit
  -v, --version     print version
  -h, --help        this help

reads ~/.claude/projects locally · no network · no telemetry`;

export const EXPLAIN = `how quotaburn computes its numbers

data source
  Claude Code writes every session as JSONL under ~/.claude/projects
  (or $CLAUDE_CONFIG_DIR/projects). quotaburn only reads these files —
  no network calls, no telemetry, nothing leaves your machine.

usage deduplication
  A streamed message is logged as SEVERAL records sharing message.id and
  requestId, with PROGRESSIVE usage: output_tokens grows per record while
  input/cache fields stay constant. Naive parsers either double-count the
  input side or keep the first (smallest) output value. quotaburn counts input
  fields once per message and accumulates output deltas to the final value.

residency cost (the "top context eaters" report)
  A tool result enters the context once, but is re-sent (as cache reads or
  input) on EVERY later turn of the session. So its real cost is
  tokens × turns-it-stayed. Residency is settled at compaction/reset
  boundaries, detected two ways: explicit markers (summary records,
  isCompactSummary, compact_boundary) and a heuristic — the context
  shrinking below half of a ≥80k-token base. This is an estimate, not an
  invoice; tool result sizes are estimated at ~4 chars/token.

cache expiry (the "rebuilt after idle" report)
  Anthropic's prompt cache expires after its TTL (5 minutes by default,
  1 hour when 1h cache writes are in use; reads refresh the clock). When a
  session sits idle longer than the TTL, the next turn re-writes the cache
  and you pay for it. quotaburn bills that turn's cache_creation as rebuild
  cost. Upper bound: the first turn after a gap also contains genuinely
  new content.

dollars
  API list prices (cached June 2026): cache reads cost 0.1× the input
  price, cache writes 1.25× (5m TTL) or 2× (1h TTL). Subscription plans do
  not bill per token — dollar figures show the API-price value of your
  usage. Unknown models are excluded from totals, never guessed.`;
