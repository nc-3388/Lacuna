# Lacuna — Specification (v0.0.3)

Lacuna is a local-only, exam-driven spaced-revision application built on FSRS-6. Every card
in a deck is scheduled to peak in recall on the deck's exam day, and a single "objective"
setting binds the scheduler and the progress bar to the same goal so they can never disagree.
All data lives on-device (IndexedDB); there is no server, no account and no network
dependency. The application runs as a web SPA and packages as an Electron desktop app.

**Version 0.0.3** adds a Simple learn mode (algorithm-free YES/NO study loop), formal card
types (Basic, Reversed, Typing-answer), and further touch-first polish (configurable gestures,
auto font scaling, cleaned-up focus rings). It also fixes share code importing, folder
deletion, and a number of UI/UX issues (see §20).

British English throughout. No emojis anywhere in the product or its copy.

---

## 1. Guiding principles

1. **Exam-day, not interval-day.** Classic spaced repetition asks "when is this card next due?".
   Lacuna instead asks "what will this card's retrievability be on the exam date, and how much
   does reviewing it now improve that?". Scheduling is a forward simulation to a fixed deadline,
   not an open-ended interval ladder.
2. **One objective, one source of truth.** A deck's `examObjective` drives both the order in
   which cards are served and the number the progress bar shows. They are derived from the
   same module (`src/fsrs/objective.ts`) so they are guaranteed consistent — the core invariant
   of the app.
3. **Invisible grading (with an opt-out).** By default the learner only ever presses "Yes" or
   "No"; the four-point FSRS grade is inferred from correctness plus response time, calibrated
   per deck. The inference is measurable, not assumed — a per-deck calibration metric scores
   predicted vs actual recall (§14). A Settings toggle switches to manual four-point grading
   (Again/Hard/Good/Easy with keyboard shortcuts) for users who prefer to grade themselves.
4. **Local and private.** Everything is stored on-device. Export, import, automatic restore
   points and optional folder mirroring are the backup story; nothing leaves the machine
   unless the user exports it.
5. **Touch-first, keyboard-equivalent.** Every interaction is designed for touch from the
   ground up (44px minimum targets, swipe gestures, bottom sheets, active states) and is
   mirrored by keyboard shortcuts so the app is fast on either input mode.
6. **Quiet, tactile craft.** A restrained "quiet laboratory" aesthetic with one warm accent,
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
- **Parameter training:** `@open-spaced-repetition/binding` (fsrs-rs via WASM in a Web Worker)
  for fitting FSRS weights to review history.
- **Motion:** the `motion` library (`motion/react`).
- **Markdown / maths / code:** `react-markdown` + `remark-gfm` + `remark-math` +
  `rehype-katex` + `rehype-highlight` + `rehype-raw`. KaTeX and highlight.js styles imported
  globally.
- **Charts:** Recharts.
- **Fonts (loaded via `<link>` in `index.html`):** Fraunces (display), Geist (body),
  JetBrains Mono (code and the timer/tabular figures).
- **Testing:** Vitest with `fake-indexeddb` for the data and FSRS layers, `@testing-library/react`
  and `happy-dom` for UI component and hook tests.

Scripts: `dev`/`start` (Vite), `build` (`tsc -b && vite build`), `typecheck`, `test`,
`test:watch`, `lint`. Heavy routes (Deck view, Learn, Card editor, Deck settings) are
lazy-loaded as separate chunks; the dashboard, settings and search are eager.

---

## 3. Visual design system

### 3.1 Palette ("quiet laboratory")

Defined as raw HSL triples in `:root` and overridden under `.dark`, then exposed as Tailwind
colours (`bg-surface`, `text-ink`, `border-line`, `text-accent`, ...).

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
durations to ~0 globally, so every effect below degrades gracefully. A per-user
**motion-speed** setting (Settings) scales every duration in the app by a single multiplier,
so the app can be as snappy or as gentle as the user prefers.

Shared conventions:
- Standard easing curve `[0.16, 1, 0.3, 1]` (a soft "ease-out-quint") for entrances.
- Springs for tactile controls and shared-layout indicators.
- Staggered list/grid reveals with a small per-item delay, capped so long lists do not crawl.
- `LayoutGroup` coordinates reflow animations across sibling elements (e.g. the deck grid).

Specific motion (current state of the app):
- **Page transitions:** the routed page fades and lifts in (`y: 12 → 0`) as the previous one
  settles out (`y: 0 → -8`) via `AnimatePresence mode="wait"` keyed on the pathname; the main
  scroll area resets to the top on every navigation (`AppShell`).
- **Buttons (`Button`):** spring `whileHover` scale 1.02 and `whileTap` scale 0.96; every
  variant enforces a 44px minimum touch height.
- **Progress bar (`ProgressBar`):** the fill animates to its new width on a spring; a slow,
  looping sheen sweeps across any non-empty bar for a sense of depth.
- **Sidebar:** width animates on collapse/expand (spring); the active-item marker is a
  shared-layout element (`layoutId="nav-active"`) that slides between items; items nudge
  right slightly on hover. A collapsible drawer on mobile (§4.1).
- **Deck cards:** staggered entrance, plus a `whileHover` lift (`y: -4`) with a smooth
  shadow/border transition. In touch mode, each card supports horizontal **swipe gestures**
  (right = study, left = archive) with a directional glow that follows the finger and a
  springy snap-back on release.
- **Learn answer feedback:** the instant a card is graded, a soft full-width glow rises from
  the foot of the screen — green for correct, muted red for incorrect — for ~0.5 s. It is
  purely decorative (`pointer-events-none`), fired independently of the async write so the
  reward always lands on the keypress, and never delays the next card. A radial ring
  pulses outward from centre as a secondary cue.
- **Flip card:** the question/answer faces swap with a 3-D `rotateX` flip (perspective 1600).
  Swipe gestures (right = Yes, left = No) share the same spring physics as the deck card
  swipes; the flip card is the only place in the app that combines rotation with translation.
- **Touch bottom sheets:** in touch mode, the Learn grading controls live in a fixed
  bottom sheet that springs in and out, with a drag handle that closes the sheet when
  dragged down past a threshold or flicked quickly. The card-actions menu is a similar
  bottom sheet rather than a dropdown.
- **Session report:** the whole panel rises in; reaching the goal springs in a tick badge;
  the four stat tiles reveal in sequence.
- **Tabs / chips:** the active deck-view tab underline is a shared-layout element
  (`layoutId="deck-tab"`).
- **Toasts:** slide in from the right with a slight scale.
- **Dashboard streak:** the flame icon gently pulses/rotates while a streak is alight; the
  streak number springs when it changes.
- **Pomodoro timer:** the compact face in the Learn header is a 36px SVG ring with a
  progress arc; the expanded popup is a 160px circular timer with a smooth 1Hz tick.
- **Mobile drawer:** scrim fade plus a spring slide-in of the sidebar.
- **Splash / route fallback:** the initial "Lacuna" wordmark fades up and breathes while the
  database opens; lazy routes show a pulsing "Loading…".

### 3.4 Touch-first design system

Added in v0.0.2. Every interactive element meets a 44px minimum target size (per
WCAG 2.5.5 / Apple HIG), and the app supports two input modes (`auto`, `touch`, `keyboard`)
chosen in Settings (§15). The mode drives which affordances are visible (hover-only on
desktop vs. always-visible on touch) and which gestures are enabled (swipe-to-act on touch,
keyboard shortcuts on keyboard).

- **44px targets.** `Button` enforces `min-h-11` (44px) on every size variant. All
  icon-only buttons, tabs, chips, filter controls, breadcrumb links and menu items inherit
  the same minimum.
- **Active states.** Touch-interactive elements carry an explicit `active:bg-ink/10` or
  variant-specific `active` colour so the press is visible without relying on a `:hover`
  that never fires on touch.
- **Swipe gestures** (touch mode only, gated on the resolved input mode). The deck cards
  swipe right to study and left to archive; the Learn flip card swipes right for Yes and
  left for No. Swipes are springy (a `useSpring`-backed `useMotionValue`), with a
  directional glow that follows the finger, a threshold past which the action commits, and
  a snap-back below the threshold. The first successful Learn swipe hides the persistent
  swipe hints via a `localStorage` flag (`lacuna.learnHints`).
- **Bottom sheets** (touch mode). The Learn grading controls and the per-card actions menu
  render as bottom sheets with a drag handle, a scrim backdrop and a focus-trapped dialog
  role. On keyboard, the same actions live in a dropdown menu.
- **Long press.** `useLongPress` fires after a configurable hold (default 500ms) and is
  available for future touch-specific affordances; the current release wires it into the
  card list for bulk-select by long-pressing a row.
