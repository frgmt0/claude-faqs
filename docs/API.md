# Claude FAQ API

Base URL: `https://api.frgmt.xyz/claude-faqs/v1`

This API serves the FAQ corpus (one YAML file per entry in `faq-content/`) as structured JSON for bots and internal tools. Current API version: `1.1.0`.

## Authentication

All requests require an API key.

Supported methods:

- `Authorization: Bearer <key>`
- `?apikey=<key>`

Example:

```bash
curl -H "Authorization: Bearer cfaq_your_key_here" \
  https://api.frgmt.xyz/claude-faqs/v1/categories
```

## Rate-limit headers

Every successful response includes:

- `X-RateLimit-Remaining-Minute`
- `X-RateLimit-Remaining-Day`
- `X-RateLimit-Reset-Minute`
- `X-RateLimit-Reset-Day`
- `X-Authenticated-As`

Standard keys are limited to `30/min` and `1000/day`.
Premium keys are limited to `100/min` and `10000/day`.

## Response model

Full FAQ entries look like this:

```json
{
  "slug": "account-banned",
  "question": "My account was banned. What can I do?",
  "answer": "Anthropic does not publish a public, step-by-step appeal playbook...",
  "tags": ["account", "banned", "support"],
  "category": "Account Issues FAQ",
  "category_slug": "account-issues-faq",
  "subcategory": "Bans and Suspensions",
  "subcategory_slug": "bans-and-suspensions",
  "source_file": "account-issues-faqs.md",
  "source_urls": [
    "https://support.claude.com/en/articles/9015913-how-to-get-support"
  ],
  "last_verified_at": "2026-03-10",
  "answered_by": "Jason"
}
```

Field notes:

- `slug`: stable lookup key for bots
- `answer`: markdown-friendly text; clients can render or strip formatting
- `tags`: lightweight keyword hints used for fast search
- `source_urls`: official references worth showing in your UI when possible
- `last_verified_at`: useful for deciding whether to trust pricing or support details without another check
- `answered_by`: optional contributor credit

## Endpoints

### `GET /`

Returns API metadata and the route map.

### `GET /health`

Unauthenticated health check for monitors and bot dashboards. Returns status, API version, entry count, and the index build timestamp. Does not count against rate limits.

### `GET /categories`

Returns category summaries.

Example response:

```json
{
  "count": 3,
  "categories": [
    {
      "name": "Billing and Plans FAQ",
      "slug": "billing-and-plans-faq",
      "count": 10,
      "subcategories": [
        {
          "name": "Charges, Refunds, and Support",
          "slug": "charges-refunds-and-support",
          "count": 5
        }
      ]
    }
  ]
}
```

### `GET /category/{slug}`

Returns one category plus entry summaries inside it.

Use this if your bot has a category browser or autocomplete flow.

### `GET /entries`

Returns entry summaries, not full answers.

Query params:

- `category`: category name fragment or exact slug
- `subcategory`: subcategory name fragment or exact slug
- `limit`: max entries to return
- `offset`: pagination offset

Example:

```bash
curl -H "Authorization: Bearer cfaq_your_key_here" \
  "https://api.frgmt.xyz/claude-faqs/v1/entries?category=billing&limit=5"
```

Summary entries include:

- `slug`
- `question`
- `category`
- `subcategory`
- `tags`
- `preview`
- `answered_by`
- `last_verified_at`
- `source_urls`

### `GET /slugs`

Returns every slug.

Useful for:

- bot autocomplete caches
- validation
- offline sync jobs

### `GET /search?q=...`

Fast keyword search over slugs, tags, questions, and categories.

Query params:

- `q`: required search query
- `mode=tags|semantic`: default is `tags`
- `limit`: default `5`, max `10`
- `format=discord`: return Discord embed objects instead of JSON entry summaries

Example:

```bash
curl -H "Authorization: Bearer cfaq_your_key_here" \
  "https://api.frgmt.xyz/claude-faqs/v1/search?q=billing+refund&mode=semantic"
```

Default response shape:

```json
{
  "query": "billing refund",
  "mode": "semantic",
  "count": 2,
  "results": [
    {
      "slug": "request-refund-unexpected-charges",
      "question": "How do I request a refund for unexpected charges?",
      "category": "Billing and Plans FAQ",
      "category_slug": "billing-and-plans-faq",
      "subcategory": "Charges, Refunds, and Support",
      "subcategory_slug": "charges-refunds-and-support",
      "tags": ["refund", "charges", "support"],
      "preview": "Anthropic's official process is through the in-product support messenger...",
      "answered_by": null,
      "last_verified_at": "2026-03-10",
      "source_urls": [
        "https://support.claude.com/en/articles/12386328-requesting-a-refund-for-a-paid-claude-plan"
      ],
      "score": 0.872
    }
  ]
}
```

Each result includes a `score` (relevance for `tags` mode, cosine similarity for `semantic` mode). Scores are comparable within one response, not across modes.

### `GET /{slug}`

Fetches the full FAQ entry.

Example:

```bash
curl -H "Authorization: Bearer cfaq_your_key_here" \
  https://api.frgmt.xyz/claude-faqs/v1/account-banned
```

