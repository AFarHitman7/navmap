import { expect, test } from '@playwright/test';
import { staticDraft } from '../src/fixtures/map-v5';
import type { MapDraft } from '../src/map-contract';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');

async function openEditor(page: import('@playwright/test').Page) {
  const draft = staticDraft();
  const savedDrafts: MapDraft[] = [];
  draft.nodes.push({ id: 's-a1c', name: 'Elevator upper', frameId: 'frame-b-a-z1', position: { kind: 'local', x: .8, y: .2 }, zoneId: 'b-a', z: 1, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0c', name: 'Elevator lower', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .8, y: .2 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0d', name: 'West junction', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .1, y: .8 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-a0e', name: 'North junction', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .1, y: .3 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-stair-low', name: 'New lower landing', frameId: 'frame-b-a-z0', position: { kind: 'local', x: .85, y: .85 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
  draft.nodes.push({ id: 's-stair-high', name: 'New upper landing', frameId: 'frame-b-a-z1', position: { kind: 'local', x: .85, y: .85 }, zoneId: 'b-a', z: 1, fingerprintRevision: 1, visitorVisible: true });
  draft.frames.find((frame) => frame.id === 'frame-outdoor-z0')!.background = {
    assetId: 'bg-outdoor', width: 1000, height: 1000,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', byteLength: 1,
  };
  draft.edges.push({ from: 's-a0c', to: 's-a1c', kind: 'elevator', cost: 4 });
  draft.transitions.push({ id: 'elevator-existing', name: 'Service elevator', kind: 'elevator', nodeIds: ['s-a0c', 's-a1c'] });
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => {
    if (route.request().method() === 'PUT') {
      const saved = route.request().postDataJSON() as MapDraft;
      savedDrafts.push(saved);
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: { ...draft, venueId: 'demo' } });
  });
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  return { draft, savedDrafts };
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

async function renameNode(page: import('@playwright/test').Page, id: string, name: string) {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await clickNode(page, id);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save name' }).click();
}

async function saveDraft(page: import('@playwright/test').Page, savedDrafts: MapDraft[]) {
  const previousCount = savedDrafts.length;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedDrafts.length).toBe(previousCount + 1);
  return savedDrafts.at(-1)!;
}

function expectOnlyNodeRename(before: MapDraft, after: MapDraft, id: string, name: string) {
  expect(after.nodes).toEqual(before.nodes.map((node) => node.id === id ? { ...node, name } : node));
  expect(after.edges).toEqual(before.edges);
  expect(after.transitions).toEqual(before.transitions);
  expect(after.paths).toEqual(before.paths);
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
  const nodes = page.getByRole('list', { name: 'Nodes' });
  await expect(nodes.getByRole('button', { name: /Elevator lower/ })).toBeVisible();
  await expect(nodes.getByRole('button', { name: /Elevator upper/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Lift A' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('button', { name: 'Lift A' })).toHaveCount(0);
});

test('pending Escape and Ctrl+Z preserve document history boundaries', async ({ page }) => {
  const { savedDrafts } = await openEditor(page);
  await renameNode(page, 's-a0b', 'Baseline corridor');
  const baseline = await saveDraft(page, savedDrafts);

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await clickNode(page, 's-a0b');
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish Entrance' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.v5-status')).toHaveText('Pending input discarded.');
  await renameNode(page, 's-a0b', 'After entrance cancel');
  const afterEntranceCancel = await saveDraft(page, savedDrafts);
  expectOnlyNodeRename(baseline, afterEntranceCancel, 's-a0b', 'After entrance cancel');

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await clickNode(page, 's-stair-low');
  await expect(page.getByRole('button', { name: 'Finish Stair' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.v5-status')).toHaveText('Pending input discarded.');
  await renameNode(page, 's-a0b', 'After stair cancel');
  const afterStairCancel = await saveDraft(page, savedDrafts);
  expectOnlyNodeRename(afterEntranceCancel, afterStairCancel, 's-a0b', 'After stair cancel');

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: /After stair cancel Node/ }).click();
  await page.getByLabel('Name').fill('Edited corridor');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Edited corridor');

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await clickNode(page, 's-a0b');
  await page.keyboard.press('Control+z');
  await expect(page.getByText('0 points', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: /After stair cancel Node/ }).click();
  await expect(page.getByLabel('Name')).toHaveValue('After stair cancel');
});

test('entrance and cross-floor stair pairs finish atomically; stair path associates with the new pair', async ({ page }) => {
  const { draft: originalDraft, savedDrafts } = await openEditor(page);
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Entrance' }).click();
  await mapClick(page, .43, .48);
  await page.getByRole('button', { name: 'Outdoor', exact: true }).click();
  await mapClick(page, .48, .52);
  await page.getByRole('button', { name: 'Finish Entrance' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Entrance added');

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await page.getByLabel('Stair name').fill('New stairs');
  await page.locator('.v5-frame-switch').getByRole('button', { name: 'Building A · 0' }).click();
  await clickNode(page, 's-stair-low');
  await expect(page.getByText('1 of 2 endpoints')).toBeVisible();
  const frameControls = page.locator('.v5-frame-switch');
  await frameControls.getByRole('button', { name: 'Building A · 1' }).click();
  await clickNode(page, 's-stair-high');
  await expect(page.getByRole('button', { name: 'Finish Stair' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish Stair' }).click();
  await expect(page.locator('.v5-status')).toHaveText('Stairs added');

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Stair' }).click();
  await expect(page.getByRole('heading', { name: 'Stair paths' })).toBeVisible();
  const newStairRow = page.getByRole('listitem').filter({ hasText: 'New stairs' });
  await newStairRow.getByRole('button', { name: 'Add path' }).click();
  await page.getByRole('tab', { name: 'Paths' }).click();
  await expect(page.getByRole('button', { name: /New stairs Stair path/ })).toBeVisible();

  const saved = await saveDraft(page, savedDrafts);
  const stairTransition = saved.transitions.find((transition) => transition.kind === 'stair' && transition.name === 'New stairs');
  expect(stairTransition).toBeDefined();
  expect(stairTransition!.nodeIds).toEqual(['s-stair-low', 's-stair-high']);
  const stairPath = saved.paths?.find((path) => path.transitionId === stairTransition!.id);
  expect(stairPath).toMatchObject({ kind: 'stair', transitionId: stairTransition!.id, nodeIds: stairTransition!.nodeIds });
  expect(saved.edges.some((edge) => edge.from === 's-stair-low' && edge.to === 's-stair-high' && edge.kind === 'stairs')).toBe(true);
  expect(saved.paths?.filter((path) => path.kind === 'regular')).toEqual(originalDraft.paths?.filter((path) => path.kind === 'regular'));
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
  await expect(page.locator('[data-node="legacy-a"]')).toBeVisible();
  await expect(page.locator('[data-node="legacy-b"]')).toBeVisible();
  await expect(page.locator('[data-edge="legacy-a:legacy-b"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-edge="legacy-a:legacy-b"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('[data-edge="legacy-a:legacy-b"]')).toHaveCount(0);
});
