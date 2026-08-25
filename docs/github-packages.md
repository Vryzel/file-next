# GitHub Packages (private)

Packages are scoped to `@vryzel` and publish to `https://npm.pkg.github.com`. First publish is **private**. They are not on npmjs.

| Package | What |
|---|---|
| `@vryzel/file-next` | Core: factory, stores, server actions, sync |
| `@vryzel/file-next-headless` | React hooks |
| `@vryzel/file-next-cli` | `file-next` binary |

## Consume in another repo

`.npmrc` (token stays in env, never in git):

```
@vryzel:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Classic PAT with `read:packages`, or a GitHub Actions `GITHUB_TOKEN` after you grant that repo access to the package.

```bash
pnpm add @vryzel/file-next @vryzel/file-next-headless
```

```ts
import { createFileSystem } from "@vryzel/file-next";
import { createServerActions } from "@vryzel/file-next/server";
import { useFileExplorer } from "@vryzel/file-next-headless";
```

## Publish

Push a tag. The workflow builds and publishes with `GITHUB_TOKEN`.

```bash
git tag v0.3.0
git push origin v0.3.0
```

Do not run `npm publish` without `publishConfig` — that would hit npmjs. The committed `.npmrc` and `publishConfig.registry` pin GitHub Packages.
