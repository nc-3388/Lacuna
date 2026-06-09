// The single source of truth for the keyboard shortcuts shown in the help overlay (?).
// The handlers live in the relevant components (AppShell, DeckView, LearnMode); this
// registry only describes them so the cheatsheet can never drift out of date.

export interface Shortcut {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['Ctrl/Cmd', 'K'], description: 'Open the command palette' },
      { keys: ['/'], description: 'Jump to search' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  {
    title: 'Decks',
    shortcuts: [{ keys: ['N'], description: 'New card (while viewing a deck)' }],
  },
  {
    title: 'Studying',
    shortcuts: [
      { keys: ['Space'], description: 'Show the answer' },
      { keys: ['Down'], description: 'Hide the answer' },
      { keys: ['Y'], description: 'Mark correct (silent mode)' },
      { keys: ['N'], description: 'Mark incorrect (silent mode)' },
      { keys: ['1'], description: 'Again (manual mode)' },
      { keys: ['2'], description: 'Hard (manual mode)' },
      { keys: ['3'], description: 'Good (manual mode)' },
      { keys: ['4'], description: 'Easy (manual mode)' },
      { keys: ['E'], description: 'Edit the current card' },
      { keys: ['F'], description: 'Toggle focus mode' },
      { keys: ['U'], description: 'Undo the last answer' },
    ],
  },
];
