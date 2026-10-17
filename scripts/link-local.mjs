#!/usr/bin/env node
// Link this monorepo's packages into the sandbox app (../file-next-test by
// default) so local changes can be tested there.
//   node scripts/link-local.mjs [unlink] [sandboxPath]
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[3] ?? join(root, '..', 'vryzel-quote'));
const unlink = process.argv[2] === 'unlink';

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!existsSync(join(target, 'package.json'))) {
  console.error(
    `Sandbox project not found: ${target}\nPass its path as the last argument.`
  );
  process.exit(1);
}

const manifest = readJson(join(target, 'package.json'));
const deps = { ...manifest.dependencies, ...manifest.devDependencies };
const pkgs = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => {
    const dir = join(root, 'packages', d.name);
    return { dir, name: readJson(join(dir, 'package.json')).name };
  })
  .filter(p => deps[p.name]);

if (pkgs.length === 0) {
  console.error(`None of this repo's packages is a dependency of ${target}`);
  process.exit(1);
}

// pnpm aborts the whole link with ERR_PNPM_UNUSED_PATCH once the patched
// version leaves the graph, so catch it before pnpm does.
const patchSources = [];
const workspaceFile = join(target, 'pnpm-workspace.yaml');
if (existsSync(workspaceFile)) {
  const block = readFileSync(workspaceFile, 'utf8')
    .split(/^patchedDependencies:/m)[1]
    ?.split(/^\S/m)[0];
  if (block) patchSources.push(block);
}
if (manifest.pnpm?.patchedDependencies) {
  patchSources.push(Object.keys(manifest.pnpm.patchedDependencies).join('\n'));
}
const patched = pkgs.filter(p =>
  patchSources.some(text => new RegExp(`${p.name}@\\d`).test(text)),
);
if (patched.length > 0) {
  console.error(
    `${target} patches ${patched.map(p => p.name).join(', ')}, so linking the local build would leave the patch unused and abort the install.\n` +
      'Merge the patched code into this repo (and publish) or drop the patch before linking.'
  );
  process.exit(1);
}

const isLinked = () =>
  pkgs.every(p => {
    try {
      const entry = join(target, 'node_modules', p.name);
      return resolve(dirname(entry), readlinkSync(entry)).startsWith(root);
    } catch {
      return false;
    }
  });

try {
  if (unlink) {
    run(`pnpm unlink ${pkgs.map(p => p.name).join(' ')}`, target);
  } else {
    // The sandbox resolves these packages through dist/, so build first.
    run('pnpm -r --filter "./packages/*" build', root);
    run(`pnpm link ${pkgs.map(p => p.dir).join(' ')}`, target);
  }
} catch (err) {
  // pnpm exits 1 when the sandbox has unapproved build scripts (better-sqlite3),
  // yet still writes the links — trust the resulting symlinks over the code.
  if (isLinked() !== !unlink) throw err;
  console.warn(
    'pnpm reported an error, but the links ended up correct (unapproved build scripts in the sandbox?)'
  );
}

console.log(
  unlink
    ? `Restored published packages in ${target}`
    : `Linked ${pkgs.map(p => p.name).join(', ')} into ${target}\nRebuild while editing: pnpm --filter "./packages/*" dev`
);
