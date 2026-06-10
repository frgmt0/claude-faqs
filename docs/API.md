# Claude FAQ API

Base URL: `https://api.frgmt.xyz/claude-faqs/v1`

A community FAQ corpus for Claude, Claude Code, and Anthropic account questions, served as JSON for Discord bots, Reddit bots, dashboards, and internal tools. Current API version: `1.1.0`.

**Jump to:** [Quickstart](#quickstart) · [Authentication](#authentication) · [Endpoints](#endpoints) · [Discord bot guide](#building-a-discord-bot-on-this-api) · [Submitting FAQ suggestions](#submissions) · [Errors](#error-reference) · [Troubleshooting](#troubleshooting--common-pain-points)

---

## Quickstart

You need an API key (see [Authentication](#authentication)). Then:

```bash
# 1. Sanity check — no key needed
curl https://api.frgmt.xyz/claude-faqs/v1/health

# 2. Search for an answer
curl -H "Authorization: Bearer cfaq_your_key" \
  "https://api.frgmt.xyz/claude-faqs/v1/search?q=usage+limits"

# 3. Fetch the full entry by slug
curl -H "Authorization: Bearer cfaq_your_key" \
  "https://api.frgmt.xyz/claude-faqs/v1/how-usage-limits-work"
```

The standard integration pattern is **search → pick a slug → fetch the entry**. If you're building for Discord, add `?format=discord` and you get embed-shaped JSON you can send as-is.

## Authentication

All endpoints except `GET /health` require an API key.

| Method | Example |
| --- | --- |
| Header (preferred) | `Authorization: Bearer cfaq_abc123...` |
| Query param | `?apikey=cfaq_abc123...` |

Prefer the header — query strings end up in logs, link previews, and pasted screenshots.

**Getting a key:** keys are issued by the maintainers. Ask in the community Discord or open a GitHub issue on the repo. Say what you're building and roughly how much traffic you expect.

**Tiers and rate limits:**

| Tier | Per minute | Per day |
| --- | --- | --- |
| standard | 30 | 1,000 |
| premium | 100 | 10,000 |

Every authenticated response includes your remaining budget:

```
X-RateLimit-Remaining-Minute: 28
X-RateLimit-Remaining-Day: 994
X-RateLimit-Reset-Minute: 2026-06-10T06:10:00.000Z
X-RateLimit-Reset-Day: 2026-06-11T06:00:00.000Z
X-Authenticated-As: your-key-name
```

## The FAQ entry object

```json
{
  "slug": "claude-max-cost",
  "question": "What does Claude Max cost?",
  "answer": "As of June 2026, Max comes in two web tiers...",
  "tags": ["max", "pricing", "plans"],
  "category": "Billing and Plans",
  "category_slug": "billing",
  "subcategory": "Plans and Pricing",
  "subcategory_slug": "plans-and-pricing",
  "source_file": "billing/claude-max-cost.yaml",
  "source_urls": ["https://support.claude.com/en/articles/11049741-what-is-the-max-plan"],
  "last_verified_at": "2026-06-09",
  "answered_by": "Jason"
}
```

What to do with each field:

- `slug` — stable ID. Cache it, deep-link with it. Slugs do not change casually (a rename is treated as a breaking change in the repo).
- `answer` — markdown. Discord renders most of it natively; strip or convert for plain-text surfaces.
- `source_urls` — official references. **Show these for anything involving money, bans, or policy.**
- `last_verified_at` — freshness hint. If it's months old and the topic is pricing, treat with suspicion and check the source link.
- `answered_by` — contributor credit; show it if convenient, it keeps contributors contributing.

## Endpoints

### `GET /health` — no auth

```json
{ "status": "ok", "version": "1.1.0", "entry_count": 115, "generated_at": "..." }
```

Use for uptime monitors and bot status pages. Doesn't touch your rate limit.

### `GET /` — metadata

API version, entry counts, auth info, and the route map. Good for debugging which deployment you're talking to.

### `GET /search?q=...` — find entries

The workhorse. Params:

| Param | Default | Notes |
| --- | --- | --- |
| `q` | required | The user's question, as typed is fine |
| `mode` | `tags` | `tags` = fast keyword scoring; `semantic` = embedding similarity |
| `limit` | 5 | max 10 |
| `format` | — | `discord` returns embed objects |

```bash
curl -H "Authorization: Bearer cfaq_your_key" \
  "https://api.frgmt.xyz/claude-faqs/v1/search?q=why+was+I+charged+850&mode=semantic"
```

Results are summaries (`preview` instead of full `answer`) plus a `score`. Scores are comparable within one response only — don't compare a tags score to a semantic score.

**Which mode?** Start with `tags` (faster, no AI dependency). Fall back to `semantic` when tags returns nothing or the query is phrased conversationally ("my money disappeared??"). A good bot does: tags first → if `count == 0`, retry semantic.

### `GET /{slug}` — fetch one entry

Returns the full entry. Unknown slugs return 404 with `did_you_mean` suggestions — surface those instead of a dead end:

```json
{
  "error": "FAQ entry not found",
  "slug": "usage-limit",
  "did_you_mean": [
    { "slug": "how-usage-limits-work", "question": "How do usage limits work — sessions, weekly limits, and resets?" }
  ]
}
```

`?format=discord` returns the entry as a ready-to-send embed object.

### `GET /categories` and `GET /category/{slug}`

Category summaries with counts, and one category with its entry summaries. Use these for browse UIs, autocomplete, and slash-command choice lists.

### `GET /entries` — list summaries

Params: `category`, `subcategory` (slug or name fragment), `limit`, `offset`. Use for building caches or paging through everything.

### `GET /slugs` — all slugs

One array. Ideal for bot-side autocomplete caches and validating stored slugs after a sync. Cheap to call hourly.

### `GET|POST /ask` — generated answer

Sends the question through a small LLM grounded in the top 3 matching FAQ entries.

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_your_key" \
  -H "Content-Type: application/json" \
  -d '{"question": "can I get my money back?"}' \
  https://api.frgmt.xyz/claude-faqs/v1/ask
```

```json
{
  "question": "can I get my money back?",
  "answer": "Anthropic's official refund path is through the support messenger...",
  "sources": [{ "slug": "request-refund-unexpected-charges", "question": "...", "source_urls": ["..."] }]
}
```

Notes that save you grief:

- If the LLM helper is down, you still get an answer — the best raw FAQ match — flagged with `"fallback": true`.
- **Always render `sources`.** The generated text is a convenience; the sourced entries are the authority.
- `?format=discord` returns an `embed` object (instead of `answer`) plus the same `sources`.
- This is the slowest endpoint (an AI call). For interactive Discord commands, defer your reply first.

## Building a Discord bot on this API

The intended flow for a `/faq` command:

1. **Autocomplete**: cache `GET /slugs` (refresh hourly), filter client-side as the user types.
2. **Exact pick** → `GET /{slug}?format=discord`, send the embed directly.
3. **Free-text query** → `GET /search?q=...&format=discord&limit=3`, send the top embed, offer the rest as buttons or a select menu.
4. **Nothing found** → `POST /ask` as a fallback, clearly labeled as generated, with the sources listed.

Embed objects respect Discord's limits (title ≤ 256 chars, description ≤ 4096) so you can pass them straight into your library's embed parameter. The `color` is the project purple (`0x7855fa`); override it if your bot has its own palette.

Be a good citizen: cache slug lookups for at least 60 seconds (responses send `cache-control: public, max-age=60`), and back off when you see `X-RateLimit-Remaining-Minute` approaching zero rather than slamming into the 429.

## Submissions

The structured way for bots and integrations to suggest new FAQ entries — no GitHub required. Maintainers review the queue; accepted suggestions become real entries.

### `POST /submissions` — any valid key

| Field | Type | Rules |
| --- | --- | --- |
| `question` | string | **required**, 10–300 chars |
| `suggested_answer` | string | optional, ≤ 4000 chars |
| `category` | string | optional, must be a category slug from `/categories` |
| `source_urls` | string[] | optional, ≤ 5 http(s) URLs |
| `submitted_by` | string | optional, ≤ 100 chars — Discord username/ID works well |
| `context` | string | optional, ≤ 1000 chars — where this keeps coming up |

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Why does /usage show different numbers than claude.ai settings?",
    "category": "claude-usage",
    "submitted_by": "discorduser#1234",
    "context": "Asked three times this week in #claude-code-help"
  }' \
  https://api.frgmt.xyz/claude-faqs/v1/submissions
```

A `201` response includes the stored submission **and** `similar_existing_entries` — show those to the user, because half the time the question is already answered.

A `422` response gives per-field errors designed to be shown directly to the end user (e.g. in an ephemeral reply):

```json
{
  "error": "Validation failed",
  "errors": [{ "field": "question", "message": "question must be at least 10 characters." }]
}
```

Submissions have their own quota (50/day per key) separate from regular rate limits, so a suggestion feature can't starve your lookup traffic.

### `GET /submissions?status=pending` — premium only

Moderation queue, newest first. Filter by `pending` / `accepted` / `rejected`.

### `POST /submissions/{id}/review` — premium only

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted", "note": "good catch, writing it up"}' \
  https://api.frgmt.xyz/claude-faqs/v1/submissions/1a2b3c4d5e6f7a8b/review
```

## Error reference

All errors are JSON with an `error` field. The shapes:

| Status | Meaning | What to do |
| --- | --- | --- |
| `400` | Missing/invalid input (no `q`, bad JSON body) | Fix the request; the response includes a `usage` or `schema` hint |
| `401` | No key, or key not recognized | Check the header format: `Authorization: Bearer cfaq_...` |
| `403` | Valid key, insufficient tier (submissions list/review) | Needs a premium key |
| `404` | Unknown slug, category, or submission ID | For slugs, use the `did_you_mean` suggestions |
| `405` | Method not allowed | Only GET/POST (and OPTIONS) are supported |
| `422` | Submission failed validation | Show the per-field `errors` array to the user |
| `429` | Rate limit or submission quota exceeded | Read `resets_at` and back off; don't retry instantly |

## Troubleshooting & common pain points

**"Unauthorized" but I'm sure my key is right.**
Nine times out of ten it's the header: it must be exactly `Authorization: Bearer cfaq_...` with the space, or `?apikey=` with nothing else mixed in. If you regenerated a key recently, the old one was revoked. Test with: `curl -H "Authorization: Bearer $KEY" https://api.frgmt.xyz/claude-faqs/v1/` — if that 401s, the key itself is bad; ask a maintainer.

**Search returns nothing for a reasonable question.**
`tags` mode is literal keyword matching. Retry with `mode=semantic`, which handles paraphrased and conversational queries. If semantic also misses, the answer probably doesn't exist yet — that's your cue to `POST /submissions`.

**Search returns *weird* results.**
Short queries with common words ("claude help") match everything weakly. Add the distinctive noun ("claude refund", "claude weekly limit"). Scores help here: a top result scoring barely above the second usually means a vague query.

**`/ask` is slow or my Discord interaction times out.**
`/ask` makes an LLM call and can take a few seconds. Defer your Discord interaction reply (`deferReply()`) before calling it. If latency matters more than phrasing, use `/search` + `/{slug}` instead — those are fast.

**`/ask` answered something subtly wrong.**
It only knows what's in the corpus, and small models compress. This is why the response carries `sources` — display them. If a generated answer is repeatedly bad for a common question, tell a maintainer; the fix is usually a clearer FAQ entry.

**I'm getting 429s even at low traffic.**
Per-minute and per-day windows are tracked separately — check both `X-RateLimit-Remaining-*` headers. Common cause: multiple bot instances or a dev environment sharing one key. Keys are cheap; ask for one per deployment.

**A slug that used to work 404s.**
Slugs are stable by policy, but entries are occasionally consolidated. Handle 404s by showing `did_you_mean`, and refresh your `/slugs` cache on a schedule rather than assuming a slug lives forever.

**Stale facts in an answer (old price, dead link).**
Check `last_verified_at` and the `source_urls`. Then either open a GitHub issue, or better: PR the one YAML file that's wrong (see [CONTRIBUTING.md](../CONTRIBUTING.md)) — pricing fixes are the easiest first contribution there is.

**CORS errors in a browser app.**
The API sends `access-control-allow-origin: *`, so plain fetches work. If you see CORS failures, something between you and the API (often a proxy or an extension) is rewriting headers — or the request is failing earlier (401/429) and your code reads the missing CORS header as the cause.

**Embeds look broken in Discord.**
The API truncates to Discord's per-field limits, but if you add your own fields on top of ours, the *total* embed cap (6000 chars) is on you. When in doubt, send our embed unmodified.

## Versioning

The path is versioned (`/v1`). Additive changes (new fields, new endpoints) happen within v1 — write your parser to ignore unknown fields. Breaking changes would ship as `/v2` with `/v1` kept alive during a migration window.
