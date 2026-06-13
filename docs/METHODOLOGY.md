# Methodology

How quotaburn turns raw Claude Code logs into the numbers you see. This document is deliberately exhaustive — if you want to challenge a figure, this is where to aim. Every section ends honest about what is exact and what is an estimate.

The same explanation, condensed, prints from `quotaburn --explain`.

## Contents

- [Data source](#data-source)
- [Usage deduplication](#usage-deduplication)
- [Dollars](#dollars)
- [Residency cost](#residency-cost)
- [Cache expiry](#cache-expiry)
- [Startup tax](#startup-tax)
- [Repeated reads](#repeated-reads)
- [Per-session attribution](#per-session-attribution)
- [Subagents and workflows](#subagents-and-workflows)
- [The savings ledger](#the-savings-ledger)
- [Caveats, in one place](#caveats-in-one-place)

## Data source

Claude Code writes every session as a [JSON Lines](https://jsonlines.org/) file under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects` if you set it). Each line is one record: an assistant turn with a `usage` block, a user turn with tool results, a session-title record, a compaction marker, and so on.

quotaburn streams these files line by line — it never loads a file wholly into memory, so a 250 MB history is processed in a couple of seconds. Records whose `type` it doesn't recognize, and lines that don't parse as JSON, are skipped without failing: the log format is undocumented and changes between versions, so resilience is a requirement, not a nicety. The count of skipped lines is reported.

**It only ever reads.** No network calls, no telemetry, nothing is written back to your Claude directory.

## Usage deduplication

This is the subtle one, and the one naive parsers get wrong.

A streamed assistant message is logged as **several records** that share the same `message.id` and `requestId`. Their `usage` is **progressive**: `output_tokens` grows from record to record as the stream arrives, while the input-side fields (`input_tokens`, `cache_read_input_tokens`, `cache_creation_*`) repeat unchanged on every record.

Two failure modes follow:

- **Sum every record** → you count the input/cache side once per chunk and massively over-count it.
- **Keep the first record** → you capture the smallest, earliest `output_tokens` and under-count output.

quotaburn keys on `message.id + requestId`. The **first** record of a message contributes its input/cache fields once; **subsequent** records contribute only the *growth* in `output_tokens` (the delta over the highest value seen so far). Input is counted once; output accumulates to its true final value.

This is why quotaburn's output-token totals can be meaningfully higher than other tools' — they are not inflated, the others are short.

## Dollars

Dollar figures are the **API-list-price value** of your usage. Subscription plans do not bill per token; this is the same flex other usage tools show, expressed so it can be attributed.

Per-model prices are a built-in table (Anthropic API list prices, cached June 2026). Models are matched by exact id, then by longest prefix — so a dated id like `claude-haiku-4-5-20251001` resolves to the `claude-haiku-4-5` row. **Unknown models are excluded from totals, never guessed** — a model with no price contributes zero dollars rather than a fabricated number, so totals are a floor, not an invention.

Cache multipliers, per Anthropic's pricing:

| Token kind | Multiplier on input price |
| --- | --- |
| Cache read | 0.1× |
| Cache write, 5-minute TTL | 1.25× |
| Cache write, 1-hour TTL | 2× |

## Residency cost

The central idea, and what makes the "context eaters" report different from a token tally.

A tool result enters your context **once**. But the context window is re-sent on **every subsequent turn** of the session (as cache reads, or as input). So the real cost of a result is not its size — it's:

```
residency cost = tokens × (number of later turns it stayed in context)
```

A 300 KB tool result dropped in at turn 3 of a 50-turn session isn't "300 KB" — it rides along ~47 more times. Ranking tools by tokens-added is misleading; ranking by residency changes the picture, and it's usually file reads that dominate.

**Settling at boundaries.** When the context is compacted or reset, earlier results leave the window and stop accruing cost. quotaburn detects these boundaries two ways:

1. **Explicit markers** — `summary` records, `isCompactSummary`, and `compact_boundary` system records.
2. **A heuristic** — the context size collapsing to less than half of a ≥ 80,000-token base between consecutive turns.

At each boundary, the residency of every pending result is "settled" (charged up to that turn) and the slate is cleared.

**Estimate, not invoice.** Tool-result sizes are estimated at ~4 characters per token, which is fine for *ranking* but is not a billing-grade count. Residency is an attribution model, not a line item on an Anthropic invoice.

## Cache expiry

Anthropic's prompt cache has a TTL — 5 minutes by default, 1 hour when 1h cache writes are in use. Reads refresh the clock; they don't extend the TTL kind. When a session sits **idle longer than its TTL**, the cache dies, and the next turn re-writes the whole context — which you pay for at the cache-write multiplier.

quotaburn detects this by the time gap between consecutive turns. When the gap exceeds the live TTL, the `cache_creation` tokens on the first turn after the gap are billed as **rebuild cost**, and the event is recorded (when, how long idle, how many tokens, which model).

- **`avoidable with 1h TTL`** isolates the rebuilds where the gap was ≤ 1 hour and the TTL was only 5 minutes — i.e. what a longer TTL would have saved ([anthropics/claude-code#46829](https://github.com/anthropics/claude-code/issues/46829)). When this is small, the lesson isn't "use a longer TTL," it's "don't resume stale sessions."
- **Upper bound.** The first turn after a gap usually contains *some* genuinely new content too, so attributing all of its `cache_creation` to the rebuild slightly overstates the avoidable part. quotaburn says so rather than hiding it.

## Startup tax

The first assistant turn of a main session already carries the system prompt, tool definitions, skills, and `CLAUDE.md`/memory — before you've done anything. quotaburn records that first-turn context size (input + cache read + cache creation) for every main session and reports the **median** and **p90**.

The spread between median and p90 is usually tiny, which is the real insight: this cost is *structural*, paid on every session, so every instruction or unused MCP server you trim pays off repeatedly. Subagent transcripts are excluded — they don't have a user-facing startup.

## Repeated reads

When the same `file_path` is read more than once within a single session's context window, every read after the first is redundant — the content was already resident. quotaburn estimates the wasted tokens as the average read size × (reads − 1) and ranks files by total waste.

## Per-session attribution

The session leaderboard ranks sessions by dollar cost. Cost is computed **per record** at that record's model price, which — because pricing is linear in tokens — sums to exactly what pricing the session's totals would give.

Crucially, **subagent and workflow spend is folded into the parent session**. A subagent transcript carries its parent session id; its dollars are added to that session's bill. So a session's figure is its *true* cost, including the background agents it spawned, not just its foreground turns. Turn counts, by contrast, count only the main session's assistant turns.

Session titles come from the `ai-title` records Claude Code writes; when a session has none, the last user prompt is used as a fallback label, truncated.

## Subagents and workflows

Subagent transcripts live under `<session>/subagents/…`; workflow agents under `<session>/subagents/workflows/<wfId>/agent-*.jsonl`. quotaburn groups them:

- **Workflow runs** are keyed by their `wf_*` id and **named** from the `workflowName` field of the `<session>/workflows/<wfId>.json` sidecar.
- **Standalone subagents** are grouped by parent session and named after that session's `ai-title`.
- Each group also collects up to five per-agent task descriptions from the `agent-*.meta.json` sidecars (shown as a tooltip in the dashboard).

The `journal.jsonl` of a workflow run is not counted as an agent.

## The savings ledger

Each fix in the "top fixes" report is priced in **dollars per month**, and the projection is grounded in *your* data, not a generic rule of thumb.

1. **Your blended rate.** quotaburn derives the $/Mtok you actually pay for cache reads and cache writes by dividing your real dollar cost by your real token volume — so the rate reflects your own model mix, not a single model's list price.
2. **Your window.** Waste observed over the actual span of your logs (first to last timestamp) is extrapolated to 30 days. A `--days 7` run and a full-history run project differently, on purpose.
3. **Shown math.** Every fix carries the calculation line it was derived from. No magic numbers.

The fixes are ranked by a severity score that puts directly-avoidable waste (idle rebuilds, repeated reads) above general advice (read selectively), and the top-ranked fix is reworded into the one-sentence **headline**.

The specific projections are estimates of *future* savings assuming your recent behavior repeats — they are a planning aid, not a guarantee.

## Caveats, in one place

quotaburn would rather under-claim than mislead. The honest limits:

- **Residency is an estimate.** Tool-result token sizes are approximated at ~4 chars/token; the model attributes cost, it doesn't reproduce an invoice.
- **Cache-rebuild figures are an upper bound.** The first post-idle turn mixes genuine new content with the rebuild.
- **Dollars are API-list-price value.** Not what a subscription charged you. Unknown-model usage is excluded, so totals are a floor.
- **Compaction detection is partly heuristic.** The "context dropped below half" rule can, in principle, misfire on an unusual session shape.
- **Savings projections assume your recent window repeats.** A one-off heavy week projects a heavy month.

If a number still looks wrong on your machine, that's a bug worth reporting — see [CONTRIBUTING.md](../CONTRIBUTING.md).
