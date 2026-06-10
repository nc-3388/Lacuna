import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagInput } from './TagInput';

describe('TagInput', () => {
  it('renders with an empty state', () => {
    render(<TagInput tags={[]} onChange={vi.fn()} placeholder="Add tags" />);
    expect(screen.getByPlaceholderText('Add tags')).toBeInTheDocument();
  });

  it('adds a tag on Enter key', () => {
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new-tag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['new-tag']);
  });

  it('does not add duplicate tags', () => {
    const onChange = vi.fn();
    render(<TagInput tags={['existing']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'existing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a tag when clicking the remove button', () => {
    const onChange = vi.fn();
    render(<TagInput tags={['alpha', 'beta']} onChange={onChange} />);
    const removeButton = screen.getByLabelText('Remove alpha');
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });

  it('adds a tag on blur', () => {
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'blur-tag' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['blur-tag']);
  });

  it('removes the last tag on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<TagInput tags={['one', 'two']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['one']);
  });

  it('shows suggestions that are not already selected', () => {
    const onChange = vi.fn();
    render(<TagInput tags={['react']} onChange={onChange} suggestions={['react', 'vue', 'angular']} />);
    expect(screen.getByText('vue')).toBeInTheDocument();
    expect(screen.getByText('angular')).toBeInTheDocument();
    // The already-selected tag 'react' appears as a chip, but not as a suggestion button.
    const suggestionButtons = screen.queryAllByRole('button', { name: 'react' });
    expect(suggestionButtons.length).toBe(0);
  });

  it('adds a suggestion when clicked', () => {
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} suggestions={['suggestion']} />);
    fireEvent.click(screen.getByText('suggestion'));
    expect(onChange).toHaveBeenCalledWith(['suggestion']);
  });
});