- **Touch-visible utility.** A `touch-visible` class forces hover-only affordances to stay
  visible on `(hover: none)` devices (no-hover media query), so they cannot be hidden
  from touch users.
- **Input-mode awareness.** The `useIsTouchMode` hook (`src/state/inputMode.ts`) reads the
  user's setting and resolves `auto` to `touch` or `keyboard` based on the device's touch
  capability. Components use it to switch between bottom sheets and dropdowns, show or
  hide swipe hints, and swap hover-only styles for always-visible ones.

### 3.5 Layout grid & surfaces

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
+----------+--------------------------------------------+
| SIDEBAR  | (mobile only) top bar: Lacuna              |
| (desktop)|--------------------------------------------|
|          |                                            |
| Lacuna   |  <main> -- routed page, scrolls            |
|          |  independently; page transitions           |
| > Dash.. |  animate here                              |
| > Study..|                                            |
| > Search |                                            |
| > Share  |                                            |
| > Setting|                                            |
|          |                                            |
| DECKS    |                                            |
| - Organ..|                                            |
| - French |                                            |
|          |                                            |
| [v] coll |                                            |
+----------+--------------------------------------------+
```

- **Sidebar** (`Sidebar`): brand; primary nav (Dashboard, Study today, Search, Share,
  Settings); a live deck list (each with an accent dot when active, an optional due-count
  badge, and an "Archived" chip on archived decks); a **streak badge** on the Study today
  item that springs in when a streak is active; footer with a theme toggle and a collapse
  toggle. Collapsing animates the width to 72 px and hides labels. Active state is a
  sliding shared-layout marker. State (`collapsed`), compact mode, and whether to show
  archived decks / due counts are all persisted to `localStorage` via
  `useSidebarSettings`.
- **Mobile:** the sidebar becomes a drawer opened from a top bar burger; the scrim closes
  it; it auto-closes on navigation. On desktop the sidebar is always visible; on touch
  viewports the burger is the only way to reach it.
- **Global keyboard shortcuts** (within the shell): `Ctrl/Cmd+K` toggles the command
  palette; `/` opens full search; `?` toggles the keyboard-hints overlay. Single-key
  shortcuts are inert while typing in an input/textarea.
- **Error boundaries:** one wraps the whole app, one wraps each page, and one wraps the
  Learn session.

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

+ streak ------+ reviewed today + next 7 days mini-spark ----+
+--------------+---------------+--------------------------------+

+ Study today -----------------------------  [> Study all ] +
| N cards ready across all your decks...                       |
+------------------------------------------------------------+

+ Deck card + + Deck card + + Deck card +
| Exam in 6d| | ...        | | ...        |  (responsive grid)
| Name      | |            | |            |
| 42 cards  | |            | |            |
| bar 68%   | |            | |            |
+-----------+ +------------+ +------------+
```

Header with title and New-deck / Select buttons; a motivation strip (`StudySignals`); a
global "Study today" call-to-action when any card is due; an inline new-deck composer
(blank or import, animated open/close); a selection action bar in select mode (bulk delete
with undo, cross-deck merge with target chooser, move-to-folder); folder support (nested
collapsible groups in the sidebar and the dashboard grid); an "Archived" group at the
bottom; and a review-activity heatmap for anyone arriving from Anki. Empty state invites
creating the first deck. All transitions between these regions are coordinated by
`LayoutGroup` so adding, removing or reordering decks does not stutter.

**Deck view** (`/deck/:deckId`):

```
< All decks
Exam in 6 days - 14 Jun 2026, 23:59
Organic Chemistry                         [s]  [> Study ]
+ Predicted exam score -------------- 68% +
| bar ........................                |
| Mean predicted retrievability on exam day.  |
+---------------------------------------------+
[ Cards ]  [ Analytics ]            <- tab underline slides
tag chips: All . acids . mechanisms ...
<card list with editor> | <analytics charts>
```

**Learn session** (full screen, outside the shell):

```
+ header (hidden in focus mode) -----------------------+
| [=] ORGANIC CHEMISTRY               68% predicted   |
|     bar .....                   (Pomodoro)  [Exit]  |
+----------------------------------------------------+
|                                                    |
|     +-- flip card (rotateX flip on reveal) --+     |
|     |   QUESTION / ANSWER                     |     |
|     +-----------------------------------------+    |
|                                                    |
|        [   Show answer   ]                          |
|     (after reveal)  [ X No ]  [ OK Yes ]           |
|                  <-> Undo last answer              |
+----------------------------------------------------+
   (green/red glow rises from the bottom on grading)
```

See §3.4 for the full touch-first design system that backs these affordances. In touch mode the bottom controls become a **bottom sheet** that springs up from the
foot of the screen with a drag handle, and the flip card accepts left/right swipes as a
Yes/No equivalent. In keyboard mode, `Y`/`N` (silent) or `1`–`4` (manual) are the grading
keys, and the bottom controls are still rendered for discoverability.

**Card editor**, **Deck settings**, **Settings**, **Search** follow the same
centred-column pattern with an eyebrow + display title and `rounded-2xl` sections; the
editor and deck settings add a sticky bottom action bar.

---

## 5. Data model (Dexie, `src/db/`)

All tables are keyed by string `id` unless noted. Types live in `src/db/types.ts`.

### Deck
`id, name, examDate, createdAt, examDatePromptDismissed?, fsrsVersion, fsrsParameters,
examObjective, newCardsPerDay?, archived?, autoOptimise?, folderId?, colour?, timeZone?`
- `examDate` is an epoch-ms instant; **defaults to creation time + 7 days at 23:59 local**.
- `fsrsVersion` is `6`.
- `fsrsParameters = { w: number[21], requestRetention: number }` — the 21 FSRS-6 weights
  (w0..w20; **w20 is the trainable decay**) plus the target retention. The weights may be
  re-fitted to the deck's own history (see §8.1, optimisation).
- `examObjective in { 'expectedMarks' (default), 'securedTopics' }`.
- `newCardsPerDay?` — cap on brand-new cards introduced per day; undefined/0 = unlimited.
- `archived?` — when true the deck is retained in full but withdrawn from all study, the
  global "Today" session and the dashboard study totals (one of the explicit post-exam
  choices, see §8.2).
- `autoOptimise?` — per-deck override for scheduling optimisation; undefined falls back to
  the global default (on). Applying optimised weights always still needs explicit consent.
- `folderId?` — optional pointer to a `Folder` row for sidebar / dashboard grouping.
- `colour?` — a hex string chosen from the seven swatches; applied to the deck dot and
  to the top accent bar of the card.
- `timeZone?` — IANA zone, used to display the exam date in the user's zone.

### Folder
`id, name, parentId?, createdAt` — a flat (single-level) grouping of decks. Nested folders
are read but the UI is single-level.

### Card
`id, deckId, type('front_back'|'cloze'), front, back, stability|null, difficulty|null,
lastReviewed|null, reps, lapses, state, tags?, suspended?, flagged?, buriedUntil?, due|null,
scheduledDays, learningSteps, history[], createdAt`
- `front`/`back` are Markdown source. **Cloze** source lives entirely in `front`
  (`{{cN::...}}`); `back` is empty.
- `stability` (days; the interval at which R = 0.90), `difficulty` (in [1,10]),
  `lastReviewed`, `due` are all `null` until the first review.
- `reps, lapses, state, scheduledDays, learningSteps, due` mirror ts-fsrs's card fields.
  `state in {0 New, 1 Learning, 2 Review, 3 Relearning}`.
- `history[]` is an append-only array of `ReviewLog` (timestamp, grade, responseTimeSec,
  distracted, stability/difficulty before+after, retrievabilityAtReview|null).

### SessionHistoryEntry
`{ id?, timestamp, deckId, averagePredictedRetrievability }` — written **per answered
card**; analytics aggregate to the last snapshot per calendar day to plot the trajectory.

### UserPerformance (per deck)
`{ deckId, runningMeanResponseTime, runningStdDevResponseTime, m2, totalCorrectReviews }`
— a Welford running mean/variance over **correct (Yes) reviews only**, used to calibrate
the invisible grader.

### ImageAsset / BackupAsset
- `ImageAsset { hash, blob, mimeType, width, height, createdAt }` — a card image stored
  as a **`Uint8Array`** in the `assets` table, keyed by the SHA-256 of its bytes so
  identical images are stored once. (`Blob | Uint8Array` in the type for backward
  compatibility, but the implementation always stores `Uint8Array` for cross-environment
  consistency, including `fake-indexeddb`.) Card Markdown carries only a
  `lacuna-asset://<hash>` reference, resolved to an object URL at render time via
  `toBlob()` and cached per hash for the app lifetime (revoked only at app teardown). This
  keeps reactive card reads small, stops base64 inflating exports and quota, and avoids
  the create/revoke churn on every card flip during a fast Learn session.
