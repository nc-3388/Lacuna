# Lacuna — Specification

Lacuna is a local-only, exam-driven spaced-revision web application built on FSRS-6. Every
card in a deck is scheduled to peak in recall on the deck's exam day, and a single
"objective" setting binds the scheduler and the progress bar to the same goal so they can
never disagree. All data lives in the browser (IndexedDB); there is no server, no account
and no network dependency.

British English throughout. No emojis anywhere in the product or its copy.

---

## 1. Guiding principles

1. **Exam-day, not interval-day.** Classic spaced repetition asks "when is this card next
   due?". Lacuna instead asks "what will this card's retrievability be on the exam date, and
   how much does reviewing it now improve that?". Scheduling is a forward simulation to a
   fixed deadline, not an open-ended interval ladder.
2. **One objective, one source of truth.** A deck's `examObjective` drives both the order in
   which cards are served and the number the progress bar shows. They are derived from the
   same module (`src/fsrs/objective.ts`) so they are guaranteed consistent — the core
   invariant of the app.
3. **Invisible grading (with an opt-out).** By default the learner only ever presses "Yes" or
   "No"; the four-point FSRS grade is inferred from correctness plus response time, calibrated
   per deck. The inference is measurable, not assumed — a per-deck calibration metric scores
   predicted vs actual recall (§14). A Settings toggle switches to manual four-point grading
   (Again/Hard/Good/Easy with keyboard shortcuts) for users who prefer to grade themselves.
4. **Local and private.** Everything is stored on-device. Export, import, automatic restore
   points and optional folder mirroring are the backup story; nothing leaves the machine
   unless the user exports it.
5. **Quiet, tactile craft.** A restrained "quiet laboratory" aesthetic with one warm accent,
   paper grain, and motion used to confirm and delight rather than decorate.

---

## 2. Technology stack

- **Build / framework:** Vite 6 + React 18 + TypeScript (strict). SWC React plugin.
- **Styling:** Tailwind CSS v4 (class-based dark mode via `@custom-variant dark`), CSS custom
  properties for the palette, surfaced to Tailwind through `@theme inline`.
- **Routing:** React Router v6, **hash** history (`createHashRouter`) so the app deploys as
  plain static files with no server rewrites.
- **Persistence:** Dexie (IndexedDB) with `dexie-react-hooks` (`useLiveQuery`) for reactive
  reads.
- **Scheduling maths:** the official `ts-fsrs` package (FSRS-6). No hand-rolled memory maths.
- **Parameter training:** `@open-spaced-repetition/binding` (fsrs-rs via WASM in a Web Worker) for
  fitting FSRS weights to review history.
- **Motion:** the `motion` library (`motion/react`).
- **Markdown / maths / code:** `react-markdown` + `remark-gfm` + `remark-math` +
  `rehype-katex` + `rehype-highlight` + `rehype-raw`. KaTeX and highlight.js styles imported
  globally.
- **Charts:** Recharts.
- **Fonts (loaded via `<link>` in `index.html`):** Fraunces (display), Geist (body),
  JetBrains Mono (code and the timer/tabular figures).
- **Testing:** Vitest with `fake-indexeddb` for the data and FSRS layers.

Scripts: `dev`/`start` (Vite), `build` (`tsc -b && vite build`), `typecheck`, `test`,
`test:watch`. Heavy routes (Deck view, Learn, Card editor, Deck settings) are lazy-loaded as
separate chunks; the dashboard, settings and search are eager.

---

## 3. Visual design system

### 3.1 Palette ("quiet laboratory")

Defined as raw HSL triples in `:root` and overridden under `.dark`, then exposed as Tailwind
colours (`bg-surface`, `text-ink`, `border-line`, `text-accent`, …).

- **Light:** warm off-white paper (`--paper`), near-white surfaces, dark warm ink. Subtle.
- **Dark (default):** near-black charcoal paper, charcoal surfaces, warm off-white ink.
- **Accent triad:** `--accent`, `--accent-soft`, `--accent-ink`, `--accent-fg`. The default
  is amber; the user may pick **red, rose, pink, violet, blue, teal or green**. Selecting one
  sets `data-accent` on the root and overrides just the accent triad, with separate light and
  dark recipes so each accent reads correctly in both themes.
- **Semantic:** `--positive` (green) and `--negative` (red) for success/failure states.
- **Atmosphere:** the body carries a faint radial-dot paper grain (`--grain-opacity`,
  stronger in dark mode) rather than a flat fill; theme-aware thin scrollbars; accent-tinted
  text selection.

### 3.2 Typography

- **Display (`font-display`, Fraunces):** all headings (`h1`–`h4`), weight 500, slight
  negative letter-spacing. Page titles are `text-4xl`/`text-5xl`.
- **Body (`font-body`, Geist):** all running text, weight 400.
- **Mono (`font-mono`, JetBrains Mono):** code, and `.tabular` numerals (progress %, stats,
  streak, timers) via `font-variant-numeric: tabular-nums`.
- Eyebrow labels are small uppercase with wide tracking (`tracking-[0.18em]`,
  `text-ink-faint`).
- A global font-scale control multiplies all text (see §15).

### 3.3 Motion language

Motion is consistently used to **confirm actions and orient the user**, never gratuitously.
A `prefers-reduced-motion: reduce` media query collapses all animation and transition
durations to ~0 globally, so every effect below degrades gracefully.

Shared conventions:
- Standard easing curve `[0.16, 1, 0.3, 1]` (a soft "ease-out-quint") for entrances.
- Springs for tactile controls and shared-layout indicators.
- Staggered list/grid reveals with a small per-item delay, capped so long lists do not crawl.

Specific motion (current state of the app):
- **Page transitions:** the routed page fades and lifts in (`y: 12 → 0`) as the previous one
  settles out (`y: 0 → −8`) via `AnimatePresence mode="wait"` keyed on the pathname; the main
  scroll area resets to the top on every navigation (`AppShell`).
- **Buttons (`Button`):** spring `whileHover` scale 1.02 and `whileTap` scale 0.96.
- **Progress bar (`ProgressBar`):** the fill animates to its new width on a spring; a slow,
  looping sheen sweeps across any non-empty bar for a sense of depth.
- **Sidebar:** width animates on collapse/expand (spring); the active-item marker is a
  shared-layout element (`layoutId="nav-active"`) that slides between items; items nudge
  right slightly on hover.
