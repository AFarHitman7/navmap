import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, adminLogin, createVenue, getDraftJson, putDraft } from './admin-api';
import { geographicDraft } from '../src/fixtures/map-v5';

async function loginPage(page: Page): Promise<void> {
  await page.request.post('/api/admin/login', { data: { password: E2E_PASSWORD } });
}

async function createMapUi(page: Page, name: string, kind: 'Geographic' | 'Static floor plan'): Promise<void> {
  await page.getByRole('button', { name: 'New map' }).click();
  await page.getByLabel('Map name').fill(name);
  await page.getByLabel('Canvas type').selectOption(kind === 'Static floor plan' ? 'static' : 'geographic');
  await page.getByRole('button', { name: 'Create map', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('persists two differently typed named maps independently', async ({ page }) => {
  await loginPage(page);
  await page.goto('/');
  await createMapUi(page, 'Venue layout', 'Static floor plan');
  await expect(page.getByText('Static floor plan', { exact: false }).first()).toBeVisible();
  const staticUrl = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Venue layout' })).toBeVisible();

  await createMapUi(page, 'Outdoor park', 'Geographic');
  await expect(page.getByText('Geographic map', { exact: false }).first()).toBeVisible();
  const geoUrl = page.url();
  expect(geoUrl).not.toBe(staticUrl);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Outdoor park' })).toBeVisible();

  // The picker lists every map (including server fixtures); switching restores each map's own heading.
  await expect(page.getByLabel('Select map').locator('option')).not.toHaveCount(0);
  await page.getByLabel('Select map').selectOption({ label: 'Venue layout' });
  await expect(page.getByRole('heading', { name: 'Venue layout' })).toBeVisible();
  await page.getByLabel('Select map').selectOption({ label: 'Outdoor park' });
  await expect(page.getByRole('heading', { name: 'Outdoor park' })).toBeVisible();
});

test('renames a map without changing its identity', async ({ page }) => {
  await loginPage(page);
  await page.goto('/');
  await createMapUi(page, 'Rename me', 'Geographic');
  const urlBefore = page.url();
  await page.getByRole('button', { name: 'Rename map' }).click();
  await page.getByLabel('Map name').fill('Renamed hall');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed hall' })).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Renamed hall' })).toBeVisible();
});

test('stores two maps with independent drafts', async ({ request }) => {
  await adminLogin(request);
  const geoId = await createVenue(request, 'geo store', 'geographic');
  const staticId = await createVenue(request, 'static store', 'static');
  expect(geoId).not.toBe(staticId);
  const seeded = geographicDraft();
  seeded.venueId = geoId;
  await putDraft(request, geoId, seeded);
  const reloadedGeo = (await getDraftJson(request, geoId)) as { venueId: string; nodes: unknown[] };
  const reloadedStatic = (await getDraftJson(request, staticId)) as {
    venueId: string; canvas: { kind: string }; nodes: unknown[];
  };
  expect(reloadedGeo.venueId).toBe(geoId);
  expect(reloadedGeo.nodes.length).toBeGreaterThan(0);
  expect(reloadedStatic.venueId).toBe(staticId);
  expect(reloadedStatic.canvas.kind).toBe('static');
  expect(reloadedStatic.nodes).toHaveLength(0);
});