- `BackupAsset { hash, data(base64), mimeType, width, height, createdAt }` — the
  JSON-safe form of an `ImageAsset` carried in backup/export files.

### BackupSnapshot / BackupFile / AppStateEntry
- `BackupSnapshot { id?, createdAt, tag?, deckCount, cardCount, payload }` — a stored
  automatic restore point (denormalised counts so the list renders without parsing the
  payload). `tag = 'pre-migration'` marks a snapshot taken automatically before a schema
  upgrade; these are **exempt from daily-snapshot pruning** so a botched migration always
  has a fallback (§13).
- `BackupFile { app:'lacuna', version, exportedAt, decks, cards, assets, sessionHistory,
  userPerformance }` — the shape of both manual exports and snapshot payloads; `assets`
  carries the referenced images.
- `AppStateEntry { key, value }` — small persistent app state (e.g. the backup folder
  handle, sidebar settings, input mode, motion speed).

---

## 6. FSRS-6 engine wrapper (`src/fsrs/fsrs.ts`)

A thin, pure translation layer over `ts-fsrs`. **No memory maths is implemented by hand.**

- `makeEngine(params)` builds an FSRS-6 scheduler: `fsrs({ w, request_retention,
  enable_short_term: true })`.
- `decayOf(params) = -params.w[20]` — the (always negative) forgetting-curve decay exponent.
- `toTsCard(card, now)` / `fromTsCard(ts, now)` map between Lacuna's persisted card shape
  and ts-fsrs's; a never-reviewed card becomes a fresh `createEmptyCard` so ts-fsrs applies
  the correct initial-stability/difficulty path.
- `applyReview(engine, card, grade, now)` returns the new memory state plus the
  retrievability at the instant of review (`get_retrievability`, `null` on a first review),
  via `engine.next`.

Constants (`src/fsrs/params.ts`): `FSRS_VERSION = 6`; default weights and request retention
from ts-fsrs; target retention is user-clampable to **[0.80, 0.97]** (default = ts-fsrs
default); difficulty bounds `[1, 10]`; `MASTERY_R = 0.90`; `MS_PER_DAY = 86_400_000`.

**On the algorithm version (honesty note).** Lacuna uses FSRS-6 because that is what
`ts-fsrs` exposes — not because it is the newest FSRS in existence (FSRS-7 exists). Copy
and comments are pinned to "the version ts-fsrs ships", not to "the newest". Also, FSRS
has **no short-term memory model**, so repeated same-evening reviews during exam cramming
are a known limitation; exam-eve cram mode (§10) is the product-level response, but the
underlying maths still does not model intra-day re-review.

---

## 7. Forward simulation & core formulae (`src/fsrs/forwardSim.ts`)

This is Lacuna's own pure layer that projects a card to the **exam date** rather than to
its next due date. It touches neither IndexedDB nor React, so every function is
unit-tested.

**Forgetting curve (FSRS-6 power law).** With `decay = -w20` (negative) and `t`, `S` in
days:

```
factor   = 0.9^(1/decay) - 1
R(t, S)  = (1 + factor . t / S)^decay
```

By construction `R = 0.90` exactly when `t = S`, for any decay. With `decay = -0.5` (the
fixed FSRS-4.5 decay), `factor = 19/81`, so the curve reduces exactly to FSRS-4.5. A card
with `S <= 0` has `R = 0`; elapsed time is clamped at 0.

**Predicted exam-day retrievability with no further review** (`rAtExam`):

```
days = max(examDate - lastReviewed, 0) / MS_PER_DAY
R_no = forgettingCurve(days, stability, decay)
```

A never-reviewed card (no stability/lastReviewed) -> `R_no = 0`.

**Predicted exam-day retrievability if reviewed now** (`rAtExamIfReviewedNow`):

```
daysRemaining = max(examDate - now, 0) / MS_PER_DAY
if daysRemaining == 0 -> 1.0                     (a review on exam day leaves R = 1)
S'   = ts-fsrs.next(card, now, expectedGrade).stability
R_yes = forgettingCurve(daysRemaining, S', decay)
```

The assumed `expectedGrade` is **Good** (deterministic, dependency-free).

**Delta-R — the marginal value of reviewing now** (`deltaR`):

```
DR = R_yes - R_no
```

For a new card `R_no = 0`, so `DR = R_yes`. As a card's exam-day R approaches 1, `DR -> 0`.

---

## 8. The exam objective — the core invariant (`src/fsrs/objective.ts`)

A deck's `examObjective` is the single value from which **both** the scheduler's sort key
and the progress-bar value are derived, so they can never disagree.

### Progress-bar value (`progressValue`, via `src/fsrs/progress.ts`)
- `expectedMarks` -> **mean predicted exam-day R** across the cards:
  `averagePredictedRetrievability = (Σ rAtExam) / n`.
- `securedTopics` -> **fraction of cards with predicted exam-day R >= 0.90**:
  `masteryFraction = |{ c : rAtExam(c) >= 0.90 }| / n`.
- An empty set is treated as `1` for mastery and `0` for the mean.

### Scheduler sort key (`scoreCard`; higher = serve sooner)
- `expectedMarks`: greedy maximisation of Σ R, so the score **is** `DR`.
- `securedTopics`, evaluating each card:
  - if already secured (`R_no >= 0.90`) -> score `-1` (nothing to gain, lowest priority);
  - else if a single review secures it (`R_yes >= 0.90`) -> score `1 + R_no` (a higher
    current R means it is closer to the line and cheaper to secure, so rank those first;
    the `+1` keeps every securable card above every not-yet-securable one);
  - else -> score `R_yes` (make the most progress available toward the line).

### Objective complete? (`isObjectiveComplete`)
- `securedTopics`: every card is at or above 0.90 (`masteryFraction >= 1`).
- `expectedMarks`: no card offers a meaningful further gain —
  `max(DR) < EXPECTED_MARKS_EPSILON (1e-3)`.

Helper copy (`progressNoun`, `progressHeading`, `progressDescription`) phrases the same
number appropriately ("predicted score" vs "secured").

### The scheduling horizon (`src/fsrs/horizon.ts`)
Every function above aims cards at a **single horizon date**, read through
`schedulingHorizon(deck)` rather than `deck.examDate` directly, so the scheduler and
progress bar stay pinned together even once the exam date moves into the past:
- while `examDate >= now` -> the horizon **is** `examDate`;
- once `examDate < now` -> the horizon falls back to a rolling
  `now + MAINTENANCE_HORIZON_DAYS` (7 days). This is the "keep revising" fallback: it
  stops `daysRemaining` clamping to 0 (which would make every card read R = 1 and pin
  the bar to a bogus 100%) and instead has the deck maintain its target retention
  against a moving horizon.

`urgency` (multi-deck blending, §10) likewise uses the horizon, so a passed exam no
longer reads as permanently maximally urgent.

### 8.1 Parameter optimisation (`src/fsrs/optimise.ts`, Web Worker)
The default weights are a starting point; most of FSRS's efficiency comes from fitting
them to a user's own history. Lacuna uses the **official gradient-based trainer** from
the ts-fsrs authors (`@open-spaced-repetition/binding`, fsrs-rs compiled to WASM):
- each card's `history[]` is converted to the binding's review-item format (grade 1–4,
  `deltaT` in days since the previous review, with `0` on the first review);
- `computeParameters()` fits the 21 weights with `enableShortTerm: true`, consistent with
  the scheduler (`makeEngine`);
- fitted weights are **validated against the FSRS clamp ranges** (`CLAMP_PARAMETERS` /
  the same bounds as `clipParameters`) before they can ever be applied; out-of-range
  results are rejected;
