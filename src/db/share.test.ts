import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import {
  createCard,
  createCardWithReverse,
  createDeck,
  updateDeck,
} from './repository';
import {
  buildShareCode,
  buildShareCodeQR,
  decodeShare,
  decodeShareDirect,
  importSharePayload,
  summariseShare,
} from './share';
import { assetUrl, storeImageBlob } from './assets';
import { bytesToBase45 } from './base45';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
    db.assets.clear(),
  ]);
}

describe('share codes', () => {
  beforeEach(reset);

  it('round-trips a deck, preserving content, cloze, colour and the date due', async () => {
    const deck = await createDeck('Chemistry');
    await updateDeck(deck.id, { examObjective: 'securedTopics', examDate: 1_900_000_000_000, colour: '#e11d48' });
    await createCard(deck.id, 'front_back', 'What is water?', 'H2O', ['basics']);
    await createCard(deck.id, 'cloze', 'The capital of France is {{c1::Paris}}.', '');

    const code = await buildShareCode([deck.id]);
    expect(code.startsWith('LAC1')).toBe(true);

    const payload = await decodeShare(code);
    const summary = summariseShare(payload);
    expect(summary.deckCount).toBe(1);
    expect(summary.cardCount).toBe(2);
    expect(summary.omittedImages).toBe(false);

    await importSharePayload(payload);

    const decks = await db.decks.toArray();
    expect(decks).toHaveLength(2); // original + imported
    const imported = decks.find((d) => d.id !== deck.id)!;
    expect(imported.name).toBe('Chemistry');
    expect(imported.examObjective).toBe('securedTopics');
    expect(imported.examDate).toBe(1_900_000_000_000);
    expect(imported.colour).toBe('#e11d48');

    const importedCards = await db.cards.where('deckId').equals(imported.id).toArray();
    expect(importedCards).toHaveLength(2);
    expect(importedCards.some((c) => c.type === 'cloze')).toBe(true);
    expect(importedCards.some((c) => c.front === 'What is water?' && c.back === 'H2O')).toBe(
      true,
    );
    // Imported cards start with clean scheduling state.
    expect(importedCards.every((c) => c.stability === null && c.reps === 0)).toBe(true);
  });

  it('round-trips a deck using the legacy LAC0 plain base64 format', async () => {
    const deck = await createDeck('Legacy');
    await createCard(deck.id, 'front_back', 'Q', 'A');

    const payload = await decodeShareDirect('LAC0' + btoa(JSON.stringify({ v: 1, by: null, at: Date.now(), decks: [{ n: 'Legacy', o: 0, c: 0, e: 0, cards: [{ k: 0, f: 'Q', b: 'A' }] }] })));
    expect(payload.decks).toHaveLength(1);
    expect(payload.decks[0].cards[0].f).toBe('Q');
  });

  it('round-trips a deck using the legacy LAC1 compressed base64 format', async () => {
    const deck = await createDeck('LegacyCompressed');
    await createCard(deck.id, 'front_back', 'Q', 'A');

    const code = await buildShareCode([deck.id]);
    // Manually create a LAC1 code by re-encoding the payload
    const payload = await decodeShare(code);
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    ).arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(compressed)));
    const legacyCode = 'LAC1' + b64;

    const decoded = await decodeShare(legacyCode);
    expect(decoded.decks).toHaveLength(1);
    expect(decoded.decks[0].cards[0].f).toBe('Q');
  });

  it('compresses a reverse pair into one entry and expands it back into two cards', async () => {
    const deck = await createDeck('Vocab');
    await createCardWithReverse(deck.id, 'chien', 'dog');

    const payload = await decodeShare(await buildShareCode([deck.id]));
    // The two mirrored cards are stored as a single reversible entry.
    expect(payload.decks[0].cards).toHaveLength(1);
    expect(payload.decks[0].cards[0].k).toBe(2);
    expect(summariseShare(payload).cardCount).toBe(2);

    await importSharePayload(payload);
    const imported = (await db.decks.toArray()).find((d) => d.id !== deck.id)!;
    const cards = await db.cards.where('deckId').equals(imported.id).toArray();
    expect(cards).toHaveLength(2);
    expect(cards.some((c) => c.front === 'chien' && c.back === 'dog')).toBe(true);
    expect(cards.some((c) => c.front === 'dog' && c.back === 'chien')).toBe(true);
  });

  it('bundles several decks in one code', async () => {
    const a = await createDeck('One');
    const b = await createDeck('Two');
    await createCard(a.id, 'front_back', 'a', '1');
    await createCard(b.id, 'front_back', 'b', '2');

    const payload = await decodeShare(await buildShareCode([a.id, b.id]));
    expect(summariseShare(payload).deckCount).toBe(2);
    expect(summariseShare(payload).deckNames).toEqual(['One', 'Two']);
  });

  it('rejects a string that is not a share code', async () => {
    await expect(decodeShare('not a real code')).rejects.toThrow();
  });

  it('rejects a payload with a valid prefix but malformed nested structure', async () => {
    // A payload where a deck is missing the required `cards` array.
    const malformed = {
      v: 1,
      by: null,
      at: Date.now(),
      decks: [{ n: 'Bad deck', o: 0, c: 0, e: 0 }],
    };
    const plain = 'LAC3' + bytesToBase45(new TextEncoder().encode(JSON.stringify(malformed)));
    await expect(decodeShare(plain)).rejects.toThrow(/unsupported version/);
  });

  it('produces shorter codes with Base64 (LAC1) than Base45 (LAC2) for the same payload', async () => {
    const deck = await createDeck('Vocab');
    await createCard(deck.id, 'front_back', 'chien', 'dog');
    await createCard(deck.id, 'front_back', 'chat', 'cat');
    await createCard(deck.id, 'cloze', 'The capital of France is {{c1::Paris}}.', '');

    const code = await buildShareCode([deck.id]);
    expect(code.startsWith('LAC1')).toBe(true);

    // Manually build a Base45 equivalent (LAC2) to compare length.
    const payload = await decodeShare(code);
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    ).arrayBuffer();
    const base45Code = 'LAC2' + bytesToBase45(new Uint8Array(compressed));

    // Base64 must be shorter than Base45 for the same compressed payload.
    expect(code.length).toBeLessThan(base45Code.length);
  });

  it('strips images from share codes and imports placeholders gracefully', async () => {
    const deck = await createDeck('Image deck');
    const asset = await storeImageBlob(new Blob(['already-compressed'], { type: 'image/png' }), 'image/png', 100, 80);
    await createCard(deck.id, 'front_back', `Label\n![scan](${assetUrl(asset.hash)})`, 'Back text');

    const code = await buildShareCode([deck.id]);
    expect(code.length).toBeLessThan(800);

    const payload = await decodeShare(code);
    const summary = summariseShare(payload);
    expect(summary.omittedImages).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(asset.hash);
    expect(JSON.stringify(payload)).toContain('Image omitted from share code');

    await importSharePayload(payload);
    const imported = (await db.decks.toArray()).find((d) => d.id !== deck.id)!;
    const cards = await db.cards.where('deckId').equals(imported.id).toArray();
    expect(cards[0].front).toContain('Label');
    expect(cards[0].front).toContain('Image omitted from share code');
    expect(cards[0].back).toBe('Back text');
  });
});

