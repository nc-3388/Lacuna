import { useState, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import { useTheme } from '../../state/ThemeContext';
import { useDecks, useDeckSummaries, useFolders, useStudyStats } from '../../state/useData';
import { useSidebarSettings } from '../../state/sidebarSettings';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import { useToast } from '../ui/Toast';
import {
  ChartIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DashboardIcon,
  FlameIcon,
  FlaskIcon,
  FolderIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SunIcon,
} from '../ui/icons';
import { buildFolderTree, wouldCreateCycle, type FolderNode } from '../../db/folderTree';
import { moveFolder, moveDeckToFolder, createFolder } from '../../db/repository';
import type { Folder, Deck } from '../../db/types';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function NavItem({
  to,
  icon,
  label,
  collapsed,
  end,
  streakBadge,
  compact,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
  streakBadge?: React.ReactNode;
  compact?: boolean;
}) {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex min-h-11 items-center gap-3 rounded-lg transition-all duration-150',
          compact ? 'px-3 py-2 text-xs' : 'px-3 py-2.5 text-sm',
          collapsed ? 'justify-center px-0' : 'hover:translate-x-0.5',
          isActive
            ? 'bg-accent-soft text-accent'
            : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent"
            />
          )}
          <span className="shrink-0">{icon}</span>
          {!collapsed && <span className="truncate">{label}</span>}
          {!collapsed && streakBadge}
        </>
      )}
    </NavLink>
  );
}

function StudyStreakBadge({ collapsed }: { collapsed: boolean }) {
  const stats = useStudyStats();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const streak = stats?.streak ?? 0;
  if (streak === 0) {
    return null;
  }
  return (
    <motion.span
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.3 * m }}
      className={cn(
        'ml-auto flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium tabular text-accent',
        collapsed && 'hidden',
      )}
      title={`${streak} day streak`}
    >
      <FlameIcon width={12} height={12} />
      {streak}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Drag-and-drop helpers
// ---------------------------------------------------------------------------

type DragItem = { type: 'folder'; id: string } | { type: 'deck'; id: string };

function setDragData(e: React.DragEvent, item: DragItem) {
  e.dataTransfer.setData('application/json', JSON.stringify(item));
  e.dataTransfer.effectAllowed = 'move';
}

