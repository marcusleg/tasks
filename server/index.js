/** Starts the web server: API, OIDC routes and the built front-end in ../dist. */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { config, validateConfig } from './config.js';

const problems = validateConfig();
if (problems.length) {
  for (const p of problems) console.error(`Configuration problem: ${p}`);
  process.exit(1);
}

const { db } = await import('./db.js');
const { api } = await import('./api.js');
const oidc = await import('./oidc.js');
const { serveFeed } = await import('./calendar-feed.js');

const DIST = resolve(import.meta.dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
});

app.get('/healthz', (c) => {
  db.prepare('SELECT 1').get();
  return c.text('ok');
});

app.route('/api', api);
app.get('/auth/oidc/login', oidc.login);
app.get('/auth/oidc/callback', oidc.callback);
app.get('/cal/:file', serveFeed);

async function sendFile(c, file, cache) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    const data = await readFile(file);
    c.header('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    c.header('Cache-Control', cache);
    return c.body(data);
  } catch {
    return null;
  }
}

app.get('*', async (c) => {
  const path = decodeURIComponent(new URL(c.req.url).pathname);
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, safe);
  if (!file.startsWith(DIST)) return c.text('Not found', 404);
  const cache = safe.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (!safe.endsWith('/')) {
    const direct = await sendFile(c, file, cache);
    if (direct) return direct;
  }
  const page = await sendFile(c, join(file, 'index.html'), 'no-cache');
  if (page) return page;
  if (extname(safe)) return c.text('Not found', 404);
  return (await sendFile(c, join(DIST, 'index.html'), 'no-cache')) ?? c.text('The front-end hasn’t been built. Run “npm run build”.', 500);
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`${config.appName} is running on http://${info.address}:${info.port} (public address: ${config.publicUrl})`);
  console.log(`Sign-in: passwords ${config.passwordAuth ? 'on' : 'off'}, sign-up ${config.allowSignup ? 'open' : 'first account only'}, OIDC ${config.oidc.enabled ? 'on' : 'off'}`);
  oidc.warmUp();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
