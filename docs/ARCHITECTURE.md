# Architecture

A map of the codebase for anyone fixing a bug or adding a feature. For *how the numbers are computed*, see [METHODOLOGY.md](METHODOLOGY.md); this document is about *how the code is organized*.

## Design constraints

Three rules shape everything:

1. **Zero runtime dependencies.** The published bundle is one auditable file. Dev dependencies (TypeScript, tsup, vitest) are fine; runtime ones are not.
2. **Streaming, never slurping.** Logs reach hundreds of megabytes. Files are read line by line; nothing assumes a whole file fits in memory.
3. **Resilient parsing.** Unknown record types and malformed lines are skipped, never thrown on. The log format is undocumented and version-dependent.

## The pipeline

A run flows in one direction. Discovery and parsing are pure I/O; analysis is a single streaming pass; the surfaces (terminal / HTML / extension) only render.

```
discover ──▶ parser ──▶ scan ──▶ reportdata ──▶ report ──▶ surface
 (find      (stream    (single    (assemble      (HTML)     (CLI │
  .jsonl)    records)   pass:      ReportData)               webview)
                        attribute  ▲
                        + price)   │
                                pricing · advice
```

## Modules (`src/`)

| File | Responsibility |
| --- | --- |
| `discover.ts` | Walk `~/.claude/projects`, find every `.jsonl`, classify each as main session / standalone subagent / workflow agent / workflow journal. |
| `parser.ts` | Stream a file into typed `LogRecord`s, tracking line/parse/skip stats. The only place raw JSON is touched. |
| `types.ts` | The shape of a log record and its `usage` block. The contract with the undocumented format lives here. |
| `scan.ts` | The engine. One streaming pass that produces every aggregate: token totals, per-model and per-session cost, tool residency, repeated reads, cache-expiry events, startup tax, MCP calls, subagent groups. |
| `pricing.ts` | Model → price table, longest-prefix resolution, and `costOfTotals` (token totals → dollar breakdown). |
| `advice.ts` | The savings ledger and the headline — pure functions over a `ScanResult` + cost. No I/O. |
| `mcpconfig.ts` | Read configured MCP servers from `.claude.json` for the configured-vs-used audit. |
| `reportdata.ts` | `buildReportData` + `computeCost`: assemble the `ReportData` object both the CLI and the extension feed to the renderer. |
| `report.ts` | `renderHtmlReport(data, opts?)` — the self-contained HTML dashboard as a template string. `opts` carries webview needs (CSP nonce, initial theme). |
| `style.ts` | ANSI helpers for the terminal (color off in pipes / under `NO_COLOR`). |
| `args.ts` | Argument parsing, `--help`, and the `--explain` methodology text. |
| `cli.ts` | The entry point: parse args → `scan` → render terminal output, or `--json` / `--html`. |

### Why `reportdata.ts` exists

`scan.ts` returns a rich, Map-based `ScanResult` tuned for computation. The HTML renderer wants a flat, JSON-serializable `ReportData`. `buildReportData` is the adapter between them — and because the **VS Code extension** also needs a `ReportData`, factoring it out of `cli.ts` is what lets both surfaces share one code path and guarantee identical numbers.

## Data model

Two types are worth knowing before touching the engine:

- **`ScanResult`** (`scan.ts`) — the computation-shaped output: token totals, `Map`s of per-model and per-session stats, sorted arrays of tools / reads / cache events / subagent groups, and the overall first/last timestamps that anchor projections.
- **`ReportData`** (`report.ts`) — the render-shaped, fully serializable view, including the precomputed `headline` and `fixes` from `advice.ts`.

The streaming pass in `scan.ts` is the heart of the project. It maintains per-file state (one `.jsonl` = one context window) and threads shared accumulators through a `FileScanContext`. The progressive-usage dedup, the residency settling, and the cache-TTL state machine all live in `scanFile`.

## Surfaces

- **Terminal** — `cli.ts` formats the `ScanResult` directly with `style.ts`.
- **HTML** — `cli.ts --html` calls `buildReportData` → `renderHtmlReport`, writes the file, opens it.
- **VS Code** — `extension/src/extension.ts` imports the same core (`scan`, `buildReportData`, `renderHtmlReport`) and hosts the HTML in a webview, plus a status-bar burn figure. The extension is an ESM package bundled to a CommonJS file (`dist/extension.cjs`) because VS Code loads extensions via `require`. See [extension/](../extension/).

## Tests (`tests/`)

vitest, with hand-computed expected values over synthetic fixtures — no snapshotting of real logs.

- `tests/fixtures/projects/` — a synthetic project exercising progressive usage, tool_use/tool_result, MCP calls, a compaction marker, legacy flat `cache_creation`, a subagent, a workflow + journal, and malformed lines.
- `tests/fixtures/naming/` — sessions with `ai-title` / `last-prompt`, plus workflow and subagent sidecars, for the leaderboard and naming.
- `scan.test.ts`, `advice.test.ts`, `naming.test.ts`, `pricing.test.ts`, `edge.test.ts` — every report is covered by a numeric assertion you can verify by hand.

CI runs typecheck + tests + build on Ubuntu and Windows, Node 20 and 22.

## Extending

**Add a model price** — one row in the `PRICING` table in `pricing.ts`. Longest-prefix matching handles dated ids automatically.

**Add a report** — accumulate it in the single `scanFile` pass (don't add a second walk over the data), expose it on `ScanResult`, map it into `ReportData` in `reportdata.ts`, then render it in `cli.ts` (terminal) and `report.ts` (HTML).

**Support another agent (Codex CLI, Gemini CLI, …)** — the analysis is agent-agnostic; what's Claude-specific is discovery, the record shape, and the cache-economics rules. A new adapter means a `discover`/`parser` pair plus a pricing/TTL profile; the residency, repeated-read, and session models carry over unchanged. This is roadmap, not yet built.
