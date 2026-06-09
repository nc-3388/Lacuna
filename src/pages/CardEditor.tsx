import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import { useCard, useCards, useDeck } from '../state/useData';
import { Button } from '../components/ui/Button';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';
import { TagInput } from '../components/ui/TagInput';
import { useToast } from '../components/ui/Toast';
import { createCard, createCardWithReverse, updateCard } from '../db/repository';
import { hasCloze } from '../components/markdown/cloze';
import { ChevronLeftIcon, CheckIcon } from '../components/ui/icons';
import { cn } from '../components/ui/cn';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import type { CardType } from '../db/types';

/**
 * Full-page card composer for both creating and editing a card. Replaces the old
 * cramped modal with a spacious editing surface: a roomy Markdown editor with a live
 * preview and a sticky action bar. The route shape (.../cards/new vs .../cards/:id/edit)
 * decides the mode.
 */
export function CardEditor() {
  const { deckId, cardId } = useParams<{ deckId: string; cardId?: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();

  const deck = useDeck(deckId);
  const editing = Boolean(cardId);
  const card = useCard(cardId);
  const deckCards = useCards(deckId);

  const [type, setType] = useState<CardType>('front_back');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [showBackCloze, setShowBackCloze] = useState(false);
  // When set (new front/back cards only), saving also creates an independent reverse card.
  const [alsoReverse, setAlsoReverse] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Re-arm the loaded latch whenever the card being edited changes so direct
  // navigation between cards (same route, different param) re-seeds the formotion.
  useEffect(() => {
    setLoaded(false);
  }, [cardId]);

  // Quick-capture bookkeeping: how many cards added without leaving the page, and a
  // remount key that refocuses the first field after each "Save & add another".
  const [addedCount, setAddedCount] = useState(0);
  const [formKey, setFormKey] = useState(0);

  // Refs that drive a seamless Tab order through the quick-capture flow:
  // Front → Back → Save & add another → Add card, skipping the toolbars and tag input.
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);
  const saveAddRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // Where Tab off the last text field should land: the "add another" button when it
  // exists (new cards), otherwise the primary save button.
  const focusSaveButton = () => (saveAddRef.current ?? saveRef.current)?.focus();

  // Brief "Saved" flourish shown in the action bar after each quick-capture save.
  const [showSaved, setShowSaved] = useState(false);
  const savedTimer = useRef<number>();
  const [shakeField, setShakeField] = useState<string | null>(null);
  const [shakeNonce, setShakeNonce] = useState(0);
  const shakeTimer = useRef<number>();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  function flashSaved() {
    window.clearTimeout(savedTimer.current);
    setShowSaved(true);
    savedTimer.current = window.setTimeout(() => setShowSaved(false), 1200);
  }
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  // Existing tags across the deck, offered as suggestions in the tag input.
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const c of deckCards ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [deckCards]);

  // Seed the form from the card being edited once it has loaded (new cards start blank).
  useEffect(() => {
    if (loaded) return;
    if (!editing) {
      setLoaded(true);
      return;
    }
    if (card) {
      setType(card.type);
      setFront(card.front);
      setBack(card.back);
      setTags(card.tags ?? []);
      setLoaded(true);
    }
  }, [editing, card, loaded]);

  const deckPath = `/deck/${deckId}`;

  if (deck === undefined || (editing && card === undefined && !loaded)) {
    return <CardEditorSkeleton />;
  }
  if (deck === null) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-10"
      >
        <p className="mb-4 text-ink-soft">This deck could not be found.</p>
        <Link to="/" className="text-accent underline">
          Back to dashboard
        </Link>
      </motion.div>
    );
  }
  if (editing && card === null) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-10"
      >
        <p className="mb-4 text-ink-soft">This card could not be found.</p>
        <Link to={deckPath} className="text-accent underline">
          Back to {deck.name}
        </Link>
      </motion.div>
    );
  }

  const isCloze = type === 'cloze';
  const clozeValid = !isCloze || hasCloze(front);
  const frontValid = front.trim().length > 0;
  const backValid = isCloze || back.trim().length > 0;
  const canSave = frontValid && backValid && clozeValid;

  async function handleSave(andAnother = false) {
    if (!canSave || !deckId) {
      // Shake the first invalid field to give the user tactile feedback on why save is blocked.
      if (!frontValid) setShakeField('front');
      else if (!backValid) setShakeField('back');
      else if (!clozeValid) setShakeField('cloze');
      setShakeNonce((n) => n + 1);
      window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => setShakeField(null), 500);
      return;
    }
    const backValue = isCloze ? '' : back;
    if (editing && card) {
      await updateCard(card.id, { type, front, back: backValue, tags });
      flashSaved();
      // Let the confirmation flourish play briefly before leaving the page.
      window.setTimeout(() => {
        notify('Card updated.', 'positive');
        navigate(deckPath);
      }, 450);
      return;
    }

    const reversed = !isCloze && alsoReverse;
    if (reversed) {
      await createCardWithReverse(deckId, front, backValue, tags);
    } else {
      await createCard(deckId, type, front, backValue, tags);
    }
    if (andAnother) {
      // Stay on the page for rapid entry: clear the content, keep the type and tags
      // (usually shared across a batch), refocus the first field, and tally the count.
      setFront('');
      setBack('');
      setAddedCount((n) => n + (reversed ? 2 : 1));
      setFormKey((k) => k + 1);
      flashSaved();
    } else {
      flashSaved();
      window.setTimeout(() => {
        notify(reversed ? 'Card and its reverse added.' : 'Card added.', 'positive');
        navigate(deckPath);
      }, 450);
    }
  }

  return (
    <div
      className="mx-auto max-w-4xl px-6 pb-10 pt-8 md:px-10"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          // In new-card mode, Cmd/Ctrl+Enter saves and keeps going for fast capture.
          void handleSave(!editing);
        }
      }}
    >
      {/* Breadcrumb */}
      <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-ink-faint">
        <Link to="/" className="transition-colors hover:text-ink">
          All decks
        </Link>
        <ChevronRight />
        <Link to={deckPath} className="transition-colors hover:text-ink">
          {deck.name}
        </Link>
        <ChevronRight />
        <span className="text-ink-soft">{editing ? 'Edit card' : 'New card'}</span>
      </nav>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="mb-8">
          <Link
            to={deckPath}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink"
          >
            <ChevronLeftIcon width={16} height={16} />
            Back
          </Link>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">
            {editing ? 'Edit card' : 'New card'}
          </h1>
        </header>

        <div className="flex flex-col gap-5">
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
              <div key={`front-shake-${shakeField === 'front' || shakeField === 'cloze' ? shakeNonce : 'stable'}`} className={cn(shakeField === 'front' || shakeField === 'cloze' ? 'shake-field' : '')}>
                <MarkdownEditor
                  key={`cloze-${formKey}`}
                  inputRef={frontRef}
                  autoFocus={!editing}
                  label="Text (use the Cloze button to hide answers)"
                  value={front}
                  onChange={setFront}
                  minRows={8}
                  allowCloze
                  clozePreview={showBackCloze ? 'back' : 'front'}
                  placeholder="The chemical symbol for water is {{c1::H2O}}."
                  onError={(m) => notify(m, 'negative')}
                  onTabForward={focusSaveButton}
                />
              </div>
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
              <div key={`front-shake-${shakeField === 'front' ? shakeNonce : 'stable'}`} className={cn(shakeField === 'front' ? 'shake-field' : '')}>
                <MarkdownEditor
                  key={`front-${formKey}`}
                  inputRef={frontRef}
                  autoFocus={!editing}
                  label="Front"
                  value={front}
                  onChange={setFront}
                  minRows={8}
                  placeholder="Question or prompt. Markdown, maths and images are supported."
                  onError={(m) => notify(m, 'negative')}
                  onTabForward={() => backRef.current?.focus()}
                />
              </div>
              <div key={`back-shake-${shakeField === 'back' ? shakeNonce : 'stable'}`} className={cn(shakeField === 'back' ? 'shake-field' : '')}>
                <MarkdownEditor
                  inputRef={backRef}
                  label="Back"
                  value={back}
                  onChange={setBack}
                  minRows={8}
                  placeholder="Answer. Markdown, maths and images are supported."
                  onError={(m) => notify(m, 'negative')}
                  onTabForward={focusSaveButton}
                  onTabBackward={() => frontRef.current?.focus()}
                />
              </div>
            </>
          )}

          {/* Tags */}
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-faint">
              Tags
            </div>
            <TagInput
              tags={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              placeholder="Add tags to group cards for filtered study…"
            />
          </div>
        </div>
      </motion.div>

      {/* Sticky action bar — fades into the page rather than sitting on a hard white slab.
          The wrapper ignores pointer events so the transparent fade never blocks the
          content scrolling beneath it; the button row re-enables themotion. */}
      <div className="pointer-events-none sticky bottom-0 z-30 -mx-6 mt-8 bg-gradient-to-t from-paper via-paper to-transparent px-6 pb-5 pt-12 md:-mx-10 md:px-10">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          {!editing && !isCloze && (
            <motion.button
              type="button"
              onClick={() => setAlsoReverse((v) => !v)}
              whileTap={{ scale: 0.96 }}
              aria-pressed={alsoReverse}
              title="Also create a card testing the back side"
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                alsoReverse
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-line-strong',
              )}
            >
              <span
                className={cn(
                  'grid h-4 w-4 place-items-center rounded-full border transition-colors',
                  alsoReverse
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line-strong',
                )}
              >
                <AnimatePresence>
                  {alsoReverse && (
                    <motion.span
                      initial={{ scale: 0, rotate: -25 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 16 }}
                      className="inline-flex"
                    >
                      <CheckIcon width={11} height={11} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              Also create reverse
            </motion.button>
          )}
          {!editing && addedCount > 0 && (
            <span className="text-sm text-ink-faint">
              {addedCount} card{addedCount === 1 ? '' : 's'} added this sitting
            </span>
          )}
          <AnimatePresence>
            {showSaved && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="inline-flex items-center gap-1.5 rounded-full bg-positive/15 px-3 py-1 text-sm font-medium text-positive"
              >
                <motion.span
                  initial={{ scale: 0, rotate: -25 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.06, type: 'spring', stiffness: 600, damping: 16 }}
                  className="inline-flex"
                >
                  <CheckIcon width={16} height={16} />
                </motion.span>
                Saved
              </motion.span>
            )}
          </AnimatePresence>
          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate(deckPath)}>
              {!editing && addedCount > 0 ? 'Done' : 'Cancel'}
            </Button>
            {!editing && (
              <Button
                ref={saveAddRef}
                variant="secondary"
                onClick={() => handleSave(true)}
                disabled={!canSave}
                title="Save and add another (Ctrl/Cmd+Enter)"
              >
                Save &amp; add another
              </Button>
            )}
            <Button
              ref={saveRef}
              variant="primary"
              onClick={() => handleSave(false)}
              disabled={!canSave}
            >
              {editing ? 'Save changes' : 'Add card'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardEditorSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-6 pb-10 pt-8 md:px-10">
      <div className="mb-6 h-4 w-24 animate-pulse rounded bg-ink/10" />
      <div className="mb-8">
        <div className="mb-3 h-4 w-16 animate-pulse rounded bg-ink/10" />
        <div className="h-10 w-48 animate-pulse rounded bg-ink/10" />
      </div>
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 h-3 w-20 animate-pulse rounded bg-ink/10" />
          <div className="flex gap-2">
            <div className="h-10 flex-1 animate-pulse rounded-lg bg-ink/10" />
            <div className="h-10 flex-1 animate-pulse rounded-lg bg-ink/10" />
          </div>
        </div>
        <div className="h-40 w-full animate-pulse rounded-lg bg-ink/10" />
        <div className="h-40 w-full animate-pulse rounded-lg bg-ink/10" />
        <div>
          <div className="mb-2 h-3 w-12 animate-pulse rounded bg-ink/10" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-ink/10" />
        </div>
      </div>
    </div>
  );
}

function ChevronRight() {
  return <span className="text-ink-faint/60">/</span>;
}
