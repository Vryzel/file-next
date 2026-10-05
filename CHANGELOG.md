# Changelog

## 0.5.0 — 2026-10-05

- Explorer list and grid virtualize the visible window. The next page loads as you scroll; the full-width Load more button is gone.
- Upload queue scrolls the full list, follows the file currently uploading, and shows byte-weighted total progress. Cancel stops the active upload and drops the rest of the queue. Each row can be removed.
- A same-folder upload whose name is already taken is stored as `name (1).ext` instead of failing. Folder create, move, and rename still conflict.
- File preview opens as a lightbox. Images zoom with the controls, the wheel, or a double-click. PDF, text, video, and audio use the same full-screen frame, without a dialog card.
- Signed downloads are `attachment`. `inline` is kept only for preview types that do not execute as a page. HTML and SVG stay attachments.
- `@vryzel/file-next-ui` depends on `@tanstack/react-virtual`.

## 0.4.5 — 2026-09-03

- UI/headless npm listings say they require `@vryzel/file-next`. Install commands include the peers.
- Example tenant id is `demo`, not `acme`.

## 0.4.4 — 2026-09-03

- Package READMEs and the repo README link the [live demo](https://file-next-test-production.up.railway.app).

## 0.4.3 — 2026-09-03

- Share links are `/api/share/{token}` on the app origin. `createShareRouteHandler` streams the object so the URL never exposes the bucket or key.
- Rename and new folder are inline (Finder-style). Enter or blur saves; Escape cancels. New folder defaults to `New folder`.

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
