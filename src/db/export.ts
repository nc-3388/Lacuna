import { db } from './schema';

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeTsvCell(value: string): string {
  if (value.includes('\t') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatRow(values: string[], delimiter: ',' | '\t'): string {
  const escaper = delimiter === ',' ? escapeCsvCell : escapeTsvCell;
  return values.map(escaper).join(delimiter);
}

async function fetchDecksAndCards() {
  const [decks, cards] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
  ]);
  const deckMap = new Map(decks.map((d) => [d.id, d.name]));
  const colourMap = new Map(decks.map((d) => [d.id, d.colour ?? '']));
  return { deckMap, colourMap, cards };
}

const EXPORT_HEADERS = [
  'deck_name',
  'deck_colour',
  'front',
  'back',
  'tags',
  'type',
  'suspended',
  'flagged',
  'created_at',
  'stability',
  'difficulty',
  'reps',
  'lapses',
  'state',
  'due',
];

function cardToRow(
  c: Awaited<ReturnType<typeof fetchDecksAndCards>>['cards'][number],
  deckMap: Map<string, string>,
  colourMap: Map<string, string>,
): string[] {
  return [
    deckMap.get(c.deckId) ?? '',
    colourMap.get(c.deckId) ?? '',
    c.front,
    c.back,
    (c.tags ?? []).join(';'),
    c.type,
    c.suspended ? 'yes' : 'no',
    c.flagged ? 'yes' : 'no',
    new Date(c.createdAt).toISOString(),
    c.stability?.toString() ?? '',
    c.difficulty?.toString() ?? '',
    c.reps.toString(),
    c.lapses.toString(),
    c.state.toString(),
    c.due ? new Date(c.due).toISOString() : '',
  ];
}

const CSV_WARNING = '# WARNING: This is a human-readable export, not a full backup. Re-importing will lose review history, image assets, and FSRS parameters. Use JSON backup for a complete snapshot.\n';

export async function exportCardsCsv(): Promise<string> {
  const { deckMap, colourMap, cards } = await fetchDecksAndCards();
  const rows = [formatRow(EXPORT_HEADERS, ','), ...cards.map((c) => formatRow(cardToRow(c, deckMap, colourMap), ','))];
  return CSV_WARNING + rows.join('\r\n');
}

const TSV_WARNING = '# WARNING: This is a human-readable export, not a full backup. Re-importing will lose review history, image assets, and FSRS parameters. Use JSON backup for a complete snapshot.\n';

export async function exportCardsTsv(): Promise<string> {
  const { deckMap, colourMap, cards } = await fetchDecksAndCards();
  const rows = [formatRow(EXPORT_HEADERS, '\t'), ...cards.map((c) => formatRow(cardToRow(c, deckMap, colourMap), '\t'))];
  return TSV_WARNING + rows.join('\r\n');
}

export async function exportCardsPlainText(): Promise<string> {
  const { deckMap, colourMap, cards } = await fetchDecksAndCards();
  const parts: string[] = [];
  for (const c of cards) {
    const deckName = deckMap.get(c.deckId) ?? 'Unknown deck';
    const deckColour = colourMap.get(c.deckId);
    const tags = (c.tags ?? []).join(', ');
    const lines: string[] = [`Deck: ${deckName}`];
    if (deckColour) lines.push(`Colour: ${deckColour}`);
    if (c.type === 'cloze') {
      lines.push(`Cloze: ${c.front}`);
    } else {
      lines.push(`Q: ${c.front}`);
      lines.push(`A: ${c.back}`);
    }
    if (tags) lines.push(`Tags: ${tags}`);
    if (c.suspended) lines.push('(suspended)');
    if (c.flagged) lines.push('(flagged)');
    lines.push('---');
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
