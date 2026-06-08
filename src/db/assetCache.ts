// Session-scoped object-URL cache for image assets.
//
// Resolving lacuna-asset://<hash> to a blob URL on every card render and revoking
// it on unmount is wasteful. This module caches one object URL per hash for the
// lifetime of the app, revoking the lot only at teardown.

import { db } from './schema';
import { assetUrl, referencedAssetHashes } from './assets';

const MAX_SIZE = 200;

interface LruNode {
  key: string;
  prev: LruNode | null;
  next: LruNode | null;
}

const cache = new Map<string, string>();
const nodeMap = new Map<string, LruNode>();
let head: LruNode | null = null;
let tail: LruNode | null = null;
const pending = new Map<string, Promise<string | null>>();

function moveToFront(node: LruNode): void {
  if (node === head) return;
  // Detach
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  if (node === tail) tail = node.prev;
  // Prepend
  node.prev = null;
  node.next = head;
  if (head) head.prev = node;
  head = node;
  if (!tail) tail = node;
}

function addFront(key: string): LruNode {
  const node: LruNode = { key, prev: null, next: head };
  if (head) head.prev = node;
  head = node;
  if (!tail) tail = node;
  nodeMap.set(key, node);
  return node;
}

function evictOldest(): void {
  if (!tail) return;
  const oldestKey = tail.key;
  const url = cache.get(oldestKey);
  if (url) URL.revokeObjectURL(url);
  cache.delete(oldestKey);
  // Detach tail
  const newTail = tail.prev;
  if (newTail) newTail.next = null;
  tail = newTail;
  if (!tail) head = null;
  nodeMap.delete(oldestKey);
}

/**
 * Resolve an asset hash to an object URL, creating and caching one if necessary.
 * Returns null when the asset is not in the database.
 */
export async function resolveAssetUrl(hash: string): Promise<string | null> {
  const cached = cache.get(hash);
  if (cached) {
    const node = nodeMap.get(hash);
    if (node) moveToFront(node);
    return cached;
  }

  const existing = pending.get(hash);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const asset = await db.assets.get(hash);
      if (!asset) return null;
      const url = URL.createObjectURL(asset.blob);
      if (cache.size >= MAX_SIZE) evictOldest();
      cache.set(hash, url);
      addFront(hash);
      return url;
    } finally {
      pending.delete(hash);
    }
  })();

  pending.set(hash, promise);
  return promise;
}

/**
 * Replace every lacuna-asset:// reference in Markdown with its cached object URL.
 * Does not return URLs for revocation — the cache owns the lifecycle.
 */
export async function resolveAssetMarkdownCached(markdown: string): Promise<string> {
  const hashes = referencedAssetHashes(markdown);
  const urls = await Promise.all(hashes.map((h) => resolveAssetUrl(h)));
  let result = markdown;
  for (let i = 0; i < hashes.length; i++) {
    const url = urls[i];
    if (url) {
      result = result.replaceAll(assetUrl(hashes[i]), url);
    }
  }
  return result;
}

/** Revoke every cached object URL and clear the cache. */
export function revokeAllCachedUrls(): void {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
  nodeMap.clear();
  head = null;
  tail = null;
}

/** Number of cached object URLs. */
export function cacheSize(): number {
  return cache.size;
}
