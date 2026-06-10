import { useEffect, useRef, useState, type DragEvent, type Ref } from 'react';
import { m as motion, AnimatePresence } from 'motion/react';
import { MarkdownView } from './MarkdownView';
import { imageFileToAssetUrl, imageMarkdown } from './image';
import { nextClozeIndex } from './cloze';
import { cn } from '../ui/cn';
import { ImageIcon } from '../ui/icons';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show a Cloze button (only meaningful for cloze cards). */
  allowCloze?: boolean;
  minRows?: number;
  label?: string;
  /** Cloze preview mode for the live preview pane. */
  clozePreview?: 'front' | 'back' | 'none';
  onError?: (message: string) => void;
  /** Focus the textarea on mount (used by the quick-capture flow). */
  autoFocus?: boolean;
  /** Forwarded handle on the textarea so parents can drive a custom tab order. */
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Tab (no shift) inside the textarea; preventDefault is applied for you. */
  onTabForward?: () => void;
  /** Shift+Tab inside the textarea; preventDefault is applied for you. */
  onTabBackward?: () => void;
}

type ToolbarAction = {
  label: string;
  title: string;
  apply: (sel: Selection) => Replacement;
};

interface Selection {
  before: string;
  selected: string;
  after: string;
  full: string;
}

interface Replacement {
  text: string;
  /** Caret/selection offsets within the new full text. */
  selStart: number;
  selEnd: number;
}

/** Wrap the selection with the given prefix/suffix, or insert a placeholder if empty. */
function wrap(sel: Selection, prefix: string, suffix: string, placeholder: string): Replacement {
  const inner = sel.selected || placeholder;
  const text = sel.before + prefix + inner + suffix + sel.after;
  const selStart = sel.before.length + prefix.length;
  return { text, selStart, selEnd: selStart + inner.length };
}

