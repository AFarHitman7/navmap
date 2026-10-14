import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');
const artifactDir = resolve(process.cwd(), '../../../sdd/2026-10-14-map-authoring-redesign/artifacts/task10-round1');

async function setupStatic(page: import('@playwright/test').Page) {
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  const draft = staticDraft();
  draft.frames.find((frame) => frame.zoneId === null)!.background = {
    assetId: 'bg-outdoor', width: 1000, height: 1000,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', byteLength: 1,
  };
  await page.route('**/api/admin/venues/task10-static/draft-v3', (route) => route.fulfill({ json: { ...draft, venueId: 'task10-static' } }));
  await page.route('**/api/admin/venues/task10-static/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/task10-static');
  await expect(page.getByRole('heading', { name: 'task10-static' })).toBeVisible();
  await expect(page.locator('.leaflet-image-layer')).toHaveJSProperty('naturalWidth', 1);
}

async function canvasClick(page: import('@playwright/test').Page, x: number, y: number, label = 'Static floor plan') {
  const canvas = page.getByRole('application', { name: label });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Static Leaflet canvas is not visible');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

test('Task 10 real static canvas workflows and focused inspectors', async ({ page }, testInfo) => {
  await mkdir(artifactDir, { recursive: true });
  await setupStatic(page);
  const viewport = testInfo.project.name === 'mobile' ? '390x844' : '1280x800';
  await page.screenshot({ path: resolve(artifactDir, `static-initial-${viewport}.png`), fullPage: true });

  const nodeMenu = page.getByRole('button', { name: 'Node', exact: true });
  await nodeMenu.click();
  await expect(page.getByRole('menuitemradio', { name: 'Regular' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Entrance' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nodeMenu).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);

  await nodeMenu.click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await expect(page.getByRole('heading', { name: 'Regular node' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Places' })).toHaveCount(0);
  await canvasClick(page, 0.36, 0.42);
  await expect(page.locator('.v5-node-marker')).toHaveCount(4);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.v5-node-marker').last().locator('span').click();
  await expect(page.getByRole('heading', { name: 'Node properties' })).toBeVisible();
  const priorNodeName = await page.getByLabel('Name').inputValue();
  await page.getByLabel('Name').fill('Lobby renamed');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Lobby renamed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Name')).toHaveValue(priorNodeName);
  await page.getByRole('button', { name: 'Delete node' }).click();
  await expect(page.locator('.v5-node-marker')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.v5-node-marker')).toHaveCount(4);

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await expect(page.getByRole('heading', { name: 'Regular path' })).toBeVisible();
  await page.getByLabel('Path name').fill('Browser route');
  await canvasClick(page, 0.28, 0.3);
  await canvasClick(page, 0.72, 0.66);
  await expect(page.getByText('2 points', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.locator('.v5-status')).toContainText('Path');

  await page.getByRole('button', { name: 'Node', exact: false }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await expect(page.getByRole('heading', { name: 'Stair connection' })).toBeVisible();
  await canvasClick(page, 0.38, 0.42);
  await page.getByRole('button', { name: /Building A · 1/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Map settings' });
  await expect(inspector.getByRole('button', { name: 'Discard' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Pending input discarded.');

  await page.getByRole('button', { name: /^Node/ }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await canvasClick(page, 0.34, 0.76);
  await expect(page.locator('.v5-status')).toContainText('Node placed');
  await page.getByRole('button', { name: /^Node/ }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await canvasClick(page, 0.34, 0.76);
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await page.getByRole('button', { name: /Building A · 0/ }).click();
  await canvasClick(page, 0.72, 0.78);
  await expect(page.getByRole('button', { name: 'Finish Stair' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish Stair' }).click();
  await expect(page.locator('.v5-status')).toContainText('Stair');

  await page.getByRole('button', { name: 'Node', exact: false }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await canvasClick(page, 0.74, 0.28);
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await page.getByRole('button', { name: 'Outdoor', exact: true }).click();
  await canvasClick(page, 0.48, 0.52);
  await expect(page.getByRole('button', { name: 'Finish Entrance' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toContainText('Entrance');

  await page.getByRole('button', { name: 'Boundary' }).click();
  await expect(page.getByRole('heading', { name: 'Boundary' })).toBeVisible();
  await expect(page.getByLabel('Left')).toBeVisible();
  await page.getByRole('button', { name: 'Building', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Building', exact: true })).toBeVisible();
  await expect(page.getByLabel('Building name')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Places' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.getByRole('heading', { name: 'Floor plans' })).toBeVisible();
  await expect(page.getByText('Add a floor plan')).toBeVisible();
  await page.getByRole('button', { name: 'Places' }).click();
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible();
  await expect(page.getByLabel('Place name')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).first().click();
  await expect(page.getByRole('heading', { name: 'Publish map' })).toBeVisible();
  await page.screenshot({ path: resolve(artifactDir, `static-publish-${viewport}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Task 10 geographic Leaflet entrance endpoints use their active frames', async ({ page }, testInfo) => {
  await mkdir(artifactDir, { recursive: true });
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/task10-geo/draft-v3', (route) => route.fulfill({ json: { ...geographicDraft(), venueId: 'task10-geo' } }));
  await page.route('**tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/task10-geo');
  await expect(page.getByRole('heading', { name: 'task10-geo' })).toBeVisible();
  const viewport = testInfo.project.name === 'mobile' ? '390x844' : '1280x800';
  await page.screenshot({ path: resolve(artifactDir, `geographic-initial-${viewport}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await page.getByRole('button', { name: /Building A · 0/ }).click();
  await canvasClick(page, 0.62, 0.48, 'Geographic map');
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await page.getByRole('button', { name: 'Outdoor' }).click();
  await canvasClick(page, 0.38, 0.5, 'Geographic map');
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Entrance added');
  await page.getByRole('button', { name: 'Boundary' }).click();
  await expect(page.getByLabel('North')).toBeVisible();
  await expect(page.getByLabel('Left')).toHaveCount(0);
});
