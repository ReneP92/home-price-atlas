import type {
  Dataset,
  DirectionFilter,
  Horizon,
  MapBounds,
  MapLayer,
  Metric,
  Observation,
  Place,
  PropertyType,
} from '../types'
import {
  changeColor,
  compare,
  csvCell,
  median,
  MIN_SALES,
  money,
  monthKey,
  observation,
  percent,
} from './market'

export const MAP_LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'change', label: 'Price change' },
  { id: 'price', label: 'Price level' },
  { id: 'sales', label: 'Sales activity' },
  { id: 'daysOnMarket', label: 'Days on market' },
]

export function reportingDates(dataset: Dataset): string[] {
  const dates = [
    ...new Set(
      dataset.regions.flatMap((r) =>
        Object.values(r.series).flatMap((ps) => ps.map((p) => p.date)),
      ),
    ),
  ].sort()
  return dates
    .filter((date) => date <= dataset.dataThrough && monthKey(date, -12) >= dates[0]?.slice(0, 7))
    .slice(-13)
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, q))
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

export function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  return current != null && previous != null && previous > 0 ? (current / previous - 1) * 100 : null
}

export function matchesDirection(change: number | null, filter: DirectionFilter): boolean {
  if (filter === 'all') return true
  if (change === null) return false
  return filter === 'rising'
    ? change > 0.05
    : filter === 'falling'
      ? change < -0.05
      : Math.abs(change) <= 0.05
}

export function inBounds(center: Place['center'], bounds: MapBounds | null): boolean {
  if (!center || !bounds) return false
  const [west, south, east, north] = bounds
  const [lon, lat] = center
  return (
    lat >= south &&
    lat <= north &&
    (west <= east
      ? [lon, lon + 360, lon - 360].some((x) => x >= west && x <= east)
      : lon >= west || lon <= east)
  )
}

export function parseMapBounds(value: string | null): MapBounds | null {
  if (!value) return null
  const parts = value.split(',')
  if (parts.some((part) => !part.trim())) return null
  const bounds = parts.map(Number)
  if (bounds.length !== 4 || bounds.some((v) => !Number.isFinite(v))) return null
  const [west, south, east, north] = bounds
  if (
    south >= north ||
    south < -85.1 ||
    north > 85.1 ||
    Math.abs(west) > 540 ||
    Math.abs(east) > 540 ||
    west === east
  )
    return null
  return bounds as MapBounds
}

export function marketSummary(
  places: Place[],
  type: PropertyType,
  metric: Metric,
  horizon: Horizon,
  date: string,
  minimumSales = MIN_SALES,
) {
  const comparisons = places.map((p) => compare(p, type, metric, horizon, date, minimumSales))
  const changes = comparisons.flatMap((c) => (c.change == null ? [] : [c.change]))
  return {
    total: places.length,
    ready: changes.length,
    thin: comparisons.filter((c) => c.status === 'thin').length,
    missing: comparisons.filter((c) => c.status === 'missing').length,
    rising: changes.filter((c) => c > 0.05).length,
    falling: changes.filter((c) => c < -0.05).length,
    flat: changes.filter((c) => Math.abs(c) <= 0.05).length,
    middle: median(changes),
    q1: quantile(changes, 0.25),
    q3: quantile(changes, 0.75),
    mapped: places.filter((p) => p.center).length,
  }
}

export interface SalesYear {
  total: number | null
  available: number
  windows: (Observation | undefined)[]
}

// Monthly exports overlap. A year is four adjacent, disjoint three-month
// windows, never the sum of twelve monthly rows. Missing is not zero.
export function annualSales(
  place: Place,
  type: PropertyType,
  date: string,
  yearsBack = 0,
): SalesYear {
  const windows = [9, 6, 3, 0].map((offset) => {
    const point = observation(place, type, date, -offset - yearsBack * 12)
    return point && monthKey(point.date, -2) === point.start.slice(0, 7) ? point : undefined
  })
  const available = windows.filter((p) => p?.sales != null && p.sales >= 0).length
  return {
    total: available === 4 ? windows.reduce((sum, p) => sum + p!.sales!, 0) : null,
    available,
    windows,
  }
}

