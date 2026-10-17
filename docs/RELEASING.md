# Releasing

> One line: `main`. Everything ships from there, CI publishes the tags.

## How it works

| Piece | Job |
|---|---|
| `.github/workflows/ci.yml` | Lint, typecheck, test, build on every push/PR to `main`. |
| `.github/workflows/publish.yml` | On a `v*` tag: build + `pnpm publish` to npm. Nothing else publishes. |
| `CHANGELOG.md` | What each version changed. |
| `packages/*/package.json` | The version. Bumped by hand, all four together. |

The tag is the trigger, so the version bump has to be **already committed** on
`main` before you tag. CI publishes whatever versions it finds.

> `pnpm changeset` / `pnpm version` exist as scripts but changesets is **not
> installed** — they fail. Either add `@changesets/cli` or keep bumping by
> hand as below. Don't leave both paths half-wired.

## The five rules

1. **`main` is the only release line.** Never tag from a feature branch.
2. **Build before you tag.** The tag publishes; a broken build publishes broken.
3. **Never hand-bump a single package.** All four move together.
4. **Never `npm publish` locally.** CI publishes; local publish skips the gate.
5. **One tag, one version, one line.** The tag must be reachable from `main`
   (enforced by `publish.yml`).

## Normal release

```bash
git switch main && git pull

# 1. Work lands through a PR: tests + typecheck green.
pnpm test:run && pnpm typecheck

# 2. Bump the version in every packages/*/package.json + CHANGELOG.md, commit.
#    0.5.1 -> 0.5.2 means a patch, 0.6.0 a feature, 1.0.0 a break.
git commit -am "chore: release 0.5.2"
git push origin main

# 3. Cut the tag — CI publishes from here.
git tag v0.5.2
git push origin v0.5.2
```

Verify:

```bash
npm view @vryzel/file-next version
npm view @vryzel/file-next-ui version
```

## Before you tag

The tag publishes, so inspect the tarball, not just the tests:

```bash
pnpm -r --filter "./packages/*" build
cd packages/ui && npm publish --dry-run   # file list + size, publishes nothing
```

`--dry-run` is safe: npm resolves the tarball and stops.

## Hotfix

Fix forward on `main`. If `main` itself is broken, take `release/hotfix-<what>`
**off `main`**, land it there, and merge back before tagging. Never tag a
hotfix branch.

## When a release went out from a branch

This already happened: v0.2.0 → v0.5.1 were tagged from `feat/*` branches and
never merged into `main`, so `main` looked release-ready while missing a year of
work. Recovery is boring and always the same:

```bash
git log --oneline main..<branch-that-was-released>   # what main is missing
git merge <branch-that-was-released>                 # then let CI re-verify
```

The published tarball is the source of truth for what shipped; git is only
supposed to mirror it.

## Housekeeping

After merging, delete the branch. Old branches are how the above happened.

```bash
git branch --merged main | grep -v main      # safe to delete
git push origin --delete <branch>
```