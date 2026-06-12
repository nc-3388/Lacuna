import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m as motion } from 'motion/react';
import { useAllCards, useDecks } from '../state/useData';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import {
  buildShareCode,
  buildShareCodeQR,
  decodeShare,
  importSharePayload,
  summariseShare,
  type ShareSummary,
} from '../db/share';
import { referencedAssetHashesInCards } from '../db/assets';
import { exportCardsSimple } from '../db/export';
import {
  CheckIcon,
  DownloadIcon,
  ShareIcon,
  UploadIcon,
  CardsIcon,
  FileTextIcon,
  QrCodeIcon,
  CameraIcon,
  CloseIcon,
} from '../components/ui/icons';
import { formatDate } from '../utils/datetime';
import QRCode from 'react-qr-code';
import type { Html5Qrcode } from 'html5-qrcode';

/** Maximum characters a single QR code (version 40, L error correction) can hold in Alphanumeric mode. */
const MAX_QR_ALPHANUMERIC_CHARS = 4296;

/**
 * Share decks as a single copy-and-paste code, and rebuild decks from a code. Share codes
 * are text-only so they stay small; full backups are the route for transferring images.
 */
export function SharePage() {
  const decks = useDecks();
  const cards = useAllCards();
  const { notify } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [code, setCode] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ summary: ShareSummary; raw: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const plainTextCopyTimeoutRef = useRef<number | null>(null);
  const [motionSpeed] = useMotionSpeed();

  const [plainText, setPlainText] = useState('');
  const [plainTextCopied, setPlainTextCopied] = useState(false);

  // QR code generation state
  const [qrCode, setQrCode] = useState('');
  const [qrGenerating, setQrGenerating] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // QR code scanning state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Clear pending copy timeouts on unmount to avoid setState on unmounted component.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      if (plainTextCopyTimeoutRef.current) window.clearTimeout(plainTextCopyTimeoutRef.current);
    };
  }, []);

  // Clean up QR scanner on unmount
  useEffect(() => {
    return () => {
      const scanner = html5QrCodeRef.current;
      if (scanner) {
        html5QrCodeRef.current = null;
        void scanner.stop().then(() => {
          void scanner.clear();
        }).catch(() => {
          // Ignore cleanup errors
        });
      }
    };
  }, []);

  const m = speedMultiplier(motionSpeed);

  // Card counts per deck, for the selection labels.
  const cardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards ?? []) counts.set(c.deckId, (counts.get(c.deckId) ?? 0) + 1);
    return counts;
  }, [cards]);

  const selectedCount = selected.size;
  const selectedCards = useMemo(
    () => [...selected].reduce((sum, id) => sum + (cardCounts.get(id) ?? 0), 0),
    [selected, cardCounts],
  );
  const selectedHasImages = useMemo(() => {
    const selectedSet = selected;
    const selectedCardRows = (cards ?? []).filter((card) => selectedSet.has(card.deckId));
    return referencedAssetHashesInCards(selectedCardRows).length > 0;
  }, [cards, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Any change invalidates a previously generated code or plain text export.
    setCode('');
    setPlainText('');
    setQrCode('');
    setShowQR(false);
  }

  function toggleAll() {
    if (!decks) return;
    setCode('');
    setPlainText('');
    setQrCode('');
    setShowQR(false);
    setSelected((prev) => {
      if (prev.size === decks.length) {
        return new Set();
      }
      return new Set(decks.map((d) => d.id));
    });
  }

  async function handleGenerate() {
    if (selectedCount === 0) return;
    setGenerating(true);
    try {
      const result = await buildShareCode([...selected]);
      setCode(result);
      setCopied(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not generate a share code.', 'negative');
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateQR() {
    if (selectedCount === 0) return;
    setQrGenerating(true);
    try {
      const result = await buildShareCodeQR([...selected]);
      if (result.length > MAX_QR_ALPHANUMERIC_CHARS) {
        notify(
          'This deck is too large for a single QR code. Use the text share code instead.',
          'negative',
        );
        setQrCode('');
        setShowQR(false);
        return;
      }
      setQrCode(result);
      setShowQR(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not generate a QR code.', 'negative');
    } finally {
      setQrGenerating(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      notify('Share code copied to the clipboard.', 'positive');
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('Copy failed — select the code and copy it manually.', 'negative');
    }
  }

  async function handleCopyQR() {
    if (!qrCode) return;
    try {
      await navigator.clipboard.writeText(qrCode);
      notify('QR code text copied to the clipboard.', 'positive');
    } catch {
      notify('Copy failed — select the text and copy it manually.', 'negative');
    }
  }

  function handleExportPlainText() {
    if (selectedCount === 0) return;
    const selectedSet = selected;
    const selectedCardRows = (cards ?? []).filter((card) => selectedSet.has(card.deckId));
    if (selectedCardRows.length === 0) {
      notify('Selected decks have no cards to export.', 'negative');
      return;
    }
    const text = exportCardsSimple(selectedCardRows);
    setPlainText(text);
    setPlainTextCopied(false);
  }

  async function handleCopyPlainText() {
    try {
      await navigator.clipboard.writeText(plainText);
      setPlainTextCopied(true);
      notify('Copied to clipboard.', 'positive');
      if (plainTextCopyTimeoutRef.current) window.clearTimeout(plainTextCopyTimeoutRef.current);
      plainTextCopyTimeoutRef.current = window.setTimeout(() => setPlainTextCopied(false), 2000);
    } catch {
      notify('Copy failed — select the text and copy it manually.', 'negative');
    }
  }

  async function handleInspect() {
    const raw = input.trim();
    if (!raw) return;
    try {
      const payload = await decodeShare(raw);
      setPending({ summary: summariseShare(payload), raw });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Invalid share code.', 'negative');
    }
  }

  async function handleImport() {
    if (!pending) return;
    setImporting(true);
    try {
      const payload = await decodeShare(pending.raw);
      const { decks: d, cards: c } = await importSharePayload(payload);
      notify(
        `Added ${d} deck${d === 1 ? '' : 's'} and ${c} card${c === 1 ? '' : 's'}.`,
        'positive',
      );
      setPending(null);
      setInput('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Import failed — the code may be corrupted.', 'negative');
    } finally {
      setImporting(false);
    }
  }

  async function handleStartScan() {
    if (html5QrCodeRef.current) return;
    setScanError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!scannerRef.current) {
        setScanError('Scanner element not found.');
        setScanning(false);
        return;
      }
      const scanner = new Html5Qrcode(scannerRef.current.id);
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          // Stop scanning immediately on success
          try {
            await scanner.stop();
            await scanner.clear();
          } catch {
            // Ignore stop errors — scanner may already be stopped
          }
          html5QrCodeRef.current = null;
          setScanning(false);
          try {
            const payload = await decodeShare(decodedText);
            setPending({ summary: summariseShare(payload), raw: decodedText });
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Invalid QR code.', 'negative');
          }
        },
        () => {
          // QR code not found in this frame — silent, keep scanning
        },
      );
    } catch (err) {
      html5QrCodeRef.current = null;
      setScanError(err instanceof Error ? err.message : 'Could not start camera scanner.');
      setScanning(false);
    }
  }

  async function handleStopScan() {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        await html5QrCodeRef.current.clear();
      } catch {
        // Ignore stop errors — scanner may already be stopped
      }
      html5QrCodeRef.current = null;
    }
    setScanning(false);
    setScanError(null);
  }

  const allSelected = decks ? decks.length > 0 && selected.size === decks.length : false;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 * m, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-10 overflow-hidden rounded-2xl border border-line bg-surface p-6 md:p-8"
      >
        <div className="absolute inset-0 bg-dot-grid opacity-40" aria-hidden="true" />
        <div className="relative">
          <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">Collaborate</p>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">Share</h1>
          <p className="mt-3 max-w-prose text-sm text-ink-soft">
            Turn your decks into a single code to send to anyone, and rebuild decks from a
            code you have been given. Codes carry text material only; scheduling and review
            history stay private to each person.
          </p>
        </div>
      </motion.header>

      {/* Export */}
      <section className="mb-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <DownloadIcon width={18} height={18} className="text-accent" />
          <h2 className="font-display text-xl">Export decks</h2>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          Select one or more decks, then generate a code to copy and share. Images are not
          included in share codes because they make pasteable codes too large; use a full
          backup when you need to transfer images.
        </p>

        {!decks ? (
          <ShareSkeleton />
        ) : decks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 * m, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 py-16 text-center"
          >
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
              <CardsIcon width={22} height={22} />
            </div>
            <h3 className="mb-1 font-display text-xl">No decks yet</h3>
            <p className="max-w-sm text-sm text-ink-soft">
              Create a deck first, then come back here to share it with others.
            </p>
          </motion.div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              aria-pressed={allSelected}
              className="flex items-center gap-2 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              <span
                className={cn(
                  'grid h-5 w-5 place-items-center rounded-md border transition-colors',
                  allSelected
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line-strong',
                )}
              >
                {allSelected && <CheckIcon width={12} height={12} />}
              </span>
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
              <span className="text-sm text-ink-faint">
                {selectedCount} deck{selectedCount === 1 ? '' : 's'} · {selectedCards} card
                {selectedCards === 1 ? '' : 's'}
              </span>
            </div>                    <div className="flex flex-col gap-2">
              {decks.map((deck, index) => {
                const on = selected.has(deck.id);
                return (
                  <motion.button
                    key={deck.id}
                    type="button"
                    onClick={() => toggle(deck.id)}
                    aria-pressed={on}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 * m, delay: Math.min(index * 0.03, 0.15) * m }}
                    whileHover={{ y: -2, transition: { duration: 0.1 * m } }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-all duration-200',
                      on
                        ? 'border-accent bg-accent-soft/50 shadow-paper'
                        : 'border-line bg-surface hover:border-line-strong hover:shadow-md',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
                        on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
                      )}
                    >
                      <AnimatePresence>
                        {on && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            transition={{ type: 'spring', stiffness: 600, damping: 18 }}
                            className="inline-flex"
                          >
                            <CheckIcon width={13} height={13} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{deck.name}</span>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {cardCounts.get(deck.id) ?? 0} cards
                    </span>
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-5">
              {selectedHasImages && (
                <p className="mb-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm text-ink-soft">
                  One or more selected decks contains images. The share code will replace
                  them with placeholders; export a full backup from Settings to transfer
                  the images too.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={selectedCount === 0 || generating}
                >
                  <ShareIcon width={18} height={18} />
                  {generating ? 'Generating…' : 'Generate share code'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleGenerateQR}
                  disabled={selectedCount === 0 || qrGenerating}
                >
                  <QrCodeIcon width={18} height={18} />
                  {qrGenerating ? 'Generating…' : 'Generate QR code'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleExportPlainText}
                  disabled={selectedCount === 0 || selectedCards === 0}
                >
                  <FileTextIcon width={18} height={18} />
                  Export as plain text
                </Button>
              </div>
            </div>

            {/* Share code text area */}
            <AnimatePresence>
              {code && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-line-strong bg-surface-raised p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                        Your share code · {code.length.toLocaleString()} characters
                      </span>
                      <Button size="sm" variant="secondary" onClick={handleCopy}>
                        {copied ? (
                          <>
                            <CheckIcon width={14} height={14} />
                            Copied
                          </>
                        ) : (
                          'Copy'
                        )}
                      </Button>
                    </div>
                    <textarea
                      readOnly
                      value={code}
                      onFocus={(e) => e.currentTarget.select()}
                      rows={4}
                      className="w-full resize-none break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink-soft outline-none"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* QR code display */}
            <AnimatePresence>
              {showQR && qrCode && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-line-strong bg-surface-raised p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                        QR code · {qrCode.length.toLocaleString()} characters
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={handleCopyQR}>
                          Copy text
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowQR(false)}>
                          <CloseIcon width={14} height={14} />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                      <div className="rounded-xl border border-line bg-white p-4 dark:bg-white">
                        <QRCode
                          value={qrCode}
                          size={256}
                          level="L"
                          bgColor="#ffffff"
                          fgColor="#000000"
                        />
                      </div>
                      <p className="text-xs text-ink-faint">
                        This QR code uses a Base45-encoded share code for maximum density.
                        Any camera can scan it.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {plainText && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-line-strong bg-surface-raised p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                        Plain text export · {selectedCards.toLocaleString()} card{selectedCards === 1 ? '' : 's'}
                      </span>
                      <Button size="sm" variant="secondary" onClick={handleCopyPlainText}>
                        {plainTextCopied ? (
                          <>
                            <CheckIcon width={14} height={14} />
                            Copied
                          </>
                        ) : (
                          'Copy'
                        )}
                      </Button>
                    </div>
                    <textarea
                      readOnly
                      value={plainText}
                      onFocus={(e) => e.currentTarget.select()}
                      rows={6}
                      className="w-full resize-none break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink-soft outline-none"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </section>

      {/* Import */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <UploadIcon width={18} height={18} className="text-accent" />
          <h2 className="font-display text-xl">Import a shared deck</h2>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          Paste a share code below to add its decks to your own. This never overwrites your
          existing decks. Legacy codes (LAC0, LAC1) and new codes (LAC2, LAC3) are both supported.
        </p>

        <div className="rounded-xl border border-line-strong bg-surface px-4 py-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (pending) setPending(null);
            }}
            rows={4}
            placeholder="Paste a Lacuna share code here (it starts with LAC)..."
            className="w-full resize-none break-all bg-transparent font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-sm placeholder:text-ink-faint"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleInspect} disabled={!input.trim()}>
            Read code
          </Button>
          <Button
            variant="secondary"
            onClick={scanning ? handleStopScan : handleStartScan}
            disabled={!navigator.mediaDevices?.getUserMedia}
          >
            <CameraIcon width={18} height={18} />
            {scanning ? 'Stop scanning' : 'Scan QR code'}
          </Button>
        </div>

        {/* QR scanner */}
        <AnimatePresence>
          {scanning && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-line-strong bg-surface-raised p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                    QR scanner
                  </span>
                  <Button size="sm" variant="ghost" onClick={handleStopScan}>
                    <CloseIcon width={14} height={14} />
                  </Button>
                </div>
                <div
                  id="qr-scanner-container"
                  ref={scannerRef}
                  className="relative mx-auto aspect-square max-w-sm overflow-hidden rounded-lg bg-black"
                >
                  {!scanError && <div className="absolute inset-0 animate-pulse bg-ink/10" />}
                </div>
                {scanError && (
                  <p className="mt-2 text-sm text-negative">{scanError}</p>
                )}
                <p className="mt-2 text-xs text-ink-faint">
                  Point your camera at a Lacuna QR code. The scanner will auto-detect it.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pending && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-5">
                <h3 className="mb-2 font-display text-lg">Ready to import</h3>
                <p className="mb-3 text-sm text-ink-soft">
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
                        className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-soft"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
                {pending.summary.omittedImages && (
                  <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
                    This share code omitted images to keep the code small. Image positions
                    will appear as placeholders after import.
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleImport} disabled={importing}>
                    {importing ? 'Importing…' : 'Add to my decks'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function ShareSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
        >
          <div className="h-5 w-5 animate-pulse rounded-md bg-ink/10" />
          <div className="h-4 flex-1 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-16 animate-pulse rounded bg-ink/10" />
        </div>
      ))}
    </div>
  );
}
