/**
 * Query sanitizers for the SQL `MetadataStore.search()` adapters.
 *
 * FTS5 (SQLite MATCH) and SQL LIKE (Postgres `ILIKE`) both treat
 * user input as syntax. Without sanitization, a query like
 *
 *   `name:foo`        → FTS5 column-filter (literal `name` column only)
 *   `foo AND bar`     → FTS5 boolean AND
 *   `(foo OR bar)`    → FTS5 grouping
 *   `*foo*`           → FTS5 wildcard
 *   `100%`            → LIKE wildcard
 *   `under_score`     → LIKE single-char wildcard
 *
 * Either crashes the query (FTS5 syntax error) or returns wrong
 * rows (LIKE wildcard bypass). Each sanitizer is one-way: we wrap
 * user input in the syntax that makes it literal, never the other
 * way around.
 *
 * The FTS5 strategy is phrase-wrapping: put the query inside a
 * double-quoted phrase so every special character (including
 * reserved keywords) is treated as part of the literal string.
 * Embedded `"` are doubled per FTS5 phrase-escape rules.
 *
 * The LIKE strategy is character-escaping: backslash-escape `%`,
 * `_`, and `\` so they match literally under `ESCAPE '\'`.
 */

// ---------------------------------------------------------------------------
// FTS5 (SQLite MATCH)
// ---------------------------------------------------------------------------

/**
 * Wrap a user query as an FTS5 phrase so every metacharacter and
 * reserved keyword (`"`, `*`, `(`, `)`, `:`, `AND`, `OR`, `NOT`,
 * `NEAR`) is treated as literal text. Embedded `"` are doubled
 * per FTS5 phrase-escape syntax. Empty input becomes an empty
 * phrase (`""`) which is valid MATCH syntax and matches nothing.
 */
export function sanitizeFts5Query(query: string): string {
  return `"${query.replace(/"/g, `""`)}"`;
}

// ---------------------------------------------------------------------------
// SQL LIKE (Postgres ILIKE)
// ---------------------------------------------------------------------------

/**
 * Escape `%`, `_`, and `\` in a user query so it matches literally
 * inside a `LIKE` pattern that uses `ESCAPE '\'`. Order matters:
 * the backslash must be escaped first so we don't double-escape
 * the escapes we add for `%` and `_`.
 */
export function sanitizeLikePattern(query: string): string {
  return query
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
