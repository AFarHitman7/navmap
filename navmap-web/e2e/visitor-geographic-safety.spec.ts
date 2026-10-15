import { expect, test } from '@playwright/test';
import legacy from '../src/fixtures/unified-v3.json' with { type: 'json' };
import geographicV5 from '../src/fixtures/map-v5-geographic.json' with { type: 'json' };

test('V4 and V5 geographic visitor maps route on the full graph without drawing graph or route lines', async ({ page }) => {
  const maps = [
    { id: 'visitor-v4', manifest: { ...legacy, venueId: 'visitor-v4', version: 1, profiles: [],
      places: [{ id: 'gallery', name: 'Gallery', nodeId: 'n-a1', zoneId: 'b-a' }] } },
    { id: 'visitor-v5', manifest: { ...geographicV5, venueId: 'visitor-v5', version: 1, profiles: [],
      places: [...geographicV5.places, { id: 'gallery', name: 'Gallery', nodeId: 'n-a1', zoneId: 'b-a' }] } },
  ];
  for (const { id, manifest } of maps) {
    await page.route(`**/api/venues/${id}/latest`, (route) => route.fulfill({ json: { venueId: id, version: 1, name: 'Garden Museum' } }));
    await page.route(`**/api/venues/${id}/versions/1/manifest`, (route) => route.fulfill({ json: manifest }));
    await page.goto(`/v/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Visitor map — Garden Museum' })).toBeVisible();
    await expect(page.getByLabel('Starting point')).toContainText('Outdoor entrance');
    await expect(page.getByLabel('Destination')).toContainText('Gallery');
    await page.getByLabel('Starting point').selectOption('n-out');
    await page.getByLabel('Destination').selectOption('n-a1');
    await expect(page.getByText(/Take stairs to Gallery|Take stairs to Building A level 1 landing/)).toBeVisible();
    await expect(page.getByText(/Survey point/)).toHaveCount(0);
    await expect(page.getByText(/n-out|n-a1|connections|\d+ steps/)).toHaveCount(0);
    await expect(page.locator('[data-node-id], [data-edge], [data-transition]')).toHaveCount(0);
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
    await page.unroute(`**/api/venues/${id}/latest`);
    await page.unroute(`**/api/venues/${id}/versions/1/manifest`);
  }
});
