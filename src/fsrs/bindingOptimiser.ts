// Lazy initialisation of the official FSRS trainer (WASM + WASI worker) for browser
// environments. Imported only from the optimisation Web Worker so the main bundle
// stays light.

import { initOptimizer } from '@open-spaced-repetition/binding/dynamic-wasi';
import wasmUrl from '@open-spaced-repetition/binding-wasm32-wasi/fsrs-binding.wasm32-wasi.wasm?url';
import WasiWorker from '@open-spaced-repetition/binding-wasm32-wasi/wasi-worker-browser.mjs?worker';

type BindingModule = Awaited<ReturnType<typeof initOptimizer>>;

let bindingPromise: Promise<BindingModule> | null = null;

/** Initialise (or return) the WASM-backed FSRS trainer module. */
export function getBindingOptimiser(): Promise<BindingModule> {
  if (!bindingPromise) {
    const p = initOptimizer({
      wasm: wasmUrl,
      worker: () => new WasiWorker(),
    }).catch((err: unknown) => {
      bindingPromise = null;
      throw err;
    });
    bindingPromise = p;
  }
  return bindingPromise;
}
