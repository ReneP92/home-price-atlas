import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Real committed market data; deterministic external decoration. Live tiles
  // are checked separately during visual review, not on every CI interaction.
  await page.route('https://tiles.openfreemap.org/styles/positron', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#eef2ea' } },
        ],
      }),
    }),
  )
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  )
})

test('renders a visible map and drills from city markers into neighborhoods', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A closer look at the market.' })).toBeVisible()
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toBeVisible()
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(250)
  await page
    .getByRole('button', { name: 'Select Sunnyvale', exact: true })
    .click({ timeout: 30000 })
  // Hovering another marker (including one moving under the pointer during a
  // camera transition) must not retarget the selected city's action buttons.
  await page
    .getByRole('button', { name: 'Select Santa Clara', exact: true })
    .dispatchEvent('mouseenter')
  await expect(page.locator('.map-inspector h3')).toHaveText('Sunnyvale')
  await page
    .locator('.inspector-actions')
    .getByRole('button', { name: 'Neighborhoods', exact: true })
    .click()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.getByRole('button', { name: 'Select Ponderosa', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Select Ponderosa', exact: true }).click()
  await expect(page.locator('.section-heading h2')).toContainText('Ponderosa')
  await expect
    .poll(async () => {
      const pin = await page
        .getByRole('button', { name: 'Select Ponderosa', exact: true })
        .boundingBox()
      const card = await page.locator('.map-inspector').boundingBox()
      return (
        !!pin &&
        !!card &&
        (pin.x + pin.width < card.x ||
          pin.x > card.x + card.width ||
          pin.y + pin.height < card.y ||
          pin.y > card.y + card.height)
      )
    })
    .toBe(true)
})

test('keeps price markers interactive when the external basemap is unavailable', async ({
  page,
}) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Select Sunnyvale', exact: true }).click()
  await page
    .locator('.inspector-actions')
    .getByRole('button', { name: 'Neighborhoods', exact: true })
    .click()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.locator('.map-loading')).toHaveCount(0)
  await expect(
    page.getByText('Background map unavailable. Price markers still work.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Select Ponderosa', exact: true }).click()
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
  await page.getByRole('button', { name: 'Select Sunnyvale', exact: true }).click()
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
