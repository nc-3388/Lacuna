import { modifierShortcutLabel } from '../electron/runtime';
import { QuestionSetPracticeStepper } from '../components/question-sets/QuestionSetPracticeStepper';
import { QuestionSetPanel } from '../components/question-sets/QuestionSetPanel';
import { QuestionSetPracticeNavigation } from '../components/question-sets/QuestionSetPracticeNavigation';
import { useQuestionSetScroll } from '../components/question-sets/useQuestionSetScroll';
import { questionSetReturn } from '../questions/questionSetNavigation';
import { useEffect, useRef, useState } from 'react';
import {
  questionSetPrimaryKey,
  useQuestionSetBlankConfirmation,
  useQuestionSetPracticeFocus,
} from '../components/question-sets/useQuestionSetPracticeFocus';
import { StepSwap } from '../components/ui/StepSwap';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AppLink as Link } from '../components/ui/AppLink';
import { flattenQuestionSet } from '../questions/questionSetAuthoring';
import {
  feedbackAvailable,
  type QuestionSetAttemptRecord,
} from '@lacuna/core/questions/questionSetAttempts';
import {
  recordQuestionSetAssistance,
  completeQuestionSetAttempt,
  saveQuestionSetAttemptPosition,
  saveQuestionSetMarking,
  submitPracticeQuestion,
  submitQuestionSetPaper,
  type SaveQuestionSetMarkingInput,
  QuestionSetAttemptRevisionConflictError,
} from '../questions/questionSetAttemptRepository';
import { QuestionSetMarkingActions } from '../components/question-sets/QuestionSetMarkingActions';
import { QuestionSetAnswer } from '../components/question-sets/QuestionSetAnswer';
import { QuestionSetRelatedKnowledge } from '../components/question-sets/QuestionSetRelatedKnowledge';
import { QuestionSetReflection } from '../components/question-sets/QuestionSetReflection';
import { QuestionSetMarking } from '../components/question-sets/QuestionSetMarking';
import {
  useAttemptProgress,
  useQuestionSetAttempt,
} from '../components/question-sets/useQuestionSetAttempt';
import type { QuestionSetAttemptSession } from '../components/question-sets/questionSetAttemptSession';
import { Button } from '../components/ui/Button';
import { ConfirmInline } from '../components/ui/ConfirmInline';
import {
  QuestionSetLoading,
  QuestionSetUnavailable,
} from '../components/question-sets/QuestionSetRouteState';
import { dimensionNames } from '../components/question-sets/presentation';
import { FileTextIcon } from '../components/ui/icons';
import type { QuestionStudySummary } from '../course/sessionSummary';
import { summariseSelfMarking } from '@lacuna/core/questions/questionSets';
import { StudyEntrance } from '../components/learn/StudyEntrance';
import { StudyFlowMessage } from '../components/learn/StudyFlowMessage';
import '../components/question-sets/question-sets.css';
import '../components/question-sets/question-set-practice.css';

export function QuestionSetPractice({
  study,
}: {
  study?: {
    courseId: string;
    setId: string;
    attemptId: string;
    onComplete: (summary: QuestionStudySummary) => void;
    onExit: () => void;
  };
} = {}) {
  const params = useParams();
  const { courseId = '', setId = '', attemptId = '' } = study ?? params;
  const { session, error, missing, retryLoad } = useQuestionSetAttempt(courseId, setId, attemptId);
  const retryFocusOwner = useRef<Element | null | undefined>(undefined);
  const backTo = `/course/${courseId}/question-sets/${setId}`;
  if (study && (missing || error))
    return (
      <StudyFlowMessage
        title={missing ? 'Attempt not found' : 'Could not open this attempt'}
        detail={error ?? 'This saved attempt is no longer available.'}
        onExit={study.onExit}
      />
    );
  if (missing)
    return (
      <QuestionSetUnavailable
        title="Attempt not found"
        backTo={backTo}
        backLabel="Back to question set"
      >
        This attempt may have been removed or belong to another question set. Choose a saved attempt
        or start a new one from the set.
      </QuestionSetUnavailable>
    );
  if (error)
    return (
      <QuestionSetUnavailable
        title="Could not open this attempt"
        backTo={backTo}
        backLabel="Back to question set"
        detail={error}
        onRetry={() => {
          retryFocusOwner.current = document.activeElement;
          retryLoad();
        }}
      >
        The saved attempt could not be read. Try again; your saved answers have not been removed.
      </QuestionSetUnavailable>
    );
  if (!session) return <QuestionSetLoading />;
  const workspace = (
    <PracticeWorkspace
      key={attemptId}
      session={session}
      initialFocusOwner={retryFocusOwner.current}
      study={study}
    />
  );
  return study ? (
    <StudyEntrance>
      <main>{workspace}</main>
    </StudyEntrance>
  ) : (
    workspace
  );
}

