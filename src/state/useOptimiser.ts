// Drives the optimisation Web Worker from React: spawns it on demand, tracks
// progress, and tears it down on unmount. Confirmation and persistence stay with
// the caller so optimised weights are never applied without explicit consent.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OptimiseMessage,
  OptimiseRequest,
} from '../workers/optimise.worker';
import type { OptimiseResult } from '../fsrs/optimise';
import type { Card } from '../db/types';

export type OptimiseStatus = 'idle' | 'running' | 'done' | 'error';

export interface OptimiserState {
  status: OptimiseStatus;
  progress: number;
  result: OptimiseResult | null;
  error: string | null;
}

export function useOptimiser() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<OptimiserState>({
    status: 'idle',
    progress: 0,
    result: null,
    error: null,
  });

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => terminate, [terminate]);

  const run = useCallback(
    (cards: Card[], requestRetention: number) => {
      terminate();
      setState({ status: 'running', progress: 0, result: null, error: null });
      const worker = new Worker(
        new URL('../workers/optimise.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<OptimiseMessage>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          setState((s) => ({ ...s, progress: msg.value }));
        } else if (msg.type === 'done') {
          setState({ status: 'done', progress: 1, result: msg.result, error: null });
          terminate();
        } else {
          setState({ status: 'error', progress: 0, result: null, error: msg.message });
          terminate();
        }
      };
      worker.onerror = (e) => {
        setState({ status: 'error', progress: 0, result: null, error: e.message });
        terminate();
      };
      const request: OptimiseRequest = { cards, requestRetention };
      worker.postMessage(request);
    },
    [terminate],
  );

  const reset = useCallback(() => {
    terminate();
    setState({ status: 'idle', progress: 0, result: null, error: null });
  }, [terminate]);

  return { ...state, run, reset };
}
