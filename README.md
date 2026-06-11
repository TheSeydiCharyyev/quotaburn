# quotaburn

> I ran this on my own Claude Code history: **$3,000+ of API-priced usage — and 21% of it was rebuilding expired prompt cache after idle gaps.** One habit change saves ~$535/month.

**[ccusage](https://github.com/ryoppippi/ccusage) shows how much you burned. quotaburn shows _where_ — and how to stop it.**

<!-- GIF: terminal run of `npx quotaburn` + transition to the `--html` dashboard goes here -->

```
npx quotaburn          # terminal report
npx quotaburn --html   # visual dashboard, opens in your browser
```

No install, no signup, no config. Reads your local Claude Code logs and answers one question: *where did my quota actually go?*

## What it finds

```
estimated cost at API list prices:
  total                  $3019.91
    cache read           $1611.77   (0.1× input price)
    cache write          $1098.54   (1.25× 5m / 2× 1h)
    output                $306.15
    input (uncached)        $3.46

top context eaters (tokens added × turns they stayed in context):
  ███████████████░░░░░  76.3%  Read     2,336 calls  +10,386,984 tok
  ███░░░░░░░░░░░░░░░░░  15.0%  Bash     3,421 calls  +   955,461 tok
  ...

top sessions (top 5 = 31.0% of all spend · subagent spend folded in):
    $218.86  Understand React Foundation project structure    646 turns
    $209.16  Turkmen-Chinese translation app development      538 turns
  ...

cache expiry (idle gap > TTL → cache died, you paid to rebuild it):
  rebuilt after idle      63,062,194 tok  ≈ $646.41 at API prices

top fixes (savings projected from your last 36 days at your blended API rates):
  1. Don't resume idle sessions — start fresh with a short handoff   ~$535/mo
     199 rebuilds → 63,062,194 tok rewritten → $646.41 over 36 days
  2. Stop re-reading the same files                                   ~$50/mo
  3. Trim your session startup                                        ~$49/mo

  "You paid to rebuild expired cache 199 times — $646.41,
   21.3% of everything you've ever spent."
```

Six reports, all from data already sitting on your disk:

1. **Top context eaters** — which tools and MCP servers actually cost you, weighted by *residency*: a tool result enters the context once but gets re-sent on every later turn. 300 KB of MCP output at turn 3 of a 50-turn session costs ~47× its size.
2. **Top sessions** — your most expensive sessions by name (the AI-generated titles Claude Code already writes), with subagent and workflow spend folded into the session that launched them.
3. **Repeated file reads** — the same file read 35× in one session is real money.
4. **Cache expiry** — Anthropic's prompt cache dies after 5 minutes (or 1 hour) of idle. Come back to yesterday's session and you pay to rebuild it — at 2× the input price. quotaburn shows every one of those bills.
5. **Session startup tax** — how many tokens your system prompt + tools + skills + CLAUDE.md eat before your first word does anything, and which configured MCP servers are dead weight you load every session and never call.
6. **Subagents & workflows** — what your background agents really consumed, by human name (`workflow "repo-research"`, not `wf_4da6`), with each agent's task description one hover away.

Plus **top fixes**: a savings ledger, not generic advice. Each fix is priced per month at *your* blended API rates, projected from *your* actual data window, with the full calculation shown — and the single biggest finding is distilled into one copy-paste-friendly headline sentence.

## The dashboard

`npx quotaburn --html` renders the same analysis as a self-contained HTML file and opens it in your browser. One file, everything inline, zero external requests — it works offline and nothing ever leaves your machine. Three questions, in order: *what did my usage cost? what should I do about it? where exactly did it go?* Light and dark themes.

<!-- Screenshot: HTML dashboard hero + fixes goes here -->

## Privacy

- **Reads local files only** — your `~/.claude/projects` JSONL logs.
- **Zero network calls. Zero telemetry. Zero dependencies. No postinstall scripts, no binary downloads.**
- The published package is one small readable file — audit it in two minutes.
- Windows, macOS, Linux — first-class everywhere (it's developed on Windows).

## Why their numbers are wrong and ours aren't

Claude Code logs streamed messages as several records with *progressive* usage: `output_tokens` grows from chunk to chunk while input/cache fields repeat. Parsers that keep the first record undercount your output; parsers that sum every record double-count your input. quotaburn counts input once per message and accumulates output deltas to the final value. Run `npx quotaburn --explain` for the full methodology — including its honest caveats (residency is an estimate, cache rebuild numbers are an upper bound).

## Usage

```
quotaburn [options]

  --days N          analyze only the last N days (default: full history)
  --project <path>  only sessions of the given project
  --html            self-contained visual report, opens in your browser
  --json            machine-readable output
  --explain         print methodology and caveats
```

## FAQ

**I'm on a Pro/Max subscription — do these dollars mean anything?**
You don't pay per token, but your *limits* are denominated in compute. The dollar figures show the API-price value of your usage — the same flex as ccusage, plus an explanation of where it went. Cutting the waste quotaburn finds means hitting your limits later.

**Does it work on Windows?**
First-class. It's developed on Windows and CI-tested on Windows and Linux.

**How is this different from ccusage / claude-hud?**
They answer *how much* (totals, live status bar). quotaburn answers *where and why* — attribution by tool, by MCP server, by habit. Use them together: they're complementary, not competing.

## Roadmap

- **Statusline mode** — your burn rate living inside Claude Code's status line, all day.
- **`--compare`** — did your fixes work? Last 7 days vs the 7 before, in dollars.
- **Shareable burn card** — one image, your three wildest numbers, paths redacted.
- **More agents** — Codex CLI, Gemini CLI, opencode adapters: same residency model, their logs.
- **Team mode** — a CI bot that says *"this PR cost $14"*, built on the JSON output.

Want one of these first? Open an issue.

## License

MIT
