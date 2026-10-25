import { useEffect, useRef } from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import type { AreaLevel, Horizon, Metric, Place, PropertyType, QualityFilter } from '../types'
import { changeClass, compare, money, percent } from '../lib/market'

interface Props {
  places: Place[]
  level: AreaLevel
  selected: Place | null
  hovered: string | null
  comparedIds: string[]
  type: PropertyType
  metric: Metric
  horizon: Horizon
  date: string
  minimumSales: number
  sort: string
  quality: QualityFilter
  onSelect: (p: Place) => void
  onHover: (id: string | null) => void
  onCompare: (id: string) => void
  onSort: (sort: string) => void
  onQuality: (quality: QualityFilter) => void
  onReset: () => void
}

export default function AreaDirectory(p: Props) {
  const rows = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = rows.current
    const row = container?.querySelector<HTMLElement>(`[data-place-id="${p.selected?.id}"]`)
    if (!row || !container) return
    const bounds = container.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    if (rect.top < bounds.top || rect.bottom > bounds.bottom)
      container.scrollTop += rect.top - bounds.top - bounds.height / 2 + rect.height / 2
  }, [p.selected?.id])
  const noun = p.level === 'city' ? 'cities' : 'neighborhoods'
  return (
    <div className="directory">
      <div className="directory-header">
        <span>
          {p.places.length} {noun}
        </span>
        <label>
          <ArrowDownUp size={12} />
          <select aria-label="Sort areas" value={p.sort} onChange={(e) => p.onSort(e.target.value)}>
            <option value="sales">Most comparable sales</option>
            <option value="name">By name</option>
            <option value="rising">Biggest increases</option>
            <option value="falling">Biggest decreases</option>
          </select>
        </label>
      </div>
      <div className="directory-column-head">
        <span>{p.level === 'city' ? 'CITY' : 'NEIGHBORHOOD'}</span>
        <span>{p.horizon}-MO CHANGE</span>
      </div>
      <div ref={rows} className="directory-rows" data-testid="area-list">
        {p.places.map((place) => {
          const c = compare(place, p.type, p.metric, p.horizon, p.date, p.minimumSales)
          const compared = p.comparedIds.includes(place.id)
          return (
            <div
              key={place.id}
              data-place-id={place.id}
              className={`place-row ${p.selected?.id === place.id ? 'selected' : ''} ${p.hovered === place.id ? 'is-hovered' : ''}`}
              onMouseEnter={() => p.onHover(place.id)}
              onMouseLeave={() => p.onHover(null)}
            >
              <button
                className="place-main"
                onClick={() => p.onSelect(place)}
                aria-pressed={p.selected?.id === place.id}
              >
                <span className="place-info">
                  <strong>{place.name}</strong>
                  <span>
                    {place.kind === 'city' ? 'Citywide' : place.city}
                    <i />
                    {money(c.current?.[p.metric])}
                    {p.metric === 'ppsf' ? ' / ft²' : ''}
                    {!place.center && (
                      <MapPin size={10} aria-label="Reference location unavailable" />
                    )}
                  </span>
                </span>
                <span className={`place-change ${changeClass(c.change)}`}>
                  {c.change == null ? (
                    <span className={`sample-status ${c.status}`}>
                      {c.status === 'thin' ? 'Low sales' : 'No comparison'}
                    </span>
                  ) : (
                    percent(c.change)
                  )}
                  <small title="Sales in the current window versus the comparison window">
                    {c.current?.sales ?? '?'} vs {c.previous?.sales ?? '?'} sales
                  </small>
                </span>
              </button>
              <button
                className={`compare-place ${compared ? 'is-compared' : ''}`}
                aria-label={`${compared ? 'Remove' : 'Add'} ${place.name} ${compared ? 'from' : 'to'} comparison`}
                onClick={() => p.onCompare(place.id)}
              >
                {compared ? <Check size={13} /> : <Plus size={13} />}
              </button>
            </div>
          )
        })}
        {p.places.length === 0 && (
          <div className="empty-directory">
            <Search size={27} />
            <strong>No areas match these filters</strong>
            <p>Try another city or time window, or include areas with limited data.</p>
            <button className="text-button" onClick={p.onReset}>
              Reset filters <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="directory-footer">
        <SlidersHorizontal size={13} />
        <label>
          <input
            type="checkbox"
            checked={p.quality === 'ready'}
            onChange={(e) => p.onQuality(e.target.checked ? 'ready' : 'all')}
          />
          Comparable sales only
        </label>
        <span>Current vs prior sales</span>
      </div>
    </div>
  )
}
