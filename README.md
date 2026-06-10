# ccwhy

> I ran this on my own Claude Code history: **$3,019 of API-priced usage — and 21% of it was rebuilding expired prompt cache after idle gaps.** One habit change fixes that.

**[ccusage](https://github.com/ryoppippi/ccusage) tells you HOW MUCH you burned. ccwhy tells you WHY.**

<!-- GIF: terminal recording of `npx ccwhy` on real data goes here -->

```
npx ccwhy
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

cache expiry (idle gap > TTL → cache died, you paid to rebuild it):
  rebuilt after idle      63,687,953 tok  ≈ $637.57 at API prices

top quick wins:
  1. don't resume idle sessions: $637.57 (21.0% of everything) went to
     rebuilding expired cache — start a fresh session with a short handoff
  2. same files re-read in one session: ~1,707,332 tok wasted
  3. every session starts ~30,904 tok deep before your first word
```

Five reports, all from data already sitting on your disk:

1. **Top context eaters** — which tools and MCP servers actually cost you, weighted by *residency*: a tool result enters the context once but gets re-sent on every later turn. 300 KB of MCP output at turn 3 of a 50-turn session costs ~47× its size.
2. **Repeated file reads** — the same file read 35× in one session is real money.
3. **Cache expiry** — Anthropic's prompt cache dies after 5 minutes (or 1 hour) of idle. Come back to yesterday's session and you pay to rebuild it — at 2× the input price. ccwhy shows every one of those bills.
4. **Session startup tax** — how many tokens your system prompt + tools + skills + CLAUDE.md eat before your first word does anything, and which configured MCP servers are dead weight you load every session and never call.
5. **Subagents & workflows** — what your background agents really consumed.

Plus **top quick wins**: up to three personalized recommendations, ranked by how much each one actually costs *you*.

## Privacy

- **Reads local files only** — your `~/.claude/projects` JSONL logs.
- **Zero network calls. Zero telemetry. Zero dependencies.**
- The published package is one small readable file — audit it in two minutes.

## Why their numbers are wrong and ours aren't

Claude Code logs streamed messages as several records with *progressive* usage: `output_tokens` grows from chunk to chunk while input/cache fields repeat. Parsers that keep the first record undercount your output; parsers that sum every record double-count your input. ccwhy counts input once per message and accumulates output deltas to the final value. Run `npx ccwhy --explain` for the full methodology — including its honest caveats (residency is an estimate, cache rebuild numbers are an upper bound).

## Usage

```
ccwhy [options]

  --days N          analyze only the last N days (default: full history)
  --project <path>  only sessions of the given project
  --json            machine-readable output
  --explain         print methodology and caveats
```

## FAQ

**I'm on a Pro/Max subscription — do these dollars mean anything?**
You don't pay per token, but your *limits* are denominated in compute. The dollar figures show the API-price value of your usage — the same flex as ccusage, plus an explanation of where it went. Cutting the waste ccwhy finds means hitting your limits later.

**Does it work on Windows?**
First-class. It's developed on Windows and CI-tested on Windows and Linux.

**How is this different from ccusage / claude-hud?**
They answer *how much* (totals, live status bar). ccwhy answers *why* — attribution by tool, by MCP server, by habit. Use them together: they're complementary, not competing.

## License

MIT
