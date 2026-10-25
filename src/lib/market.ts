import type { Horizon, Metric, Observation, Place, PropertyType } from '../types'

export const MIN_SALES = 5

// Start with the strongest cross-type coverage rather than a hardcoded city or
// the largest price movement. Region selection remains geography-independent.
export function defaultPlace(places: Place[], date: string): Place | undefined {
  return places
    .map((place) => {
      const results = (['single-family', 'condo', 'townhouse'] as PropertyType[])
        .map((type) => compare(place, type, 'price', 12, date))
        .filter((result) => result.status === 'ready')
      const sample = results.length
        ? Math.min(...results.flatMap((r) => [r.current!.sales!, r.previous!.sales!]))
        : 0
      return { place, categories: results.length, sample }
    })
    .sort(
      (a, b) =>
        b.categories - a.categories ||
        b.sample - a.sample ||
        a.place.name.localeCompare(b.place.name),
    )[0]?.place
}

export function monthKey(date: string, offset = 0): string {
  const [year, month] = date.split('-').map(Number)
  const point = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${point.getUTCFullYear()}-${String(point.getUTCMonth() + 1).padStart(2, '0')}`
}

export function observation(
  place: Place,
  type: PropertyType,
  date: string,
  offset = 0,
): Observation | undefined {
  const key = monthKey(date, offset)
  return place.series[type]?.find((point) => point.date.startsWith(key))
}

export interface Comparison {
  current: Observation | undefined
  previous: Observation | undefined
  change: number | null
  status: 'ready' | 'thin' | 'missing'
}

export function compare(
  place: Place,
  type: PropertyType,
  metric: Metric,
  horizon: Horizon,
  date: string,
  minimumSales = MIN_SALES,
): Comparison {
  const current = observation(place, type, date)
  const previous = observation(place, type, date, -horizon)
  const now = current?.[metric]
  const before = previous?.[metric]
  if (
    now == null ||
    before == null ||
    before <= 0 ||
    now <= 0 ||
    current?.sales == null ||
    previous?.sales == null
  ) {
    return { current, previous, change: null, status: 'missing' }
  }
  if (current.sales < minimumSales || previous.sales < minimumSales) {
    return { current, previous, change: null, status: 'thin' }
  }
  return { current, previous, change: (now / before - 1) * 100, status: 'ready' }
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return 'Not enough data'
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`
}

export function money(value: number | null | undefined, compact = true): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact && value >= 1_000_000 ? 2 : 0,
  }).format(value)
}

export function dateLabel(date: string, format: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-US', {
    month: format === 'short' ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 7)}-01T12:00:00Z`))
}

export function periodLabel(point: Observation | undefined): string {
  if (!point) return 'No reporting period'
  const first = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${point.start}T12:00:00Z`),
  )
  return `${first} - ${dateLabel(point.date)}`
}

export function changeColor(value: number | null): string {
  if (value === null) return '#8d9690'
  if (value < -5) return '#b66846'
  if (value < -0.05) return '#cd9773'
  if (value < 0.05) return '#969b8a'
  if (value < 5) return '#58917b'
  return '#23634e'
}

export function changeClass(value: number | null): string {
  return value === null ? 'muted' : value < -0.05 ? 'negative' : value > 0.05 ? 'positive' : 'muted'
}

export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  const safe = typeof value === 'string' && /^[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
