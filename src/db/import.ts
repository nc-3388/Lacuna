// Plain-text / CSV / TSV deck import. Turns pasted or uploaded text into card drafts
// using a customisable field separator (front vs back vs tags) and row separator
// (card vs card). The parser is quote-aware: a field wrapped in double quotes may
// contain the field or row separator and escaped quotes (""), matching how
// spreadsheets and Anki export CSV. Anki's plain-text export is tab-separated and
// flows through the same path.

import type { CardType } from './types';
import { hasCloze } from '../components/markdown/cloze';

/** A card ready to be created: the same shape createCards() consumes. */
export interface ParsedCard {
  type: CardType;
  front: string;
  back: string;
  /** Optional tags parsed from a third column (space-separated, Anki-style). */
  tags?: string[];
}

export interface ImportParseResult {
  cards: ParsedCard[];
  /** Rows that were non-empty but could not be turned into a card (no answer side). */
  skipped: number;
}

/** Defaults requested by the spec: tab between fields, newline between cards. */
export const DEFAULT_FIELD_SEPARATOR = '\t';
export const DEFAULT_ROW_SEPARATOR = '\n';

/**
 * Split raw text into rows of fields, honouring double-quoted fields. A quote only
 * opens a field at its very start; inside a quoted field a doubled quote ("") is a
 * literal quote, and the field/row separators are treated as ordinary text.
 */
function splitDelimited(raw: string, fieldSep: string, rowSep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true; // current field has no characters yet (for quote detection)
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      i += 1;
      continue;
    }
    if (fieldSep && raw.startsWith(fieldSep, i)) {
      row.push(field);
      field = '';
      fieldStart = true;
      i += fieldSep.length;
      continue;
    }
    let rowSepLen = 0;
    if (rowSep && raw.startsWith(rowSep, i)) {
      rowSepLen = rowSep.length;
    } else if (rowSep === '\n' && raw.startsWith('\r\n', i)) {
      rowSepLen = 2;
    } else if (rowSep === '\n' && raw[i] === '\r') {
      rowSepLen = 1;
    }
    if (rowSepLen > 0) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStart = true;
      i += rowSepLen;
      continue;
    }
    field += ch;
    fieldStart = false;
    i += 1;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Parse raw import text into card drafts.
 *
 * Each row is split into fields by `fieldSeparator`; the first field is the front, the
 * second the back, and an optional third field is read as space-separated tags. A row
 * with only one field is imported as a cloze card when it contains `{{cN::…}}` notation,
 * otherwise skipped. Windows and old-Mac line endings are handled natively by
 * `splitDelimited` when `rowSeparator` is `'\n'`.
 */
export function parseImport(
  raw: string,
  fieldSeparator: string = DEFAULT_FIELD_SEPARATOR,
  rowSeparator: string = DEFAULT_ROW_SEPARATOR,
): ImportParseResult {
  const cards: ParsedCard[] = [];
  let skipped = 0;
  if (!raw.trim()) return { cards, skipped };

  const field = fieldSeparator || DEFAULT_FIELD_SEPARATOR;
  const row = rowSeparator || DEFAULT_ROW_SEPARATOR;

  for (const rawFields of splitDelimited(raw, field, row)) {
    const fields = rawFields.map((f) => f.trim());
    if (fields.every((f) => f.length === 0)) continue; // blank row

    const front = fields[0] ?? '';
    if (!front) {
      skipped++;
      continue;
    }
    const back = fields[1] ?? '';
    const tagField = fields[2] ?? '';
    const tags = tagField ? tagField.split(/\s+/).filter(Boolean) : [];
    const withTags = tags.length > 0 ? { tags } : {};

    if (hasCloze(front)) {
      cards.push({ type: 'cloze', front, back: back || '', ...withTags });
    } else if (back) {
      cards.push({ type: 'front_back', front, back, ...withTags });
    } else {
      // A single column with no cloze has no answer side; nothing to study.
      skipped++;
    }
  }

  return { cards, skipped };
}
