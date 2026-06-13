<div align="center">

# 🔥 quotaburn

**Find out _where_ your Claude Code quota burns — and how to stop it.**

[![npm version](https://img.shields.io/npm/v/quotaburn?color=e8590c&label=npm)](https://www.npmjs.com/package/quotaburn)
[![CI](https://github.com/TheSeydiCharyyev/quotaburn/actions/workflows/ci.yml/badge.svg)](https://github.com/TheSeydiCharyyev/quotaburn/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/quotaburn?color=3d8361)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

```sh
npx quotaburn
```

</div>

---

Most usage tools answer **how much** you burned. quotaburn answers **where it went** — which tools sit in your context window turn after turn, what resuming an idle session actually costs, how deep every session starts before you type a word — and prices each fix in dollars per month.

It reads the session logs Claude Code already writes to `~/.claude/projects`. No install, no signup, no config, no network. The published package is a single readable file with zero dependencies.

> Run on my own history: **~$3,000 of API-priced usage, and 21% of it was rebuilding prompt cache that expired while I was away from idle sessions.** One habit change — start fresh instead of resuming — saves ~$535/month. Your numbers will be different. That's the point.

## Quick start

```sh
npx quotaburn          # terminal report
npx quotaburn --html   # the same analysis as a visual dashboard, in your browser
```

Requires Node.js ≥ 20. Nothing is installed globally; `npx` runs it once and discards it.

<!-- TODO(launch): replace with a GIF — terminal run transitioning into the --html dashboard -->

## What it tells you

Six reports, all derived from data already on your disk:

| Report | What it surfaces |
| --- | --- |
| **Context eaters** | Tools and MCP servers ranked by _residency_ — tokens added × turns they stayed in context. A 300 KB result on turn 3 of a 50-turn session costs ~47× its size, not 1×. |
| **Top sessions** | Your most expensive sessions by name (the AI-generated titles Claude Code already stores), with subagent and workflow spend folded into the session that launched them. |
| **Cache expiry** | Every time you resumed an idle session and paid to rebuild the prompt cache, at up to 2× the input price — itemized, with the worst offenders. |
| **Startup tax** | How many tokens your system prompt + tools + skills + `CLAUDE.md` cost before your first word, and which configured MCP servers you load every session and never call. |
| **Repeated reads** | Files read again while a full copy was already sitting in the context window. |
| **Subagents & workflows** | What your background agents consumed, by human name (`workflow "repo-research"`, not `wf_4da6`). |

### The savings ledger

The headline feature is not generic advice — it's a **ledger**. Each fix is priced **per month at your own blended API rates**, projected from your actual data window, with the full calculation shown:

```
top fixes (savings projected from your last 36 days at your blended API rates):
  1. Don't resume idle sessions — start fresh with a short handoff   ~$535/mo
     199 rebuilds → 63,062,194 tok rewritten → $646.41 over 36 days
  2. Stop re-reading the same files                                   ~$50/mo
  3. Trim your session startup                                        ~$49/mo

  "You paid to rebuild expired cache 199 times — $646.41,
   21.3% of everything you've ever spent."
```

That last line is your **headline** — one copy-paste-ready sentence summarizing your single biggest leak.

## The dashboard

`npx quotaburn --html` renders the analysis as a **self-contained HTML file** and opens it in your browser. One file, everything inlined, zero external requests — it works offline and nothing ever leaves your machine. The layout answers three questions in order: _what did my usage cost? what should I do about it? where exactly did it go?_ Light and dark themes.

<!-- TODO(launch): screenshot of the dashboard hero + fixes -->

## VS Code extension

The same engine, inside your editor:

- A **status bar** item showing your burn over the last 7 days (configurable). Hover for your headline, click for the full report.
- The complete dashboard in a **webview**, themed to match your editor.

The extension lives in [`extension/`](extension/). It is not yet on the Marketplace; build it locally with `cd extension && npm install && npm run package`, then **Extensions: Install from VSIX…**.

## Why you can trust the numbers

quotaburn is built to be auditable, because a tool that reports on your spend has to be.

- **Local only.** It reads `~/.claude/projects` and nothing else. Zero network calls, zero telemetry.
- **Zero dependencies.** No transitive supply chain, no postinstall scripts, no binary downloads.
- **Readable.** The published bundle is a single un-minified file — audit it in two minutes.
- **Honest.** `quotaburn --explain` documents the methodology _and_ its caveats: residency is an estimate, cache-rebuild figures are an upper bound, unknown models are excluded rather than guessed.

One thing other parsers get wrong: Claude Code logs a streamed message as several records with **progressive** usage — `output_tokens` grows from record to record while input fields repeat. Count naively and you either double-count input or undercount output. quotaburn counts input once per message and accumulates output deltas. The full reasoning is in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## CLI reference

```
quotaburn [options]

  --days N          analyze only the last N days (default: full history)
  --project <path>  only sessions of the given project (path or fragment)
  --html            write a self-contained HTML report and open it
  --json            machine-readable output
  --explain         print methodology and honest caveats, then exit
  -v, --version     print version
  -h, --help        show help
```

The dollar figures are the **API-list-price value** of your usage. Subscription plans don't bill per token — but your _limits_ are denominated in compute, so cutting the waste quotaburn finds means hitting your limits later. See the [FAQ](docs/FAQ.md).

## Documentation

- [Methodology](docs/METHODOLOGY.md) — exactly how every number is computed, and where the estimates are.
- [Architecture](docs/ARCHITECTURE.md) — the parsing pipeline and how the pieces fit.
- [FAQ](docs/FAQ.md) — subscriptions, accuracy, other tools, supported platforms.
- [Contributing](CONTRIBUTING.md) — dev setup, tests, and what belongs in scope.
- [Changelog](CHANGELOG.md)

## Roadmap

- **Statusline mode** — your burn rate inside Claude Code's status line, all day.
- **`--compare`** — did your fixes work? Last 7 days vs the 7 before, in dollars.
- **Shareable card** — your three wildest numbers as one image, paths redacted.
- **More agents** — Codex CLI, Gemini CLI, opencode: the residency model is agent-agnostic.

Want one first? [Open an issue.](https://github.com/TheSeydiCharyyev/quotaburn/issues)

## Contributing

Bug reports from other people's logs are the most valuable contribution — log formats drift across Claude Code versions and machines, and parsing edge cases are exactly what I want to catch. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Seydi Charyyev
