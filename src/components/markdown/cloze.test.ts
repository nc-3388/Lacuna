import { describe, it, expect } from 'vitest';
import {
  parseClozes,
  hasCloze,
  renderClozeFront,
  renderClozeBack,
  nextClozeIndex,
} from './cloze';

describe('parseClozes', () => {
  it('extracts a single cloze span', () => {
    const spans = parseClozes('Water is {{c1::H2O}}.');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ index: 1, answer: 'H2O', hint: undefined });
  });

  it('extracts multiple cloze spans with different indices', () => {
    const spans = parseClozes('{{c1::A}} and {{c2::B}} and {{c1::C}}');
    expect(spans).toHaveLength(3);
    expect(spans[0]).toEqual({ index: 1, answer: 'A', hint: undefined });
    expect(spans[1]).toEqual({ index: 2, answer: 'B', hint: undefined });
    expect(spans[2]).toEqual({ index: 1, answer: 'C', hint: undefined });
  });

  it('captures optional hints', () => {
    const spans = parseClozes('{{c1::Paris::capital city}}');
    expect(spans[0]).toEqual({ index: 1, answer: 'Paris', hint: 'capital city' });
  });

  it('returns an empty array when there is no cloze notation', () => {
    expect(parseClozes('Plain text without any cloze')).toEqual([]);
  });
});

describe('hasCloze', () => {
  it('is true for strings containing cloze notation', () => {
    expect(hasCloze('{{c1::x}}')).toBe(true);
    expect(hasCloze('Some {{c2::y::hint}} text')).toBe(true);
  });

  it('is false for plain text', () => {
    expect(hasCloze('Plain text')).toBe(false);
    expect(hasCloze('')).toBe(false);
  });
});

describe('renderClozeFront', () => {
  it('replaces spans with [...] placeholders', () => {
    expect(renderClozeFront('Water is {{c1::H2O}}.')).toBe(
      'Water is <span class="cloze-blank">[...]</span>.',
    );
  });

  it('uses the hint when provided', () => {
    expect(renderClozeFront('The capital is {{c1::Paris::city}}.')).toBe(
      'The capital is <span class="cloze-blank">[city]</span>.',
    );
  });

  it('escapes HTML in hints and answers', () => {
    expect(renderClozeFront('{{c1::answer::<script>}}')).toBe(
      '<span class="cloze-blank">[&lt;script&gt;]</span>',
    );
  });
});

describe('renderClozeBack', () => {
  it('reveals answers wrapped in a highlight span', () => {
    expect(renderClozeBack('Water is {{c1::H2O}}.')).toBe(
      'Water is <span class="cloze-reveal">H2O</span>.',
    );
  });

  it('escapes HTML in answers', () => {
    expect(renderClozeBack('{{c1::<script>}}')).toBe(
      '<span class="cloze-reveal">&lt;script&gt;</span>',
    );
  });
});

describe('nextClozeIndex', () => {
  it('returns 1 for text with no cloze', () => {
    expect(nextClozeIndex('Plain text')).toBe(1);
  });

  it('returns max index + 1', () => {
    expect(nextClozeIndex('{{c1::A}} {{c3::B}}')).toBe(4);
  });

  it('returns 2 for a single c1 span', () => {
    expect(nextClozeIndex('{{c1::A}}')).toBe(2);
  });
});