function getDragData(e: React.DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return null;
    return JSON.parse(raw) as DragItem;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Folder tree node (recursive)
// ---------------------------------------------------------------------------

interface FolderTreeNodeProps {
  folder: Folder;
  childNodes: FolderNode[];
  depth: number;
  visibleDecks: Deck[];
  decksByFolder: Map<string | null, Deck[]>;
  summaries: Record<string, { count: number; mastery: number; unreviewed: number; eligible: number }> | undefined;
  location: ReturnType<typeof useLocation>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  collapsed: boolean;
  compact: boolean;
  m: number;
  allFolders: Folder[];
  onMoveFolder: (folderId: string, parentId: string | null) => void;
  onMoveDeck: (deckId: string, folderId: string | null) => void;
  onCreateSubfolder: (parentId: string) => void;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
}

function FolderTreeNode({
  folder,
  childNodes,
  depth,
  visibleDecks,
  decksByFolder,
  summaries,
  location,
  expanded,
  onToggle,
  collapsed,
  compact,
  m,
  allFolders,
  onMoveFolder,
  onMoveDeck,
  onCreateSubfolder,
  dragOverId,
  setDragOverId,
}: FolderTreeNodeProps) {
  const isExpanded = expanded.has(folder.id);
  const folderDecks = decksByFolder.get(folder.id) ?? [];
  const indent = collapsed ? 0 : depth * 12;
  const isDragOver = dragOverId === folder.id;

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const item = getDragData(e);
      if (!item) return;
      if (item.type === 'folder' && wouldCreateCycle(item.id, folder.id, allFolders)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      if (item.type === 'folder' && item.id === folder.id) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      setDragOverId(folder.id);
    },
    [folder.id, allFolders, setDragOverId],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, [setDragOverId]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverId(null);
      const item = getDragData(e);
      if (!item) return;
      if (item.type === 'folder') {
        if (wouldCreateCycle(item.id, folder.id, allFolders)) return;
        if (item.id === folder.id) return;
        onMoveFolder(item.id, folder.id);
      } else if (item.type === 'deck') {
        onMoveDeck(item.id, folder.id);
      }
    },
    [folder.id, allFolders, onMoveFolder, onMoveDeck, setDragOverId],
  );

  return (
    <div>
      {/* Folder header row */}
      <div
        draggable={!collapsed}
        onDragStart={(e) => setDragData(e, { type: 'folder', id: folder.id })}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-lg transition-colors',
          isDragOver && 'bg-accent/10',
        )}
      >
        <div
          className={cn(
            'group flex w-full min-h-11 items-center gap-3 rounded-lg transition-all duration-150',
            compact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm',
            collapsed ? 'justify-center px-0' : 'hover:translate-x-0.5',
            'text-ink-soft hover:bg-ink/5 hover:text-ink cursor-pointer',
          )}
          style={{ paddingLeft: collapsed ? undefined : `${12 + indent}px` }}
          onClick={() => onToggle(folder.id)}
          title={collapsed ? folder.name : undefined}
          role="button"
          aria-expanded={isExpanded}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle(folder.id);
            }
          }}
        >
          {!collapsed && (
            <motion.span
              animate={{ rotate: isExpanded ? 0 : -90 }}
              transition={{ duration: 0.15 * m }}
              className="shrink-0 text-ink-faint"
            >
              <ChevronDownIcon width={12} height={12} />
            </motion.span>
          )}
          <FolderIcon width={compact ? 14 : 16} height={compact ? 14 : 16} />
          {!collapsed && (
            <span className="flex flex-1 items-center gap-2 min-w-0">
              <span className="truncate">{folder.name}</span>
              <span className={cn(
                'ml-auto shrink-0 text-[10px] text-ink-faint',
                compact && 'text-[9px]',
              )}>
                {folderDecks.length}
              </span>
            </span>
          )}
          {!collapsed && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onCreateSubfolder(folder.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onCreateSubfolder(folder.id);
                }
              }}
              title="Create subfolder"
              className="shrink-0 ml-1 rounded p-1 text-ink-faint opacity-0 transition-colors hover:text-accent hover:bg-accent-soft group-hover:opacity-100 cursor-pointer"
              aria-label="Create subfolder"
            >
              <PlusIcon width={12} height={12} />
            </span>
          )}
        </div>
        {/* Drop indicator */}
        {isDragOver && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
        )}
      </div>

      {/* Expanded content: decks + child folders */}
      <AnimatePresence>
        {isExpanded && !collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {/* Decks in this folder */}
            {folderDecks.map((deck) => (
              <DeckItem
                key={deck.id}
                deck={deck}
                depth={depth + 1}
                summaries={summaries}
                location={location}
                compact={compact}
                onMoveDeck={onMoveDeck}
                dragOverId={dragOverId}
                setDragOverId={setDragOverId}
              />
            ))}
            {/* Child folders */}
            {childNodes.map((child) => (
              <FolderTreeNode
                key={child.folder.id}
                {...child}
                childNodes={child.children}
                visibleDecks={visibleDecks}
                decksByFolder={decksByFolder}
                summaries={summaries}
                location={location}
                expanded={expanded}
                onToggle={onToggle}
                collapsed={collapsed}
                compact={compact}
                m={m}
                allFolders={allFolders}
                onMoveFolder={onMoveFolder}
                onMoveDeck={onMoveDeck}
                onCreateSubfolder={onCreateSubfolder}
                dragOverId={dragOverId}
                setDragOverId={setDragOverId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deck item (draggable, within folder tree)
// ---------------------------------------------------------------------------

function DeckItem({
  deck,
  depth,
  summaries,
  location,
  compact,
  onMoveDeck,
  dragOverId,
  setDragOverId,
}: {
  deck: Deck;
  depth: number;
  summaries: Record<string, { count: number; mastery: number; unreviewed: number; eligible: number }> | undefined;
  location: ReturnType<typeof useLocation>;
  compact: boolean;
  onMoveDeck: (deckId: string, folderId: string | null) => void;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
}) {
  const base = `/deck/${deck.id}`;
  const active = location.pathname === base || location.pathname.startsWith(`${base}/`);
  const eligible = summaries?.[deck.id]?.eligible ?? 0;
  const indent = depth * 12;

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const item = getDragData(e);
      if (!item || item.type !== 'deck') return;
      e.dataTransfer.dropEffect = 'move';
      setDragOverId(`deck-${deck.id}`);
    },
    [deck.id, setDragOverId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverId(null);
      const item = getDragData(e);
      if (!item || item.type !== 'deck') return;
      // Dropping a deck onto another deck moves it to the same folder
      onMoveDeck(item.id, deck.folderId ?? null);
    },
    [deck.folderId, onMoveDeck, setDragOverId],
  );

  return (
    <div
      draggable
      onDragStart={(e) => setDragData(e, { type: 'deck', id: deck.id })}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOverId(null)}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-lg transition-colors',
        dragOverId === `deck-${deck.id}` && 'bg-accent/10',
      )}
    >
      <NavLink
        to={`/deck/${deck.id}`}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-lg transition-all duration-150',
          compact ? 'px-3 py-1.5 text-xs' : 'px-3 py-2 text-sm',
          active
            ? 'bg-accent-soft text-accent'
            : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
        )}
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        <span
          className={cn(
            'shrink-0 rounded-full border',
            compact ? 'h-2 w-2' : 'h-2.5 w-2.5',
            active ? 'border-accent bg-accent' : 'border-transparent bg-line-strong',
          )}
          style={deck.colour ? { backgroundColor: deck.colour } : undefined}
        />
        <span className="flex flex-1 items-center gap-2 min-w-0">
          <span className="truncate">{deck.name}</span>
          {eligible > 0 && (
            <span className={cn(
              'ml-auto shrink-0 rounded-full bg-accent/10 px-1.5 py-0 text-[10px] font-medium tabular text-accent',
              compact && 'text-[9px]',
            )}>
              {eligible}
            </span>
          )}
          {deck.archived && (
            <span className={cn(
              'ml-1 shrink-0 rounded border border-ink/10 px-1 text-[9px] text-ink-faint',
              compact && 'hidden',
            )}>
              Archived
            </span>
          )}
        </span>
      </NavLink>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level drop zone (for dropping items to top level)
