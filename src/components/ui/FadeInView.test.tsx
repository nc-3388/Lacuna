import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FadeInView } from './FadeInView';

describe('FadeInView', () => {
  it('renders children', () => {
    render(
      <FadeInView>
        <div data-testid="content">Hello</div>
      </FadeInView>
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <FadeInView className="custom-class">
        <div>Content</div>
      </FadeInView>
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