- **Deck cards:** staggered entrance, plus a `whileHover` lift (`y: −4`) with a smooth
  shadow/border transition.
- **Learn answer feedback:** the instant a card is graded, a soft full-width glow rises from
  the foot of the screen — green for correct, muted red for incorrect — for ~0.5 s. It is
  purely decorative (`pointer-events-none`), fired independently of the async write so the
  reward always lands on the keypress, and never delays the next card.
- **Flip card:** the question/answer faces swap with a 3-D `rotateX` flip (perspective 1600).
- **Session report:** the whole panel rises in; reaching the goal springs in a tick badge;
  the four stat tiles reveal in sequence.
- **Tabs / chips:** the active deck-view tab underline is a shared-layout element
  (`layoutId="deck-tab"`).
- **Toasts:** slide in from the right with a slight scale.
- **Dashboard streak:** the flame icon gently pulses/rotates while a streak is alight; the
  streak number springs when it changes.
- **Mobile drawer:** scrim fade plus a spring slide-in of the sidebar.
- **Splash / route fallback:** the initial "Lacuna" wordmark fades up and breathes while the
  database opens; lazy routes show a pulsing "Loading…".

### 3.4 Layout grid & surfaces

- Content is centred in a max-width column per page (dashboard `max-w-6xl`, deck `max-w-5xl`,
  editor `max-w-4xl`, learn/report/search `max-w-3xl`, settings/deck-settings `max-w-2xl`)
  with responsive horizontal padding (`px-6 md:px-10`).
- Cards/sections: `rounded-2xl border border-line bg-surface p-5/6`, soft black shadows on
  hover.
- Pills/chips: `rounded-full border` with accent-soft active state.
- Sticky action bars (editor, deck settings) pin to the bottom of the content column; the
  editor's bar fades up from the paper via a gradient so it never sits on a hard slab.

---

## 4. App layout & navigation

### 4.1 Shell

Routes are nested under `AppShell` (`/`), except the full-screen Learn experience which lives
outside the shell. The shell is a flex row:

```
┌───────────────┬─────────────────────────────────────────────┐
│  SIDEBAR      │  (mobile only) top bar: Lacuna               │
│  (desktop)    ├─────────────────────────────────────────────┤
│               │                                              │
│  Lacuna       │   <main> -- routed page, scrolls             │
│  Spaced rev.  │   independently; page transitions            │
│               │   animate here                               │
│  > Dashboard  │                                              │
│  > Study today│                                              │
│  > Search     │                                              │
│  > Share      │                                              │
│  > Settings   │                                              │
│               │                                              │
│  DECKS        │                                              │
│  - Organic .. │                                              │
│  - French ..  │                                              │
│               │                                              │
│  [v] collapse │                                              │
└───────────────┴─────────────────────────────────────────────┘
```

- **Sidebar** (`Sidebar`): brand; primary nav (Dashboard, Study today, Search, Share,
  Settings); a live deck list (each with an accent dot when active); footer with a theme toggle and a
  collapse toggle. Collapsing animates the width to 72 px and hides labels. Active state is a
  sliding shared-layout marker. State (`collapsed`) is persisted to `localStorage`.
- **Mobile:** the sidebar becomes a drawer opened from a top bar burger; the scrim closes it;
  it auto-closes on navigation.
- **Global keyboard shortcuts** (within the shell): `Ctrl/Cmd+K` toggles the command palette;
  `/` opens full search; `?` toggles the keyboard-hints overlay. Single-key shortcuts are
  inert while typing in an input/textarea.
- **Error boundaries:** one wraps the whole app, one wraps each page, and one wraps the Learn
  session.

### 4.2 Route map

| Path | Screen | In shell? | Loading |
|------|--------|-----------|---------|
| `/` | Dashboard | yes | eager |
| `/deck/:deckId` | Deck view (Cards / Analytics) | yes | lazy |
| `/deck/:deckId/settings` | Deck settings | yes | lazy |
| `/deck/:deckId/cards/new` | Card editor (create) | yes | lazy |
| `/deck/:deckId/cards/:cardId/edit` | Card editor (edit) | yes | lazy |
| `/settings` | Settings | yes | eager |
| `/search` | Search | yes | eager |
| `/share` | Share (export/import via codes) | yes | eager |
| `/deck/:deckId/learn` | Learn session (single deck) | **no** | lazy |
| `/learn` | Learn session (all decks, "Today") | **no** | lazy |

### 4.3 Screen wireframes

**Dashboard** (`/`):

```
Your revision
Decks                                   [ Select ]  [ + New deck ]

┌ streak ──────┬ reviewed today ┬ next 7 days ▁▃▂▅▁▁▂ ─────────┐
└──────────────┴────────────────┴────────────────────────────┘

┌ Study today ───────────────────────────────  [> Study all ] ┐
│ N cards ready across all your decks…                          │
└───────────────────────────────────────────────────────────────┘

┌ Deck card ┐ ┌ Deck card ┐ ┌ Deck card ┐
│ Exam in 6d│ │ …         │ │ …         │   (responsive grid)
│ Name      │ │           │ │           │
│ 42 cards  │ │           │ │           │
│ ▇▇▇▇ 68%  │ │           │ │           │
└───────────┘ └───────────┘ └───────────┘
```
Header with title and New-deck / Select buttons; a motivation strip (`StudySignals`); a
global "Study today" call-to-action when any card is due; an inline new-deck composer (blank
or import, animated open/close); a selection action bar in select mode (bulk delete with
undo, cross-deck merge with target chooser); and the responsive deck grid. Empty state invites
creating the first deck.

**Deck view** (`/deck/:deckId`):

```
‹ All decks
Exam in 6 days · 14 Jun 2026, 23:59
Organic Chemistry                         [s]  [> Study ]
┌ Predicted exam score ──────────────── 68% ┐
│ ▇▇▇▇▇▇▇▇▇▇▇▇▁▁▁▁▁▁                          │
│ Mean predicted retrievability on exam day. │
└────────────────────────────────────────────┘
[ Cards ]  [ Analytics ]            ← tab underline slides
tag chips: All · acids · mechanisms …
<card list with editor> | <analytics charts>
```

**Learn session** (full screen, outside the shell):

