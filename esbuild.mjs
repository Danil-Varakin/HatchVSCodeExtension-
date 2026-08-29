import { context, build } from 'esbuild';

const options = {
  entryPoints: ['src/extension.ts'],
  // .cjs, not .js: package.json says "type": "module", and the extension host
  // loads main with require()
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // the floor engines.vscode declares: VS Code 1.85 is Electron 25, which is node 18
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build({ ...options, minify: process.argv.includes('--minify') });
}
