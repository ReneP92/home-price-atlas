import type { Map, GeoJSONSource } from 'mapbox-gl'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { AreaLevel } from '../types'

export const AREA_SOURCE = 'market-areas'
export const AREA_FILL = 'market-area-fill'
const OUTLINE = 'market-area-outline'
const CONTEXT_SOURCE = 'city-boundary-context'
const CONTEXT_LINE = 'city-boundary-context-line'

export function highlightAreas(map: Map, selected: string | undefined, hovered: string | null) {
  if (!map.getSource(AREA_SOURCE)) return
  map.removeFeatureState({ source: AREA_SOURCE })
  if (selected) map.setFeatureState({ source: AREA_SOURCE, id: selected }, { selected: true })
  if (hovered) map.setFeatureState({ source: AREA_SOURCE, id: hovered }, { hover: true })
}

export function syncAreaLayers(
  map: Map,
  data: FeatureCollection<Polygon | MultiPolygon>,
  context: FeatureCollection<Polygon | MultiPolygon>,
  level: AreaLevel,
) {
  if (!map.getSource(AREA_SOURCE))
    map.addSource(AREA_SOURCE, {
      type: 'geojson',
      data,
      promoteId: 'placeId',
      attribution:
        'Boundaries: <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html">US Census</a> · <a href="https://www.zillow.com/">Zillow</a> / <a href="https://www.epa.gov/">US EPA</a>',
    })
  else (map.getSource(AREA_SOURCE) as GeoJSONSource).setData(data)
  if (!map.getSource(CONTEXT_SOURCE))
    map.addSource(CONTEXT_SOURCE, { type: 'geojson', data: context })
  else (map.getSource(CONTEXT_SOURCE) as GeoJSONSource).setData(context)

  // Standard exposes slots; classic satellite styles expose regular layers.
  // In both cases the market areas sit beneath the basemap's text labels.
  const position = map.getSlots().includes('middle') ? { slot: 'middle' } : {}
  const before = position.slot
    ? undefined
    : map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id
  if (!map.getLayer(CONTEXT_LINE))
    map.addLayer(
      {
        id: CONTEXT_LINE,
        type: 'line',
        source: CONTEXT_SOURCE,
        ...position,
        paint: { 'line-color': '#7c8983', 'line-width': 1, 'line-opacity': 0.55 },
      },
      before,
    )
  if (!map.getLayer(AREA_FILL))
    map.addLayer(
      {
        id: AREA_FILL,
        type: 'fill',
        source: AREA_SOURCE,
        ...position,
        layout: { 'fill-sort-key': ['get', 'sortKey'] },
        paint: {
          'fill-color': ['get', 'fill'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.5,
            ['boolean', ['feature-state', 'hover'], false],
            0.42,
            0.27,
          ],
        },
      },
      before,
    )
  if (!map.getLayer(OUTLINE))
    map.addLayer(
      {
        id: OUTLINE,
        type: 'line',
        source: AREA_SOURCE,
        ...position,
        paint: {
          'line-color': [
            'case',
            [
              'any',
              ['boolean', ['feature-state', 'selected'], false],
              ['boolean', ['feature-state', 'hover'], false],
            ],
            '#214b3c',
            '#698878',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3,
            ['boolean', ['feature-state', 'hover'], false],
            2,
            0.8,
          ],
          'line-opacity': 0.9,
        },
      },
      before,
    )
  map.setPaintProperty(OUTLINE, 'line-dasharray', level === 'neighborhood' ? [3, 2] : [1, 0])
}
