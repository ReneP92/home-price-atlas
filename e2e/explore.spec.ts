import { expect, test } from '@playwright/test'
import { clickArea } from './map-helpers'

test.beforeEach(async ({ page }) => {
  // Real committed market data; deterministic external decoration. Live tiles
  // are checked separately during visual review, not on every CI interaction.
  await page.route('https://api.mapbox.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: new URL(route.request().url()).pathname.startsWith('/styles/v1/')
        ? JSON.stringify({
            version: 8,
            sources: {},
            layers: [
              { id: 'background', type: 'background', paint: { 'background-color': '#eef2ea' } },
            ],
          })
        : '{}',
    }),
  )
  await page.route('https://events.mapbox.com/**', (route) =>
    route.fulfill({
      status: 204,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    }),
  )
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  )
})

test('renders shaded city areas and drills into reference neighborhoods', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A closer look at the market.' })).toBeVisible()
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toBeVisible()
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(250)
  await clickArea(page, 'Sunnyvale')
  await page.locator('[data-place-id="city-17675"]').hover()
  await expect(page.locator('.map-inspector h3')).toHaveText('Sunnyvale')
  await page
    .locator('.inspector-actions')
    .getByRole('button', { name: 'Neighborhoods', exact: true })
    .click()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await clickArea(page, 'Ponderosa')
  await expect(page.locator('.section-heading h2')).toContainText('Ponderosa')
  await expect(page.locator('.mapboxgl-marker')).toHaveCount(0)
  await expect(page.locator('.map-bottom')).toContainText('Zillow 2017 reference boundaries')
})

test('keeps price areas interactive when the external basemap is unavailable', async ({ page }) => {
  await page.route('https://api.mapbox.com/styles/v1/**', (route) => route.abort())
  await page.goto('/')
  await clickArea(page, 'Sunnyvale')
  await page
    .locator('.inspector-actions')
    .getByRole('button', { name: 'Neighborhoods', exact: true })
    .click()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.locator('.map-loading')).toHaveCount(0)
  await expect(page.getByText('Background map unavailable. Price areas still work.')).toBeVisible()
  await clickArea(page, 'Ponderosa')
  await expect(page.locator('.section-heading h2')).toContainText('Ponderosa')
})

