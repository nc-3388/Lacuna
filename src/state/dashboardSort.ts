import { useEffect, useState } from 'react';

export type DashboardSort =
  | 'recent'
  | 'ready'
  | 'mastery'
  | 'exam'
  | 'name'
  | 'created';

const KEY = 'lacuna.dashboardSort';

export function readDashboardSort(): DashboardSort {
  const raw = localStorage.getItem(KEY);
  const valid: DashboardSort[] = [
    'recent',
    'ready',
    'mastery',
    'exam',
    'name',
    'created',
  ];
  return raw && (valid as string[]).includes(raw) ? (raw as DashboardSort) : 'recent';
}

export function writeDashboardSort(sort: DashboardSort): void {
  localStorage.setItem(KEY, sort);
  window.dispatchEvent(
    new CustomEvent('lacuna:dashboard-sort', { detail: sort }),
  );
}

export function useDashboardSort(): [
  DashboardSort,
  (sort: DashboardSort) => void,
] {
  const [sort, setSort] = useState<DashboardSort>(() => readDashboardSort());

  useEffect(() => {
    const onChange = () => setSort(readDashboardSort());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:dashboard-sort', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:dashboard-sort', onChange);
    };
  }, []);

  return [
    sort,
    (next) => {
      writeDashboardSort(next);
      setSort(next);
    },
  ];
}