If the slug does not exist, the API returns a 404 with `did_you_mean` suggestions.

### `GET /{slug}?format=discord`

Returns a Discord embed object.

Example response:

```json
{
  "title": "My account was banned. What can I do?",
  "description": "Anthropic does not publish a public, step-by-step appeal playbook...",
  "color": 7886330,
  "fields": [
    { "name": "Category", "value": "Account Issues FAQ", "inline": true },
    { "name": "Subcategory", "value": "Bans and Suspensions", "inline": true },
    { "name": "Slug", "value": "account-banned", "inline": false },
    { "name": "Last Verified", "value": "2026-03-10", "inline": true }
  ],
  "footer": { "text": "Claude Community FAQ API" }
}
```

That object is designed so bot authors can either:

- send it directly as an embed shape
- map it into their own UI format
- ignore it and use the normal full entry response

### `GET|POST /ask`

Generates a natural-language answer using the FAQ corpus as context.

This endpoint is useful when the user asks a question that does not map neatly to one known slug.

Input options:

```bash
curl -H "Authorization: Bearer cfaq_your_key_here" \
  "https://api.frgmt.xyz/claude-faqs/v1/ask?q=how+do+I+request+a+refund"
```

or

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"question":"how do I request a refund"}' \
  https://api.frgmt.xyz/claude-faqs/v1/ask
```

Response shape:

```json
{
  "question": "how do I request a refund",
  "answer": "Anthropic's official refund path is through the support messenger...",
  "sources": [
    {
      "slug": "request-refund-unexpected-charges",
      "question": "How do I request a refund for unexpected charges?",
      "source_urls": [
        "https://support.claude.com/en/articles/12386328-requesting-a-refund-for-a-paid-claude-plan"
      ]
    }
  ]
}
```

If the LLM helper is unavailable, the API falls back to the best FAQ match and sets `fallback: true`.

`?format=discord` is also supported on `/ask`: the response carries an `embed` object (instead of `answer`) plus the same `sources` array, ready to send as a Discord embed.

## Submissions

A structured queue so bots and integrations can suggest new FAQ entries without GitHub. Submissions are reviewed by maintainers; accepted ones become `faq-content/<category>/<slug>.yaml` entries.

### `POST /submissions`

Open to any valid API key. Body schema:

| Field | Type | Rules |
| --- | --- | --- |
| `question` | string | **required**, 10–300 chars |
| `suggested_answer` | string | optional, max 4000 chars |
| `category` | string | optional, must be a category slug from `/categories` |
| `source_urls` | string[] | optional, max 5 http(s) URLs |
| `submitted_by` | string | optional, max 100 chars (e.g. Discord username or user ID) |
| `context` | string | optional, max 1000 chars — where the question keeps coming up |

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Why does /usage show different numbers than claude.ai settings?",
    "category": "claude-usage",
    "submitted_by": "discorduser#1234",
    "context": "Asked three times this week in #claude-code-help"
  }' \
  https://api.frgmt.xyz/claude-faqs/v1/submissions
```

Responses:

- `201` — `{ "submission": { "id": "...", "status": "pending", ... }, "similar_existing_entries": [...] }`. Show `similar_existing_entries` to the user — the question may already be answered.
- `422` — `{ "error": "Validation failed", "errors": [{ "field": "question", "message": "..." }] }`. Per-field errors are written so bots can surface them directly (e.g. in an ephemeral Discord reply).
- `429` — per-key submission quota exceeded (50/day, separate from regular rate limits).

### `GET /submissions?status=pending` (premium)

Lists submissions, newest first. `status` filters by `pending`, `accepted`, or `rejected`; omit for all.

### `POST /submissions/{id}/review` (premium)

```bash
curl -X POST \
  -H "Authorization: Bearer cfaq_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted", "note": "good catch, writing it up"}' \
  https://api.frgmt.xyz/claude-faqs/v1/submissions/1a2b3c4d5e6f7a8b/review
```

Sets `status` to `accepted` or `rejected` and records the reviewer and timestamp.

## Error responses

### `401 Unauthorized`

```json
{
  "error": "Unauthorized",
  "message": "API key required. Pass via Authorization: Bearer <key> header or ?apikey= parameter."
}
```

### `404 FAQ entry not found`

```json
{
  "error": "FAQ entry not found",
  "slug": "wrong-slug",
  "did_you_mean": [
    {
      "slug": "account-banned",
      "question": "My account was banned. What can I do?"
    }
  ]
}
```

### `429 Rate limit exceeded`

```json
{
  "error": "Rate limit exceeded",
  "limits": {
    "perMinute": 30,
    "perDay": 1000
  },
  "resets_at": {
    "minute": "2026-03-10T20:00:00.000Z",
    "day": "2026-03-11T19:15:00.000Z"
  }
}
```

## Client guidance

If you are building your own formatting layer:

- use `/search` for discovery and `/slug` lookup for the final answer
- treat `answer` as markdown-capable plain text
- show `source_urls` for pricing, billing, and support questions whenever possible
- use `last_verified_at` as a freshness hint, not as a legal guarantee
- prefer your own embed or card layout if you need stronger visual consistency than `format=discord`
