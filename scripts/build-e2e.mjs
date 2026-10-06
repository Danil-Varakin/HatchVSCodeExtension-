// Bundles test/e2e/*.e2e.ts for the extension host: one CommonJS file each, `vscode`
// left for the host to supply — the same API object the extension under test gets.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';

const dir = 'test/e2e';
// cleared first: the suite is every out/e2e/*.e2e.cjs, so a file dropped from test/e2e
// would otherwise keep running — with its fixtures — out of the last build
rmSync('out/e2e', { recursive: true, force: true });
const entryPoints = readdirSync(dir).filter((f) => f.endsWith('.e2e.ts')).map((f) => `${dir}/${f}`);
await build({
  entryPoints,
  outdir: 'out/e2e',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode', 'mocha'],
  sourcemap: true,
  logLevel: 'warning',
});
