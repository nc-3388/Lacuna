// Session-scoped object-URL cache for image assets.
//
// Resolving lacuna-asset://<hash> to a blob URL on every card render and revoking
// it on unmount is wasteful. This module caches one object URL per hash for the
// lifetime of the app, revoking the lot only at teardown.

import { db } from './schema';
import { assetUrl, referencedAssetHashes } from './assets';

const cache = new Map<string, string>();

/**
 * Resolve an asset hash to an object URL, creating and caching one if necessary.
 * Returns null when the asset is not in the database.
 */
export async function resolveAssetUrl(hash: string): Promise<string | null> {
  const cached = cache.get(hash);
  if (cached) return cached;

  const asset = await db.assets.get(hash);
  if (!asset) return null;

  const url = URL.createObjectURL(asset.blob);
  cache.set(hash, url);
  return url;
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
}

/** Number of cached object URLs. */
export function cacheSize(): number {
  return cache.size;
}
