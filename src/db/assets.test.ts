import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import {
  assetUrl,
  blobToText,
  extractMarkdownAssets,
  referencedAssetHashes,
  resolveAssetMarkdown,
  storeImageBlob,
} from './assets';
import { createCard, createDeck } from './repository';
import { exportDatabase, importBackup } from './portability';

vi.mock('../utils/compressImage', () => ({
  compressImageBlob: vi.fn(async (blob: Blob) => ({ blob, width: 0, height: 0 })),
}));

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.assets.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
  ]);
}

describe('image assets', () => {
  beforeEach(reset);

  it('deduplicates identical blobs by content hash', async () => {
    const first = await storeImageBlob(new Blob(['same'], { type: 'image/png' }), 'image/png', 10, 8);
    const second = await storeImageBlob(new Blob(['same'], { type: 'image/png' }), 'image/png', 10, 8);

    expect(first.hash).toBe(second.hash);
    expect(await db.assets.count()).toBe(1);
  });

  it('extracts base64 image Markdown into asset references idempotently', async () => {
    const dataUri = `data:image/png;base64,${btoa('png-bytes')}`;
    const markdown = `Before ![diagram](${dataUri}) after`;

    const migrated = await extractMarkdownAssets(markdown, (asset) => db.assets.put(asset));
    const hashes = referencedAssetHashes(migrated);

    expect(hashes).toHaveLength(1);
    expect(migrated).toContain(assetUrl(hashes[0]));
    expect(migrated).not.toContain('data:image/png;base64');

    const again = await extractMarkdownAssets(migrated, (asset) => db.assets.put(asset));
    expect(again).toBe(migrated);
    expect(await db.assets.count()).toBe(1);
  });

  it('resolves asset references to object URLs and returns them for revocation', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:resolved');
    const asset = await storeImageBlob(new Blob(['img'], { type: 'image/jpeg' }), 'image/jpeg', 4, 3);

    const resolved = await resolveAssetMarkdown(`![x](${assetUrl(asset.hash)})`);

    expect(resolved.markdown).toBe('![x](blob:resolved)');
    expect(resolved.objectUrls).toEqual(['blob:resolved']);
    createObjectURL.mockRestore();
  });

  it('round-trips referenced assets through backup export and import', async () => {
    const deck = await createDeck('Images');
    const asset = await storeImageBlob(new Blob(['backup-image'], { type: 'image/png' }), 'image/png', 20, 12);
    await createCard(deck.id, 'front_back', `![scan](${assetUrl(asset.hash)})`, 'answer');

    const backup = await exportDatabase();
    expect(backup.assets).toHaveLength(1);
    expect(backup.assets[0].hash).toBe(asset.hash);

    await reset();
    await importBackup(backup, 'replace');

    expect(await db.assets.count()).toBe(1);
    const imported = (await db.assets.get(asset.hash))!;
    expect(await blobToText(imported.blob)).toBe('backup-image');
    const card = (await db.cards.toArray())[0];
    expect(card.front).toContain(assetUrl(asset.hash));
  });
});
