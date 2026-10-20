/**
 * Register the built game for offline use without interrupting a running turn.
 * Call install() or applyUpdate() directly from a user click.
 */
export function initPwa(callbacks = {}, environment = {}) {
  const browserWindow = environment.window ?? globalThis.window;
  const browserNavigator = environment.navigator ?? globalThis.navigator;
  const isDev = environment.isDev ?? import.meta.env?.DEV ?? false;
  let installPrompt = null;
  let registration = null;
  let requestedUpdate = false;
  let reloading = false;
  let offlineReported = false;
  let reportedWaiting = null;

  const platform = /iPad|iPhone|iPod/.test(browserNavigator?.userAgent ?? '')
    || (browserNavigator?.platform === 'MacIntel' && browserNavigator?.maxTouchPoints > 1)
    ? 'ios' : /Android/.test(browserNavigator?.userAgent ?? '') ? 'android' : 'desktop';
  const isInstalled = () => Boolean(browserNavigator?.standalone
    || browserWindow?.matchMedia?.('(display-mode: standalone)').matches);
  const emitInstallState = () => callbacks.onInstallAvailable?.({
    available: !isInstalled(),
    mode: isInstalled() ? 'installed' : installPrompt ? 'prompt' : 'manual',
    platform,
    installed: isInstalled(),
  });

  const controller = {
    ready: Promise.resolve(null),
    async install() {
      if (isInstalled()) return { outcome: 'installed', platform };
      if (!installPrompt) return { outcome: browserWindow ? 'manual' : 'unavailable', platform };
      const prompt = installPrompt;
      installPrompt = null;
      emitInstallState();
      try {
        // No awaits before prompt(): preserve the click's user activation.
        const choice = await prompt.prompt();
        return { outcome: choice?.outcome ?? (await prompt.userChoice)?.outcome ?? 'dismissed', platform };
      } catch (error) {
        callbacks.onError?.(error);
        return { outcome: 'manual', platform };
      }
    },
    applyUpdate() {
      if (!registration?.waiting) return false;
      requestedUpdate = true;
      registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
      return true;
    },
  };

  if (!browserWindow || !browserNavigator || isDev) return controller;
  emitInstallState();
  if (isInstalled()) callbacks.onInstalled?.();

  browserWindow.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    emitInstallState();
  });
  browserWindow.addEventListener('appinstalled', () => {
    installPrompt = null;
    callbacks.onInstalled?.();
    callbacks.onInstallAvailable?.({ available: false, mode: 'installed', platform, installed: true });
  });

  const serviceWorker = browserNavigator.serviceWorker;
  if (!serviceWorker || !browserWindow.isSecureContext) return controller;

  const reportWaiting = () => {
    if (!registration?.waiting || registration.waiting === reportedWaiting) return;
    reportedWaiting = registration.waiting;
    callbacks.onUpdateAvailable?.();
  };
  const checkOffline = async () => {
    const active = registration?.active;
    const MessageChannelClass = environment.MessageChannel ?? browserWindow.MessageChannel;
    if (!active || !MessageChannelClass || offlineReported) return;
    const channel = new MessageChannelClass();
    const timer = browserWindow.setTimeout(() => {
      channel.port1.close();
      channel.port2.close();
    }, 5000);
    channel.port1.onmessage = ({ data }) => {
      browserWindow.clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (data?.type === 'OFFLINE_STATUS' && data.ready && !offlineReported) {
        offlineReported = true;
        callbacks.onOfflineReady?.({ version: data.version });
      }
    };
    active.postMessage({ type: 'GET_OFFLINE_STATUS' }, [channel.port2]);
  };
  serviceWorker.addEventListener('controllerchange', () => {
    if (requestedUpdate && !reloading) {
      reloading = true;
      browserWindow.location.reload();
    } else {
      checkOffline();
    }
  });

  controller.ready = (async () => {
    try {
      const base = environment.baseUrl ?? new URL(import.meta.env?.BASE_URL ?? './', browserWindow.location.href).href;
      registration = await serviceWorker.register(new URL('sw.js', base).href, {
        scope: new URL('./', base).href,
        updateViaCache: 'none',
      });
      const watchInstalling = () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && serviceWorker.controller) reportWaiting();
          if (installing.state === 'activated') checkOffline();
        });
      };
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      reportWaiting();
      checkOffline();
      return registration;
    } catch (error) {
      callbacks.onError?.(error);
      return null;
    }
  })();
  return controller;
}
