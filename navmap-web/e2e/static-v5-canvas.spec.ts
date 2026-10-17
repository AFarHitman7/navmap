import { expect, test } from '@playwright/test';
import { staticDraft } from '../src/fixtures/map-v5';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');

test('routed V5 static editor loads its PNG and places a real local-coordinate node without tile or GPS requests', async ({ page }) => {
  const requests: string[] = [];
  let gpsCalls = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: () => { (window as unknown as { __gpsCalls: number }).__gpsCalls++; return 1; }, clearWatch: () => undefined } });
    (window as unknown as { __gpsCalls: number }).__gpsCalls = 0;
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: { ...staticDraft(), venueId: 'demo' } }));
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect(page.locator('.leaflet-image-layer')).toHaveJSProperty('naturalWidth', 1);
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  const canvas = page.getByRole('application', { name: 'Static floor plan' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('static map canvas has no bounds');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: /Node n-1/ })).toBeVisible();
  await expect(page.getByText('Survey point')).toHaveCount(0);
  gpsCalls = await page.evaluate(() => (window as unknown as { __gpsCalls: number }).__gpsCalls);
  expect(gpsCalls).toBe(0);
  expect(requests.some((url) => /tile\.openstreetmap\.org/.test(url))).toBe(false);
});

test('static editor hides generated sample markers and any path segment selects the whole path', async ({ page }) => {
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: { ...staticDraft(), venueId: 'demo' } }));
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect(page.locator('.v5-node-marker')).toHaveCount(2);
  const references = page.getByRole('checkbox', { name: 'Show survey reference points' });
  await references.check();
  await expect(page.locator('.v5-node-marker')).toHaveCount(3);
  await references.uncheck();
  await expect(page.locator('.v5-node-marker')).toHaveCount(2);
  const segment = page.locator('.leaflet-overlay-pane path').first();
  const hit = await segment.evaluate((element: SVGPathElement) => {
    const point = element.getPointAtLength(element.getTotalLength() / 2);
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('path segment has no screen transform');
    return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
  });
  await page.mouse.click(hit.x, hit.y);
  await expect(page.getByRole('heading', { name: 'Path properties' })).toBeVisible();
  await expect(page.getByLabel('Path name')).toHaveValue('Ground corridor');
});