export function benchmarkGap(
  place: Place,
  city: Place | undefined,
  type: PropertyType,
  metric: Metric,
  horizon: Horizon,
  date: string,
  minimumSales = MIN_SALES,
) {
  const local = compare(place, type, metric, horizon, date, minimumSales)
  const benchmark = city && compare(city, type, metric, horizon, date, minimumSales)
  return {
    local,
    benchmark,
    gap: local.change != null && benchmark?.change != null ? local.change - benchmark.change : null,
  }
}

export function mapValue(
  place: Place,
  layer: MapLayer,
  type: PropertyType,
  metric: Metric,
  horizon: Horizon,
  date: string,
  minimumSales: number,
): number | null {
  if (layer === 'change') return compare(place, type, metric, horizon, date, minimumSales).change
  const current = observation(place, type, date)
  if (!current) return null
  if (layer === 'price')
    return current[metric] != null && current[metric]! > 0 ? current[metric] : null
  if (layer === 'daysOnMarket' && (current.sales == null || current.sales < minimumSales))
    return null
  return current[layer]
}

export function mapValueLabel(value: number | null, layer: MapLayer): string {
  if (value === null) return 'N/A'
  return layer === 'change'
    ? percent(value)
    : layer === 'price'
      ? money(value)
      : layer === 'daysOnMarket'
        ? `${value}d`
        : String(value)
}

export function mapColor(value: number | null, layer: MapLayer, extent: [number, number]): string {
  if (layer === 'change') return changeColor(value)
  if (value === null) return '#9ba3a8'
  const scale = extent[1] === extent[0] ? 0.5 : (value - extent[0]) / (extent[1] - extent[0])
  return ['#b5cbd5', '#8cabbc', '#668da8', '#416d93', '#234f77'][
    Math.min(4, Math.max(0, Math.floor(scale * 5)))
  ]
}

export function exportStatistics(
  places: Place[],
  type: PropertyType,
  metric: Metric,
  horizon: Horizon,
  date: string,
  minimumSales = MIN_SALES,
): string {
  const labels = {
    'single-family': 'Single Family Residential',
    condo: 'Condo/Co-op',
    townhouse: 'Townhouse',
  }
  const rows: unknown[][] = [
    [
      'Region ID',
      'Geographic level',
      'Area',
      'City',
      'Source property type',
      'Metric',
      'As of',
      'Current period start',
      'Current period end',
      'Current value',
      'Prior period end',
      'Prior value',
      'Change percent',
      'Current window sales',
      'Prior window sales',
      'Minimum sales per window',
      'Comparison status',
      'Annual sales',
      'Annual quarters available',
      'Prior annual sales',
      'Annual sales change percent',
      'Median days on market',
      'Reported inventory',
      'Source',
    ],
  ]
  for (const place of places) {
    const c = compare(place, type, metric, horizon, date, minimumSales)
    const currentYear = annualSales(place, type, date)
    const priorYear = annualSales(place, type, date, 1)
    const growth = percentChange(currentYear.total, priorYear.total)
    rows.push([
      place.id,
      place.kind,
      place.name,
      place.city,
      labels[type],
      metric,
      date,
      c.current?.start,
      c.current?.date,
      c.current?.[metric],
      c.previous?.date,
      c.previous?.[metric],
      c.change == null ? null : Number(c.change.toFixed(2)),
      c.current?.sales,
      c.previous?.sales,
      minimumSales,
      c.status,
      currentYear.total,
      currentYear.available,
      priorYear.total,
      growth == null ? null : Number(growth.toFixed(2)),
      c.current?.daysOnMarket,
      c.current?.inventory,
      'Redfin Data Center',
    ])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
