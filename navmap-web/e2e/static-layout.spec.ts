import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { E2E_PASSWORD, adminLogin, createVenue, getDraftJson, putDraft } from './admin-api';
import { staticDraft, type MapDraft } from '../src/fixtures/map-v5';
// 8x8 RGB PNG: decodes through createImageBitmap in headless Chromium, where
// the 1x1 transparent fixture used elsewhere is rejected at preview time.
const floorPlanPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4gAMwDC0JAFTitAG8PdreAAAAAElFTkSuQmCC', 'base64');

function unassignedDraft(venueId: string): MapDraft {
  const draft = staticDraft();
  draft.venueId = venueId;
  // Empty floors: saves reject navigable content on frames without a plan.
  draft.nodes = [];
  draft.edges = [];
  draft.paths = [];
  draft.transitions = [];
  draft.places = [];
  draft.anchors = [];
  draft.aps = [];
  draft.frames = draft.frames.map((frame) => ({ ...frame, background: undefined, calibration: undefined }));
  return draft;
}

async function seedStaticMap(request: APIRequestContext, name: string): Promise<string> {
  await adminLogin(request);
  const venueId = await createVenue(request, name, 'static');
  await putDraft(request, venueId, unassignedDraft(venueId));
  return venueId;
}

async function openEditor(page: Page, venueId: string): Promise<void> {
  await page.request.post('/api/admin/login', { data: { password: E2E_PASSWORD } });
  await page.goto(`/editor/${venueId}`);
  await expect(page.getByRole('application', { name: 'Static floor plan' })).toBeVisible();
}

async function uploadPng(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await page.getByLabel('Choose a PNG or PDF').setInputFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.getByRole('button', { name: 'Assign page to floor' })).toBeVisible();
}

async function assignCurrentPage(page: Page, floorIndex: 0 | 1): Promise<string> {
  const labels = ['Building A · Ground', 'Building A · Level 1'];
  await page.getByLabel('Assign to floor').selectOption({ index: floorIndex });
  await page.getByRole('button', { name: 'Assign page to floor' }).click();
  const floor = labels[floorIndex]!;
  await expect(page.locator('.layout-import-frame-state', { hasText: floor }).first()).toContainText('plan assigned');
  return floor;
}

test('uploads a PNG floor plan, assigns it, and keeps it after reload', async ({ page, request }, testInfo) => {
  const venueId = await seedStaticMap(request, `Static upload ${testInfo.project.name}`);
  await openEditor(page, venueId);
  await expect(page.getByText('Add a plan to this floor before placing nodes or paths.')).toBeVisible();
  await uploadPng(page, 'floor.png', floorPlanPng);
  await assignCurrentPage(page, 0);
  await expect(page.locator('.leaflet-image-layer')).toHaveJSProperty('naturalWidth', 8);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v5-publish-bar')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('.leaflet-image-layer')).toHaveJSProperty('naturalWidth', 8);
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.locator('.layout-import-frame-state', { hasText: 'Building A · Ground' })).toContainText('plan assigned');
});

test('calibrates an uploaded floor and reloads the saved scale', async ({ page, request }, testInfo) => {
  const venueId = await seedStaticMap(request, `Static scale ${testInfo.project.name}`);
  await openEditor(page, venueId);
  await uploadPng(page, 'floor.png', floorPlanPng);
  await assignCurrentPage(page, 0);
  await page.getByLabel('Point A x').fill('0.1');
  await page.getByLabel('Point A y').fill('0.2');
  await page.getByLabel('Point B x').fill('0.2');
  await page.getByLabel('Point B y').fill('0.2');
  await page.getByLabel('Known distance, metres').fill('0.01');
  await page.getByRole('button', { name: 'Save floor scale' }).click();
  await expect(page.getByText(/Calibrated ·/)).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v5-publish-bar')).toContainText('Saved');
  const saved = (await getDraftJson(request, venueId)) as MapDraft;
  const frame = saved.frames.find((item) => item.id === 'frame-b-a-z0');
  expect(frame?.calibration?.metersPerPixel).toBeCloseTo(0.0125, 5);
});

test('rejects a zero-distance calibration without changing the map', async ({ page, request }, testInfo) => {
  const venueId = await seedStaticMap(request, `Static bad scale ${testInfo.project.name}`);
  await openEditor(page, venueId);
  await uploadPng(page, 'floor.png', floorPlanPng);
  await assignCurrentPage(page, 0);
  await page.getByLabel('Point A x').fill('0.5');
  await page.getByLabel('Point A y').fill('0.5');
  await page.getByLabel('Point B x').fill('0.5');
  await page.getByLabel('Point B y').fill('0.5');
  await page.getByLabel('Known distance, metres').fill('10');
  await page.getByRole('button', { name: 'Save floor scale' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose two distinct points and a positive distance');
  const saved = (await getDraftJson(request, venueId)) as MapDraft;
  expect(saved.frames.find((item) => item.id === 'frame-b-a-z0')?.calibration).toBeUndefined();
});

test('imports two PDF pages onto two separate floors', async ({ page, request }, testInfo) => {
  const venueId = await seedStaticMap(request, `Static pdf ${testInfo.project.name}`);
  await openEditor(page, venueId);
  const pdfBuffer = await readFile('test/fixtures/layouts/two-page.pdf');
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await page.getByLabel('Choose a PNG or PDF').setInputFiles({ name: 'floors.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.getByLabel('PDF page')).toBeVisible();
  expect(await page.getByLabel('PDF page').locator('option').count()).toBe(2);
  await page.getByLabel('PDF page').selectOption('2');
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await assignCurrentPage(page, 0);
  await page.getByLabel('PDF page').selectOption('1');
  await assignCurrentPage(page, 1);
});

test('legacy V4 venue stays readable in the visitor with destinations and no path lines', async ({ page }) => {
  await page.goto('/v/legacy-v4', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Visitor map — Legacy V4 Hall' })).toBeVisible();
  await expect(page.getByLabel('Starting point')).toContainText('Legacy entrance');
  await expect(page.getByLabel('Destination')).toContainText('Legacy lobby');
  await page.getByLabel('Starting point').selectOption('n-legacy-out');
  await page.getByLabel('Destination').selectOption('n-legacy-hall');
  await expect(page.locator('[aria-label="Directions"]')).toBeVisible();
  await expect(page.locator('[data-node-id], [data-edge], [data-transition]')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
});

test('two-floor static visitor loads immutable floor assets and switches floors', async ({ page }) => {
  const publicAssetRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/')) publicAssetRequests.push(request.url());
  });
  await page.goto('/v/static-two-floor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Visitor map — Static Two-Floor Hall' })).toBeVisible();
  await page.getByLabel('Manual floor selection').selectOption('frame-b-a-z0');
  const background = page.locator('.leaflet-image-layer');
  await expect(background).toBeVisible();
  await expect.poll(() => background.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(publicAssetRequests.length).toBeGreaterThan(0);
  expect(publicAssetRequests.every((url) => url.includes('/api/venues/static-two-floor/versions/1/assets/'))).toBe(true);
  await page.getByLabel('Manual floor selection').selectOption('frame-b-a-z1');
  await expect.poll(() => background.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('[data-node-id], [data-edge], [data-transition]')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
});

test('geographic visitor shows GPS permission states and static visitor never asks for GPS', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  });
  await page.goto('/v/geo-v5', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Geographic V5 Park/ })).toBeVisible();
  await page.getByRole('button', { name: 'Locate me' }).click();
  await expect(page.getByTestId('gps-status')).toContainText('GPS is unavailable');
  await page.goto('/v/static-two-floor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Locate me' })).toHaveCount(0);
});
