import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CalendarIcon,
} from './icons';
import { cn } from './cn';

interface DateTimePickerProps {
  value: number;
  onChange: (epochMs: number) => void;
  label?: string;
}

const DAYS: string[] = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS: string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Build a calendar month grid: { day: number, currentMonth: boolean }[]. */
function buildMonth(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const cells: { day: number; currentMonth: boolean }[] = [];
  // Leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, currentMonth: false });
  }
  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ day: i, currentMonth: true });
  }
  // Trailing days from next month (pad to 6 rows = 42 cells max)
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    cells.push({ day: i, currentMonth: false });
  }
  return cells;
}

/** Determine which month an adjacent cell belongs to. */
function resolveAdjacentMonth(
  day: number,
  currentMonth: boolean,
  year: number,
  month: number,
): { y: number; m: number } {
  if (currentMonth) return { y: year, m: month };
  if (day > 20) {
    const m = month - 1;
    return m < 0 ? { y: year - 1, m: 11 } : { y: year, m };
  }
  const m = month + 1;
  return m > 11 ? { y: year + 1, m: 0 } : { y: year, m };
}

export function DateTimePicker({ value, onChange, label }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // View state: which month the calendar is displaying
  const [viewDate, setViewDate] = useState(() => new Date(value));
  // Direction for month slide animation: -1 = prev, 1 = next
  const [slideDir, setSlideDir] = useState(0);
  // Month/year picker mode
  const [pickerMode, setPickerMode] = useState<'days' | 'months' | 'years'>('days');
  // Keyboard focus: index into the cells array
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const date = useMemo(() => new Date(value), [value]);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const selectedDay = date.getDate();
  const selectedMonth = date.getMonth();
  const selectedYear = date.getFullYear();

  const hours = date.getHours();
  const minutes = date.getMinutes();

  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  // Find the initial focus index (selected day or today)
  const initialFocusIndex = useMemo(() => {
    const idx = cells.findIndex(
      (c) =>
        c.currentMonth &&
        c.day === selectedDay &&
        month === selectedMonth &&
        year === selectedYear,
    );
    if (idx >= 0) return idx;
    const today = new Date();
    const todayIdx = cells.findIndex(
      (c) =>
        c.currentMonth &&
        c.day === today.getDate() &&
        month === today.getMonth() &&
        year === today.getFullYear(),
    );
    return todayIdx >= 0 ? todayIdx : 0;
  }, [cells, selectedDay, selectedMonth, selectedYear, month, year]);

  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const display = `${pad(selectedDay)} ${MONTHS[selectedMonth].slice(0, 3)} ${selectedYear} · ${pad(hours)}:${pad(minutes)}`;

  // Close on Escape / click outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // Keyboard handler for the calendar
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }

      if (pickerMode === 'days') {
        const current = focusIndex ?? initialFocusIndex;
        let next = current;

        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            next = current - 1;
            break;
          case 'ArrowRight':
            e.preventDefault();
            next = current + 1;
            break;
          case 'ArrowUp':
            e.preventDefault();
            next = current - 7;
            break;
          case 'ArrowDown':
            e.preventDefault();
            next = current + 7;
            break;
          case 'Home': {
            e.preventDefault();
            const rowStart = Math.floor(current / 7) * 7;
            next = rowStart;
            break;
          }
          case 'End': {
            e.preventDefault();
            const rowEnd = Math.floor(current / 7) * 7 + 6;
            next = Math.min(rowEnd, cells.length - 1);
            break;
          }
          case 'PageUp': {
            e.preventDefault();
            setSlideDir(-1);
            setViewDate(new Date(year, month - 1, 1));
            return;
          }
          case 'PageDown': {
            e.preventDefault();
            setSlideDir(1);
            setViewDate(new Date(year, month + 1, 1));
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            const cell = cells[current];
            if (cell) {
              const { y, m } = resolveAdjacentMonth(
                cell.day,
                cell.currentMonth,
                year,
                month,
              );
              const nextDate = new Date(y, m, cell.day, hours, minutes, 0, 0);
              onChange(nextDate.getTime());
              setViewDate(nextDate);
              setOpen(false);
            }
            return;
          }
          default:
            return;
        }

        next = Math.max(0, Math.min(cells.length - 1, next));
        setFocusIndex(next);
      } else if (pickerMode === 'months') {
        let nextMonth = month;
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            nextMonth = month - 1;
            break;
          case 'ArrowRight':
            e.preventDefault();
            nextMonth = month + 1;
            break;
          case 'ArrowUp':
            e.preventDefault();
            nextMonth = month - 3;
            break;
          case 'ArrowDown':
            e.preventDefault();
            nextMonth = month + 3;
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            setPickerMode('days');
            setFocusIndex(initialFocusIndex);
            return;
          case 'Escape':
            e.preventDefault();
            setPickerMode('days');
            setFocusIndex(initialFocusIndex);
            return;
          default:
            return;
        }
        nextMonth = Math.max(0, Math.min(11, nextMonth));
        setViewDate(new Date(year, nextMonth, 1));
      } else if (pickerMode === 'years') {
        let nextYear = year;
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            nextYear = year - 1;
            break;
          case 'ArrowRight':
            e.preventDefault();
            nextYear = year + 1;
            break;
          case 'ArrowUp':
            e.preventDefault();
            nextYear = year - 3;
            break;
          case 'ArrowDown':
            e.preventDefault();
            nextYear = year + 3;
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            setPickerMode('months');
            return;
          case 'Escape':
            e.preventDefault();
            setPickerMode('days');
            setFocusIndex(initialFocusIndex);
            return;
          default:
            return;
        }
        setViewDate(new Date(nextYear, month, 1));
      }
    },
    [
      open,
      pickerMode,
      focusIndex,
      initialFocusIndex,
      cells,
      year,
      month,
      hours,
      minutes,
      onChange,
    ],
  );

  const selectDay = useCallback(
    (day: number, currentMonth: boolean) => {
      const { y, m } = resolveAdjacentMonth(day, currentMonth, year, month);
      const next = new Date(y, m, day, hours, minutes, 0, 0);
      onChange(next.getTime());
      setViewDate(next);
      setOpen(false);
    },
    [year, month, hours, minutes, onChange],
  );

  const setTime = useCallback(
    (h: number, m: number) => {
      const next = new Date(selectedYear, selectedMonth, selectedDay, h, m, 0, 0);
      onChange(next.getTime());
    },
    [selectedYear, selectedMonth, selectedDay, onChange],
  );

  // When the picker opens, reset focus and slide direction
  useEffect(() => {
    if (open) {
      setFocusIndex(initialFocusIndex);
      setSlideDir(0);
      setPickerMode('days');
    }
  }, [open, initialFocusIndex]);

  // Reset slide direction after animation completes
  useEffect(() => {
    if (slideDir !== 0) {
      const id = window.setTimeout(() => setSlideDir(0), 300);
      return () => window.clearTimeout(id);
    }
  }, [slideDir, year, month]);

  // Generate year range for year picker (centered on current view year)
  const yearRange = useMemo(() => {
    const start = year - 4;
    return Array.from({ length: 9 }, (_, i) => start + i);
  }, [year]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="mb-2 block text-sm text-ink-soft">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left text-sm text-ink outline-none transition-colors',
          open
            ? 'border-accent ring-1 ring-accent/20'
            : 'border-line-strong hover:border-line-strong',
        )}
      >
        <CalendarIcon
          width={16}
          height={16}
          className="shrink-0 text-ink-faint"
        />
        <span className="tabular">{display}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dropdownRef}
            role="dialog"
            aria-label="Choose date and time"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-xl shadow-black/10"
            onKeyDown={handleKeyDown}
          >
            {/* Header: month navigation */}
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSlideDir(-1);
                  setViewDate(new Date(year, month - 1, 1));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                aria-label="Previous month"
              >
                <ChevronLeftIcon width={16} height={16} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setPickerMode((m) => (m === 'days' ? 'months' : 'days'))
                }
                className="rounded-lg px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-ink/5"
                aria-label="Open month and year selector"
              >
                {MONTHS[month]} {year}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSlideDir(1);
                  setViewDate(new Date(year, month + 1, 1));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                aria-label="Next month"
              >
                <ChevronRightIcon width={16} height={16} />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {pickerMode === 'days' && (
                <motion.div
                  key={`days-${year}-${month}`}
                  initial={
                    slideDir !== 0
                      ? { x: slideDir * 40, opacity: 0 }
                      : { x: 0, opacity: 1 }
                  }
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: slideDir * -40, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Day-of-week headers */}
                  <div className="grid grid-cols-7 px-3 pb-1">
                    {DAYS.map((d) => (
                      <div
                        key={d}
                        className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-faint"
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 px-3 pb-3">
                    {cells.map((cell, i) => {
                      const isSelected =
                        cell.currentMonth &&
                        cell.day === selectedDay &&
                        month === selectedMonth &&
                        year === selectedYear;
                      const isToday =
                        cell.currentMonth &&
                        cell.day === todayDay &&
                        month === todayMonth &&
                        year === todayYear;
                      const isFocused = focusIndex === i;

                      return (
                        <button
                          key={i}
                          type="button"
                          tabIndex={-1}
                          onClick={() => selectDay(cell.day, cell.currentMonth)}
                          className={cn(
                            'relative mx-auto my-0.5 flex h-9 w-9 items-center justify-center rounded-full text-sm outline-none transition-colors',
                            cell.currentMonth
                              ? 'text-ink'
                              : 'text-ink-faint/60',
                            isSelected &&
                              'bg-accent font-medium text-accent-fg hover:bg-accent',
                            !isSelected &&
                              isToday &&
                              'ring-1 ring-inset ring-accent/40',
                            !isSelected &&
                              !isToday &&
                              cell.currentMonth &&
                              'hover:bg-ink/5',
                            isFocused &&
                              !isSelected &&
                              'ring-2 ring-inset ring-accent/50',
                          )}
                        >
                          {cell.day}
                          {isToday && !isSelected && (
                            <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-accent" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {pickerMode === 'months' && (
                <motion.div
                  key="months"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className="px-3 pb-3"
                >
                  <div className="mb-2 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickerMode('years')}
                      className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
                    >
                      {year}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {MONTHS.map((m, i) => {
                      const isCurrent = i === month;
                      const isSelected =
                        i === selectedMonth && year === selectedYear;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setViewDate(new Date(year, i, 1));
                            setPickerMode('days');
                            setFocusIndex(initialFocusIndex);
                          }}
                          className={cn(
                            'rounded-lg px-2 py-2.5 text-xs font-medium transition-colors',
                            isSelected
                              ? 'bg-accent text-accent-fg'
                              : isCurrent
                                ? 'bg-accent-soft text-accent'
                                : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                          )}
                        >
                          {m.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {pickerMode === 'years' && (
                <motion.div
                  key="years"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className="px-3 pb-3"
                >
                  <div className="grid grid-cols-3 gap-2">
                    {yearRange.map((y) => {
                      const isCurrent = y === year;
                      const isSelected = y === selectedYear;
                      return (
                        <button
                          key={y}
                          type="button"
                          onClick={() => {
                            setViewDate(new Date(y, month, 1));
                            setPickerMode('months');
                          }}
                          className={cn(
                            'rounded-lg px-2 py-2.5 text-xs font-medium transition-colors',
                            isSelected
                              ? 'bg-accent text-accent-fg'
                              : isCurrent
                                ? 'bg-accent-soft text-accent'
                                : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
                          )}
                        >
                          {y}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Time selector */}
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                  <ClockIcon width={13} height={13} />
                  Time
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    min={0}
                    max={23}
                    value={pad(hours)}
                    onChange={(e) => {
                      const v = Math.min(
                        23,
                        Math.max(0, Number(e.target.value)),
                      );
                      if (!Number.isNaN(v)) setTime(v, minutes);
                    }}
                    className="h-8 w-12 rounded-lg border border-line-strong bg-paper text-center text-sm text-ink outline-none focus:border-accent tabular"
                  />
                  <span className="text-ink-faint">:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    value={pad(minutes)}
                    onChange={(e) => {
                      const v = Math.min(
                        59,
                        Math.max(0, Number(e.target.value)),
                      );
                      if (!Number.isNaN(v)) setTime(hours, v);
                    }}
                    className="h-8 w-12 rounded-lg border border-line-strong bg-paper text-center text-sm text-ink outline-none focus:border-accent tabular"
                  />
                </div>
              </div>
            </div>

            {/* Footer: quick actions */}
            <div className="flex items-center justify-between border-t border-line px-4 py-2">
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const next = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate(),
                    hours,
                    minutes,
                    0,
                    0,
                  );
                  onChange(next.getTime());
                  setViewDate(now);
                }}
                className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
              >
                Jump to today
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const next = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate(),
                    now.getHours(),
                    now.getMinutes(),
                    0,
                    0,
                  );
                  onChange(next.getTime());
                  setViewDate(now);
                }}
                className="text-xs font-medium text-ink-soft transition-opacity hover:text-ink"
              >
                Now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
