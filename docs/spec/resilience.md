# 16. Persistence, seeding & resilience

- UI reads use Dexie `useLiveQuery` hooks (`src/state/useData.ts` and course-specific hooks) so
  the interface reacts to writes automatically. Non-React callers use the plain async queries in
  `src/db/read.ts`. Assessment details resolve all course assessments from one read transaction
  over assessments, lessons, cards and lesson links; coverage does not hydrate review histories.
  Course diagnostic counts use indexed counts rather than materialising cards.
- On first run a small, deletable **demo course** (with lessons, notes and cards) is
  seeded (`seedIfFirstRun`, `src/db/seed.ts`).
- A daily restore point is taken in the background after seeding.
- **Error boundaries** at the app, page and Learn-session levels keep a failure
  in one area from blanking the whole app. Their fallback receives focus on its heading and leads
  with **Try again**. The raw error and a **local-only diagnostic bundle**
  (`src/db/diagnostics.ts`) wait under **Technical details**: "Copy diagnostic details" /
  "Download diagnostic bundle" assemble the error and stack, app version
  (`__APP_VERSION__`), browser/UA, and deck/card/review/backup counts, plus
  course/lesson/note/lessonCard/practiceNode/courseAssessment/sequence/occlusion/revisionPlan
  counts when the
  course tables contain data. Card content is **excluded by default**; including
  a small sample is a separate, explicit opt-in. Nothing is transmitted — the
  bundle is the user's to paste into a bug report. A failed copy says so beside the buttons.
- **Storage-quota warning** (`src/hooks/useStorageQuotaWarning.ts`): polls the Storage API on a
  long interval and surfaces a non-blocking toast when the database is approaching its quota,
  with an **Open backups** action that jumps to the Settings backup area.
- **PWA service worker:** production HTTP(S) pages register `/sw.js`. The install shell precaches
  the eager application assets and the named shared modules needed by the Cards spine; visited
  content-hashed scripts, workers and styles use bounded Cache First stores. Stale-chunk recovery
  probes the origin before clearing worker/cache state and reloading, and never performs that
  recovery after an offline preload failure. Lazy-route imports join the same recovery: a failed
  import reloads once, and a recurring failure for that route replays the probe to clear
  worker/cache state, so a stale deployment's chunk names cannot strand a route. The packaged
  Electron app uses `app://` and does not register a browser service worker. These are current
  implementation contracts, not v0.0.2 release-history claims.
- Migrations live in `src/db/migrations.ts`; the schema is versioned in
  `src/db/schema.ts`, and every upgrade is fronted by a pre-migration restore
  point (§13).


[Specification index](../SPEC.md)
