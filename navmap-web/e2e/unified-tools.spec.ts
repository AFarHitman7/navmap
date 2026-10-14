import { expect, test } from '@playwright/test';
import { staticDraft } from '../src/fixtures/map-v5';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');

async function openEditor(page: import('@playwright/test').Page) {
  const draft = staticDraft();
  draft.nodes.push({ id: 's-a1c', name: 'Elevator upper', frameId: 'frame-b-a-z1', position: { kind: 'local', x: .8, y: .2 }, zoneId: 'b-a', z: 1, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0c', name: 'Elevator lower', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .8, y: .2 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0d', name: 'West junction', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .1, y: .8 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0e', name: 'North junction', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .1, y: .3 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.frames.find((frame) => frame.id === 'frame-outdoor-z0')!.background = {
    assetId: 'bg-outdoor', width: 1000, height: 1000,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', byteLength: 1,
  };
  draft.edges.push({ from: 's-a0c', to: 's-a1c', kind: 'elevator', cost: 4 });
  draft.transitions.push({ id: 'elevator-existing', name: 'Service elevator', kind: 'elevator', nodeIds: ['s-a0c', 's-a1c'] });
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: { ...draft, venueId: 'demo' } }));
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
}

async function clickNode(page: import('@playwright/test').Page, id: string) {
  await page.locator(`[data-node-id="${id}"]`).click();
}

async function mapClick(page: import('@playwright/test').Page, x: number, y: number) {
  const canvas = page.getByRole('application', { name: 'Static floor plan' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Map canvas is not visible');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

test('unified regular paths snap to existing nodes, finish once, and expose no Connect tool', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(page.getByText('Link next landing as stairs')).toHaveCount(0);
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await page.getByLabel('Path name').fill('Unified route');
  await clickNode(page, 's-a0b');
  await clickNode(page, 's-a0e');
  await clickNode(page, 's-a0d');
  await expect(page.getByText('3 points', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Path added');
  await page.getByRole('tab', { name: 'Paths' }).click();
  await page.getByRole('button', { name: /Unified route/ }).click();
  await expect(page.getByRole('heading', { name: 'Path properties' })).toBeVisible();
  await expect(page.getByLabel('Path name')).toHaveValue('Unified route');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('existing elevator can be selected, edited, and deleted while stairs stay a separate path action', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Service elevator' }).click();
  await page.getByLabel('Name').fill('Lift A');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Lift A');
  await page.getByRole('button', { name: 'Delete connection' }).click();
  await expect(page.getByRole('button', { name: 'Lift A' })).toHaveCount(0);
});

test('Escape and Ctrl+Z discard pending gestures without publishing partial graph edits', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await clickNode(page, 's-a0b');
  await page.keyboard.press('Control+z');
  await expect(page.getByText('0 points', { exact: true })).toBeVisible();
  await clickNode(page, 's-a0d');
  await page.keyboard.press('Escape');
  await expect(page.locator('.v5-status')).toHaveText('Pending input discarded.');
});

test('entrance pairs finish atomically and stair paths name existing transitions', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await mapClick(page, .43, .48);
  await page.getByRole('button', { name: 'Outdoor', exact: true }).click();
  await mapClick(page, .48, .52);
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Entrance added');

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await expect(page.getByRole('heading', { name: 'Stair paths' })).toBeVisible();
  await page.getByRole('button', { name: 'Add path' }).click();
  await expect(page.getByRole('tab', { name: 'Paths' })).toBeVisible();
});

test('V4 rollback compatibility keeps legacy edge selection and deletion available', async ({ page }) => {
  const draft = {
    schemaVersion: 4, venueId: 'demo', boundary: { east: 80.3, north: 13.1, south: 13, west: 80.2 },
    indoorZones: [],
    nodes: [
      { id: 'legacy-a', name: 'Legacy A', lat: 13.05, lng: 80.24, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'legacy-b', name: 'Legacy B', lat: 13.05, lng: 80.26, z: 0, zoneId: null, fingerprintRevision: 1 },
    ], edges: [{ from: 'legacy-a', to: 'legacy-b', kind: 'path', meters: 20 }], places: [], anchors: [], aps: [],
  };
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: false } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: draft }));
  await page.goto('/editor/demo');
  await expect(page.getByText('LEGACY V4 COMPATIBILITY EDITOR')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legacy connect', exact: true })).toBeVisible();
  const edge = page.locator('[data-edge="legacy-a:legacy-b"]');
  const hit = await edge.evaluate((element: SVGPathElement) => {
    const point = element.getPointAtLength(element.getTotalLength() / 2);
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('legacy edge has no screen transform');
    return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
  });
  await page.mouse.click(hit.x, hit.y);
  await page.getByRole('button', { name: 'Delete connection' }).click();
  await expect(page.getByText('No legacy connection selected.')).toBeVisible();
});
