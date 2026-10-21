import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, adminLogin, createVenue } from './admin-api';

async function loginPage(page: Page): Promise<void> {
  await page.request.post('/api/admin/login', { data: { password: E2E_PASSWORD } });
}

test('signing in refreshes the header without a manual refresh (ISSUE-001)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Organizer sign in' })).toBeVisible();
  const pickerAlert = page.locator('.map-picker [role="alert"]');
  await expect(pickerAlert).toBeVisible();
  await expect(page.getByRole('button', { name: 'New map' })).toBeDisabled();

  await page.getByLabel('Admin password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Map editor — demo' })).toBeVisible();
  await expect(pickerAlert).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New map' })).toBeEnabled();
});

test('public visitor route shows no organizer chrome or auth error (ISSUE-004/005)', async ({ page }) => {
  await page.goto('/v/browser-static', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Visitor map — Browser Static Hall' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Visitor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh maps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New map' })).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

test('unpublished visitor link shows the human name, never the raw id (ISSUE-005)', async ({ page, request }) => {
  await adminLogin(request);
  const venueId = await createVenue(request, 'Unpublished Hall', 'geographic');

  await page.goto(`/v/${venueId}`, { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Visitor map — Unpublished Hall');
  await expect(heading).not.toContainText(venueId);
  await expect(page.getByText('This venue has not been published yet')).toBeVisible();
});

test('a new geographic map opens on the OSM basemap instead of a blank canvas (ISSUE-002)', async ({ page, request }) => {
  await adminLogin(request);
  const venueId = await createVenue(request, 'Geo Basemap', 'geographic');
  await loginPage(page);

  await page.goto(`/editor/${venueId}`);
  const canvas = page.locator('.map-canvas');
  await expect(canvas).toBeVisible();
  // Seeded world view renders tiles immediately (zoom 2), so the organizer can
  // pan to the venue instead of staring at an empty gray container.
  await expect(canvas).toHaveAttribute('data-zoom', '2');
  await expect(canvas.locator('.leaflet-tile-pane')).toHaveCount(1);
});

test('a blank static map can create its first floor from the Floor plans panel (ISSUE-003)', async ({ page, request }, testInfo) => {
  await adminLogin(request);
  const venueId = await createVenue(request, `Static bootstrap ${testInfo.project.name}`, 'static');
  await loginPage(page);

  await page.goto(`/editor/${venueId}`);
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.getByText('Add a floor before assigning a layout.')).toBeVisible();
  await expect(page.locator('.layout-import-frame-state')).toHaveCount(0);

  await page.getByLabel('Building name').fill('Harbor Hall');
  await page.getByRole('button', { name: 'Add floor' }).click();

  await expect(page.getByText('Add a floor before assigning a layout.')).toHaveCount(0);
  await expect(page.locator('.layout-import-frame-state')).toHaveCount(1);
  await expect(page.locator('.layout-import-frame-state').first()).toContainText('no plan assigned');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v5-publish-bar')).toContainText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.locator('.layout-import-frame-state')).toHaveCount(1);
});

test('mobile visitor stacks the wayfinding form above the map (ISSUE-006)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only stacking order');

  await page.goto('/v/browser-static', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Visitor map — Browser Static Hall' })).toBeVisible();
  const sidebar = page.locator('.visitor-sidebar');
  const map = page.locator('.visitor-map');
  await expect(sidebar).toBeVisible();
  await expect(map).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  const mapBox = await map.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(sidebarBox!.y).toBeLessThan(mapBox!.y);
});
