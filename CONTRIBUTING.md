# Contributing

Thanks for looking. The most valuable contribution to quotaburn is **a bug report from your own logs** — the Claude Code log format is undocumented and shifts between versions, so real-world parsing edge cases are exactly what the project needs.

## Reporting a bug

Open an [issue](https://github.com/TheSeydiCharyyev/quotaburn/issues) with:

- what you ran (`quotaburn`, `--days 7`, `--html`, …),
- what looked wrong or the full error text,
- your OS and `claude --version`,
- the `skipped` line count from the run if it's non-trivial.

⚠️ Output can contain **file paths and session titles** from your machine. Redact before pasting anything public.

## Development setup

Requires Node.js ≥ 20.

```sh
git clone https://github.com/TheSeydiCharyyev/quotaburn
cd quotaburn
npm install
npm run dev        # run against your real logs (tsx src/cli.ts)
npm test           # vitest, 33 tests
npm run typecheck  # tsc --noEmit
npm run build      # bundle to dist/cli.js
```

For the VS Code extension:

```sh
cd extension
npm install
npm run build      # bundle to dist/extension.cjs
npm run package    # build a .vsix
```

## The three rules

Non-negotiable, because they're the product's promise:

1. **Zero runtime dependencies.** Dev tooling is fine; nothing ships in the bundle.
2. **Stream, don't slurp.** Never load a whole log file into memory.
3. **Never throw on bad input.** Unknown record types and malformed lines are skipped and counted, not fatal.

## Adding tests

Tests use hand-computed expected values over synthetic fixtures in `tests/fixtures/` — no snapshots of real logs. If you add a report or fix a parsing case, add a fixture line and a numeric assertion that a human can verify. See [ARCHITECTURE.md](docs/ARCHITECTURE.md#tests-tests) for the layout.

## Pull requests

- Keep `npm run typecheck`, `npm test`, and `npm run build` green — CI runs all three on Ubuntu and Windows, Node 20 and 22.
- Match the surrounding style: small functions, comments that explain *why* (especially around the log-format quirks), no new dependencies.
- One focused change per PR. If it touches how a number is computed, update [docs/METHODOLOGY.md](docs/METHODOLOGY.md) in the same PR.

## Scope

quotaburn does one thing: tell you where your Claude Code quota goes, from local logs. Good fits: better attribution, new report dimensions, more model prices, support for another agent's logs, accuracy fixes. Out of scope: anything that needs a network call, a runtime dependency, or writing to your Claude directory.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
