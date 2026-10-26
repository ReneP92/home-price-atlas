import booleanIntersects from '@turf/boolean-intersects'
import type { Polygon } from 'geojson'
import type { AreaBoundary, MapBounds } from '../types'

// Use the actual polygon, including holes, rather than a centroid or a rough
// bounding-box match. Split viewports crossing the dateline into two boxes.
export function boundaryInBounds(
  boundary: AreaBoundary | undefined,
  bounds: MapBounds | null,
): boolean {
  if (!boundary || !bounds) return false
  const [west, south, east, north] = bounds
  const width = east >= west ? east - west : east + 360 - west
  const start = ((((west + 180) % 360) + 360) % 360) - 180
  const end = start + Math.min(width, 360)
  const ranges =
    width >= 360
      ? [[-180, 180]]
      : end <= 180
        ? [[start, end]]
        : [
            [start, 180],
            [-180, end - 360],
          ]
  return ranges.some(([left, right]) => {
    const [bw, bs, be, bn] = boundary.bbox
    if (be < left || bw > right || bn < south || bs > north) return false
    const viewport: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [left, south],
          [right, south],
          [right, north],
          [left, north],
          [left, south],
        ],
      ],
    }
    return booleanIntersects(boundary.geometry, viewport)
  })
}
