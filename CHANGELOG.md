# Changelog

All notable changes to quotaburn are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1]

A correctness release. Every dollar and residency figure 0.1.0 printed was
wrong to some degree: its price table ended at Claude Opus 4.8, so the models
most people now run were silently dropped from every total. If you installed
0.1.0 from npm, re-run this version before acting on anything it told you.

### Fixed

- **Pricing covers the current lineup.** Claude Opus 5.5, Opus 5, Sonnet 5.5,
  Sonnet 5, Haiku 5.5 and Fable 5.1, plus the models retired from the Claude
  API but still served on Bedrock and Google Cloud. Usage on an unpriced model
  was excluded from totals, so a session on the default model of most paid
  plans scored $0 and the session leaderboard ranked the wrong sessions.
- **Cache reads are priced per model.** They are 0.1x the input price on most
  models, but 0.05x on Opus 5.5 and Sonnet 5.5 and 0.025x on Fable 5.1. A flat
  0.1x overstated Fable 5.1 by four times on its largest token category.
- **Prefix matching stops at a version boundary.** `claude-opus-5-5` no longer
  inherits `claude-opus-5`’s price, and cloud ids such as
  `anthropic.claude-opus-5-5` resolve to the same rows.
- **Failed requests are no longer read as context resets.** Claude Code logs a
  request that never answered as an assistant record with model `<synthetic>`
  and zero usage. Its zero context size tripped the collapse heuristic, which
  settled residency for every tool result then in the window — a dropped
  connection or an interrupt wiped the attribution behind it.
- **One compaction counts as one reset.** A compaction writes both a system
  `compact_boundary` and a user `isCompactSummary` record, and each was counted.
- **Images are sized by their pixels.** A screenshot arrives as base64, whose
  length says nothing about its cost; the API prices an image by area after
  downscaling. Sizing it as characters/4 overstated it by one to two orders of
  magnitude and put the tool that reads screenshots on top of the residency
  ranking by itself.
- **Text uses the current tokenizer.** About 2.5 characters per token for the
  tokenizer introduced with Claude Opus 4.7, still 4 for Claude Sonnet 4.6 and
  earlier, chosen per the model that answered the turn.
- **A repeated read must be a copy that is still in context.** The detector
  keyed on the file path across the whole scan, so reads from other sessions,
  other subagents, other line ranges, and reads after a compaction all counted
  as waste, each charged at the average read size. A duplicate now requires the
  same transcript, the same context segment, the same `offset`/`limit` and the
  same content hash, and is charged at its own size. Claude Code’s own
  `file_unchanged` stubs are skipped.
- **Startup cost is measured only for sessions that began inside the window.**
  Under `--days`, the first turn after the cutoff was recorded as a session
  start, so a mid-conversation context was reported as the p90 startup depth.
- **Post-idle cache rebuilds are capped at the context size carried into the
  gap**, so a document pasted on the first turn back is not billed as a rebuild.
- **The cache TTL resets after a compaction**, and streamed records fall back to
  `requestId` rather than a per-record uuid when `message.id` is missing.

### Changed

- **The headline names the window it measured.** It claimed a share of
  "everything you’ve ever spent" while measuring the scanned window.
- **The 1h-TTL figure explains itself.** On a subscription the main conversation
  is already cached for an hour, so the avoidable figure is near zero by design;
  the 5-minute TTL applies to subagents, workflows and compaction, and to usage
  billed to credits, an API key or a cloud provider.
- **A never-called MCP server is no longer called dead weight loaded every
  session.** Claude Code defers MCP tool schemas by default, so such a server
  costs its name and instructions, not its full schema weight. The audit reads
  `~/.claude.json` only, which now says so: plugin servers and claude.ai
  connectors are outside it.
- **The subscription disclaimer is accurate.** Plan usage is not billed per
  token, but usage credits are, at these very rates: usage past plan limits,
  fast mode, and Fable models on some plans.

### Added

- `--json` carries a `cost` block, including `unpricedModels` — the models with
  usage that carry no price, so a consumer can tell the dollars are a floor.
  The dashboard names them when nothing at all could be priced, where it used
  to drop the row, and the VS Code status-bar tooltip says what it excluded.
- A `prepare`/`prepublishOnly` gate so a clean checkout cannot publish a stale
  or missing `bin`, and CI now runs the built CLI against fixtures and builds
  the extension.
- 69 tests, up from 40.
## [0.1.0]

### Added

- **Savings ledger** — every fix priced in dollars per month at your own
  blended API rates, projected from your actual data window, with the
  calculation shown.
- **Headline** — one copy-paste-ready sentence summarizing your single
  biggest leak, in the terminal and at the top of the dashboard.
- **Session leaderboard** — your most expensive sessions by name (from the
  `ai-title` records Claude Code writes), with subagent and workflow spend
  folded into the launching session.
- **Human names for subagents and workflows** — `workflow "repo-research"`
  instead of `wf_4da6`, named from the workflow sidecar and parent session
  title, with per-agent task descriptions.
- **Redesigned `--html` dashboard** — a three-question narrative (what did
  it cost / what to do / where it went) with progressive disclosure, light
  and dark themes.
- **VS Code extension** (`extension/`) — status-bar burn figure and the full
  dashboard in a webview, sharing the CLI's engine.

### Changed

- Report generation refactored into a shared `reportdata.ts` so the CLI and
  the extension produce identical numbers.
- README reorganized; methodology, architecture, and FAQ moved into `docs/`.

## [0.0.1]

### Added

- Initial release: streaming JSONL parser with progressive-usage
  deduplication; residency-weighted context-eater attribution; cache-expiry
  billing; session startup tax; repeated-read detection; MCP
  configured-vs-used audit; subagent/workflow accounting; per-model dollar
  costs at API list prices.
- Flags: `--days`, `--project`, `--json`, `--explain`, `--help`,
  `--version`.
- Zero runtime dependencies; CI on Windows and Ubuntu.

[0.1.1]: https://github.com/TheSeydiCharyyev/quotaburn/releases/tag/v0.1.1
[0.1.0]: https://github.com/TheSeydiCharyyev/quotaburn/releases/tag/v0.1.0
[0.0.1]: https://github.com/TheSeydiCharyyev/quotaburn/releases/tag/v0.0.1
