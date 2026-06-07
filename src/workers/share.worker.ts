// Web Worker that handles share code encoding/decoding off the main thread.
// Keeps the UI responsive when compressing large decks.

import { encodeShareDirect, decodeShareDirect } from '../db/share';

const ctx = globalThis as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

ctx.onmessage = (event: MessageEvent) => {
  const { type, payload, code, id } = event.data as {
    type: 'encode' | 'decode';
    payload?: unknown;
    code?: string;
    id: number;
  };

  void (async () => {
    try {
      if (type === 'encode') {
        const result = await encodeShareDirect(payload as import('../db/share').SharePayload);
        ctx.postMessage({ type: 'result', result, id });
      } else if (type === 'decode') {
        const result = await decodeShareDirect(code!);
        ctx.postMessage({ type: 'result', result, id });
      } else {
        ctx.postMessage({ type: 'error', error: `Unknown worker message type: ${String(type)}`, id });
      }
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        id,
      });
    }
  })();
};
