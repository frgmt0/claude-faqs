// Shared helpers for the content build pipeline (scripts/), not used by the
// Worker at runtime.

// Common filler words filtered out during tag extraction.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do",
  "does", "for", "from", "how", "i", "if", "in", "into", "is", "it",
  "my", "of", "on", "or", "our", "should", "so", "that", "the", "their",
  "this", "to", "use", "what", "when", "where", "why", "with", "you", "your",
]);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Extracts keyword tags from the question, subcategory, and answer text.
export function extractTags(question: string, subcategory: string, answer: string): string[] {
  const source = `${question} ${subcategory} ${answer.slice(0, 600)}`.toLowerCase();
  const words = source
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([word]) => word);
}

// Pulls bare and markdown-link URLs out of answer text.
export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const bareUrlPattern = /https?:\/\/[^\s)]+/g;
  const markdownLinkPattern = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g;

  for (const match of text.matchAll(bareUrlPattern)) {
    urls.add(match[0].replace(/[.,;:]$/, ""));
  }

  for (const match of text.matchAll(markdownLinkPattern)) {
    if (match[1]) urls.add(match[1]);
  }

  return [...urls];
}

// The YAML document schema for one FAQ entry file:
// faq-content/<category>/<slug>.yaml
export interface FAQEntryDoc {
  question: string;
  answer: string;          // markdown
  subcategory?: string;    // defaults to "General"
  tags?: string[];         // auto-generated from text when omitted
  sources?: string[];      // official URLs backing the answer
  last_verified?: string;  // YYYY-MM-DD
  answered_by?: string;    // contributor credit
}

// faq-content/<category>/_category.yaml
export interface CategoryDoc {
  name: string;
  description?: string;
}

export const ENTRY_DOC_KEYS = new Set([
  "question", "answer", "subcategory", "tags", "sources", "last_verified", "answered_by",
]);
