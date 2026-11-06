import { expect, test, type Page } from '@playwright/test';
import { enterFreshLacuna } from './fixtures/lacunaApp';

type OverflowSample = {
  t: number;
  main: number;
  inner: number;
  scrollbarWidth: string;
};

async function sampleToggle(page: Page): Promise<OverflowSample[]> {
  return page.evaluate(
    () =>
      new Promise<OverflowSample[]>((resolve) => {
        const main = document.querySelector('main');
        const inner = document.querySelector('[data-flow-expansion-content] .overflow-y-auto');
        if (!(main instanceof HTMLElement) || !(inner instanceof HTMLElement)) {
          throw new Error('Expected the New course scrollers');
        }
        const samples: OverflowSample[] = [];
        const start = performance.now();
        const tick = () => {
          samples.push({
            t: Math.round(performance.now() - start),
            main: main.scrollHeight - main.clientHeight,
            inner: inner.scrollHeight - inner.clientHeight,
            scrollbarWidth: getComputedStyle(inner).getPropertyValue('scrollbar-width'),
          });
          if (performance.now() - start < 2500) requestAnimationFrame(tick);
          else resolve(samples);
        };
        requestAnimationFrame(tick);
      }),
  );
}

// Toggling the study target grows the creation panel through an animation. While
// the panel settles, neither the page nor the panel may show a scrollbar: the
// shell clips the travelling form, and the inner scroller hides its own chrome.
test('switching study targets never flashes a scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 700 });
  await enterFreshLacuna(page);
  await page.locator('main').getByRole('button', { name: 'New course', exact: true }).click();
  const form = page.getByRole('form', { name: 'New course' });
  await expect(form).toBeVisible();

  for (const target of ['Exam date', 'Steady retention']) {
    const sampling = sampleToggle(page);
    await form.getByText(target, { exact: true }).click();
    await expect(form.getByRole('radio', { name: new RegExp(target) })).toBeChecked();
    for (const sample of await sampling) {
      expect(sample.main, `page overflow at t=${sample.t}ms`).toBeLessThanOrEqual(1);
      if (sample.inner > 1) {
        expect(
          sample.scrollbarWidth,
          `panel scrollbar chrome at t=${sample.t}ms with ${sample.inner}px overflow`,
        ).toBe('none');
      }
    }
  }
});
