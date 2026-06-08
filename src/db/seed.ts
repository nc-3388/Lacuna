// First-run seed data: one small, deletable example deck so the app is never empty.

import { db, makeId } from './schema';
import type { Card, Deck } from './types';
import { emptyPerformance } from '../fsrs/grading';
import { defaultFsrsParameters, FSRS_VERSION } from '../fsrs/params';
import { defaultExamDate } from '../utils/datetime';
import { assetUrl, sha256Blob } from './assets';

const FLAG_KEY = 'lacuna-seeded';
let seeding = false;

function exampleCard(
  deckId: string,
  type: Card['type'],
  front: string,
  back: string,
  tags?: string[],
  /** Milliseconds offset from base time so every card has a distinct createdAt. */
  timeOffset = 0,
): Card {
  return {
    id: makeId(),
    deckId,
    type,
    front,
    back,
    stability: null,
    difficulty: null,
    lastReviewed: null,
    reps: 0,
    lapses: 0,
    state: 0,
    due: null,
    scheduledDays: 0,
    learningSteps: 0,
    history: [],
    tags: tags ?? [],
    createdAt: Date.now() + timeOffset,
    suspended: false,
    flagged: false,
    buriedUntil: null,
  };
}

/** Build an ImageAsset record from an inline SVG string without writing to the database yet. */
async function prepareSvgAsset(svg: string, width: number, height: number) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const hash = await sha256Blob(blob);
  return {
    record: {
      hash,
      blob,
      mimeType: 'image/svg+xml' as const,
      width,
      height,
      createdAt: Date.now(),
    },
    url: assetUrl(hash),
  };
}

const FORGETTING_CURVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">
  <line x1="30" y1="130" x2="300" y2="130" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <line x1="30" y1="130" x2="30" y2="20" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="16" y="25" font-size="10" fill="currentColor" opacity="0.6">R</text>
  <text x="16" y="135" font-size="10" fill="currentColor" opacity="0.6">t</text>
  <path d="M 30 30 Q 120 45 200 85 T 300 125" fill="none" stroke="currentColor" stroke-width="2" opacity="0.8"/>
  <line x1="30" y1="45" x2="300" y2="45" stroke="currentColor" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>
  <text x="305" y="40" font-size="9" fill="currentColor" opacity="0.6">0.90</text>
</svg>`;

const SAMPLE_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="10" y="20" width="180" height="80" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <circle cx="60" cy="55" r="14" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <polyline points="90,90 115,60 140,80 175,40" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
</svg>`;

