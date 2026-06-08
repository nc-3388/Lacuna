import { db } from './schema';
import type { BackupAsset, ImageAsset } from './types';
import { compressImageBlob } from '../utils/compressImage';

export const ASSET_PROTOCOL = 'lacuna-asset://';
const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
const ASSET_RE = /lacuna-asset:\/\/([a-f0-9]{64})/gi;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new Error('Invalid base64 data in image asset.');
  }
}

/**
 * Build a Blob from raw bytes. We hand the Blob constructor a fresh ArrayBuffer
 * slice rather than the Uint8Array view directly: the DOM lib types now bind
 * typed arrays to a generic backing buffer (which may be a SharedArrayBuffer),
 * and a plain ArrayBuffer is unambiguously a BlobPart.
 */
function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: mimeType });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return hex(new Uint8Array(digest));
}

export function assetUrl(hash: string): string {
  return `${ASSET_PROTOCOL}${hash}`;
}

export function referencedAssetHashes(markdown: string): string[] {
  const hashes = new Set<string>();
  for (const match of markdown.matchAll(ASSET_RE)) hashes.add(match[1].toLowerCase());
  return [...hashes];
}

export function referencedAssetHashesInCards(cards: { front: string; back: string }[]): string[] {
  const hashes = new Set<string>();
  for (const card of cards) {
    referencedAssetHashes(`${card.front}\n${card.back}`).forEach((hash) => hashes.add(hash));
  }
  return [...hashes];
}

export function stripAssetImages(markdown: string): { markdown: string; stripped: boolean } {
  let stripped = false;
  // Normalise line endings so every regex below can assume LF-only.
  const source = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Inline images: ![alt](lacuna-asset://hash)
  let next = source.replace(/!\[([^\]]*)\]\(lacuna-asset:\/\/[a-f0-9]{64}\)/gi, (_m, alt) => {
    stripped = true;
    return `[Image omitted from share code: ${alt || 'image'}]`;
  });
  // Reference-style images: ![alt][ref] where [ref]: lacuna-asset://hash
  const strippedRefs = new Set<string>();
  next = next.replace(/!\[([^\]]*)\]\[([^\]]*)\]/gi, (m, alt, ref) => {
    const refPattern = new RegExp(
      `\\[${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*lacuna-asset:\\/\\/[a-f0-9]{64}`,
      'i',
    );
    if (refPattern.test(next)) {
      stripped = true;
      strippedRefs.add(ref);
      return `[Image omitted from share code: ${alt || 'image'}]`;
    }
    return m;
  });
  // Strip the dangling reference definitions so asset hashes don't leak.
  for (const ref of strippedRefs) {
    const defPattern = new RegExp(
      `\\n\\[${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*lacuna-asset:\\/\\/[a-f0-9]{64}\\s*(?=\\n|$)`,
      'gi',
    );
    next = next.replace(defPattern, '\n');
  }
  // HTML img tags: <img src="lacuna-asset://hash" ...>
  next = next.replace(/<img\s+[^>]*src=["']lacuna-asset:\/\/[a-f0-9]{64}["'][^>]*>/gi, (_m) => {
    stripped = true;
    return '[Image omitted from share code]';
  });
  return { markdown: next, stripped };
}

export async function storeImageBlob(
  blob: Blob,
  mimeType: string,
  width: number,
  height: number,
): Promise<ImageAsset> {
  const hash = await sha256Blob(blob);
  const asset: ImageAsset = {
    hash,
    blob,
    mimeType,
    width,
    height,
    createdAt: Date.now(),
  };
  await db.assets.put(asset);
  return asset;
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(null);
    };
    img.src = URL.createObjectURL(blob);
  });
}

async function assetFromDataUri(uri: string, mimeType: string): Promise<ImageAsset> {
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const bytes = base64ToBytes(base64);
  const blob = bytesToBlob(bytes, mimeType);

  // Compress image assets so the database never stores an uncompressed base64 payload.
  if (mimeType.startsWith('image/')) {
    try {
      const compressed = await compressImageBlob(blob);
      const hash = await sha256Blob(compressed.blob);
      return {
        hash,
        blob: compressed.blob,
        mimeType: compressed.blob.type || mimeType,
        width: compressed.width,
        height: compressed.height,
        createdAt: Date.now(),
      };
    } catch {
      // If compression fails, try to read dimensions from the original blob.
      const dims = await getImageDimensions(blob);
      if (dims) {
        const hash = await sha256Blob(blob);
        return { hash, blob, mimeType, width: dims.width, height: dims.height, createdAt: Date.now() };
      }
    }
  }

  const hash = await sha256Blob(blob);
  return { hash, blob, mimeType, width: 0, height: 0, createdAt: Date.now() };
}

