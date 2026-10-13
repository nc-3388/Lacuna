import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';
import { resolveAssetMarkdownCached } from '../../db/assetCache';

vi.mock('../../db/assets', () => ({
  ASSET_PROTOCOL: 'lacuna-asset://',
}));

vi.mock('../../db/assetCache', () => ({
  resolveAssetMarkdownCached: vi.fn((md: string) => Promise.resolve(md)),
}));

describe('MarkdownView — embed rendering (allowEmbeds true)', () => {
  it('converts a bare YouTube watch URL to a youtube-nocookie iframe', () => {
    const { container } = render(
      <MarkdownView source="https://www.youtube.com/watch?v=dQw4w9WgXcQ" allowEmbeds />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    // The responsive wrapper's layout classes must survive sanitisation, else the
    // aspect-ratio box collapses and the video renders at zero height.
    expect(container.querySelector('.aspect-video iframe')).not.toBeNull();
  });

  it('converts a youtu.be short URL to a youtube-nocookie iframe', () => {
    const { container } = render(
      <MarkdownView source="https://youtu.be/abc123defGH" allowEmbeds />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc123defGH');
  });

  it('converts a bare Vimeo URL to a player.vimeo iframe', () => {
    const { container } = render(<MarkdownView source="https://vimeo.com/123456789" allowEmbeds />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toBe('https://player.vimeo.com/video/123456789');
  });

  it('does NOT create an iframe when allowEmbeds is false (default)', () => {
    const { container } = render(
      <MarkdownView source="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('SECURITY: strips an iframe whose src points to a disallowed host', () => {
    const { container } = render(
      <MarkdownView
        source='<iframe src="https://evil.example/steal-cookies"></iframe>'
        allowEmbeds
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('SECURITY: strips an iframe with a javascript: src', () => {
    const { container } = render(
      <MarkdownView
        source='<iframe src="javascript:alert(document.cookie)"></iframe>'
        allowEmbeds
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a <details><summary> collapsible block', () => {
    const { container } = render(
      <MarkdownView
        source="<details><summary>Section title</summary>\n\nBody text.\n\n</details>"
        allowEmbeds
      />,
    );
    expect(container.querySelector('details')).not.toBeNull();
    expect(container.querySelector('summary')).not.toBeNull();
    expect(container.querySelector('summary')!.textContent).toBe('Section title');
  });
});

describe('MarkdownView — audio assets', () => {
  it('turns only resolved local audio markers into players', async () => {
    vi.mocked(resolveAssetMarkdownCached).mockResolvedValueOnce('![audio](blob:clip)');
    const hash = 'a'.repeat(64);
    const { container } = render(<MarkdownView source={`![audio](lacuna-asset://${hash})`} />);

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:clip');
    expect(container.querySelector('audio')).toHaveAttribute('controls');
  });

  it('does not turn a remote image labelled audio into a player', () => {
    const { container } = render(<MarkdownView source="![audio](https://example.com/clip.mp3)" />);
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('img')).toMatchObject({
      loading: 'lazy',
      decoding: 'async',
    });
  });

  it('defers ordinary card images until they are near the viewport', () => {
    const { container } = render(
      <MarkdownView source="![Diagram](https://example.com/diagram.png)" />,
    );
    expect(container.querySelector('img')).toMatchObject({
      loading: 'lazy',
      decoding: 'async',
    });
  });
});

describe('MarkdownView — diagrams and note links', () => {
  it('marks mermaid fences as diagram placeholders with readable fallback', () => {
    const { container } = render(
      <MarkdownView source={'```mermaid\nflowchart TD\n  A-->B\n```'} allowEmbeds />,
    );
    const placeholder = container.querySelector('pre.lacuna-mermaid');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain('flowchart TD');
  });

  it('leaves ordinary code fences untouched', () => {
    const { container } = render(<MarkdownView source={'```js\nconst a = 1;\n```'} allowEmbeds />);
    expect(container.querySelector('pre.lacuna-mermaid')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toContain('const a = 1;');
  });

  it('renders [[note]] references as pills, never links', () => {
    const { container } = render(
      <MarkdownView source="- [[01_Peacemaking_and_the_Big_Three]]" allowEmbeds />,
    );
    const pill = container.querySelector('.lacuna-wikilink');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe('01_Peacemaking_and_the_Big_Three');
    expect(container.querySelector('.lacuna-wikilink a')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders [[target|label]] with the custom label', () => {
    const { container } = render(<MarkdownView source="See [[note-id|Custom label]]" />);
    expect(container.querySelector('.lacuna-wikilink')!.textContent).toBe('Custom label');
  });

  it('does not rewrite wikilinks inside code blocks', () => {
    const { container } = render(<MarkdownView source="`[[Not a link]]`" />);
    expect(container.querySelector('.lacuna-wikilink')).toBeNull();
  });

  it('wraps tables for horizontal scrolling', () => {
    const { container } = render(
      <MarkdownView source={'| Date | Event |\n|---|---|\n| 1919 | Treaty |\n'} />,
    );
    expect(container.querySelector('.lacuna-table-wrap table')).not.toBeNull();
  });

  it('SECURITY: strips scripts hidden in wikilink labels', () => {
    const { container } = render(<MarkdownView source="[[note|<script>alert(1)</script>]]" />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
  });

  it('renders the Versailles visual-index sample without raw fences or brackets', () => {
    const sample = [
      '# Treaty of Versailles — Visual Index',
      '',
      '```mermaid',
      'flowchart TD',
      '  A-->B',
      '```',
      '',
      '| Date | Event |',
      '|---|---|',
      '| 28 Jun 1919 | Treaty signed |',
      '',
      '- [[01_Peacemaking_and_the_Big_Three]]',
    ].join('\n');
    const { container } = render(<MarkdownView source={sample} allowEmbeds />);
    expect(container.querySelector('pre.lacuna-mermaid')).not.toBeNull();
    expect(container.querySelector('.lacuna-table-wrap table')).not.toBeNull();
    expect(container.querySelector('.lacuna-wikilink')).not.toBeNull();
    expect(container.innerHTML).not.toContain('```mermaid');
  });
});

describe('MarkdownView \u2014 maths', () => {
  it('emits KaTeX markup that the imported KaTeX stylesheet styles', () => {
    // KaTeX 0.18 prefixed its layout classes (base -> katex-base). Markup from one
    // KaTeX version under another version's stylesheet loses fraction lines and sizing.
    const require = createRequire(import.meta.url);
    const css = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');
    const { container } = render(<MarkdownView source={'$\\frac{a}{b}$'} />);
    const classes = new Set(
      [...container.querySelectorAll('.katex-html *')].flatMap((el) => [...el.classList]),
    );
    expect(classes.size).toBeGreaterThan(0);
    const unstyled = [...classes].filter(
      (name) => !css.includes(`.${name}`) && css.includes(`.katex-${name}`),
    );
    expect(unstyled).toEqual([]);
  });
});
