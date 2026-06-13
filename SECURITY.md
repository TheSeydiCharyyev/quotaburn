# Security

## Threat model, stated plainly

quotaburn reports on your spend, so its trustworthiness matters. By design:

- **It only reads.** It reads `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) and never writes to your Claude directory.
- **It makes no network calls.** No telemetry, no analytics, no price-fetching at runtime — the price table is built in.
- **It has zero runtime dependencies.** No transitive packages, no postinstall scripts, no binary downloads.
- **It is auditable.** The published npm package is a single un-minified file. Read it before you run it:

  ```sh
  npm view quotaburn dist.tarball   # download and inspect
  ```

The `--html` report is likewise self-contained: one file with all CSS, JS, and data inlined, no external requests.

## A privacy note for you

Reports include **file paths and session titles** from your machine. Before pasting output into an issue, a chat, or social media, review it and redact anything private.

## Reporting a vulnerability

If you find a security issue — for example a way quotaburn could be made to write outside its read path or exfiltrate data — please report it privately via [GitHub Security Advisories](https://github.com/TheSeydiCharyyev/quotaburn/security/advisories/new) rather than a public issue. You'll get a response as soon as possible.
