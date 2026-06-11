import { useEffect, useState } from 'react';

export type StudyMode = 'fsrs' | 'simple';

const KEY = 'lacuna.studyMode';

export function readStudyMode(): StudyMode {
  const raw = localStorage.getItem(KEY);
  return raw === 'simple' ? 'simple' : 'fsrs';
}

export function writeStudyMode(mode: StudyMode): void {
  localStorage.setItem(KEY, mode);
  window.dispatchEvent(new CustomEvent('lacuna:study-mode', { detail: mode }));
}

export function useStudyMode(): [StudyMode, (mode: StudyMode) => void] {
  const [mode, setMode] = useState<StudyMode>(() => readStudyMode());

  useEffect(() => {
    const onChange = () => setMode(readStudyMode());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:study-mode', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:study-mode', onChange);
    };
  }, []);

  return [
    mode,
    (next) => {
      writeStudyMode(next);
      setMode(next);
    },
  ];
}
