import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CardList } from './CardList';
import type { Card, Deck } from '../../db/types';

const mockNotify = vi.fn();

vi.mock('../ui/Toast', () => ({
  useToast: () => ({ notify: mockNotify }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../state/motionSpeed', () => ({
  useMotionSpeed: () => ['fast'],
  speedMultiplier: () => 1,
}));

vi.mock('../../state/inputMode', () => ({
  useIsTouchMode: () => false,
}));

vi.mock('../../db/repository', () => ({
  addTagToCards: vi.fn(),
  createCards: vi.fn(),
  deleteCards: vi.fn(),
  moveCards: vi.fn(),
  removeTagFromCards: vi.fn(),
  restoreCards: vi.fn(),
  setCardsSuspended: vi.fn(),
  setCardFlag: vi.fn(),
  snapshotCards: vi.fn(() => Promise.resolve([])),
  unsuspendCard: vi.fn(),
}));

vi.mock('../../fsrs/leech', () => ({
  isLeech: vi.fn(() => false),
}));

vi.mock('../ui/icons', () => ({
  CheckIcon: (props: any) => <svg data-testid="check-icon" {...props} />,
  EditIcon: (props: any) => <svg data-testid="edit-icon" {...props} />,
  FlagIcon: (props: any) => <svg data-testid="flag-icon" {...props} />,
  PlusIcon: (props: any) => <svg data-testid="plus-icon" {...props} />,
  TagIcon: (props: any) => <svg data-testid="tag-icon" {...props} />,
  TrashIcon: (props: any) => <svg data-testid="trash-icon" {...props} />,
  UploadIcon: (props: any) => <svg data-testid="upload-icon" {...props} />,
}));

vi.mock('../markdown/MarkdownView', () => ({
  MarkdownView: ({ source }: { source: string }) => <div data-testid="markdown-view">{source}</div>,
}));

vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}));

vi.mock('./CardAnalytics', () => ({
  CardAnalytics: () => <div data-testid="card-analytics">Analytics</div>,
}));

vi.mock('../import/UnifiedImportPanel', () => ({
  UnifiedImportPanel: () => <div data-testid="import-panel">Import Panel</div>,
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
  front: 'What is the capital of France?',
  back: 'Paris',
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
  tags: ['geography'],
  suspended: false,
  buriedUntil: null,
};

const mockCard2: Card = {
  ...mockCard,
  id: 'card-2',
  front: 'What is 2 + 2?',
  back: '4',
  tags: ['math'],
};

beforeEach(() => {
  mockNotify.mockClear();
});

describe('CardList', () => {
  it('renders empty state when no cards', () => {
    const onNewCard = vi.fn();
    const onEditCard = vi.fn();
    render(
      <CardList
        cards={[]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={onNewCard}
        onEditCard={onEditCard}
      />
    );
    expect(screen.getByText('This deck has no cards yet.')).toBeInTheDocument();
    expect(screen.getByText('Add your first card')).toBeInTheDocument();
  });

  it('renders cards with front content', () => {
    render(
      <CardList
        cards={[mockCard]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('geography')).toBeInTheDocument();
  });

  it('shows select mode when Select button is clicked', () => {
    render(
      <CardList
        cards={[mockCard, mockCard2]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    const selectBtn = screen.getByText('Select');
    fireEvent.click(selectBtn);
    expect(screen.getByText('Select all')).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('toggles card selection in select mode', () => {
    render(
      <CardList
        cards={[mockCard, mockCard2]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Select'));
    fireEvent.click(screen.getByText('Select all'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('expands a card to show analytics', async () => {
    render(
      <CardList
        cards={[mockCard]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    const cardRow = screen.getByText('What is the capital of France?');
    fireEvent.click(cardRow);
    const analytics = await screen.findByTestId('card-analytics');
    expect(analytics).toBeInTheDocument();
  });

  it('shows import panel when Import is clicked', () => {
    render(
      <CardList
        cards={[]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Import'));
    expect(screen.getByTestId('import-panel')).toBeInTheDocument();
  });

  it('shows New and Import buttons when not in select mode', () => {
    render(
      <CardList
        cards={[mockCard]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={vi.fn()}
        onEditCard={vi.fn()}
      />
    );
    expect(screen.getByText('New card')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('calls onNewCard when New card button is clicked', () => {
    const onNewCard = vi.fn();
    render(
      <CardList
        cards={[mockCard]}
        deck={mockDeck}
        allDecks={[mockDeck]}
        onNewCard={onNewCard}
        onEditCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('New card'));
    expect(onNewCard).toHaveBeenCalledOnce();
  });
});
