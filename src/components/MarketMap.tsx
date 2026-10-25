import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Expand, MapPin, Minus, Plus } from 'lucide-react'
import type { Dataset, Horizon, Metric, Place, PropertyType } from '../types'
import { changeColor, compare, percent } from '../lib/market'

interface Props {
  dataset: Dataset
  places: Place[]
  type: PropertyType
  metric: Metric
  horizon: Horizon
  city: string
  selected: Place | null
  onSelect: (place: Place) => void
  onCity: (city: string) => void
}

export default function MarketMap({
  dataset,
  places,
  type,
  metric,
  horizon,
  city,
  selected,
  onSelect,
  onCity,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const callbacks = useRef({ onSelect, onCity })
  useEffect(() => {
    callbacks.current = { onSelect, onCity }
  }, [onSelect, onCity])

  useEffect(() => {
    if (!container.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: container.current,
        bounds: [
          [dataset.bounds[0], dataset.bounds[1]],
          [dataset.bounds[2], dataset.bounds[3]],
        ],
        fitBoundsOptions: { padding: 60 },
        minZoom: 8,
        maxZoom: 16,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            basemap: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
          },
          layers: [
            {
              id: 'basemap',
              type: 'raster',
              source: 'basemap',
              paint: { 'raster-saturation': -0.75, 'raster-opacity': 0.78 },
            },
          ],
        },
      })
      mapRef.current = map
      // DOM price markers need the initialized camera, not a completed basemap
      // download. Waiting for `load` can leave them hidden indefinitely when a
      // tile fails or is retried. Guard against StrictMode's disposed instance.
      queueMicrotask(() => {
        if (mapRef.current === map) setReady(true)
      })
      map.on('error', (event) => {
        if (event.error?.message?.includes('WebGL')) setUnavailable(true)
      })
      const resize = new ResizeObserver(() => map.resize())
      resize.observe(container.current)
      return () => {
        resize.disconnect()
        markers.current.forEach((m) => m.remove())
        markers.current = []
        map.remove()
        mapRef.current = null
      }
    } catch {
      // The list and charts remain accessible on devices without WebGL.
      queueMicrotask(() => setUnavailable(true))
    }
  }, [dataset])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    markers.current.forEach((marker) => marker.remove())
    const cities = dataset.regions.filter((place) => place.kind === 'city')
    const visible = city ? places.filter((place) => place.center) : cities
    markers.current = visible.map((place) => {
      const result = compare(place, type, metric, horizon, dataset.dataThrough)
      const button = document.createElement('button')
      button.className = `map-price-pin${selected?.id === place.id ? ' is-selected' : ''}${result.change === null ? ' no-value' : ''}`
      button.style.setProperty('--pin-color', changeColor(result.change))
      button.textContent = result.change === null ? '·' : percent(result.change)
      button.dataset.label = `${place.name} · ${result.change === null ? 'Limited data' : percent(result.change)}`
      button.title = `${place.name}: ${result.change === null ? 'Not enough comparable sales' : percent(result.change)}${place.kind === 'neighborhood' ? '. Approximate reference location.' : '. City-level change.'}`
      button.setAttribute(
        'aria-label',
        `${place.kind === 'city' ? 'Explore' : 'Select'} ${place.name}`,
      )
      button.addEventListener('click', () => {
        if (place.kind === 'city') callbacks.current.onCity(place.cityId)
        else callbacks.current.onSelect(place)
      })
      return new maplibregl.Marker({ element: button }).setLngLat(place.center!).addTo(map)
    })
    const adjustLabels = () => {
      for (const marker of markers.current) {
        marker.getElement().classList.toggle('is-overview', !city && map.getZoom() < 11.3)
      }
    }
    adjustLabels()
    map.on('zoom', adjustLabels)
    return () => {
      map.off('zoom', adjustLabels)
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
    }
  }, [ready, city, places, dataset, type, metric, horizon, selected?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const focus = dataset.regions.find((place) => place.kind === 'city' && place.cityId === city)
    if (focus?.center) map.flyTo({ center: focus.center, zoom: 12.3, duration: 850 })
    else
      map.fitBounds(
        [
          [dataset.bounds[0], dataset.bounds[1]],
          [dataset.bounds[2], dataset.bounds[3]],
        ],
        { padding: 60, duration: 850 },
      )
  }, [city, dataset, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selected?.center || !city) return
    if (!map.getBounds().contains(selected.center))
      map.easeTo({ center: selected.center, duration: 500 })
  }, [selected, city, ready])

  const mapped = places.filter((place) => place.center).length
  return (
    <div className="map-shell" data-testid="market-map">
      <div ref={container} className="map-canvas" aria-label="Interactive home-price map" />
      <div className="map-heading">
        <span className="map-heading-icon">
          <MapPin size={14} />
        </span>
        {city ? 'Neighborhood locations' : 'City overview'}
        <span className="map-heading-dot" />
        {horizon}-month change
      </div>
      <div className="map-controls">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={18} />
        </button>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={18} />
        </button>
        <button title="Show entire area" aria-label="Show entire area" onClick={() => onCity('')}>
          <Expand size={17} />
        </button>
      </div>
      {unavailable && (
        <div className="map-fallback">
          <MapPin size={30} />
          <strong>Map unavailable on this device</strong>
          <span>Every neighborhood is still available in the list and charts.</span>
        </div>
      )}
      {city && mapped === 0 && !unavailable && (
        <div className="map-empty">
          <MapPin size={23} />
          <strong>Explore the neighborhoods in the list</strong>
          <span>Reference locations are unavailable for this selection.</span>
        </div>
      )}
      <div className="map-bottom">
        <div className="map-key">
          <span>Declining</span>
          <i />
          <span>Rising</span>
        </div>
        <p>
          {city
            ? `${mapped} of ${places.length} locations mapped. Points are approximate, not boundaries.`
            : 'Select a city to explore its neighborhoods.'}
        </p>
      </div>
      {!ready && !unavailable && <div className="map-loading">Loading map…</div>}
    </div>
  )
}
