# Changelog

All notable changes to quotaburn are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/TheSeydiCharyyev/quotaburn/releases/tag/v0.1.0
[0.0.1]: https://github.com/TheSeydiCharyyev/quotaburn/releases/tag/v0.0.1
