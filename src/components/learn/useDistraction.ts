import { useEffect, useMemo, useRef } from 'react';

/**
 * Tracks when the user leaves the page (tab hidden or window blurred) during a Learn
 * session. This is recorded purely for the end-of-session focus report; it deliberately
 * does NOT pause the response timer, so an inflated response time still grades as-is.
 */
export interface DistractionTracker {
  /** Mark the start of a fresh card's answer window. */
  beginCard: () => void;
  /** Call when the answer is revealed so distraction is tracked only from this point. */
  setAnswerVisible: (visible: boolean) => void;
  /** Whether the user lost focus at any point during the current card. */
  wasDistracted: () => boolean;
  /** Total milliseconds the page has been unfocused across the whole session. */
  blurredMs: () => number;
  /** Total milliseconds since the session began. */
  sessionMs: () => number;
}

export function useDistraction(): DistractionTracker {
  const sessionStart = useRef(Date.now());
  const blurredTotal = useRef(0);
  const blurStartedAt = useRef<number | null>(null);
  const distractedThisCard = useRef(false);
  const answerVisible = useRef(false);

  useEffect(() => {
    const onLeave = () => {
      if (blurStartedAt.current === null) {
        blurStartedAt.current = Date.now();
        // Only mark distraction when the answer is visible (user has seen the
        // answer and is supposed to be grading). Blurs during the question phase
        // are expected browsing behaviour and should not count.
        if (answerVisible.current) {
          distractedThisCard.current = true;
        }
      }
    };
    const onReturn = () => {
      if (blurStartedAt.current !== null) {
        blurredTotal.current += Date.now() - blurStartedAt.current;
        blurStartedAt.current = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) onLeave();
      else onReturn();
    };

    window.addEventListener('blur', onLeave);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return useMemo(
    () => ({
      beginCard: () => {
        distractedThisCard.current = false;
        answerVisible.current = false;
      },
      setAnswerVisible: (visible: boolean) => {
        answerVisible.current = visible;
      },
      wasDistracted: () => distractedThisCard.current,
      blurredMs: () => {
        // Include any in-progress blur period.
        const live =
          blurStartedAt.current !== null ? Date.now() - blurStartedAt.current : 0;
        return blurredTotal.current + live;
      },
      sessionMs: () => Date.now() - sessionStart.current,
    }),
    [],
  );
}
