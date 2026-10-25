import { ArrowRight, BarChart3, Boxes, CalendarRange, Clock3, Info } from 'lucide-react'
import type { Horizon, Metric, Place, PropertyType, TrendMetric } from '../types'
import { compare, dateLabel, money, observation, percent, periodLabel } from '../lib/market'
import { annualSales, benchmarkGap, percentChange } from '../lib/statistics'

interface Props {
  place: Place
  city: Place | undefined
  type: PropertyType
  metric: Metric
  horizon: Horizon
  date: string
  minimumSales: number
  onCity: (city: Place) => void
  onTrend: (metric: TrendMetric) => void
}

export default function PlaceStatistics(p: Props) {
  const c = compare(p.place, p.type, p.metric, p.horizon, p.date, p.minimumSales)
  const annual = annualSales(p.place, p.type, p.date)
  const priorAnnual = annualSales(p.place, p.type, p.date, 1)
  const annualChange = percentChange(annual.total, priorAnnual.total)
  const salesChange = percentChange(c.current?.sales, c.previous?.sales)
  const inventoryChange = percentChange(c.current?.inventory, c.previous?.inventory)
  const domReady =
    c.current?.sales != null &&
    c.previous?.sales != null &&
    c.current.sales >= p.minimumSales &&
    c.previous.sales >= p.minimumSales
  const domChange =
    domReady && c.current?.daysOnMarket != null && c.previous?.daysOnMarket != null
      ? c.current.daysOnMarket - c.previous.daysOnMarket
      : null
  const benchmark = benchmarkGap(
    p.place,
    p.city,
    p.type,
    p.metric,
    p.horizon,
    p.date,
    p.minimumSales,
  )
  const cityPoint = p.city && observation(p.city, p.type, p.date)
  return (
    <section className="place-statistics" aria-label="Selected area statistics">
      <div className="stats-heading">
        <span className="eyebrow">{p.place.name.toUpperCase()} · ACTIVITY & CONTEXT</span>
        <span>{periodLabel(c.current)}</span>
      </div>
      <div className="stat-cards">
        <article>
          <span>
            <CalendarRange size={16} />
            Sales in the last 12 months
          </span>
          <strong data-testid="annual-sales">
            {annual.total == null ? 'Incomplete' : annual.total.toLocaleString()}
          </strong>
          <p>
            {annualChange == null
              ? `${annual.available}/4 quarters reported${priorAnnual.total != null ? ` · prior year: ${priorAnnual.total}` : ''}`
              : `${percent(annualChange)} vs prior year (${priorAnnual.total} sales)`}
          </p>
          <details>
            <summary>See quarter counts</summary>
            <ol>
              {annual.windows.map((point, i) => (
                <li key={i}>
                  <span>{point ? periodLabel(point) : 'Unreported quarter'}</span>
                  <b>{point?.sales ?? 'N/A'}</b>
                </li>
              ))}
            </ol>
            <small>Four non-overlapping windows; never a sum of monthly rolling totals.</small>
          </details>
        </article>
        <article>
          <span>
            <BarChart3 size={16} />
            Sales in this window
          </span>
          <strong>{c.current?.sales ?? 'N/A'}</strong>
          <p>
            {salesChange == null
              ? 'Prior-period comparison unavailable'
              : `${percent(salesChange)} vs ${p.horizon} months earlier`}
          </p>
          <small>{c.previous?.sales ?? 'N/A'} sales in the comparison window</small>
        </article>
        <article>
          <span>
            <Clock3 size={16} />
            Median days on market
          </span>
          <strong>
            {c.current?.daysOnMarket ?? 'N/A'}
            {c.current?.daysOnMarket != null && <em>days</em>}
          </strong>
          <p>
            {domChange == null
              ? 'Not enough data for a speed comparison'
              : domChange === 0
                ? 'Unchanged from the comparison period'
                : `${Math.abs(domChange).toFixed(0)} days ${domChange < 0 ? 'faster' : 'slower'} than ${p.horizon} months earlier`}
          </p>
          <small>Based on this three-month sales window</small>
        </article>
        <article>
          <span>
            <Boxes size={16} />
            Reported inventory
          </span>
          <strong>{c.current?.inventory ?? 'N/A'}</strong>
          <p>
            {inventoryChange == null
              ? 'Prior-period comparison unavailable'
              : `${percent(inventoryChange)} vs ${p.horizon} months earlier`}
          </p>
          <small>Source-reported inventory for the window</small>
        </article>
      </div>
      {p.city && p.place.kind === 'neighborhood' && (
        <div className="benchmark-strip">
          <div>
            <Info size={16} />
            <span>
              <strong>
                {benchmark.gap == null
                  ? 'Citywide context for a limited local comparison'
                  : Math.abs(benchmark.gap) < 0.05
                    ? 'In line with the city’s price change'
                    : `${Math.abs(benchmark.gap).toFixed(1)} percentage points ${benchmark.gap >= 0 ? 'above' : 'below'} the city`}
              </strong>
              <small>
                {p.city.name} {p.horizon}-month change:{' '}
                {benchmark.benchmark?.change == null
                  ? 'unavailable'
                  : percent(benchmark.benchmark.change)}{' '}
                · {cityPoint?.sales ?? 'N/A'} citywide sales · {money(cityPoint?.[p.metric])}
                {p.metric === 'ppsf' ? ' / sq ft' : ''}
              </small>
            </span>
          </div>
          <button onClick={() => p.onCity(p.city!)}>
            View {p.city.name} statistics <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="stat-trend-links">
        <span>Explore over time:</span>
        <button onClick={() => p.onTrend('sales')}>
          Sales volume <ArrowRight size={12} />
        </button>
        <button onClick={() => p.onTrend('daysOnMarket')}>
          Market speed <ArrowRight size={12} />
        </button>
        <button onClick={() => p.onTrend('inventory')}>
          Inventory <ArrowRight size={12} />
        </button>
      </div>
      <p className="stats-footnote">
        As of {dateLabel(p.date)}. Annual totals require all four quarters; a missing count is not
        treated as zero. Neighborhoods may overlap, so their sales are never summed into a city
        total.
      </p>
    </section>
  )
}