```
┌ header (hidden in focus mode) ──────────────────────────────┐
│ [=] ORGANIC CHEMISTRY                  68% predicted score   │
│     ▇▇▇▇▇▇▇▇▇▁▁▁▁                          ...  [ Exit ]     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│          ┌── flip card (rotateX flip on reveal) ──┐          │
│          │   QUESTION / ANSWER                     │          │
│          └─────────────────────────────────────────┘         │
│                                                              │
│            [   Show answer   ]                                │
│         (after reveal)  [ X No ]  [ OK Yes ]                 │
│                    ↳ Undo last answer                        │
└──────────────────────────────────────────────────────────────┘
      (green/red glow rises from the bottom on grading)
```

**Card editor**, **Deck settings**, **Settings**, **Search** follow the same centred-column
pattern with an eyebrow + display title and `rounded-2xl` sections; the editor and deck
settings add a sticky bottom action bar.

---

## 5. Data model (Dexie, `src/db/`)

All tables are keyed by string `id` unless noted. Types live in `src/db/types.ts`.

### Deck
`id, name, examDate, createdAt, examDatePromptDismissed?, fsrsVersion, fsrsParameters,
examObjective, newCardsPerDay?, archived?, autoOptimise?`
- `examDate` is an epoch-ms instant; **defaults to creation time + 7 days at 23:59 local**.
- `fsrsVersion` is `6`.
- `fsrsParameters = { w: number[21], requestRetention: number }` — the 21 FSRS-6 weights
  (w0..w20; **w20 is the trainable decay**) plus the target retention. The weights may be
  re-fitted to the deck's own history (see §8.1, optimisation).
- `examObjective ∈ { 'expectedMarks' (default), 'securedTopics' }`.
- `newCardsPerDay?` — cap on brand-new cards introduced per day; undefined/0 = unlimited.
- `archived?` — when true the deck is retained in full but withdrawn from all study, the
  global "Today" session and the dashboard study totals (one of the explicit post-exam
  choices, see §8.2).
- `autoOptimise?` — per-deck override for scheduling optimisation; undefined falls back to
  the global default (on). Applying optimised weights always still needs explicit consent.

### Card
`id, deckId, type('front_back'|'cloze'), front, back, stability|null, difficulty|null,
lastReviewed|null, reps, lapses, state, tags?, suspended?, flagged?, buriedUntil?, due|null,
scheduledDays, learningSteps, history[], createdAt`
- `front`/`back` are Markdown source. **Cloze** source lives entirely in `front`
  (`{{cN::…}}`); `back` is empty.
- `stability` (days; the interval at which R = 0.90), `difficulty` (∈ [1,10]),
  `lastReviewed`, `due` are all `null` until the first review.
- `reps, lapses, state, scheduledDays, learningSteps, due` mirror ts-fsrs's card fields.
  `state ∈ {0 New, 1 Learning, 2 Review, 3 Relearning}`.
- `history[]` is an append-only array of `ReviewLog` (timestamp, grade, responseTimeSec,
  distracted, stability/difficulty before+after, retrievabilityAtReview|null).

### SessionHistoryEntry
`{ id?, timestamp, deckId, averagePredictedRetrievability }` — written **per answered card**;
analytics aggregate to the last snapshot per calendar day to plot the trajectory.

### UserPerformance (per deck)
`{ deckId, runningMeanResponseTime, runningStdDevResponseTime, m2, totalCorrectReviews }` —
a Welford running mean/variance over **correct (Yes) reviews only**, used to calibrate the
invisible grader.

### ImageAsset / BackupAsset
- `ImageAsset { hash, blob, mimeType, width, height, createdAt }` — a card image stored as a
  binary `Blob` in the `assets` table, keyed by the SHA-256 of its bytes so identical images
  are stored once. Card Markdown carries only a `lacuna-asset://<hash>` reference, resolved to
  an object URL at render time and cached per hash for the app lifetime (revoked only at
  app teardown). This keeps reactive card reads small, stops base64 inflating exports and
  quota, and avoids the create/revoke churn on every card flip during a fast Learn session.
- `BackupAsset { hash, data(base64), mimeType, width, height, createdAt }` — the JSON-safe form
  of an `ImageAsset` carried in backup/export files.

### BackupSnapshot / BackupFile / AppStateEntry
- `BackupSnapshot { id?, createdAt, tag?, deckCount, cardCount, payload }` — a stored automatic
  restore point (denormalised counts so the list renders without parsing the payload).
  `tag = 'pre-migration'` marks a snapshot taken automatically before a schema upgrade; these
  are **exempt from daily-snapshot pruning** so a botched migration always has a fallback (§13).
- `BackupFile { app:'lacuna', version, exportedAt, decks, cards, assets, sessionHistory,
  userPerformance }` — the shape of both manual exports and snapshot payloads; `assets` carries
  the referenced images.
- `AppStateEntry { key, value }` — small persistent app state (e.g. the backup folder handle).

---

## 6. FSRS-6 engine wrapper (`src/fsrs/fsrs.ts`)

A thin, pure translation layer over `ts-fsrs`. **No memory maths is implemented by hand.**

- `makeEngine(params)` builds an FSRS-6 scheduler: `fsrs({ w, request_retention,
  enable_short_term: true })`.
- `decayOf(params) = −params.w[20]` — the (always negative) forgetting-curve decay exponent.
- `toTsCard(card, now)` / `fromTsCard(ts, now)` map between Lacuna's persisted card shape and
  ts-fsrs's; a never-reviewed card becomes a fresh `createEmptyCard` so ts-fsrs applies the
  correct initial-stability/difficulty path.
- `applyReview(engine, card, grade, now)` returns the new memory state plus the
  retrievability at the instant of review (`get_retrievability`, `null` on a first review),
  via `engine.next`.

Constants (`src/fsrs/params.ts`): `FSRS_VERSION = 6`; default weights and request retention
from ts-fsrs; target retention is user-clampable to **[0.80, 0.97]** (default = ts-fsrs
default); difficulty bounds `[1, 10]`; `MASTERY_R = 0.90`; `MS_PER_DAY = 86_400_000`.

**On the algorithm version (honesty note).** Lacuna uses FSRS-6 because that is what `ts-fsrs`
exposes — not because it is the newest FSRS in existence (FSRS-7 exists). Copy and comments are
pinned to "the version ts-fsrs ships", not to "the newest". Also, FSRS has **no short-term
memory model**, so repeated same-evening reviews during exam cramming are a known limitation;
exam-eve cram mode (§10) is the product-level response, but the underlying maths still does not
model intra-day re-review.

---

