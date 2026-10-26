import { describe, expect, it } from 'vitest'
import type { AreaBoundaries, AreaBoundary, Place } from '../types'
import { cityAtMapCenter, hasNeighborhoodAreas, zoomDetailLevel } from './zoom-detail'

const city: Place = {
  id: 'city-1',
  providerId: '1',
  kind: 'city',
  name: 'City',
  city: 'City',
  cityId: '1',
  state: 'CA',
  center: [1, 1],
  series: {},
}
const other: Place = { ...city, id: 'city-2', providerId: '2', cityId: '2', name: 'Other' }
const hood: Place = {
  ...city,
  id: 'neighborhood-3',
  providerId: '3',
  kind: 'neighborhood',
  name: 'Neighborhood',
}
function rectangle(place: Place, west: number, east: number): AreaBoundary {
  return {
    type: 'Feature',
    id: place.id,
    bbox: [west, 0, east, 5],
    properties: {
      placeId: place.id,
      kind: place.kind,
      name: place.name,
      city: place.city,
      source: 'test',
      vintage: 'test',
      sourceId: place.id,
      reference: place.kind === 'neighborhood',
      match: 'test',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, 0],
          [east, 0],
          [east, 5],
          [west, 5],
          [west, 0],
        ],
      ],
    },
  }
}
const boundaries: AreaBoundaries = {
  type: 'FeatureCollection',
  schemaVersion: 1,
  region: 'test',
  generatedAt: '',
  sources: [],
  features: [rectangle(city, 0, 5), rectangle(other, 5, 10), rectangle(hood, 0, 2)],
}
const dataset = { regions: [city, other, hood], boundaries }

describe('zoom-driven geographic detail', () => {
  it('uses a hysteresis band so small zoom changes do not flicker between levels', () => {
    expect(zoomDetailLevel('city', 11.9, true)).toBe('city')
    expect(zoomDetailLevel('city', 12, true)).toBe('neighborhood')
    expect(zoomDetailLevel('neighborhood', 11.8, true)).toBe('neighborhood')
    expect(zoomDetailLevel('neighborhood', 10.75, true)).toBe('city')
    expect(zoomDetailLevel('city', 11, true)).toBe('city')
  })
  it('does not drill into places without matched neighborhood polygons', () => {
    expect(hasNeighborhoodAreas(dataset, '1')).toBe(true)
    expect(hasNeighborhoodAreas(dataset, '2')).toBe(false)
    expect(zoomDetailLevel('city', 15, false)).toBe('city')
    expect(hasNeighborhoodAreas({ regions: [city, hood] }, '1')).toBe(false)
  })
  it('uses city polygons and respects the currently allowed city candidates', () => {
    expect(cityAtMapCenter(dataset, [city, other], [1, 1])?.id).toBe(city.id)
    expect(cityAtMapCenter(dataset, [city, other], [8, 1])?.id).toBe(other.id)
    expect(cityAtMapCenter(dataset, [city], [8, 1])).toBeUndefined()
    expect(cityAtMapCenter(dataset, [city, other], [30, 1], '1')).toBeUndefined()
  })
})
