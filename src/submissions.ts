import type { FAQSubmission } from "./types";

// Validation limits for community submissions. Kept deliberately tight so
// bot integrations get predictable rejections instead of silently stored junk.
const LIMITS = {
  question: { min: 10, max: 300 },
  suggestedAnswer: { max: 4000 },
  submittedBy: { max: 100 },
  context: { max: 1000 },
  sourceUrls: { max: 5, urlLength: 500 },
} as const;

export const SUBMISSION_STATUSES = ["pending", "accepted", "rejected"] as const;

export interface SubmissionInput {
  question?: unknown;
  suggested_answer?: unknown;
  category?: unknown;
  source_urls?: unknown;
  submitted_by?: unknown;
  context?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
  value?: {
    question: string;
    suggested_answer?: string;
    category_slug?: string;
    source_urls: string[];
    submitted_by?: string;
    context?: string;
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Validates a raw submission body against the submission schema.
// Returns either a normalized value or a per-field error list the
// client can surface directly (e.g. in a Discord ephemeral reply).
export function validateSubmission(
  body: SubmissionInput,
  validCategorySlugs: Set<string>,
): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    errors.push({ field: "question", message: "question is required and must be a string." });
  } else if (question.length < LIMITS.question.min) {
    errors.push({ field: "question", message: `question must be at least ${LIMITS.question.min} characters.` });
  } else if (question.length > LIMITS.question.max) {
    errors.push({ field: "question", message: `question must be at most ${LIMITS.question.max} characters.` });
  }

  let suggestedAnswer: string | undefined;
  if (body.suggested_answer !== undefined && body.suggested_answer !== null) {
    if (typeof body.suggested_answer !== "string") {
      errors.push({ field: "suggested_answer", message: "suggested_answer must be a string." });
    } else if (body.suggested_answer.length > LIMITS.suggestedAnswer.max) {
      errors.push({ field: "suggested_answer", message: `suggested_answer must be at most ${LIMITS.suggestedAnswer.max} characters.` });
    } else {
      suggestedAnswer = body.suggested_answer.trim() || undefined;
    }
  }

  let categorySlug: string | undefined;
  if (body.category !== undefined && body.category !== null && body.category !== "") {
    if (typeof body.category !== "string") {
      errors.push({ field: "category", message: "category must be a string category slug." });
    } else {
      const normalized = body.category.trim().toLowerCase();
      if (!validCategorySlugs.has(normalized)) {
        errors.push({
          field: "category",
          message: `Unknown category "${normalized}". Valid slugs: ${[...validCategorySlugs].join(", ")}`,
        });
      } else {
        categorySlug = normalized;
      }
    }
  }

  const sourceUrls: string[] = [];
  if (body.source_urls !== undefined && body.source_urls !== null) {
    if (!Array.isArray(body.source_urls)) {
      errors.push({ field: "source_urls", message: "source_urls must be an array of URLs." });
    } else if (body.source_urls.length > LIMITS.sourceUrls.max) {
      errors.push({ field: "source_urls", message: `source_urls accepts at most ${LIMITS.sourceUrls.max} URLs.` });
    } else {
      for (const item of body.source_urls) {
        if (typeof item !== "string" || item.length > LIMITS.sourceUrls.urlLength || !isHttpUrl(item)) {
          errors.push({ field: "source_urls", message: `Invalid URL: ${String(item).slice(0, 100)}` });
        } else {
          sourceUrls.push(item);
        }
      }
    }
  }

  let submittedBy: string | undefined;
  if (body.submitted_by !== undefined && body.submitted_by !== null) {
    if (typeof body.submitted_by !== "string" || body.submitted_by.length > LIMITS.submittedBy.max) {
      errors.push({ field: "submitted_by", message: `submitted_by must be a string of at most ${LIMITS.submittedBy.max} characters.` });
    } else {
      submittedBy = body.submitted_by.trim() || undefined;
    }
  }

  let context: string | undefined;
  if (body.context !== undefined && body.context !== null) {
    if (typeof body.context !== "string" || body.context.length > LIMITS.context.max) {
      errors.push({ field: "context", message: `context must be a string of at most ${LIMITS.context.max} characters.` });
    } else {
      context = body.context.trim() || undefined;
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    value: {
      question,
      suggested_answer: suggestedAnswer,
      category_slug: categorySlug,
      source_urls: sourceUrls,
      submitted_by: submittedBy,
      context,
    },
  };
}

const SUBMISSION_KEY_PREFIX = "sub:";

export function submissionKey(id: string): string {
  return `${SUBMISSION_KEY_PREFIX}${id}`;
}

export function newSubmissionId(): string {
  // 8 random bytes is plenty for a moderation queue and keeps IDs short
  // enough to paste into Discord commands.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listSubmissions(
  kv: KVNamespace,
  status?: FAQSubmission["status"],
): Promise<FAQSubmission[]> {
  const list = await kv.list({ prefix: SUBMISSION_KEY_PREFIX, limit: 1000 });
  const results: FAQSubmission[] = [];

  for (const key of list.keys) {
    const submission = await kv.get<FAQSubmission>(key.name, "json");
    if (submission && (!status || submission.status === status)) {
      results.push(submission);
    }
  }

  return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