## 7. Forward simulation & core formulae (`src/fsrs/forwardSim.ts`)

This is Lacuna's own pure layer that projects a card to the **exam date** rather than to its
next due date. It touches neither IndexedDB nor React, so every function is unit-tested.

**Forgetting curve (FSRS-6 power law).** With `decay = −w20` (negative) and `t`, `S` in days:

```
factor   = 0.9^(1/decay) − 1
R(t, S)  = (1 + factor · t / S)^decay
```

By construction `R = 0.90` exactly when `t = S`, for any decay. With `decay = −0.5` (the
fixed FSRS-4.5 decay), `factor = 19/81`, so the curve reduces exactly to FSRS-4.5. A card
with `S ≤ 0` has `R = 0`; elapsed time is clamped at 0.

**Predicted exam-day retrievability with no further review** (`rAtExam`):

```
days = max(examDate − lastReviewed, 0) / MS_PER_DAY
R_no = forgettingCurve(days, stability, decay)
```
A never-reviewed card (no stability/lastReviewed) → `R_no = 0`.

**Predicted exam-day retrievability if reviewed now** (`rAtExamIfReviewedNow`):

```
daysRemaining = max(examDate − now, 0) / MS_PER_DAY
if daysRemaining == 0 → 1.0                     (a review on exam day leaves R = 1)
S'   = ts-fsrs.next(card, now, expectedGrade).stability
R_yes = forgettingCurve(daysRemaining, S', decay)
```
The assumed `expectedGrade` is **Good** (deterministic, dependency-free).

**Delta-R — the marginal value of reviewing now** (`deltaR`):

```
ΔR = R_yes − R_no
```
For a new card `R_no = 0`, so `ΔR = R_yes`. As a card's exam-day R approaches 1, `ΔR → 0`.

---

## 8. The exam objective — the core invariant (`src/fsrs/objective.ts`)

A deck's `examObjective` is the single value from which **both** the scheduler's sort key and
the progress-bar value are derived, so they can never disagree.

### Progress-bar value (`progressValue`, via `src/fsrs/progress.ts`)
- `expectedMarks` → **mean predicted exam-day R** across the cards:
  `averagePredictedRetrievability = (Σ rAtExam) / n`.
- `securedTopics` → **fraction of cards with predicted exam-day R ≥ 0.90**:
  `masteryFraction = |{ c : rAtExam(c) ≥ 0.90 }| / n`.
- An empty set is treated as `1` for mastery and `0` for the mean.

### Scheduler sort key (`scoreCard`; higher = serve sooner)
- `expectedMarks`: greedy maximisation of Σ R, so the score **is** `ΔR`.
- `securedTopics`, evaluating each card:
  - if already secured (`R_no ≥ 0.90`) → score `−1` (nothing to gain, lowest priority);
  - else if a single review secures it (`R_yes ≥ 0.90`) → score `1 + R_no` (a higher current
    R means it is closer to the line and cheaper to secure, so rank those first; the `+1`
    keeps every securable card above every not-yet-securable one);
  - else → score `R_yes` (make the most progress available toward the line).

### Objective complete? (`isObjectiveComplete`)
- `securedTopics`: every card is at or above 0.90 (`masteryFraction ≥ 1`).
- `expectedMarks`: no card offers a meaningful further gain —
  `max(ΔR) < EXPECTED_MARKS_EPSILON (1e-3)`.

Helper copy (`progressNoun`, `progressHeading`, `progressDescription`) phrases the same number
appropriately ("predicted score" vs "secured").

### The scheduling horizon (`src/fsrs/horizon.ts`)
Every function above aims cards at a **single horizon date**, read through `schedulingHorizon(deck)`
rather than `deck.examDate` directly, so the scheduler and progress bar stay pinned together even
once the exam date moves into the past:
- while `examDate ≥ now` → the horizon **is** `examDate`;
- once `examDate < now` → the horizon falls back to a rolling `now + MAINTENANCE_HORIZON_DAYS`
  (7 days). This is the "keep revising" fallback: it stops `daysRemaining` clamping to 0 (which
  would make every card read R = 1 and pin the bar to a bogus 100%) and instead has the deck
  maintain its target retention against a moving horizon.

`urgency` (multi-deck blending, §10) likewise uses the horizon, so a passed exam no longer reads
as permanently maximally urgent.

### 8.1 Parameter optimisation (`src/fsrs/optimise.ts`, Web Worker)
The default weights are a starting point; most of FSRS's efficiency comes from fitting them to a
user's own history. Lacuna uses the **official gradient-based trainer** from the ts-fsrs authors
(`@open-spaced-repetition/binding`, fsrs-rs compiled to WASM):
- each card's `history[]` is converted to the binding's review-item format (grade 1–4, `deltaT` in
  days since the previous review, with `0` on the first review);
- `computeParameters()` fits the 21 weights with `enableShortTerm: true`, consistent with the
  scheduler (`makeEngine`);
- fitted weights are **validated against the FSRS clamp ranges** (`CLAMP_PARAMETERS` / the same
  bounds as `clipParameters`) before they can ever be applied; out-of-range results are rejected;
