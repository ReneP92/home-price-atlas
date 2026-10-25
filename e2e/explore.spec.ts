import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Real committed market data; deterministic external decoration. Live tiles
  // are checked separately during visual review, not on every CI interaction.
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACwElEQVR4nO3TMQ0AMAzAsPKHumPHEAxGj1gygDyZ+w5kzXoBLDIAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANI+myAp18If8O4AAAAASUVORK5CYII=',
        'base64',
      ),
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
    .getByRole('button', { name: 'Explore Sunnyvale', exact: true })
    .click({ timeout: 30000 })
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.getByRole('button', { name: 'Select Ponderosa', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Select Ponderosa', exact: true }).click()
  await expect(page.locator('.section-heading h2')).toContainText('Ponderosa')
})

test('keeps price markers interactive when the external basemap is unavailable', async ({
  page,
}) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore Sunnyvale', exact: true }).click()
  await expect(page.getByLabel('Filter by city')).toHaveValue('19457')
  await expect(page.locator('.map-loading')).toHaveCount(0)
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
  await page.getByLabel('Filter by city').selectOption({ label: 'Palo Alto' })
  await page.locator('.place-main').first().click()
  await page.getByRole('button', { name: 'Save neighborhood', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved neighborhood', exact: true })).toBeVisible()
  await page.locator('.compare-place').first().click()
  await page.locator('.compare-place').nth(1).click()
  await page.getByRole('button', { name: /Compare neighborhoods/ }).click()
  await expect(page.locator('.comparison-tray button')).toHaveCount(2)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/single-family-12mo\.csv$/)
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
  await expect(page.getByText('No neighborhoods found')).toBeVisible()
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
