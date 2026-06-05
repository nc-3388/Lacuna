import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import {
  assetUrl,
  collectOrphanedAssets,
  storeImageBlob,
} from './assets';
import { createCard, createDeck, deleteCards, updateCard } from './repository';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.assets.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
  ]);
}

describe('asset garbage collection', () => {
  beforeEach(reset);

  it('deletes an asset that is no longer referenced by any card', async () => {
    const deck = await createDeck('GC');
    const asset = await storeImageBlob(
      new Blob(['orphan'], { type: 'image/png' }),
      'image/png',
      4,
      3,
    );
    const card = await createCard(
      deck.id,
      'front_back',
      `![pic](${assetUrl(asset.hash)})`,
      'answer',
    );

    await deleteCards([card.id]);
    const removed = await collectOrphanedAssets();
    expect(removed).toBe(1);
    expect(await db.assets.count()).toBe(0);
  });

  it('retains an asset still referenced by another card', async () => {
    const deck = await createDeck('GC');
    const asset = await storeImageBlob(
      new Blob(['shared'], { type: 'image/png' }),
      'image/png',
      4,
      3,
    );
    const c1 = await createCard(
      deck.id,
      'front_back',
      `![pic](${assetUrl(asset.hash)})`,
      'a',
    );
    const c2 = await createCard(
      deck.id,
      'front_back',
      `![pic](${assetUrl(asset.hash)})`,
      'b',
    );

    await deleteCards([c1.id]);
    const removed = await collectOrphanedAssets();
    expect(removed).toBe(0);
    expect(await db.assets.count()).toBe(1);

    await deleteCards([c2.id]);
    const removed2 = await collectOrphanedAssets();
    expect(removed2).toBe(1);
    expect(await db.assets.count()).toBe(0);
  });

  it('collects an asset orphaned by replacing an image in a card', async () => {
    const deck = await createDeck('GC');
    const oldAsset = await storeImageBlob(
      new Blob(['old'], { type: 'image/png' }),
      'image/png',
      4,
      3,
    );
    const card = await createCard(
      deck.id,
      'front_back',
      `![old](${assetUrl(oldAsset.hash)})`,
      'answer',
    );

    await updateCard(card.id, { front: 'No image here.' });
    const removed = await collectOrphanedAssets();
    expect(removed).toBe(1);
    expect(await db.assets.count()).toBe(0);
  });

  it('collects an asset orphaned by deleting a deck', async () => {
    const deck = await createDeck('GC');
    const asset = await storeImageBlob(
      new Blob(['deck-orphan'], { type: 'image/png' }),
      'image/png',
      4,
      3,
    );
    await createCard(
      deck.id,
      'front_back',
      `![pic](${assetUrl(asset.hash)})`,
      'answer',
    );

    const { deleteDeck } = await import('./repository');
    await deleteDeck(deck.id);
    const removed = await collectOrphanedAssets();
    expect(removed).toBe(1);
    expect(await db.assets.count()).toBe(0);
  });
});
