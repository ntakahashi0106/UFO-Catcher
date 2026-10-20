import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import vm from 'node:vm';
import { buildServiceWorker, createWorkerSource } from '../scripts/build-pwa.mjs';
import { initPwa } from '../src/pwa.js';

class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function workerHarness({
  scope = 'https://example.test/UFO-Catcher/', fail = null,
  version = 'test-version', stores = new Map(), html = 'installed game',
} = {}) {
  const files = ['index.html', 'assets/game.js', 'assets/physics.wasm', 'manifest.webmanifest'];
  const events = new Events();
  const downloads = [];
  let offline = false;
  let skipped = false;
  let claimed = false;
  const keyOf = (request) => typeof request === 'string' ? request : request.url;
  const fetch = async (request) => {
    const url = keyOf(request);
    downloads.push(url);
    if (offline || (fail && url.endsWith(fail))) throw new Error('Offline');
    return new Response(url.endsWith('index.html') || url === scope ? `<html>${html}</html>` : 'game asset');
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          // Browser Cache.addAll is atomic: keep writes pending until all succeed.
          const responses = await Promise.all(requests.map(async (request) => [keyOf(request), await fetch(request)]));
          for (const [key, response] of responses) entries.set(key, response);
        },
        async match(request) { return entries.get(keyOf(request))?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    registration: { scope },
    addEventListener: events.addEventListener.bind(events),
    clients: { async claim() { claimed = true; } },
    async skipWaiting() { skipped = true; },
  };
  vm.runInNewContext(createWorkerSource(files, version), { self, caches, fetch, URL, Request, Response });
  return {
    files, downloads, stores,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    setOffline(value) { offline = value; },
    setHtml(value) { html = value; },
    async lifecycle(type, data = {}) {
      const work = [];
      events.dispatch(type, { ...data, waitUntil(promise) { work.push(promise); } });
      await Promise.all(work);
    },
    async request(url, { mode = 'cors', method = 'GET' } = {}) {
      let response;
      events.dispatch('fetch', { request: { url, mode, method }, respondWith(promise) { response = promise; } });
      return response ? await response : null;
    },
    async offlineStatus() {
      let status;
      await this.lifecycle('message', {
        data: { type: 'GET_OFFLINE_STATUS' },
        ports: [{ postMessage(message) { status = message; } }],
      });
      return status;
    },
  };
}

test('PWA build versions all output assets and keeps URLs relative to the GitHub project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hashi-pwa-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<script src="./assets/game.js"></script>');
    await writeFile(join(directory, 'manifest.webmanifest'), '{"start_url":"./"}');
    await writeFile(join(directory, 'assets/game.js'), 'first version');
    const first = await buildServiceWorker(directory);
    const source = await readFile(join(directory, 'sw.js'), 'utf8');
    assert.deepEqual(first.files, ['assets/game.js', 'index.html', 'manifest.webmanifest']);
    assert.match(source, /"\.\/assets\/game\.js"/);
    assert.doesNotMatch(source, /"\/assets\//);
    await writeFile(join(directory, 'assets/game.js'), 'second version');
    const second = await buildServiceWorker(directory);
    assert.notEqual(second.version, first.version);
    assert.ok(!second.files.includes('sw.js'));
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.includes('hashi-pwa-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('complete game is cached atomically, works offline on a subpath, and isolates other apps', async () => {
  const worker = workerHarness();
  worker.stores.set('hashi-game:/other-app/:old', new Map());
  worker.stores.set('hashi-game:/UFO-Catcher/:old', new Map());
  await worker.lifecycle('install');
  assert.equal(worker.downloads.length, worker.files.length + 1);
  assert.equal(worker.skipped, false, 'install must not bypass a running game');
  await worker.lifecycle('activate');
  assert.equal(worker.claimed, true);
  assert.ok(worker.stores.has('hashi-game:/other-app/:old'));
  assert.ok(!worker.stores.has('hashi-game:/UFO-Catcher/:old'));
  assert.equal((await worker.offlineStatus()).ready, true);
  worker.setOffline(true);
  const shell = await worker.request('https://example.test/UFO-Catcher/?from=home', { mode: 'navigate' });
  assert.match(await shell.text(), /installed game/);
  const wasm = await worker.request('https://example.test/UFO-Catcher/assets/physics.wasm');
  assert.equal(await wasm.text(), 'game asset');
  assert.equal(await worker.request('https://example.test/other-app/', { mode: 'navigate' }), null);
  assert.equal(await worker.request('https://example.test/UFO-Catcher/api'), null);
  assert.equal(await worker.request('https://other.test/UFO-Catcher/assets/game.js'), null);
  assert.equal(await worker.request('https://example.test/UFO-Catcher/assets/game.js', { method: 'POST' }), null);
  await worker.lifecycle('message', { data: { type: 'APPLY_UPDATE' } });
  assert.equal(worker.skipped, true);
});

test('failed asset download never reports offline readiness or skips waiting', async () => {
  const worker = workerHarness({ fail: 'physics.wasm' });
  await assert.rejects(worker.lifecycle('install'), /Offline/);
  assert.equal((await worker.offlineStatus()).ready, false);
  assert.equal(worker.skipped, false);
  assert.equal(worker.claimed, false);
});

