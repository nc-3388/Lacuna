import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimePicker } from './DateTimePicker';

describe('DateTimePicker', () => {
  it('renders the trigger button with formatted value', () => {
    const now = new Date(2026, 5, 10, 14, 30).getTime();
    render(<DateTimePicker value={now} onChange={vi.fn()} label="Pick a date" />);
    expect(screen.getByText('10 Jun 2026 · 14:30')).toBeInTheDocument();
  });

  it('opens the dropdown when clicked', () => {
    const now = new Date(2026, 5, 10, 14, 30).getTime();
    render(<DateTimePicker value={now} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has accessible aria-expanded on the trigger', () => {
    const now = Date.now();
    render(<DateTimePicker value={now} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
