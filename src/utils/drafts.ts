import type { CardType } from '../db/types';

const DRAFT_PREFIX = 'lacuna:draft';

export interface DraftData {
  front: string;
  back: string;
  tags: string[];
  type: CardType;
  alsoReverse?: boolean;
  timestamp: number;
}

export function draftKey(deckId: string, cardId: string | 'new' | 'session'): string {
  return `${DRAFT_PREFIX}:${deckId}:${cardId}`;
}

export function saveDraft(key: string, data: DraftData): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Silently fail if quota is exceeded.
  }
}

export function loadDraft(key: string): DraftData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  localStorage.removeItem(key);
}
