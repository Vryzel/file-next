# @vryzel/file-next-cli

CLI for file-next: env diagnosis, and (if you wire hooks) migrate / reconcile.

[Live demo](https://file-next-test-production.up.railway.app)

```bash
pnpm add -g @vryzel/file-next-cli
# or one-shot:
pnpm dlx @vryzel/file-next-cli doctor
```

```
file-next <command>

  doctor                  Check FILE_NEXT_* env (and optional DB/bucket probes)
  migrate --adapter=…     Print / apply metadata migrations (see below)
  reconcile --tenant=…    Detect S3 vs index drift (see below)

  --help
  --version
```

Exit codes: `0` ok, `1` failed check / drift in dry-run, `2` bad config.

## Use cases

### 1. Is this environment wired? — `doctor`

```bash
export FILE_NEXT_PROVIDER=s3
export FILE_NEXT_BUCKET=my-app-uploads
export FILE_NEXT_REGION=us-east-1
file-next doctor
```

Checks that required `FILE_NEXT_*` vars exist. Optional probes (Postgres host, SQLite path, bucket HEAD) run if those env vars / hooks are present.

This is the command you actually want in CI or onboarding.

### 2. Programmatic doctor

```ts
import { runDoctor, formatDoctorReport } from "@vryzel/file-next-cli";

const report = await runDoctor({
  env: process.env,
  probeDb: async () => ({ ok: true, detail: "sqlite ok" }),
  probeBucket: async () => ({ ok: true, detail: "HEAD 200" }),
});
console.log(formatDoctorReport(report));
```

### 3. `migrate` / `reconcile` — honest scope

The **bin** ships with no-op defaults: it will not touch your database or S3 unless **you** pass hooks. SQLite and Postgres stores in `@vryzel/file-next` already create their schema on first use, so most apps never need `migrate`.

To run real work, import `dispatch` in your own bin:

```ts
#!/usr/bin/env node
import { dispatch } from "@vryzel/file-next-cli";
import { createWriteThrough } from "@vryzel/file-next/sync";
import { getFileSystem, getStore } from "./lib/file-next";

const result = await dispatch(process.argv.slice(2), {
  migrate: {
    resolveMigrator: async (adapter) => {
      // return { listPending, apply } for sqlite | postgres
    },
  },
  reconcile: {
    runSync: async ({ tenant, dryRun }) => {
      const report = await createWriteThrough(getFileSystem(), getStore()).reconcile({
        tenantId: tenant,
        dryRun,
      });
      if (!report.ok) throw report.error;
      return {
        missingInS3: report.value.missingInS3,
        orphansInS3: report.value.orphansInS3,
        fixedCount: report.value.fixed,
      };
    },
  },
});
process.stdout.write(result.stdout);
process.exit(result.exitCode);
```

```bash
file-next migrate --adapter=sqlite
file-next reconcile --tenant=demo --dry-run
file-next reconcile --tenant=demo
```

### 4. Help / version

```bash
file-next --help
file-next --version
```

## Not this package

Runtime filesystem → `@vryzel/file-next`. UI → `@vryzel/file-next-ui`.
