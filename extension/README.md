# quotaburn for VS Code

See **where** your Claude Code quota burns, without leaving the editor.

- **Status bar**: your burn over the last 7 days (configurable) at API list prices, always visible. Click it for the full report.
- **Command** `quotaburn: Show Burn Report`: the complete dashboard — what your usage cost, what to fix (with projected $/month savings at your own blended rates), and where exactly it went: context eaters, your most expensive sessions by name, cache-expiry bills, startup tax, subagents and workflows.

## Privacy

Reads your local `~/.claude/projects` logs only. Zero network calls, zero telemetry, zero runtime dependencies. Everything is computed and rendered on your machine.

Same engine as the [quotaburn CLI](https://github.com/TheSeydiCharyyev/quotaburn) — `npx quotaburn` in any terminal.
