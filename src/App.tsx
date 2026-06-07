import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './state/ThemeContext';
import { AccentProvider } from './state/AccentContext';
import { FontScaleProvider } from './state/FontScaleContext';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { SearchPage } from './pages/SearchPage';
import { SharePage } from './pages/SharePage';
import { Analytics } from './pages/Analytics';
import { seedIfFirstRun } from './db/seed';
import { autoBackupIfStale } from './db/backups';
import { ensurePreMigrationSnapshot } from './db/schema';
import { requestPersistentStorage } from './db/persistence';
import { revokeAllCachedUrls } from './db/assetCache';
import { getMotionMultiplier } from './state/motionSpeed';

// Heavier routes (Recharts, KaTeX, the markdown editor) are split into their own
// chunks so the dashboard loads quickly. Settings is intentionally eager: it is tiny
// and pulls no heavy dependencies, so lazy-loading it only added a needless chunk
// round-trip and Suspense flash when switching tabs.
const DeckView = lazy(() => import('./pages/DeckView').then((m) => ({ default: m.DeckView })));
const LearnMode = lazy(() => import('./pages/LearnMode').then((m) => ({ default: m.LearnMode })));
const CardEditor = lazy(() => import('./pages/CardEditor').then((m) => ({ default: m.CardEditor })));
const DeckSettings = lazy(() => import('./pages/DeckSettings').then((m) => ({ default: m.DeckSettings })));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-xs space-y-3">
        <div className="h-8 w-3/4 animate-pulse rounded-lg bg-ink/5" />
        <div className="h-4 w-full animate-pulse rounded-lg bg-ink/5" />
        <div className="h-4 w-5/6 animate-pulse rounded-lg bg-ink/5" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-ink/5" />
      </div>
    </div>
  );
}

// Hash routing keeps the app deployable as plain static files with no server rewrites.
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      {
        path: 'deck/:deckId',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <DeckView />
          </Suspense>
        ),
      },
      { path: 'settings', element: <Settings /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'share', element: <SharePage /> },
      { path: 'analytics', element: <Analytics /> },
      {
        path: 'deck/:deckId/settings',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <DeckSettings />
          </Suspense>
        ),
      },
      {
        path: 'deck/:deckId/cards/new',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <CardEditor />
          </Suspense>
        ),
      },
      {
        path: 'deck/:deckId/cards/:cardId/edit',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <CardEditor />
          </Suspense>
        ),
      },
    ],
  },
  {
    // Learn mode is a full-screen, focused experience outside the shell.
    path: '/deck/:deckId/learn',
    element: (
      <ErrorBoundary label="the Learn session">
        <Suspense fallback={<RouteFallback />}>
          <LearnMode />
        </Suspense>
      </ErrorBoundary>
    ),
  },
  {
    // The global, cross-deck "Today" session (no deckId param).
    path: '/learn',
    element: (
      <ErrorBoundary label="the Learn session">
        <Suspense fallback={<RouteFallback />}>
          <LearnMode />
        </Suspense>
      </ErrorBoundary>
    ),
  },
]);

export function App() {
  const [ready, setReady] = useState(false);
  const initStarted = useRef(false);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    (async () => {
      try {
        // Detect any pending schema upgrade and capture a committed snapshot before
        // the destructive migration runs. This must happen before the first Dexie
        // query triggers the database open.
        await ensurePreMigrationSnapshot();

        // Request persistent storage once on first run so the browser does not
        // silently evict IndexedDB data under storage pressure.
        try {
          if (!localStorage.getItem('lacuna-persist-requested')) {
            await requestPersistentStorage();
            localStorage.setItem('lacuna-persist-requested', '1');
          }
        } catch {
          // localStorage may be unavailable in private browsing or with storage
          // restrictions; the app should still initialise without persistence.
        }

        await seedIfFirstRun();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to initialise Lacuna:', error);
      } finally {
        setReady(true);
        // Take a daily restore point in the background; never blocks the UI.
        void autoBackupIfStale();
        // Warm the DeckView chunk in the background so the first deck click is instant.
        void import('./pages/DeckView');
      }
    })();
  }, []);

  useEffect(() => {
    const handler = () => revokeAllCachedUrls();
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  }, []);

  if (!ready) {
    const m = getMotionMultiplier();
    return (
      <div className="grid h-screen place-items-center text-ink">
        <motion.span
          className="font-display text-3xl tracking-tight"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: [0, 1, 1, 0.6, 1], y: 0, scale: 1 }}
          transition={{
            opacity: { duration: 1.6 * m, repeat: Infinity, ease: 'easeInOut' },
            y: { duration: 0.4 * m, ease: [0.16, 1, 0.3, 1] },
            scale: { duration: 0.4 * m, ease: [0.16, 1, 0.3, 1] },
          }}
        >
          Lacuna
        </motion.span>
      </div>
    );
  }

  return (
    <ErrorBoundary label="the application">
      <ThemeProvider>
        <AccentProvider>
          <FontScaleProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </FontScaleProvider>
        </AccentProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
