# Lacuna — version 0.0.3

> **GitHub Release Note for v0.0.3**
>
> This patch release expands test coverage to page-level flows, adds virtualisation for large card lists, and polishes mobile gesture interactions.
>
> **What's new**
> - Page-level integration tests for CardList, Dashboard, SharePage, SessionReport, and LearnSkeleton.
> - Lightweight dependency-free virtual card list for decks with more than 50 cards.
> - Haptic feedback on all major mobile gestures (swipe, long-press, grade, tray actions).
> - Spring physics on card swipe snap-back and bottom-sheet drag handles.
>
> **Bug fixes**
> - Fixed image-asset handling in `fake-indexeddb` test environments (continued from v0.0.2).
> - Fixed pre-existing `touchstart` type error in Dashboard.
> - Fixed DeckSearchOverlay props destructuring bug.
>
> **Full changelog below**

## 0.0.3 — Page-level tests, card list virtualisation, and mobile gesture polish

- Added page-level integration tests:
  - `CardList.test.tsx`: empty state, card rendering, select mode, selection toggling, card expansion, import panel, new card button.
  - `Dashboard.test.tsx`: skeleton, empty state, deck cards, select mode, folder rendering, header buttons.
  - `SharePage.test.tsx`: loading, empty state, deck list, selection, import section.
  - `SessionReport.test.tsx`: goal reached, stat values, progress bar, chart rendering, back button, daily limit, distractions.
  - `LearnMode.test.tsx`: LearnSkeleton rendering, header and main structure.
- Added `useVirtualList` hook — a lightweight dependency-free virtual list with window scroll tracking, binary search for visible ranges, and dynamic item measurement via `ResizeObserver` / `getBoundingClientRect`.
- Integrated virtualisation into `CardList` with a threshold of 50 cards. Small decks render as a simple grid; large decks use absolute positioning with `translateY` to keep only visible cards in the DOM.
- Added `skipAnimation` prop to `CardRow` so cards that scroll back into view do not re-trigger entrance animations.
- Added `src/utils/haptic.ts` — a haptic feedback utility with light, medium, and strong vibration patterns via `navigator.vibrate`.
- Triggered haptic feedback on gesture commits: long-press (`hapticStrong`), swipe-to-grade (`hapticMedium`), swipe-to-study (`hapticMedium`), mastery gestures (`hapticMedium`), card tray open/close (`hapticLight`), and tray actions (`hapticLight` / `hapticMedium`).
- Added spring physics to `FlipCard` swipe (`stiffness: 480`, `damping: 32`) for snap-back instead of abrupt reset.
- Polished `TouchMenuSheet` drag handle with drag-to-close gesture, keyboard accessibility (Enter/Space to close), and a larger touch target.
- Fixed pre-existing `touchstart` type error in `Dashboard.tsx` (`MouseEvent` → `Event`).
- Fixed `DeckSearchOverlay` props destructuring bug.

---

# Lacuna — version 0.0.2

> **GitHub Release Note for v0.0.2**
>
> This patch release focuses on reliability, test coverage, and visual polish.
>
> **What's new**
> - Smoother page transitions and toast animations throughout the app.
> - Added a comprehensive unit-test suite covering UI components, hooks, and state modules.
>
> **Bug fixes**
> - Fixed image-asset round-trip handling in test environments (`fake-indexeddb`) by storing assets as `Uint8Array` and converting back to `Blob` on demand.
> - Fixed `usePomodoro` settings parsing so `0` is handled correctly.
> - Fixed a typo in the Dashboard copy ("examotion" → "exam").
> - Prevented test-suite race conditions by disabling parallel test-file execution.
>
> **Full changelog below**

## 0.0.2 — Bug fixes, test suite hardening, and visual polish

- Fixed `fake-indexeddb` Blob round-trip issue by storing image assets as `Uint8Array` and converting back to `Blob` via `toBlob()` when DOM APIs need one. Added `blobToArrayBuffer` and `blobToText` helpers for robust cross-environment Blob reading.
- Added `fileParallelism: false` to `vitest.config.ts` so database tests sharing `fake-indexeddb` state do not race each other.
- Added comprehensive unit tests for UI components (`Button`, `Toggle`, `Toast`, `TagInput`, `FadeInView`, `DateTimePicker`, `ProgressBar`), hooks (`usePomodoro`, `useFocusTrap`, `useLongPress`, `useInstallPrompt`, `useStorageQuotaWarning`), and state modules (`sidebarSettings`, `dashboardSort`, `gradingMode`, `inputMode`, `motionSpeed`, `optimiseSetting`, `shortcutBindings`, `shortcuts`).
- Fixed `usePomodoro` settings parsing to use `??` instead of `||` for proper falsy handling.
- Fixed typo in Dashboard copy: "examotion" → "exam".
- Smoother page transitions in `AppShell` — added subtle scale animation (0.995 → 1) alongside the existing fade-and-lift, with a slightly longer duration for a more settled feel.
- Smoother toast exit animation with refined timing and easing.

---

## Planned for 0.0.3

- Expand test coverage to page-level flows (Learn mode, Dashboard, Deck view) and integration tests for the import/export engine.
- Refine mobile touch interactions — spring-tuning on swipe gestures, bottom-sheet behaviour, and touch-target feedback.
- Accessibility audit: focus management in modals and drawers, ARIA live regions for toasts, and screen-reader labels on icon-only controls.
- Performance: virtualise the card list for large decks and investigate image lazy-loading in Markdown renders.

---

# Lacuna — production hardening (round two)

British English throughout. Changes are grouped by work-order task.

