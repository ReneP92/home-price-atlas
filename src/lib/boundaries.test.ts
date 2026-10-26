import { describe, expect, it } from 'vitest'
import type { AreaBoundary } from '../types'
import { boundaryInBounds } from './boundaries'

const area: AreaBoundary = {
  type: 'Feature',
  id: 'city-1',
  bbox: [0, 0, 10, 10],
  properties: {
    placeId: 'city-1',
    name: 'Example',
    city: 'Example',
    kind: 'city',
    source: 'Census',
    vintage: 'test',
    sourceId: '1',
    reference: false,
    match: 'test',
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ],
  },
}

describe('polygon viewport filtering', () => {
  it('includes intersecting area edges even when the center is outside the viewport', () => {
    expect(boundaryInBounds(area, [9, 9, 11, 11])).toBe(true)
  })
  it('excludes polygon holes and disjoint viewports rather than using only bounding boxes', () => {
    expect(boundaryInBounds(area, [4, 4, 6, 6])).toBe(false)
    expect(boundaryInBounds(area, [11, 11, 12, 12])).toBe(false)
  })
  it('does not invent an area when a boundary is missing', () => {
    expect(boundaryInBounds(undefined, [0, 0, 1, 1])).toBe(false)
    expect(boundaryInBounds(area, null)).toBe(false)
  })
})
