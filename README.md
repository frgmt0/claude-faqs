# Claude Community FAQ API

A community-maintained FAQ corpus for Claude, Claude Code, and Anthropic account issues, served through a Cloudflare Worker API so Discord bots, Reddit bots, dashboards, and internal tools can pull answers programmatically.

## What this repo contains

- `faq-content/`: the YAML source of truth — one file per FAQ entry
- `scripts/build-faq-index.ts`: compiles the YAML tree into `faq-index.json`
- `scripts/check-faq-content.ts`: schema validation, run in CI
- `src/`: the Cloudflare Worker API, search logic, and types
- `docs/API.md`: API reference with request and response examples
- `WALL_OF_FAME.md`: contributor recognition

## FAQ categories

- [Account Issues](faq-content/account-issues/)
- [Billing and Plans](faq-content/billing/)
- [Claude Code Workflows](faq-content/claude-code/)
- [Claude Code Operations](faq-content/claude-code-operations/)
- [Context, Caching, Streaming, and Batch](faq-content/context-caching/)
- [Backend and Integrations](faq-content/backend-integrations/)
- [Models, Safety, and Updates](faq-content/models-safety-updates/)
- [Support and Access](faq-content/support-access/)
- [Claude Usage](faq-content/claude-usage/)
- [General Questions](faq-content/general/)

## FAQ file format

One entry per file: `faq-content/<category>/<slug>.yaml`. **The filename is the API slug**, so pick a short, stable, kebab-case name and don't rename files casually — bots cache slugs.

```yaml
question: What does Claude Max cost?
answer: |
  Markdown-capable answer text. Keep it practical and direct.

  Multiple paragraphs are fine.
subcategory: Plans and Pricing   # optional, defaults to "General"
tags: [max, pricing]             # optional, auto-generated from text if omitted
sources:                         # official URLs backing the answer
  - https://support.claude.com/en/articles/11049741-what-is-the-max-plan
last_verified: 2026-06-09        # YYYY-MM-DD; build stamps today if omitted
answered_by: YourName            # optional contributor credit
```

Each category directory has a `_category.yaml` with the display name:

```yaml
name: Billing and Plans
```

New categories and entries are auto-discovered — you do not need to register files anywhere.

## Contributing a FAQ update

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide (why, what, and how — most contributions are one YAML file) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards. The short version:

1. Fork the repo and create a branch.
2. Add or edit a `faq-content/<category>/<slug>.yaml` file.
3. Run the local checks.
4. Open a pull request.

```bash
bun install
bun run check:faq    # schema validation — CI runs this too
bun run build:faq    # regenerates faq-index.json
bun run typecheck
```

Optional local API preview:

```bash
bun run dev
```

## Suggesting new FAQs without a PR

Two options:

- Open a GitHub issue with the suggested question, where you saw it come up, and any official Anthropic source that helps answer it.
- If you run a bot with an API key, `POST /submissions` — see [docs/API.md](docs/API.md). Maintainers review the queue and turn accepted suggestions into entries.

## API usage

See [docs/API.md](docs/API.md) for endpoints, auth, response formats, and Discord bot examples.

## Recognition

Contributors and maintainers are recognized in [WALL_OF_FAME.md](WALL_OF_FAME.md).

---
*This project is an independent community effort and is not affiliated with Anthropic or Claude in any way.*
