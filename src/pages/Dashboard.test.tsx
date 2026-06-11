import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import type { Deck, Card } from '../db/types';

const mockNotify = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

let mockDashboardData: unknown = undefined;
let mockFolders: unknown = undefined;

vi.mock('../state/useData', () => ({
  useDashboardData: () => mockDashboardData,
  useFolders: () => mockFolders,
}));

vi.mock('../state/dashboardSort', () => ({
  useDashboardSort: () => ['recent'],
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ notify: mockNotify }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../state/motionSpeed', () => ({
  useMotionSpeed: () => ['fast'],
  speedMultiplier: () => 1,
}));

vi.mock('../state/inputMode', () => ({
  useIsTouchMode: () => false,
}));

vi.mock('../db/repository', () => ({
  createDeck: vi.fn(() => Promise.resolve({ id: 'new-deck', name: 'New Deck' })),
  createDeckWithCards: vi.fn(),
  createFolder: vi.fn(),
  deleteDecks: vi.fn(),
  deleteFolder: vi.fn(),
  mergeDecks: vi.fn(),
  moveDecksToFolder: vi.fn(),
  restoreDecks: vi.fn(),
  snapshotDecks: vi.fn(() => Promise.resolve({ decks: [], cards: [], sessionHistory: [], userPerformance: [] })),
  updateDeck: vi.fn(),
  updateFolder: vi.fn(),
}));

vi.mock('../components/ui/icons', () => ({
  CheckIcon: () => <svg data-testid="check-icon" />,
  ChevronDownIcon: () => <svg data-testid="chevron-down-icon" />,
  FlaskIcon: () => <svg data-testid="flask-icon" />,
  MergeIcon: () => <svg data-testid="merge-icon" />,
  PlayIcon: () => <svg data-testid="play-icon" />,
  PlusIcon: () => <svg data-testid="plus-icon" />,
  TrashIcon: () => <svg data-testid="trash-icon" />,
  FolderIcon: () => <svg data-testid="folder-icon" />,
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}));

vi.mock('../components/ui/ProgressBar', () => ({
  ProgressBar: ({ value }: { value: number }) => (
    <div data-testid="progress-bar" data-value={value} />
  ),
}));

vi.mock('../components/dashboard/StudySignals', () => ({
  StudySignals: () => <div data-testid="study-signals">Study Signals</div>,
}));

vi.mock('../components/dashboard/ReviewHeatmap', () => ({
  ReviewHeatmap: () => <div data-testid="review-heatmap">Review Heatmap</div>,
}));

vi.mock('../components/import/UnifiedImportPanel', () => ({
  UnifiedImportPanel: () => <div data-testid="import-panel">Import Panel</div>,
}));

const mockDeck: Deck = {
  id: 'deck-1',
  name: 'Test Deck',
  examDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
  timeZone: 'UTC',
  createdAt: Date.now(),
  fsrsVersion: 6,
  fsrsParameters: { requestRetention: 0.9, w: Array(21).fill(0), enable_fuzz: true, maximum_interval: 36500, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] },
  examObjective: 'expectedMarks',
  lastInteractedAt: Date.now(),
};

const mockCard: Card = {
  id: 'card-1',
  deckId: 'deck-1',
  type: 'front_back',
  front: 'Front',
  back: 'Back',
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
  createdAt: Date.now(),
  tags: [],
  suspended: false,
  buriedUntil: null,
};

beforeEach(() => {
  mockNotify.mockClear();
  mockNavigate.mockClear();
  mockDashboardData = undefined;
  mockFolders = undefined;
});

describe('Dashboard', () => {
  it('renders skeleton when data is loading', () => {
    render(<Dashboard />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state when no decks exist', () => {
    mockDashboardData = {
      decks: [],
      allCards: [],
      summaries: {},
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    expect(screen.getByText('No decks yet')).toBeInTheDocument();
    expect(screen.getByText('Create a deck')).toBeInTheDocument();
  });

  it('renders deck cards when decks exist', () => {
    mockDashboardData = {
      decks: [mockDeck],
      allCards: [mockCard],
      summaries: {
        'deck-1': { count: 1, mastery: 0.5, unreviewed: 1, eligible: 0 },
      },
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    expect(screen.getByText('Test Deck')).toBeInTheDocument();
    expect(screen.getByText('1 cards')).toBeInTheDocument();
  });

  it('shows select mode when Select button is clicked', () => {
    mockDashboardData = {
      decks: [mockDeck],
      allCards: [mockCard],
      summaries: {
        'deck-1': { count: 1, mastery: 0.5, unreviewed: 1, eligible: 0 },
      },
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Select'));
    expect(screen.getByText('Select all')).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('shows New deck button in header', () => {
    mockDashboardData = {
      decks: [],
      allCards: [],
      summaries: {},
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    expect(screen.getByText('New deck')).toBeInTheDocument();
  });

  it('shows New folder button in header', () => {
    mockDashboardData = {
      decks: [],
      allCards: [],
      summaries: {},
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    expect(screen.getByText('New folder')).toBeInTheDocument();
  });

  it('renders folders when they exist', () => {
    mockFolders = [
      { id: 'folder-1', name: 'Science', parentId: null, createdAt: Date.now() },
    ];
    const deckInFolder = { ...mockDeck, folderId: 'folder-1' };
    mockDashboardData = {
      decks: [deckInFolder],
      allCards: [mockCard],
      summaries: {
        'deck-1': { count: 1, mastery: 0.5, unreviewed: 1, eligible: 0 },
      },
      stats: { reviewedToday: 0, streak: 0, forecast: [] },
    };
    render(<Dashboard />);
    expect(screen.getByText('Science')).toBeInTheDocument();
  });
});
