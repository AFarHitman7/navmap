import { expect, test } from '@playwright/test';

test('published static visitor loads the immutable image publicly and exposes no graph geometry', async ({ page }) => {
  const publicAssetRequests: string[] = [];
  const publicAssetStatuses: number[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/venues/browser-static/versions/')) return;
    expect(request.headers().authorization).toBeUndefined();
    expect(request.headers().cookie).toBeUndefined();
    if (request.url().includes('/assets/')) publicAssetRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/venues/browser-static/versions/') && response.url().includes('/assets/')) {
      publicAssetStatuses.push(response.status());
    }
  });
  await page.goto('/v/browser-static', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Visitor map — Browser Static Hall' })).toBeVisible();
  await page.getByLabel('Manual floor selection').selectOption('frame-b-a-z0');
  const background = page.locator('.leaflet-image-layer');
  await expect(background).toBeVisible();
  await expect.poll(() => background.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(publicAssetRequests).toHaveLength(1);
  expect(publicAssetRequests[0]).toMatch(/\/api\/venues\/browser-static\/versions\/1\/assets\/[a-f0-9]{64}$/);
  expect(publicAssetStatuses).toEqual([200]);
  await expect(page.locator('[data-node-id], [data-edge], [data-transition]')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
