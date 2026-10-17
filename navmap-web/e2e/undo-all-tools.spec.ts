import { expect, test } from '@playwright/test';
import { staticDraft } from '../src/fixtures/map-v5';
import type { MapDraft } from '../src/map-contract';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');

async function openEditor(page: import('@playwright/test').Page, failNextSave = false) {
  const draft = staticDraft();
  draft.venueId = 'demo';
  draft.frames.find((frame) => frame.id === 'frame-outdoor-z0')!.background = {
    assetId: 'bg-outdoor', width: 1000, height: 1000,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', byteLength: 1,
  };
  const savedDrafts: MapDraft[] = [];
  let failOnce = failNextSave;
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => {
    if (route.request().method() === 'PUT') {
      if (failOnce) {
        failOnce = false;
        return route.fulfill({ status: 500, json: { error: 'database is locked' } });
      }
      savedDrafts.push(route.request().postDataJSON() as MapDraft);
      return route.fulfill({ json: savedDrafts.at(-1) });
    }
    return route.fulfill({ json: draft });
  });
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect(page.locator('.v5-node-marker')).toHaveCount(2);
  return { draft, savedDrafts };
}

async function mapClick(page: import('@playwright/test').Page, x: number, y: number) {
  const canvas = page.getByRole('application', { name: 'Static floor plan' });
  const image = canvas.locator('.leaflet-image-layer');
  const box = (await image.count()) ? await image.boundingBox() : await canvas.boundingBox();
  if (!box) throw new Error('Map canvas is not visible');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

async function selectNodeByName(page: import('@playwright/test').Page, name: RegExp) {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('tab', { name: 'Nodes' }).click();
  await page.getByRole('list', { name: 'Nodes' }).getByRole('button', { name }).first().click();
  await expect(page.getByRole('heading', { name: 'Node properties' })).toBeVisible();
}

test('node placement, rename, and deletion each undo and redo', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await mapClick(page, 0.6, 0.6);
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(3);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(2);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(3);

  await selectNodeByName(page, /Node n-/);
  const originalName = await page.getByLabel('Name').inputValue();
  await page.getByLabel('Name').fill('Undo probe');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Undo probe');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Name')).toHaveValue(originalName);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Undo probe');

  await page.getByRole('button', { name: 'Delete node' }).click();
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.locator('.v5-node-marker').count()).toBe(2);
});

test('regular path finish and deletion undo and redo', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await mapClick(page, 0.75, 0.75);
  await mapClick(page, 0.85, 0.7);
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Path added');
  await page.getByRole('tab', { name: 'Paths' }).click();
  const paths = page.getByRole('list', { name: 'Paths' });
  const drawn = paths.getByRole('button', { name: /^Path/ });
  await expect(drawn).toHaveCount(1);
  await expect(paths.getByRole('button', { name: /Ground corridor/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(drawn).toHaveCount(0);
  await expect(paths.getByRole('button', { name: /Ground corridor/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(drawn).toHaveCount(1);

  await drawn.first().click();
  await expect(page.getByRole('heading', { name: 'Path properties' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete path' }).click();
  await expect(drawn).toHaveCount(0);
  await expect(paths.getByRole('button', { name: /Ground corridor/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(drawn).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(drawn).toHaveCount(0);
});

test('entrance and stair commits undo atomically in one history entry', async ({ page }) => {
  const { savedDrafts } = await openEditor(page);
  await selectNodeByName(page, /Ground corridor/);
  await page.getByLabel('Name').fill('Baseline corridor');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedDrafts.length).toBe(1);
  const baseline = savedDrafts[0]!;

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await mapClick(page, 0.43, 0.48);
  await page.locator('.layer-picker-popover summary').click();
  await page.locator('.layer-picker-options').getByRole('button', { name: /^Outdoor/ }).click();
  await mapClick(page, 0.48, 0.52);
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Entrance added');
  expect(baseline.transitions).toHaveLength(1);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectNodeByName(page, /Baseline corridor/);
  await page.getByLabel('Name').fill('After entrance undo');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedDrafts.length).toBe(2);
  const afterUndo = savedDrafts[1]!;
  expect(afterUndo.transitions).toEqual(baseline.transitions);
  expect(afterUndo.paths).toEqual(baseline.paths);
  expect(afterUndo.edges).toEqual(baseline.edges);
  expect(afterUndo.nodes.filter((node) => node.id === 's-a0b')).toHaveLength(1);

  await page.locator('.layer-picker-popover summary').click();
  await page.locator('.layer-picker-options').getByRole('button', { name: /Building A · Ground/ }).click();
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await mapClick(page, 0.3, 0.7);
  await page.locator('.layer-picker-popover summary').click();
  await page.locator('.layer-picker-options').getByRole('button', { name: /Building A · Level 1/ }).click();
  await mapClick(page, 0.32, 0.72);
  await page.getByRole('button', { name: 'Finish Stair' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Stairs added');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectNodeByName(page, /After entrance undo/);
  await page.getByLabel('Name').fill('After stair undo');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedDrafts.length).toBe(3);
  const afterStairUndo = savedDrafts[2]!;
  expect(afterStairUndo.transitions).toEqual(afterUndo.transitions);
  expect(afterStairUndo.paths).toEqual(afterUndo.paths);
  expect(afterStairUndo.nodes.filter((node) => node.id === 's-a0b')).toHaveLength(1);
});

test('place creation and deletion undo and redo', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Places', exact: true }).click();
  await page.getByLabel('Place name').fill('Undo cafe');
  await page.getByLabel('Indoor node').selectOption('s-a0b');
  await page.getByRole('button', { name: 'Add place' }).click();
  const places = page.getByRole('list', { name: 'Places' });
  await expect(places.getByRole('button', { name: /^Undo cafe/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Undo cafe' }).click();
  await expect(places.getByRole('button', { name: /^Undo cafe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(places.getByRole('button', { name: /^Undo cafe/ })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(places.getByRole('button', { name: /^Undo cafe/ })).toHaveCount(0);
});

test('Ctrl+Z during a gesture clears pending input without touching history', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await mapClick(page, 0.75, 0.75);
  await expect(page.locator('.v5-status')).toContainText('1 points');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.v5-status')).not.toContainText('points');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await mapClick(page, 0.4, 0.4);
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('1 of 2 endpoints')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('a failed save keeps the document and its undo history', async ({ page }) => {
  const { savedDrafts } = await openEditor(page, true);
  await selectNodeByName(page, /Ground lobby/);
  await page.getByLabel('Name').fill('Save failure probe');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v5-publish-bar')).toContainText('Save failed');
  expect(savedDrafts).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v5-publish-bar')).toContainText('Saved');
  await expect.poll(() => savedDrafts.length).toBe(1);
  expect(savedDrafts[0]!.nodes.find((node) => node.id === 's-a0')?.name).toBe('Save failure probe');
});

test('switching maps with unsaved changes requires an explicit choice', async ({ page }) => {
  await openEditor(page);
  await page.route('**/api/venues/demo/latest', (route) => route.fulfill({ status: 404, json: { error: 'no published version' } }));
  await selectNodeByName(page, /Ground lobby/);
  await page.getByLabel('Name').fill('Dirty probe');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('link', { name: 'Visitor' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(page.url()).toContain('/editor/demo');
  await page.getByRole('link', { name: 'Visitor' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect.poll(() => page.url()).toContain('/v/demo');
});