- before/after **log loss** is computed on a **held-out validation portion** (the last 20% of
  each deck's review history by time) so the metric is out-of-sample, not training-set
  overfitting. The confirmation step only offers to apply the fitted weights when they beat the
  defaults out of sample;
- it is **gated** on `MIN_OPTIMISE_REVIEWS` (1,000) so the train/validation split is meaningful;
- it runs in a **Web Worker** (`src/workers/optimise.worker.ts`, initialised via `initOptimizer`
  with Vite `?url` / `?worker` imports; driven by `useOptimiser`) so the UI never blocks,
  reporting trainer progress and the before/after summary. The dev/preview server sets
  cross-origin isolation headers required by the WASM worker;
- new weights are applied only on explicit confirmation, after an automatic pre-change restore
  point; a "Reset to defaults" path is always available. A global default (on) and a per-deck
  `autoOptimise` override govern whether the action is offered (§15).

### 8.2 Post-exam state
A deck whose `examDate` has passed is detected (`examHasPassed`) and surfaced clearly rather than
silently stopping. The dashboard card reads "Exam date passed" and the deck view offers three
explicit actions: **set a new exam date**, **archive the deck** (`archived = true`; retained but
withdrawn from study and totals), or **keep revising** against the rolling maintenance horizon
above. Archived decks are excluded from the study pool (§9), the global "Today" session and the
dashboard study denominators, and are shown in a separate "Archived" group.

---

## 9. Eligibility & study pool (`src/fsrs/eligibility.ts`)

The single rule set that keeps the scheduler and the progress denominator in agreement when
cards are withheld.

- `isAvailable(card)` — not `suspended` and not currently `buried` (`buriedUntil > now`).
  Suspended/buried cards are excluded **entirely**: from the study pool *and* from the
  progress/objective denominator while excluded.
- `newCardsIntroducedToday` — cards whose first-ever review timestamp is today.
- `studyPool(cards, deck)` — returns **empty for an archived deck** (withdrawn from study while
  its cards are retained in the progress denominator), otherwise available cards with brand-new
  (`state 0`) cards rationed by the deck's `newCardsPerDay` cap:
  ```
  budget    = max(cap − newCardsIntroducedToday, 0)
  newAllowed = oldest-first new cards, sliced to budget
  pool       = available cards where state ≠ 0 OR id ∈ newAllowed
  ```
  An undefined/zero cap means unlimited. The cap only rations **today's** study pool; it does
  **not** change the dashboard denominator, so the deck's exam-day trajectory stays honest
  while a session paces new material.

---

## 10. Learn mode (`src/pages/LearnMode.tsx`, `src/fsrs/session.ts`, `cooldown.ts`)

A Learn session may study a **single deck** or **every deck at once** (the global "Today"
session). Both run through one engine so ordering and progress stay objective-derived.

### Session lifecycle
1. **Load** a static snapshot of the deck(s) and their cards (an optional `?tag=` filter
   narrows a single-deck session). Build a `SessionContext` (one objective context per deck)
   and per-deck `UserPerformance`. Capture `progressBefore`.
2. If there is nothing to study or the objective is already met, go straight to the **report**.
3. Otherwise **serve** cards one at a time until the objective is met or the user exits.

### Card selection (`selectNext`)
- **Single deck:** exactly the per-deck objective order (`sortByObjective`) with cooldown
  skipping (`selectNextCard`).
- **Multiple decks:** each card is scored by *its own* deck's objective; scores are
  **min-max normalised within each deck** to 0..1 and weighted by an exam-proximity urgency,
  so figures are comparable across decks with different objectives and deadlines:
  ```
  urgency(deck)   = 1 / (1 + daysUntil(schedulingHorizon(deck)))
  priority(card)  = urgency(deck) · (score − min_deck) / (max_deck − min_deck)
  ```
  The highest-priority card not on cooldown is served; if all are on cooldown, the
  soonest-eligible (then highest priority) is served so the session never stalls.
  **Degenerate-range guard:** when a deck's scores are all equal (`max_deck − min_deck ≈ 0`,
  e.g. a single-card or uniform deck) the normalised term is treated as `1` instead of
  dividing by zero, so such decks are still served and never produce `NaN`.

### Exam-eve cram mode (`src/fsrs/cram.ts`, `SessionMode = 'cram'`)
An **explicit** mode (entered via `?mode=cram`, never a silent change) for the final push before
an exam. `examEveAvailable(deck)` gates it to the last `EXAM_EVE_WINDOW_HOURS` (48 h) before the
deadline. It reorders study **weakest-first** (lowest predicted exam-day R first), trading
long-term retention for getting as many cards over the line as possible. It stays objective-aware:
under `securedTopics` it drives still-unsecured cards (< 0.90) first and drops already-secured
cards to the back; under `expectedMarks` it serves the cards with the most exam-day headroom
first. DeckView shows a clearly-labelled "Exam-eve cram" entry inside the window, stating the
trade-off.

### Cooldown (`src/fsrs/cooldown.ts`)
In-memory, per session, to stop a just-failed card being shown again immediately:
```
maxCooldown(deckSize) = deckSize ≥ 6 ? 5 : max(deckSize − 1, 0)
```
A failed card (grade 1) is given that cooldown; after every answer, all *other* cards'
cooldowns decrement by one (skip-and-decrement).

### Grading modes (`src/state/gradingMode.ts`)
Two modes, chosen in Settings (default **silent**):
- **Silent (default):** the learner presses only Yes/No and the four-point grade is inferred
  (below). This is the product's core UX bet.
- **Manual:** the four FSRS buttons (Again/Hard/Good/Easy) are shown and the user grades
  directly; no inference is applied.

### The invisible timer & grading (`src/fsrs/grading.ts`, silent mode)
- The response timer **starts on reveal** ("Show answer") and **stops when the answer is
  graded**; it runs continuously and never pauses. (Opening the in-session editor rebases the
  timer so editing time is excluded.)
- "No" → grade **1 (Again)**. "Yes" maps to Easy/Good/Hard by speed:
  - **Calibration** (`totalCorrectReviews < 20`): `< 3 s → Easy(4)`, `> 8 s → Hard(2)`,
    else `Good(3)`.
  - **Adaptive** (≥ 20 correct): `< μ − 0.75σ → Easy(4)`, `> μ + 0.75σ → Hard(2)`,
    else `Good(3)`, where μ and σ are the deck's running mean/stddev of correct response
    times.
- After a correct review, `UserPerformance` is updated by **Welford's online algorithm**:
  ```
  n     = totalCorrectReviews + 1
  δ     = t − mean ;  mean += δ / n
  δ2    = t − mean ;  m2   += δ · δ2
  σ     = sqrt(m2 / n)      (0 while n ≤ 1)
  ```
  Note: calibrating on **correct reviews only** is a biased sample on high-failure decks; the
  prediction-accuracy metric (§14) exists partly to surface when that bias is hurting scheduling.

### Per-card actions & state
- **Edit**: opens an in-session overlay (`CardEditOverlay`) that pauses/rebases the timer;
  saving updates the live card without leaving the session.
- **Flag** (toggle), **Bury until tomorrow** (`buriedUntil = startOfDay(now) + 1 day`),
  **Suspend** — all drop the card from the live pool (and the denominator) and move on.
- **Undo**: single-step reversal of the last answer — restores the card's prior memory
  state, the `UserPerformance`, the cooldown map, the progress value and the events list, and
  deletes the written `SessionHistory` row.
- **Focus mode** (F): hides all chrome for distraction-free review, leaving a single quiet
  "Exit focus" affordance.
- **Keyboard shortcuts**: accessible via the "Keyboard shortcuts" item in the 3-dot action
  menu, which opens a modal listing all available shortcuts. The `?` key still toggles this
  overlay from anywhere.
