import { Component, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';
import {
  buildDiagnostics,
  formatDiagnostics,
  gatherCounts,
  gatherContentSample,
  type DiagnosticBundle,
} from '../../db/diagnostics';
import { getMotionMultiplier } from '../../state/motionSpeed';

interface Props {
  children: ReactNode;
  /** Where the boundary sits, shown in the fallback for context. */
  label?: string;
  /** Optional reset handler, e.g. to navigate away from a broken route. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  counts: DiagnosticBundle['data'] | null;
  includeContent: boolean;
  copied: boolean;
}

/**
 * Catches render-time errors so a fault in one area (the Learn session especially)
 * never tears down the whole application or loses persisted data. The fallback
 * offers a local-only diagnostic bundle (copy or download) so an otherwise
 * invisible fault in a no-telemetry app can still be reported.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentStack: null,
    counts: null,
    includeContent: false,
    copied: false,
  };

  private _mounted = false;

  componentDidMount() {
    this._mounted = true;
  }

  componentWillUnmount() {
    this._mounted = false;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface during development; data itself is safe in IndexedDB.
    console.error('Lacuna error boundary caught an error:', error, info);
    this.setState({ componentStack: info.componentStack ?? null });
    // Gather non-sensitive counts for the diagnostic bundle (best-effort).
    gatherCounts()
      .then((counts) => {
        if (this._mounted) this.setState({ counts });
      })
      .catch(() => {});
  }

  handleReset = () => {
    this.setState({
      error: null,
      componentStack: null,
      counts: null,
      includeContent: false,
      copied: false,
    });
    this.props.onReset?.();
  };

  private async buildBundle(): Promise<DiagnosticBundle> {
    const { error, componentStack, counts, includeContent } = this.state;
    const contentSample = includeContent
      ? await gatherContentSample().catch(() => undefined)
      : undefined;
    return buildDiagnostics({
      location: this.props.label ?? 'the application',
      error: error
        ? { name: error.name, message: error.message, stack: error.stack ?? null }
        : { message: 'Unknown error' },
      componentStack,
      counts: counts ?? { decks: 0, cards: 0, reviews: 0, backups: 0 },
      contentSample,
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
    });
  }

  handleCopy = async () => {
    const text = formatDiagnostics(await this.buildBundle());
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard may be unavailable; the download path remains.
    }
  };

  handleDownload = async () => {
    const bundle = await this.buildBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lacuna-diagnostics-${new Date(bundle.capturedAt)
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render() {
    const m = getMotionMultiplier();
    if (this.state.error) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24 * m }}
          className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24, delay: 0.05 }}
            className="mb-2 grid h-16 w-16 place-items-center rounded-2xl bg-negative/10 text-negative"
          >
            <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </motion.div>

          <motion.h2
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.1 * m }}
            className="font-display text-2xl"
          >
            Something went wrong
          </motion.h2>
          <motion.p
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.15 * m }}
            className="max-w-md text-ink-soft"
          >
            {this.props.label
              ? `An error occurred in ${this.props.label}.`
              : 'An unexpected error occurred.'}{' '}
            Your data is saved locally and is safe.
          </motion.p>

          <motion.pre
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.2 * m }}
            className="max-w-md overflow-x-auto rounded-lg border border-line bg-ink/5 px-3 py-2 text-left text-xs text-ink-faint"
          >
            {this.state.error.message}
          </motion.pre>

          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.25 * m }}
            className="flex flex-wrap items-center justify-center gap-2"
          >
            <Button variant="primary" onClick={this.handleReset}>
              Try again
            </Button>
            <Button variant="secondary" onClick={this.handleCopy}>
              {this.state.copied ? 'Copied' : 'Copy diagnostic details'}
            </Button>
            <Button variant="secondary" onClick={this.handleDownload}>
              Download diagnostic bundle
            </Button>
          </motion.div>

          <motion.label
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.35 * m }}
            className="flex items-center gap-2 text-xs text-ink-faint"
          >
            <input
              type="checkbox"
              checked={this.state.includeContent}
              onChange={(e) => this.setState({ includeContent: e.target.checked })}
              className="accent-accent"
            />
            Include a small sample of card content (only if needed to reproduce the fault)
          </motion.label>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.24 * m, delay: 0.4 * m }}
            className="max-w-md text-xs text-ink-faint"
          >
            Diagnostics stay on your device. Nothing is sent anywhere; the bundle is yours
            to share in a bug report.
          </motion.p>
        </motion.div>
      );
    }
    return this.props.children;
  }
}
