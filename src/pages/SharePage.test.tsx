import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharePage } from './SharePage';
import type { Deck, Card } from '../db/types';

const mockNotify = vi.fn();

let mockDecks: Deck[] | undefined = undefined;
let mockAllCards: Card[] | undefined = undefined;

vi.mock('../state/useData', () => ({
  useDecks: () => mockDecks,
  useAllCards: () => mockAllCards,
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ notify: mockNotify }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../state/motionSpeed', () => ({
  useMotionSpeed: () => ['fast'],
  speedMultiplier: () => 1,
}));

vi.mock('../db/share', () => ({
  buildShareCode: vi.fn(() => Promise.resolve('LAC2-test-code')),
  buildShareCodeQR: vi.fn(() => Promise.resolve('LAC2-qr-code')),
  decodeShare: vi.fn(() => Promise.resolve({})),
  importSharePayload: vi.fn(() => Promise.resolve({ decks: 1, cards: 2 })),
  summariseShare: vi.fn(() => ({
    deckCount: 1,
    cardCount: 2,
    exportedAt: Date.now(),
    deckNames: ['Test Deck'],
    omittedImages: false,
  })),
}));

vi.mock('../db/assets', () => ({
  referencedAssetHashesInCards: vi.fn(() => []),
}));

vi.mock('../db/export', () => ({
  exportCardsSimple: vi.fn(() => 'card front\tcard back'),
}));

vi.mock('../components/ui/icons', () => ({
  CheckIcon: () => <svg data-testid="check-icon" />,
  DownloadIcon: () => <svg data-testid="download-icon" />,
  ShareIcon: () => <svg data-testid="share-icon" />,
  UploadIcon: () => <svg data-testid="upload-icon" />,
  CardsIcon: () => <svg data-testid="cards-icon" />,
  FileTextIcon: () => <svg data-testid="file-text-icon" />,
  QrCodeIcon: () => <svg data-testid="qr-code-icon" />,
  CameraIcon: () => <svg data-testid="camera-icon" />,
  CloseIcon: () => <svg data-testid="close-icon" />,
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}));

vi.mock('react-qr-code', () => ({
  default: () => <div data-testid="qr-code">QR Code</div>,
}));

const mockDeck: Deck = {
  id: 'deck-1',
  name: 'Test Deck',
  examDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
  timeZone: 'UTC',
  createdAt: Date.now(),
  fsrsVersion: 6,
  fsrsParameters: { requestRetention: 0.9, maximumInterval: 36500, easyBonus: 1.3, hardFactor: 0.85, w: Array(19).fill(0), enableFuzz: false, enableShortTerm: true } as any,
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
  mockDecks = undefined;
  mockAllCards = undefined;
});

describe('SharePage', () => {
  it('renders loading skeleton when decks are loading', () => {
    render(<SharePage />);
    expect(screen.getByTestId('download-icon')).toBeInTheDocument();
  });

  it('renders empty state when no decks exist', () => {
    mockDecks = [];
    mockAllCards = [];
    render(<SharePage />);
    expect(screen.getByText('No decks yet')).toBeInTheDocument();
    expect(screen.getByText('Create a deck first, then come back here to share it with others.')).toBeInTheDocument();
  });

  it('renders deck list when decks exist', () => {
    mockDecks = [mockDeck];
    mockAllCards = [mockCard];
    render(<SharePage />);
    expect(screen.getByText('Test Deck')).toBeInTheDocument();
    expect(screen.getByText('1 cards')).toBeInTheDocument();
  });

  it('toggles deck selection when clicked', () => {
    mockDecks = [mockDeck];
    mockAllCards = [mockCard];
    render(<SharePage />);
    const deckBtn = screen.getByText('Test Deck');
    fireEvent.click(deckBtn);
    expect(screen.getByText('1 deck · 1 card')).toBeInTheDocument();
  });

  it('disables generate button when no decks are selected', () => {
    mockDecks = [mockDeck];
    mockAllCards = [mockCard];
    render(<SharePage />);
    const generateBtn = screen.getByText('Generate share code');
    expect(generateBtn).toBeDisabled();
  });

  it('shows import section with textarea', () => {
    mockDecks = [mockDeck];
    mockAllCards = [mockCard];
    render(<SharePage />);
    expect(screen.getByText('Import a shared deck')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste a Lacuna share code here (it starts with LAC)...')).toBeInTheDocument();
  });
});
