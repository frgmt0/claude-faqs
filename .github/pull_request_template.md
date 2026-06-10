## Summary

Describe what changed and why. One or two sentences is fine.

## Type of change

- [ ] New FAQ entry (`faq-content/<category>/<slug>.yaml`)
- [ ] Fixed or improved an existing answer
- [ ] Updated stale facts, sources, or `last_verified` dates
- [ ] Worker / search / API change
- [ ] Docs, templates, or tooling

## Content checklist (skip for code-only PRs)

- [ ] The filename is a short, stable, kebab-case slug (it becomes the API slug — renames break bots)
- [ ] Time-sensitive claims (pricing, plans, limits, policy) cite an official Anthropic source in `sources:`
- [ ] `last_verified:` is set to today for anything I verified
- [ ] I said plainly where Anthropic does not document something publicly — no invented SLAs or promises
- [ ] No `docs.anthropic.com` links (use `code.claude.com/docs` or `platform.claude.com/docs`)

## Validation

- [ ] `bun run check:faq` passes
- [ ] `bun run typecheck` passes (code changes only)

## Credit

If you want contributor credit on the entry, add `answered_by: YourName` in the YAML — and feel free to add yourself to `WALL_OF_FAME.md` on your first merged PR.