## Task 1 — Official FSRS trainer

**Outcome:** Replaced the hand-rolled coordinate-descent optimiser with
`@open-spaced-repetition/binding` (`computeParameters()` via fsrs-rs WASM in the optimisation
Web Worker).

- Added `@open-spaced-repetition/binding`; npm overrides for transitive WASM deps.
  The `binding-wasm32-wasi` WASM binary and worker are vendored into `public/` and `src/fsrs/`
  so the package no longer needs to be installed (it incorrectly declares `cpu: wasm32` and
  fails on x64 VMs).
- `src/fsrs/optimise.ts` converts card histories to binding review items, calls the trainer with
  `enableShortTerm: true`, validates weights against `CLAMP_PARAMETERS` bounds, then clips.
- `src/fsrs/bindingOptimiser.ts` lazy-loads the WASM trainer (`initOptimizer` + Vite `?url` /
  `?worker`).
- Vite: `optimizeDeps.exclude` for the binding; COOP/COEP headers on dev and preview servers.
- Tests: history conversion, out-of-range rejection, gating threshold, persistence feeding
  `makeEngine`.

## Task 2 — Out-of-sample validation

**Outcome:** The before/after calibration metric is now computed on held-out data, not on the
same reviews the weights were fitted to. The confirmation dialog only offers to apply fitted
weights when they genuinely beat the defaults out of sample.

- `src/fsrs/optimise.ts`: added `chronologicallySplitSequences` to split each deck's history
  into a training portion (80% by time) and a held-out validation portion (20%).
- `evaluateParameters` accepts `scoreAfterTimestamp` so only validation reviews are scored.
- `optimiseParameters` trains on the training portion, evaluates before/after on the validation
  portion, and sets `isOutOfSampleWin` in the result.
- Raised `MIN_OPTIMISE_REVIEWS` from 400 to 1,000; the UI copy explains the train/validation split.
- `DeckSettings.tsx` only shows the "Apply" button when `isOutOfSampleWin` is true; plain copy
  is shown when the fit does not improve out of sample.
- Tests: split correctness, validation-only scoring, gating on out-of-sample win, defensive
  guard against an empty training set.

## Task 3 — Pre-migration snapshot ordering

**Outcome:** The pre-migration snapshot is now captured in a separate committed transaction
before the destructive migration runs, so it survives even if the upgrade aborts and rolls
back the main database.

- `src/db/preMigrationSnapshots.ts`: a dedicated Dexie database (`lacuna-pre-migration`) stores
  snapshots keyed by target schema version.
- `src/db/schema.ts`: `ensurePreMigrationSnapshot` detects a pending upgrade via
  `indexedDB.databases()` (with a fallback to raw `indexedDB.open` for older browsers), reads
  all data from the current version, and writes the snapshot to the separate DB before the
  first Dexie query triggers the open. `readAllDataFromVersion` now includes the `assets`
  table in the payload.
- `savePreMigrationSnapshot` also mirrors the snapshot to the configured folder if the File
  System Access API is available.
- `backups.ts` already exempts `tag === 'pre-migration'` from the ten-snapshot pruning.
- Tests: a simulated migration failure proves the snapshot remains restorable; the snapshot is
  skipped when the database is already at the target version.

## Task 4 — Persistent storage

**Outcome:** The app now requests `navigator.storage.persist()` on first run and surfaces the
result honestly in the backup UI.

- `src/db/persistence.ts`: `requestPersistentStorage` and `checkPersistentStorage` handle
  granted, denied, and unsupported browsers; `estimate()` results are surfaced when available.
- `src/App.tsx`: requests persistence once on first run (guarded by localStorage flag).
- `src/pages/Settings.tsx`: shows whether storage is persisted, approximate quota usage, and
  a "Request persistence" button when not yet granted. When denied or unsupported, the UI
  states plainly that the browser may delete data and points to regular exports or folder
  mirroring as the safeguard.
- Tests: unsupported, granted, denied, and thrown-estimate cases are mocked and asserted.

## Task 5 — Asset garbage collection

**Outcome:** Orphaned image assets are now collected automatically after destructive card
operations.

- `src/db/assets.ts`: `collectOrphanedAssets` scans every card's Markdown, builds the set of
  still-referenced hashes, and deletes unreferenced rows. `scheduleAssetGc` debounces the
  sweep (3-second quiet period) so bulk edits collapse into one pass.
- `src/db/repository.ts`: `deleteDeck`, `deleteCards`, and `updateCard` (when front or back
  changes) now call `scheduleAssetGc` after the transaction commits.
- Tests: deleting a sole-referencing card removes the asset; a shared asset survives until
  the last referencing card is gone; replacing an image in a card orphans and collects the
  old one.

## Task 6 — Object URL session cache

**Outcome:** Image object URLs are cached per hash for the app lifetime, eliminating the
  create/revoke churn on every card flip in a fast Learn session.

- `src/db/assetCache.ts`: `resolveAssetUrl` caches one object URL per hash; subsequent
  renders return the same URL. `resolveAssetMarkdownCached` replaces all asset references
  in a Markdown string with cached URLs.
- `src/components/markdown/MarkdownView.tsx`: switched from `resolveAssetMarkdown` (per-mount
  create/revoke) to `resolveAssetMarkdownCached`.
- `src/App.tsx`: registers a `beforeunload` handler that calls `revokeAllCachedUrls` to
  release the URLs at app teardown.
- Tests: stable URL across repeated calls, null for missing assets, correct Markdown
  replacement, and revocation at teardown.

**Checks:** `typecheck` and `test` pass.
