import { FAQ_DATA } from "./data";
import { embeddingSearch, tagSearch, type ScoredEntry } from "./search";
import {
  SUBMISSION_STATUSES,
  listSubmissions,
  newSubmissionId,
  submissionKey,
  validateSubmission,
} from "./submissions";
import type { ApiKeyData, DiscordEmbed, Env, FAQEntry, FAQSubmission, RateLimitData } from "./types";

const DISCORD_COLOR = 0x7855fa; // Brand purple used in all Discord embeds
// Cache key is tied to the index build so a content deploy can never serve
// embeddings computed for a different entry set.
const EMBEDDING_CACHE_KEY = `faq:embeddings:v2:${FAQ_DATA.generated_at}`;
const API_VERSION = "1.1.0";
// Per-key cap on new submissions so a misbehaving bot can't flood the queue.
const SUBMISSIONS_PER_DAY = 50;
const AI_RUNNER = (ai: Ai) => ai as unknown as {
  run(model: string, input: unknown): Promise<unknown>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    },
  });
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type");
  return new Response(response.body, { status: response.status, headers });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function summarizeEntry(entry: FAQEntry): object {
  return {
    slug: entry.slug,
    question: entry.question,
    category: entry.category,
    category_slug: entry.category_slug,
    subcategory: entry.subcategory,
    subcategory_slug: entry.subcategory_slug,
    tags: entry.tags,
    preview: entry.answer.slice(0, 200),
    answered_by: entry.answered_by,
    last_verified_at: entry.last_verified_at,
    source_urls: entry.source_urls,
  };
}

// Truncates text to Discord's per-field character limits.
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

// Converts a FAQ entry into Discord's embed object format.
function toDiscordEmbed(entry: FAQEntry): DiscordEmbed {
  const description = truncate(entry.answer, 4096);

  const fields: DiscordEmbed["fields"] = [
    { name: "Category", value: entry.category, inline: true },
    { name: "Subcategory", value: entry.subcategory, inline: true },
    { name: "Slug", value: entry.slug, inline: false },
  ];

  if (entry.answered_by) {
    fields.push({ name: "Answered By", value: entry.answered_by, inline: true });
  }

  fields.push({ name: "Last Verified", value: entry.last_verified_at, inline: true });

  if (entry.source_urls.length) {
    fields.push({
      name: "Sources",
      value: entry.source_urls.slice(0, 5).map((url) => `- ${url}`).join("\n"),
      inline: false,
    });
  }

  return {
    title: truncate(entry.question, 256),
    description,
    color: DISCORD_COLOR,
    fields,
    footer: { text: "Claude Community FAQ API" },
  };
}

async function updateWindow(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowMs: number,
  suffix: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const storageKey = `rl:${key}:${suffix}`;
  const current = await kv.get<RateLimitData>(storageKey, "json");

  let next: RateLimitData;
  if (!current || current.resetAt <= now) {
    next = { count: 1, resetAt: now + windowMs };
  } else if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  } else {
    next = { count: current.count + 1, resetAt: current.resetAt };
  }

  const ttlSeconds = Math.max(60, Math.ceil((next.resetAt - now) / 1000) + 60);
  await kv.put(storageKey, JSON.stringify(next), { expirationTtl: ttlSeconds });

  return {
    allowed: true,
    remaining: Math.max(0, limit - next.count),
    resetAt: next.resetAt,
  };
}

// Sliding-window-ish rate limiter using KV. Good enough for admin-key usage.
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limits: { perMinute: number; perDay: number },
): Promise<{
  allowed: boolean;
  minute: { remaining: number; resetAt: number };
  day: { remaining: number; resetAt: number };
}> {
  const minute = await updateWindow(kv, key, limits.perMinute, 60_000, "minute");
  if (!minute.allowed) {
    return { allowed: false, minute, day: { remaining: 0, resetAt: minute.resetAt } };
  }

  const day = await updateWindow(kv, key, limits.perDay, 86_400_000, "day");
  if (!day.allowed) {
    return { allowed: false, minute, day };
  }

  return { allowed: true, minute, day };
}