function PracticeWorkspace({
  session,
  initialFocusOwner,
  study,
}: {
  session: QuestionSetAttemptSession;
  initialFocusOwner?: Element | null;
  study?: { onComplete: (summary: QuestionStudySummary) => void; onExit: () => void };
}) {
  const [formDirty, setFormDirty] = useState(false);
  const [reflectionDirty, setReflectionDirty] = useState(false);
  const progress = useAttemptProgress(session, formDirty || reflectionDirty);
  const attempt = progress.record;
  const completed = useRef<string | null>(null);
  useEffect(() => {
    if (study && attempt.status === 'complete' && completed.current !== attempt.id) {
      completed.current = attempt.id;
      const jevCount = attempt.decisions.filter(
        (decision) => decision.markedBy?.by === 'jev',
      ).length;
      study.onComplete({
        kind: 'question',
        score: summariseSelfMarking(attempt.receipt, attempt.decisions),
        marking:
          jevCount === 0
            ? 'Self-marked'
            : jevCount === attempt.decisions.length
              ? 'Jev-marked'
              : 'Mixed marking',
      });
    }
  }, [attempt, study]);
  const origin = questionSetReturn(useLocation().state, attempt.courseId);
  const navigate = useNavigate();
  const rootRef = useQuestionSetScroll(`question-set-scroll:${attempt.id}`);
  const blankConfirmation = useQuestionSetBlankConfirmation(rootRef);
  const [actionError, setActionError] = useState('');
  const [acting, setActing] = useState(false);
  const allNodes = flattenQuestionSet(attempt.receipt);
  const nodes = allNodes.filter((node) => node.node.answer);
  const index = nodes.findIndex((node) => node.id === attempt.activeNodeId);
  const active = nodes[index];
  const answer = active.node.answer!;
  const questionId = active.parentIds[0] ?? active.id;
  const marking = feedbackAvailable(attempt, questionId);
  const [transition, setTransition] = useState({ index, marking, direction: 0 });
  // Derive direction from the saved position, including stepper and primary-button moves.
  // Keep it stable through answer/autosave renders while the incoming card is animating.
  if (transition.index !== index || transition.marking !== marking) {
    setTransition({
      index,
      marking,
      direction: transition.marking === marking ? Math.sign(index - transition.index) : 0,
    });
  }
  const criteria = nodes.flatMap((node) =>
    feedbackAvailable(attempt, node.parentIds[0] ?? node.id)
      ? node.node.answer!.allocations.map((allocation) => ({ nodeId: node.id, allocation }))
      : [],
  );
  const criterion =
    criteria.find((row) => row.allocation.id === attempt.activeAllocationId) ??
    criteria.find((row) => row.nodeId === active.id);
  const criterionIndex = criteria.findIndex(
    (row) => row.allocation.id === criterion?.allocation.id,
  );
  const busy = progress.pending > 0;
  const base = `/course/${attempt.courseId}/question-sets/${attempt.questionSetId}`;
  const value = progress.value(active.id);
  const blocked = formDirty || reflectionDirty || busy || acting || Boolean(progress.error);
  const nextPart = nodes[index + 1];
  const advancePart =
    !marking &&
    nextPart &&
    (attempt.mode === 'paper' || (nextPart.parentIds[0] ?? nextPart.id) === questionId);
  const currentMarked = attempt.decisions.some(
    (row) => row.allocationId === criterion?.allocation.id && row.status === 'awarded',
  );
  const nextCriterion =
    criteria[criterionIndex + 1] ??
    criteria.find(
      (row) =>
        !attempt.decisions.some(
          (decision) =>
            decision.allocationId === row.allocation.id && decision.status === 'awarded',
        ),
    );
  const position = `${active.id}:${criterion?.allocation.id ?? ''}:${marking}:${attempt.status}`;
  useQuestionSetPracticeFocus(
    rootRef,
    position,
    marking,
    attempt.status === 'complete',
    busy || acting,
    initialFocusOwner,
  );
  async function perform(work: () => Promise<unknown>) {
    setActionError('');
    setActing(true);
    try {
      await work();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not save this change.');
    } finally {
      setActing(false);
    }
  }
  function move(nodeId: string, allocationId: string | null = null) {
    if (formDirty || reflectionDirty) {
      setActionError('Save or cancel your note or correction first.');
      return;
    }
    void perform(() =>
      progress.run((current) =>
        saveQuestionSetAttemptPosition(current.id, current.revisionId, nodeId, allocationId),
      ),
    );
    blankConfirmation.close();
  }
  function updateMarking(
    change: (current: QuestionSetAttemptRecord) => Partial<SaveQuestionSetMarkingInput>,
  ) {
    void perform(() =>
      progress.run((current) =>
        saveQuestionSetMarking(current.id, current.revisionId, {
          decisions: current.decisions,
          annotations: current.annotations,
          corrections: current.corrections,
          reflection: current.reflection,
          activeNodeId: current.activeNodeId,
          activeAllocationId: current.activeAllocationId,
          ...change(current),
        }),
      ),
    );
  }
  async function submit(confirmed = false) {
    if (!confirmed) blankConfirmation.prepare();
    await progress.flush();
    const current = session.snapshot.record;
    const group =
      current.mode === 'paper'
        ? nodes
        : nodes.filter((node) => (node.parentIds[0] ?? node.id) === questionId);
    const hasBlank = group.some((node) => {
      const response = current.responses.find((row) => row.nodeId === node.id)!.draft;
      return response.kind === 'multiple-choice'
        ? !response.selectedOptionIds.length
        : !response.text.trim();
    });
    if (hasBlank && !confirmed) {
      blankConfirmation.show();
      return;
    }
    await progress.run((row) =>
      row.mode === 'paper'
        ? submitQuestionSetPaper(row.id, row.revisionId)
        : submitPracticeQuestion(row.id, row.revisionId, questionId),
    );
    blankConfirmation.close();
  }
  const relatedKnowledge = (
    <QuestionSetRelatedKnowledge
      key={active.id}
      courseId={attempt.courseId}
      conceptIds={[
        ...answer.prerequisiteConceptIds,
        ...answer.allocations.flatMap((row) => row.targetConceptIds),
      ]}
      submitted={marking}
      beforeReveal={() =>
        progress.run((current) =>
          recordQuestionSetAssistance(current.id, current.revisionId, {
            nodeId: active.id,
            kind: 'related-knowledge',
            occurredAt: Date.now(),
          }),
        )
      }
    />
  );
  return (
    <div className="qs-practice" ref={rootRef} onKeyDown={questionSetPrimaryKey}>
      <header className="qs-practice-header">
        {study ? (
          <Button
            variant="ghost"
            disabled={formDirty || reflectionDirty || busy}
            onClick={() =>
              void perform(async () => {
                await progress.flush();
                study.onExit();
              })
            }
          >
            Finish for now
          </Button>
        ) : (
          <Link className="qs-back" to={base} state={origin}>
            ← {attempt.receipt.title}
          </Link>
        )}
        <QuestionSetPracticeStepper
          mode={attempt.mode}
          nodes={nodes}
          allNodes={allNodes}
          attempt={attempt}
          index={index}
          blocked={blocked}
          onMove={move}
          context={marking ? `criterion ${criterionIndex + 1} of ${criteria.length}` : undefined}
        />
        <span className="sr-only" aria-live="polite">
          {attempt.status === 'complete'
            ? 'Complete'
            : marking
              ? `Criterion ${criterionIndex + 1} of ${criteria.length}`
              : `Part ${index + 1} of ${nodes.length}`}
        </span>
        <div className="qs-actions">
          {marking && (
            <div className="qs-header-tools">
              <QuestionSetPanel
                title="Question and source"
                icon={<FileTextIcon width={18} height={18} />}
                panelClassName="qs-practice-panel"
              >
                <QuestionSetAnswer
                  content={attempt.receipt}
                  nodeId={active.id}
                  value={value.kind === 'multiple-choice' ? value.selectedOptionIds : value.text}
                  onChange={() => {}}
                  readOnly
                />
              </QuestionSetPanel>
              {relatedKnowledge}
              <QuestionSetReflection
                value={attempt.reflection}
                busy={busy || Boolean(progress.error)}
                onDirty={setReflectionDirty}
                onChange={(reflection) => updateMarking(() => ({ reflection }))}
              />
            </div>
          )}
          {attempt.status !== 'complete' && (
            <Button
              variant="ghost"
              disabled={formDirty || reflectionDirty}
              onClick={() =>
                void perform(async () => {
                  await progress.flush();
                  if (study) study.onExit();
                  else await navigate(origin?.questionSetReturnTo ?? base);
                })
              }
            >
              Save and finish later
            </Button>
          )}
        </div>
      </header>
      {(progress.error || actionError) && (
        <div className="qs-error" role="alert">
          {progress.error?.message ?? actionError}
          {progress.error &&
            !(progress.error instanceof QuestionSetAttemptRevisionConflictError) && (
              <Button variant="ghost" onClick={() => void perform(progress.retry)}>
                Retry save
              </Button>
            )}
          {progress.error instanceof QuestionSetAttemptRevisionConflictError && (
            <p>Another tab changed this attempt. Copy any unsaved text before reloading.</p>
          )}
        </div>
      )}
      {progress.blocker.state === 'blocked' && (formDirty || reflectionDirty || progress.error) && (
        <div className="qs-error" role="alert">
          Save or cancel your unfinished changes before leaving.
          <Button
            variant="ghost"
            onClick={() => progress.blocker.state === 'blocked' && progress.blocker.reset()}
          >
            Stay here
          </Button>
        </div>
      )}
      <article
        className={`qs-paper rounded-3xl bg-surface card-surface ${marking ? 'qs-paper-marking' : ''}`}
      >
        <StepSwap stepKey={`${active.id}:${marking}`} direction={transition.direction}>
          {marking ? (
            <>
              <header className="qs-part-bar">
                <h2
                  id={`qs-question-${active.id}`}
                  tabIndex={-1}
                  className="focus-visible:shadow-none"
                >
                  {[
                    ...active.parentIds.map((id) => allNodes.find((row) => row.id === id)!.label),
                    active.label,
                  ].join(' ')}
                </h2>
                <MarkPips
                  max={answer.maxMarks}
                  awarded={attempt.decisions
                    .filter((row) => answer.allocations.some((a) => a.id === row.allocationId))
                    .reduce((sum, row) => sum + (row.status === 'awarded' ? row.marks : 0), 0)}
                  label={[
                    ...(criterion ? [dimensionNames[criterion.allocation.dimension]] : []),
                    `${answer.maxMarks} ${answer.maxMarks === 1 ? 'mark' : 'marks'}`,
                  ].join(' · ')}
                />
              </header>

              {criterion && (
                <QuestionSetMarking
                  key={active.id}
                  attempt={attempt}
                  nodeId={active.id}
                  allocation={criterion.allocation}
                  busy={busy || acting || Boolean(progress.error)}
                  onDraftChange={setFormDirty}
                  onDecision={(decision) =>
                    updateMarking((current) => ({
                      decisions: [
                        ...current.decisions.filter(
                          (row) => row.allocationId !== criterion.allocation.id,
                        ),
                        ...(decision ? [decision] : []),
                      ],
                    }))
                  }
                  onAnnotation={(annotation) =>
                    updateMarking((current) => ({
                      annotations: [...current.annotations, annotation],
                    }))
                  }
                  onRemoveAnnotation={(id) =>
                    updateMarking((current) => ({
                      annotations: current.annotations.filter((row) => row.id !== id),
                    }))
                  }
                  onCorrection={(content) =>
                    updateMarking((current) => ({
                      corrections: [
                        ...current.corrections.filter((row) => row.nodeId !== active.id),
                        { nodeId: active.id, content, updatedAt: Date.now() },
                      ],
                    }))
                  }
                />
              )}
            </>
          ) : (
            <QuestionSetAnswer
              content={attempt.receipt}
              nodeId={active.id}
              readOnly={acting}
              value={value.kind === 'multiple-choice' ? value.selectedOptionIds : value.text}
              onChange={(next) =>
                progress.edit(
                  active.id,
                  answer.response.kind === 'multiple-choice'
                    ? { kind: 'multiple-choice', selectedOptionIds: next as string[] }
                    : { kind: answer.response.kind, text: next as string },
                )
              }
            />
          )}
        </StepSwap>
        {!marking && relatedKnowledge}
        <footer className="qs-attempt-footer">
          <QuestionSetPracticeNavigation
            rows={
              marking
                ? criteria.map((row) => ({ nodeId: row.nodeId, allocationId: row.allocation.id }))
                : nodes.map((node) => ({ nodeId: node.id }))
            }
            index={marking ? criterionIndex : index}
            marking={marking}
            blocked={blocked}
            onMove={move}
          />
          {!marking ? (
            <>
              {blankConfirmation.open ? (
                <div ref={blankConfirmation.ref} className="qs-blank-confirm">
                  <ConfirmInline
                    message="Some parts are unanswered."
                    confirmLabel="Submit unanswered"
                    variant="default"
                    focusOnMount={blankConfirmation.focusOnMount}
                    onCancel={blankConfirmation.cancel}
                    onConfirm={() => void perform(() => submit(true))}
                  />
                </div>
              ) : (
                <div className="qs-primary-actions">
                  <Button
                    variant={advancePart ? 'ghost' : 'primary'}
                    data-attempt-primary={!advancePart || undefined}
                    data-attempt-submit
                    disabled={formDirty || reflectionDirty || acting || Boolean(progress.error)}
                    onClick={() => void perform(() => submit())}
                  >
                    {attempt.mode === 'paper' ? 'Submit paper' : 'Submit question'}
                    {!advancePart && (
                      <kbd className="qs-shortcut" aria-hidden="true">
                        {modifierShortcutLabel('↵')}
                      </kbd>
                    )}
                  </Button>
                  {advancePart && (
                    <Button
                      variant="primary"
                      data-attempt-primary
                      disabled={formDirty || reflectionDirty || acting || Boolean(progress.error)}
                      onClick={() =>
                        void perform(async () => {
                          await progress.flush();
                          await progress.run((current) =>
                            saveQuestionSetAttemptPosition(
                              current.id,
                              current.revisionId,
                              nextPart.id,
                              null,
                            ),
                          );
                        })
                      }
                    >
                      Next part
                      <kbd className="qs-shortcut" aria-hidden="true">
                        {modifierShortcutLabel('↵')}
                      </kbd>
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <QuestionSetMarkingActions
              attempt={attempt}
              blocked={blocked}
              currentMarked={currentMarked}
              nextCriterion={nextCriterion}
              criterionIndex={criterionIndex}
              criterionCount={criteria.length}
              onMove={move}
              onNextQuestion={() => {
                const next = nodes.find(
                  (node) => !feedbackAvailable(attempt, node.parentIds[0] ?? node.id),
                );
                if (next) move(next.id);
              }}
              onComplete={() =>
                void perform(() =>
                  progress.run((current) =>
                    completeQuestionSetAttempt(current.id, current.revisionId),
                  ),
                )
              }
              returnTo={origin?.questionSetReturnTo ?? base}
              returnLabel={origin?.questionSetReturnLabel ?? 'Back to set'}
            />
          )}
        </footer>
      </article>
    </div>
  );
}

/** One pip per available mark, filling as marks are awarded; details sit in the tooltip. */
function MarkPips({ max, awarded, label }: { max: number; awarded: number; label: string }) {
  return (
    <span className="qs-mark-pips" title={label}>
      <span className="sr-only">{label}</span>
      {max <= 10 ? (
        Array.from({ length: max }, (_, index) => (
          <span key={index} aria-hidden="true" data-awarded={index < awarded || undefined} />
        ))
      ) : (
        <span aria-hidden="true">
          {awarded} / {max}
        </span>
      )}
    </span>
  );
}