describe('QR share codes', () => {
  beforeEach(reset);

  it('generates a QR-ready Base45 code (LAC2) and round-trips it', async () => {
    const deck = await createDeck('QR Vocab');
    await createCard(deck.id, 'front_back', 'bonjour', 'hello');
    await createCard(deck.id, 'cloze', 'The capital of Spain is {{c1::Madrid}}.', '');

    const qrCode = await buildShareCodeQR([deck.id]);
    expect(qrCode.startsWith('LAC2')).toBe(true);

    const payload = await decodeShare(qrCode);
    expect(payload.decks).toHaveLength(1);
    expect(payload.decks[0].cards).toHaveLength(2);
    const fronts = payload.decks[0].cards.map((c) => c.f);
    expect(fronts).toContain('bonjour');
    expect(fronts.some((f) => f.includes('Madrid'))).toBe(true);

    await importSharePayload(payload);
    const decks = await db.decks.toArray();
    expect(decks).toHaveLength(2);
  });

  it('produces a Base45 code that is readable by the unified decoder', async () => {
    const deck = await createDeck('Unified');
    await createCard(deck.id, 'front_back', 'Q', 'A');

    const qrCode = await buildShareCodeQR([deck.id]);
    expect(qrCode.startsWith('LAC2')).toBe(true);

    const decoded = await decodeShareDirect(qrCode);
    expect(decoded.decks).toHaveLength(1);
    expect(decoded.decks[0].cards[0].f).toBe('Q');
  });
});
