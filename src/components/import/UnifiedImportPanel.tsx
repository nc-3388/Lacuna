// Unified import panel: a single, powerful import UI that auto-detects the input
// format (CSV, TSV, Markdown table, Markdown list, JSON, Anki text, share codes,
// plain text Q&A) and shows a live preview. Used in both the Dashboard (new deck
// creation) and the Share page (importing shared content).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { m as motion, AnimatePresence } from 'motion/react';
import { Button } from '../ui/Button';
import { UploadIcon, DownloadIcon } from '../ui/icons';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import { type ParsedCard } from '../../db/import';
import {
  detectFormat,
  FORMAT_LABELS,
  type ImportFormat,
  parseImportAuto,
  type UnifiedImportOptions,
} from '../../db/importEngine';
import { checkDuplicatesBatch } from '../../db/repository';
import {
  decodeShare,
  importSharePayload,
  summariseShare,
  type ShareSummary,
} from '../../db/share';
import { formatDate } from '../../utils/datetime';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UnifiedImportPanelProps {
  /** Called with the parsed cards when the user confirms. May be async. */
  onImport: (cards: ParsedCard[]) => void | Promise<void>;
  /** Called when the user cancels. */
  onCancel?: () => void;
  /** Label for the confirm button, e.g. "Add cards" or "Create & import". */
  importLabel?: string;
  /** When true, the panel also handles share-code imports (shows a separate tab). */
  showShareImport?: boolean;
  /** Called after a share-code import completes successfully. */
  onShareImport?: (decks: number, cards: number) => void | Promise<void>;
  /** When provided, the panel checks parsed cards against existing cards in this deck and warns about duplicates. */
  deckId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_CHARS = 500_000;

const ACCEPTED_FILE_TYPES = [
  '.csv', '.tsv', '.txt', '.json', '.md', '.markdown',
  '.html', '.xml',
  'text/csv', 'text/plain', 'text/tab-separated-values',
  'application/json', 'text/markdown', 'text/html',
].join(',');

// ---------------------------------------------------------------------------
// Format help text
// ---------------------------------------------------------------------------

const FORMAT_HELP: Record<ImportFormat, string> = {
  csv: 'Comma-separated values. Each row is a card: first column is the front, second is the back, and an optional third column is tags.',
  tsv: 'Tab-separated values. Each row is a card: first column is the front, second is the back.',
  'markdown-table': 'A Markdown table with headers. Columns named "front"/"back" (or "question"/"answer", "q"/"a", "term"/"definition") are used automatically.',
  'markdown-list': 'A Markdown list where each item or pair of items is a card. Supports Q:/A: prefixes, ordered pairs, and blank-line separated blocks.',
  json: 'A JSON array of objects. Recognised keys (front/back, question/answer, etc.) are used automatically; otherwise the first two string values become front and back.',
  'share-code': 'A Lacuna share code (starts with LAC0 or LAC1). Paste the full code and it will be decoded automatically.',
  'plain-text': 'Plain text with Q:/A: prefixes, separator-based pairs (using —, |, or tab), or blank-line separated blocks.',
  unknown: 'Paste or upload your cards. The format will be detected automatically.',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnifiedImportPanel({
  onImport,
  onCancel,
  importLabel = 'Import cards',
  showShareImport = false,
  onShareImport,
  deckId,
}: UnifiedImportPanelProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formatOverride, setFormatOverride] = useState<ImportFormat | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  // Share code state.
  const [shareMode, setShareMode] = useState(false);
  const [sharePending, setSharePending] = useState<{
    summary: ShareSummary;
    raw: string;
  } | null>(null);
  const [shareImporting, setShareImporting] = useState(false);

  // Auto-detect format (only when text is short enough for fast detection).
  const detection = useMemo(() => {
    if (text.length > 100_000) return { format: 'plain-text' as ImportFormat, confidence: 0.4 };
    return detectFormat(text);
  }, [text]);
  const effectiveFormat = formatOverride ?? detection.format;

  // Parse cards using the unified engine.
  const options: UnifiedImportOptions = useMemo(
    () => (formatOverride ? { format: formatOverride } : {}),
    [formatOverride],
  );

  const result = useMemo(() => {
    const trimmed =
      text.length > MAX_IMPORT_CHARS ? text.slice(0, MAX_IMPORT_CHARS) : text;
    return parseImportAuto(trimmed, options);
  }, [text, options]);

  // Duplicate detection against existing cards in the target deck.
  const [duplicateCount, setDuplicateCount] = useState(0);
  useEffect(() => {
    if (!deckId || result.cards.length === 0) {
      setDuplicateCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const duplicates = await checkDuplicatesBatch(
          deckId,
          result.cards.map((c) => ({ type: c.type, front: c.front, back: c.back })),
        );
        if (!cancelled) setDuplicateCount(duplicates.size);
      } catch {
        if (!cancelled) setDuplicateCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, result.cards]);

  // ---- Clipboard paste detection ----

  const [pasteNotification, setPasteNotification] = useState<string | null>(null);
  const pasteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPasteNotification = useCallback((msg: string) => {
    if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
    setPasteNotification(msg);
    pasteTimeoutRef.current = setTimeout(() => setPasteNotification(null), 2000);
  }, []);

  // Clean up the paste notification timeout on unmount.
  useEffect(() => {
    return () => {
      if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
    };
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pasted = e.clipboardData.getData('text');
      if (!pasted) return;
      const trimmed = pasted.trim();

      // If in share mode tab and share import is available, detect share codes.
      if (showShareImport) {
        const pasteDetection = detectFormat(trimmed);
        if (pasteDetection.format === 'share-code') {
          setText(trimmed);
          setShareMode(true);
          showPasteNotification('Share code detected — switched to share import');
          e.preventDefault();
          return;
        }
        if (shareMode) {
          setText(trimmed);
          setShareMode(false);
          showPasteNotification(`${FORMAT_LABELS[pasteDetection.format]} detected — switched to text import`);
          e.preventDefault();
          return;
        }
      }

      // Auto-detect format and show notification.
      const pasteDetected = detectFormat(trimmed);
      if (pasteDetected.format !== 'unknown' && pasteDetected.confidence >= 0.7) {
        showPasteNotification(`${FORMAT_LABELS[pasteDetected.format]} detected`);
      }
    },
    [showShareImport, shareMode, showPasteNotification],
  );

  // ---- File handling ----

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setFormatOverride(null);
  }, []);

  // ---- Drag and drop ----

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  // ---- Share code handling ----

  async function handleShareInspect() {
    const raw = text.trim();
    if (!raw) return;
    try {
      const payload = await decodeShare(raw);
      setSharePending({ summary: summariseShare(payload), raw });
    } catch {
      // Errors surfaced by the parent page via onShareImport not being called.
    }
  }

  async function handleShareImport() {
    if (!sharePending) return;
    setShareImporting(true);
    try {
      const payload = await decodeShare(sharePending.raw);
      const result = await importSharePayload(payload);
      setSharePending(null);
      setText('');
      if (onShareImport) {
        await onShareImport(result.decks, result.cards);
      }
    } catch {
      // Error surfaced by the parent page.
    } finally {
      setShareImporting(false);
    }
  }

  function clearSharePending() {
    setText('');
    setSharePending(null);
  }

  // ---- Import handler ----

  async function handleImport() {
    if (result.cards.length === 0) return;
    setBusy(true);
    try {
      await onImport(result.cards);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  // ---- Render ----

  const hasText = text.trim().length > 0;
  const canImport = result.cards.length > 0 && result.cards.length <= MAX_IMPORT_ROWS;
  const canShareImport = shareMode && hasText;

  return (
    <div className="flex flex-col gap-4">
      {/* Truncation / row-limit warnings */}
      <AnimatePresence>
        {text.length > MAX_IMPORT_CHARS && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
              Input truncated to {MAX_IMPORT_CHARS.toLocaleString()} characters to keep the
              import responsive.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {result.cards.length > MAX_IMPORT_ROWS && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
              Only the first {MAX_IMPORT_ROWS.toLocaleString()} cards will be imported.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share code import mode toggle — pill style per SPEC §3.4 */}
      {showShareImport && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShareMode(false); setSharePending(null); }}
            className={cn(
              'flex-1 rounded-full border px-4 py-2 text-sm font-medium transition-all',
              !shareMode
                ? 'border-accent/60 bg-accent-soft text-accent shadow-sm shadow-accent/10'
                : 'border-line text-ink-soft hover:border-line-strong hover:bg-ink/5',
            )}
          >
            Import from text or file
          </button>
          <button
            type="button"
            onClick={() => { setShareMode(true); setSharePending(null); }}
            className={cn(
              'flex-1 rounded-full border px-4 py-2 text-sm font-medium transition-all',
              shareMode
                ? 'border-accent/60 bg-accent-soft text-accent shadow-sm shadow-accent/10'
                : 'border-line text-ink-soft hover:border-line-strong hover:bg-ink/5',
            )}
          >
            Import share code
          </button>
        </div>
      )}

      {/* ---- Share code mode ---- */}
      {shareMode ? (
        <ShareCodeImport
          text={text}
          setText={setText}
          pending={sharePending}
          onImport={handleShareImport}
          onClear={clearSharePending}
          importing={shareImporting}
          m={m}
        />
      ) : (
        <>
          {/* ---- Standard import mode ---- */}

          {/* Text area with drag-and-drop overlay */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-ink-faint">
                Paste your cards
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fileInput.current?.click()}
                >
                  <UploadIcon width={14} height={14} />
                  Upload file
                </Button>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFormatOverride(null);
              }}
              onPaste={handlePaste}
              rows={8}
              placeholder="Paste cards, a Markdown table, JSON, or a share code here..."
              className={cn(
                'w-full resize-y rounded-2xl border bg-surface px-4 py-3 font-mono text-sm text-ink outline-none transition-all',
                dragging
                  ? 'border-accent ring-2 ring-accent/20 shadow-md shadow-accent/10'
                  : 'border-line focus:border-accent/60 focus:shadow-sm focus:shadow-accent/5',
              )}
            />

            {/* Drag overlay */}
            <AnimatePresence>
              {dragging && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 * m }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/5 backdrop-blur-sm"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center gap-3 text-accent"
                  >
                    <div className="rounded-full border border-accent/30 bg-accent-soft p-3">
                      <DownloadIcon width={20} height={20} />
                    </div>
                    <span className="text-sm font-medium">Drop file to import</span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Paste notification toast */}
          <AnimatePresence>
            {pasteNotification && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 * m }}
                className="flex items-center gap-2.5 rounded-xl border border-accent/20 bg-accent-soft/50 px-3.5 py-2 text-xs text-accent"
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
                {pasteNotification}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Format detection indicator */}
          <AnimatePresence mode="wait">
            {hasText && (
              <motion.div
                key={effectiveFormat}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 * m }}
                className="flex items-center gap-3"
              >
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-ink-faint">
                  Detected
                </span>
                <FormatBadge format={effectiveFormat} confidence={detection.confidence} />
                {detection.confidence < 0.7 && effectiveFormat !== 'unknown' && (
                  <span className="text-xs text-ink-faint">
                    (low confidence — you may want to check the preview)
                  </span>
                )}

                {/* Manual format override */}
                <div className="ml-auto flex gap-1">
                  {(
                    ['csv', 'tsv', 'markdown-table', 'markdown-list', 'json', 'plain-text'] as const
                  ).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormatOverride(formatOverride === f ? null : f)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all',
                        formatOverride === f
                          ? 'border border-accent/40 bg-accent-soft text-accent'
                          : 'border border-transparent bg-ink/5 text-ink-faint hover:bg-ink/10',
                      )}
                      title={`Force ${FORMAT_LABELS[f]} format`}
                    >
                      {FORMAT_LABELS[f]}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Format-specific help text */}
          <AnimatePresence mode="wait">
            {hasText && (
              <motion.p
                key={effectiveFormat + '-help'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 * m }}
                className="text-xs leading-relaxed text-ink-faint"
              >
                {FORMAT_HELP[effectiveFormat]}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Live preview */}
          <AnimatePresence mode="wait">
            {hasText && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-black/5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-soft">
                    {result.cards.length} card
                    {result.cards.length === 1 ? '' : 's'} ready
                    {duplicateCount > 0 && (
                      <span className="ml-2 text-amber-600">
                        {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  {result.skipped > 0 && (
                    <span className="text-xs text-ink-faint">
                      {result.skipped} row{result.skipped === 1 ? '' : 's'} skipped
                    </span>
                  )}
                </div>

                {result.cards.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    <AnimatePresence>
                      {result.cards.slice(0, 6).map((c, i) => (
                        <motion.li
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8 }}
                          transition={{
                            duration: 0.16 * m,
                            delay: Math.min(i * 0.03, 0.15) * m,
                          }}
                          className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-raised/50 px-3 py-2 text-sm"
                        >
                          <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                            {c.type === 'cloze' ? 'Cloze' : 'Basic'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-ink">
                            {c.front}
                          </span>
                          {c.back && (
                            <span className="min-w-0 truncate text-ink-faint">
                              — {c.back}
                            </span>
                          )}
                          {c.tags && c.tags.length > 0 && (
                            <span className="shrink-0 text-[10px] text-ink-faint">
                              [{c.tags.join(', ')}]
                            </span>
                          )}
                        </motion.li>
                      ))}
                    </AnimatePresence>
                    {result.cards.length > 6 && (
                      <li className="pt-1 text-center text-xs text-ink-faint">
                        …and {result.cards.length - 6} more
                      </li>
                    )}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        {shareMode ? (
          <Button
            variant="primary"
            onClick={handleShareInspect}
            disabled={!canShareImport}
          >
            Read code
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={busy || !canImport}
          >
            {busy
              ? 'Importing…'
              : `${importLabel} (${Math.min(result.cards.length, MAX_IMPORT_ROWS)})`}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share code sub-panel
// ---------------------------------------------------------------------------

function ShareCodeImport({
  text,
  setText,
  pending,
  onImport,
  onClear,
  importing,
  m,
}: {
  text: string;
  setText: (v: string) => void;
  pending: { summary: ShareSummary; raw: string } | null;
  onImport: () => void;
  onClear: () => void;
  importing: boolean;
  m: number;
}) {
  return (
    <>
      <div className="rounded-2xl border border-line bg-surface p-5 transition-all focus-within:border-accent/60 focus-within:shadow-sm focus-within:shadow-accent/5">
        <label className="mb-2.5 block text-xs font-medium uppercase tracking-[0.18em] text-ink-faint">
          Share code
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Paste a Lacuna share code here (it starts with LAC)..."
          className="w-full resize-none break-all rounded-xl border border-line bg-surface-raised/30 px-4 py-3 font-mono text-xs text-ink outline-none transition-all focus:border-accent/40 placeholder:text-ink-faint"
        />
      </div>

      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-accent/30 bg-accent-soft/30 p-5 shadow-sm shadow-accent/5">
              <h3 className="mb-2 font-display text-lg font-medium text-ink">Ready to import</h3>
              <p className="mb-3 text-sm leading-relaxed text-ink-soft">
                This code contains{' '}
                <strong className="text-ink">{pending.summary.deckCount}</strong> deck
                {pending.summary.deckCount === 1 ? '' : 's'} and{' '}
                <strong className="text-ink">{pending.summary.cardCount}</strong> card
                {pending.summary.cardCount === 1 ? '' : 's'}, shared on{' '}
                {formatDate(pending.summary.exportedAt)}.
              </p>
              {pending.summary.deckNames.length > 0 && (
                <ul className="mb-4 flex flex-wrap gap-1.5">
                  {pending.summary.deckNames.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="rounded-full border border-accent/20 bg-accent-soft/50 px-3 py-1 text-xs font-medium text-accent"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
              {pending.summary.omittedImages && (
                <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink-soft">
                  This share code omitted images to keep the code small. Image positions
                  will appear as placeholders after import.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={onClear}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={onImport} disabled={importing}>
                  {importing ? 'Importing…' : 'Add to my decks'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// Format badge
// ---------------------------------------------------------------------------

function FormatBadge({
  format,
  confidence,
}: {
  format: ImportFormat;
  confidence: number;
}) {
  const colour =
    confidence >= 0.8
      ? 'border-positive/30 bg-positive/10 text-positive'
      : confidence >= 0.5
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600'
        : 'border-line bg-ink/5 text-ink-faint';

  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        colour,
      )}
    >
      {FORMAT_LABELS[format]}
    </span>
  );
}
