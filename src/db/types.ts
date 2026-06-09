// Shared domain types for Lacuna's local data model.
// All persistence is via IndexedDB (see schema.ts). British English throughout.

export type CardType = 'front_back' | 'cloze';

/** FSRS grade: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. Matches ts-fsrs `Grade`. */
export type Grade = 1 | 2 | 3 | 4;

/**
 * FSRS memory state, mirroring ts-fsrs `State`:
 * 0 = New, 1 = Learning, 2 = Review, 3 = Relearning.
 */
export type FsrsCardState = 0 | 1 | 2 | 3;

/**
 * The trainable FSRS-6 parameter set persisted per deck. `w` holds the 21
 * FSRS-6 weights (w0..w20); w20 is the trainable decay. `requestRetention` is
 * the target retention ts-fsrs uses when scheduling.
 */
export interface FsrsParameters {
  w: number[];
  requestRetention: number;
}

/**
 * Which quantity the deck is being optimised for. The scheduler's sort metric
 * and the progress bar are always derived from this single value so they can
 * never disagree (see src/fsrs/objective.ts).
 *
 * - `expectedMarks`: maximise the sum of predicted exam-day retrievability.
 *   Scheduler sorts by Delta-R; progress bar shows mean predicted R.
 * - `securedTopics`: maximise the count of cards at or above 0.90 on exam day.
 *   Scheduler prioritises cards that cross the threshold, cheapest first;
 *   progress bar shows the fraction of cards at or above 0.90.
 */
export type ExamObjective = 'expectedMarks' | 'securedTopics';

/** A single review event appended to a card's history. */
export interface ReviewLog {
  timestamp: number;
  grade: Grade;
  /** Measured response time in seconds (time from reveal to "Show Answer"). */
  responseTimeSec: number;
  /** Whether the user lost focus while the answer was pending (report only; no grade effect). */
  distracted: boolean;
  stabilityBefore: number | null;
  stabilityAfter: number;
  difficultyBefore: number | null;
  difficultyAfter: number;
  /** Retrievability at the moment of review (null on a first review). */
  retrievabilityAtReview: number | null;
}

/** Predefined deck colours for visual identification. */
export const DECK_COLOURS = [
  { key: 'slate',   label: 'Slate',   hex: '#64748b' },
  { key: 'rose',    label: 'Rose',    hex: '#e11d48' },
  { key: 'amber',   label: 'Amber',   hex: '#d97706' },
  { key: 'emerald', label: 'Emerald', hex: '#059669' },
  { key: 'sky',     label: 'Sky',     hex: '#0284c7' },
  { key: 'violet',  label: 'Violet',  hex: '#7c3aed' },
  { key: 'coral',   label: 'Coral',   hex: '#ea580c' },
  { key: 'teal',    label: 'Teal',    hex: '#0d9488' },
] as const;

export interface Deck {
  id: string;
  name: string;
  /** Exam date/time as an epoch millisecond value. Defaults to creation + 7 days at 23:59 local. */
  examDate: number;
  createdAt: number;
  /** Set true once the user has set or dismissed the exam-date prompt with "don't ask again". */
  examDatePromptDismissed?: boolean;
  /** FSRS algorithm version this deck's parameters belong to (6 for FSRS-6). */
  fsrsVersion: number;
  /** The FSRS-6 parameter set used for every memory-state update in this deck. */
  fsrsParameters: FsrsParameters;
  /** The optimisation target shared by the scheduler and the progress bar. */
  examObjective: ExamObjective;
  /**
   * Maximum number of brand-new cards to introduce per day during study.
   * Undefined or 0 means unlimited (the default; preserves prior behaviour).
   */
  newCardsPerDay?: number;
  /**
   * Maximum number of reviews (including re-reviews) to serve per day for this deck.
   * Undefined or 0 means unlimited (the default).
   */
  maxReviewsPerDay?: number;
  /**
   * When true the deck is archived: retained in full but hidden from active study,
   * the global "Today" session and the dashboard's study denominators. Used as one
   * of the explicit choices once an exam date has passed.
   */
  archived?: boolean;
  /**
   * Per-deck override for automatic FSRS parameter optimisation. When undefined the
   * global default applies; false opts this deck out even when the global default is on.
   */
  autoOptimise?: boolean;
  /** Optional deck colour used for visual identification in the dashboard and sidebar. */
  colour?: string;
  /** Epoch ms of the most recent review (or deck creation), for dashboard priority. */
  lastInteractedAt?: number;
}