- before/after **log loss** is computed on a **held-out validation portion** (the last
  20% of each deck's review history by time) so the metric is out-of-sample, not
  training-set overfitting. The confirmation step only offers to apply the fitted
  weights when they beat the defaults out of sample;
- it is **gated** on `MIN_OPTIMISE_REVIEWS` (1,000) so the train/validation split is
  meaningful;
- it runs in a **Web Worker** (`src/workers/optimise.worker.ts`, initialised via
  `initOptimizer` with Vite `?url` / `?worker` imports; driven by `useOptimiser`) so the
  UI never blocks, reporting trainer progress and the before/after summary. The
  dev/preview server sets cross-origin isolation headers required by the WASM worker;
- new weights are applied only on explicit confirmation, after an automatic pre-change
  restore point; a "Reset to defaults" path is always available. A global default
  (on) and a per-deck `autoOptimise` override govern whether the action is offered
  (§15).

### 8.2 Post-exam state
A deck whose `examDate` has passed is detected (`examHasPassed`) and surfaced clearly
rather than silently stopping. The dashboard card reads "Exam date passed" and the deck
view offers three explicit actions: **set a new exam date**, **archive the deck**
(`archived = true`; retained but withdrawn from study and totals), or **keep revising**
against the rolling maintenance horizon above. Archived decks are excluded from the
study pool (§9), the global "Today" session and the dashboard study denominators, and
are shown in a separate "Archived" group.

---

## 9. Eligibility & study pool (`src/fsrs/eligibility.ts`)

The single rule set that keeps the scheduler and the progress denominator in agreement
when cards are withheld.

- `isAvailable(card)` — not `suspended` and not currently `buried` (`buriedUntil > now`).
  Suspended/buried cards are excluded **entirely**: from the study pool *and* from the
  progress/objective denominator while excluded.
- `newCardsIntroducedToday` — cards whose first-ever review timestamp is today.
- `studyPool(cards, deck)` — returns **empty for an archived deck** (withdrawn from
  study while its cards are retained in the progress denominator), otherwise available
  cards with brand-new (`state 0`) cards rationed by the deck's `newCardsPerDay` cap:
  ```
  budget    = max(cap - newCardsIntroducedToday, 0)
  newAllowed = oldest-first new cards, sliced to budget
  pool       = available cards where state != 0 OR id in newAllowed
  ```
  An undefined/zero cap means unlimited. The cap only rations **today's** study pool;
  it does **not** change the dashboard denominator, so the deck's exam-day trajectory
  stays honest while a session paces new material.

---

## 10. Learn mode (`src/pages/LearnMode.tsx`, `src/fsrs/session.ts`, `cooldown.ts`)

A Learn session may study a **single deck** or **every deck at once** (the global
"Today" session). Both run through one engine so ordering and progress stay
objective-derived.

### Session lifecycle
1. **Load** a static snapshot of the deck(s) and their cards (an optional `?tag=`
   filter narrows a single-deck session). Build a `SessionContext` (one objective
   context per deck) and per-deck `UserPerformance`. Capture `progressBefore`.
2. If there is nothing to study or the objective is already met, go straight to the
   **report**.
3. Otherwise **serve** cards one at a time until the objective is met or the user exits.

### Card selection (`selectNext`)
- **Single deck:** exactly the per-deck objective order (`sortByObjective`) with
  cooldown skipping (`selectNextCard`).
- **Multiple decks:** each card is scored by *its own* deck's objective; scores are
  **min-max normalised within each deck** to 0..1 and weighted by an exam-proximity
  urgency, so figures are comparable across decks with different objectives and
  deadlines:
  ```
  urgency(deck)   = 1 / (1 + daysUntil(schedulingHorizon(deck)))
  priority(card)  = urgency(deck) . (score - min_deck) / (max_deck - min_deck)
  ```
  The highest-priority card not on cooldown is served; if all are on cooldown, the
  soonest-eligible (then highest priority) is served so the session never stalls.
  **Degenerate-range guard:** when a deck's scores are all equal
  (`max_deck - min_deck ≈ 0`, e.g. a single-card or uniform deck) the normalised term
  is treated as `1` instead of dividing by zero, so such decks are still served and
  never produce `NaN`.

### Exam-eve cram mode (`src/fsrs/cram.ts`, `SessionMode = 'cram'`)
An **explicit** mode (entered via `?mode=cram`, never a silent change) for the final
push before an exam. `examEveAvailable(deck)` gates it to the last
`EXAM_EVE_WINDOW_HOURS` (48 h) before the deadline. It reorders study
**weakest-first** (lowest predicted exam-day R first), trading long-term retention for
getting as many cards over the line as possible. It stays objective-aware: under
`securedTopics` it drives still-unsecured cards (< 0.90) first and drops
already-secured cards to the back; under `expectedMarks` it serves the cards with
the most exam-day headroom first. DeckView shows a clearly-labelled "Exam-eve cram"
entry inside the window, stating the trade-off.

### Cooldown (`src/fsrs/cooldown.ts`)
In-memory, per session, to stop a just-failed card being shown again immediately:
```
maxCooldown(deckSize) = deckSize >= 6 ? 5 : max(deckSize - 1, 0)
```
A failed card (grade 1) is given that cooldown; after every answer, all *other*
cards' cooldowns decrement by one (skip-and-decrement).

### Grading modes (`src/state/gradingMode.ts`)
Two modes, chosen in Settings (default **silent**):
- **Silent (default):** the learner presses only Yes/No and the four-point grade is
  inferred (below). This is the product's core UX bet.
- **Manual:** the four FSRS buttons (Again/Hard/Good/Easy) are shown and the user
  grades directly; no inference is applied.

### Study mode (`src/state/studyMode.ts`)
Two modes, chosen per session via the DeckView study dropdown (default **FSRS**):
- **FSRS (default):** the full spaced-repetition scheduler with all memory-state tracking,
  review logging, and objective-driven ordering.
- **Simple:** an algorithm-free study loop with no FSRS scheduling, no DB writes, and
  only YES/NO grading. Wrong cards are re-queued at the end of the deck; the session loops
  until every card has been marked correct. A live pill UI (Wrong / Remaining / Right)
  updates on every answer. The SessionReport omits the grade-distribution chart since
  grades are not meaningful in this mode.

### The invisible timer & grading (`src/fsrs/grading.ts`, silent mode)
- The response timer **starts on reveal** ("Show answer") and **stops when the answer
  is graded**; it runs continuously and never pauses. (Opening the in-session editor
  rebases the timer so editing time is excluded.)
- "No" -> grade **1 (Again)**. "Yes" maps to Easy/Good/Hard by speed:
  - **Calibration** (`totalCorrectReviews < 20`): `< 3 s -> Easy(4)`,
    `> 8 s -> Hard(2)`, else `Good(3)`.
  - **Adaptive** (>= 20 correct): `< μ - 0.75σ -> Easy(4)`,
    `> μ + 0.75σ -> Hard(2)`, else `Good(3)`, where μ and σ are the deck's
    running mean/stddev of correct response times.
- After a correct review, `UserPerformance` is updated by **Welford's online
  algorithm**:
  ```
  n     = totalCorrectReviews + 1
  δ     = t - mean ;  mean += δ / n
  δ2    = t - mean ;  m2   += δ . δ2
  σ     = sqrt(m2 / n)      (0 while n <= 1)
  ```
  Note: calibrating on **correct reviews only** is a biased sample on high-failure
  decks; the prediction-accuracy metric (§14) exists partly to surface when that
  bias is hurting scheduling.

### Per-card actions & state
- **Edit**: opens an in-session overlay (`CardEditOverlay`) that pauses/rebases the
  timer; saving updates the live card without leaving the session.
- **Flag** (toggle), **Bury until tomorrow** (`buriedUntil = startOfDay(now) + 1 day`),
  **Suspend** — all drop the card from the live pool (and the denominator) and move
  on.
- **Undo**: single-step reversal of the last answer — restores the card's prior
  memory state, the `UserPerformance`, the cooldown map, the progress value and the
  events list, and deletes the written `SessionHistory` row.
- **Focus mode** (F): hides all chrome for distraction-free review, leaving a single
  quiet "Exit focus" affordance.
- **Keyboard shortcuts**: accessible via the "Keyboard shortcuts" item in the 3-dot
  action menu, which opens a modal listing all available shortcuts. The `?` key
  still toggles this overlay from anywhere.
- **Distraction** (Page Visibility + window blur) is recorded per card for the report
  only; it never affects the grade.

### Touch-mode affordances (v0.0.2)
- The **grading controls live in a bottom sheet** with a drag handle (down-drag past
  a threshold or a fast flick closes the sheet), a scrim backdrop, and a focus
  trap. The "Show answer" / "Hide answer" sheet and the "Yes/No" / "Again…Easy" sheet
  share the same chrome.
- The **card-actions menu** is also a bottom sheet in touch mode (a dropdown on
  keyboard). Both are wired to `useFocusTrap(true)`.
- The **flip card accepts swipes**: a left swipe (past 60px) commits "No"; a right
  swipe commits "Yes". The first successful swipe hides the persistent swipe hints
  via a `localStorage` flag (`lacuna.learnHints`).

### Pomodoro timer (v0.0.2, `src/hooks/usePomodoro.ts`,
`src/components/learn/PomodoroTimer.tsx`)
A built-in Pomodoro timer (configurable in §15 Settings → Pomodoro) that sits in the Learn header. It runs independently of
the review scheduler — the app does not grade the user on whether they actually
studied — but it provides a tactile, visible session for focus.
- **Settings (per-user, persisted to `localStorage`):** work minutes (1–120,
  default 25), short break minutes (1–60, default 5), long break minutes (1–60,
  default 15), and `autoStartBreaks` (default off).
