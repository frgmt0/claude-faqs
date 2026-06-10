# Contributing

Thanks for being here. This page tells you **why** contributions matter, **what** to contribute, and **exactly how** — most contributions are one YAML file and take under ten minutes.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Why contribute?

Every answer in this repo gets served to real people at the moment they're stuck — through Discord bots, Reddit helpers, and dashboards that query the API. One accurate, sourced answer here can quietly help hundreds of people who would otherwise get Reddit lore or a confident wrong answer.

The flip side: Anthropic ships fast, so answers rot fast. Pricing changes, models retire, commands get renamed. **The single most valuable contribution is noticing that an answer drifted from reality and fixing it.** You don't need to know TypeScript; you don't even need to know what a Worker is.

What you get: contributor credit on the entry (`answered_by`), a spot in [WALL_OF_FAME.md](WALL_OF_FAME.md), and a genuinely useful first open-source contribution.

## Three ways to contribute (pick your comfort level)

| Route | Effort | Good for |
| --- | --- | --- |
| **1. Open an issue** | 2 min | Reporting a stale answer, suggesting a question — no git needed |
| **2. API submission** | automatic | Bot operators: `POST /submissions` forwards questions from your community ([docs](docs/API.md#submissions)) |
| **3. Pull request** | 10 min | Adding or fixing an entry yourself — the gold standard |

## The submission standard (route 3)

One entry = one file: `faq-content/<category>/<slug>.yaml`

- The **filename is the API slug**. Short, kebab-case, stable. Renaming a file breaks every bot that cached the slug, so treat renames as breaking changes.
- The **directory is the category**. Use an existing one; a new directory needs a `_category.yaml` with `name:`.

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

### Validation rules (CI enforces these)

`bun run check:faq` runs on every PR and checks:

- `question` (10–300 chars) and `answer` are required
- no placeholder text (`TODO`, `[temp answer]`, etc.)
- `sources` must be valid http(s) URLs; entries in `billing`, `models-safety-updates`, and `support-access` should cite at least one official source
- `last_verified` must be `YYYY-MM-DD`
- slugs must be unique across all categories
- no `docs.anthropic.com` links — use `code.claude.com/docs` or `platform.claude.com/docs`

### Writing standards

1. **Phrase the question the way users actually ask it** — "Why was I charged $850?" beats "Billing anomaly FAQ".
2. **Official sources for anything time-sensitive.** Pricing, plans, limits, policy: link support.claude.com / code.claude.com / platform.claude.com / claude.com. Community links don't count as sources for facts.
3. **Say plainly when something isn't documented.** "Anthropic does not publish exact quotas" is a good answer. An invented number is not.
4. **No speculation presented as fact.** If the community reports something Anthropic hasn't confirmed, label it as community-reported.
5. **Check for duplicates first** — search `faq-content/` or hit `/search` on the API.

## The PR flow, start to finish

```bash
# fork on GitHub, then:
git clone https://github.com/<you>/claude-faqs && cd claude-faqs
git checkout -b fix/max-pricing
bun install

# add or edit faq-content/<category>/<slug>.yaml, then:
bun run check:faq      # must pass — CI runs the same thing
bun run typecheck      # for code changes

git add . && git commit -m "fix max pricing entry"
git push origin fix/max-pricing
# open the PR — the template walks you through the checklist
```

What happens next:

1. **CI** runs `check:faq`, `build:faq`, and `typecheck` automatically. A red ✗ usually means a validation rule above — the log says exactly which file and why.
2. **Review**: `main` is protected; every PR needs CI green plus one maintainer approval. Expect review within a few days; small factual fixes go fastest.
3. **Merge**: squash-merged, your branch auto-deleted.
4. **Deploy**: maintainers deploy the Worker, and your answer is live on the API.

## For code contributions

The Worker lives in `src/`, scripts in `scripts/`. Run a local API with `bun run dev` (seed a local key first — see `docs/API.md`). Keep changes additive within `/v1`: bots in the wild parse these responses, so removing or renaming response fields is a breaking change that needs a discussion issue first.

## House rules recap

- This is an independent community project, **not affiliated with Anthropic**. We can't fix anyone's account; we document the correct next step.
- Never commit API keys, even revoked ones (push protection will block known formats, but don't test it).
- Maintainers may edit submissions for clarity and accuracy.
