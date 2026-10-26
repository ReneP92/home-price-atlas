import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import mapboxWorkerUrl from 'mapbox-gl/dist/mapbox-gl-csp-worker.js?url'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import {
  ArrowRight,
  Check,
  Expand,
  LocateFixed,
  MapPin,
  Minimize2,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import type {
  AreaLevel,
  Dataset,
  Horizon,
  MapBounds,
  MapFocus,
  MapLayer,
  Metric,
  Place,
  PropertyType,
} from '../types'
import { compare, dateLabel, money, observation, percent } from '../lib/market'
import { MAP_LAYERS, mapColor, mapValue, mapValueLabel } from '../lib/statistics'
import { AREA_FILL, AREA_SOURCE, highlightAreas, syncAreaLayers } from '../lib/area-layers'

mapboxgl.workerUrl = mapboxWorkerUrl

const ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim() || ''
const BASEMAPS = {
  streets: { label: 'Streets', style: 'standard' },
  satellite: { label: 'Satellite', style: 'satellite-streets-v12' },
} as const
type Basemap = keyof typeof BASEMAPS

interface Props {
  dataset: Dataset
  places: Place[]
  level: AreaLevel
  type: PropertyType
  metric: Metric
  horizon: Horizon
  date: string
  minimumSales: number
  layer: MapLayer
  selected: Place | null
  hovered: string | null
  focus: MapFocus
  expanded: boolean
  viewportOnly: boolean
  comparedIds: string[]
  onSelect: (place: Place) => void
  onHover: (id: string | null) => void
  onDrill: (city: Place) => void
  onViewport: (bounds: MapBounds) => void
  onViewportOnly: (value: boolean) => void
  onLayer: (layer: MapLayer) => void
  onExpand: () => void
  onDetails: () => void
  onCompare: (id: string) => void
}

export default function InteractiveMap(p: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const layerActions = useRef<{
    sync: () => void
    highlight: () => void
    invalidate: () => void
  } | null>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('streets')
  const [basemapError, setBasemapError] = useState<
    'network' | 'authorization' | 'rate-limit' | null
  >(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const callbacks = useRef(p)
  const initialCamera = useRef({
    bounds: p.focus.bounds || p.dataset.bounds,
    padding: p.focus.bounds ? 0 : 55,
  })
  useEffect(() => {
    callbacks.current = p
  }, [p])

  const boundaryById = useMemo(
    () => new Map(p.dataset.boundaries?.features.map((feature) => [feature.id, feature])),
    [p.dataset],
  )
  const located = useMemo(
    () => p.places.filter((place) => boundaryById.has(place.id)),
    [p.places, boundaryById],
  )
  const extent = useMemo<[number, number] | null>(() => {
    const values = located.flatMap((place) => {
      const v = mapValue(place, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales)
      return v == null ? [] : [v]
    })
    return values.length ? [Math.min(...values), Math.max(...values)] : null
  }, [located, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales])

  const areaData = useMemo<FeatureCollection<Polygon | MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features: located.map((place) => {
        const boundary = boundaryById.get(place.id)!
        const value = mapValue(place, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales)
        const [w, s, e, n] = boundary.bbox
        return {
          ...boundary,
          properties: {
            ...boundary.properties,
            fill: mapColor(value, p.layer, extent || [0, 0]),
            sortKey: -(e - w) * (n - s),
          },
        }
      }),
    }),
    [located, boundaryById, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales, extent],
  )
  const contextData = useMemo<FeatureCollection<Polygon | MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features:
        p.level === 'neighborhood'
          ? p.dataset.boundaries?.features.filter((f) => f.properties.kind === 'city') || []
          : [],
    }),
    [p.dataset, p.level],
  )
  const renderData = useRef({ areas: areaData, context: contextData, level: p.level })
  useEffect(() => {
    renderData.current = { areas: areaData, context: contextData, level: p.level }
    layerActions.current?.sync()
  }, [areaData, contextData, p.level])

  useEffect(() => {
    if (!container.current || !ACCESS_TOKEN) return
    try {
      const map = new mapboxgl.Map({
        accessToken: ACCESS_TOKEN,
        container: container.current,
        projection: 'mercator',
        dragRotate: false,
        pitchWithRotate: false,
        bounds: [
          [initialCamera.current.bounds[0], initialCamera.current.bounds[1]],
          [initialCamera.current.bounds[2], initialCamera.current.bounds[3]],
        ],
        fitBoundsOptions: { padding: initialCamera.current.padding },
        minZoom: 7,
        maxZoom: 17,
        attributionControl: false,
        style: {
          version: 8,
          sources: {},
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#eef2ea' } },
          ],
        },
      })
      mapRef.current = map
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
      map.touchZoomRotate.disableRotation()
      let styleReady = map.isStyleLoaded()
      const highlight = () =>
        highlightAreas(map, callbacks.current.selected?.id, callbacks.current.hovered)
      const sync = () => {
        if (!styleReady) return
        if (container.current) container.current.dataset.areasReady = 'false'
        syncAreaLayers(
          map,
          renderData.current.areas,
          renderData.current.context,
          renderData.current.level,
        )
        highlight()
      }
      layerActions.current = {
        sync,
        highlight,
        invalidate: () => {
          styleReady = false
        },
      }
      // style.load is the supported point for adding sources. isStyleLoaded()
      // can still be false here while Standard's imported tiles are loading.
      map.on('style.load', () => {
        styleReady = true
        sync()
      })
      map.on('sourcedata', (event) => {
        if (
          event.sourceId === AREA_SOURCE &&
          map.getSource(AREA_SOURCE) &&
          map.isSourceLoaded(AREA_SOURCE)
        ) {
          requestAnimationFrame(() => {
            if (
              mapRef.current === map &&
              container.current &&
              map.getSource(AREA_SOURCE) &&
              map.isSourceLoaded(AREA_SOURCE) &&
              map.getLayer(AREA_FILL)
            )
              container.current.dataset.areasReady = 'true'
          })
        }
      })
      const areaFromEvent = (
        event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] },
      ) => {
        const id = event.features?.[0]?.properties?.placeId
        return callbacks.current.places.find((place) => place.id === id)
      }
      map.on('click', AREA_FILL, (event) => {
        const place = areaFromEvent(event)
        if (place) {
          setDismissed(null)
          callbacks.current.onSelect(place)
        }
      })
      map.on('dblclick', AREA_FILL, (event) => {
        const place = areaFromEvent(event)
        if (place?.kind === 'city') {
          event.preventDefault()
          callbacks.current.onDrill(place)
        }
      })
      map.on('mousemove', AREA_FILL, (event) => {
        const place = areaFromEvent(event)
        map.getCanvas().style.cursor = place ? 'pointer' : ''
        callbacks.current.onHover(place?.id || null)
      })
      map.on('mouseleave', AREA_FILL, () => {
        map.getCanvas().style.cursor = ''
        callbacks.current.onHover(null)
      })
      if (styleReady) sync()
      queueMicrotask(() => {
        if (mapRef.current === map) setReady(true)
      })
      map.on('error', (event) => {
        if (event.error?.message?.includes('WebGL')) setUnavailable(true)
        const status = event.error && 'status' in event.error ? event.error.status : undefined
        if (status === 429) setBasemapError('rate-limit')
        else if (status === 401 || status === 403) setBasemapError('authorization')
      })
      const viewport = () => {
        const bounds = map.getBounds()
        if (!bounds) return
        const visibleBounds: MapBounds = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ]
        if (container.current) {
          container.current.dataset.cameraMoving = 'false'
          container.current.dataset.cameraBounds = JSON.stringify(visibleBounds)
          container.current.dataset.cameraPadding = JSON.stringify(map.getPadding())
        }
        callbacks.current.onViewport(visibleBounds)
      }
      map.on('movestart', () => {
        if (container.current) container.current.dataset.cameraMoving = 'true'
      })
      map.on('moveend', viewport)
      viewport()
      const resize = new ResizeObserver(() => map.resize())
      resize.observe(container.current)
      return () => {
        resize.disconnect()
        layerActions.current = null
        map.remove()
        mapRef.current = null
      }
    } catch {
      queueMicrotask(() => setUnavailable(true))
    }
  }, [p.dataset])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !ACCESS_TOKEN) return
    const controller = new AbortController()
    async function loadBasemap() {
      try {
        const url = new URL(`https://api.mapbox.com/styles/v1/mapbox/${BASEMAPS[basemap].style}`)
        url.searchParams.set('access_token', ACCESS_TOKEN)
        const response = await fetch(url, { signal: controller.signal })
        if (response.status === 429) {
          if (!controller.signal.aborted) setBasemapError('rate-limit')
          return
        }
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setBasemapError('authorization')
          return
        }
        if (!response.ok) throw new Error('Basemap request failed')
        const style = await response.json()
        if (map && mapRef.current === map && !controller.signal.aborted) {
          if (container.current) container.current.dataset.areasReady = 'false'
          layerActions.current?.invalidate()
          map.setStyle(style, {
            diff: false,
            localFontFamily: undefined,
            localIdeographFontFamily: undefined,
          })
          setBasemapError(null)
        }
      } catch {
        if (!controller.signal.aborted) setBasemapError('network')
      }
    }
    void loadBasemap()
    return () => controller.abort()
  }, [ready, basemap])

  useEffect(() => {
    layerActions.current?.highlight()
  }, [p.selected?.id, p.hovered])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (p.focus.bounds) {
      const [west, south, east, north] = p.focus.bounds
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 0, duration: 0 },
      )
      return
    }
    const place = p.focus.place
    const parent =
      place && p.dataset.regions.find((r) => r.kind === 'city' && r.cityId === place.cityId)
    const center = place?.center || parent?.center
    const boundary =
      place && (boundaryById.get(place.id) || (parent && boundaryById.get(parent.id)))
    if (boundary) {
      const [west, south, east, north] = boundary.bbox
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          maxZoom: place?.kind === 'city' ? 12 : 14,
          duration: 650,
          padding:
            map.getContainer().clientWidth < 600
              ? { top: 95, right: 20, bottom: 100, left: 20 }
              : { top: 65, right: 250, bottom: 50, left: 30 },
        },
      )
    } else if (center)
      map.flyTo({
        center,
        zoom: place?.kind === 'city' || !place?.center ? 11.8 : 13,
        duration: 650,
        padding:
          map.getContainer().clientWidth < 600
            ? { top: 90, right: 175, bottom: 65, left: 0 }
            : { top: 65, right: 230, bottom: 45, left: 0 },
      })
    else
      map.fitBounds(
        [
          [p.dataset.bounds[0], p.dataset.bounds[1]],
          [p.dataset.bounds[2], p.dataset.bounds[3]],
        ],
        { padding: 55, duration: 650 },
      )
  }, [p.focus, p.dataset, ready, boundaryById])

  function fitAreas() {
    const map = mapRef.current
    if (!map) return
    setDismissed(p.selected?.id || null)
    if (!located.length) {
      map.fitBounds(
        [
          [p.dataset.bounds[0], p.dataset.bounds[1]],
          [p.dataset.bounds[2], p.dataset.bounds[3]],
        ],
        { padding: 55 },
      )
      return
    }
    const bounds = new mapboxgl.LngLatBounds()
    located.forEach((place) => {
      const [west, south, east, north] = boundaryById.get(place.id)!.bbox
      bounds.extend([west, south])
      bounds.extend([east, north])
    })
    map.fitBounds(bounds, {
      padding: { top: 65, right: 55, bottom: 90, left: 35 },
      maxZoom: 13,
      duration: 600,
    })
  }

  // A camera animation can move another area under the pointer. Keep action
  // buttons bound to the explicitly selected area rather than a transient hover.
  const locked =
    p.selected && p.focus.place?.id === p.selected.id && p.selected.id !== dismissed
      ? p.selected
      : null
  const preview = locked || p.dataset.regions.find((place) => place.id === p.hovered)
  const result = preview && compare(preview, p.type, p.metric, p.horizon, p.date, p.minimumSales)
  const point = preview && observation(preview, p.type, p.date)
  const showPreview = preview && preview.id !== dismissed
  return (
    <div className="map-shell" data-testid="market-map">
      <div ref={container} className="map-canvas" aria-label="Interactive home-price area map" />
      <div className="map-heading">
        <MapPin size={14} />
        {p.level === 'city' ? 'City areas' : 'Reference neighborhood areas'}
        <span className="map-heading-dot" />
        {dateLabel(p.date)}
      </div>
      <div className="map-layer-picker">
        <label>
          MAP
          <select
            aria-label="Basemap style"
            value={basemap}
            disabled={!ACCESS_TOKEN}
            onChange={(e) => {
              setBasemapError(null)
              setBasemap(e.target.value as Basemap)
            }}
          >
            {Object.entries(BASEMAPS).map(([id, style]) => (
              <option key={id} value={id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          COLOR BY
          <select
            aria-label="Map color metric"
            value={p.layer}
            onChange={(e) => p.onLayer(e.target.value as MapLayer)}
          >
            {MAP_LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="map-controls">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={18} />
        </button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={18} />
        </button>
        <button aria-label="Fit filtered areas" title="Fit filtered areas" onClick={fitAreas}>
          <LocateFixed size={17} />
        </button>
        <button
          aria-label={p.expanded ? 'Collapse map' : 'Expand map'}
          title={p.expanded ? 'Collapse map' : 'Expand map'}
          onClick={p.onExpand}
        >
          {p.expanded ? <Minimize2 size={17} /> : <Expand size={17} />}
        </button>
      </div>
      {!ACCESS_TOKEN && (
        <div className="map-fallback">
          <MapPin size={30} />
          <strong>Set up Mapbox</strong>
          <span>Add VITE_MAPBOX_ACCESS_TOKEN to your .env file and restart the local server.</span>
        </div>
      )}
      {unavailable && ACCESS_TOKEN && (
        <div className="map-fallback">
          <MapPin size={30} />
          <strong>Map unavailable on this device</strong>
          <span>Every area is still available in the list and charts.</span>
        </div>
      )}
      {basemapError && !unavailable && ACCESS_TOKEN && (
        <div className="basemap-notice" role="status">
          {basemapError === 'rate-limit'
            ? basemap === 'satellite'
              ? 'Mapbox satellite tiles are rate-limited. Switch to Streets or retry later.'
              : 'Mapbox is rate-limiting map requests. Area data is still available.'
            : basemapError === 'authorization'
              ? 'Mapbox rejected the token. Check your .env token and its allowed URLs.'
              : 'Background map unavailable. Price areas still work.'}
        </div>
      )}
      {!located.length && !unavailable && ACCESS_TOKEN && (
        <div className="map-empty">
          <MapPin size={23} />
          <strong>No matched boundaries in this selection</strong>
          <span>Areas without a matched polygon remain available in the directory.</span>
        </div>
      )}
      {showPreview && !unavailable && ACCESS_TOKEN && (
        <div
          className={`map-inspector ${locked ? '' : 'is-preview'}`}
          aria-label="Map area details"
        >
          {locked && (
            <button
              className="inspector-close"
              aria-label="Close map details"
              onClick={() => setDismissed(preview.id)}
            >
              <X size={14} />
            </button>
          )}
          <span className="eyebrow">
            {preview.kind === 'city' ? 'CITYWIDE' : preview.city.toUpperCase()}
          </span>
          <h3>{preview.name}</h3>
          <div className="inspector-values">
            <strong>
              {money(point?.[p.metric])}
              <small>{p.metric === 'ppsf' ? 'median / sq ft' : 'median sale price'}</small>
            </strong>
            <strong
              className={result?.change != null && result.change < 0 ? 'negative' : 'positive'}
            >
              {result?.change == null ? (
                <span className="inspector-na">
                  {result?.status === 'thin' ? 'Low sales' : 'No comparison'}
                </span>
              ) : (
                percent(result.change)
              )}
              <small>{p.horizon}-month change</small>
            </strong>
          </div>
          <p>
            {point?.sales ?? 'N/A'} current / {result?.previous?.sales ?? 'N/A'} prior sales
            {boundaryById.has(preview.id) ? (
              <span>
                {boundaryById.get(preview.id)!.properties.source} ·{' '}
                {boundaryById.get(preview.id)!.properties.vintage}
                {preview.kind === 'neighborhood' ? ' reference boundary' : ''}
              </span>
            ) : (
              <span>No matched boundary; city context only.</span>
            )}
          </p>
          {locked ? (
            <div className="inspector-actions">
              <button
                onClick={() => {
                  p.onSelect(preview)
                  p.onDetails()
                }}
              >
                Details <ArrowRight size={12} />
              </button>
              <button onClick={() => p.onCompare(preview.id)}>
                {p.comparedIds.includes(preview.id) ? <Check size={12} /> : <Plus size={12} />}
                {p.comparedIds.includes(preview.id) ? 'Comparing' : 'Compare'}
              </button>
              {preview.kind === 'city' && (
                <button onClick={() => p.onDrill(preview)}>
                  Neighborhoods <ArrowRight size={12} />
                </button>
              )}
            </div>
          ) : (
            <p>Click the shaded area or row to select it.</p>
          )}
        </div>
      )}
      <div className="map-bottom">
        <div className={`map-key ${p.layer !== 'change' ? 'sequential' : ''}`}>
          {p.layer !== 'change' && !extent ? (
            <span>No reported values in this selection</span>
          ) : (
            <>
              <span>{p.layer === 'change' ? 'Declining' : mapValueLabel(extent![0], p.layer)}</span>
              <i />
              <span>{p.layer === 'change' ? 'Rising' : mapValueLabel(extent![1], p.layer)}</span>
            </>
          )}
        </div>
        <p>
          {located.length} of {p.places.length} areas mapped
          {p.level === 'neighborhood'
            ? ' · Zillow 2017 reference boundaries'
            : ' · US Census boundaries'}
        </p>
      </div>
      <label className="map-viewport-toggle">
        <input
          type="checkbox"
          checked={p.viewportOnly}
          onChange={(e) => p.onViewportOnly(e.target.checked)}
        />
        Filter to map view
      </label>
      {!ready && !unavailable && ACCESS_TOKEN && <div className="map-loading">Loading map…</div>}
    </div>
  )
}