export async function extractMarkdownAssets(
  markdown: string,
  putAsset: (asset: ImageAsset) => Promise<unknown>,
  knownHashes?: Set<string>,
): Promise<string> {
  const replacements: { from: string; to: string }[] = [];
  const seen = new Set<string>();

  // Handle data URIs: extract, compress and store as assets.
  for (const match of markdown.matchAll(DATA_IMAGE_RE)) {
    const from = match[0];
    if (seen.has(from)) continue;
    seen.add(from);
    const asset = await assetFromDataUri(from, match[1]);
    await putAsset(asset);
    replacements.push({ from, to: assetUrl(asset.hash) });
  }

  // Normalise lacuna-asset:// references: verify each referenced hash exists in the
  // asset store and replace any that are missing with a broken-image placeholder.
  for (const match of markdown.matchAll(ASSET_RE)) {
    const from = match[0];
    if (seen.has(from)) continue;
    seen.add(from);
    const hash = match[1].toLowerCase();
    if (knownHashes?.has(hash)) continue;
    const existing = await db.assets.get(hash);
    if (!existing) {
      replacements.push({ from, to: MISSING_ASSET_SVG });
    }
  }

  return replacements.reduce((text, r) => text.replaceAll(r.from, r.to), markdown);
}

const MISSING_ASSET_SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iMTIiIHk9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjEwIiBmaWxsPSIjOTk5Ij5Mb3N0IGltYWdlPC90ZXh0Pjwvc3ZnPg==';

export async function resolveAssetMarkdown(markdown: string): Promise<{
  markdown: string;
  objectUrls: string[];
}> {
  const replacements: { from: string; to: string }[] = [];
  const objectUrls: string[] = [];
  for (const hash of referencedAssetHashes(markdown)) {
    const asset = await db.assets.get(hash);
    if (!asset) {
      replacements.push({ from: assetUrl(hash), to: MISSING_ASSET_SVG });
      continue;
    }
    const url = URL.createObjectURL(asset.blob);
    objectUrls.push(url);
    replacements.push({ from: assetUrl(hash), to: url });
  }
  return {
    markdown: replacements.reduce((text, r) => text.replaceAll(r.from, r.to), markdown),
    objectUrls,
  };
}

export async function assetsForBackup(hashes: string[]): Promise<BackupAsset[]> {
  if (hashes.length === 0) return [];
  const assets = await db.assets.where('hash').anyOf(hashes).toArray();
  return Promise.all(
    assets.map(async (asset) => ({
      hash: asset.hash,
      data: bytesToBase64(new Uint8Array(await asset.blob.arrayBuffer())),
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
    })),
  );
}

export function backupAssetToImageAsset(asset: BackupAsset): ImageAsset {
  return {
    hash: asset.hash,
    blob: bytesToBlob(base64ToBytes(asset.data), asset.mimeType),
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Asset garbage collection
// ---------------------------------------------------------------------------

let gcTimeout: ReturnType<typeof setTimeout> | null = null;
let gcRunning = false;

/**
 * Scan every card's Markdown and remove assets whose hash is not referenced anywhere.
 * Safe to call at any time: it only deletes truly unreferenced rows.
 */
export async function collectOrphanedAssets(): Promise<number> {
  if (gcRunning) return 0;
  gcRunning = true;
  try {
    // Build the set of referenced hashes by streaming cards in batches
    // so we never load the entire card table into memory at once.
    const referenced = new Set<string>();
    const batchSize = 500;
    let offset = 0;
    while (true) {
      const batch = await db.cards.offset(offset).limit(batchSize).toArray();
      if (batch.length === 0) break;
      for (const card of batch) {
        referencedAssetHashes(`${card.front}\n${card.back}`).forEach((h) => referenced.add(h));
      }
      offset += batch.length;
    }

    // Stream asset keys and collect orphans without loading all keys at once.
    const orphans: string[] = [];
    await db.assets.toCollection().eachPrimaryKey((hash) => {
      if (!referenced.has(hash)) orphans.push(hash);
    });
    if (orphans.length > 0) {
      await db.assets.bulkDelete(orphans);
    }
    return orphans.length;
  } finally {
    gcRunning = false;
  }
}

/**
 * Schedule a deferred asset sweep. Multiple rapid calls collapse into one so the
 * sweep runs only after a quiet period (e.g. after a bulk edit or import finishes).
 * Never runs during an active Learn session.
 */
export function scheduleAssetGc(delayMs = 3000): void {
  if (gcTimeout) clearTimeout(gcTimeout);
  gcTimeout = setTimeout(() => {
    void collectOrphanedAssets();
  }, delayMs);
}

/** Wait for any pending scheduled GC to complete. Exposed for tests. */
export async function flushAssetGc(): Promise<void> {
  if (gcTimeout) {
    clearTimeout(gcTimeout);
    gcTimeout = null;
    await collectOrphanedAssets();
  }
}
