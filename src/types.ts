export type PropertyType = 'single-family' | 'condo' | 'townhouse'
export type Metric = 'price' | 'ppsf'
export type Horizon = 3 | 6 | 12

export interface Observation {
  date: string
  start: string
  price: number | null
  ppsf: number | null
  sales: number | null
  daysOnMarket: number | null
  inventory: number | null
}

export interface Place {
  id: string
  providerId: string
  kind: 'city' | 'neighborhood'
  name: string
  city: string
  cityId: string
  state: string
  center: [number, number] | null
  locationMethod?: string
  series: Partial<Record<PropertyType, Observation[]>>
}

export interface Dataset {
  schemaVersion: number
  id: string
  name: string
  description: string
  bounds: [number, number, number, number]
  generatedAt: string
  dataThrough: string
  sourceUpdatedAt: string
  frequency: string
  seasonallyAdjusted: boolean
  sources: {
    kind: string
    url: string
    dataThrough: string
    sourceUpdatedAt: string
    observations: number
  }[]
  regions: Place[]
}

export interface Catalog {
  defaultRegion: string
  regions: { id: string; name: string; description: string; available: boolean }[]
}

export const TYPES: { id: PropertyType; label: string; fullLabel: string; color: string }[] = [
  {
    id: 'single-family',
    label: 'Single-family',
    fullLabel: 'Single-family homes',
    color: '#1d6653',
  },
  { id: 'condo', label: 'Condos', fullLabel: 'Condos / co-ops', color: '#7c73b7' },
  { id: 'townhouse', label: 'Townhomes', fullLabel: 'Townhomes', color: '#c48a37' },
]
