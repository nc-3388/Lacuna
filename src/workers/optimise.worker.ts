// Web Worker that runs FSRS parameter optimisation off the main thread so training
// never blocks the UI. Initialises the official WASM trainer, posts progress updates
// and a final result; the caller (see src/state/useOptimiser.ts) owns confirmation
// and persistence.

import {
  optimiseParameters,
  type OptimiseResult,
} from '../fsrs/optimise';
import { getBindingOptimiser } from '../fsrs/bindingOptimiser';
import type { Card } from '../db/types';

export interface OptimiseRequest {
  cards: Card[];
  requestRetention: number;
}

export type OptimiseMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; result: OptimiseResult }
  | { type: 'error'; message: string };

const ctx = globalThis as unknown as {
  postMessage: (message: OptimiseMessage) => void;
  onmessage: ((event: MessageEvent<OptimiseRequest>) => void) | null;
};

ctx.onmessage = (event: MessageEvent<OptimiseRequest>) => {
  void (async () => {
    try {
      const { cards, requestRetention } = event.data;
      const binding = await getBindingOptimiser();
      const result = await optimiseParameters(cards, {
        requestRetention,
        computeParameters: binding.computeParameters,
        createItem: (reviews) =>
          new binding.FSRSBindingItem(
            reviews.map((r) => new binding.FSRSBindingReview(r.rating, r.deltaT)),
          ),
        onProgress: (value) => ctx.postMessage({ type: 'progress', value }),
      });
      ctx.postMessage({ type: 'done', result });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
};