- **State machine:** `idle -> focus -> shortBreak (every 4th: longBreak) -> idle`.
  Crossing zero auto-advances the phase and (optionally) auto-starts the break.
- **Visuals:** the header face is a 36px SVG ring with a 1Hz progress arc; the
  expanded popup (click the face) is a 160px circular timer with the same arc and a
  centre read-out in display type. Phase colours: focus = accent, short break =
  positive, long break = ink. The popup is closed by `Escape` or outside click and
  uses a focus trap.
- **Input validation:** the load-and-save helpers clamp each minute field to its
  allowed range and fall back to the default if a stored value is `NaN`, so a
  corrupted `localStorage` entry can never crash the timer.

### Recording a review
Each answer calls `recordReview` which applies the FSRS update, appends a
`ReviewLog`, and writes a per-card `SessionHistory` snapshot
(`averagePredictedRetrievability` of the served pool). The progress value is
recomputed and, if the objective is met, the session finishes.

### Completion & the report (`SessionReport`)
The session **auto-ends** when the objective is met (all cards secured, or no card
offers a meaningful gain in Σ R), or on manual exit. The report shows: progress
before -> after (with the objective label), and stat tiles for **cards reviewed,
accuracy, mean correct time, focus %**, plus a grade-distribution bar chart and a
focus note when distractions occurred. Reaching the goal shows a celebratory tick
badge; otherwise "Keep studying" is offered.

### Keyboard
`Space`/`Up` reveal; after reveal `Y`/`J`/`Right` = Yes, `N`/`Left` = No; `E` edit,
`U` undo, `F` focus mode, `?` help (also accessible from the 3-dot menu as
"Keyboard shortcuts"), `Esc` closes overlays/drawer.

### Exam-date prompt
The first time a deck is studied an inline banner (`ExamDateBanner`, not a modal)
asks for the real exam date and time, with a "don't ask again for this deck"
toggle. The date is also editable in deck settings. Once set or dismissed,
`examDatePromptDismissed` is true.

---

## 11. Cards, cloze & the editor

### Cloze (`src/components/markdown/cloze.ts`)
- Notation: `{{c1::hidden answer}}` and `{{c1::hidden answer::optional hint}}`.
- A single card hides **all** `cN` spans at once. On the **front** each span renders
  as a styled blank — `[...]`, or `[hint]` if a hint is given. On the **back** every
  hidden span is revealed and highlighted inline within the full sentence
  (`.cloze-reveal`).
- `nextClozeIndex` powers the editor's auto-indexing Cloze button; `hasCloze` gates
  cloze validity and import.

### Card rendering (`CardContent` -> `MarkdownView`)
Front/back Markdown is rendered with GFM, maths (KaTeX), syntax highlighting, and
raw HTML (for the cloze spans), inside `.prose-lacuna` styling. Memoised per card.

The `MarkdownView` component is backed by a bounded LRU parse cache (parsed HTML
cached by source string, with a TTL-based stale eviction and an LRU fallback), so
re-renders and remounts are O(1) lookups and a full re-parse only runs once per
unique source.

The `MarkdownView` effect tracks the last source it resolved for via a
`useRef` and bails out when the prop is unchanged, so a parent re-render that passes
the same source string does not re-assign `dangerouslySetInnerHTML` and wipe the
user's text selection.

### Cloze highlight (v0.0.2 fix)
The revealed cloze span is rendered with `text-decoration: underline` (and a
faint accent ink shadow) rather than a `background-color` fill, with an explicit
`.cloze-reveal::selection { background-color: hsl(var(--accent) / 0.45); color:
inherit; }` override. The previous `background-color` highlight stacked under
the global `::selection` rule (both painted translucent amber), producing a muddy
double-highlight on selected text inside a revealed cloze. With no element
background, `::selection` paints cleanly across the cloze mark.

### Editor (`src/pages/CardEditor.tsx`, full page)
- Mode is decided by the route (`/cards/new` vs `/cards/:id/edit`).
- **Card type** selector: Basic (front/back), Reversed (back/front), Cloze, or Typing-answer.
  - **Basic:** standard front/back flashcard.
  - **Reversed:** creates an independent card that tests the back as the prompt.
  - **Cloze:** front contains `{{c1::hidden answer}}` deletions; back is empty.
  - **Typing-answer:** the user types their answer during the question phase; on reveal
    the typed answer is shown alongside the correct answer for comparison.
- One or two **Markdown editors** with a live preview; a formatting toolbar (bold,
  italic, heading, lists, code, link, image, cloze auto-index, inline/block maths);
  a cloze editor can preview the revealed answer.
- **Tags** input with deck-wide suggestions.
- **Images** are downscaled to <= 1280 px, re-encoded (~0.8 quality), stored as a
  `Uint8Array` in the `assets` table (deduplicated by SHA-256 hash), and referenced
  from the Markdown as `lacuna-asset://<hash>` — **not** base64 data URIs. The render
  path resolves references to object URLs on display via `toBlob()` and revokes
  them on unmount. This keeps card rows small (base64 inflates payloads ~1/3 and
  dragged full image data through every reactive read) and keeps exports lean.
- **Validation:** front required; back required for front/back; at least one cloze
  for cloze; answer required for typing-answer.
- **Quick capture:** "Save & add another" keeps the page open, clears content,
  retains type and tags, refocuses the first field, tallies a per-sitting count,
  and flashes a "Saved" confirmation. A seamless Tab order runs Front -> Back ->
  Save-and-add -> Save. `Ctrl/Cmd+Enter` saves (and, for new cards, keeps going).
- **Reverse cards:** for a new basic card, an "Also create reverse" toggle
  additionally creates an independent card testing the back.
- **Touch targets:** the toolbar buttons and type-selector are 44px tall with
  active-state colours; on narrow viewports the toolbar scrolls horizontally with
  a hidden scrollbar.

---

## 12. Navigation, decks & card management

- **Dashboard** lists decks in a responsive grid, each showing exam proximity, card
  count and the objective progress bar; a global "Study today" entry point appears
  when cards are due.
- **Folders** (v0.0.2): decks can optionally belong to a `Folder`. Folders are
  collapsible groups in the sidebar and the dashboard grid; they are single-level
  (nested folders are read but the UI is flat). Each folder has a name, an
  optional `parentId`, and creation time.
- **Multi-select** mode supports **bulk delete** (with an Undo toast that restores
  a snapshot), **cross-deck merge** (keeps the chosen target's name, exam date and
  performance history; concatenates the others' cards and session history into it),
  and **move to folder**.
- **Card list** (`CardList`, in the Deck view) supports per-card edit, suspend/flag,
  **move** between decks, and **long-press to bulk-select** (touch mode); a
  tag-filter row scopes both the list and the study session. Clicking a card row
  expands it in-place to show a **per-card forgetting curve** and **vital
  statistics** (see §14, Per-card analysis).
- Deck creation can **start blank** or **import** cards immediately (see §13).

---

## 13. Import, export & backups (`src/db/importEngine.ts`,
`src/db/portability.ts`, `src/db/import.ts`, `src/db/export.ts`,
`src/db/backups.ts`)

### Unified import engine (`src/db/importEngine.ts`)
A single, format-detecting import engine that powers all import locations in the
app:
- **Auto-detection** (`detectFormat`): examines input text and returns a
  `DetectedFormat` (confidence-scored) choosing from: `share-code`, `csv`, `tsv`,
  `markdown-table`, `markdown-list`, `json`, `plain-text`, or `unknown`. Detection
  short-circuits at 100K characters to keep large files responsive.
- **Supported formats:**
  - **CSV/TSV** — quote-aware delimited parser (`parseImport` from `import.ts`).
    Defaults: tab field separator, newline row separator; both customisable.
  - **Markdown table** — GFM tables with `|` separators. Column header mapping:
    `front`/`question`/`term`/`q` -> front; `back`/`answer`/`definition`/`a` -> back;
    `tags`/`tag`/`label` -> tags. Pipes in cell content are escaped on export.
  - **Markdown list** — three patterns: (1) definition-list style
    (`**Term:** Definition`), (2) ordered pairs (even-numbered items paired as
    Q/A), (3) blank-line separated blocks (first non-empty line = front, rest =
    back).
  - **JSON** — array of objects, or object with a `cards`/`data`/`items`/
    `entries`/`notes` key containing an array. Each object maps
    `front`/`question`/`term`/`q` -> front, `back`/`answer`/`definition`/`a` -> back.
  - **Plain text Q/A** — tab, pipe, em-dash, or en-dash separated Q/A pairs. A
    leading `Q:`/`Q.`/`Question:` prefix is stripped.
  - **Share codes** — `LAC0`/`LAC1` prefixed base64 codes, decoded via
    `decodeShareCode`.