- **Distraction** (Page Visibility + window blur) is recorded per card for the report only;
  it never affects the grade.

### Recording a review
Each answer calls `recordReview` which applies the FSRS update, appends a `ReviewLog`, and
writes a per-card `SessionHistory` snapshot (`averagePredictedRetrievability` of the served
pool). The progress value is recomputed and, if the objective is met, the session finishes.

### Completion & the report (`SessionReport`)
The session **auto-ends** when the objective is met (all cards secured, or no card offers a
meaningful gain in Σ R), or on manual exit. The report shows: progress before → after (with
the objective label), and stat tiles for **cards reviewed, accuracy, mean correct time,
focus %**, plus a grade-distribution bar chart and a focus note when distractions occurred.
Reaching the goal shows a celebratory tick badge; otherwise "Keep studying" is offered.

### Keyboard
`Space`/`Up` reveal; after reveal `Y`/`J`/`Right` = Yes, `N`/`Left` = No; `E` edit, `U` undo,
`F` focus mode, `?` help (also accessible from the 3-dot menu as "Keyboard shortcuts"),
`Esc` closes overlays/drawer.

### Exam-date prompt
The first time a deck is studied an inline banner (`ExamDateBanner`, not a modal) asks for the
real exam date and time, with a "don't ask again for this deck" toggle. The date is also
editable in deck settings. Once set or dismissed, `examDatePromptDismissed` is true.

---

## 11. Cards, cloze & the editor

### Cloze (`src/components/markdown/cloze.ts`)
- Notation: `{{c1::hidden answer}}` and `{{c1::hidden answer::optional hint}}`.
- A single card hides **all** `cN` spans at once. On the **front** each span renders as a
  styled blank — `[...]`, or `[hint]` if a hint is given. On the **back** every hidden span is
  revealed and highlighted inline within the full sentence (`.cloze-reveal`).
- `nextClozeIndex` powers the editor's auto-indexing Cloze button; `hasCloze` gates cloze
  validity and import.

### Card rendering (`CardContent` → `MarkdownView`)
Front/back Markdown is rendered with GFM, maths (KaTeX), syntax highlighting, and raw HTML
(for the cloze spans), inside `.prose-lacuna` styling. Memoised per card.

### Editor (`src/pages/CardEditor.tsx`, full page)
- Mode is decided by the route (`/cards/new` vs `/cards/:id/edit`).
- **Card type** selector: Front / Back or Cloze.
- One or two **Markdown editors** with a live preview; a formatting toolbar (bold, italic,
  heading, lists, code, link, image, cloze auto-index, inline/block maths); a cloze editor
  can preview the revealed answer.
- **Tags** input with deck-wide suggestions.
- **Images** are downscaled to ≤ 1280 px, re-encoded (~0.8 quality), stored as a binary `Blob`
  in the `assets` table (deduplicated by SHA-256 hash), and referenced from the Markdown as
  `lacuna-asset://<hash>` — **not** base64 data URIs. The render path resolves references to
  object URLs on display and revokes them on unmount. This keeps card rows small (base64 inflates
  payloads ~⅓ and dragged full image data through every reactive read) and keeps exports lean.
- **Validation:** front required; back required for front/back; at least one cloze for cloze.
- **Quick capture:** "Save & add another" keeps the page open, clears content, retains type
  and tags, refocuses the first field, tallies a per-sitting count, and flashes a "Saved"
  confirmation. A seamless Tab order runs Front → Back → Save-and-add → Save. `Ctrl/Cmd+Enter`
  saves (and, for new cards, keeps going).
- **Reverse cards:** for a new front/back card, an "Also create reverse" toggle additionally
  creates an independent card testing the back.

---

## 12. Navigation, decks & card management

- **Dashboard** lists decks in a responsive grid, each showing exam proximity, card count and
  the objective progress bar; a global "Study today" entry point appears when cards are due.
