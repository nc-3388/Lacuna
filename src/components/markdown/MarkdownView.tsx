import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
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

/** Restricted schema that only allows the specific className patterns needed by
 *  remark-math ($...$ markers) and fenced code blocks. KaTeX and highlight.js
 *  run *after* sanitisation so their generated markup is not stripped.
 */
const RESTRICTED_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math', 'math-inline']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math', 'math-display']],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
  },
};

const REHYPE_PLUGINS: MarkdownProps['rehypePlugins'] = [
  rehypeRaw,
  [rehypeSanitize, RESTRICTED_SCHEMA],
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
interface CacheEntry {
  html: string;
  accessedAt: number;
}

const HTML_CACHE = new Map<string, CacheEntry>();
const DEFAULT_CACHE_LIMIT = 600;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum number of parsed HTML entries to retain. Exposed so tests can tune it. */
export let cacheLimit = DEFAULT_CACHE_LIMIT;

export function setCacheLimit(limit: number): void {
  cacheLimit = Math.max(1, limit);
}

export function getCacheLimit(): number {
  return cacheLimit;
}

function evictStaleEntries(now: number): void {
  const cutoff = now - CACHE_TTL_MS;
  for (const [key, entry] of HTML_CACHE) {
    if (entry.accessedAt < cutoff) {
      HTML_CACHE.delete(key);
    }
  }
}

/** Evict the single least-recently-used entry (oldest accessedAt). */
function evictLru(): void {
  let oldestKey: string | undefined;
  let oldestTime = Infinity;
  for (const [key, entry] of HTML_CACHE) {
    if (entry.accessedAt < oldestTime) {
      oldestTime = entry.accessedAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) HTML_CACHE.delete(oldestKey);
}

function renderMarkdownToHtml(prepared: string): string {
  const now = Date.now();
  const cached = HTML_CACHE.get(prepared);
  if (cached !== undefined) {
    // Update access time on hit so LRU eviction preserves frequently-used entries.
    cached.accessedAt = now;
    return cached.html;
  }

  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {prepared}
    </ReactMarkdown>,
  );

  if (HTML_CACHE.size >= cacheLimit) {
    evictStaleEntries(now);
  }
  if (HTML_CACHE.size >= cacheLimit) {
    evictLru();
  }
  HTML_CACHE.set(prepared, { html, accessedAt: now });
  return html;
}

/**
 * Renders Markdown with GitHub-flavoured extensions, KaTeX maths, syntax-highlighted
 * code, embedded base64 images, and optional cloze transformation. Raw HTML is enabled
 * so the cloze highlight spans render, then passed through rehype-sanitize to strip any
 * dangerous elements or attributes introduced by user content (e.g. from imported shared decks).
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
      tabIndex={-1}
    />
  );
});
