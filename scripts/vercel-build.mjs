import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

mkdirSync('api', { recursive: true });

console.log('Building app...');
execSync('bun run build', { stdio: 'inherit' });

console.log('Bundling SSR server for Vercel...');
execSync(
  [
    'npx esbuild dist/server/server.js',
    '--bundle',
    '--outfile=api/_handler.bundle.js',
    '--platform=node',
    '--format=esm',
    '--target=node20',
    '--external:node:*',
    '--external:node:async_hooks',
    '--external:node:stream',
    '--external:node:buffer',
    '--external:node:path',
    '--external:node:fs',
    '--external:node:url',
    '--external:node:http',
    '--external:node:https',
    '--external:node:crypto',
    '--external:node:os',
  ].join(' '),
  { stdio: 'inherit' }
);

console.log('Vercel build complete!');
