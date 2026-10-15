import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');
const artifactDir = resolve(process.cwd(), '../../../sdd/2026-10-14-map-authoring-redesign/artifacts/task10-round1');

async function setupStatic(page: import('@playwright/test').Page) {
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  const draft = staticDraft();
  draft.nodes.push({ id: 's-out', name: 'Outdoor point', frameId: 'frame-outdoor-z0', position: { kind: 'local', x: .5, y: .5 }, zoneId: null, z: 0, fingerprintRevision: 1, visitorVisible: true });
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

async function chooseFrame(page: import('@playwright/test').Page, name: RegExp) {
  await page.locator('.layer-picker-popover summary').click();
  await page.locator('.layer-picker-options').getByRole('button', { name }).click();
}

async function canvasClick(page: import('@playwright/test').Page, x: number, y: number, label = 'Static floor plan') {
  const canvas = page.getByRole('application', { name: label });
  const image = canvas.locator('.leaflet-image-layer');
  const box = await image.boundingBox();
  if (!box) throw new Error('Active frame image is not visible');
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
  const initialNodeIds = await page.locator('.v5-node-marker').evaluateAll((markers) => markers.map((marker) => marker.getAttribute('data-node-id')).filter(Boolean));
  expect(initialNodeIds).toEqual(['s-a0', 's-a0b']);
  await canvasClick(page, 0.36, 0.42);
  await expect.poll(async () => {
    const ids = await page.locator('.v5-node-marker').evaluateAll((markers) => markers.map((marker) => marker.getAttribute('data-node-id')).filter((id): id is string => Boolean(id)));
    return ids.find((id) => !initialNodeIds.includes(id)) ?? '';
  }).not.toBe('');
  const createdIds = await page.locator('.v5-node-marker').evaluateAll((markers) => markers.map((marker) => marker.getAttribute('data-node-id')).filter((id): id is string => Boolean(id) && !['s-a0', 's-a0b'].includes(id)));
  expect(createdIds).toHaveLength(1);
  const createdId = createdIds[0]!;
  await expect(page.locator(`[data-node-id="${createdId}"]`)).toBeVisible();
  await expect(page.locator('[data-node-id="s-a0g"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator(`[data-node-id="${createdId}"]`).click();
  await expect(page.getByRole('heading', { name: 'Node properties' })).toBeVisible();
  const priorNodeName = await page.getByLabel('Name').inputValue();
  await page.getByLabel('Name').fill('Lobby renamed');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Lobby renamed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Name')).toHaveValue(priorNodeName);
  await page.getByRole('button', { name: 'Delete node' }).click();
  await expect(page.locator(`[data-node-id="${createdId}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator(`[data-node-id="${createdId}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await expect(page.getByRole('heading', { name: 'Regular path' })).toBeVisible();
  await page.getByLabel('Path name').fill('Browser route');
  await page.locator('[data-node-id="s-a0b"]').click();
  await page.locator(`[data-node-id="${createdId}"]`).click();
  await expect(page.getByText('2 points', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.locator('.v5-status')).toContainText('Path');

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await expect(page.getByRole('heading', { name: 'Stair connection' })).toBeVisible();
  await canvasClick(page, 0.38, 0.42);
  await chooseFrame(page, /Building A · Level 1/);
  const inspector = page.getByRole('complementary', { name: 'Map settings' });
  await expect(inspector.getByRole('button', { name: 'Discard' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Pending input discarded.');

  await page.getByRole('button', { name: /^Node · Stair/ }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await canvasClick(page, 0.34, 0.76);
  await expect(page.locator('.v5-status')).toContainText('Node placed');
  await page.getByRole('button', { name: /^Node · Regular/ }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await canvasClick(page, 0.34, 0.76);
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await chooseFrame(page, /Building A · Ground/);
  await canvasClick(page, 0.72, 0.78);
  await expect(page.getByRole('button', { name: 'Finish Stair' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish Stair' }).click();
  await expect(page.locator('.v5-status')).toContainText('Stair');

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await chooseFrame(page, /Building A · Ground/);
  await page.locator('[data-node-id="s-a0b"]').click();
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await expect(page.locator('.layer-current-frame')).toContainText('Building A · Ground');
  await expect(page.locator('.v5-endpoint-steps')).toContainText('Indoor landing · Ground corridor · Building A · Ground');
  await chooseFrame(page, /^Outdoor/);
  await expect(page.locator('.layer-current-frame')).toHaveText('Outdoor');
  await page.locator('[data-node-id="s-out"]').click();
  await expect(page.locator('.v5-endpoint-steps')).toContainText('Outdoor landing · Outdoor point · Outdoor · Ground');
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
  await chooseFrame(page, /Building A · Ground/);
  await page.locator('[data-node-id="n-a0b"]').click();
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await expect(page.locator('.layer-current-frame')).toContainText('Building A · Ground');
  await expect(page.locator('.v5-endpoint-steps')).toContainText('Indoor landing · Ground corridor · Building A · Ground');
  await chooseFrame(page, /^Outdoor/);
  await expect(page.locator('.layer-current-frame')).toHaveText('Outdoor');
  await page.locator('[data-node-id="n-out"]').click();
  await expect(page.locator('.v5-endpoint-steps')).toContainText('Outdoor landing · Outdoor entrance · Outdoor · Ground');
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Entrance added');
  await page.getByRole('button', { name: 'Boundary' }).click();
  await expect(page.getByLabel('North')).toBeVisible();
  await expect(page.getByLabel('Left')).toHaveCount(0);
});
