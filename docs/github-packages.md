# Install

Packages are on npmjs as public `@vryzel/*`. No GitHub token.

```bash
pnpm add @vryzel/file-next @vryzel/file-next-headless @vryzel/file-next-ui
```

| Package | What |
|---|---|
| `@vryzel/file-next` | Core: factory, stores, server actions, sync |
| `@vryzel/file-next-headless` | React hooks |
| `@vryzel/file-next-ui` | Default FileExplorer + composable pieces |
| `@vryzel/file-next-cli` | `file-next` binary |

## Publish

Push a `v*` tag. CI publishes to npmjs with `NPM_TOKEN`.

```bash
git tag v0.4.0
git push origin v0.4.0
```
