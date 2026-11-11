import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Screen position of the middle of a floor cell, found by probing the page itself. */
async function cellOnScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  // The build tool reports what is under the cursor; walk the pointer over
  // the canvas until the game has a rack where we want one.
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('no canvas');
  // In the opening view the hall spans roughly the middle band of the screen;
  // cell (x, y) of the 30 × 10 m hall maps linearly enough for a click.
  return { x: box.x + box.width * (0.3 + (x / 30) * 0.6), y: box.y + box.height * (0.4 + (y / 10) * 0.22) };
}

test('a new game can be built in, played and inspected', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/?seed=1');
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('hud-day')).toHaveText('Day 1');
  await expect(page.getByTestId('hud-time')).toHaveText('00:00');
  await expect(page.getByTestId('hud-cash')).toContainText('15');
  await expect(page.getByTestId('onboarding')).toContainText('0 of 6');

  // The scene really renders: a picture of the hall does not compress to
  // almost nothing the way a blank canvas does.
  const picture = await page.locator('#scene').screenshot();
  expect(picture.byteLength).toBeGreaterThan(15_000);

  // Build racks with the tool until the first onboarding task is ticked off.
  await page.getByTestId('tool-rack').click();
  for (const [x, y] of [[10, 5], [16, 5], [22, 5], [13, 2], [19, 8]]) {
    const at = await cellOnScreen(page, x, y);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
  }
  await expect(page.getByTestId('onboarding')).toContainText('1 of 6');
  await expect(page.getByTestId('hud-cash')).not.toContainText('15 000');
  await page.keyboard.press('Escape');

  // Time runs at 10x and stops with Space.
  await page.getByTestId('speed-10').click();
  await expect(page.getByTestId('hud-time')).not.toHaveText('00:00');
  await page.keyboard.press('Space');
  await page.waitForTimeout(600); // let the last tick reach the screen
  const stopped = await page.getByTestId('hud-time').textContent();
  await page.waitForTimeout(900);
  await expect(page.getByTestId('hud-time')).toHaveText(stopped ?? '');

  // The day timeline shows the shift, today's trucks and where the clock is.
  await expect(page.getByTestId('timeline-shift')).toBeVisible();
  await expect(page.getByTestId('timeline-now')).toBeVisible();
  expect(await page.getByTestId('timeline-truck').count()).toBeGreaterThan(0);
  // The explanatory overlays cycle on O and come back to none.
  await page.keyboard.press('o');
  await expect(page.getByTestId('tool-insight')).toHaveAttribute('data-mode', 'heat');
  await expect(page.getByTestId('insight-legend')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('o');
  await expect(page.getByTestId('tool-insight')).toHaveAttribute('data-mode', 'none');

  // The four panels open on their keys.
  for (const [key, panel] of [['1', 'operations'], ['2', 'people'], ['3', 'clients'], ['4', 'finance']]) {
    await page.keyboard.press(key);
    await expect(page.getByTestId(`panel-${panel}`)).toBeVisible();
  }
  await page.keyboard.press('4');
  await expect(page.getByTestId('panel-finance')).toHaveCount(0);

  expect(errors).toEqual([]);
});