test('explores real data, switches types and restores a shareable filtered view', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A closer look at the market.' })).toBeVisible()
  await page.getByRole('button', { name: 'Neighborhood view', exact: true }).click()
  await page.getByLabel('Filter by city').selectOption({ label: 'Sunnyvale' })
  await page.getByRole('button', { name: /^Condos/ }).click()
  await expect(page.getByRole('button', { name: /^Condos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByLabel('Search neighborhoods or cities').fill('De Anza')
  await expect(page.locator('.place-main')).toHaveCount(1)
  await page.getByLabel('Price metric').selectOption('ppsf')
  await page.getByRole('button', { name: '6M', exact: true }).click()
  await expect(page).toHaveURL(/type=condo/)
  await expect(page).toHaveURL(/months=6/)
  await page.reload()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.getByLabel('Price metric')).toHaveValue('ppsf')
  await expect(page.getByLabel('Search neighborhoods or cities')).toHaveValue('De Anza')
  await expect(page.getByRole('button', { name: /^Condos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(errors).toEqual([])
})

test('saves neighborhoods, compares places and exports source-aligned CSV', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.place-main').first()).toBeVisible()
  await page.getByRole('button', { name: 'Neighborhood view', exact: true }).click()
  await page.getByLabel('Filter by city').selectOption({ label: 'Palo Alto' })
  await page.locator('.place-main').first().click()
  await page.getByRole('button', { name: 'Save area', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved area', exact: true })).toBeVisible()
  await page.locator('.compare-place').first().click()
  await page.locator('.compare-place').nth(1).click()
  await expect(page.getByRole('heading', { name: 'Compare areas' })).toBeVisible()
  await expect(page.locator('.comparison-tray button')).toHaveCount(2)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/single-family-12mo\.csv$/)
  let csv = ''
  for await (const chunk of (await file.createReadStream())!) csv += chunk.toString()
  expect(csv).toContain('"Annual sales"')
  expect(csv).toContain('"Median days on market"')
  expect(csv).not.toMatch(/"'-\d/)
  await page
    .getByRole('button', { name: /^Saved\d*/ })
    .first()
    .click()
  await expect(page.locator('.place-main')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.nav-count')).toHaveText('1')
})

test('handles empty filters and makes methodological limits accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Search neighborhoods or cities').fill('no-such-neighborhood-zz')
  await expect(page.getByText('No areas match these filters')).toBeVisible()
  await expect(page.locator('.summary-card')).toHaveCount(3)
  await page.getByRole('button', { name: 'Reset filters' }).first().click()
  await expect(page.locator('.place-main').first()).toBeVisible()
  await page.getByRole('button', { name: 'Sources & methodology' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Three distinct source categories' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: /^Condos/ }).click()
  await page.getByLabel('Search neighborhoods or cities').fill('Hillsborough')
  await page.getByLabel('Map color metric').selectOption('price')
  await expect(page.locator('.map-key')).toHaveText('No reported values in this selection')
})

test('reports a failed snapshot without a broken dashboard and can retry', async ({ page }) => {
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Let’s get the data back.' })).toBeVisible()
  await page.unroute('**/data/catalog.json')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'A closer look at the market.' })).toBeVisible()
})

test('exposes sparse coverage and opens actual city statistics as an alternative', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Neighborhood view', exact: true }).click()
  await page.getByLabel('Filter by city').selectOption({ label: 'Los Gatos' })
  await page.getByRole('button', { name: /^Condos/ }).click()
  const lowSales = page.getByRole('button', { name: /^Low sales\d*/ })
  const expectedCount = Number((await lowSales.innerText()).match(/\d+/)?.[0])
  await lowSales.click()
  const rows = page.locator('.place-main')
  await expect(rows).toHaveCount(expectedCount)
  if (expectedCount) {
    await expect(rows.first()).toContainText('Low sales')
    await expect(rows.first()).toContainText('sales')
  }
  await page.getByRole('button', { name: 'Los Gatos city statistics', exact: true }).click()
  await expect(page.getByRole('button', { name: 'City view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.section-heading h2')).toContainText('Los Gatos')
  await expect(page.getByTestId('annual-sales')).toBeVisible()
  await page.getByLabel('Same areas for all types').check()
  const counts = await page.locator('.summary-bottom > span:last-child').allTextContents()
  expect(new Set(counts).size).toBe(1)
})

test('changes the reporting date, sample threshold and chart statistic with restorable state', async ({
  page,
}) => {
  await page.goto('/')
  const slider = page.getByRole('slider', { name: 'Reporting month' })
  const initial = Number(await slider.inputValue())
  await slider.focus()
  await slider.press('ArrowLeft')
  await expect(slider).toHaveValue(String(initial - 1))
  await page.getByLabel('Minimum sales per comparison window').selectOption('20')
  await page.getByLabel('Trend statistic').selectOption('sales')
  await expect(page).toHaveURL(/minsales=20/)
  await expect(page).toHaveURL(/trend=sales/)
  await page.reload()
  await expect(slider).toHaveValue(String(initial - 1))
  await expect(page.getByLabel('Trend statistic')).toHaveValue('sales')
  const legend = page.getByRole('button', { name: 'Toggle Condos / co-ops chart series' })
  await legend.click()
  await expect(legend).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Play timeline', exact: true }).click()
  await expect(slider).not.toHaveValue(String(initial - 1), { timeout: 5000 })
  await page.getByRole('button', { name: 'Pause timeline', exact: true }).click()
})

test('filters the directory to the map, switches layers and expands the map', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.place-row').first()).toBeVisible()
  const all = await page.locator('.place-row').count()
  await clickArea(page, 'Sunnyvale')
  await page.getByLabel('Map color metric').selectOption('sales')
  await page.getByLabel('Filter to map view').check()
  await expect.poll(() => page.locator('.place-row').count()).toBeLessThan(all)
  await expect(page).toHaveURL(/mapview=1/)
  await page.getByRole('button', { name: 'Expand map', exact: true }).click()
  await expect(page.locator('.workspace')).toHaveClass(/map-expanded/)
  await expect(page.locator('.directory')).not.toBeVisible()
  await page.getByRole('button', { name: 'Collapse map', exact: true }).click()
  await page.reload()
  await expect(page.getByLabel('Filter to map view')).toBeChecked()
  await expect(page.getByLabel('Map color metric')).toHaveValue('sales')
  await page.getByLabel('Filter to map view').uncheck()
  await expect(page.locator('.place-row')).toHaveCount(all)
})

test('switches Mapbox basemaps without losing the selected area or data layer', async ({
  page,
}) => {
  await page.goto('/')
  await clickArea(page, 'Sunnyvale')
  await page.getByLabel('Map color metric').selectOption('sales')
  const satellite = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/styles/v1/mapbox/satellite-streets-v12',
  )
  await page.getByLabel('Basemap style').selectOption('satellite')
  await satellite
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-areas-ready', 'true')
  await expect(page.locator('.section-heading h2')).toContainText('Sunnyvale')
  await expect(page.getByLabel('Map color metric')).toHaveValue('sales')
  const streets = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/styles/v1/mapbox/standard',
  )
  await page.getByLabel('Basemap style').selectOption('streets')
  await streets
  await clickArea(page, 'Sunnyvale')
  await expect(page.locator('.map-inspector h3')).toHaveText('Sunnyvale')
})

