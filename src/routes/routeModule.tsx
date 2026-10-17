import { lazy, useState, type ComponentType } from 'react';
import { recoverFromChunkFailure } from '../pwa/staleChunkRecovery';

type RouteModule = { default: ComponentType };
export type RouteLoader = () => Promise<RouteModule>;

const pendingModules = new WeakMap<RouteLoader, Promise<RouteModule>>();
const loadedModules = new WeakMap<RouteLoader, RouteModule>();

/** Read completed prefetches without introducing a first-render suspense delay. */
export function getLoadedRouteModule<T extends RouteLoader>(
  loader: T,
): Awaited<ReturnType<T>> | undefined {
  return loadedModules.get(loader) as Awaited<ReturnType<T>> | undefined;
}

/** Share the actual module between navigation and hover/focus prefetch. */
export function loadRouteModule<T extends RouteLoader>(loader: T): ReturnType<T>;
export function loadRouteModule(loader: RouteLoader): Promise<RouteModule> {
  const pending = pendingModules.get(loader);
  if (pending) return pending;
  const request = loader().then(
    (module) => {
      loadedModules.set(loader, module);
      return module;
    },
    (error: unknown) => {
      pendingModules.delete(loader);
      throw error;
    },
  );
  pendingModules.set(loader, request);
  return request;
}

const RELOAD_KEY = 'lacuna:route-import-reload';
let reloadRequested = false;

function clearRouteRecovery() {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === window.location.href) {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  } catch {
    // Storage restrictions must not prevent a successfully loaded route rendering.
  }
}

function recoverRouteImport(error: unknown): Promise<never> {
  const isImportFailure =
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
      error.message,
    );
  if (!isImportFailure || reloadRequested) throw error;
  try {
    // Persist before reloading. If storage is unavailable, keep the boundary rather
    // than risk a reload loop. Only a successful load of this URL clears the guard.
    if (sessionStorage.getItem(RELOAD_KEY)) {
      // A reload already ran for this URL and the chunk still failed to fetch:
      // plain reloads keep receiving whatever the service worker and its caches
      // hold, so the guard is the signal to clear that state for the current
      // deployment instead. The shared claim throttles repeats; a denial keeps
      // the boundary from turning the failure into a reload loop.
      return recoverFromChunkFailure().then((recovered) => {
        if (recovered) return new Promise<never>(() => {});
        throw error;
      });
    }
    sessionStorage.setItem(RELOAD_KEY, window.location.href);
  } catch {
    throw error;
  }
  reloadRequested = true;
  window.location.reload();
  // Keep Suspense visible while the replacement document loads.
  return new Promise<never>(() => {});
}

export function lazyRouteModule(loader: RouteLoader): ComponentType {
  // Recover on navigation, never on speculative hover/focus prefetches. Catching
  // here covers Vite's production preload rejection as well as dev imports.
  const LazyComponent = lazy(() =>
    loadRouteModule(loader).then((module) => {
      clearRouteRecovery();
      return module;
    }, recoverRouteImport),
  );
  return function RouteModuleComponent() {
    // A fulfilled import alone still suspends React.lazy on its first render.
    // Render an already-prefetched module directly, avoiding React 19's fallback
    // delay. Keep the choice stable for this mount so cold loads retain state.
    const [Component] = useState(() => {
      const loaded = loadedModules.get(loader);
      if (loaded) clearRouteRecovery();
      return loaded?.default ?? LazyComponent;
    });
    return <Component />;
  };
}