// ---------------------------------------------------------------------------

function TopLevelDropZone({
  onMoveFolder,
  onMoveDeck,
  dragOverId,
  setDragOverId,
  children,
}: {
  onMoveFolder: (folderId: string, parentId: string | null) => void;
  onMoveDeck: (deckId: string, folderId: string | null) => void;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
  children: React.ReactNode;
}) {
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const item = getDragData(e);
      if (!item) return;
      e.dataTransfer.dropEffect = 'move';
      setDragOverId('top-level');
    },
    [setDragOverId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverId(null);
      const item = getDragData(e);
      if (!item) return;
      if (item.type === 'folder') {
        onMoveFolder(item.id, null);
      } else {
        onMoveDeck(item.id, null);
      }
    },
    [onMoveFolder, onMoveDeck, setDragOverId],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOverId(null)}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-lg transition-colors',
        dragOverId === 'top-level' && 'bg-accent/10',
      )}
    >
      {children}
      {dragOverId === 'top-level' && (
        <div className="absolute inset-x-0 top-0 h-0.5 rounded-full bg-accent" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Sidebar component
// ---------------------------------------------------------------------------

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const decks = useDecks();
  const summaries = useDeckSummaries();
  const location = useLocation();
  const [sidebarSettings] = useSidebarSettings();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const { notify } = useToast();
  const folders = useFolders();

  const [expandedSidebarFolders, setExpandedSidebarFolders] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [creatingSubfolder, setCreatingSubfolder] = useState<string | null>(null);
  const [subfolderName, setSubfolderName] = useState('');

  // Filter archived decks unless the user explicitly wants them in the sidebar.
  const visibleDecks = decks?.filter((d) => sidebarSettings.showArchived || !d.archived) ?? [];
  const allFolders = folders ?? [];
  const folderTree = buildFolderTree(allFolders);

  const decksByFolder = new Map<string | null, Deck[]>();
  for (const deck of visibleDecks) {
    const key = deck.folderId ?? null;
    const list = decksByFolder.get(key) ?? [];
    list.push(deck);
    decksByFolder.set(key, list);
  }

  function toggleSidebarFolder(id: string) {
    setExpandedSidebarFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const handleMoveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      try {
        await moveFolder(folderId, parentId);
        notify('Folder moved.', 'positive');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not move folder.', 'negative');
      }
    },
    [notify],
  );

  const handleMoveDeck = useCallback(
    async (deckId: string, folderId: string | null) => {
      try {
        await moveDeckToFolder(deckId, folderId);
        notify(folderId ? 'Deck moved to folder.' : 'Deck moved to top level.', 'positive');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not move deck.', 'negative');
      }
    },
    [notify],
  );

  const handleCreateSubfolder = useCallback(
    async (parentId: string) => {
      if (!subfolderName.trim()) return;
      try {
        await createFolder(subfolderName, parentId);
        setSubfolderName('');
        setCreatingSubfolder(null);
        notify('Subfolder created.', 'positive');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not create subfolder.', 'negative');
      }
    },
    [subfolderName, notify],
  );

  return (
    <aside
      className={cn(
        'relative z-20 flex h-screen flex-col border-r border-line bg-surface/80 backdrop-blur-xl transition-[width] duration-200 ease-out',
        collapsed ? 'w-[72px]' : 'w-[264px]',
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex items-center gap-3',
          sidebarSettings.compactMode ? 'px-4 py-3' : 'px-5 py-5',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className={cn(
          'grid shrink-0 place-items-center rounded-xl bg-accent text-accent-fg',
          sidebarSettings.compactMode ? 'h-8 w-8' : 'h-9 w-9',
        )}>
          <FlaskIcon width={sidebarSettings.compactMode ? 18 : 20} height={sidebarSettings.compactMode ? 18 : 20} />
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <div className={cn(
              'font-display tracking-tight',
              sidebarSettings.compactMode ? 'text-lg' : 'text-xl',
            )}>Lacuna</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Spaced revision
            </div>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className={cn(
        'flex flex-col gap-1 px-3',
        sidebarSettings.compactMode && 'gap-0',
      )}>
        {sidebarSettings.navItems
          .filter((n) => n.visible)
          .map((n) => (
            <NavItem
              key={n.id}
              to={n.id === 'dashboard' ? '/' : `/${n.id}`}
              end={n.id === 'dashboard'}
              icon={
                n.id === 'dashboard' ? <DashboardIcon /> :
                n.id === 'learn' ? <PlayIcon /> :
                n.id === 'search' ? <SearchIcon /> :
                n.id === 'share' ? <ShareIcon /> :
                n.id === 'analytics' ? <ChartIcon /> :
                n.id === 'settings' ? <SettingsIcon /> :
                <DashboardIcon />
              }
              label={n.label}
              collapsed={collapsed}
              compact={sidebarSettings.compactMode}
              streakBadge={n.id === 'learn' ? <StudyStreakBadge collapsed={collapsed} /> : undefined}
            />
          ))}
      </nav>

      {/* Deck list — grouped by folder */}
      <div className={cn(
        'flex min-h-0 flex-1 flex-col px-3',
        sidebarSettings.compactMode ? 'mt-3' : 'mt-6',
      )}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 * m }}
            className={cn(
              'px-3 pb-2 uppercase tracking-[0.16em] text-ink-faint',
              sidebarSettings.compactMode ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            Decks
          </motion.div>
        )}
        <div className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto pb-2',
          sidebarSettings.compactMode ? 'gap-0' : 'gap-0.5',
        )}>
          <AnimatePresence initial={false}>
            {/* Folder tree */}
            <TopLevelDropZone
              onMoveFolder={handleMoveFolder}
              onMoveDeck={handleMoveDeck}
              dragOverId={dragOverId}
              setDragOverId={setDragOverId}
            >
              {folderTree.map((node, idx) => (
                <motion.div
                  key={node.folder.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{
                    duration: 0.18 * m,
                    delay: Math.min(idx * 0.02, 0.15) * m,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  layout
                >
                  <FolderTreeNode
                    {...node}
                    childNodes={node.children}
                    visibleDecks={visibleDecks}
                    decksByFolder={decksByFolder}
                    summaries={summaries}
                    location={location}
                    expanded={expandedSidebarFolders}
                    onToggle={toggleSidebarFolder}
                    collapsed={collapsed}
                    compact={sidebarSettings.compactMode}
                    m={m}
                    allFolders={allFolders}
                    onMoveFolder={handleMoveFolder}
                    onMoveDeck={handleMoveDeck}
                    onCreateSubfolder={(parentId) => {
                      setCreatingSubfolder(parentId);
                      setSubfolderName('');
                    }}
                    dragOverId={dragOverId}
                    setDragOverId={setDragOverId}
                  />
                </motion.div>
              ))}

              {/* Ungrouped decks */}
              {visibleDecks
                .filter((d) => !d.folderId)
                .map((deck) => (
                  <DeckItem
                    key={deck.id}
                    deck={deck}
                    depth={0}
                    summaries={summaries}
                    location={location}
                    compact={sidebarSettings.compactMode}
                    onMoveDeck={handleMoveDeck}
                    dragOverId={dragOverId}
                    setDragOverId={setDragOverId}
                  />
                ))}
            </TopLevelDropZone>
          </AnimatePresence>

          {/* Subfolder creation inline */}
          <AnimatePresence>
            {creatingSubfolder && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <FolderIcon width={14} height={14} className="text-ink-faint" />
                  <input
                    autoFocus
                    value={subfolderName}
                    onChange={(e) => setSubfolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateSubfolder(creatingSubfolder);
                      if (e.key === 'Escape') {
                        setCreatingSubfolder(null);
                        setSubfolderName('');
                      }
                    }}
                    placeholder="Subfolder name"
                    className="flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {visibleDecks.length === 0 && allFolders.length === 0 && !collapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 * m }}
              className={cn(
                'px-3 py-2 text-ink-faint',
                sidebarSettings.compactMode ? 'text-xs' : 'text-sm',
              )}
            >
              {sidebarSettings.showArchived ? 'No decks yet.' : 'No active decks.'}
            </motion.p>
          )}
        </div>
      </div>

      {/* Footer: theme + collapse */}
      <div
        className={cn(
          'flex items-center gap-2 border-t border-line px-3',
          sidebarSettings.compactMode ? 'py-2' : 'py-3',
          collapsed && 'flex-col',
        )}
      >
        <button
          type="button"
          onClick={toggleTheme}
          title="Toggle colour theme"
          aria-label="Toggle colour theme"
          className={cn(
            'flex items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10',
            sidebarSettings.compactMode ? 'min-h-11 min-w-11' : 'min-h-11 min-w-11',
          )}
        >
          {resolvedTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        {!collapsed && (
          <span className="flex-1 text-xs text-ink-faint">
            {resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10',
            sidebarSettings.compactMode ? 'min-h-11 min-w-11' : 'min-h-11 min-w-11',
          )}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>
    </aside>
  );
}