/** Seed the example deck exactly once per browser, and only if the database is empty. */
export async function seedIfFirstRun(): Promise<void> {
  if (seeding) return;
  seeding = true;
  try {
    // Fast-path: if any deck already exists, skip seeding entirely.
    const existingDeckCount = await db.decks.count();
    if (existingDeckCount > 0) {
      // Best-effort sync of the localStorage flag so future starts are cheaper.
      try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
      return;
    }

    const createdAt = Date.now();
    const deck: Deck = {
      id: makeId(),
      name: 'Welcome to Lacuna',
      examDate: defaultExamDate(createdAt),
      createdAt,
      fsrsVersion: FSRS_VERSION,
      fsrsParameters: defaultFsrsParameters(),
      examObjective: 'expectedMarks',
      colour: '#0d9488',
      lastInteractedAt: createdAt,
    };

    const [fcAsset, sampleAsset] = await Promise.all([
      prepareSvgAsset(FORGETTING_CURVE_SVG, 320, 160),
      prepareSvgAsset(SAMPLE_IMAGE_SVG, 200, 120),
    ]);

    const cards: Card[] = [
      // Core concepts & rendering
      exampleCard(
        deck.id,
        'front_back',
        'What does the **forgetting curve** describe?',
        `How retrievability of a memory **decays over time** since the last review. Lacuna uses the FSRS-6 model:\n\n\`R(t, S) = (1 + factor·(t/S))^decay\`, where \`factor = 0.9^(1/decay) − 1\` and \`decay = −w20\`.\n\n![Forgetting curve](${fcAsset.url})`,
        ['fsrs', 'theory'],
        0,
      ),
      exampleCard(
        deck.id,
        'cloze',
        'The chemical symbol for water is {{c1::H2O}}.',
        '',
        ['chemistry', 'basics'],
        1,
      ),
      exampleCard(
        deck.id,
        'cloze',
        'In spaced repetition, the two state variables FSRS tracks are {{c1::stability::how long a memory lasts}} and {{c2::difficulty::how hard a card is}}.',
        '',
        ['fsrs', 'theory'],
        2,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Write the quadratic formula.',
        'For $ax^2 + bx + c = 0$:\n\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
        ['maths', 'formulae'],
        3,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What is the derivative of $e^x$ with respect to $x$?',
        '$$\\frac{d}{dx} e^x = e^x$$',
        ['maths', 'calculus'],
        4,
      ),

      // Scheduling philosophy
      exampleCard(
        deck.id,
        'front_back',
        'How does Lacuna differ from classic spaced repetition?',
        'Classic SRS asks "when is this card next due?" Lacuna asks "what will this card\'s retrievability be on the **exam date**?" Every review is chosen to maximise your predicted score on exam day, not merely to space intervals.',
        ['scheduling', 'philosophy'],
        5,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What are the two exam objectives a deck can use?',
        '1. **Expected marks** — maximise the mean predicted retrievability across all cards.\n2. **Secured topics** — maximise the fraction of cards whose predicted retrievability is at least 0.90.\n\nYou can switch between them in Deck Settings.',
        ['scheduling', 'objectives'],
        6,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What is Exam-eve cram mode?',
        'Within 48 hours of an exam, a deck can enter **cram mode**. It reorders study **weakest-first** — cards with the lowest predicted exam-day retrievability — to get as many topics over the line as possible before the deadline.',
        ['scheduling', 'cram'],
        7,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What happens after an exam date passes?',
        'The deck shows "Exam date passed" and offers three choices: **set a new exam date**, **archive** the deck (withdraw it from study while keeping the data), or **keep revising** against a rolling 7-day maintenance horizon.',
        ['scheduling', 'post-exam'],
        8,
      ),

      // Learn mode & grading
      exampleCard(
        deck.id,
        'front_back',
        'What happens when you press "Yes" with silent grading enabled?',
        'An **invisible timer** measures how long you took from revealing the answer to pressing Yes. Lacuna maps your speed to an FSRS grade: fast responses become **Easy**, average become **Good**, and slow become **Hard**. Only "No" maps directly to **Again**.',
        ['learn', 'grading'],
        9,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'How can you switch from silent to manual grading?',
        'Go to **Settings** and toggle **Manual four-point grading**. When enabled, Learn mode shows **Again / Hard / Good / Easy** buttons instead of Yes / No.',
        ['learn', 'grading'],
        10,
      ),
      exampleCard(
        deck.id,
        'cloze',
        'During a Learn session, press {{c1::Space}} or {{c2::Up}} to reveal the answer. Press {{c3::Y}}, {{c4::J}}, or {{c5::Right}} for Yes, and {{c6::N}} or {{c7::Left}} for No. Press {{c8::F}} for focus mode and {{c9::?}} for help.',
        '',
        ['learn', 'shortcuts'],
        11,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What actions can you take on a card during a study session?',
        'From the three-dot menu: **Edit** the card in-place, **Flag** it for later attention, **Bury** it until tomorrow, or **Suspend** it indefinitely. You can also **Undo** your last answer with **U**.',
        ['learn', 'actions'],
        12,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'How can you stay focused while studying?',
        'Toggle **Focus mode** with **F** to hide all chrome. You can also enable the **Pomodoro timer** in Learn mode, with customisable work and break durations to pace your sessions.',
        ['learn', 'focus'],
        13,
      ),

      // Data management
      exampleCard(
        deck.id,
        'front_back',
        'How can you find cards across all decks?',
        'Open **Search** from the sidebar or press **Ctrl+K** for the command palette. You can filter by **due**, **new**, **leech**, **flagged**, and **suspended** cards.',
        ['search', 'navigation'],
        14,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'How can you share a deck with someone else?',
        'Go to the **Share** page, select a deck, and generate a compact **share code**. It carries the deck content and settings, but not review history or images. The recipient pastes the code and imports it as a fresh deck.',
        ['share', 'export'],
        15,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'How is your data protected?',
        'Lacuna stores everything **locally** in your browser. Automatic **restore points** are taken daily. You can also **export** everything to a JSON file, or use **folder mirroring** (where supported) to write backups to disk.',
        ['backup', 'privacy'],
        16,
      ),

      // Advanced features
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: FSRS parameters can be personalised?',
        'Lacuna can **optimise** your deck\'s FSRS weights by training them on your own review history. This runs in a background Web Worker and only applies after you confirm an improvement in prediction accuracy.',
        ['optimisation', 'advanced'],
        17,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What is a leech card?',
        'A card with **8 or more lapses** is flagged as a **leech**. Lacuna surfaces it with a badge and a search filter, but it is never auto-suspended — you decide what to do with it.',
        ['leech', 'advanced'],
        18,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'What happens when you add tags to a card?',
        'Tags let you filter the card list in Deck view. The active tag also narrows the **study session** to only cards with that tag. Try selecting a tag and then pressing **Study**.',
        ['tags', 'organisation'],
        19,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Can you create a card that tests both directions?',
        'Yes. When creating a front/back card, enable **Also create reverse**. Lacuna will generate an independent second card with the front and back swapped, so you are tested on the relationship in both directions.',
        ['cards', 'editor'],
        20,
      ),

      // Did-you-know cards for minor features
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: failed cards are temporarily deferred?',
        'If you answer "No", the card enters a **cooldown** so it is not shown again immediately. This gives you a chance to see other cards before retrying it.',
        ['learn', 'cooldown'],
        21,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: the dashboard tracks your study streak?',
        'The dashboard shows your current **study streak** and a **review heatmap** — a calendar grid of how many cards you reviewed each day. It is a familiar sight for anyone arriving from Anki.',
        ['dashboard', 'stats'],
        22,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: you can import cards from a spreadsheet?',
        'Go to a deck and choose **Import**. Lacuna accepts **CSV** or **TSV** files (and Anki\'s plain-text export) with front, back, and optional tags. Cloze notation in a single column is recognised automatically.',
        ['import', 'data'],
        23,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: cards can include images?',
        `Paste or drag an image into the editor and it is stored as a binary asset, referenced in Markdown as \`lacuna-asset://<hash>\`. Identical images are deduplicated by hash so they are only stored once.\n\n![Sample embedded image](${sampleAsset.url})`,
        ['images', 'editor'],
        24,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: the interface is fully themeable?',
        'In **Settings** you can switch between light and dark mode, pick from **seven accent colours**, and adjust the **text size** in steps. Your choices persist across sessions.',
        ['appearance', 'customisation'],
        25,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: you can cap new cards per day?',
        'In **Deck Settings**, set a **new cards per day** cap to ration brand-new material. The dashboard denominator stays honest while your daily session paces itself.',
        ['settings', 'scheduling'],
        26,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: target retention is adjustable?',
        'The **target retention** slider in Deck Settings lets you choose between **0.80** (relaxed) and **0.97** (thorough). A higher value means more reviews but stronger memories on exam day.',
        ['settings', 'fsrs'],
        27,
      ),
      exampleCard(
        deck.id,
        'front_back',
        'Did you know: Lacuna requests persistent storage?',
        'On first run the app asks the browser for **persistent storage** so your data is not silently evicted. Check the result in **Settings**; if denied, regular exports or folder mirroring are your safeguard.',
        ['settings', 'privacy'],
        28,
      ),
    ];

    await db.transaction('rw', db.decks, db.cards, db.userPerformance, db.assets, async () => {
      const deckCount = await db.decks.count();
      if (deckCount > 0) return;
      await db.decks.add(deck);
      await db.cards.bulkAdd(cards);
      await db.userPerformance.add(emptyPerformance(deck.id));
      await db.assets.bulkAdd([fcAsset.record, sampleAsset.record]);
    });

    // Only set the flag after a successful commit so a failed seed is retried.
    try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
  } finally {
    seeding = false;
  }
}
