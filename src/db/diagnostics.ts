// Diagnostic bundles for error reporting.
//
// Lacuna is local-first with no telemetry by design, so when the app breaks for a
// user there is no signal and bug reports are unactionable. The error boundaries
// offer a one-click "copy" / "download" of a diagnostic bundle the user can paste
// into a report. Everything stays on the device: nothing here transmits anywhere.
//
// Card content is never included by default. The bundle carries only counts and
// non-sensitive app state; including a content sample is a separate, explicit
// opt-in (see gatherContentSample).

import { db } from './schema';

/** Build-time application version, injected by Vite (see vite.config.ts). */
declare const __APP_VERSION__: string;
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export interface DiagnosticBundle {
  app: 'lacuna';
  version: string;
  capturedAt: number;
  /** Where the boundary that caught the error sits. */
  location: string;
  error: { name: string; message: string; stack: string | null };
  /** React component stack, when the boundary provides one. */
  componentStack: string | null;
  environment: { userAgent: string; language: string; platform: string };
  data: { decks: number; cards: number; reviews: number; backups: number };
  /** Present only when the user explicitly opts in to including card content. */
  contentSample?: { front: string; back: string }[];
}

export interface DiagnosticInput {
  location: string;
  error: { name?: string; message?: string; stack?: string | null };
  componentStack?: string | null;
  counts: { decks: number; cards: number; reviews: number; backups: number };
  contentSample?: { front: string; back: string }[];
  userAgent?: string;
  language?: string;
  platform?: string;
  now?: number;
}

/** Assemble a diagnostic bundle from the gathered pieces. Pure and deterministic. */
export function buildDiagnostics(input: DiagnosticInput): DiagnosticBundle {
  const bundle: DiagnosticBundle = {
    app: 'lacuna',
    version: APP_VERSION,
    capturedAt: input.now ?? Date.now(),
    location: input.location,
    error: {
      name: input.error.name ?? 'Error',
      message: input.error.message ?? 'Unknown error',
      stack: input.error.stack ?? null,
    },
    componentStack: input.componentStack ?? null,
    environment: {
      userAgent: input.userAgent ?? '',
      language: input.language ?? '',
      platform: input.platform ?? '',
    },
    data: input.counts,
  };
  if (input.contentSample) bundle.contentSample = input.contentSample;
  return bundle;
}

/** Render a bundle as readable plain text for the clipboard. */
export function formatDiagnostics(bundle: DiagnosticBundle): string {
  const lines = [
    `Lacuna diagnostic bundle`,
    `Captured: ${new Date(bundle.capturedAt).toISOString()}`,
    `Version: ${bundle.version}`,
    `Location: ${bundle.location}`,
    ``,
    `Error: ${bundle.error.name}: ${bundle.error.message}`,
    `Stack:`,
    bundle.error.stack ?? '(none)',
    ``,
    `Component stack:`,
    bundle.componentStack ?? '(none)',
    ``,
    `Environment:`,
    `  User agent: ${bundle.environment.userAgent}`,
    `  Language: ${bundle.environment.language}`,
    `  Platform: ${bundle.environment.platform}`,
    ``,
    `Data: ${bundle.data.decks} decks, ${bundle.data.cards} cards, ` +
      `${bundle.data.reviews} reviews, ${bundle.data.backups} restore points`,
  ];
  if (bundle.contentSample) {
    lines.push('', `Card content sample (opt-in): ${bundle.contentSample.length} cards`);
  }
  return lines.join('\n');
}

/** Read non-sensitive record counts from the database for a bundle. */
export async function gatherCounts(): Promise<DiagnosticBundle['data']> {
  const [decks, cards, backups, reviews] = await Promise.all([
    db.decks.count(),
    db.cards.count(),
    db.backups.count(),
    db.sessionHistory.count(),
  ]);
  return { decks, cards, reviews, backups };
}

/** Read a small sample of card content. Only called when the user opts in. */
export async function gatherContentSample(
  limit = 5,
): Promise<{ front: string; back: string }[]> {
  const cards = await db.cards.limit(limit).toArray();
  return cards.map((c) => ({ front: c.front, back: c.back }));
}
