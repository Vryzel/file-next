# Changelog

## 0.4.2 — 2026-09-03

- `purgeNode`: hard-delete from trash (metadata + leftover S3 keys).
- SQLite FTS: do not FTS-delete already-tombstoned rows (`SQLITE_CORRUPT_VTAB`). Schema v4 rebuilds the index.
- FileExplorer hides “Delete forever” unless `actions.purgeNode` is passed.

## 0.4.1 — 2026-09-02

- Package READMEs: copy-paste use cases for core, headless, UI, and CLI.

## 0.4.0 — 2026-09-02

- `@vryzel/file-next-ui`: default `FileExplorer` (quote-grade) plus composable pieces, Tailwind `className`, optional labels.

## 0.3.1 — 2026-09-02

- Honest public docs: 6 hooks, 13 registry items, no mixed bash/TS snippet.
- Package READMEs for `@vryzel/file-next`, `-headless`, and `-cli`.
- `_resetFileSystemForTests` is no longer part of the public export.
- Postgres tests skip when the server is unreachable.
- CLI `--version` reports `0.3.1`.

## 0.3.0

Published to GitHub Packages as `@vryzel/file-next`, `@vryzel/file-next-headless`, `@vryzel/file-next-cli`.
