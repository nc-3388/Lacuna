import {
  fixture,
  open,
  answerAndAdvance,
  setupQuestionSetPracticeTests,
} from './QuestionSetPractice.testSupport';
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getQuestionSetAttempt,
  startQuestionSetAttempt,
} from '../questions/questionSetAttemptRepository';
import * as attemptRepository from '../questions/questionSetAttemptRepository';

describe('QuestionSetPractice navigation and focus', () => {
  setupQuestionSetPracticeTests();

  it('keeps practice progression inside the card without submission captions or saved chrome', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'practice', 200);
    open(course.id, set.id, attempt.id);
    const answer = await screen.findByRole('textbox', { name: 'Your answer' });
    const card = answer.closest('article')!;
    const primary = screen.getByRole('button', { name: 'Next part' });
    expect(card).toContainElement(primary);
    expect(card).toContainElement(screen.getByRole('navigation', { name: 'Answer parts' }));
    const earlySubmit = screen.getByRole('button', { name: 'Submit question' });
    expect(card).toContainElement(earlySubmit);
    expect(earlySubmit).not.toHaveAttribute('data-attempt-primary');
    expect(primary).toHaveAttribute('data-attempt-primary');
    expect(
      screen.queryByText('Submit all parts of this question before opening its mark scheme.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Your answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    const stepper = screen.getByRole('button', { name: 'Practice, part 1 of 3' });
    expect(stepper).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(stepper);
    fireEvent.click(await screen.findByRole('button', { name: 'Q1 (b)' }));
    await screen.findByRole('heading', { name: 'Q1 (b)' });
    const submit = screen.getByRole('button', { name: 'Submit question' });
    expect(submit).toHaveAttribute('data-attempt-primary');
    expect(submit.closest('article')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Next part' })).not.toBeInTheDocument();
  });

  it('focuses the answer and progresses with Ctrl+Enter without submitting the paper early', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    open(course.id, set.id, attempt.id);
    const answer = await screen.findByLabelText('Your answer');
    await waitFor(() => expect(answer).toHaveFocus());
    fireEvent.change(answer, { target: { value: 'Answer one' } });
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true });
    await screen.findByRole('heading', { name: 'Q1 (b)' });
    await waitFor(() => expect(screen.getByLabelText('Your answer')).toHaveFocus());
    expect((await getQuestionSetAttempt(attempt.id))?.status).toBe('answering');
    expect(screen.queryByText('Controls cell activities.')).not.toBeInTheDocument();
  });

  it('preserves focus deliberately moved while the next part is being saved', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    open(course.id, set.id, attempt.id);
    const answer = await screen.findByLabelText('Your answer');
    await waitFor(() => expect(answer).toHaveFocus());
    const original = attemptRepository.saveQuestionSetAttemptPosition;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(attemptRepository, 'saveQuestionSetAttemptPosition')
      .mockImplementationOnce(async (...args) => {
        await pending;
        return original(...args);
      });
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalled());
    const other = screen.getByRole('button', { name: 'Save and finish later' });
    other.focus();
    release();
    await screen.findByRole('heading', { name: 'Q1 (b)' });
    await waitFor(() =>
      expect(screen.getByLabelText('Your answer')).not.toHaveAttribute('readonly'),
    );
    expect(other).toHaveFocus();
  });

  it('uses the primary chord to submit and focus manual marks, then advance and complete', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    open(course.id, set.id, attempt.id);
    await screen.findByLabelText('Your answer');
    const sessionProgress = screen.getByRole('progressbar', { name: 'Session progress' });
    expect(sessionProgress).toHaveAttribute('aria-valuenow', '0');
    expect(sessionProgress).toHaveAttribute('aria-valuemax', '3');
    await answerAndAdvance('Answer one', 'Q1 (b)');
    expect(sessionProgress).toHaveAttribute('aria-valuenow', '0');
    await answerAndAdvance('Answer two', 'Q2');
    const answer = screen.getByLabelText('Your answer');
    fireEvent.change(answer, { target: { value: 'Answer three' } });
    fireEvent.keyDown(answer, { key: 'Enter', metaKey: true });
    await screen.findByRole('radio', { name: 'Not marked' });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Not marked' })).toHaveFocus());
    const unmarked = screen.getByRole('radio', { name: 'Not marked' });
    fireEvent.keyDown(unmarked, { key: 'Enter', ctrlKey: true });
    expect(screen.getByRole('button', { name: /criterion 1 of 3/ })).toBeInTheDocument();
    for (const count of [1, 2, 3]) {
      const award = screen.getByRole('radio', { name: '1 / 1' });
      await waitFor(() => expect(award).not.toBeDisabled());
      fireEvent.click(award);
      await waitFor(() => {
        expect(award).toBeInTheDocument();
        expect(award).toBeChecked();
        expect(
          screen.getByRole('button', { name: count < 3 ? /^Next$/ : /^Finish attempt/ }),
        ).not.toBeDisabled();
      });
      expect(sessionProgress).toHaveAttribute('aria-valuenow', String(count));
      fireEvent.keyDown(award, { key: 'Enter', ctrlKey: true });
      if (count < 3) {
        await screen.findByRole('button', { name: new RegExp(`criterion ${count + 1} of 3`) });
        await waitFor(() =>
          expect(screen.getByRole('radio', { name: 'Not marked' })).toHaveFocus(),
        );
      }
    }
    await waitFor(async () =>
      expect((await getQuestionSetAttempt(attempt.id))?.status).toBe('complete'),
    );
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    await waitFor(() => expect(screen.getByRole('link', { name: 'Back to set' })).toHaveFocus());
  });

  it('ignores composing and consumed chords and keeps blank submission explicit', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    open(course.id, set.id, attempt.id);
    const answer = await screen.findByLabelText('Your answer');
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    const consumed = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    fireEvent(answer, consumed);
    expect(screen.getByRole('heading', { name: 'Q1 (a)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit paper' }));
    const confirm = await screen.findByRole('button', { name: 'Submit unanswered' });
    expect(confirm.closest('.qs-blank-confirm')).not.toBeNull();
    fireEvent.keyDown(confirm, { key: 'Enter', ctrlKey: true });
    expect(confirm).toBeInTheDocument();
    expect((await getQuestionSetAttempt(attempt.id))?.status).toBe('answering');
  });

  it('simplifies a single part and criterion and guards unfinished notes and corrections', async () => {
    const { course, set } = await fixture(true);
    const attempt = await startQuestionSetAttempt(set.id, 'practice', 200);
    open(course.id, set.id, attempt.id);
    const answer = await screen.findByLabelText('Your answer');
    expect(screen.queryByRole('button', { name: 'All parts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Answer parts' })).not.toBeInTheDocument();
    fireEvent.change(answer, { target: { value: 'Original answer.' } });
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true });
    const award = await screen.findByRole('radio', { name: '1 / 1' });
    expect(screen.getByText(/1 criterion remaining/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Marking criteria' })).not.toBeInTheDocument();
    fireEvent.click(award);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finish attempt' })).not.toBeDisabled(),
    );
    const addNote = screen.getByRole('button', { name: 'Add note' });
    addNote.focus();
    fireEvent.click(addNote);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Temporary note' } });
    expect(screen.getByRole('button', { name: 'Finish attempt' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add note' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish attempt' })).not.toBeDisabled();
    fireEvent.click(addNote);
    const note = screen.getByLabelText('Note');
    fireEvent.change(note, { target: { value: 'Unfinished note' } });
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Finish attempt' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(addNote).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Correction' }));
    const correction = screen.getByRole('textbox', { name: 'Correction' });
    fireEvent.change(correction, { target: { value: 'Unfinished correction' } });
    fireEvent.keyDown(correction, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(correction, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Correction' })).toBeInTheDocument();
    expect(correction).toHaveValue('Unfinished correction');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel correction' }));
    expect(correction).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    expect((await getQuestionSetAttempt(attempt.id))?.status).not.toBe('complete');
  });

  it('focuses the restored selected multiple-choice answer and still requires a manual mark', async () => {
    const { course, set } = await fixture(true, true);
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    const view = open(course.id, set.id, attempt.id);
    const choice = await screen.findByRole('radio', { name: 'A. Selectively permeable' });
    await waitFor(() => expect(choice).toHaveFocus());
    fireEvent.click(screen.getByRole('radio', { name: 'B. Impermeable' }));
    await waitFor(async () =>
      expect((await getQuestionSetAttempt(attempt.id))?.responses[0].draft).toEqual({
        kind: 'multiple-choice',
        selectedOptionIds: ['option-b'],
      }),
    );
    view.unmount();
    open(course.id, set.id, attempt.id);
    const restored = await screen.findByRole('radio', { name: 'B. Impermeable' });
    await waitFor(() => expect(restored).toHaveFocus());
    expect(restored).toBeChecked();
    fireEvent.keyDown(restored, { key: 'Enter', ctrlKey: true });
    await screen.findByRole('radio', { name: 'Not marked' });
    expect((await getQuestionSetAttempt(attempt.id))?.decisions).toEqual([]);
    expect(screen.getByRole('button', { name: 'Finish attempt' })).toBeDisabled();
  });

  it('flushes the answer before returning to the originating lesson', async () => {
    const { course, set } = await fixture();
    const attempt = await startQuestionSetAttempt(set.id, 'paper', 200);
    const view = open(course.id, set.id, attempt.id, {
      pathname: `/course/${course.id}/question-sets/${set.id}/attempts/${attempt.id}`,
      state: {
        questionSetReturnTo: `/course/${course.id}/lesson/lesson-1?tab=cards`,
        questionSetReturnLabel: 'Back to lesson',
      },
    });
    fireEvent.change(await screen.findByLabelText('Your answer'), {
      target: { value: 'A persisted response.' },
    });
    const save = screen.getByRole('button', { name: 'Save and finish later' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(view.router?.state.location.pathname).toBe(`/course/${course.id}/lesson/lesson-1`),
    );
    expect(view.router?.state.location.search).toBe('?tab=cards');
    expect((await getQuestionSetAttempt(attempt.id))?.responses[0].draft).toEqual({
      kind: 'written',
      text: 'A persisted response.',
    });
  });
});
