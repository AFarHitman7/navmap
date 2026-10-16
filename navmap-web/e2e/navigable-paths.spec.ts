import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminLogin, createVenue, putDraft } from './admin-api';

const BLANK_V3 = {
  schemaVersion: 4,
  venueId: 'demo',
  boundary: { north: 13.1, south: 13, east: 80.3, west: 80.2 },
  indoorZones: [
    {
      id: 'b-e2e',
      name: 'Building E2E',
      bounds: { north: 13.07, south: 13.03, west: 80.23, east: 80.26 },
      floors: [
        { z: 0, label: 'Ground' },
        { z: 1, label: 'Level 1' },
      ],
    },
  ],
  nodes: [
    { id: 'n-g1', name: 'Ground lobby', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-e2e', fingerprintRevision: 1 },
    { id: 'n-g2', name: 'Ground corridor', lat: 13.055, lng: 80.248, z: 0, zoneId: 'b-e2e', fingerprintRevision: 1 },
    { id: 'n-u1', name: 'Upper landing', lat: 13.048, lng: 80.242, z: 1, zoneId: 'b-e2e', fingerprintRevision: 1 },
  ],
  edges: [],
  places: [],
  anchors: [],
  aps: [],
};

async function seedVenue(request: APIRequestContext, name: string): Promise<string> {
  await adminLogin(request);
  const venueId = await createVenue(request, name);
  await putDraft(request, venueId, { ...BLANK_V3, venueId });
  return venueId;
}

async function openEditor(page: Page, venueId: string) {
  await page.goto(`/editor/${venueId}`);
  await page.getByLabel('Admin password').fill('browser-test-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('leaflet-map-v3')).toHaveAttribute('data-ready', 'true');
}

async function saveAndReadDraft(page: Page, request: APIRequestContext, venueId: string) {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const res = await request.get(`/api/admin/venues/${venueId}/draft-v3`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as typeof BLANK_V3 & {
    paths?: { id: string; name: string; nodeIds: string[]; controlNodeIds?: string[] }[];
    edges: { from: string; to: string; meters: number; kind: string }[];
    nodes: { id: string }[];
  };
}

/** Click inside the zone rectangle at a box fraction; bubbles through to the map as a pen vertex. */
async function clickZonePoint(page: Page, x: number, y: number) {
  const zone = page.locator('[data-zone="b-e2e"]');
  await zone.scrollIntoViewIfNeeded();
  const zoneBox = (await zone.boundingBox())!;
  await page.mouse.click(zoneBox.x + zoneBox.width * x, zoneBox.y + zoneBox.height * y);
}

/**
 * Labeled synthetic fallback for route-line selection only (all marker selection
 * uses real coordinate clicks). Subdivided reference markers blanket every route
 * stretch at any reachable zoom — wheel zoom ignores touch emulation and pan
 * gestures cannot reliably centre the line — so no line point is reliably hittable.
 * Safe: graph polylines set bubblingMouseEvents:false, so no stray map vertex is
 * added (covered by a component test with real DOM propagation).
 */
async function clickPathLine(page: Page, pathId: string) {
  await page.evaluate((id) => {
    const line = document.querySelector(`[data-path="${id}"]`);
    if (!line) throw new Error(`missing path line ${id}`);
    line.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, pathId);
}

/**
 * Real hit-tested click on a node marker. Destination landings render above dense
 * generated reference points (zIndexOffset), so the landing itself always wins the
 * hit test and Playwright's own hit-target check proves the right element got the click.
 */
async function clickMarker(page: Page, nodeId: string) {
  await page.locator(`[data-node="${nodeId}"]`).click();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Enter draw-path mode and wait until the map has recreated its markers, so their click handlers carry the new mode. */
async function startDrawPath(page: Page) {
  const before = await page.locator('[data-node="n-g1"]').elementHandle().catch(() => null);
  await page.getByRole('button', { name: 'Draw path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Link next landing as stairs' })).toBeVisible();
  if (before) {
    await expect
      .poll(async () => before.evaluate((el) => !el.isConnected).catch(() => true), { timeout: 5000 })
      .toBe(true);
  }
}

test('navigable paths: bent route, junction, cancel, and selected-route deletion', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const venueId = await seedVenue(request, 'Navigable Paths E2E');
  await openEditor(page, venueId);

  // Placement follows the selected zone so map corners land on the ground floor.
  await page.getByRole('button', { name: 'Select zone Building E2E' }).click();

  // Bent route: existing landing -> map corner -> existing landing.
  await startDrawPath(page);
  await page.locator('[data-node="n-g1"]').click();
  await clickZonePoint(page, 0.25, 0.25);
  await expect(page.getByText('Pending vertices: 2')).toBeVisible();
  await page.locator('[data-node="n-g2"]').click();
  await expect(page.getByText('Pending vertices: 3')).toBeVisible();
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.getByText('Path saved to the draft.')).toBeVisible();

  let draft = await saveAndReadDraft(page, request, venueId);
  expect(draft.paths).toHaveLength(1);
  expect(draft.paths?.[0]?.controlNodeIds).toHaveLength(3);
  expect(draft.edges.filter((edge) => edge.kind === 'path').length).toBeGreaterThan(1);

  // Same-floor junction: a second route sharing the ground lobby endpoint.
  await startDrawPath(page);
  await clickMarker(page, 'n-g2');
  await clickZonePoint(page, 0.75, 0.6);
  await expect(page.getByText('Pending vertices: 2')).toBeVisible();
  await clickMarker(page, 'n-g1');
  await page.getByRole('button', { name: 'Finish path' }).click();
  draft = await saveAndReadDraft(page, request, venueId);
  expect(draft.paths).toHaveLength(2);
  expect(draft.paths?.every((path) => path.nodeIds.includes('n-g1'))).toBe(true);

  // Cancellation leaves the saved graph untouched.
  await startDrawPath(page);
  await clickMarker(page, 'n-g1');
  await clickZonePoint(page, 0.3, 0.7);
  await expect(page.getByText('Pending vertices: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel path' }).click();
  draft = await saveAndReadDraft(page, request, venueId);
  expect(draft.paths).toHaveLength(2);

  // Select the first drawn route by clicking its line and delete exactly that route; landings remain.
  const doomedId = draft.paths![0]!.id;
  const doomedName = draft.paths![0]!.name;
  const sparedId = draft.paths![1]!.id;
  await clickPathLine(page, doomedId);
  await expect(page.locator('.path-selection-panel p').first()).toContainText(doomedName);
  await expect(page.getByRole('button', { name: 'Delete path' })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete path' }).click();
  draft = await saveAndReadDraft(page, request, venueId);
  expect(draft.paths).toHaveLength(1);
  expect(draft.paths?.[0]?.id).toBe(sparedId);
  expect(draft.nodes.some((node) => node.id === 'n-g1')).toBe(true);
  expect(draft.nodes.some((node) => node.id === 'n-g2')).toBe(true);

  await expectNoOverflow(page);
  await page.screenshot({ path: `test-results/navigable-paths-basic-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test('navigable paths: explicit stairs link with labeled single-floor indicator', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const venueId = await seedVenue(request, 'Navigable Stairs E2E');
  await openEditor(page, venueId);

  await page.getByRole('button', { name: 'Select zone Building E2E' }).click();
  // The upper landing only renders once its floor is visible.
  await page.getByText('Layers', { exact: true }).click();
  await page.getByLabel('Visible floor — Building E2E').selectOption('all');
  await startDrawPath(page);
  await page.locator('[data-node="n-g1"]').click();
  // A placement-floor change alone must not create a transition; arming is explicit.
  await page.getByLabel('Placement floor').selectOption('1');
  await expect(page.getByText('Pending vertices: 1')).toBeVisible();
  // Linking from the ground floor proves auto-sync: placement follows the upper landing.
  await page.getByLabel('Placement floor').selectOption('0');
  await page.getByRole('button', { name: 'Link next landing as stairs' }).click();
  await page.locator('[data-node="n-u1"]').click();
  await expect(page.getByText('Pending vertices: 2')).toBeVisible();
  await expect(page.getByLabel('Placement floor')).toHaveValue('1');
  await clickZonePoint(page, 0.5, 0.15);
  await expect(page.getByText('Pending vertices: 3')).toBeVisible();
  await page.getByRole('button', { name: 'Finish path' }).click();
  await expect(page.getByText('Path saved to the draft.')).toBeVisible();

  const draft = await saveAndReadDraft(page, request, venueId);
  const path = draft.paths?.at(-1);
  expect(path).toBeDefined();
  const routeEdges = draft.edges.filter(
    (edge) => path?.nodeIds.includes(edge.from) && path.nodeIds.includes(edge.to),
  );
  expect(routeEdges.filter((edge) => edge.kind === 'stairs')).toHaveLength(1);

  // Isolating the ground floor hides the upper landing but keeps a labeled transition.
  await page.getByLabel('Visible floor — Building E2E').selectOption('0');
  await expect(page.locator('[data-node="n-u1"]')).toHaveCount(0);
  await expect(page.locator('[data-transition]')).toContainText('Stairs to floor 1');

  await expectNoOverflow(page);
  await page.screenshot({ path: `test-results/navigable-paths-stairs-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test('navigable paths: tile failures do not block map edits', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/tile.openstreetmap.org/**', (route) => void route.abort());
  const venueId = await seedVenue(request, 'Navigable Tiles E2E');
  await openEditor(page, venueId);

  await expect(page.locator('.map-warning')).toContainText('OSM tiles unavailable');
  await page.getByRole('button', { name: 'Select zone Building E2E' }).click();
  await page.getByRole('button', { name: 'Add nodes', exact: true }).click();
  await clickZonePoint(page, 0.3, 0.3);
  await expect(page.getByRole('button', { name: /select node n-1 n-1/i })).toBeVisible();

  const draft = await saveAndReadDraft(page, request, venueId);
  expect(draft.nodes).toHaveLength(4);

  await expectNoOverflow(page);
  await page.screenshot({ path: `test-results/navigable-paths-tiles-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});
