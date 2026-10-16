import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');
const shotDir = resolve(process.cwd(), '../docs/acceptance-screenshots');

test.beforeAll(async () => {
  await mkdir(shotDir, { recursive: true });
});

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(shotDir, `${name}.png`), fullPage: true });
}

test('visual: V5 geographic editor shows only relevant inspector fields', async ({ page }, testInfo) => {
  const draft = geographicDraft();
  draft.venueId = 'demo';
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: draft }));
  await page.goto('/editor/demo');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Regular' }).click();
  await expect(page.locator('.v5-status')).toContainText('Path');
  await shot(page, `v5-geographic-editor-${testInfo.project.name}`);
});

test('visual: V5 static editor with floor import panel', async ({ page }, testInfo) => {
  const draft = staticDraft();
  draft.venueId = 'demo';
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: { mapV5AuthoringEnabled: true } }));
  await page.route('**/api/admin/venues/demo/draft-v3', (route) => route.fulfill({ json: draft }));
  await page.route('**/api/admin/venues/demo/layout-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await page.goto('/editor/demo');
  await expect(page.locator('.leaflet-image-layer')).toHaveJSProperty('naturalWidth', 1);
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.getByRole('heading', { name: 'Add a floor plan' })).toBeVisible();
  await shot(page, `v5-static-editor-${testInfo.project.name}`);
});

test('visual: visitor shows destinations and source-labelled position only', async ({ page }, testInfo) => {
  await page.goto('/v/browser-static', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Browser Static Hall/ })).toBeVisible();
  await shot(page, `visitor-static-${testInfo.project.name}`);
});
