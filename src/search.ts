import type { FAQEntry } from "./types";

export interface ScoredEntry {
  entry: FAQEntry;
  score: number;
}

// Tag-based keyword search. Each matching field adds to the score.
export function tagSearch(entries: FAQEntry[], query: string, limit = 5): ScoredEntry[] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return entries
    .map((entry) => {
      let score = 0;

      for (const term of terms) {
        if (entry.slug.includes(term)) score += 5;
        if (entry.question.toLowerCase().includes(term)) score += 3;
        if (entry.category.toLowerCase().includes(term)) score += 1;
        if (entry.subcategory.toLowerCase().includes(term)) score += 1;
        if (entry.category_slug.includes(term)) score += 1;
        if (entry.subcategory_slug.includes(term)) score += 1;

        for (const tag of entry.tags) {
          if (tag === term) score += 3;
          else if (tag.includes(term)) score += 1.5;
        }
      }

      if (entry.question.toLowerCase() === query.toLowerCase()) score += 10;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.question.localeCompare(b.entry.question))
    .slice(0, limit);
}

// Cosine similarity between two vectors.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Semantic search using pre-computed embedding vectors.
export function embeddingSearch(
  queryEmbedding: number[],
  entryEmbeddings: number[][],
  entries: FAQEntry[],
  limit = 5,
): ScoredEntry[] {
  return entries
    .map((entry, index) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entryEmbeddings[index]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