- **Multi-select** mode supports **bulk delete** (with an Undo toast that restores a snapshot)
  and **cross-deck merge** (keeps the chosen target's name, exam date and performance history;
  concatenates the others' cards and session history into it).
- **Card list** (`CardList`, in the Deck view) supports per-card edit, suspend/flag, and
  **move** between decks; a tag-filter row scopes both the list and the study session.
  Clicking a card row expands it in-place to show a **per-card forgetting curve** and
  **vital statistics** (see §14, Per-card analysis).
- Deck creation can **start blank** or **import** cards immediately (see §13).

---

## 13. Import, export & backups (`src/db/portability.ts`, `import.ts`, `backups.ts`)

### Text/CSV/TSV import (`parseImport`)
- A **quote-aware** delimited parser: a field opened with `"` may contain the field/row
  separator and escaped quotes (`""`), matching spreadsheet and Anki CSV.
- Defaults: **tab** field separator, **newline** row separator (so Anki's plain-text export
  works as-is); both are customisable. Windows/old-Mac line endings are normalised first.
- Per row: field 1 = front, field 2 = back, optional field 3 = space-separated tags. A row
  with a back is a front/back card; a single column containing cloze notation becomes a cloze
  card; otherwise the row is skipped (and counted as skipped, since it has no answer side).

### Backup file import/export
- **Export:** versioned JSON of the whole database (`BackupFile`: decks, cards, **referenced
  image assets**, session history, user performance). Backups are the route that carries images
  between machines (share codes deliberately do not, §13).
- **Import modes:**
  - **Replace all** — wipe then restore exactly.
  - **Merge** — fold in by id. Before committing, a **visible diff** summarises what will be
    **added, changed and overwritten** (counts at minimum) and requires **explicit
    confirmation**; only on confirm are changes applied (newest `lastReviewed`/`createdAt` wins
    per conflicting record). This replaces the previous silent "most-recent-wins" merge, which
    was a data-loss footgun.

### Automatic restore points & migration safety
- Up to the **ten most recent** snapshots are kept on-device; one is taken automatically on
  open, **at most once a day** (`autoBackupIfStale`), and never blocks the UI.
- **Pre-migration snapshot:** before a schema upgrade rewrites data, a `pre-migration`-tagged
  snapshot is captured in a **separate committed transaction** (via a dedicated
  `lacuna-pre-migration` IndexedDB) so a failed upgrade on the main database never rolls the
  snapshot back with it. The snapshot is also mirrored to the configured folder if the File
  System Access API is available. Tagged snapshots are **exempt from the ten-snapshot pruning**.
  The v4 image migration is also idempotent and reads-transforms-writes explicitly rather than
  mutating inside an async Dexie `.modify()` callback (which Dexie does not reliably persist).
- Restoring replaces all current data with the snapshot.
- **Folder mirror** (where the File System Access API is supported): each backup can also be
  written to a chosen folder so it survives clearing browser data. Where unsupported, the UI
  explains this and points to manual export.

### Deck sharing — share codes (`src/db/share.ts`, `SharePage`, `/share`)

A dedicated **Share** tab in the sidebar turns deck content into a single, compact,
copy-and-paste **code** and rebuilds decks from one. It is distinct from backup export: a
share code carries only the **material**, never one person's scheduling or history.

- **What a code contains:** for each deck — name, exam objective, date created and **date due**
  (`examDate`), target retention and any new-card cap — and for each card its type, front,
  back and tags. A `by` (creator) field is reserved for future attribution and is currently null.
- **What it omits:** FSRS memory state, review history, suspended/buried/flag state — **and
  images**. Image references are stripped to a text placeholder. DEFLATE does almost nothing to
  already-compressed image bytes, so embedding them produced multi-megabyte "codes" that defeated
  the copy-and-paste premise. When a selected deck contains images the export UI says so before
  generating and points to the full **backup export** as the route for transferring images; on
  import, stripped images render as the placeholder and the preview notes they were not included.
  Imported cards always start with clean scheduling for their new owner.
- **Compression**, in order of impact:
  1. **Reverse-pair folding** — a front/back card and its exact mirror (one's front = the
     other's back and vice versa) are detected and stored **once** as a single "reversible"
     entry (`k:2`), then expanded back into two independent cards on import (the same shape
     `createCardWithReverse` produces). This directly exploits the reverse-cards feature.
  2. Compact single-letter JSON keys.
  3. **DEFLATE** via the native `CompressionStream('deflate-raw')` when available, then base64.
- **Format:** a short scheme tag (`LAC1` = compressed, `LAC0` = plain fallback when the
  browser lacks compression) followed by base64 — i.e. just letters, digits and base64
  punctuation. A version field inside the payload guards forward compatibility; an unknown or
  corrupted code yields a readable error.
- **Export UI:** a multi-select list of decks (with per-deck card counts and a select-all),
  a "Generate share code" action, then the code shown in a read-only monospace box with a
  one-click **Copy** and a character count.
- **Import UI:** a styled paste box (accent focus ring); "Read code" decodes and shows an
  inline confirmation preview (deck and card counts, the share date, and the deck names as
  chips) before "Add to my decks" commits. Importing always **creates new decks** — it never
  overwrites existing data.
- Round-trip behaviour (content, cloze, reverse-pair expansion, multi-deck bundling, date due
  preservation, clean scheduling state, and rejection of non-codes) is covered by
  `src/db/share.test.ts`.

---

## 14. Search & analytics

### Search (`src/db/search.ts`, `SearchPage`, `CommandPalette`)
- A pure, offline, case- and diacritic-insensitive substring search over a card's
  front, back, its deck name and its tags.
- **Ranking:** front matches rank above back/deck/tag matches; earlier match positions rank
  first.
- **Structured filters** (AND-combined, usable without a query): **due, new, leech, flagged,
  suspended**. These turn search into deck management ("show me all leeches").
- The full-page Search and the `Ctrl/Cmd+K` command palette share the same core; results
  link straight to the card editor. `plainPreview` strips Markdown/cloze/images for previews.
- **Leech** = a card with `lapses ≥ 8` (`src/fsrs/leech.ts`); surfaced via a badge and the
  search filter, but scheduling is never changed automatically.

### Dashboard signals (`src/fsrs/stats.ts`, `StudySignals`)
Pure aggregates over stored history, in local time:
- **Streak:** consecutive studied days counting back from today (a not-yet-studied today does
  not break a streak that includes yesterday).
- **Reviewed today:** count of review logs dated today.
- **Seven-day forecast:** each scheduled card is bucketed by its effective due day (overdue
  folds into today, beyond the window is ignored) and weighted by its deck's **mean review
  seconds** (fallback 8 s) to estimate **minutes of study per day**, shown as a small bar
  sparkline with a "minutes to clear" total.
- **Review heatmap** (`src/fsrs/heatmap.ts`, `ReviewHeatmap`): a contribution-style calendar of
  reviews per **local** calendar day (a 26-week grid), built from review logs and theme-aware via
  accent-opacity bands. Expected by anyone arriving from Anki.

### Per-card analysis (`CardAnalytics`)
Each card in the deck card list can be expanded in-place to reveal a **forgetting curve**
and **vital statistics** for that individual card:
- **Forgetting curve** — an `AreaChart` projecting retrievability from the card's most recent
  review forward to `examDate + 14 days`, with historical review moments overlaid as
  grade-coloured dots. Vertical reference lines mark the current time (`Now`) and the exam
  date (`Exam`). Never-reviewed cards show an inviting empty state.
- **Vital statistics** — a grid of tiles showing: stability, difficulty, current retrievability,
  predicted exam-day retrievability, total reviews, lapses, due date, days since last review,
  mean response time and accuracy.
- **Grade distribution** — animated mini-bars for Again / Hard / Good / Easy counts.
- Expansion is toggled by clicking the card row; only one card may be expanded at a time.
  Hover still reveals the card back (desktop), while the expanded panel captures click events
  so interacting with the chart does not collapse the view. The row is keyboard-accessible
  (`Enter`/`Space` toggles expansion).

### Deck analytics (`DeckAnalytics`)
Theme-aware Recharts panels:
- **Predicted exam-day score** over time (area chart of the daily `SessionHistory`
  trajectory).
- **Prediction accuracy** (`src/fsrs/calibration.ts`): the silent grader made measurable.
  From `history[]` (which logs grade, response time and `retrievabilityAtReview`) it compares
  predicted retrievability at review against the actual recall outcome (a **Brier/log-loss**
  calibration metric, bucketed over time; lower is better), with a one-line plain-English
  explanation. A developer-facing `gradeQualitySummary` (exposed on `window` and console-
  exportable) reports how the inferred grades distribute and whether faster responses really
  correlate with higher subsequent recall, so the response-time thresholds can be validated
  rather than assumed.
- **Card stability profile** (histogram of cards by stability range; new cards distinct).
- **Review volume** (reviews per day over the last 30 days).

---

## 15. Settings (`src/pages/Settings.tsx`)

- **Appearance:** theme toggle (defaults to **dark**); **accent colour** swatches (7 choices);
  **text size** steps that scale all text. All three persist to `localStorage` (via
  `ThemeContext`, `AccentContext`, `FontScaleContext`).
- **Study & scheduling:** **Manual four-point grading** toggle (off by default → silent grader,
  §10) and the global **Optimise scheduling** default (on → fit FSRS weights to your own history,
  §8.1; gated at `MIN_OPTIMISE_REVIEWS`, overridable per deck, applied only on confirmation).
- **Import & export:** export all data; import from file with the inline Merge / Replace-all
  chooser described in §13.
- **Persistent storage:** the app requests `navigator.storage.persist()` on first run so the
  browser does not silently evict IndexedDB data under storage pressure. The result (persisted,
  denied, or unsupported) is surfaced honestly in the backup area of Settings, with a clear
  warning when persistence is denied and a pointer to regular exports or folder mirroring as the
  safeguard.
- **Automatic backups:** "Back up now"; folder-mirror controls (where supported); a list of
  restore points (timestamp + deck/card counts) each with Delete and a two-step Restore
  confirmation.

### Deck settings (`src/pages/DeckSettings.tsx`)
Rename; exam date and time; **exam objective** toggle (Expected marks ↔ Secure topics, with
live explanatory copy); **new cards per day** cap; **target retention** slider (0.80–0.97,
with Relaxed/Balanced/Thorough presets and adaptive guidance copy).
- **Scheduling optimisation** (§8.1): a per-deck on/off override, a review-count gate, and an
  **Optimise now** action that runs in a Web Worker with a progress bar, then shows the
  before/after log loss. Applying takes a restore-point snapshot first; **Reset to defaults** is
  always available.
- Once the **exam date has passed** (§8.2), the deck view offers set-new-date / archive /
  keep-revising; an archived deck shows a restore action.
- A "Danger zone" deletes the deck immediately with an Undo toast (no blocking dialog). Sticky
  Save/Cancel bar.

---

## 16. Persistence, seeding & resilience

- All reads use Dexie `useLiveQuery` hooks (`src/state/useData.ts`) so the UI reacts to writes
  automatically.
- On first run a **demo deck** is seeded (`seedIfFirstRun`).
- A daily restore point is taken in the background after seeding.
- **Error boundaries** at the app, page and Learn-session levels keep a failure in one area
  from blanking the whole app. Their fallback offers a **local-only diagnostic bundle**
  (`src/db/diagnostics.ts`): "Copy diagnostic details" / "Download diagnostic bundle" assemble
  the error and stack, app version (`__APP_VERSION__`), browser/UA, and deck/card/review/backup
  counts. Card content is **excluded by default**; including a small sample is a separate, explicit
  opt-in. Nothing is transmitted — the bundle is the user's to paste into a bug report.
- Migrations live in `src/db/migrations.ts`; the schema is versioned in `src/db/schema.ts`, and
  every upgrade is fronted by a pre-migration restore point (§13).

---

## 17. Accessibility & internationalisation

- Honours `prefers-reduced-motion: reduce` (all animation/transition durations collapse).
- Focus-visible rings on interactive controls; `aria-label`/`title` on icon buttons;
  `aria-pressed` on toggles and chips; `role="progressbar"` with value attributes on the bar.
- Tabular numerals for figures; balanced text wrapping for headings.
- Copy is **British English** throughout; **no emojis** in product copy or UI.

---

## 18. Keyboard shortcuts (summary)

| Context | Key | Action |
|---------|-----|--------|
| Global (shell) | `Ctrl/Cmd+K` | Toggle command palette |
| Global (shell) | `/` | Open search |
| Global (shell) | `?` | Toggle keyboard hints |
| Deck view | `N` | New card |
| Card editor | `Ctrl/Cmd+Enter` | Save (and add another, for new cards) |
| Card editor | `Tab` | Front → Back → Save-and-add → Save |
| Learn | `Space` / `Up` | Show answer |
| Learn (silent grading) | `Y` / `J` / `Right` | Yes (correct) |
| Learn (silent grading) | `N` / `Left` | No (incorrect) |
| Learn (manual grading) | `1`, `2`, `3`, `4` | Again / Hard / Good / Easy |
| Learn | `E` | Edit current card |
| Learn | `U` | Undo last answer |
| Learn | `F` | Toggle focus mode |
| Overlays | `Esc` | Close |

Single-key shortcuts are inert while a text field is focused. The `?` overlay can also be
opened from the "Keyboard shortcuts" item in the Learn mode 3-dot action menu.

---

## 19. Electron desktop build

Lacuna can be packaged as a standalone Windows desktop application via Electron.
The Electron layer lives in `electron/` and wraps the existing Vite SPA without
modifying the renderer source.

### Architecture
- **Main process** (`electron/main.ts`): creates a frameless `BrowserWindow`, injects
  Cross-Origin Isolation headers (COOP/COEP) required by the FSRS WASM trainer,
  registers a custom `app://` protocol for production builds, and manages window
  lifecycle (single-instance lock, close/minimise/maximise).
- **Preload** (`electron/preload.ts`): exposes a minimal `electronAPI` via
  `contextBridge` for platform detection and window controls.
- **Titlebar** (`src/components/layout/Titlebar.tsx`): a custom React component that
  renders window controls (minimise, maximise/restore, close) when running inside
  Electron. Only mounts when `window.electronAPI.isElectron` is truthy, so the web
  version is completely unaffected.
- **Fonts** (`electron/assets/fonts/`): Fraunces, Geist and JetBrains Mono bundled as
  local TTF variable fonts. The main process injects `electron/fonts.css` via
  `webContents.insertCSS` so the app works fully offline.
- **Auto-updater** (`electron/updater.ts`): uses `electron-updater` with GitHub
  Releases; checks for updates shortly after launch and notifies the renderer.

### Scripts
- `npm run electron:dev` — runs Vite dev server and Electron in parallel.
- `npm run electron:build:win` — compiles the Electron TypeScript, builds the Vite
  SPA with `--base ./`, and packages via electron-builder (NSIS installer).

### Build output
Packaged files land in `release/` (gitignored). The electron-builder configuration
is at `electron/electron-builder.yml`.