/** Insert a line-prefixed block (heading, list item) at the start of the selection's line. */
function linePrefix(sel: Selection, prefix: string, placeholder: string): Replacement {
  const inner = sel.selected || placeholder;
  const needsBreak = sel.before.length > 0 && !sel.before.endsWith('\n');
  const lead = needsBreak ? '\n' : '';
  const text = sel.before + lead + prefix + inner + sel.after;
  const selStart = sel.before.length + lead.length + prefix.length;
  return { text, selStart, selEnd: selStart + inner.length };
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  allowCloze = false,
  minRows = 6,
  label,
  clozePreview = 'none',
  onError,
  autoFocus = false,
  inputRef,
  onTabForward,
  onTabBackward,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the internal ref (used by the toolbar) while also forwarding to the parent.
  function setTextareaRef(el: HTMLTextAreaElement | null) {
    textareaRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mobileTab, setMobileTab] = useState<'write' | 'preview'>('write');
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  /* Undo/redo history */
  interface HistoryEntry {
    text: string;
    selStart: number;
    selEnd: number;
  }
  const historyRef = useRef<HistoryEntry[]>([{ text: value, selStart: 0, selEnd: 0 }]);
  const historyIndexRef = useRef(0);
  const historyTimerRef = useRef<number | null>(null);
  const lastPushedTextRef = useRef(value);
  const currentValueRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  useEffect(() => {
    // Reset history when the editor is mounted for a new card.
    historyRef.current = [{ text: value, selStart: 0, selEnd: 0 }];
    historyIndexRef.current = 0;
    lastPushedTextRef.current = value;
    currentValueRef.current = value;
    return () => {
      cancelHistoryTimer();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pushHistory() {
    const el = textareaRef.current;
    const entry: HistoryEntry = {
      text: currentValueRef.current,
      selStart: el?.selectionStart ?? 0,
      selEnd: el?.selectionEnd ?? 0,
    };
    // Avoid duplicate adjacent entries.
    if (lastPushedTextRef.current === entry.text) return;

    // Truncate any redo entries.
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    historyRef.current.push(entry);
    historyIndexRef.current = historyRef.current.length - 1;
    lastPushedTextRef.current = entry.text;

    // Cap at 50 entries.
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
      historyIndexRef.current--;
    }
  }

  function scheduleHistoryPush() {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => pushHistory(), 800);
  }

  function cancelHistoryTimer() {
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const entry = historyRef.current[historyIndexRef.current];
    lastPushedTextRef.current = entry.text;
    currentValueRef.current = entry.text;
    onChange(entry.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(entry.selStart, entry.selEnd);
    });
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    lastPushedTextRef.current = entry.text;
    currentValueRef.current = entry.text;
    onChange(entry.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(entry.selStart, entry.selEnd);
    });
  }

  function currentSelection(): Selection {
    const el = textareaRef.current!;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    return {
      before: value.slice(0, start),
      selected: value.slice(start, end),
      after: value.slice(end),
      full: value,
    };
  }

  function applyReplacement(rep: Replacement) {
    cancelHistoryTimer();
    pushHistory();
    currentValueRef.current = rep.text;
    onChange(rep.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(rep.selStart, rep.selEnd);
      pushHistory();
    });
  }

  function runAction(action: ToolbarAction) {
    if (!textareaRef.current) return;
    applyReplacement(action.apply(currentSelection()));
  }

  const actions: ToolbarAction[] = [
    { label: 'B', title: 'Bold', apply: (s) => wrap(s, '**', '**', 'bold text') },
    { label: 'I', title: 'Italic', apply: (s) => wrap(s, '_', '_', 'italic text') },
    { label: 'H', title: 'Heading', apply: (s) => linePrefix(s, '## ', 'Heading') },
    { label: '•', title: 'Bullet list', apply: (s) => linePrefix(s, '- ', 'List item') },
    { label: '1.', title: 'Numbered list', apply: (s) => linePrefix(s, '1. ', 'List item') },
    { label: '< >', title: 'Inline code', apply: (s) => wrap(s, '`', '`', 'code') },
    {
      label: '{ }',
      title: 'Code block',
      apply: (s) => wrap(s, '```\n', '\n```', 'code'),
    },
    { label: 'Link', title: 'Link', apply: (s) => wrap(s, '[', '](https://)', 'text') },
    { label: '$x$', title: 'Inline maths', apply: (s) => wrap(s, '$', '$', 'x^2') },
    {
      label: '$$',
      title: 'Block maths',
      apply: (s) => wrap(s, '$$\n', '\n$$', 'x = y'),
    },
  ];

  const clozeAction: ToolbarAction = {
    label: 'Cloze',
    title: 'Cloze deletion',
    apply: (s) => {
      const n = nextClozeIndex(s.full);
      return wrap(s, `{{c${n}::`, '}}', 'hidden');
    },
  };

  async function insertImageFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    cancelHistoryTimer();
    pushHistory();
    for (const file of images) {
      try {
        const dataUrl = await imageFileToAssetUrl(file);
        const sel = currentSelection();
        const md = imageMarkdown(dataUrl, file.name.replace(/\.[^.]+$/, ''));
        const needsBreak = sel.before.length > 0 && !sel.before.endsWith('\n');
        const insertion = (needsBreak ? '\n' : '') + md + '\n';
        const newText = sel.before + insertion + sel.after;
        currentValueRef.current = newText;
        onChange(newText);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Could not add that image.');
      }
    }
    // Capture the post-insertion state so redo works after undo.
    window.setTimeout(() => pushHistory(), 0);
  }

  async function handleDrop(e: DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) await insertImageFiles(e.dataTransfer.files);
  }

  const rows = Math.max(minRows, value.split('\n').length + 1);

  return (
    <div className="rounded-xl border border-line bg-surface">
      {label && (
        <div className="border-b border-line px-3 py-2 text-xs uppercase tracking-[0.14em] text-ink-faint">
          {label}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {actions.map((a) => (
          <button
            key={a.title}
            type="button"
            title={a.title}
            onClick={() => runAction(a)}
            className="min-h-11 min-w-11 rounded-md px-2 font-mono text-xs text-ink-soft transition-colors hover:bg-ink/5 hover:text-accent active:bg-ink/10"
          >
            {a.label}
          </button>
        ))}
        {allowCloze && (
          <button
            type="button"
            title={clozeAction.title}
            onClick={() => runAction(clozeAction)}
            className="min-h-11 rounded-md px-2 font-mono text-xs text-accent transition-colors hover:bg-accent-soft active:bg-accent-soft"
          >
            {clozeAction.label}
          </button>
        )}
        <button
          type="button"
          title="Insert image"
          onClick={() => fileInputRef.current?.click()}
          className="flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-ink/5 hover:text-accent active:bg-ink/10"
        >
          <ImageIcon width={15} height={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && insertImageFiles(e.target.files)}
        />

        {/* Mobile write/preview switch */}
        <div className="ml-auto flex gap-1 md:hidden">
          {(['write', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={cn(
                'min-h-11 rounded-md px-2 text-xs capitalize',
                mobileTab === tab ? 'bg-accent-soft text-accent' : 'text-ink-faint',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Split: editor + live preview (stacked/tabbed on mobile) */}
      <div className="grid md:grid-cols-2">
        <div className={cn('md:block', mobileTab === 'preview' && 'hidden')}>
          <textarea
            ref={setTextareaRef}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                  redo();
                } else {
                  undo();
                }
                return;
              }
              if (e.ctrlKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
                return;
              }
              if (e.key !== 'Tab') {
                scheduleHistoryPush();
                return;
              }
              if (e.shiftKey && onTabBackward) {
                e.preventDefault();
                onTabBackward();
              } else if (!e.shiftKey && onTabForward) {
                e.preventDefault();
                onTabForward();
              }
            }}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            placeholder={placeholder}
            rows={rows}
            spellCheck
            className={cn(
              'w-full resize-none bg-transparent px-4 py-3 font-mono text-sm leading-relaxed text-ink',
              'placeholder:text-ink-faint focus:outline-none',
              dragOver && 'ring-2 ring-inset ring-accent/60',
            )}
          />
        </div>
        <div
          className={cn(
            'min-h-[8rem] border-line px-4 py-3 md:border-l',
            mobileTab === 'write' && 'hidden md:block',
          )}
        >
          <AnimatePresence mode="sync">
            {value.trim() ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 * m }}
              >
                <MarkdownView source={value} clozeMode={clozePreview} />
              </motion.div>
            ) : (
              <motion.p
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 * m }}
                className="text-sm text-ink-faint"
              >
                Preview appears here.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
