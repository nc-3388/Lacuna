# Lacuna — production hardening (round two)

British English throughout. Changes are grouped by work-order task.

## Task 1 — Official FSRS trainer

**Outcome:** Replaced the hand-rolled coordinate-descent optimiser with
`@open-spaced-repetition/binding` (`computeParameters()` via fsrs-rs WASM in the optimisation
Web Worker).

- Added `@open-spaced-repetition/binding` and `@open-spaced-repetition/binding-wasm32-wasi`;
  npm overrides for transitive WASM deps; `npm install --force` may be required on x64 hosts
  because the WASM package declares `cpu: wasm32`.
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
