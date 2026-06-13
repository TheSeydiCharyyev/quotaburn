# FAQ

### I'm on a Pro / Max subscription — do these dollars mean anything?

You don't pay per token, so the figures aren't a bill. But your **limits** are denominated in compute, and the dollar amounts are the API-list-price *value* of what you used — the same flex other usage tools show. The point isn't the number; it's the attribution. Cutting the waste quotaburn finds means you hit your limits later.

### Are the numbers exact?

Token totals and dollars are computed precisely from the `usage` blocks Claude Code records (see [usage deduplication](METHODOLOGY.md#usage-deduplication)). Two things are deliberately *estimates*, and labeled as such: **residency** (tool-result sizes are approximated at ~4 chars/token) and **cache-rebuild cost** (an upper bound — the first post-idle turn mixes new content with the rebuild). Unknown-model usage is excluded, so totals are a floor, never inflated. Full detail in [METHODOLOGY.md](METHODOLOGY.md#caveats-in-one-place).

### My numbers look wrong / it crashed on my logs.

That's the most useful bug you can file. Log formats drift between Claude Code versions and across machines, and catching those edge cases is exactly the goal. Open an [issue](https://github.com/TheSeydiCharyyev/quotaburn/issues) — `quotaburn --explain` and the `skipped` line count help diagnose.

### Does it work on Windows?

First-class. It's developed on Windows and CI-tested on Windows and Linux (and macOS via the same Node paths). Discovery uses `os.homedir()` and `path.join`, never hard-coded `~/`.

### How is this different from other usage tools?

Most answer *how much* — totals, a live status bar. quotaburn answers *where and why*: attribution by tool, by MCP server, by session, by habit, each priced as a fix. They're complementary; run both.

### Does it send my data anywhere?

No. It reads `~/.claude/projects` and computes everything locally. Zero network calls, zero telemetry, zero dependencies. The published bundle is one readable file you can audit. See [SECURITY.md](../SECURITY.md).

### What does `--html` need? Will it phone home?

Nothing, and no. It writes one self-contained HTML file with all CSS, JS, and data inlined — no CDNs, no web fonts, no external requests. It works offline from `file://`.

### Where does it look for logs?

`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects` if you've set `CLAUDE_CONFIG_DIR` (quotaburn honors it the same way Claude Code does).
