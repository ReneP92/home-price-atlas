import { describe, expect, it } from 'vitest'
import type { Place, Observation } from '../types'
import {
  annualSales,
  benchmarkGap,
  exportStatistics,
  inBounds,
  marketSummary,
  parseMapBounds,
  percentChange,
  quantile,
} from './statistics'
import { monthKey } from './market'

function point(date: string, sales: number | null, price = 100): Observation {
  return {
    date,
    start: `${monthKey(date, -2)}-01`,
    sales,
    price,
    ppsf: price,
    daysOnMarket: 15,
    inventory: 10,
  }
}
function place(points: Observation[]): Place {
  return {
    id: 'area',
    providerId: '1',
    kind: 'neighborhood',
    name: 'Test',
    city: 'Town',
    cityId: '2',
    state: 'CA',
    center: null,
    series: { condo: points },
  }
}

describe('market statistics', () => {
  it('adds exactly four non-overlapping quarters, not twelve overlapping monthly rows', () => {
    const points = Array.from({ length: 12 }, (_, i) => {
      const [year, month] = monthKey('2026-09-30', -i).split('-').map(Number)
      return point(new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), 10)
    })
    const result = annualSales(place(points), 'condo', '2026-09-30')
    expect(result.total).toBe(40)
    expect(result.windows.map((p) => p?.date.slice(0, 7))).toEqual([
      '2025-12',
      '2026-03',
      '2026-06',
      '2026-09',
    ])
  })
  it('does not label a partial year as an annual total, while retaining genuine zero sales', () => {
    const points = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].map((d) => point(d, 0))
    expect(annualSales(place(points), 'condo', '2026-09-30').total).toBe(0)
    points[1].sales = null
    expect(annualSales(place(points), 'condo', '2026-09-30')).toMatchObject({
      total: null,
      available: 3,
    })
    expect(percentChange(10, 0)).toBeNull()
  })
  it('reports a city-relative percentage-point gap and respects the sample threshold', () => {
    const local = place([point('2025-09-30', 10, 100), point('2026-09-30', 10, 110)])
    const city = place([point('2025-09-30', 100, 100), point('2026-09-30', 100, 105)])
    expect(benchmarkGap(local, city, 'condo', 'price', 12, '2026-09-30').gap).toBeCloseTo(5)
    expect(benchmarkGap(local, city, 'condo', 'price', 12, '2026-09-30', 20).gap).toBeNull()
  })
  it('computes coverage and market breadth without treating gaps as flat markets', () => {
    const valid = place([point('2025-09-30', 10, 100), point('2026-09-30', 10, 110)])
    const thin = place([point('2025-09-30', 2, 100), point('2026-09-30', 2, 90)])
    expect(
      marketSummary([valid, thin, place([])], 'condo', 'price', 12, '2026-09-30'),
    ).toMatchObject({ total: 3, ready: 1, thin: 1, missing: 1, rising: 1, falling: 0, flat: 0 })
    expect(quantile([0, 10, 20, 30], 0.25)).toBe(7.5)
    expect(quantile([], 0.5)).toBeNull()
  })
  it('excludes unknown locations from viewport filtering and supports dateline-crossing bounds', () => {
    expect(inBounds(null, [-123, 37, -121, 38])).toBe(false)
    expect(inBounds([-122, 37.5], [-123, 37, -121, 38])).toBe(true)
    expect(inBounds([-175, 55], [170, 50, -170, 60])).toBe(true)
    expect(inBounds([0, 55], [170, 50, -170, 60])).toBe(false)
    expect(inBounds([-175, 55], [180, 50, 190, 60])).toBe(true)
    expect(parseMapBounds('-123,37,-121,38')).toEqual([-123, 37, -121, 38])
    expect(parseMapBounds('oops')).toBeNull()
    expect(parseMapBounds('1,,2,40')).toBeNull()
    expect(parseMapBounds('1,50,2,40')).toBeNull()
  })
  it('exports the selected threshold and partial-year coverage without fabricating totals', () => {
    const record = place([point('2025-09-30', 8, 100), point('2026-09-30', 8, 90)])
    const csv = exportStatistics([record], 'condo', 'price', 12, '2026-09-30', 10)
    expect(csv).toContain('"Annual quarters available"')
    expect(csv).toContain('"Condo/Co-op"')
    expect(csv).toContain('"10","thin","","1"')
    expect(csv).not.toContain('"-10"')
  })
})
