import { expect, test, type Page } from '@playwright/test';

async function drag(page: Page, testId: string, a: [number, number], b: [number, number]) {
  const canvas = page.getByTestId(testId);
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * b[0], box.y + box.height * b[1], { steps: 10 });
  await page.mouse.up();
}

const BLANK_V3 = {
  schemaVersion: 4,
  venueId: 'demo',
  boundary: null,
  indoorZones: [],
  nodes: [],
  edges: [],
  places: [],
  anchors: [],
  aps: [],
};

async function mapPaneTransform(page: Page) {
  return page.locator('.leaflet-map-pane').evaluate((el) => getComputedStyle(el).transform || (el as HTMLElement).style.transform);
}

test('unified map: boundary, two zones, nodes, connect, publish v4', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await request.post('/api/admin/login', { data: { password: 'browser-test-only' } });
  // Fresh venue per run: version counters are shared across projects in one run.
  const created = await request.post('/api/admin/venues', { data: { name: 'Unified E2E' } });
  expect(created.ok()).toBe(true);
  const venueId = (await created.json()).id as string;
  await request.put(`/api/admin/venues/${venueId}/draft-v3`, { data: { ...BLANK_V3, venueId } });
  await page.goto(`/editor/${venueId}`);
  await page.getByLabel('Admin password').fill('browser-test-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const map = page.getByTestId('leaflet-map-v3');
  await expect(map).toHaveAttribute('data-ready', 'true');
  await expect(map).toHaveAttribute('data-zones', '0');

  // Draw the outdoor boundary.
  await page.getByRole('button', { name: 'Draw boundary', exact: true }).first().click();
  await drag(page, 'leaflet-map-v3', [0.25, 0.25], [0.75, 0.75]);
  await expect(page.getByRole('button', { name: 'Apply rectangle' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply rectangle' }).click();
  await expect(page.getByText('Boundary coordinates')).toBeVisible();

  // Draw two indoor zones.
  for (const [name, area] of [['Building A', [0.3, 0.3, 0.48, 0.6]], ['Building B', [0.55, 0.35, 0.72, 0.62]]] as const) {
    await page.getByRole('button', { name: 'Add zone', exact: true }).click();
    await drag(page, 'leaflet-map-v3', [area[0], area[1]], [area[2], area[3]]);
    await page.getByLabel('New zone name').fill(name);
    await page.getByRole('button', { name: 'Apply rectangle' }).click();
    await expect(page.getByRole('button', { name: `Select zone ${name}` })).toBeVisible();
  }
  await expect(map).toHaveAttribute('data-zones', '2');

  // Clicking inside a zone while adding nodes must still reach the map.
  await page.getByRole('button', { name: 'Add nodes', exact: true }).click();
  const zoneBox = (await page.locator('[data-zone="b-building-a"]').boundingBox())!;
  await page.mouse.click(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2);
  await expect(page.getByRole('button', { name: 'Select Node n-1 n-1', exact: true })).toBeVisible();
  await expect(page.locator('.node-inspector')).toContainText('b-building-a');

  // Add two outdoor nodes and connect them (fractional spots stay inside
  // the boundary on every viewport, below both drawn zones).
  await page.getByRole('button', { name: 'Add nodes', exact: true }).click();
  await page.getByLabel('Placement zone').selectOption('');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.35, y: box.height * 0.7 } });
  await expect(page.getByRole('button', { name: 'Select Node n-2 n-2', exact: true })).toBeVisible();
  await map.click({ position: { x: box.width * 0.65, y: box.height * 0.7 } });
  await expect(page.getByRole('button', { name: 'Select Node n-3 n-3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select Node n-2 n-2', exact: true }).click();
  await page.locator('.node-inspector').getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('[data-node="n-3"]').click();
  await expect(page.getByText('Points connected.')).toBeVisible();

  // Save, publish, and verify a v4 manifest.
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
  await expect(page.getByRole('status').getByText(/Published version 1\./)).toBeVisible();
  const manifest = await (await request.get(`/api/venues/${venueId}/versions/1/manifest`)).json();
  expect(manifest).toMatchObject({ schemaVersion: 4, version: 1 });
  expect(manifest.indoorZones).toHaveLength(2);
  expect(manifest.nodes).toHaveLength(3);
  expect(manifest.edges).toHaveLength(1);

  // Reload keeps the geometry.
  await page.reload();
  await expect(page.getByTestId('leaflet-map-v3')).toHaveAttribute('data-zones', '2');
  await expect(page.getByTestId('leaflet-map-v3')).toHaveAttribute('data-nodes', '3');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('node drag: move mode drags selected marker without empty-map panning', async ({ page, request }) => {
  await request.post('/api/admin/login', { data: { password: 'browser-test-only' } });
  const created = await request.post('/api/admin/venues', { data: { name: 'Node Drag E2E' } });
  expect(created.ok()).toBe(true);
  const venueId = (await created.json()).id as string;
  await request.put(`/api/admin/venues/${venueId}/draft-v3`, {
    data: {
      ...BLANK_V3,
      schemaVersion: 4,
      venueId,
      boundary: { north: 13.1, south: 13, east: 80.3, west: 80.2 },
      nodes: [{ id: 'n-drag', name: 'Outdoor drag point', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }],
    },
  });

  await page.goto(`/editor/${venueId}`);
  await page.getByLabel('Admin password').fill('browser-test-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const map = page.getByTestId('leaflet-map-v3');
  await expect(map).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Select Outdoor drag point n-drag' }).click();
  const inspector = page.locator('.node-inspector');
  await expect(inspector).toContainText('Lat 13.05000 Lng 80.25000');

  await inspector.getByRole('button', { name: 'Move' }).click();
  const beforeEmptyDrag = await mapPaneTransform(page);
  await drag(page, 'leaflet-map-v3', [0.82, 0.82], [0.62, 0.62]);
  await expect.poll(() => mapPaneTransform(page)).toBe(beforeEmptyDrag);

  const marker = page.locator('[data-node="n-drag"]');
  const markerBox = (await marker.boundingBox())!;
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(markerBox.x + markerBox.width / 2 + 24, markerBox.y + markerBox.height / 2 - 24, { steps: 8 });
  await page.mouse.up();
  await expect(inspector).not.toContainText('Lat 13.05000 Lng 80.25000');

  const beforeNavigatePan = await mapPaneTransform(page);
  await drag(page, 'leaflet-map-v3', [0.82, 0.82], [0.62, 0.62]);
  await expect.poll(() => mapPaneTransform(page)).not.toBe(beforeNavigatePan);
});
