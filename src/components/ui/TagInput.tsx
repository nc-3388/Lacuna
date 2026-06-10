import { useState, type KeyboardEvent } from 'react';
import { m as motion } from 'motion/react';
import { CloseIcon, TagIcon } from './icons';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Existing tags across the deck/collection, offered as quick suggestions. */
  suggestions?: string[];
  placeholder?: string;
}

/** Chip-style tag editor. Enter or comma commits a tag; Backspace on empty removes the last. */
export function TagInput({ tags, onChange, suggestions = [], placeholder }: TagInputProps) {
  const [draft, setDraft] = useState('');

  function addTag(raw: string) {
    const tag = raw.trim().replace(/,+$/, '').trim();
    if (!tag || tags.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...tags, tag]);
    setDraft('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  const available = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-2 focus-within:border-accent">
        <TagIcon width={15} height={15} className="text-ink-faint" />
        {tags.map((tag) => (
          <motion.span
            key={tag}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
              className="transition-opacity hover:opacity-70 active:opacity-70"
            >
              <CloseIcon width={11} height={11} />
            </button>
          </motion.span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => addTag(draft)}
          placeholder={tags.length === 0 ? (placeholder ?? 'Add tags…') : ''}
          className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.map((s) => (
            <motion.button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              whileTap={{ scale: 0.92 }}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent active:border-accent active:text-accent"
            >
              {s}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