test('explains Mapbox authorization failures while keeping area data usable', async ({ page }) => {
  await page.route('https://api.mapbox.com/styles/v1/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: '{"message":"Forbidden"}',
      headers: { 'access-control-allow-origin': '*' },
    }),
  )
  await page.goto('/')
  await expect(
    page.getByText('Mapbox rejected the token. Check your .env token and its allowed URLs.'),
  ).toBeVisible()
  await clickArea(page, 'Sunnyvale')
  await expect(page.locator('.section-heading h2')).toContainText('Sunnyvale')
})

test('reports tile rate limits while keeping local polygons selectable', async ({ page }) => {
  await page.route('https://api.mapbox.com/styles/v1/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        version: 8,
        sources: {
          limited: {
            type: 'raster',
            tileSize: 256,
            tiles: ['https://api.mapbox.com/v4/test-tiles/{z}/{x}/{y}.png'],
          },
        },
        layers: [{ id: 'limited', type: 'raster', source: 'limited' }],
      }),
    }),
  )
  await page.route('https://api.mapbox.com/v4/test-tiles/**', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '{"message":"Rate limit reached"}',
    }),
  )
  await page.goto('/')
  await expect(
    page.getByText('Mapbox is rate-limiting map requests. Area data is still available.'),
  ).toBeVisible()
  await clickArea(page, 'Sunnyvale')
  await expect(page.locator('.section-heading h2')).toContainText('Sunnyvale')
})

test('zooms from city polygons into neighborhoods and back without resetting market filters', async ({
  page,
}) => {
  await page.goto('/')
  await clickArea(page, 'Sunnyvale')
  await page.getByRole('button', { name: /^Condos/ }).click()
  await page.getByLabel('Minimum sales per comparison window').selectOption('10')
  await page.getByLabel('Map color metric').selectOption('sales')
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  for (
    let i = 0;
    i < 6 && (i === 0 || Number(await canvas.getAttribute('data-camera-zoom')) < 12);
    i++
  ) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  }
  await expect(
    page.getByRole('button', { name: 'Neighborhood view', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.getByLabel('Automatic geographic detail')).toBeChecked()
  await expect(canvas).toHaveAttribute('data-areas-ready', 'true')
  expect(Number(await canvas.getAttribute('data-camera-zoom'))).toBeGreaterThanOrEqual(12)
  for (let i = 0; i < 6 && Number(await canvas.getAttribute('data-camera-zoom')) > 10.75; i++) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  }
  await expect(page.getByRole('button', { name: 'City view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('Filter by city')).toHaveValue('')
  await expect(page.getByRole('button', { name: /^Condos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('Minimum sales per comparison window')).toHaveValue('10')
  await expect(page.getByLabel('Map color metric')).toHaveValue('sales')
})

test('supports a manual level lock and a map breadcrumb back to cities', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'City view', exact: true }).click()
  await expect(page.getByLabel('Automatic geographic detail')).not.toBeChecked()
  await clickArea(page, 'Sunnyvale')
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  for (
    let i = 0;
    i < 6 && (i === 0 || Number(await canvas.getAttribute('data-camera-zoom')) < 12);
    i++
  ) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  }
  await expect(page.getByRole('button', { name: 'City view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByLabel('Automatic geographic detail').check()
  await expect(
    page.getByRole('button', { name: 'Neighborhood view', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Back to city areas', exact: true }).click()
  await expect(page.getByRole('button', { name: 'City view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  expect(Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(12)
})

test('keeps city areas when no neighborhood polygons are available', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-place-id="city-8642"] .place-main').click()
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  for (
    let i = 0;
    i < 6 && (i === 0 || Number(await canvas.getAttribute('data-camera-zoom')) < 12);
    i++
  ) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  }
  await expect(page.getByRole('button', { name: 'City view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByText('No matched neighborhood boundaries for Hillsborough. Showing city areas.'),
  ).toBeVisible()
})
