// Validates the YAML FAQ content tree. Run in CI before build/deploy.
//
// Layout contract:
//   faq-content/<category>/_category.yaml  -> { name, description? }
//   faq-content/<category>/<slug>.yaml     -> one FAQ entry; filename is the slug
//
// Errors fail CI. Warnings print but pass.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ENTRY_DOC_KEYS, type CategoryDoc, type FAQEntryDoc } from "../src/content";

const FAQ_DIR = join(process.cwd(), "faq-content");
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER_PATTERN = /\[temp answer\]|TODO|FIXME|<\/>/i;

// Categories whose answers go stale fast; entries there must cite a source.
const SOURCE_REQUIRED_CATEGORIES = new Set([
  "billing",
  "models-safety-updates",
  "support-access",
]);

const errors: string[] = [];
const warnings: string[] = [];

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const categoryDirs = readdirSync(FAQ_DIR)
  .filter((name) => statSync(join(FAQ_DIR, name)).isDirectory())
  .sort((a, b) => a.localeCompare(b));

if (!categoryDirs.length) {
  errors.push("faq-content/ contains no category directories.");
}

const seenSlugs = new Map<string, string>();
const seenQuestions = new Map<string, string>();
let entryCount = 0;

for (const dir of categoryDirs) {
  const dirPath = join(FAQ_DIR, dir);
  const label = `faq-content/${dir}`;

  if (!SLUG_PATTERN.test(dir)) {
    errors.push(`${label}: category directory name must be kebab-case.`);
  }

  const categoryMetaPath = join(dirPath, "_category.yaml");
  if (!existsSync(categoryMetaPath)) {
    errors.push(`${label}: missing _category.yaml with the category display name.`);
  } else {
    try {
      const meta = parse(readFileSync(categoryMetaPath, "utf8")) as CategoryDoc;
      if (!meta?.name || typeof meta.name !== "string") {
        errors.push(`${label}/_category.yaml: "name" is required and must be a string.`);
      }
    } catch (error) {
      errors.push(`${label}/_category.yaml: invalid YAML (${String(error).split("\n")[0]}).`);
    }
  }

  const entryFiles = readdirSync(dirPath).filter((file) => file.endsWith(".yaml") && !file.startsWith("_"));
  const strayFiles = readdirSync(dirPath).filter((file) => !file.endsWith(".yaml") && file !== ".DS_Store");
  for (const stray of strayFiles) {
    warnings.push(`${label}/${stray}: unexpected non-YAML file.`);
  }

  for (const file of entryFiles) {
    const fileLabel = `${label}/${file}`;
    const slug = file.replace(/\.yaml$/, "");
    entryCount += 1;

    if (!SLUG_PATTERN.test(slug)) {
      errors.push(`${fileLabel}: filename must be a kebab-case slug (it becomes the API slug).`);
    }

    const existingSlug = seenSlugs.get(slug);
    if (existingSlug) {
      errors.push(`${fileLabel}: duplicate slug "${slug}" (also in ${existingSlug}). Slugs must be unique across all categories.`);
    } else {
      seenSlugs.set(slug, fileLabel);
    }

    let doc: FAQEntryDoc;
    try {
      doc = parse(readFileSync(join(dirPath, file), "utf8")) as FAQEntryDoc;
    } catch (error) {
      errors.push(`${fileLabel}: invalid YAML (${String(error).split("\n")[0]}).`);
      continue;
    }

    if (!doc || typeof doc !== "object") {
      errors.push(`${fileLabel}: file must contain a YAML mapping.`);
      continue;
    }

    for (const key of Object.keys(doc)) {
      if (!ENTRY_DOC_KEYS.has(key)) {
        warnings.push(`${fileLabel}: unknown key "${key}" will be ignored.`);
      }
    }

    if (!doc.question || typeof doc.question !== "string") {
      errors.push(`${fileLabel}: "question" is required and must be a string.`);
    } else {
      if (doc.question.trim().length < 10) {
        errors.push(`${fileLabel}: question is too short (min 10 characters).`);
      }
      if (doc.question.trim().length > 300) {
        errors.push(`${fileLabel}: question is too long (max 300 characters).`);
      }

      const questionKey = doc.question.trim().toLowerCase();
      const existingQuestion = seenQuestions.get(questionKey);
      if (existingQuestion) {
        warnings.push(`${fileLabel}: duplicate question title (also in ${existingQuestion}).`);
      } else {
        seenQuestions.set(questionKey, fileLabel);
      }
    }

    if (!doc.answer || typeof doc.answer !== "string" || !doc.answer.trim()) {
      errors.push(`${fileLabel}: "answer" is required and must be non-empty.`);
    } else if (PLACEHOLDER_PATTERN.test(doc.answer)) {
      errors.push(`${fileLabel}: answer contains placeholder text ([temp answer], TODO, etc.).`);
    }

    if (doc.subcategory !== undefined && typeof doc.subcategory !== "string") {
      errors.push(`${fileLabel}: "subcategory" must be a string.`);
    }

    if (doc.tags !== undefined) {
      if (!Array.isArray(doc.tags) || doc.tags.some((tag) => typeof tag !== "string")) {
        errors.push(`${fileLabel}: "tags" must be an array of strings.`);
      }
    }

    if (doc.sources !== undefined) {
      if (!Array.isArray(doc.sources)) {
        errors.push(`${fileLabel}: "sources" must be an array of URLs.`);
      } else {
        for (const source of doc.sources) {
          if (typeof source !== "string" || !isHttpUrl(source)) {
            errors.push(`${fileLabel}: invalid source URL: ${String(source)}`);
          } else if (source.includes("docs.anthropic.com")) {
            warnings.push(`${fileLabel}: docs.anthropic.com URLs redirect now; use code.claude.com/docs or platform.claude.com/docs.`);
          }
        }
      }
    }

    if (SOURCE_REQUIRED_CATEGORIES.has(dir) && !(Array.isArray(doc.sources) && doc.sources.length)) {
      warnings.push(`${fileLabel}: entries in "${dir}" should cite at least one official source.`);
    }

    if (doc.last_verified !== undefined && (typeof doc.last_verified !== "string" || !DATE_PATTERN.test(doc.last_verified))) {
      errors.push(`${fileLabel}: "last_verified" must be a YYYY-MM-DD date string.`);
    }

    if (doc.answered_by !== undefined && typeof doc.answered_by !== "string") {
      errors.push(`${fileLabel}: "answered_by" must be a string.`);
    }
  }
}

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (errors.length) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  console.error(`\n${errors.length} error(s) across ${entryCount} entries.`);
  process.exit(1);
}

console.log(`Checked ${entryCount} entries in ${categoryDirs.length} categories. ${warnings.length} warning(s), no errors.`);
