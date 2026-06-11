// Persistent-storage request and state queries.
//
// Browsers may evict IndexedDB data under storage pressure. Requesting persistent
// storage asks the browser to treat Lacuna's data as important and refrain from
// deleting it silently.

export interface StoragePersistenceState {
  /** Whether the Storage API (persist / persisted / estimate) is available. */
  supported: boolean;
  /** Whether storage is currently persisted. */
  persisted: boolean;
  /** Whether the last persist() request was granted. */
  granted: boolean;
  /** Used bytes, when estimate() succeeds. */
  usage?: number;
  /** Quota bytes, when estimate() succeeds. */
  quota?: number;
}

function hasStorageApi(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.storage !== null &&
    navigator.storage !== undefined &&
    typeof navigator.storage.persist === 'function' &&
    typeof navigator.storage.persisted === 'function'
  );
}

async function runEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? undefined, quota: est.quota ?? undefined };
  } catch {
    return {};
  }
}

/**
 * Request persistent storage if it is not already granted. Returns the current
 * state including whether the request was granted.
 */
export async function requestPersistentStorage(): Promise<StoragePersistenceState> {
  if (!hasStorageApi()) {
    return { supported: false, persisted: false, granted: false };
  }

  const persisted = await navigator.storage.persisted();
  if (persisted === true) {
    const est = await runEstimate();
    return { supported: true, persisted: true, granted: true, ...est };
  }

  const granted = await navigator.storage.persist();
  const est = await runEstimate();
  return { supported: true, persisted: granted, granted, ...est };
}

/** Read the current persistence state without requesting it. */
export async function checkPersistentStorage(): Promise<StoragePersistenceState> {
  if (!hasStorageApi()) {
    return { supported: false, persisted: false, granted: false };
  }

  const persisted = await navigator.storage.persisted();
  const est = await runEstimate();
  return { supported: true, persisted, granted: persisted, ...est };
}