- **`parseImportAuto(text, fieldSep?, rowSep?)`** — the main entry point. Detects
  the format and delegates to the appropriate parser. Returns
  `{ cards, skipped, format }`.
- **Legacy parser** (`parseImport` in `src/db/import.ts`): the quote-aware
  delimited parser continues to exist for backward compatibility and is used as
  the CSV/TSV backend. Defaults: **tab** field separator, **newline** row
  separator. Windows/old-Mac line endings are normalised first. Per row: field 1
  = front, field 2 = back, optional field 3 of space-separated tags. A row with a
  back is a front/back card; a single column containing cloze notation becomes a
  cloze card; otherwise the row is skipped.

### Unified export panel (`src/components/import/UnifiedExportPanel.tsx`)
A single, reusable export UI offering multiple output formats:
- **Full backup (JSON)** — complete database snapshot including all decks, cards,
  review history, and images (`downloadBackup`).
- **CSV** — comma-separated values with all card fields.
- **TSV** — tab-separated values, compatible with Anki import.
- **Markdown table** (`exportCardsMarkdownTable`) — GFM table with Deck, Front,
  Back, and Tags columns. Pipes in cell content are escaped.
- **JSON array** (`exportCardsJson`) — array of objects with front, back, tags,
  deck, and type keys. Re-importable into Lacuna.
- **Plain text** — human-readable Q:/A: format with deck and tag metadata.
- **Share code** (optional, requires deck selection) — compact, copy-pasteable
  code via `buildShareCode`.

### Backup file import/export
- **Export:** versioned JSON of the whole database (`BackupFile`: decks, cards,
  **referenced image assets**, session history, user performance). Backups are
  the route that carries images between machines (share codes deliberately do
  not, §13).
- **Import modes:**
  - **Replace all** — wipe then restore exactly.
  - **Merge** — fold in by id. Before committing, a **visible diff** summarises
    what will be **added, changed and overwritten** (counts at minimum) and
    requires **explicit confirmation**; only on confirm are changes applied
    (newest `lastReviewed`/`createdAt` wins per conflicting record). This
    replaces the previous silent "most-recent-wins" merge, which was a
    data-loss footgun.

### Automatic restore points & migration safety
- Up to the **ten most recent** snapshots are kept on-device; one is taken
  automatically on open, **at most once a day** (`autoBackupIfStale`), and never
  blocks the UI.
- **Pre-migration snapshot:** before a schema upgrade rewrites data, a
  `pre-migration`-tagged snapshot is captured in a **separate committed
  transaction** (via a dedicated `lacuna-pre-migration` IndexedDB) so a failed
  upgrade on the main database never rolls the snapshot back with it. The
  snapshot is also mirrored to the configured folder if the File System Access
  API is available. Tagged snapshots are **exempt from the ten-snapshot
  pruning**. The v4 image migration is also idempotent and
  reads-transforms-writes explicitly rather than mutating inside an async Dexie
  `.modify()` callback (which Dexie does not reliably persist).
- Restoring replaces all current data with the snapshot.
- **Folder mirror** (where the File System Access API is supported): each backup
  can also be written to a chosen folder so it survives clearing browser data.
  Where unsupported, the UI explains this and points to manual export.

### Deck sharing — share codes (`src/db/share.ts`, `SharePage`, `/share`)

A dedicated **Share** tab in the sidebar turns deck content into a single,
compact, copy-and-paste **code** and rebuilds decks from one. It is distinct from
backup export: a share code carries only the **material**, never one person's
scheduling or history.

- **What a code contains:** for each deck — name, exam objective, date created
  and **date due** (`examDate`), target retention and any new-card cap — and for
  each card its type, front, back and tags. A `by` (creator) field is reserved for
  future attribution and is currently null.
- **What it omits:** FSRS memory state, review history, suspended/buried/flag
  state — **and images**. Image references are stripped to a text placeholder.
  DEFLATE does almost nothing to already-compressed image bytes, so embedding
  them produced multi-megabyte "codes" that defeated the copy-and-paste premise.
  When a selected deck contains images the export UI says so before generating
  and points to the full **backup export** as the route for transferring images;
  on import, stripped images render as the placeholder and the preview notes
  they were not included. Imported cards always start with clean scheduling for
  their new owner.
