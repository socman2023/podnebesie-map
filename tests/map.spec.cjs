const { test, expect } = require('@playwright/test');

test('128 existing locations remain intact', async ({ request }) => {
  const response = await request.get('/locations.json');
  expect(response.ok()).toBeTruthy();
  const objects = await response.json();
  expect(objects).toHaveLength(128);
  expect(new Set(objects.map((x) => x.id)).size).toBe(128);
  expect(objects.some((x) => x.title === 'Златоград')).toBeTruthy();
});

test('desktop: map, search, cards and links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loading-state')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.leaflet-image-layer')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/desktop-overview.png' });

  await page.locator('#search-input').fill('Златоград');
  await expect(page.locator('#search-results button').first()).toContainText('Златоград');
  await page.locator('#search-results button').first().click();
  await expect(page.locator('#details-title')).toHaveText('Златоград');
  await expect(page.locator('#details')).toBeVisible();
  await page.screenshot({ path: 'screenshots/desktop-card.png' });

  await page.locator('#search-input').fill('Олешка');
  await page.locator('#search-results button').first().click();
  await expect(page.locator('#details-links a')).toHaveAttribute('href', 'https://vk.com/oleshka2024');
  await page.locator('#details-close').click();
  await expect(page.locator('#details')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('mobile: 320px and 390px are horizontally contained and cards usable', async ({ browser }) => {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 760 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading-state')).toBeHidden({ timeout: 30000 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.locator('#search-input').fill('Академия');
    await page.locator('#search-results button').first().click();
    await expect(page.locator('#details-title')).toHaveText('Академия');
    const bounds = await page.locator('#details').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y).toBeGreaterThan(0);
    await expect(page.locator('#details-links button')).toContainText('Полуночные горы');
    await page.locator('#details-links button').first().click();
    await expect(page.locator('#details-title')).toHaveText('Полуночные горы');
    // Выбранная точка должна оставаться на ВИДИМОЙ карте, не за нижней карточкой.
    const selectedPin = page.locator('.map-pin--selected').first();
    await expect(selectedPin).toBeVisible();
    const pin = await selectedPin.boundingBox();
    const sheet = await page.locator('#details').boundingBox();
    expect(pin).not.toBeNull();
    expect(sheet).not.toBeNull();
    const debug = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('.leaflet-marker-icon')).find(e => e.classList.contains('map-pin--selected'));
      return {
        viewport: [innerWidth, innerHeight],
        mapDOM: document.getElementById('map').getBoundingClientRect().toJSON(),
        pinDOM: target ? target.getBoundingClientRect().toJSON() : null,
        sheetDOM: document.getElementById('details').getBoundingClientRect().toJSON(),
        center: typeof map !== 'undefined' ? map.getCenter() : null,
        currentZoom: typeof map !== 'undefined' ? map.getZoom() : null,
        fitZoom: typeof fitZoom !== 'undefined' ? fitZoom : null,
        selectedId: typeof selectedId !== 'undefined' ? selectedId : null,
        pinCoords: typeof map !== 'undefined' && typeof coord !== 'undefined' && typeof byId !== 'undefined' && byId.has(selectedId) ? map.latLngToContainerPoint(coord(byId.get(selectedId))) : null,
        imageLayer: Array.from(document.querySelectorAll('.leaflet-image-layer')).map(x => x.getBoundingClientRect().toJSON())
      };
    });
    console.log('MOBILE_DEBUG', width, JSON.stringify(debug));
    expect(pin.y + pin.height / 2).toBeLessThan(sheet.y - 8);
    await page.screenshot({ path: 'screenshots/mobile-' + width + '.png' });

    await page.locator('#details-close').click();
    await expect(page.locator('#details')).toBeHidden();
    await page.locator('#search-input').fill('');
    await page.locator('#type-filter').selectOption('city');
    await page.locator('#list-toggle').click();
    await expect(page.locator('#list-panel')).toBeVisible();
    await expect(page.locator('#list-items button').first()).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('all zoom levels have accessible keyboard-selectable markers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loading-state')).toBeHidden({ timeout: 30000 });
  const firstMarker = page.locator('.leaflet-marker-icon').first();
  await expect(firstMarker).toHaveAttribute('role', 'button');
  await expect(firstMarker).toHaveAttribute('tabindex', '0');
  await firstMarker.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#details')).toBeVisible();
});
