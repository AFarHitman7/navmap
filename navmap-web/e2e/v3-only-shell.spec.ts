import { expect, test } from '@playwright/test';

test('retired maps stay unavailable while the V3 public visitor route is accessible', async ({ page }) => {
  await page.goto('/maps');
  await expect(page.getByText('Unknown page. Open the V3 editor.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maps' })).toHaveCount(0);

  // A known-but-unpublished venue shows its human name (never the raw venue id)
  // and no organizer chrome: the visitor route is unauthenticated (ISSUE-004/005).
  await page.goto('/v/demo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Visitor map — Demo map');
  await expect(page.getByRole('link', { name: 'Editor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Visitor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh maps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New map' })).toHaveCount(0);
});
