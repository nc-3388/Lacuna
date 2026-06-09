import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import { useTheme } from '../../state/ThemeContext';
import { useDecks, useDeckSummaries, useFolders, useStudyStats } from '../../state/useData';
import { useSidebarSettings } from '../../state/sidebarSettings';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
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
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SunIcon,
} from '../ui/icons';

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
          'group relative flex items-center gap-3 rounded-lg transition-all duration-150',
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
  if (streak === 0) return null;
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

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const decks = useDecks();
  const summaries = useDeckSummaries();
  const location = useLocation();
  const [sidebarSettings] = useSidebarSettings();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  const [expandedSidebarFolders, setExpandedSidebarFolders] = useState<Set<string>>(new Set());

  // Filter archived decks unless the user explicitly wants them in the sidebar.
  const visibleDecks = decks?.filter((d) => sidebarSettings.showArchived || !d.archived) ?? [];
  const folders = useFolders();
  const topFolders = folders?.filter((f) => !f.parentId) ?? [];

  function toggleSidebarFolder(id: string) {
    setExpandedSidebarFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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
            {/* Folders */}
            {topFolders.map((folder, index) => {
              const folderDecks = visibleDecks.filter((d) => d.folderId === folder.id);
              const expanded = expandedSidebarFolders.has(folder.id);
              return (
                <motion.div
                  key={folder.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{
                    duration: 0.18 * m,
                    delay: Math.min(index * 0.02, 0.15) * m,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  layout
                >
                  <button
                    type="button"
                    onClick={() => toggleSidebarFolder(folder.id)}
                    title={collapsed ? folder.name : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg transition-all duration-150',
                      sidebarSettings.compactMode
                        ? 'px-3 py-1.5 text-xs'
                        : 'px-3 py-2 text-sm',
                      collapsed ? 'justify-center px-0' : 'hover:translate-x-0.5',
                      'text-ink-soft hover:bg-ink/5 hover:text-ink',
                    )}
                  >
                    {!collapsed && (
                      <motion.span
                        animate={{ rotate: expanded ? 0 : -90 }}
                        transition={{ duration: 0.15 * m }}
                        className="shrink-0 text-ink-faint"
                      >
                        <ChevronDownIcon width={12} height={12} />
                      </motion.span>
                    )}
                    <FolderIcon width={sidebarSettings.compactMode ? 14 : 16} height={sidebarSettings.compactMode ? 14 : 16} />
                    {!collapsed && (
                      <span className="flex flex-1 items-center gap-2">
                        <span className="truncate">{folder.name}</span>
                        <span className={cn(
                          'ml-auto shrink-0 text-[10px] text-ink-faint',
                          sidebarSettings.compactMode && 'text-[9px]',
                        )}>
                          {folderDecks.length}
                        </span>
                      </span>
                    )}
                  </button>
                  <AnimatePresence>
                    {expanded && !collapsed && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        {folderDecks.map((deck) => {
                          const base = `/deck/${deck.id}`;
                          const active =
                            location.pathname === base ||
                            location.pathname.startsWith(`${base}/`);
                          const eligible = summaries?.[deck.id]?.eligible ?? 0;
                          return (
                            <NavLink
                              key={deck.id}
                              to={`/deck/${deck.id}`}
                              className={cn(
                                'flex items-center gap-3 rounded-lg transition-all duration-150',
                                sidebarSettings.compactMode
                                  ? 'px-3 py-1.5 pl-8 text-xs'
                                  : 'px-3 py-2 pl-9 text-sm',
                                active
                                  ? 'bg-accent-soft text-accent'
                                  : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                              )}
                            >
                              <span
                                className={cn(
                                  'shrink-0 rounded-full border',
                                  sidebarSettings.compactMode ? 'h-2 w-2' : 'h-2.5 w-2.5',
                                  active ? 'border-accent bg-accent' : 'border-transparent bg-line-strong',
                                )}
                                style={deck.colour ? { backgroundColor: deck.colour } : undefined}
                              />
                              <span className="flex flex-1 items-center gap-2">
                                <span className="truncate">{deck.name}</span>
                                {sidebarSettings.showDueCounts && eligible > 0 && (
                                  <span className={cn(
                                    'ml-auto shrink-0 rounded-full bg-accent/10 px-1.5 py-0 text-[10px] font-medium tabular text-accent',
                                    sidebarSettings.compactMode && 'text-[9px]',
                                  )}>
                                    {eligible}
                                  </span>
                                )}
                                {deck.archived && (
                                  <span className={cn(
                                    'ml-1 shrink-0 rounded border border-ink/10 px-1 text-[9px] text-ink-faint',
                                    sidebarSettings.compactMode && 'hidden',
                                  )}>
                                    Archived
                                  </span>
                                )}
                              </span>
                            </NavLink>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {/* Ungrouped decks */}
            {visibleDecks
              .filter((d) => !d.folderId)
              .map((deck, index) => {
                const base = `/deck/${deck.id}`;
                const active =
                  location.pathname === base ||
                  location.pathname.startsWith(`${base}/`);
                const eligible = summaries?.[deck.id]?.eligible ?? 0;
                return (
                  <motion.div
                    key={deck.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{
                      duration: 0.18 * m,
                      delay: Math.min((topFolders.length + index) * 0.02, 0.15) * m,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    layout
                  >
                    <NavLink
                      to={`/deck/${deck.id}`}
                      title={collapsed ? deck.name : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg transition-all duration-150',
                        sidebarSettings.compactMode
                          ? 'px-3 py-1.5 text-xs'
                          : 'px-3 py-2 text-sm',
                        collapsed ? 'justify-center px-0' : 'hover:translate-x-0.5',
                        active
                          ? 'bg-accent-soft text-accent'
                          : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 rounded-full border',
                          sidebarSettings.compactMode ? 'h-2 w-2' : 'h-2.5 w-2.5',
                          active ? 'border-accent bg-accent' : 'border-transparent bg-line-strong',
                        )}
                        style={deck.colour ? { backgroundColor: deck.colour } : undefined}
                      />
                      {!collapsed && (
                        <span className="flex flex-1 items-center gap-2">
                          <span className="truncate">{deck.name}</span>
                          {sidebarSettings.showDueCounts && eligible > 0 && (
                            <span className={cn(
                              'ml-auto shrink-0 rounded-full bg-accent/10 px-1.5 py-0 text-[10px] font-medium tabular text-accent',
                              sidebarSettings.compactMode && 'text-[9px]',
                            )}>
                              {eligible}
                            </span>
                          )}
                          {deck.archived && (
                            <span className={cn(
                              'ml-1 shrink-0 rounded border border-ink/10 px-1 text-[9px] text-ink-faint',
                              sidebarSettings.compactMode && 'hidden',
                            )}>
                              Archived
                            </span>
                          )}
                        </span>
                      )}
                    </NavLink>
                  </motion.div>
                );
              })}
          </AnimatePresence>
          {visibleDecks.length === 0 && !collapsed && (
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
            'flex items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink',
            sidebarSettings.compactMode ? 'h-8 w-8' : 'h-9 w-9',
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
            'flex items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink',
            sidebarSettings.compactMode ? 'h-8 w-8' : 'h-9 w-9',
          )}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>
    </aside>
  );
}
