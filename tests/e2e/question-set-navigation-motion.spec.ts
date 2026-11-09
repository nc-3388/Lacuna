import { expect, test, type Page } from '@playwright/test';
import type { QuestionSet } from '@lacuna/core/questions/questionSets';
import sharp from 'sharp';
import { createCourse, enterFreshLacuna } from './fixtures/lacunaApp';

async function openSet(page: Page) {
  await enterFreshLacuna(page);
  await createCourse(page, 'Question-set transitions');
  const courseId = new URL(page.url()).hash.split('/')[2];
  const answer = (id: string) => ({
    maxMarks: 1,
    response: { kind: 'written' as const },
    prerequisiteConceptIds: [],
    allocations: [
      {
        id,
        criterion: 'Controls cell activities.',
        maxMarks: 1,
        dimension: 'knowledge' as const,
        targetConceptIds: [],
      },
    ],
  });
  const content: QuestionSet = {
    id: 'keyboard-set',
    courseId,
    title: 'Cells',
    lessonIds: [],
    assessmentIds: [],
    questions: [
      {
        id: 'q1',
        prompt: 'Describe the nucleus.',
        parts: [
          { id: 'part-a', prompt: 'State its role.', subparts: [], answer: answer('a1') },
          {
            id: 'part-b',
            prompt: 'Explain its importance.',
            subparts: [],
            answer: answer('a2'),
          },
        ],
      },
      {
        id: 'q2',
        prompt: 'Choose the membrane property.',
        parts: [],
        answer: {
          ...answer('a3'),
          response: {
            kind: 'multiple-choice',
            selection: 'single',
            options: [
              { id: 'permeable', content: 'Selectively permeable' },
              { id: 'impermeable', content: 'Impermeable' },
            ],
            correctOptionIds: ['permeable'],
          },
        },
      },
    ],
  };
  // Seed authored content through the real browser store; all attempt writes use the UI.
  await page.evaluate(
    (record) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('lacuna');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('questionSets', 'readwrite');
          transaction.objectStore('questionSets').add(record);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
    {
      ...content,
      contentVersion: 1,
      contentRevisionId: 'keyboard-revision',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  );
  await page.goto(`/#/course/${courseId}/question-sets/${content.id}`);
  await expect(page.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();
}

test('the focused answer outline is visible on all sides after navigating', async ({
  page,
}, testInfo) => {
  await openSet(page);
  // With reduced motion, the height wrapper keeps clipping even after navigation settles.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Q1 (b)', exact: true })).toBeVisible();
  const answer = page.getByRole('textbox', { name: 'Your answer', exact: true });
  await expect(answer).toBeFocused();
  const { left, right, top, bottom, outset } = await answer.evaluate((field) => {
    const { left, right, top, bottom } = field.getBoundingClientRect();
    const { outlineOffset, outlineWidth } = getComputedStyle(field);
    return {
      left,
      right,
      top,
      bottom,
      outset: parseFloat(outlineOffset) + parseFloat(outlineWidth) / 2,
    };
  });
  const screenshot = await page.screenshot({ scale: 'css' });
  await testInfo.attach('Focused answer after navigation', {
    body: screenshot,
    contentType: 'image/png',
  });
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const index = (Math.floor(y) * info.width + Math.floor(x)) * info.channels;
    return [...data.subarray(index, index + info.channels)];
  };
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  const ring = pixel(centreX, top - outset);
  expect(ring).not.toEqual(pixel(centreX, top - outset - 4));
  expect(pixel(left - outset, centreY), 'left edge').toEqual(ring);
  expect(pixel(right + outset, centreY), 'right edge').toEqual(ring);
  expect(pixel(centreX, bottom + outset), 'bottom edge').toEqual(ring);
});

for (const width of [1280, 390]) {
  test(`navigation retains draft answers in both directions at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openSet(page);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your answer', exact: true })).toBeFocused();
    await page
      .getByRole('textbox', { name: 'Your answer', exact: true })
      .fill('Controls cell activities.');
    for (const [label, heading] of [
      ['Next', 'Q1 (b)'],
      ['Previous', 'Q1 (a)'],
    ] as const) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Your answer', exact: true })).toBeFocused();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    const answer = page.getByRole('textbox', { name: 'Your answer', exact: true });
    await expect(answer).toHaveValue('Controls cell activities.');
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
    // Reverse before slow motion can settle; writes, not decoration, gate navigation.
    await page.evaluate(() => {
      localStorage.setItem('lacuna.motionSpeed', 'slow');
      window.dispatchEvent(new CustomEvent('lacuna:motion-speed', { detail: 'slow' }));
    });
    for (const label of ['Next', 'Previous', 'Next', 'Previous']) {
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Q1 (a)', exact: true })).toBeVisible();
    await expect(answer).toHaveValue('Controls cell activities.');
    await expect(answer).toBeFocused();
    await page.reload();
    await expect(answer).toHaveValue('Controls cell activities.');
    await expect(page.getByRole('heading', { name: 'Q1 (a)', exact: true })).toBeVisible();
  });
}
