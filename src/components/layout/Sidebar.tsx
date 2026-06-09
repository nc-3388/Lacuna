import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import { useTheme } from '../../state/ThemeContext';
import { useDecks, useStudyStats } from '../../state/useData';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import {
  ChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DashboardIcon,
  FlameIcon,
  FlaskIcon,
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
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
  streakBadge?: React.ReactNode;
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
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150',
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
  const location = useLocation();

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
          'flex items-center gap-3 px-5 py-5',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
          <FlaskIcon width={20} height={20} />
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display text-xl tracking-tight">Lacuna</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Spaced revision
            </div>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-1 px-3">
        <NavItem
          to="/"
          end
          icon={<DashboardIcon />}
          label="Dashboard"
          collapsed={collapsed}
        />
        <NavItem
          to="/learn"
          icon={<PlayIcon />}
          label="Study today"
          collapsed={collapsed}
          streakBadge={<StudyStreakBadge collapsed={collapsed} />}
        />
        <NavItem
          to="/search"
          icon={<SearchIcon />}
          label="Search"
          collapsed={collapsed}
        />
        <NavItem
          to="/share"
          icon={<ShareIcon />}
          label="Share"
          collapsed={collapsed}
        />
        <NavItem
          to="/analytics"
          icon={<ChartIcon />}
          label="Analytics"
          collapsed={collapsed}
        />
        <NavItem
          to="/settings"
          icon={<SettingsIcon />}
          label="Settings"
          collapsed={collapsed}
        />
      </nav>

      {/* Deck list */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 * m }}
            className="px-3 pb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint"
          >
            Decks
          </motion.div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
          <AnimatePresence initial={false}>
            {decks?.map((deck, index) => {
              // Stay highlighted for the deck itself and any of its sub-routes
              // (cards, new card, deck settings, learn), not just the exact page.
              const base = `/deck/${deck.id}`;
              const active =
                location.pathname === base ||
                location.pathname.startsWith(`${base}/`);
              return (
                <motion.div
                  key={deck.id}
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
                  <NavLink
                    to={`/deck/${deck.id}`}
                    title={collapsed ? deck.name : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                      collapsed ? 'justify-center px-0' : 'hover:translate-x-0.5',
                      active
                        ? 'bg-accent-soft text-accent'
                        : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2.5 w-2.5 shrink-0 rounded-full border',
                        active ? 'border-accent bg-accent' : 'border-transparent bg-line-strong',
                      )}
                      style={deck.colour ? { backgroundColor: deck.colour } : undefined}
                    />
                    {!collapsed && <span className="truncate">{deck.name}</span>}
                  </NavLink>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {decks && decks.length === 0 && !collapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 * m }}
              className="px-3 py-2 text-sm text-ink-faint"
            >
              No decks yet.
            </motion.p>
          )}
        </div>
      </div>

      {/* Footer: theme + collapse */}
      <div
        className={cn(
          'flex items-center gap-2 border-t border-line px-3 py-3',
          collapsed && 'flex-col',
        )}
      >
        <button
          type="button"
          onClick={toggleTheme}
          title="Toggle colour theme"
          aria-label="Toggle colour theme"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
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
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>
    </aside>
  );
}
