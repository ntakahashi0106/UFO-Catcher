import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

async function listFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path, root);
    if (!entry.isFile() || entry.name === 'sw.js') return [];
    return [relative(root, path).split(sep).join('/')];
  }));
  return files.flat().sort();
}

export function createWorkerSource(files, version) {
  return `// Generated after Vite build. The cache version includes every game file.
const VERSION = ${JSON.stringify(version)};
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'hashi-game:' + SCOPE.pathname + ':';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const PRECACHE_FILES = ${JSON.stringify(['./', ...files.map((file) => `./${file}`)], null, 2)};
const PRECACHE_URLS = PRECACHE_FILES.map((file) => new URL(file, SCOPE).href);
const PRECACHE_SET = new Set(PRECACHE_URLS);
const SHELL_URL = new URL('./index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  // addAll commits only when the complete game downloads successfully.
  // A replacement worker waits for user consent or for all old tabs to close.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'APPLY_UPDATE') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === 'GET_OFFLINE_STATUS' && event.ports?.[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const entries = await Promise.all(PRECACHE_URLS.map((url) => cache.match(url)));
      event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: entries.every(Boolean), version: VERSION });
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Keep HTML and hashed bundles on one installed version. A newly
      // deployed HTML page must not get ahead of its waiting worker.
      return (await cache.match(SHELL_URL)) || fetch(request);
    })());
    return;
  }

  url.search = '';
  url.hash = '';
  if (!PRECACHE_SET.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url.href)) || fetch(request);
  })());
});
`;
}

export async function buildServiceWorker(directory = resolve('dist')) {
  const files = await listFiles(directory);
  if (!files.includes('index.html') || !files.includes('manifest.webmanifest')) {
    throw new Error('PWA build requires dist/index.html and manifest.webmanifest. Run Vite first.');
  }
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(resolve(directory, file)));
  }
  const version = hash.digest('hex').slice(0, 20);
  await writeFile(resolve(directory, 'sw.js'), createWorkerSource(files, version));
  return { files, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, version } = await buildServiceWorker();
  console.log(`PWA: precached ${files.length} files + entry URL (${version}).`);
}
