# Contributing

This project is designed so community members can improve the FAQ without needing to understand the Worker codebase. A contribution is usually just one YAML file.

## What makes a good contribution

Good FAQ contributions usually do one of these well:

- add a question that really comes up in Discord, Reddit, or support discussions
- replace a shallow answer with something more concrete and current
- add official Anthropic sources to an answer that currently relies on community memory
- update stale pricing, plan, or product details (and bump `last_verified`)
- split an overloaded topic into clearer entries

## The submission standard

One entry = one file: `faq-content/<category>/<slug>.yaml`

- The **filename is the API slug**. Short, kebab-case, stable. Renaming a file breaks every bot that cached the slug, so treat renames as breaking changes.
- The **directory is the category**. Use an existing one when possible; a new directory needs a `_category.yaml` with `name:`.

```yaml
question: How do I request a refund for unexpected charges?
answer: |
  The answer, in markdown. Write for a tired human who wants the
  next correct step, not a wall of filler.
subcategory: Charges, Refunds, and Support   # optional
tags: [refund, charges]                      # optional; auto-generated if omitted
sources:
  - https://support.claude.com/en/articles/12386328-requesting-a-refund-for-a-paid-claude-plan
last_verified: 2026-06-09                    # YYYY-MM-DD; stamped at build time if omitted
answered_by: YourName                        # optional credit
```

Validation rules enforced by `bun run check:faq` (CI runs this on every PR):

- `question` (10–300 chars) and `answer` are required
- no placeholder text (`TODO`, `[temp answer]`, etc.)
- `sources` must be valid http(s) URLs; entries in `billing`, `models-safety-updates`, and `support-access` should cite at least one official source
- `last_verified` must be `YYYY-MM-DD`
- slugs must be unique across all categories
- no `docs.anthropic.com` links — use `code.claude.com/docs` or `platform.claude.com/docs` (the old domain redirects, but we link canonical URLs)

## Before you open a PR

1. Check whether the question already exists in `faq-content/` (search the directory, or hit `/search` on the API).
2. Prefer official Anthropic sources when the answer is time-sensitive.
3. Keep the question phrased the way users actually ask it.
4. Say plainly when Anthropic does not document something publicly. Never invent SLAs, pricing, or feature promises.

## Local flow

```bash
bun install
bun run check:faq
bun run build:faq
bun run typecheck
```

Preview the Worker locally with `bun run dev`.

## Pull request checklist

- the answer is actually useful, not just technically true
- source links are official where the topic is time-sensitive
- `bun run check:faq` passes
- `bun run build:faq` was run so `faq-index.json` is current
- wording is clear enough to reuse in bots or embeds

## Non-code contributions

If you are not comfortable opening a PR:

- use the FAQ suggestion issue template, or
- if you operate a bot with an API key, `POST /submissions` with the question, where it keeps coming up, and any official source (see `docs/API.md`). Maintainers review the queue and turn accepted suggestions into entries.
