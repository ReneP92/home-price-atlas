import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  CircleHelp,
  House,
  Layers3,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { TYPES } from '../types'
import type {
  AreaLevel,
  DirectionFilter,
  Horizon,
  Metric,
  Place,
  PropertyType,
  QualityFilter,
} from '../types'
import { changeClass, compare, percent } from '../lib/market'
import { marketSummary } from '../lib/statistics'

interface Props {
  places: Place[]
  type: PropertyType
  metric: Metric
  horizon: Horizon
  date: string
  minimumSales: number
  level: AreaLevel
  quality: QualityFilter
  direction: DirectionFilter
  matched: boolean
  onType: (type: PropertyType) => void
  onQuality: (quality: QualityFilter) => void
  onDirection: (direction: DirectionFilter) => void
  onMatched: (matched: boolean) => void
  onAbout: () => void
}

export default function MarketOverview(p: Props) {
  const shared = p.places.filter((place) =>
    TYPES.every(
      (t) => compare(place, t.id, p.metric, p.horizon, p.date, p.minimumSales).status === 'ready',
    ),
  )
  const summaryPlaces = p.matched ? shared : p.places
  const coverage = marketSummary(p.places, p.type, p.metric, p.horizon, p.date, p.minimumSales)
  const areas = p.level === 'city' ? 'cities' : 'neighborhoods'
  return (
    <>
      <section className="summary-grid" aria-label="Compare home types">
        {TYPES.map((t) => {
          const summary = marketSummary(
            summaryPlaces,
            t.id,
            p.metric,
            p.horizon,
            p.date,
            p.minimumSales,
          )
          const Icon = t.id === 'single-family' ? House : t.id === 'condo' ? Building2 : Layers3
          return (
            <button
              key={t.id}
              aria-pressed={p.type === t.id}
              onClick={() => p.onType(t.id)}
              className={`summary-card ${p.type === t.id ? 'selected' : ''}`}
              style={{ '--type-color': t.color } as React.CSSProperties}
            >
              <div className="summary-top">
                <span>
                  <Icon size={17} />
                  {t.label}
                </span>
                <span className={`type-indicator ${p.type === t.id ? 'checked' : ''}`}>
                  {p.type === t.id && <Check size={11} />}
                </span>
              </div>
              <div className={`summary-value ${changeClass(summary.middle)}`}>
                {summary.middle == null ? (
                  <span className="summary-na">Not enough data</span>
                ) : (
                  <>
                    {summary.middle < 0 ? <TrendingDown size={24} /> : <TrendingUp size={24} />}
                    {percent(summary.middle)}
                  </>
                )}
              </div>
              <div className="summary-bottom">
                <span>Median {p.level === 'city' ? 'city' : 'neighborhood'} change</span>
                <span>
                  {summary.ready} comparable <ArrowUpRight size={11} />
                </span>
              </div>
            </button>
          )
        })}
      </section>
      <div className="summary-caption">
        <span>
          <span className="caption-rule" />
          {p.horizon}-month change in median {p.metric === 'price' ? 'sale price' : 'price / sq ft'}{' '}
          ·{' '}
          {p.matched
            ? `Same ${shared.length} areas across all three types`
            : 'Each type uses its available sample'}
        </span>
        <label className="matched-toggle">
          <input
            type="checkbox"
            title="Use the same eligible areas across all three summary cards"
            checked={p.matched}
            onChange={(e) => p.onMatched(e.target.checked)}
          />
          Same areas for all types
        </label>
      </div>
      <section className="coverage-panel" aria-label="Data coverage and market breadth">
        <div className="coverage-summary">
          <span className="eyebrow">HOW MUCH CAN WE COMPARE?</span>
          <strong>
            <span>{coverage.ready}</span> / {coverage.total} {areas}
          </strong>
          <p>At least {p.minimumSales} sales in both reporting windows.</p>
          <div className="coverage-track" aria-hidden="true">
            <i
              style={{ width: `${coverage.total ? (coverage.ready / coverage.total) * 100 : 0}%` }}
            />
            <i
              style={{ width: `${coverage.total ? (coverage.thin / coverage.total) * 100 : 0}%` }}
            />
          </div>
        </div>
        <div className="coverage-options">
          <span className="eyebrow">EXPLORE THE DATA</span>
          <div>
            {(
              [
                { id: 'ready', label: 'Comparable', count: coverage.ready },
                { id: 'thin', label: 'Low sales', count: coverage.thin },
                { id: 'missing', label: 'Missing history', count: coverage.missing },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-pressed={p.quality === item.id}
                className={`quality-chip ${item.id} ${p.quality === item.id ? 'active' : ''}`}
                onClick={() => p.onQuality(p.quality === item.id ? 'all' : item.id)}
              >
                <i />
                {item.label}
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          <button className="coverage-help" onClick={p.onAbout}>
            <CircleHelp size={12} />
            Monthly summaries, not individual property records
          </button>
        </div>
        <div className="market-breadth">
          <span className="eyebrow">MARKET BREADTH</span>
          <div>
            {(
              [
                { id: 'rising', label: 'Rising', count: coverage.rising },
                { id: 'flat', label: 'Flat', count: coverage.flat },
                { id: 'falling', label: 'Falling', count: coverage.falling },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-pressed={p.direction === item.id}
                className={p.direction === item.id ? 'active' : ''}
                onClick={() => p.onDirection(p.direction === item.id ? 'all' : item.id)}
              >
                {item.id === 'rising' ? (
                  <ArrowUpRight size={15} />
                ) : item.id === 'falling' ? (
                  <ArrowDownRight size={15} />
                ) : (
                  <span className="flat-line" />
                )}
                <strong>{item.count}</strong>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p>
            {coverage.q1 == null
              ? 'No comparable price distribution.'
              : `Middle 50%: ${percent(coverage.q1)} to ${percent(coverage.q3)}`}
          </p>
        </div>
      </section>
    </>
  )
}
