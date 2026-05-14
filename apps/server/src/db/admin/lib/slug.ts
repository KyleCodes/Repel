// Shared slug sanitizer. Used by both:
//   - `sanitizeBranchToDbName` to produce per-branch DB names
//   - `resolveMigrationName` to produce migration filename fragments
//
// Rules: lowercase, collapse runs of non-[a-z0-9_-] into a single underscore,
// trim leading/trailing separators (`_` and `-`). Returns the sanitized string
// or null if nothing usable remains. `-` and `_` are preserved internally by
// design — DB names go through quoted identifiers (`ident()`), so hyphens are
// valid there too.
export function sanitizeSlug(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return cleaned.length > 0 ? cleaned : null;
}