test('installed navigation shell stays coherent until a waiting update is explicitly activated', async () => {
  const current = workerHarness({ version: 'old-version', html: 'old complete game' });
  await current.lifecycle('install');
  await current.lifecycle('activate');
  current.setHtml('new deployment with different asset hashes');
  const downloadsBeforeNavigation = current.downloads.length;
  const onlineShell = await current.request('https://example.test/UFO-Catcher/', { mode: 'navigate' });
  assert.match(await onlineShell.text(), /old complete game/);
  assert.equal(current.downloads.length, downloadsBeforeNavigation, 'fresh network HTML cannot bypass the installed version');

  const update = workerHarness({ version: 'new-version', stores: current.stores, html: 'new complete game' });
  await update.lifecycle('install');
  assert.equal(update.skipped, false);
  const waitingShell = await current.request('https://example.test/UFO-Catcher/', { mode: 'navigate' });
  assert.match(await waitingShell.text(), /old complete game/);
  await update.lifecycle('message', { data: { type: 'APPLY_UPDATE' } });
  assert.equal(update.skipped, true);
  await update.lifecycle('activate');
  update.setOffline(true);
  const updatedShell = await update.request('https://example.test/UFO-Catcher/', { mode: 'navigate' });
  assert.match(await updatedShell.text(), /new complete game/);
  assert.ok(!update.stores.has('hashi-game:/UFO-Catcher/:old-version'));
});

function runtimeHarness({ isDev = false, installed = false, platform = 'iPhone' } = {}) {
  const window = new Events();
  const serviceWorker = new Events();
  const registration = new Events();
  const messages = [];
  let reloads = 0;
  let registered = null;
  window.location = { href: 'https://example.test/UFO-Catcher/', reload() { reloads++; } };
  window.isSecureContext = true;
  window.matchMedia = () => ({ matches: installed });
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  serviceWorker.controller = {};
  serviceWorker.register = async (url, options) => { registered = { url, options }; return registration; };
  registration.waiting = { postMessage(message) { messages.push(message); } };
  const navigator = { userAgent: platform, serviceWorker };
  return {
    environment: { window, navigator, isDev }, window, serviceWorker, registration, messages,
    get reloads() { return reloads; }, get registered() { return registered; },
  };
}

test('runtime registration preserves subpath and applies updates only on explicit user action', async () => {
  const harness = runtimeHarness();
  let updates = 0;
  const pwa = initPwa({ onUpdateAvailable() { updates++; } }, harness.environment);
  await pwa.ready;
  assert.equal(harness.registered.url, 'https://example.test/UFO-Catcher/sw.js');
  assert.equal(harness.registered.options.scope, 'https://example.test/UFO-Catcher/');
  assert.equal(harness.registered.options.updateViaCache, 'none');
  assert.equal(updates, 1);
  harness.serviceWorker.dispatch('controllerchange');
  assert.equal(harness.reloads, 0);
  assert.deepEqual(harness.messages, []);
  assert.equal(pwa.applyUpdate(), true);
  assert.deepEqual(harness.messages, [{ type: 'APPLY_UPDATE' }]);
  harness.serviceWorker.dispatch('controllerchange');
  harness.serviceWorker.dispatch('controllerchange');
  assert.equal(harness.reloads, 1);
});

test('install prompt is retained until a click and manual iOS instructions remain available', async () => {
  const harness = runtimeHarness();
  const states = [];
  let prompts = 0;
  const pwa = initPwa({ onInstallAvailable(state) { states.push(state); } }, harness.environment);
  assert.deepEqual(await pwa.install(), { outcome: 'manual', platform: 'ios' });
  let prevented = false;
  harness.window.dispatch('beforeinstallprompt', {
    preventDefault() { prevented = true; },
    async prompt() { prompts++; return { outcome: 'accepted' }; },
  });
  assert.equal(prevented, true);
  assert.equal(prompts, 0);
  assert.equal(states.at(-1).mode, 'prompt');
  assert.deepEqual(await pwa.install(), { outcome: 'accepted', platform: 'ios' });
  assert.equal(prompts, 1);
  assert.equal(states.at(-1).mode, 'manual');
  await pwa.install();
  assert.equal(prompts, 1, 'a retained prompt may only be used once');
});

test('offline availability is announced only after the active worker confirms the complete cache', async () => {
  const harness = runtimeHarness();
  const ready = [];
  let complete = false;
  harness.environment.MessageChannel = class {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = {
        close() {},
        postMessage: (data) => this.port1.onmessage?.({ data }),
      };
    }
  };
  harness.registration.active = {
    postMessage(message, ports) {
      assert.equal(message.type, 'GET_OFFLINE_STATUS');
      ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: complete, version: 'cache-version' });
    },
  };
  const pwa = initPwa({ onOfflineReady(status) { ready.push(status); } }, harness.environment);
  await pwa.ready;
  assert.deepEqual(ready, []);
  complete = true;
  harness.serviceWorker.dispatch('controllerchange');
  harness.serviceWorker.dispatch('controllerchange');
  assert.deepEqual(ready, [{ version: 'cache-version' }]);
  assert.equal(harness.reloads, 0);
});

test('entering browser fullscreen does not pretend that the app is installed', async () => {
  const harness = runtimeHarness();
  harness.window.matchMedia = (query) => ({ matches: query === '(display-mode: fullscreen)' });
  const states = [];
  const pwa = initPwa({ onInstallAvailable(state) { states.push(state); } }, harness.environment);
  assert.equal(states[0].installed, false);
  assert.equal(states[0].available, true);
  assert.equal((await pwa.install()).outcome, 'manual');
});

test('development server never registers a worker', async () => {
  const harness = runtimeHarness({ isDev: true });
  await initPwa({}, harness.environment).ready;
  assert.equal(harness.registered, null);
});

test('manifest and app icons support installation from a project subpath', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(new URL(manifest.start_url, 'https://example.test/UFO-Catcher/manifest.webmanifest').pathname, '/UFO-Catcher/');
  assert.equal(manifest.id, undefined, 'use the resolved start URL as the app identity, avoiding an origin-root id collision');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const icon = await readFile(new URL(`../public/icons/${file}`, import.meta.url));
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
});
