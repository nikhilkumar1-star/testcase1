import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, cpSync, unlinkSync, existsSync } from 'fs';

// Step 1: Run normal bun build
console.log('Building app...');
execSync('bun run build', { stdio: 'inherit' });

// Step 2: Create Vercel Build Output API structure
console.log('Creating Vercel output...');
mkdirSync('.vercel/output/static', { recursive: true });
mkdirSync('.vercel/output/functions/ssr.func', { recursive: true });

// Step 3: Copy static assets
cpSync('dist/client/assets', '.vercel/output/static/assets', { recursive: true });

// Step 4: Write SSR function entry (req/res → Fetch API wrapper)
const entryFile = '_vercel_ssr_entry_tmp.cjs';
writeFileSync(entryFile, `
const { createServer } = require('node:http');

let _handler;
async function getHandler() {
  if (!_handler) {
    const mod = await import('./dist/server/server.js');
    _handler = mod.default;
  }
  return _handler;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    const app = await getHandler();
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = protocol + '://' + host + req.url;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach(val => headers.append(k, val));
      else headers.set(k, v);
    }

    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readBody(req);
    }

    const fetchReq = new Request(url, { method: req.method, headers, body });
    const fetchRes = await app.fetch(fetchReq);

    res.statusCode = fetchRes.status;
    fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await fetchRes.arrayBuffer()));
  } catch (err) {
    console.error('SSR function error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
};
`);

// Step 5: Bundle the SSR entry + server into a single file
console.log('Bundling SSR function...');
execSync([
  'npx esbuild',
  entryFile,
  '--bundle',
  `--outfile=.vercel/output/functions/ssr.func/index.js`,
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--external:node:*',
].join(' '), { stdio: 'inherit' });

// Step 6: Clean up temp file
unlinkSync(entryFile);

// Step 7: Write function config
writeFileSync('.vercel/output/functions/ssr.func/.vc-config.json', JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.js',
  launcherType: 'Nodejs',
  shouldAddHelpers: true,
}));


// Step 8: Write Vercel routing config
writeFileSync('.vercel/output/config.json', JSON.stringify({
  version: 3,
  routes: [
    { src: '/assets/(.*)', dest: '/assets/$1' },
    { src: '/(.*)', dest: '/ssr' },
  ],
}));

console.log('Vercel build complete!');
