import { expect, type Page } from '@playwright/test'

// Interior locations in the real imported city/reference-neighborhood shapes.
// Project them through the displayed Mercator viewport and click the canvas,
// exercising actual polygon hit-testing rather than a synthetic DOM marker.
const locations = {
  Sunnyvale: [-122.0363, 37.3688],
  Ponderosa: [-122.011333, 37.363597],
} as const

export async function clickArea(page: Page, name: keyof typeof locations) {
  const canvas = page.locator('.map-canvas')
  await expect(canvas).toHaveAttribute('data-areas-ready', 'true', { timeout: 15000 })
  await expect(canvas).toHaveAttribute('data-camera-moving', 'false')
  const [west, south, east, north] = JSON.parse(
    (await canvas.getAttribute('data-camera-bounds'))!,
  ) as number[]
  const frame = (await canvas.boundingBox())!
  const padding = JSON.parse((await canvas.getAttribute('data-camera-padding'))!) as {
    left: number
    right: number
    top: number
    bottom: number
  }
  const [lon, lat] = locations[name]
  const mercator = (latitude: number) => {
    const sin = Math.sin((latitude * Math.PI) / 180)
    return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  }
  const x =
    padding.left + ((lon - west) / (east - west)) * (frame.width - padding.left - padding.right)
  const y =
    padding.top +
    ((mercator(lat) - mercator(north)) / (mercator(south) - mercator(north))) *
      (frame.height - padding.top - padding.bottom)
  expect(x).toBeGreaterThan(0)
  expect(x).toBeLessThan(frame.width)
  expect(y).toBeGreaterThan(0)
  expect(y).toBeLessThan(frame.height)
  // Close a previously selected area's card if it would cover the target.
  const inspector = page.locator('.map-inspector:not(.is-preview)')
  const card = (await inspector.count()) ? await inspector.boundingBox() : null
  if (
    card &&
    x + frame.x >= card.x &&
    x + frame.x <= card.x + card.width &&
    y + frame.y >= card.y &&
    y + frame.y <= card.y + card.height
  ) {
    await page.getByRole('button', { name: 'Close map details' }).click()
  }
  await canvas.click({ position: { x, y } })
}
