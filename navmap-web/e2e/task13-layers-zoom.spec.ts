import { expect, test } from '@playwright/test';
import { geographicDraft } from '../src/fixtures/map-v5';

test('V5 layer row stays compact, popover is keyboard-operable, and OSM overzoom clamps to native z19', async ({ page }, testInfo) => {
  const draft = geographicDraft();
  draft.venueId = 'demo';
  for (let i = 2; i < 28; i++) {
    const id = `building-${i}`;
    draft.indoorZones.push({ id, name: `Building ${i}`, bounds: draft.indoorZones[0]!.bounds, floors: [{ z: 0, label: 'Ground' }] });
    draft.frames.push({ id: `frame-${id}-0`, zoneId: id, z: 0, bounds: draft.frames[1]!.bounds });
  }
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: draft }));
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  const tileZooms: number[] = [];
  let failTiles = false;
  await page.route('https://tile.openstreetmap.org/**/*.png', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/(\d+)\/\d+\/\d+\.png$/);
    if (match) tileZooms.push(Number(match[1]));
    await route.fulfill({ status: failTiles ? 503 : 204, body: '' });
  });
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  const row = page.locator('.layer-picker-row');
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(56);
  await expect(page.locator('.layer-current-frame')).toHaveText('Outdoor');
  await page.getByText('Layers', { exact: true }).click();
  const options = page.locator('.layer-picker-options');
  await expect(options.getByRole('button')).toHaveCount(29);
  expect(await options.evaluate((element) => getComputedStyle(element).maxHeight)).not.toBe('none');
  expect(await options.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-picker-popover')).not.toHaveAttribute('open', '');
  const layerToggle = page.locator('.layer-picker-popover summary');
  await expect(layerToggle).toBeFocused();
  await layerToggle.press('Enter');
  await expect(page.locator('.layer-picker-popover')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await page.getByText('Layers', { exact: true }).click();
  await options.getByRole('button', { name: 'Building A · Level 1' }).click();
  await expect(page.locator('.layer-current-frame')).toHaveText('Building A · Level 1');
  await expect(page.locator('[aria-label="Map layers"]')).toBeVisible();

  const zoomIn = page.locator('.leaflet-control-zoom-in');
  const map = page.locator('.map-canvas');
  await expect(map).toHaveAttribute('data-max-zoom', '24');
  for (let i = 0; i < 24 && Number(await map.getAttribute('data-zoom')) < 24; i++) {
    const previousZoom = Number(await map.getAttribute('data-zoom'));
    await zoomIn.click();
    await expect.poll(async () => Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(previousZoom);
  }
  await expect(map).toHaveAttribute('data-zoom', '24');
  await expect.poll(() => Math.max(...tileZooms)).toBe(19);
  expect(tileZooms.every((zoom) => zoom <= 19)).toBe(true);

  failTiles = true;
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByText('OSM tiles unavailable. Your map edits are still here.')).toBeVisible();
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular', exact: true }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('status')).toContainText('pending path');
  await page.screenshot({ path: testInfo.outputPath('task13-v5-layers.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
