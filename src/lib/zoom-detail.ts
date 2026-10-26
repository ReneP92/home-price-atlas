import type { AreaLevel, Dataset, Place } from '../types'
import { boundaryContainsPoint } from './boundaries'
import { inBounds } from './statistics'

// Separate thresholds prevent repeated layer changes around one zoom boundary.
export const NEIGHBORHOOD_ZOOM = 12
export const CITY_ZOOM = 10.75

export function zoomDetailLevel(
  level: AreaLevel,
  zoom: number,
  hasNeighborhoods: boolean,
): AreaLevel {
  if (level === 'city' && zoom >= NEIGHBORHOOD_ZOOM && hasNeighborhoods) return 'neighborhood'
  if (level === 'neighborhood' && zoom <= CITY_ZOOM) return 'city'
  return level
}

type Geography = Pick<Dataset, 'regions' | 'boundaries'>

export function hasNeighborhoodAreas(dataset: Geography, cityId: string): boolean {
  const children = new Set(
    dataset.regions
      .filter((p) => p.kind === 'neighborhood' && p.cityId === cityId)
      .map((p) => p.id),
  )
  return (
    dataset.boundaries?.features.some(
      (f) => f.properties.kind === 'neighborhood' && children.has(f.id),
    ) || false
  )
}

export function cityAtMapCenter(
  dataset: Geography,
  candidates: Place[],
  center: [number, number],
  preferredCityId?: string,
): Place | undefined {
  const boundaries = new Map(dataset.boundaries?.features.map((f) => [f.id, f]))
  const containing = candidates.filter((city) =>
    boundaryContainsPoint(boundaries.get(city.id), center),
  )
  if (containing.length)
    return containing.find((city) => city.cityId === preferredCityId) || containing[0]

  // Reference neighborhoods can extend outside municipal borders. Only use a
  // known parent of a matching polygon, never the geographically nearest city.
  const places = new Map(dataset.regions.map((place) => [place.id, place]))
  for (const feature of dataset.boundaries?.features || []) {
    if (feature.properties.kind !== 'neighborhood' || !boundaryContainsPoint(feature, center))
      continue
    const parentId = places.get(feature.id)?.cityId
    const parent = candidates.find((city) => city.cityId === parentId)
    if (parent) return parent
  }
  // A fitted concave city can have its camera center in a hole. Retain the
  // explicitly selected city only when that center is still in its extent.
  const preferred = candidates.find((city) => city.cityId === preferredCityId)
  const boundary = preferred && boundaries.get(preferred.id)
  return preferred && boundary && inBounds(center, boundary.bbox) ? preferred : undefined
}
