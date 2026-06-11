import { memo } from 'react';
import { MarkdownView } from '../markdown/MarkdownView';
import type { Card } from '../../db/types';

type Side = 'front' | 'back';

/**
 * Render one side of a card, handling all card types:
 *  - front_back: the front or back Markdown directly.
 *  - cloze: the same source, shown with blanks (front) or revealed answers (back).
 *  - typing: same as front_back — the prompt is front, the correct answer is back.
 *  - basic_reversed: same as front_back — the primary card's front/back are rendered.
 *
 * Memoised so a parent re-render (e.g. toggling select mode in the card list) doesn't
 * touch every card's markdown; it re-renders only when this card's content changes.
 */
export const CardContent = memo(function CardContent({
  card,
  side,
  className,
}: {
  card: Card;
  side: Side;
  className?: string;
}) {
  if (card.type === 'cloze') {
    return (
      <MarkdownView
        source={card.front}
        clozeMode={side === 'front' ? 'front' : 'back'}
        className={className}
      />
    );
  }
  // typing, basic_reversed, and front_back all render the same way: front or back.
  return <MarkdownView source={side === 'front' ? card.front : card.back} className={className} />;
});
