import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '../ui/Button';
import { UploadIcon } from '../ui/icons';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import {
  DEFAULT_FIELD_SEPARATOR,
  DEFAULT_ROW_SEPARATOR,
  parseImport,
  type ParsedCard,
} from '../../db/import';

interface ImportPanelProps {
  /** Called with the parsed cards when the user confirms. May be async. */
  onImport: (cards: ParsedCard[]) => void | Promise<void>;
  onCancel?: () => void;
  /** Label for the confirm button, e.g. "Add cards" or "Create & import". */
  importLabel?: string;
}

/** Named separator presets so common choices need no typing. `null` value = custom. */
const FIELD_PRESETS: { label: string; value: string | null }[] = [
  { label: 'Tab', value: '\t' },
  { label: 'Comma', value: ',' },
  { label: 'Semicolon', value: ';' },
  { label: 'Custom', value: null },
];

const ROW_PRESETS: { label: string; value: string | null }[] = [
  { label: 'New line', value: '\n' },
  { label: 'Blank line', value: '\n\n' },
  { label: 'Custom', value: null },
];

/**
 * Self-contained UI for importing cards from pasted text or a file. The caller decides
 * what to do with the parsed cards (create a new deck, or append to the current one)
 * via `onImport`. Field and row separators default to tab and newline, both editable.
 */
export function ImportPanel({ onImport, onCancel, importLabel = 'Import cards' }: ImportPanelProps) {
  const [text, setText] = useState('');
  const [fieldSep, setFieldSep] = useState<string>(DEFAULT_FIELD_SEPARATOR);
  const [rowSep, setRowSep] = useState<string>(DEFAULT_ROW_SEPARATOR);
  const [fieldCustom, setFieldCustom] = useState(false);
  const [rowCustom, setRowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  const result = useMemo(
    () => parseImport(text, fieldSep, rowSep),
    [text, fieldSep, rowSep],
  );

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setText(content);
    // A .csv almost always uses commas between fields; switch to match.
    if (/\.csv$/i.test(file.name)) {
      setFieldSep(',');
      setFieldCustom(false);
    }
  }

  async function handleImport() {
    if (result.cards.length === 0) return;
    setBusy(true);
    try {
      await onImport(result.cards);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm text-ink-soft">Paste your cards</label>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
            <UploadIcon width={15} height={15} />
            Upload file
          </Button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={`Question${fieldSep === '\t' ? '\\t' : fieldSep}Answer (one card per line)`}
          className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <p className="mt-1.5 text-xs text-ink-faint">
          One card per row: first column front, second back, an optional third column of
          space-separated tags. A single column containing{' '}
          <code className="font-mono">{'{{c1::…}}'}</code> becomes a cloze card. Wrap a field
          in double quotes to include the separator or line breaks inside it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SeparatorChooser
          title="Between front and back"
          presets={FIELD_PRESETS}
          value={fieldSep}
          custom={fieldCustom}
          onPreset={(v) => {
            setFieldCustom(false);
            setFieldSep(v);
          }}
          onCustom={() => {
            setFieldCustom(true);
            setFieldSep('');
          }}
          onCustomChange={setFieldSep}
        />
        <SeparatorChooser
          title="Between cards"
          presets={ROW_PRESETS}
          value={rowSep}
          custom={rowCustom}
          onPreset={(v) => {
            setRowCustom(false);
            setRowSep(v);
          }}
          onCustom={() => {
            setRowCustom(true);
            setRowSep('');
          }}
          onCustomChange={setRowSep}
        />
      </div>

      {/* Live preview */}
      <AnimatePresence mode="wait">
        {text.trim() && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.16 * m, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden rounded-lg border border-line bg-surface-raised/40 p-3"
          >
            <div className="mb-2 text-xs text-ink-soft">
              {result.cards.length} card{result.cards.length === 1 ? '' : 's'} ready
              {result.skipped > 0 && (
                <span className="text-ink-faint"> · {result.skipped} row{result.skipped === 1 ? '' : 's'} skipped</span>
              )}
            </div>
            {result.cards.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                <AnimatePresence>
                  {result.cards.slice(0, 4).map((c, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ duration: 0.16 * m, delay: i * 0.04 * m }}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                        {c.type === 'cloze' ? 'Cloze' : 'F/B'}
                      </span>
                      <span className="truncate text-ink">{c.front}</span>
                      {c.back && <span className="truncate text-ink-faint">— {c.back}</span>}
                    </motion.li>
                  ))}
                </AnimatePresence>
                {result.cards.length > 4 && (
                  <li className="text-xs text-ink-faint">
                    …and {result.cards.length - 4} more
                  </li>
                )}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={busy || result.cards.length === 0}
        >
          {busy ? 'Importing…' : `${importLabel} (${result.cards.length})`}
        </Button>
      </div>
    </div>
  );
}

function SeparatorChooser({
  title,
  presets,
  value,
  custom,
  onPreset,
  onCustom,
  onCustomChange,
}: {
  title: string;
  presets: { label: string; value: string | null }[];
  value: string;
  custom: boolean;
  onPreset: (value: string) => void;
  onCustom: () => void;
  onCustomChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-[0.14em] text-ink-faint">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = p.value === null ? custom : !custom && p.value === value;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => (p.value === null ? onCustom() : onPreset(p.value))}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                active
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-line-strong',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {custom && (
        <input
          autoFocus
          value={value}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="Separator character(s)"
          className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
        />
      )}
    </div>
  );
}
