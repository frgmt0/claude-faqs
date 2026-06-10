// Builds faq-index.json from the one-entry-per-file YAML layout:
//   faq-content/<category>/_category.yaml  -> category display name
//   faq-content/<category>/<slug>.yaml     -> one FAQ entry; filename is the slug
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { extractTags, extractUrls, slugify, type CategoryDoc, type FAQEntryDoc } from "../src/content";
import type { FAQCategorySummary, FAQData, FAQEntry } from "../src/types";

const FAQ_DIR = join(process.cwd(), "faq-content");
const OUTPUT_FILE = join(process.cwd(), "faq-index.json");
const HQ_TIMEZONE = "America/Los_Angeles";

function getPacificDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HQ_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function titleCase(slug: string): string {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function buildCategoryIndex(entries: FAQEntry[]): FAQCategorySummary[] {
  const categories = new Map<string, FAQCategorySummary>();

  for (const entry of entries) {
    let category = categories.get(entry.category_slug);
    if (!category) {
      category = {
        name: entry.category,
        slug: entry.category_slug,
        count: 0,
        subcategories: [],
      };
      categories.set(entry.category_slug, category);
    }

    category.count += 1;

    let subcategory = category.subcategories.find((item) => item.slug === entry.subcategory_slug);
    if (!subcategory) {
      subcategory = {
        name: entry.subcategory,
        slug: entry.subcategory_slug,
        count: 0,
      };
      category.subcategories.push(subcategory);
    }

    subcategory.count += 1;
  }

  return [...categories.values()]
    .map((category) => ({
      ...category,
      subcategories: category.subcategories.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const categoryDirs = readdirSync(FAQ_DIR)
  .filter((name) => statSync(join(FAQ_DIR, name)).isDirectory())
  .sort((a, b) => a.localeCompare(b));

const entries: FAQEntry[] = [];
const seenSlugs = new Map<string, string>();

for (const dir of categoryDirs) {
  const dirPath = join(FAQ_DIR, dir);
  const categorySlug = dir;

  let categoryName = titleCase(dir);
  const categoryMetaPath = join(dirPath, "_category.yaml");
  try {
    const meta = parse(readFileSync(categoryMetaPath, "utf8")) as CategoryDoc;
    if (meta?.name) categoryName = meta.name;
  } catch {
    // No _category.yaml: fall back to the title-cased directory name.
  }

  const entryFiles = readdirSync(dirPath)
    .filter((file) => file.endsWith(".yaml") && !file.startsWith("_"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of entryFiles) {
    const filePath = join(dirPath, file);
    const slug = file.replace(/\.yaml$/, "");
    const doc = parse(readFileSync(filePath, "utf8")) as FAQEntryDoc;

    if (!doc?.question || !doc?.answer) {
      throw new Error(`${dir}/${file}: question and answer are required.`);
    }

    const existing = seenSlugs.get(slug);
    if (existing) {
      throw new Error(`Duplicate slug "${slug}" in ${dir}/${file} and ${existing}.`);
    }
    seenSlugs.set(slug, `${dir}/${file}`);

    const answer = doc.answer.trim();
    const subcategory = doc.subcategory?.trim() || "General";
    const sourceUrls = new Set<string>(doc.sources ?? []);
    for (const url of extractUrls(answer)) {
      sourceUrls.add(url);
    }

    entries.push({
      slug,
      question: doc.question.trim(),
      answer,
      tags: doc.tags?.length ? doc.tags : extractTags(doc.question, subcategory, answer),
      category: categoryName,
      category_slug: categorySlug,
      subcategory,
      subcategory_slug: slugify(subcategory),
      source_file: `${dir}/${file}`,
      source_urls: [...sourceUrls],
      last_verified_at: doc.last_verified || getPacificDate(),
      answered_by: doc.answered_by,
    });
  }
}

const categoryIndex = buildCategoryIndex(entries);
const data: FAQData = {
  version: "2.0.0",
  generated_at: new Date().toISOString(),
  generated_timezone: HQ_TIMEZONE,
  entry_count: entries.length,
  categories: categoryIndex.map((category) => category.name),
  category_index: categoryIndex,
  category_slugs: Object.fromEntries(categoryIndex.map((category) => [category.slug, category.name])),
  entries,
  slugs: Object.fromEntries(entries.map((entry, index) => [entry.slug, index])),
};

writeFileSync(OUTPUT_FILE, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Built faq-index.json with ${entries.length} entries across ${categoryIndex.length} categories.`);
