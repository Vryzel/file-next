# Virtual scroll

## Objective
Replace the full-width "Load more" button with scroll-triggered pagination, and virtualize both explorer views.

## Problem
FileExplorer loads 50 items, then a full-width button. Large folders render every row or card.

## Why
Scroll should fetch the next page. Only the visible window should mount, in list and grid.

## Scope
- `@vryzel/file-next-ui` only
- `@tanstack/react-virtual` as a dependency, external in tsup (not bundled, not a peer)
- Both `ExplorerListView` and `ExplorerGridView`
- Tests for the load-more decision and for the explorer

## Out of scope
- Version bump and CHANGELOG (parent, after tests are green)
- npm publish
- Quote app
- `registry/` copies
- `.atl/` skill registry

## Constraints
- TanStack Virtual is the chosen library. Do not add react-window or react-virtuoso.
- Keep cursor pagination (`PAGE_SIZE` 50). Do not load the whole folder in one request.
- Grid stays column-aligned. Virtualize rows, not masonry lanes.
- Column count follows the container width, matching today's breakpoints: <640 → 3, <768 → 5, <1024 → 6, else 8.
- `loadMore` label stays on the type. Do not render the full-width button.
- Public view components must still render if no scroll parent is passed (internal scroller).
- English identifiers and comments. No persona slang in code.

## Route
Delegated writer. Trigger: list view, grid view, explorer, helper, and tests.

## Checklist
- [x] Add `@tanstack/react-virtual` and externalize it in `packages/ui/tsup.config.ts`
- [x] Pure helpers + unit tests: `shouldLoadMore`, `gridColumnCount`
- [x] List view virtualized against the explorer scroll parent
- [x] Grid view virtualized by rows against the same parent
- [x] Near-end and short-viewport fetch the next cursor without a button
- [x] Keyboard selection and rename scroll the item into the window
- [x] Explorer tests: next page loads itself; a long list does not mount every row
- [x] `pnpm --filter @vryzel/file-next-ui test:run` and `typecheck` green
- [x] Changelog and 1.0.0 after that green run (parent)

## Verification
- `pnpm --filter @vryzel/file-next-ui test:run`: 2 files, 7 tests passed
- `pnpm --filter @vryzel/file-next-ui typecheck`: tsc clean
- Runtime harness: N/A (library UI, no app server in this repo for this change)

## Acceptance
- No "Load more" button
- Next page loads when the window reaches the end, and when the first page does not fill the scroller
- List and grid mount only the visible window plus overscan
- Existing empty-folder test still passes

## Checks
- `pnpm --filter @vryzel/file-next-ui test:run`
- `pnpm --filter @vryzel/file-next-ui typecheck`
