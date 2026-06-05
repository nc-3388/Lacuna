import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { renderClozeBack, renderClozeFront } from './cloze';
import { cn } from '../ui/cn';
import { ASSET_PROTOCOL } from '../../db/assets';
import { resolveAssetMarkdownCached } from '../../db/assetCache';

type ClozeMode = 'front' | 'back' | 'none';

interface MarkdownViewProps {
  source: string;
  /** For cloze cards: render blanks (front) or reveal highlighted answers (back). */
  clozeMode?: ClozeMode;
  className?: string;
}

// Stable plugin references so the unified pipeline isn't rebuilt on every call.
type MarkdownProps = ComponentProps<typeof ReactMarkdown>;
const REMARK_PLUGINS: MarkdownProps['remarkPlugins'] = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: MarkdownProps['rehypePlugins'] = [
  rehypeRaw,
  rehypeKatex,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
];

/**
 * Rendering a card through remark + KaTeX + highlight.js is expensive, and the same
 * source is rendered over and over: once per card row, again on every tab switch
 * (which remounts the list), and again whenever an unrelated parent state changes.
 *
 * The output for a given source is static, so we parse each unique string once and
 * cache the resulting HTML. Subsequent renders — including fresh mounts after a tab
 * switch — become a Map lookup plus an innerHTML assignment. The cache is bounded
 * with simple FIFO eviction so the live editor preview (a new string per keystroke)
 * can't grow it without limit.
 */
const HTML_CACHE = new Map<string, string>();
const CACHE_LIMIT = 600;

function renderMarkdownToHtml(prepared: string): string {
  const cached = HTML_CACHE.get(prepared);
  if (cached !== undefined) return cached;

  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {prepared}
    </ReactMarkdown>,
  );

  if (HTML_CACHE.size >= CACHE_LIMIT) {
    const oldest = HTML_CACHE.keys().next().value;
    if (oldest !== undefined) HTML_CACHE.delete(oldest);
  }
  HTML_CACHE.set(prepared, html);
  return html;
}

/**
 * Renders Markdown with GitHub-flavoured extensions, KaTeX maths, syntax-highlighted
 * code, embedded base64 images, and optional cloze transformation. Raw HTML is enabled
 * so the cloze highlight spans render; this is safe for a local, single-user app.
 *
 * Memoised, and backed by a parse cache (see `renderMarkdownToHtml`), so re-renders and
 * remounts are cheap — the heavy markdown pipeline runs at most once per unique source.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  clozeMode = 'none',
  className,
}: MarkdownViewProps) {
  const [resolved, setResolved] = useState(source);

  useEffect(() => {
    let cancelled = false;

    if (!source.includes(ASSET_PROTOCOL)) {
      setResolved(source);
      return () => {};
    }

    void resolveAssetMarkdownCached(source).then((markdown) => {
      if (cancelled) return;
      setResolved(markdown);
    });

    return () => {
      cancelled = true;
    };
  }, [source]);

  const html = useMemo(() => {
    const prepared =
      clozeMode === 'front'
        ? renderClozeFront(resolved)
        : clozeMode === 'back'
          ? renderClozeBack(resolved)
          : resolved;
    return renderMarkdownToHtml(prepared);
  }, [resolved, clozeMode]);

  return (
    <div
      className={cn('prose-lacuna', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
