import { expect, test } from '@playwright/test';
import fixture from '../src/fixtures/unified-v3.json' with { type: 'json' };

test('zone clicks preserve placement floor while layers hide other floors and paths', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let savedDraft = fixture;
  await page.route('**/api/admin/venues/demo/draft-v3', async (route) => {
    if (route.request().method() === 'PUT') savedDraft = route.request().postDataJSON();
    await route.fulfill({ json: savedDraft });
  });
  await page.goto('/');
  await expect(page.getByTestId('leaflet-map-v3')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-node="n-a1"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select zone Building A', exact: true }).click();
  await page.getByLabel('Placement floor', { exact: true }).selectOption('1');
  await page.getByLabel('Visible floor — Building A').selectOption('1');
  await expect(page.locator('[data-node="n-a0"]')).toHaveCount(0);
  await expect(page.locator('[data-node="n-b0"]')).toHaveCount(1);
  await expect(page.locator('[data-edge]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add nodes', exact: true }).click();
  const box = (await page.locator('[data-zone="b-a"]').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(page.getByRole('button', { name: 'Select Node n-1 n-1', exact: true })).toBeVisible();
  await expect(page.getByLabel('Placement floor', { exact: true })).toHaveValue('1');
  await expect(page.locator('.node-inspector')).toContainText('Floor 1 · b-a');
  await expect(page.locator('[data-node="n-1"]')).toHaveCount(1);

  await page.getByLabel('Visible floor — Building A').selectOption('0');
  await expect(page.locator('[data-node="n-1"]')).toHaveCount(0);
  await expect(page.locator('[data-edge]')).toHaveCount(2);
  await expect(page.getByLabel('Placement floor', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  expect(savedDraft.nodes.find((node) => node.id === 'n-1')).toMatchObject({ zoneId: 'b-a', z: 1 });
  await page.screenshot({ path: testInfo.outputPath('editor-layers.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('visitor uses the current venue publicly and switches visible floors along a route', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/venues/campus/latest', (route) => route.fulfill({ json: { venueId: 'campus', version: 2 } }));
  await page.route('**/api/venues/campus/versions/2/manifest', (route) => route.fulfill({ json: {
    ...fixture, venueId: 'campus', version: 2, profiles: [],
    places: [{ id: 'landing', name: 'Upper landing', nodeId: 'n-a1', zoneId: 'b-a' }],
  } }));
  await page.goto('/v/campus');
  await expect(page.getByRole('link', { name: 'Editor', exact: true })).toHaveAttribute('href', '/editor/campus');
  await page.getByLabel('Starting point', { exact: true }).selectOption('n-out');
  await page.getByLabel('Destination', { exact: true }).selectOption('n-a1');
  await expect(page.getByText('Take stairs to Building A · Floor 1', { exact: false })).toBeVisible();
  await expect(page.locator('[data-node="n-a1"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Building A · Floor 1', exact: true }).click();
  await expect(page.getByLabel('Visible floor — Building A')).toHaveValue('1');
  await expect(page.locator('[data-node="n-a1"]')).toHaveCount(1);
  await expect(page.locator('[data-node="n-a0"]')).toHaveCount(0);
  await page.getByLabel('Visible floor — Building B').selectOption('hidden');
  await expect(page.locator('[data-zone="b-b"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('visitor-route.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
