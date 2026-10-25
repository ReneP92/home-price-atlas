import { useId, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowUpRight, ChartNoAxesCombined, Info } from 'lucide-react'
import { TYPES } from '../types'
import type { Horizon, Metric, Place, PropertyType, TrendMetric } from '../types'
import {
  compare,
  dateLabel,
  money,
  monthKey,
  observation,
  percent,
  periodLabel,
} from '../lib/market'

interface Props {
  place: Place | null
  city: Place | undefined
  metric: Metric
  horizon: Horizon
  type: PropertyType
  date: string
  minimumSales: number
  compared: Place[]
  mode: 'types' | 'areas'
  onMode: (mode: 'types' | 'areas') => void
  trend: TrendMetric
  onTrend: (metric: TrendMetric) => void
}

const METRICS: { id: TrendMetric; label: string }[] = [
  { id: 'price', label: 'Sale prices' },
  { id: 'sales', label: 'Sales volume' },
  { id: 'daysOnMarket', label: 'Days on market' },
  { id: 'inventory', label: 'Inventory' },
]

export default function AreaTrends(p: Props) {
  const [units, setUnits] = useState<'change' | 'value'>('change')
  const [cityLine, setCityLine] = useState(true)
  const [hidden, setHidden] = useState<string[]>([])
  const chartId = useId()
  const isPrice = p.trend === 'price'
  const showChange = isPrice && units === 'change'
  const field = isPrice ? p.metric : p.trend
  const baseSeries =
    p.mode === 'types'
      ? TYPES.map((t) => ({
          id: t.id,
          name: t.fullLabel,
          color: t.color,
          place: p.place,
          type: t.id,
          benchmark: false,
        }))
      : p.compared.map((place, i) => ({
          id: place.id,
          name: `${place.name}${place.kind === 'city' ? ' (city)' : `, ${place.city}`}`,
          color: TYPES[i % 3].color,
          place,
          type: p.type,
          benchmark: false,
        }))
  const series = [...baseSeries]
  if (p.mode === 'types' && cityLine && isPrice && p.place?.kind === 'neighborhood' && p.city) {
    series.push({
      id: 'city-benchmark',
      name: `${p.city.name} · ${TYPES.find((t) => t.id === p.type)?.label}`,
      color: '#7b8791',
      place: p.city,
      type: p.type,
      benchmark: true,
    })
  }
  const points = Array.from({ length: p.horizon + 1 }, (_, i) => {
    const date = `${monthKey(p.date, i - p.horizon)}-01`
    const entry: Record<string, string | number | null> = { date, label: dateLabel(date) }
    for (const s of series) {
      const current = s.place && observation(s.place, s.type, date)
      const baseline = s.place && observation(s.place, s.type, p.date, -p.horizon)
      const value = current?.[field]
      const base = baseline?.[field]
      const needsSales = isPrice || p.trend === 'daysOnMarket'
      const sufficient = !needsSales || (current?.sales != null && current.sales >= p.minimumSales)
      const baselineReady =
        baseline?.sales != null && baseline.sales >= p.minimumSales && base != null && base > 0
      entry[s.id] =
        sufficient && value != null && value >= 0 && (!isPrice || value > 0)
          ? showChange
            ? baselineReady
              ? (value / base - 1) * 100
              : null
            : value
          : null
      entry[`${s.id}_sales`] = current?.sales ?? null
    }
    return entry
  })
  const visibleSeries = series.filter((s) => !hidden.includes(s.id))
  const hasPoints = points.some((point) =>
    visibleSeries.some((s) => typeof point[s.id] === 'number'),
  )
  const latest = p.place && observation(p.place, p.type, p.date)
  const earlier = p.place && observation(p.place, p.type, p.date, -p.horizon)
  function format(value: number, compact = true) {
    return showChange
      ? percent(value)
      : isPrice
        ? money(value, compact)
        : p.trend === 'daysOnMarket'
          ? `${value} days`
          : value.toLocaleString()
  }

  return (
    <section className="trend-section" aria-labelledby={chartId}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">TRENDS OVER TIME</span>
          <h2 id={chartId}>
            {p.mode === 'areas' ? 'Compare areas' : p.place?.name || 'Choose an area'}
            <span className="heading-location">
              {p.mode === 'areas'
                ? TYPES.find((t) => t.id === p.type)?.fullLabel
                : p.place
                  ? `${p.place.city}, ${p.place.state}`
                  : ''}
            </span>
          </h2>
        </div>
        <div className="chart-actions">
          <label className="trend-metric-select">
            <select
              aria-label="Trend statistic"
              value={p.trend}
              onChange={(e) => p.onTrend(e.target.value as TrendMetric)}
            >
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {isPrice && (
            <div className="segmented small" aria-label="Chart units">
              <button
                className={units === 'change' ? 'active' : ''}
                onClick={() => setUnits('change')}
              >
                % change
              </button>
              <button
                className={units === 'value' ? 'active' : ''}
                onClick={() => setUnits('value')}
              >
                Price
              </button>
            </div>
          )}
          {p.place && (
            <a
              className="external-place"
              href={`https://www.redfin.com/${p.place.kind}/${p.place.providerId}/${p.place.state}/${encodeURIComponent(p.place.city.replaceAll(' ', '-'))}${p.place.kind === 'neighborhood' ? `/${encodeURIComponent(p.place.name.replaceAll(' ', '-'))}` : ''}`}
              target="_blank"
              rel="noreferrer"
            >
              Redfin <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </div>
      <div className="chart-tabs">
        <button onClick={() => p.onMode('types')} className={p.mode === 'types' ? 'active' : ''}>
          Compare property types
        </button>
        <button onClick={() => p.onMode('areas')} className={p.mode === 'areas' ? 'active' : ''}>
          Compare areas <span>{p.compared.length}</span>
        </button>
        {isPrice && p.place?.kind === 'neighborhood' && p.city && p.mode === 'types' && (
          <label className="city-line-toggle">
            <input
              type="checkbox"
              checked={cityLine}
              onChange={(e) => setCityLine(e.target.checked)}
            />
            City benchmark
          </label>
        )}
      </div>
      <div className="chart-layout">
        <div className="chart-main">
          <p className="chart-caption">
            {showChange
              ? `Change since ${dateLabel(`${monthKey(p.date, -p.horizon)}-01`)}`
              : isPrice
                ? p.metric === 'price'
                  ? 'Median sale price'
                  : 'Median sale price per square foot'
                : METRICS.find((m) => m.id === p.trend)?.label}
            <span>Rolling 3-month windows</span>
          </p>
          {hasPoints ? (
            <div className="trend-chart" data-testid="trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={points}
                  margin={{ top: 15, right: 24, left: 4, bottom: 4 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} stroke="#eaece7" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#87908a' }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                    tickFormatter={(label) => String(label).split(' ')[0]}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#87908a' }}
                    tickLine={false}
                    axisLine={false}
                    width={65}
                    tickFormatter={(value) =>
                      showChange ? `${Math.round(value)}%` : isPrice ? money(value) : String(value)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e7e0',
                      fontSize: 12,
                      boxShadow: '0 8px 30px #163d4312',
                    }}
                    formatter={(value, name, item) => [
                      format(Number(value), false) +
                        (isPrice
                          ? ` · ${item.payload?.[`${String(item.dataKey)}_sales`] ?? '?'} sales`
                          : ''),
                      name,
                    ]}
                    labelStyle={{ marginBottom: 8, fontWeight: 600 }}
                  />
                  {visibleSeries.map((s) => (
                    <Line
                      key={s.id}
                      name={s.name}
                      type="linear"
                      dataKey={s.id}
                      stroke={s.color}
                      strokeWidth={s.benchmark ? 1.8 : 2.5}
                      strokeDasharray={s.benchmark ? '5 5' : undefined}
                      dot={s.benchmark ? false : { r: 2.5, strokeWidth: 0, fill: s.color }}
                      activeDot={{ r: 5, stroke: 'white', strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-empty">
              <ChartNoAxesCombined size={31} />
              <strong>
                {!visibleSeries.length
                  ? p.mode === 'areas' && !p.compared.length
                    ? 'Build your comparison'
                    : 'Select a series below'
                  : 'Not enough data for this trend'}
              </strong>
              <p>
                {p.mode === 'areas' && !p.compared.length
                  ? 'Use the + button beside an area or in the map details to compare up to three.'
                  : 'Try sales volume, a broader area, or another reporting period. Missing points remain gaps.'}
              </p>
            </div>
          )}
          <div className="chart-legend interactive-legend">
            {series.map((s) => (
              <button
                key={s.id}
                aria-label={`Toggle ${s.name} chart series`}
                aria-pressed={!hidden.includes(s.id)}
                className={hidden.includes(s.id) ? 'hidden-series' : ''}
                onClick={() =>
                  setHidden((ids) =>
                    ids.includes(s.id) ? ids.filter((id) => id !== s.id) : [...ids, s.id],
                  )
                }
              >
                <i style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-detail">
          <span className="eyebrow">{TYPES.find((t) => t.id === p.type)?.fullLabel}</span>
          <div className="detail-price">
            {latest?.[field] == null
              ? 'N/A'
              : isPrice
                ? money(latest[field])
                : latest[field]?.toLocaleString()}
            {p.trend === 'daysOnMarket' && <small>days</small>}
            {isPrice && p.metric === 'ppsf' && <small>/ sq ft</small>}
          </div>
          <span className="detail-sub">
            {isPrice ? 'Median sale price' : METRICS.find((m) => m.id === p.trend)?.label}
          </span>
          <dl>
            <div>
              <dt>{p.horizon} months earlier</dt>
              <dd>
                {earlier?.[field] == null
                  ? 'N/A'
                  : isPrice
                    ? money(earlier[field])
                    : earlier[field]?.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Sales: current / prior</dt>
              <dd>
                {latest?.sales ?? '?'} / {earlier?.sales ?? '?'}
              </dd>
            </div>
            <div>
              <dt>Reporting window</dt>
              <dd>{periodLabel(latest || undefined)}</dd>
            </div>
          </dl>
          {p.place && isPrice && (
            <div className="detail-comparisons">
              {TYPES.map((t) => {
                const c = compare(p.place!, t.id, p.metric, p.horizon, p.date, p.minimumSales)
                return (
                  <div key={t.id}>
                    <span>
                      <i style={{ background: t.color }} />
                      {t.label}
                    </span>
                    <strong
                      style={{
                        color: c.change == null ? '#929992' : c.change < 0 ? '#aa6346' : '#23634e',
                      }}
                    >
                      {c.change == null
                        ? c.status === 'thin'
                          ? 'Low sales'
                          : 'N/A'
                        : percent(c.change)}
                    </strong>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <div className="chart-footnote">
        <Info size={13} />
        <span>
          {isPrice || p.trend === 'daysOnMarket'
            ? `At least ${p.minimumSales} sales per window are required for each median-based point. `
            : 'Counts are shown as reported, including zero. '}
          {isPrice
            ? 'Price changes reflect the mix of homes sold, not a same-home appreciation estimate.'
            : 'Adjacent three-month windows overlap; do not add these monthly points to calculate annual totals.'}{' '}
          Click a legend item to show or hide its line.
        </span>
      </div>
    </section>
  )
}