- **Compression**, in order of impact:
  1. **Reverse-pair folding** — a front/back card and its exact mirror (one's
     front = the other's back and vice versa) are detected and stored **once**
     as a single "reversible" entry (`k:2`), then expanded back into two
     independent cards on import (the same shape `createCardWithReverse`
     produces). This directly exploits the reverse-cards feature.
  2. Compact single-letter JSON keys.
  3. **DEFLATE** via the native `CompressionStream('deflate-raw')` when
     available, then base64.
- **Format:** a short scheme tag (`LAC1` = compressed, `LAC0` = plain fallback
  when the browser lacks compression) followed by base64 — i.e. just letters,
  digits and base64 punctuation. A version field inside the payload guards
  forward compatibility; an unknown or corrupted code yields a readable error.
- **Export UI:** a multi-select list of decks (with per-deck card counts and a
  select-all), a "Generate share code" action, then the code shown in a
  read-only monospace box with a one-click **Copy** and a character count.
- **Import UI:** a styled paste box (accent focus ring); "Read code" decodes and
  shows an inline confirmation preview (deck and card counts, the share date,
  and the deck names as chips) before "Add to my decks" commits. Importing
  always **creates new decks** — it never overwrites existing data.
- Round-trip behaviour (content, cloze, reverse-pair expansion, multi-deck
  bundling, date due preservation, clean scheduling state, and rejection of
  non-codes) is covered by `src/db/share.test.ts`.

---

## 14. Search & analytics

### Search (`src/db/search.ts`, `SearchPage`, `CommandPalette`)
- A pure, offline, case- and diacritic-insensitive substring search over a card's
  front, back, its deck name and its tags.
- **Ranking:** front matches rank above back/deck/tag matches; earlier match
  positions rank first.
- **Structured filters** (AND-combined, usable without a query): **due, new,
  leech, flagged, suspended**. These turn search into deck management ("show me
  all leeches").
- The full-page Search and the `Ctrl/Cmd+K` command palette share the same core;
  results link straight to the card editor. `plainPreview` strips
  Markdown/cloze/images for previews.
- **Leech** = a card with `lapses >= 8` (`src/fsrs/leech.ts`); surfaced via a
  badge and the search filter, but scheduling is never changed automatically.

### Dashboard signals (`src/fsrs/stats.ts`, `StudySignals`)
Pure aggregates over stored history, in local time:
- **Streak:** consecutive studied days counting back from today (a not-yet-studied
  today does not break a streak that includes yesterday).
- **Reviewed today:** count of review logs dated today.
- **Seven-day forecast:** each scheduled card is bucketed by its effective due
  day (overdue folds into today, beyond the window is ignored) and weighted by
  its deck's **mean review seconds** (fallback 8 s) to estimate **minutes of
  study per day**, shown as a small bar sparkline with a "minutes to clear"
  total.
- **Review heatmap** (`src/fsrs/heatmap.ts`, `ReviewHeatmap`): a
  contribution-style calendar of reviews per **local** calendar day (a 26-week
  grid), built from review logs and theme-aware via accent-opacity bands.
  Expected by anyone arriving from Anki. The header carries the count and the
  week range; a **month-name row** above the cells shows a short month label on
  the first column of each new month so the calendar is readable without a
  separate legend. Weekday labels (Mon/Wed/Fri) line up exactly with their
  cells.

### Per-card analysis (`CardAnalytics`)
Each card in the deck card list can be expanded in-place to reveal a
**forgetting curve** and **vital statistics** for that individual card:
- **Forgetting curve** — an `AreaChart` projecting retrievability from the
  card's most recent review forward to `examDate + 14 days`, with historical
  review moments overlaid as grade-coloured dots. Vertical reference lines mark
  the current time (`Now`) and the exam date (`Exam`). Never-reviewed cards show
  an inviting empty state.
- **Vital statistics** — a grid of tiles showing: stability, difficulty, current
  retrievability, predicted exam-day retrievability, total reviews, lapses, due
  date, days since last review, mean response time and accuracy.
- **Grade distribution** — animated mini-bars for Again / Hard / Good / Easy
  counts.
- Expansion is toggled by clicking the card row; only one card may be expanded
  at a time. Hover still reveals the card back (desktop), while the expanded
  panel captures click events so interacting with the chart does not collapse
  the view. The row is keyboard-accessible (`Enter`/`Space` toggles expansion).

### Deck analytics (`DeckAnalytics`)
Theme-aware Recharts panels:
- **Predicted exam-day score** over time (area chart of the daily
  `SessionHistory` trajectory).
- **Prediction accuracy** (`src/fsrs/calibration.ts`): the silent grader made
  measurable. From `history[]` (which logs grade, response time and
  `retrievabilityAtReview`) it compares predicted retrievability at review
  against the actual recall outcome (a **Brier/log-loss** calibration metric,
  bucketed over time; lower is better), with a one-line plain-English
  explanation. A developer-facing `gradeQualitySummary` (exposed on `window` and
  console-exportable) reports how the inferred grades distribute and whether
  faster responses really correlate with higher subsequent recall, so the
  response-time thresholds can be validated rather than assumed.
- **Card stability profile** (histogram of cards by stability range; new cards
  distinct).
- **Review volume** (reviews per day over the last 30 days).

### Global analytics (`/analytics`)
A cross-deck view, sharing the same Recharts primitives as `DeckAnalytics` but
aggregating across every deck:
- **Deck comparison** — select any two decks and see their statistics side by
  side (cards, predicted score, mastery fraction, cards reviewed, total reviews,
  reviews today, leeches, mean stability, mean difficulty). Each metric renders
  as **two stacked rows** — one per deck — with a colour swatch, a percentage
  bar, and a right-aligned value, so the values can never overlap or fight the
  winner badge.
- **Forecast** — cards due and new cards scheduled per day for the next 30
  days.
- **Predicted exam-day score** — average predicted retrievability across all
  decks over time.
- **Prediction accuracy** — Brier score for predicted vs actual recall.
- **Review volume** and **Study time** — daily counts and minutes over the past
  30 days.
- **Retention by age** — recall rate grouped by how long each card has been in
  review.
- **Leech count by deck** — horizontal bar chart of leeches per deck.
- **Stability profile** — distribution of cards by stability range.

Charts are wrapped in `ChartCard` (a consistent titled frame with an empty
state), in a `lg:grid-cols-2` grid. `FadeInView` triggers the entrance
animation on approach (`viewport amount: 0` with a 100px bottom margin) so
charts below the fold are never invisible. Each chart container is `h-64` with
`min-w-0` so a chart cannot push its grid track wider than its share.

---

## 15. Settings (`src/pages/Settings.tsx`)

- **Appearance:** theme toggle (defaults to **dark**); **accent colour** swatches
  (7 choices); **text size** steps that scale all text. All three persist to
  `localStorage` (via `ThemeContext`, `AccentContext`, `FontScaleContext`).
- **Motion:** a **motion-speed** setting with three steps (default, faster,
  off) that multiplies every animation and transition duration in the app by a
  single value. Useful for users who find the standard motion too gentle (or,
  on a slow device, too busy). Persisted to `localStorage`.
- **Input mode** (v0.0.2): `auto` (default — `touch` on touch devices,
  `keyboard` otherwise), `touch`, or `keyboard`. The choice drives whether the
  app renders bottom sheets vs. dropdowns, shows or hides swipe hints, and swaps
  hover-only affordances for always-visible ones. Persisted to `localStorage`.
  Switching to touch mode from the default font scale automatically sets the font
  scale to Large (1.15); switching back to keyboard never clobbers an explicit choice.
- **Pomodoro** (v0.0.2): work / short break / long break minutes and
  `autoStartBreaks`. The Pomodoro timer is otherwise fully usable from the Learn
  header.
- **Study & scheduling:** **Manual four-point grading** toggle (off by default ->
  silent grader, §10) and the global **Optimise scheduling** default (on -> fit
  FSRS weights to your own history, §8.1; gated at `MIN_OPTIMISE_REVIEWS`,
  overridable per deck, applied only on confirmation).
- **Sidebar** (v0.0.2): show due counts (on by default), show archived decks
  (on by default), compact mode (off by default), and per-nav-item visibility
  toggles. Persisted to `localStorage`.
- **Gesture settings** (v0.0.3): the swipe-left and swipe-right actions on dashboard
  deck cards can be customised (study / archive). Persisted to `localStorage`.
- **Import & export:** export all data; import from file with the inline
  Merge / Replace-all chooser described in §13.
- **Persistent storage:** the app requests `navigator.storage.persist()` on
  first run so the browser does not silently evict IndexedDB data under storage
  pressure. The result (persisted, denied, or unsupported) is surfaced honestly
  in the backup area of Settings, with a clear warning when persistence is
  denied and a pointer to regular exports or folder mirroring as the safeguard.
  A `useStorageQuotaWarning` hook (§16) also surfaces a non-blocking toast when
  the browser reports the database is approaching its quota.
- **Automatic backups:** "Back up now"; folder-mirror controls (where
  supported); a list of restore points (timestamp + deck/card counts) each with
  Delete and a two-step Restore confirmation.
- **Install** (where supported): a panel of platform-specific install
  instructions (PWA, Windows installer, etc.), driven by `useInstallPrompt`.

### Deck settings (`src/pages/DeckSettings.tsx`)
Rename; exam date and time; **exam objective** toggle (Expected marks <-> Secure
topics, with live explanatory copy); **new cards per day** cap; **target
retention** slider (0.80–0.97, with Relaxed/Balanced/Thorough presets and
adaptive guidance copy); deck colour swatch; deck time zone.
- **Scheduling optimisation** (§8.1): a per-deck on/off override, a review-count
  gate, and an **Optimise now** action that runs in a Web Worker with a progress
  bar, then shows the before/after log loss. Applying takes a restore-point
  snapshot first; **Reset to defaults** is always available.
- Once the **exam date has passed** (§8.2), the deck view offers set-new-date /
  archive / keep-revising; an archived deck shows a restore action.
- A "Danger zone" deletes the deck immediately with an Undo toast (no blocking
  dialog). Sticky Save/Cancel bar.

---

## 16. Persistence, seeding & resilience

- All reads use Dexie `useLiveQuery` hooks (`src/state/useData.ts`) so the UI
  reacts to writes automatically.
- On first run a **demo deck** is seeded (`seedIfFirstRun`).
- A daily restore point is taken in the background after seeding.
- **Error boundaries** at the app, page and Learn-session levels keep a failure
  in one area from blanking the whole app. Their fallback offers a **local-only
  diagnostic bundle** (`src/db/diagnostics.ts`): "Copy diagnostic details" /
  "Download diagnostic bundle" assemble the error and stack, app version
  (`__APP_VERSION__`), browser/UA, and deck/card/review/backup counts. Card
  content is **excluded by default**; including a small sample is a separate,
  explicit opt-in. Nothing is transmitted — the bundle is the user's to paste
  into a bug report.
- **Storage-quota warning** (v0.0.2, `src/hooks/useStorageQuotaWarning.ts`):
  polls the Storage API on a long interval and surfaces a non-blocking toast
  when the database is approaching its quota, with a "Back up now" action that
  jumps to the Settings backup area.
- Migrations live in `src/db/migrations.ts`; the schema is versioned in
  `src/db/schema.ts`, and every upgrade is fronted by a pre-migration restore
  point (§13).

---

## 17. Accessibility & internationalisation

- Honours `prefers-reduced-motion: reduce` (all animation/transition durations
  collapse) and the per-user **motion-speed** setting.
- Focus-visible rings on interactive controls; `aria-label`/`title` on icon
  buttons; `aria-pressed` on toggles and chips; `role="progressbar"` with value
  attributes on the bar.
- Tabular numerals for figures; balanced text wrapping for headings.
- Every interactive element meets a **44px minimum target** (per WCAG 2.5.5 /
  Apple HIG), and touch-interactive elements carry explicit **active states** so
  presses are visible without `:hover`.
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
| Card editor | `Tab` | Front -> Back -> Save-and-add -> Save |
| Learn | `Space` / `Up` | Show answer |
| Learn | `Down` | Hide answer |
| Learn (silent grading) | `Y` / `J` / `Right` | Yes (correct) |
| Learn (silent grading) | `N` / `Left` | No (incorrect) |
| Learn (manual grading) | `1`, `2`, `3`, `4` | Again / Hard / Good / Easy |
| Learn | `E` | Edit current card |
| Learn | `U` | Undo last answer |
| Learn | `F` | Toggle focus mode |
| Overlays | `Esc` | Close |

Single-key shortcuts are inert while a text field is focused. The `?` overlay can
also be opened from the "Keyboard shortcuts" item in the Learn mode 3-dot action
menu.

---

## 19. Electron desktop build

Lacuna can be packaged as a standalone Windows desktop application via Electron.
The Electron layer lives in `electron/` and wraps the existing Vite SPA without
modifying the renderer source.

### Architecture
- **Main process** (`electron/main.ts`): creates a frameless `BrowserWindow`,
  injects Cross-Origin Isolation headers (COOP/COEP) required by the FSRS WASM
  trainer, registers a custom `app://` protocol for production builds, and
  manages window lifecycle (single-instance lock, close/minimise/maximise).
- **Preload** (`electron/preload.ts`): exposes a minimal `electronAPI` via
  `contextBridge` for platform detection and window controls.
- **Titlebar** (`src/components/layout/Titlebar.tsx`): a custom React component
  that renders window controls (minimise, maximise/restore, close) when running
  inside Electron. Only mounts when `window.electronAPI.isElectron` is truthy,
  so the web version is completely unaffected.
- **Fonts** (`electron/assets/fonts/`): Fraunces, Geist and JetBrains Mono
  bundled as local TTF variable fonts. The main process injects
  `electron/fonts.css` via `webContents.insertCSS` so the app works fully
  offline.
- **Auto-updater** (`electron/updater.ts`): uses `electron-updater` with GitHub
  Releases; checks for updates shortly after launch and notifies the renderer.

### Scripts
- `npm run electron:dev` — runs Vite dev server and Electron in parallel.
- `npm run electron:build:win` — compiles the Electron TypeScript, builds the
  Vite SPA with `--base ./`, and packages via electron-builder (NSIS
  installer).

### Build output
Packaged files land in `release/` (gitignored). The electron-builder
configuration is at `electron/electron-builder.yml`.

---

## 20. v0.0.3 changelog

### New features
1. **Simple learn mode** — an algorithm-free YES/NO study loop with no FSRS scheduling,
   no DB writes, and a live pill UI (Wrong / Remaining / Right). Cards are re-queued at
   the end when marked wrong; the session loops until all cards are correct. The
   SessionReport skips the grade-distribution chart. Added `useStudyMode` hook
   (`src/state/studyMode.ts`) with `fsrs` and `simple` modes.
2. **Card types** — cards can now be Basic, Reversed, Cloze, or Typing-answer. The typing
   card shows a live input field during the question phase and compares the typed answer
   against the correct answer on reveal. The card editor and edit overlay both have a
   type selector and a conditional answer field. Repository functions updated to persist
   `cardType` and `answer`.
3. **Simple learn in study dropdown** — the existing DeckView study dropdown now includes
   Simple learn alongside Cram, Due, New, Leech, and Flagged options.
4. **Folder deletion** — folders can now be deleted from the dashboard with a
   confirmation dialog that shows affected deck counts.
5. **Gesture settings** — swipe actions on dashboard deck cards are configurable in
   Settings (study / archive).

### Bug fixes
1. **Text selection focus ring** — removed the internal `box-shadow` ring on
   `input:focus-visible` so only the external `:focus-visible` ring applies.
2. **Share code importing** — Base45 whitespace stripping corrupted share codes because
   the Base45 alphabet includes space as a valid character. Now only legacy base64
   (LAC0/LAC1) formats strip whitespace.
3. **Touch font scale** — auto-set font scale to Large (1.15) when switching to touch
   mode from the default (1.0); never clobber explicit choices when switching to keyboard.
4. **Font scale sync** — wired a `lacuna:font-scale` custom event so the Settings page
   reflects font scale changes immediately after input mode switches.
5. **ESLint errors** — fixed 10 ESLint errors across Dashboard, DeckSettings, and LearnMode.

### Quality
- TypeScript is clean (`tsc --noEmit`).
- 332 tests pass across the full suite.
- All UI changes follow the touch-first design system (44px targets, active states,
  bottom sheets on touch, keyboard shortcuts on desktop).

---

## 21. v0.0.2 changelog

This release is a **touch-first redesign** layered on top of v0.0.1, plus five
bug fixes uncovered during the redesign and a storage-layer change for
cross-environment consistency.

### Touch-first redesign (Stages 1–14)
- **Input mode setting.** A new `InputMode` (`auto` / `touch` / `keyboard`)
  drives the entire app. `auto` resolves to `touch` on touch devices and
  `keyboard` otherwise; explicit choices persist to `localStorage`. The
  `useIsTouchMode` hook is the single read point for components.
- **Pomodoro timer** in the Learn header. A 36px SVG ring face expands into a
  160px circular timer with phase colours (focus / short break / long break)
  and a 1Hz progress arc. Work / short break / long break minutes and
  `autoStartBreaks` are configurable in Settings. The timer is fully usable
  with one hand in touch mode.
- **44px minimum touch targets** across `Button` (every variant and size),
  tabs, chips, icon buttons, filter controls, breadcrumb links, and menu items.
- **Swipe gestures** on the dashboard deck cards (right = study, left =
  archive) and on the Learn flip card (right = Yes, left = No), with a
  directional glow that follows the finger, a 50–60px commit threshold, a
  springy snap-back below the threshold, and a `localStorage` flag
  (`lacuna.learnHints`) that hides the persistent hints after the first
  successful swipe.
- **Bottom sheets** (touch mode) for the Learn grading controls and the
  per-card actions menu, with a drag handle, scrim backdrop, focus trap, and
  a down-drag or fast-flick-to-close. The keyboard equivalent is a dropdown.
- **Long-press to bulk-select** in the card list (touch mode), powered by
  `useLongPress`.
- **Active states** on every touch-interactive element (e.g.
  `active:bg-ink/10`) so presses are visible without `:hover`.
- **Folder support.** Decks can belong to a `Folder`; folders are collapsible
  groups in the sidebar and the dashboard grid.
- **Sidebar polish.** Due-count badges, an "Archived" chip, a streak badge on
  the Study-today item, and configurable compact mode / per-nav-item visibility.
- **Settings motion-speed and input-mode controls.**
- **Motion-speed-aware animations.** Every duration in the app is multiplied
  by a single user-configurable value, so the app can be as snappy or as
  gentle as the user prefers.
- **LayoutGroup reflows** on the dashboard so adding, removing, archiving or
  reordering decks does not stutter.
- **Storage-quota warning** (`useStorageQuotaWarning`) surfaces a non-blocking
  toast when the database is approaching its quota.
- **Install-prompt panel** in Settings (PWA / Windows installer links where
  supported).
- **PWA service worker** for offline use, registered at the application root.

### Storage layer
- Image assets are now stored as **`Uint8Array`** in the `assets` table rather
  than as `Blob`, because `fake-indexeddb` (and some browser IndexedDB
  implementations) does not reliably preserve `Blob` objects through
  structuredClone. DOM APIs that need a `Blob` receive one via `toBlob()`.
  This is invisible to the user but eliminates a class of test/environment
  flakiness.
- The asset render cache is LRU-bounded with TTL-based stale eviction, so the
  live editor preview (a new source string per keystroke) cannot grow it
  without limit.

### Bug fixes (5)
1. **Deck comparison overlapping layout** — the comparison bars were in a
   single side-by-side track with a 0.5px separator and a winner badge at
   `right-0`. The badge could be clipped by `overflow-hidden` and the right
   bar could overflow on narrow widths. Restructured to two stacked rows (one
   per deck), each with a colour swatch, a bar track, and a right-aligned
   value; the winner badge moved to the metric label row.
2. **Double text selection on revealed cloze spans** — the
   `.cloze-reveal` `background-color` highlight stacked under the global
   `::selection` rule (both painted translucent amber), producing a muddy
   double-highlight on selected text inside a revealed cloze. Switched to
   `text-decoration: underline` and added a `.cloze-reveal::selection`
   override using a stronger accent fill. Also fixed an unrelated selection-
   flicker in `MarkdownView` by tracking the last resolved source with a
   `useRef` and bailing out of the effect when the prop is unchanged.
3. **Dashboard reflow stutter** — the deck cards had **both** a delayed
   initial mount animation and a layout reflow animation, so the two fought
   each other when a deck was added, removed, archived, or moved. Wrapped the
   deck grid in motion/react's `LayoutGroup` so the reflows are coordinated,
   and removed the per-card mount-stagger `delay`.
4. **Review heatmap alignment** — the weekday labels sat 2px lower than the
   cells they were labelling because the labels container had a `pt-[2px]`
   that the cell grid did not. Removed the offset so Mon/Wed/Fri line up with
   their rows. Also added a month-name row above the grid.
5. **Analytics charts invisible below the fold** — `FadeInView` required
   `amount: 0.1` of the element to be visible before animating, so charts
   below the fold on shorter viewports stayed at `opacity: 0`. Lowered the
   threshold to `amount: 0` with a 100px bottom margin so the animation fires
   as soon as the chart approaches the viewport. Also grew `ChartCard` from
   `h-56` to `h-64` and added `min-w-0` so charts cannot push their grid
   track wider than their share.

### Quality
- The test suite now covers UI components, hooks, and state-management
  modules in addition to the data and FSRS layers (Vitest with
  `fake-indexeddb` for the database, `@testing-library/react` and
  `happy-dom` for the UI).
- 328 tests across 52 files, all green.
