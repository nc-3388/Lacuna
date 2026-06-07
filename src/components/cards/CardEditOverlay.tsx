import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { TagInput } from '../ui/TagInput';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { updateCard } from '../../db/repository';
import { hasCloze } from '../markdown/cloze';
import { cn } from '../ui/cn';
import { CloseIcon } from '../ui/icons';
import type { Card, CardType } from '../../db/types';

interface CardEditOverlayProps {
  card: Card;
  /** Existing tags across the deck, offered as suggestions in the tag input. */
  tagSuggestions?: string[];
  /** Called with the in-memory updated card once the change is persisted. */
  onSaved: (updated: Card) => void;
  onCancel: () => void;
}

/**
 * A focused, modal editor for a single existing card. Used to fix a card mid-review
 * without leaving the session: it reuses the same MarkdownEditor/TagInput surface as the
 * full-page composer but stays self-contained so the study screen keeps its place. The
 * overlay owns the keyboard while open, so typing never grades the card underneath.
 */
export function CardEditOverlay({
  card,
  tagSuggestions = [],
  onSaved,
  onCancel,
}: CardEditOverlayProps) {
  const { notify } = useToast();
  const trapRef = useFocusTrap(true);
  const [type, setType] = useState<CardType>(card.type);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [tags, setTags] = useState<string[]>(card.tags ?? []);
  const [showBackCloze, setShowBackCloze] = useState(false);
  const [saving, setSaving] = useState(false);

  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);

  const isCloze = type === 'cloze';
  const clozeValid = !isCloze || hasCloze(front);
  const frontValid = front.trim().length > 0;
  const backValid = isCloze || back.trim().length > 0;
  const canSave = frontValid && backValid && clozeValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const changes = { type, front, back: isCloze ? '' : back, tags };
    try {
      await updateCard(card.id, changes);
      onSaved({ ...card, ...changes });
    } catch (err) {
      setSaving(false);
      notify(err instanceof Error ? err.message : 'Could not save the card.', 'negative');
    }
  }

  return (
    <motion.div
      ref={trapRef}
      className="fixed inset-0 z-50 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Keep the session's keyboard handler inert while editing: it checks `editing`,
      // but stop bubbling here too so nothing behind the overlay reacts to typing.
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void handleSave();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Edit card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="relative z-10 m-auto flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line-strong bg-paper shadow-2xl shadow-black/20"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-xl">Edit card</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close editor"
            title="Close (Esc)"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
          {/* Card type selector */}
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-faint">
              Card type
            </div>
            <div className="flex gap-2">
              {(['front_back', 'cloze'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'flex-1 rounded-lg border px-4 py-2.5 text-sm transition-colors',
                    type === t
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink-soft hover:border-line-strong',
                  )}
                >
                  {t === 'front_back' ? 'Front / Back' : 'Cloze deletion'}
                </button>
              ))}
            </div>
          </div>

          {isCloze ? (
            <>
              <MarkdownEditor
                inputRef={frontRef}
                autoFocus
                label="Text (use the Cloze button to hide answers)"
                value={front}
                onChange={setFront}
                minRows={6}
                allowCloze
                clozePreview={showBackCloze ? 'back' : 'front'}
                placeholder="The chemical symbol for water is {{c1::H2O}}."
                onError={(m) => notify(m, 'negative')}
              />
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={showBackCloze}
                  onChange={(e) => setShowBackCloze(e.target.checked)}
                  className="accent-accent"
                />
                Preview revealed answer
              </label>
              {!clozeValid && front.trim().length > 0 && (
                <p className="text-sm text-negative">
                  Add at least one cloze deletion using the Cloze button, e.g.{' '}
                  <code className="font-mono">{'{{c1::answer}}'}</code>.
                </p>
              )}
            </>
          ) : (
            <>
              <MarkdownEditor
                inputRef={frontRef}
                autoFocus
                label="Front"
                value={front}
                onChange={setFront}
                minRows={6}
                placeholder="Question or prompt. Markdown, maths and images are supported."
                onError={(m) => notify(m, 'negative')}
                onTabForward={() => backRef.current?.focus()}
              />
              <MarkdownEditor
                inputRef={backRef}
                label="Back"
                value={back}
                onChange={setBack}
                minRows={6}
                placeholder="Answer. Markdown, maths and images are supported."
                onError={(m) => notify(m, 'negative')}
                onTabBackward={() => frontRef.current?.focus()}
              />
            </>
          )}

          {/* Tags */}
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-faint">Tags</div>
            <TagInput
              tags={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              placeholder="Add tags to group cards for filtered study…"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!canSave}
            title="Save (Ctrl/Cmd+Enter)"
          >
            Save changes
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