// Computes or loads FAQ entry embeddings for semantic search.
async function getEmbeddings(env: Env): Promise<number[][] | null> {
  const cached = await env.FAQ_EMBEDDINGS.get<number[][]>(EMBEDDING_CACHE_KEY, "json");
  if (cached && cached.length === FAQ_DATA.entries.length) return cached;

  try {
    const texts = FAQ_DATA.entries.map((entry) =>
      `${entry.tags.join(" ")} ${entry.question} ${entry.answer.slice(0, 300)}`
    );

    const result = await AI_RUNNER(env.AI).run("@cf/baai/bge-base-en-v1.5", {
      text: texts,
    }) as { data: number[][] };

    await env.FAQ_EMBEDDINGS.put(EMBEDDING_CACHE_KEY, JSON.stringify(result.data), {
      expirationTtl: 3600,
    });

    return result.data;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return cors(json({ error: "Method not allowed." }, 405));
    }

    const subPath = path.startsWith("/claude-faqs/v1")
      ? path.slice("/claude-faqs/v1".length)
      : path.startsWith("/v1")
      ? path.slice("/v1".length)
      : path;
    const format = url.searchParams.get("format");

    // Health check is unauthenticated so monitors and bot dashboards can
    // probe availability without burning rate limit.
    if (subPath === "/health") {
      return cors(json({
        status: "ok",
        version: API_VERSION,
        entry_count: FAQ_DATA.entry_count,
        generated_at: FAQ_DATA.generated_at,
      }));
    }

    // API key is required for all requests.
    const authHeader = request.headers.get("authorization");
    const apiKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : url.searchParams.get("apikey");

    if (!apiKey) {
      return cors(json({
        error: "Unauthorized",
        message: "API key required. Pass via Authorization: Bearer <key> header or ?apikey= parameter.",
      }, 401));
    }

    const keyData = await env.FAQ_API_KEYS.get<ApiKeyData>(apiKey, "json");
    if (!keyData) {
      return cors(json({ error: "Unauthorized", message: "Invalid API key." }, 401));
    }
    const authenticatedKey = keyData;

    const rateLimits = authenticatedKey.tier === "premium"
      ? { perMinute: 100, perDay: 10_000 }
      : { perMinute: 30, perDay: 1_000 };

    const rl = await checkRateLimit(env.RATE_LIMITS, apiKey, rateLimits);
    if (!rl.allowed) {
      const response = json({
        error: "Rate limit exceeded",
        limits: rateLimits,
        resets_at: {
          minute: new Date(rl.minute.resetAt).toISOString(),
          day: new Date(rl.day.resetAt).toISOString(),
        },
      }, 429);
      const headers = new Headers(response.headers);
      headers.set("x-ratelimit-remaining-minute", String(rl.minute.remaining));
      headers.set("x-ratelimit-remaining-day", String(rl.day.remaining));
      headers.set("x-authenticated-as", authenticatedKey.name);
      return cors(new Response(response.body, { status: 429, headers }));
    }

    function respond(data: object, status = 200, options?: { noStore?: boolean }): Response {
      const response = json(data, status);
      const headers = new Headers(response.headers);
      if (options?.noStore) {
        headers.set("cache-control", "no-store");
      }
      headers.set("x-ratelimit-remaining-minute", String(rl.minute.remaining));
      headers.set("x-ratelimit-remaining-day", String(rl.day.remaining));
      headers.set("x-ratelimit-reset-minute", new Date(rl.minute.resetAt).toISOString());
      headers.set("x-ratelimit-reset-day", new Date(rl.day.resetAt).toISOString());
      headers.set("x-authenticated-as", authenticatedKey.name);
      return cors(new Response(response.body, { status, headers }));
    }

    // Root: API metadata and route map.
    if (subPath === "" || subPath === "/") {
      return respond({
        name: "Claude FAQ API",
        version: API_VERSION,
        generated_at: FAQ_DATA.generated_at,
        entry_count: FAQ_DATA.entry_count,
        category_count: FAQ_DATA.category_index.length,
        auth: {
          description: "API key required for all requests",
          methods: ["Authorization: Bearer <key>", "?apikey=<key>"],
          tiers: {
            standard: "30/min, 1000/day",
            premium: "100/min, 10000/day",
          },
        },
        routes: {
          "GET /claude-faqs/v1/": "API metadata",
          "GET /claude-faqs/v1/health": "Health check (no auth)",
          "GET /claude-faqs/v1/search?q=...&mode=tags|semantic": "Search FAQs",
          "GET|POST /claude-faqs/v1/ask": "Generate an answer from FAQ context",
          "GET /claude-faqs/v1/categories": "List categories",
          "GET /claude-faqs/v1/category/{slug}": "Category detail",
          "GET /claude-faqs/v1/entries": "List entry summaries",
          "GET /claude-faqs/v1/slugs": "List all slugs",
          "POST /claude-faqs/v1/submissions": "Submit a FAQ suggestion",
          "GET /claude-faqs/v1/submissions?status=pending": "List submissions (premium)",
          "POST /claude-faqs/v1/submissions/{id}/review": "Accept or reject a submission (premium)",
          "GET /claude-faqs/v1/{slug}": "Fetch a full FAQ entry",
        },
      });
    }

    // Community submission queue. POST is open to any valid key so Discord
    // bots can forward suggestions; review/list require a premium key.
    if (subPath === "/submissions" && request.method === "POST") {
      let body: object;
      try {
        body = await request.json() as object;
      } catch {
        return respond({
          error: "Invalid JSON body",
          schema: {
            question: "string, required, 10-300 chars",
            suggested_answer: "string, optional, max 4000 chars",
            category: "string, optional, a category slug from /categories",
            source_urls: "string[], optional, max 5 http(s) URLs",
            submitted_by: "string, optional, max 100 chars (e.g. Discord username)",
            context: "string, optional, max 1000 chars (where this keeps coming up)",
          },
        }, 400, { noStore: true });
      }

      const validCategorySlugs = new Set(FAQ_DATA.category_index.map((category) => category.slug));
      const result = validateSubmission(body, validCategorySlugs);
      if (!result.ok || !result.value) {
        return respond({ error: "Validation failed", errors: result.errors }, 422, { noStore: true });
      }

      const quota = await updateWindow(env.RATE_LIMITS, apiKey, SUBMISSIONS_PER_DAY, 86_400_000, "submit-day");
      if (!quota.allowed) {
        return respond({
          error: "Submission quota exceeded",
          limit_per_day: SUBMISSIONS_PER_DAY,
          resets_at: new Date(quota.resetAt).toISOString(),
        }, 429, { noStore: true });
      }

      // Surface existing entries that already answer the question so bots
      // can show them instead of filing a duplicate.
      const similar = tagSearch(FAQ_DATA.entries, result.value.question, 3).map((item) => ({
        slug: item.entry.slug,
        question: item.entry.question,
      }));

      const submission: FAQSubmission = {
        id: newSubmissionId(),
        status: "pending",
        ...result.value,
        submitted_via: authenticatedKey.name,
        created_at: new Date().toISOString(),
      };

      await env.FAQ_SUBMISSIONS.put(submissionKey(submission.id), JSON.stringify(submission));

      return respond({ submission, similar_existing_entries: similar }, 201, { noStore: true });
    }

    if (subPath === "/submissions" && request.method === "GET") {
      if (authenticatedKey.tier !== "premium") {
        return respond({ error: "Forbidden", message: "Listing submissions requires a premium key." }, 403, { noStore: true });
      }

      const statusParam = url.searchParams.get("status");
      const status = SUBMISSION_STATUSES.includes(statusParam as FAQSubmission["status"])
        ? statusParam as FAQSubmission["status"]
        : undefined;

      const submissions = await listSubmissions(env.FAQ_SUBMISSIONS, status);
      return respond({ count: submissions.length, status: status ?? "all", submissions }, 200, { noStore: true });
    }

    const reviewMatch = subPath.match(/^\/submissions\/([a-f0-9]+)\/review$/);
    if (reviewMatch && request.method === "POST") {
      if (authenticatedKey.tier !== "premium") {
        return respond({ error: "Forbidden", message: "Reviewing submissions requires a premium key." }, 403, { noStore: true });
      }

      let body: { status?: string; note?: string };
      try {
        body = await request.json() as { status?: string; note?: string };
      } catch {
        return respond({ error: "Invalid JSON body", usage: "POST { \"status\": \"accepted\" | \"rejected\", \"note\": \"optional\" }" }, 400, { noStore: true });
      }

      if (body.status !== "accepted" && body.status !== "rejected") {
        return respond({ error: "Validation failed", errors: [{ field: "status", message: "status must be \"accepted\" or \"rejected\"." }] }, 422, { noStore: true });
      }

      const key = submissionKey(reviewMatch[1]);
      const submission = await env.FAQ_SUBMISSIONS.get<FAQSubmission>(key, "json");
      if (!submission) {
        return respond({ error: "Submission not found", id: reviewMatch[1] }, 404, { noStore: true });
      }

      submission.status = body.status;
      submission.reviewed_at = new Date().toISOString();
      submission.reviewed_by = authenticatedKey.name;
      if (typeof body.note === "string" && body.note.trim()) {
        submission.review_note = body.note.trim().slice(0, 1000);
      }

      await env.FAQ_SUBMISSIONS.put(key, JSON.stringify(submission));
      return respond({ submission }, 200, { noStore: true });
    }

    // Search route.
    if (subPath === "/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) {
        return respond({ error: "Missing query", usage: "GET /search?q=your+query" }, 400);
      }

      const mode = url.searchParams.get("mode") === "semantic" ? "semantic" : "tags";
      const limit = clamp(Number(url.searchParams.get("limit") || 5), 1, 10);

      let results: ScoredEntry[];
      if (mode === "semantic") {
        const embeddings = await getEmbeddings(env);
        if (!embeddings) {
          results = tagSearch(FAQ_DATA.entries, query, limit);
        } else {
          const qResult = await AI_RUNNER(env.AI).run("@cf/baai/bge-base-en-v1.5", { text: [query] }) as { data: number[][] };
          results = embeddingSearch(qResult.data[0], embeddings, FAQ_DATA.entries, limit);
        }
      } else {
        results = tagSearch(FAQ_DATA.entries, query, limit);
      }

      if (format === "discord") {
        return respond({ query, mode, count: results.length, results: results.map((item) => toDiscordEmbed(item.entry)) });
      }

      return respond({
        query,
        mode,
        count: results.length,
        results: results.map((item) => ({
          ...summarizeEntry(item.entry),
          score: Math.round(item.score * 1000) / 1000,
        })),
      });
    }

    // Ask route: natural-language answer grounded in the FAQ corpus.
    if (subPath === "/ask") {
      let question = url.searchParams.get("q")?.trim() || null;
      if (!question && request.method === "POST") {
        try {
          const body = await request.json() as { question?: string };
          question = body.question?.trim() || null;
        } catch {
          return respond({ error: "Invalid JSON body" }, 400);
        }
      }

      if (!question) {
        return respond({ error: "Missing question", usage: "POST { \"question\": \"...\" } or GET /ask?q=..." }, 400);
      }

      let scored: ScoredEntry[];
      const embeddings = await getEmbeddings(env);
      if (embeddings) {
        const qResult = await AI_RUNNER(env.AI).run("@cf/baai/bge-base-en-v1.5", { text: [question] }) as { data: number[][] };
        scored = embeddingSearch(qResult.data[0], embeddings, FAQ_DATA.entries, 3);
      } else {
        scored = tagSearch(FAQ_DATA.entries, question, 3);
      }
      const context = scored.map((item) => item.entry);

      if (!context.length) {
        return respond({
          question,
          answer: "I couldn't find a relevant FAQ entry for that question yet.",
          sources: [],
        }, 404);
      }

      const faqContext = context
        .map((entry, index) => `[FAQ ${index + 1}] ${entry.question}\n${entry.answer}`)
        .join("\n\n---\n\n");

      const sources = context.map((entry) => ({
        slug: entry.slug,
        question: entry.question,
        source_urls: entry.source_urls,
      }));

      // Builds the /ask response in either plain JSON or Discord embed form.
      function askResponse(answer: string, fallback: boolean): Response {
        if (format === "discord") {
          const embed: DiscordEmbed = {
            title: truncate(question as string, 256),
            description: truncate(answer, 4096),
            color: DISCORD_COLOR,
            fields: [{
              name: "Related FAQ entries",
              value: truncate(sources.map((source) => `- \`${source.slug}\` ${source.question}`).join("\n"), 1024),
              inline: false,
            }],
            footer: { text: "Claude Community FAQ API — generated answer, see sources" },
          };
          return respond(fallback ? { question, fallback, embed, sources } : { question, embed, sources });
        }

        return respond(fallback ? { question, answer, fallback, sources } : { question, answer, sources });
      }

      try {
        const aiResult = await AI_RUNNER(env.AI).run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            {
              role: "system",
              content: "Answer the user's question using only the FAQ context provided. If the context is incomplete, say so plainly and avoid inventing details.",
            },
            {
              role: "user",
              content: `Question: ${question}\n\nFAQ Context:\n${faqContext}`,
            },
          ],
          max_tokens: 700,
        }) as { response?: string };

        return askResponse(aiResult.response || context[0].answer, false);
      } catch {
        return askResponse(context[0].answer, true);
      }
    }

    // Category list.
    if (subPath === "/categories") {
      return respond({ count: FAQ_DATA.category_index.length, categories: FAQ_DATA.category_index });
    }

    // Category detail.
    if (subPath.startsWith("/category/")) {
      const categorySlug = subPath.replace("/category/", "");
      const category = FAQ_DATA.category_index.find((item) => item.slug === categorySlug);
      if (!category) {
        return respond({ error: "Category not found", slug: categorySlug }, 404);
      }

      const entries = FAQ_DATA.entries
        .filter((entry) => entry.category_slug === categorySlug)
        .map(summarizeEntry);

      return respond({ ...category, entries });
    }

    // Entry summaries.
    if (subPath === "/entries") {
      let entries = FAQ_DATA.entries;
      const category = url.searchParams.get("category")?.toLowerCase();
      const subcategory = url.searchParams.get("subcategory")?.toLowerCase();
      const rawLimit = Number(url.searchParams.get("limit") || entries.length);
      const limit = clamp(Number.isFinite(rawLimit) ? rawLimit : entries.length, 1, FAQ_DATA.entries.length);
      const rawOffset = Number(url.searchParams.get("offset") || 0);
      const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

      if (category) {
        entries = entries.filter((entry) =>
          entry.category_slug === category ||
          entry.category.toLowerCase().includes(category) ||
          entry.category_slug.includes(category)
        );
      }

      if (subcategory) {
        entries = entries.filter((entry) =>
          entry.subcategory_slug === subcategory ||
          entry.subcategory.toLowerCase().includes(subcategory) ||
          entry.subcategory_slug.includes(subcategory)
        );
      }

      const paged = entries.slice(offset, offset + limit);
      return respond({ count: entries.length, offset, limit, entries: paged.map(summarizeEntry) });
    }

    // Slug list.
    if (subPath === "/slugs") {
      return respond({ count: FAQ_DATA.entry_count, slugs: Object.keys(FAQ_DATA.slugs) });
    }

    // Catch-all slug lookup.
    const slug = subPath.replace(/^\//, "");
    if (!slug || slug.includes("/")) {
      return respond({ error: "Not Found", message: `Unknown endpoint: ${path}` }, 404);
    }

    const entryIndex = FAQ_DATA.slugs[slug];
    if (entryIndex === undefined) {
      const suggestions = tagSearch(FAQ_DATA.entries, slug.replace(/-/g, " "), 3).map((item) => ({
        slug: item.entry.slug,
        question: item.entry.question,
      }));

      return respond({ error: "FAQ entry not found", slug, did_you_mean: suggestions }, 404);
    }

    const entry = FAQ_DATA.entries[entryIndex];
    if (format === "discord") {
      return respond(toDiscordEmbed(entry));
    }

    return respond(entry);
  },
};
