import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { createDeck, createCard } from './repository';
import {
  exportCardsCsv,
  exportCardsTsv,
  exportCardsPlainText,
  exportCardsMarkdownTable,
  exportCardsJson,
  exportCardsSimple,
} from './export';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
    db.assets.clear(),
  ]);
}

describe('exportCardsCsv', () => {
  beforeEach(reset);

  it('exports a CSV with the expected header and card rows', async () => {
    const deck = await createDeck('Chemistry');
    await createCard(deck.id, 'front_back', 'What is H2O?', 'Water', ['basics']);
    const csv = await exportCardsCsv();
    expect(csv).toContain('deck_name');
    expect(csv).toContain('Chemistry');
    expect(csv).toContain('What is H2O?');
    expect(csv).toContain('Water');
    expect(csv).toContain('basics');
  });

  it('escapes commas and quotes inside fields', async () => {
    const deck = await createDeck('Quotes');
    await createCard(deck.id, 'front_back', 'Say "hello", world', 'A, B, C');
    const csv = await exportCardsCsv();
    expect(csv).toContain('"Say ""hello"", world"');
    expect(csv).toContain('"A, B, C"');
  });
});

describe('exportCardsTsv', () => {
  beforeEach(reset);

  it('exports a TSV with tab-separated values', async () => {
    const deck = await createDeck('Biology');
    await createCard(deck.id, 'front_back', 'Q', 'A');
    const tsv = await exportCardsTsv();
    expect(tsv).toContain('deck_name\tdeck_colour');
    expect(tsv).toContain('Biology\t\tQ\tA');
  });
});

describe('exportCardsPlainText', () => {
  beforeEach(reset);

  it('exports a human-readable plain text representation', async () => {
    const deck = await createDeck('History');
    await createCard(deck.id, 'front_back', 'Year?', '1066', ['norman']);
    const text = await exportCardsPlainText();
    expect(text).toContain('Deck: History');
    expect(text).toContain('Q: Year?');
    expect(text).toContain('A: 1066');
    expect(text).toContain('Tags: norman');
  });

  it('marks suspended and flagged cards', async () => {
    const deck = await createDeck('Flags');
    const card = await createCard(deck.id, 'front_back', 'Q', 'A');
    card.suspended = true;
    card.flagged = true;
    await db.cards.put(card);
    const text = await exportCardsPlainText();
    expect(text).toContain('(suspended)');
    expect(text).toContain('(flagged)');
  });

  it('renders cloze cards without a separate answer', async () => {
    const deck = await createDeck('Cloze');
    await createCard(deck.id, 'cloze', 'Water is {{c1::H2O}}.', '');
    const text = await exportCardsPlainText();
    expect(text).toContain('Cloze: Water is {{c1::H2O}}.');
    expect(text).not.toContain('Q:');
  });
});

describe('exportCardsMarkdownTable', () => {
  beforeEach(reset);

  it('exports a GFM Markdown table', async () => {
    const deck = await createDeck('Maths');
    await createCard(deck.id, 'front_back', '2+2', '4', ['arithmetic']);
    const md = await exportCardsMarkdownTable();
    expect(md).toContain('| Deck | Front | Back | Tags |');
    expect(md).toContain('| --- | --- | --- | --- |');
    expect(md).toContain('| Maths | 2+2 | 4 | arithmetic |');
  });

  it('escapes pipes in cell content', async () => {
    const deck = await createDeck('Pipes');
    await createCard(deck.id, 'front_back', 'A | B', 'C | D');
    const md = await exportCardsMarkdownTable();
    expect(md).toContain('A \\| B');
    expect(md).toContain('C \\| D');
  });

  it('leaves back empty for cloze cards', async () => {
    const deck = await createDeck('Cloze');
    await createCard(deck.id, 'cloze', 'Hello {{c1::world}}.', '');
    const md = await exportCardsMarkdownTable();
    const row = md.split('\n').find((l) => l.includes('Hello'))!;
    expect(row).toContain('Hello {{c1::world}}.');
    // Back cell should be empty for cloze.
    expect(row).toMatch(/\|\s+\|/);
  });
});

describe('exportCardsJson', () => {
  beforeEach(reset);

  it('exports a valid JSON array of card objects', async () => {
    const deck = await createDeck('Physics');
    await createCard(deck.id, 'front_back', 'F = ma', 'Newton', ['laws']);
    const json = await exportCardsJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({
      front: 'F = ma',
      back: 'Newton',
      tags: ['laws'],
      deck: 'Physics',
      type: 'front_back',
    });
  });
});

describe('exportCardsSimple', () => {
  it('returns a tab-separated front/back list', () => {
    const cards = [
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ];
    const result = exportCardsSimple(cards);
    expect(result).toBe('Q1\tA1\nQ2\tA2');
  });

  it('escapes tabs and newlines in cells', () => {
    const cards = [{ front: 'Q\tX', back: 'A\nY' }];
    const result = exportCardsSimple(cards);
    expect(result).toContain('"Q\tX"');
    expect(result).toContain('"A\nY"');
  });
});
