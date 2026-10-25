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
import type { Dataset, Horizon, Metric, Place, PropertyType } from '../types'
import {
  compare,
  dateLabel,
  MIN_SALES,
  money,
  monthKey,
  observation,
  percent,
  periodLabel,
} from '../lib/market'

interface Props {
  place: Place | null
  dataset: Dataset
  metric: Metric
  horizon: Horizon
  type: PropertyType
  compared: Place[]
}

export default function TrendChart({ place, dataset, metric, horizon, type, compared }: Props) {
  const [mode, setMode] = useState<'types' | 'neighborhoods'>('types')
  const [units, setUnits] = useState<'change' | 'value'>('change')
  const chartId = useId()
  const series =
    mode === 'types'
      ? TYPES.map((t) => ({ id: t.id, name: t.fullLabel, color: t.color, place, type: t.id }))
      : compared.map((p, i) => ({
          id: p.id,
          name: `${p.name}, ${p.city}`,
          color: TYPES[i % TYPES.length].color,
          place: p,
          type,
        }))
  const points = Array.from({ length: horizon + 1 }, (_, i) => {
    const date = `${monthKey(dataset.dataThrough, i - horizon)}-01`
    const entry: Record<string, string | number | null> = { date, label: dateLabel(date) }
    for (const s of series) {
      const current = s.place && observation(s.place, s.type, date)
      const baseline = s.place && observation(s.place, s.type, dataset.dataThrough, -horizon)
      const value = current?.[metric]
      const base = baseline?.[metric]
      const sufficient = current?.sales != null && current.sales >= MIN_SALES
      const baselineReady =
        baseline?.sales != null && baseline.sales >= MIN_SALES && base != null && base > 0
      entry[s.id] =
        sufficient && value != null && value > 0
          ? units === 'value'
            ? value
            : baselineReady
              ? (value / base - 1) * 100
              : null
          : null
    }
    return entry
  })
  const hasPoints = points.some((p) => series.some((s) => typeof p[s.id] === 'number'))
  const latest = place && observation(place, type, dataset.dataThrough)

  return (
    <section className="trend-section" aria-labelledby={chartId}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE LOCAL PICTURE</span>
          <h2 id={chartId}>
            {place ? place.name : 'Choose a neighborhood'}
            {place && (
              <span className="heading-location">
                {place.city}, {place.state}
              </span>
            )}
          </h2>
        </div>
        <div className="chart-actions">
          <div className="segmented small" aria-label="Chart units">
            <button
              className={units === 'change' ? 'active' : ''}
              onClick={() => setUnits('change')}
            >
              % change
            </button>
            <button className={units === 'value' ? 'active' : ''} onClick={() => setUnits('value')}>
              Price
            </button>
          </div>
          {place && (
            <a
              className="external-place"
              href={`https://www.redfin.com/${place.kind}/${place.providerId}/${place.state}/${encodeURIComponent(place.city.replaceAll(' ', '-'))}${place.kind === 'neighborhood' ? `/${encodeURIComponent(place.name.replaceAll(' ', '-'))}` : ''}`}
              target="_blank"
              rel="noreferrer"
              title="View on Redfin"
            >
              Redfin <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </div>
      <div className="chart-tabs">
        <button onClick={() => setMode('types')} className={mode === 'types' ? 'active' : ''}>
          Compare property types
        </button>
        <button
          onClick={() => setMode('neighborhoods')}
          className={mode === 'neighborhoods' ? 'active' : ''}
        >
          Compare neighborhoods <span>{compared.length}</span>
        </button>
      </div>
      <div className="chart-layout">
        <div className="chart-main">
          <p className="chart-caption">
            {units === 'change'
              ? `Change since ${dateLabel(`${monthKey(dataset.dataThrough, -horizon)}-01`)}`
              : metric === 'price'
                ? 'Median sale price'
                : 'Median sale price per square foot'}
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
                    width={60}
                    tickFormatter={(v) => (units === 'change' ? `${Math.round(v)}%` : money(v))}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e7e0',
                      fontSize: 12,
                      boxShadow: '0 8px 30px #163d4312',
                    }}
                    formatter={(value, name) => [
                      units === 'change' ? percent(Number(value)) : money(Number(value), false),
                      name,
                    ]}
                    labelStyle={{ marginBottom: 8, fontWeight: 600 }}
                  />
                  {series.map((s) => (
                    <Line
                      key={s.id}
                      name={s.name}
                      type="linear"
                      dataKey={s.id}
                      stroke={s.color}
                      strokeWidth={2.5}
                      dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
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
                {mode === 'neighborhoods' && !compared.length
                  ? 'Build your comparison'
                  : 'Not enough comparable sales'}
              </strong>
              <p>
                {mode === 'neighborhoods' && !compared.length
                  ? 'Use the + button beside a neighborhood to compare up to three.'
                  : 'Try another property type, time window, or neighborhood. Gaps stay visible rather than being estimated.'}
              </p>
            </div>
          )}
          <div className="chart-legend">
            {series.map((s) => (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
        <div className="chart-detail">
          <span className="eyebrow">{TYPES.find((t) => t.id === type)?.fullLabel}</span>
          <div className="detail-price">
            {money(latest?.[metric])}
            {metric === 'ppsf' && <small>/ sq ft</small>}
          </div>
          <span className="detail-sub">
            Median sale {metric === 'price' ? 'price' : 'price per sq ft'}
          </span>
          <dl>
            <div>
              <dt>Homes sold</dt>
              <dd>{latest?.sales ?? 'N/A'}</dd>
            </div>
            <div>
              <dt>Days on market</dt>
              <dd>{latest?.daysOnMarket ?? 'N/A'}</dd>
            </div>
            <div>
              <dt>Reporting window</dt>
              <dd>{periodLabel(latest || undefined)}</dd>
            </div>
          </dl>
          {place && (
            <div className="detail-comparisons">
              {TYPES.map((t) => {
                const c = compare(place, t.id, metric, horizon, dataset.dataThrough)
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
          At least {MIN_SALES} sales per window are required to draw a point. Price changes reflect
          the mix of homes sold, not a same-home appreciation estimate.
        </span>
      </div>
    </section>
  )
}
