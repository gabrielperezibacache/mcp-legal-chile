/** Shared helpers for matching user-supplied text against catalog aliases. */

/** Lowercase + strip diacritics so accented/unaccented variants match. */
export function foldForMatch(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
}

/** Whole-word containment: avoids short abbreviations like "cc", "ct", or "dt"
 * matching mid-word inside unrelated terms (e.g. "protección" contains "cc",
 * "ciudad" contains "dt"-adjacent letters). Never use a raw substring test
 * for alias matching. */
export function containsWholeAlias(haystack: string, alias: string): boolean {
  if (!alias) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`,
    "u",
  ).test(` ${haystack} `);
}
