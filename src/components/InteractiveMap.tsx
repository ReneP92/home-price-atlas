import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
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
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [basemapUnavailable, setBasemapUnavailable] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const callbacks = useRef(p)
  const initialCamera = useRef({
    bounds: p.focus.bounds || p.dataset.bounds,
    padding: p.focus.bounds ? 0 : 55,
  })
  useEffect(() => {
    callbacks.current = p
  }, [p])

  const located = useMemo(() => p.places.filter((place) => place.center), [p.places])
  const extent = useMemo<[number, number] | null>(() => {
    const values = located.flatMap((place) => {
      const v = mapValue(place, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales)
      return v == null ? [] : [v]
    })
    return values.length ? [Math.min(...values), Math.max(...values)] : null
  }, [located, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales])

  useEffect(() => {
    if (!container.current) return
    const controller = new AbortController()
    try {
      const map = new maplibregl.Map({
        container: container.current,
        bounds: [
          [initialCamera.current.bounds[0], initialCamera.current.bounds[1]],
          [initialCamera.current.bounds[2], initialCamera.current.bounds[3]],
        ],
        fitBoundsOptions: { padding: initialCamera.current.padding },
        minZoom: 7,
        maxZoom: 17,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {},
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#eef2ea' } },
          ],
        },
      })
      mapRef.current = map
      queueMicrotask(() => {
        if (mapRef.current === map) setReady(true)
      })
      map.on('error', (event) => {
        if (event.error?.message?.includes('WebGL')) setUnavailable(true)
      })
      const viewport = () => {
        const bounds = map.getBounds()
        callbacks.current.onViewport([
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ])
      }
      map.on('moveend', viewport)
      viewport()
      async function loadBasemap() {
        try {
          const response = await fetch('https://tiles.openfreemap.org/styles/positron', {
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`Basemap request failed: ${response.status}`)
          const style = await response.json()
          if (mapRef.current === map && !controller.signal.aborted) map.setStyle(style)
        } catch {
          if (!controller.signal.aborted) setBasemapUnavailable(true)
        }
      }
      void loadBasemap()
      const resize = new ResizeObserver(() => map.resize())
      resize.observe(container.current)
      return () => {
        controller.abort()
        resize.disconnect()
        markers.current.forEach((m) => m.remove())
        markers.current = []
        map.remove()
        mapRef.current = null
      }
    } catch {
      queueMicrotask(() => setUnavailable(true))
    }
  }, [p.dataset])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    markers.current.forEach((marker) => marker.remove())
    markers.current = located.map((place) => {
      const value = mapValue(place, p.layer, p.type, p.metric, p.horizon, p.date, p.minimumSales)
      const button = document.createElement('button')
      button.className = `map-price-pin${value == null ? ' no-value' : ''}`
      button.dataset.placeId = place.id
      button.dataset.label = `${place.name} · ${mapValueLabel(value, p.layer)}`
      button.style.setProperty('--pin-color', mapColor(value, p.layer, extent || [0, 0]))
      button.textContent = value == null ? '·' : mapValueLabel(value, p.layer)
      button.setAttribute('aria-label', `Select ${place.name}`)
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        setDismissed(null)
        callbacks.current.onSelect(place)
      })
      button.addEventListener('dblclick', (event) => {
        event.stopPropagation()
        if (place.kind === 'city') callbacks.current.onDrill(place)
      })
      button.addEventListener('mouseenter', () => callbacks.current.onHover(place.id))
      button.addEventListener('mouseleave', () => callbacks.current.onHover(null))
      button.addEventListener('focus', () => callbacks.current.onHover(place.id))
      button.addEventListener('blur', () => callbacks.current.onHover(null))
      return new maplibregl.Marker({ element: button }).setLngLat(place.center!).addTo(map)
    })
    const adjustLabels = () =>
      markers.current.forEach((marker) =>
        marker.getElement().classList.toggle('is-overview', map.getZoom() < 11.3),
      )
    adjustLabels()
    map.on('zoom', adjustLabels)
    return () => {
      map.off('zoom', adjustLabels)
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
    }
  }, [ready, located, p.type, p.metric, p.horizon, p.date, p.minimumSales, p.layer, extent])

  useEffect(() => {
    markers.current.forEach((marker) => {
      const node = marker.getElement()
      node.classList.toggle('is-selected', node.dataset.placeId === p.selected?.id)
      node.classList.toggle('is-highlighted', node.dataset.placeId === p.hovered)
    })
  }, [
    p.selected?.id,
    p.hovered,
    located,
    ready,
    p.layer,
    p.type,
    p.date,
    p.horizon,
    p.metric,
    p.minimumSales,
  ])

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
    if (center)
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
  }, [p.focus, p.dataset, ready])

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
    const bounds = new maplibregl.LngLatBounds()
    located.forEach((place) => bounds.extend(place.center!))
    map.fitBounds(bounds, {
      padding: { top: 65, right: 55, bottom: 90, left: 35 },
      maxZoom: 13,
      duration: 600,
    })
  }

  // A camera animation can move another marker under the pointer. Keep action
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
      <div ref={container} className="map-canvas" aria-label="Interactive home-price map" />
      <div className="map-heading">
        <MapPin size={14} />
        {p.level === 'city' ? 'City overview' : 'Neighborhood locations'}
        <span className="map-heading-dot" />
        {dateLabel(p.date)}
      </div>
      <div className="map-layer-picker">
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
      {unavailable && (
        <div className="map-fallback">
          <MapPin size={30} />
          <strong>Map unavailable on this device</strong>
          <span>Every area is still available in the list and charts.</span>
        </div>
      )}
      {basemapUnavailable && !unavailable && (
        <div className="basemap-notice" role="status">
          Background map unavailable. Price markers still work.
        </div>
      )}
      {!located.length && !unavailable && (
        <div className="map-empty">
          <MapPin size={23} />
          <strong>No reference points in this selection</strong>
          <span>Areas with missing locations remain available in the directory.</span>
        </div>
      )}
      {showPreview && !unavailable && (
        <div className="map-inspector" aria-label="Map area details">
          <button
            className="inspector-close"
            aria-label="Close map details"
            onClick={() => setDismissed(preview.id)}
          >
            <X size={14} />
          </button>
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
            {!preview.center && <span>Reference point unavailable; city context only.</span>}
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
            <p>Click the marker or row to select this area.</p>
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
          {located.length} of {p.places.length} locations mapped
          {p.level === 'neighborhood' ? ' · approximate points' : ''}
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
      {!ready && !unavailable && <div className="map-loading">Loading map…</div>}
    </div>
  )
}
