import { describe, expect, it } from 'vitest'
import { compare, csvCell, exportRows, median, monthKey, percent } from './market'
import type { Observation, Place } from '../types'

function point(date: string, price: number | null, sales: number | null = 10): Observation {
  return {
    date,
    start: `${date.slice(0, 7)}-01`,
    price,
    ppsf: price == null ? null : price / 1000,
    sales,
    daysOnMarket: 20,
    inventory: 3,
  }
}
function place(points: Observation[]): Place {
  return {
    id: 'n-1',
    providerId: '1',
    kind: 'neighborhood',
    name: '=UNSAFE()',
    city: 'Test',
    cityId: '2',
    state: 'CA',
    center: null,
    series: { condo: points },
  }
}

describe('market comparisons', () => {
  it('compares the same calendar month a year earlier, across leap years', () => {
    expect(monthKey('2024-02-29', -12)).toBe('2023-02')
    const p = place([point('2023-02-28', 800_000), point('2024-02-29', 880_000)])
    expect(compare(p, 'condo', 'price', 12, '2024-02-29').change).toBeCloseTo(10)
  })
  it('does not silently substitute stale or adjacent observations', () => {
    const p = place([point('2025-08-31', 800_000), point('2026-09-30', 880_000)])
    expect(compare(p, 'condo', 'price', 12, '2026-09-30').status).toBe('missing')
    expect(compare(p, 'townhouse', 'price', 12, '2026-09-30').change).toBeNull()
  })
  it('requires sufficient sales in both windows and does not turn zero/missing prices into changes', () => {
    expect(
      compare(
        place([point('2025-09-30', 800_000, 2), point('2026-09-30', 880_000)]),
        'condo',
        'price',
        12,
        '2026-09-30',
      ).status,
    ).toBe('thin')
    expect(
      compare(
        place([point('2025-09-30', 0), point('2026-09-30', 880_000)]),
        'condo',
        'price',
        12,
        '2026-09-30',
      ).change,
    ).toBeNull()
    expect(
      compare(
        place([point('2025-09-30', 800_000), point('2026-09-30', 880_000, null)]),
        'condo',
        'price',
        12,
        '2026-09-30',
      ).status,
    ).toBe('missing')
  })
  it('exports the underlying periods and preserves missing cells safely', () => {
    const csv = exportRows(
      [place([point('2026-09-30', 880_000)])],
      'condo',
      'price',
      12,
      '2026-09-30',
    )
    expect(csv).toContain('"\'=UNSAFE()"')
    expect(csv).toContain('"Condo/Co-op"')
    expect(csv).toContain('"missing"')
    expect(csv).not.toContain('undefined')
    expect(csvCell(-12.28)).toBe('"-12.28"')
    expect(csvCell('-malicious formula')).toBe('"\'-malicious formula"')
  })
  it('calculates an unweighted median and formats flat changes without negative zero', () => {
    expect(median([])).toBeNull()
    expect(median([100, 4, 6, 2])).toBe(5)
    expect(percent(-0.001)).toBe('0.0%')
  })
})
