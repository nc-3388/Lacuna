import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import {
  resolveAssetUrl,
  resolveAssetMarkdownCached,
  revokeAllCachedUrls,
  cacheSize,
} from './assetCache';

describe('asset object URL cache', () => {
  beforeEach(async () => {
    revokeAllCachedUrls();
    await db.assets.clear();
  });

  it('returns a stable URL for the same hash across multiple calls', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:abc');
    await db.assets.put({
      hash: 'h1',
      blob: new Blob(['x'], { type: 'image/png' }),
      mimeType: 'image/png',
      width: 4,
      height: 3,
      createdAt: 0,
    });

    const first = await resolveAssetUrl('h1');
    const second = await resolveAssetUrl('h1');

    expect(first).toBe('blob:abc');
    expect(second).toBe('blob:abc');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    createObjectURL.mockRestore();
  });

  it('returns null when the asset is not in the database', async () => {
    const url = await resolveAssetUrl('missing');
    expect(url).toBeNull();
  });

  it('replaces all lacuna-asset references in Markdown with cached URLs', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached');
    const hash = 'a'.repeat(64);
    await db.assets.put({
      hash,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 4,
      height: 3,
      createdAt: 0,
    });

    const resolved = await resolveAssetMarkdownCached(`![img](lacuna-asset://${hash})`);
    expect(resolved).toBe('![img](blob:cached)');
  });

  it('revokes every cached URL and clears the cache at teardown', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:xyz');
    await db.assets.put({
      hash: 'h3',
      blob: new Blob(['x'], { type: 'image/png' }),
      mimeType: 'image/png',
      width: 4,
      height: 3,
      createdAt: 0,
    });

    await resolveAssetUrl('h3');
    expect(cacheSize()).toBe(1);

    revokeAllCachedUrls();
    expect(cacheSize()).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:xyz');
    revokeObjectURL.mockRestore();
  });
});