export interface Card {
  id: string;
  deckId: string;
  type: CardType;
  /** Markdown source. For cloze cards this contains the {{cN::...}} notation. */
  front: string;
  /** Markdown source for the answer side. Unused (empty) for cloze cards. */
  back: string;
  /** FSRS stability in days (interval at which R = 0.90). Null until first review. */
  stability: number | null;
  /** FSRS difficulty in [1, 10]. Null until first review. */
  difficulty: number | null;
  /** Epoch ms of the last review (= ts-fsrs `last_review`). Null until first review. */
  lastReviewed: number | null;
  /** Number of reviews so far (= ts-fsrs `reps`). */
  reps: number;
  /** Number of lapses (failed reviews) so far (= ts-fsrs `lapses`). */
  lapses: number;
  /** Current FSRS memory state (= ts-fsrs `state`). */
  state: FsrsCardState;
  /** Free-text tags for organising and filtered study. Optional; defaults to []. */
  tags?: string[];
  /** When true the card is withheld from all study and from progress/objective. */
  suspended?: boolean;
  /** User-set marker for quick filtering and follow-up. Optional; defaults to false. */
  flagged?: boolean;
  /** Epoch ms until which the card is buried (skipped). null/absent when not buried. */
  buriedUntil?: number | null;
  /** Epoch ms of the next scheduled review (= ts-fsrs `due`). Null until first review. */
  due: number | null;
  /** Days ts-fsrs last scheduled this card for (= ts-fsrs `scheduled_days`). */
  scheduledDays: number;
  /** Current position within the (re)learning steps (= ts-fsrs `learning_steps`). */
  learningSteps: number;
  history: ReviewLog[];
  createdAt: number;
}

/** A snapshot of a deck's predicted exam-day retrievability, written per answered card. */
export interface SessionHistoryEntry {
  id?: number;
  timestamp: number;
  deckId: string;
  averagePredictedRetrievability: number;
}

/** Per-deck calibration profile for the invisible rating engine (Welford online stats). */
export interface UserPerformance {
  deckId: string;
  runningMeanResponseTime: number;
  /** Running standard deviation (derived from the M2 aggregate). */
  runningStdDevResponseTime: number;
  /** Welford aggregate of squared distances from the mean. */
  m2: number;
  totalCorrectReviews: number;
}

/** Binary image asset stored separately from card Markdown and deduplicated by hash. */
export interface ImageAsset {
  hash: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
}

/** JSON-safe form of an ImageAsset for backups and exports. */
export interface BackupAsset {
  hash: string;
  data: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
}

/** A timestamped automatic snapshot of the whole database, kept as a restore point. */
export interface BackupSnapshot {
  id?: number;
  createdAt: number;
  /**
   * Optional marker. 'pre-migration' snapshots are taken automatically before a
   * schema upgrade and are exempt from the normal daily-snapshot pruning, so a
   * botched migration always has a restore point to fall back to.
   */
  tag?: 'pre-migration';
  /** Denormalised counts so the restore-point list can be shown without parsing the payload. */
  deckCount: number;
  cardCount: number;
  /** The full backup payload, identical in shape to a manual export. */
  payload: BackupFile;
}

/** Generic key/value store for small persistent app state (e.g. the backup folder handle). */
export interface AppStateEntry {
  key: string;
  value: unknown;
}

/** Shape of an exported/imported backup file. */
export interface BackupFile {
  app: 'lacuna';
  version: number;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  assets: BackupAsset[];
  sessionHistory: SessionHistoryEntry[];
  userPerformance: UserPerformance[];
}
