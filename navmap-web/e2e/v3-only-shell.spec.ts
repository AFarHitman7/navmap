import { expect, test } from '@playwright/test';

test('retired maps stay unavailable while the V3 public visitor route is accessible', async ({ page }) => {
  await page.goto('/maps');
  await expect(page.getByText('Unknown page. Open the V3 editor.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maps' })).toHaveCount(0);

  await page.goto('/v/demo');
  await expect(page.getByRole('heading', { name: 'Visitor map — demo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visitor', exact: true })).toHaveAttribute('aria-current', 'page');
});
