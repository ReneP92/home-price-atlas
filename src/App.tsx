import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  House,
  Layers3,
  List,
  Map,
  MapPin,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { TYPES } from './types'
import type { Catalog, Dataset, Horizon, Metric, Place, PropertyType } from './types'
import {
  changeClass,
  compare,
  defaultPlace,
  dateLabel,
  exportRows,
  median,
  MIN_SALES,
  money,
  percent,
} from './lib/market'
import TrendChart from './components/TrendChart'

const MarketMap = lazy(() => import('./components/MarketMap'))
const BASE = import.meta.env.BASE_URL
const REPO = 'https://github.com/ReneP92/home-price-atlas'

function Brand() {
  return (
    <a className="brand" href={BASE} aria-label="Home Price Atlas home">
      <span className="brand-symbol">
        <House size={21} strokeWidth={1.7} />
        <span className="brand-bars">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span>
        homeprice<span className="brand-atlas">atlas</span>
        <span className="brand-beta">BETA</span>
      </span>
    </a>
  )
}

export default function App() {
  const [regionId, setRegionId] = useState(new URLSearchParams(location.search).get('region') || '')
  const [attempt, setAttempt] = useState(0)
  const [resource, setResource] = useState<{
    catalog: Catalog | null
    dataset: Dataset | null
    error: string | null
  }>({ catalog: null, dataset: null, error: null })
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const catalogResponse = await fetch(`${BASE}data/catalog.json`, {
          signal: controller.signal,
        })
        if (!catalogResponse.ok)
          throw new Error('The region catalog is unavailable. Run the data importer or try again.')
        const catalog: Catalog = await catalogResponse.json()
        const chosen = catalog.regions.find(
          (r) => r.id === (regionId || catalog.defaultRegion) && r.available,
        )
        if (!chosen)
          throw new Error(
            'This region does not have a published snapshot yet. Return to the default region.',
          )
        const response = await fetch(`${BASE}data/${chosen.id}.json`, { signal: controller.signal })
        if (!response.ok)
          throw new Error('The market snapshot could not be loaded. Please try again.')
        const dataset: Dataset = await response.json()
        if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.regions) || !dataset.dataThrough)
          throw new Error('This snapshot uses an unsupported data format.')
        if (!controller.signal.aborted) setResource({ catalog, dataset, error: null })
      } catch (error) {
        if (!controller.signal.aborted)
          setResource({
            catalog: null,
            dataset: null,
            error: error instanceof Error ? error.message : 'Unable to load market data.',
          })
      }
    }
    void load()
    return () => controller.abort()
  }, [regionId, attempt])

  if (!resource.dataset || !resource.catalog)
    return (
      <div className="app-loading">
        <Brand />
        <div className="loading-center">
          {resource.error ? (
            <>
              <CircleHelp size={36} />
              <h1>Let’s get the data back.</h1>
              <p>{resource.error}</p>
              <button
                className="primary-button"
                onClick={() => {
                  setResource({ catalog: null, dataset: null, error: null })
                  setRegionId('')
                  setAttempt((n) => n + 1)
                }}
              >
                Try again <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <span className="loader" />
              <h1>A closer look is on its way.</h1>
              <p>Loading the latest neighborhood snapshot…</p>
            </>
          )}
        </div>
      </div>
    )
  return (
    <Dashboard
      key={resource.dataset.id}
      dataset={resource.dataset}
      catalog={resource.catalog}
      onRegion={(id) => {
        setResource({ catalog: null, dataset: null, error: null })
        setRegionId(id)
      }}
    />
  )
}

function Dashboard({
  dataset,
  catalog,
  onRegion,
}: {
  dataset: Dataset
  catalog: Catalog
  onRegion: (id: string) => void
}) {
  const initial = new URLSearchParams(location.search)
  const [type, setType] = useState<PropertyType>(() =>
    TYPES.some((t) => t.id === initial.get('type'))
      ? (initial.get('type') as PropertyType)
      : 'single-family',
  )
  const [horizon, setHorizon] = useState<Horizon>(() =>
    [3, 6, 12].includes(Number(initial.get('months')))
      ? (Number(initial.get('months')) as Horizon)
      : 12,
  )
  const [metric, setMetric] = useState<Metric>(initial.get('metric') === 'ppsf' ? 'ppsf' : 'price')
  const [city, setCity] = useState(() =>
    dataset.regions.some((r) => r.kind === 'city' && r.cityId === initial.get('city'))
      ? initial.get('city')!
      : '',
  )
  const [query, setQuery] = useState(initial.get('q') || '')
  const [sort, setSort] = useState(() =>
    ['name', 'rising', 'falling', 'sales'].includes(initial.get('sort') || '')
      ? initial.get('sort')!
      : 'sales',
  )
  const [view, setView] = useState<'map' | 'list'>(initial.get('view') === 'list' ? 'list' : 'map')
  const [showSaved, setShowSaved] = useState(false)
  const [onlyComparable, setOnlyComparable] = useState(initial.get('eligible') === '1')
  const [selectedId, setSelectedId] = useState(
    () => initial.get('place') || defaultPlace(dataset.regions, dataset.dataThrough)?.id || '',
  )
  const [comparedIds, setComparedIds] = useState<string[]>(() =>
    [...new Set((initial.get('compare') || '').split(','))]
      .filter((id) => dataset.regions.some((r) => r.id === id))
      .slice(0, 3),
  )
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem('hpa-saved') || '[]')
      return Array.isArray(data) ? data.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  })
  const [toast, setToast] = useState('')
  const [loadedAt] = useState(() => Date.now())
  const [regionMenu, setRegionMenu] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const chartAnchor = useRef<HTMLDivElement>(null)
  const cities = useMemo(() => dataset.regions.filter((r) => r.kind === 'city'), [dataset])
  const neighborhoods = useMemo(
    () => dataset.regions.filter((r) => r.kind === 'neighborhood'),
    [dataset],
  )
  const scoped = useMemo(
    () =>
      neighborhoods.filter(
        (r) =>
          (!city || r.cityId === city) &&
          (!showSaved || savedIds.includes(r.id)) &&
          (!query.trim() ||
            `${r.name} ${r.city}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [neighborhoods, city, showSaved, savedIds, query],
  )
  const filtered = useMemo(
    () =>
      scoped
        .filter(
          (r) =>
            !onlyComparable ||
            compare(r, type, metric, horizon, dataset.dataThrough).status === 'ready',
        )
        .sort((a, b) => {
          if (sort === 'name') return a.city.localeCompare(b.city) || a.name.localeCompare(b.name)
          const ac = compare(a, type, metric, horizon, dataset.dataThrough)
          const bc = compare(b, type, metric, horizon, dataset.dataThrough)
          const av = ac.change
          const bv = bc.change
          if (av === null) return bv === null ? a.name.localeCompare(b.name) : 1
          if (bv === null) return -1
          if (sort === 'sales')
            return (
              Math.min(bc.current!.sales!, bc.previous!.sales!) -
                Math.min(ac.current!.sales!, ac.previous!.sales!) || a.name.localeCompare(b.name)
            )
          return sort === 'rising' ? bv - av : av - bv
        }),
    [scoped, onlyComparable, type, metric, horizon, dataset.dataThrough, sort],
  )
  const selected =
    filtered.find((r) => r.id === selectedId) ||
    filtered.find(
      (r) => compare(r, type, metric, horizon, dataset.dataThrough).status === 'ready',
    ) ||
    filtered[0] ||
    null
  const compared = comparedIds
    .map((id) => dataset.regions.find((r) => r.id === id))
    .filter((r): r is Place => !!r)
  const comparableCount = scoped.filter(
    (r) => compare(r, type, metric, horizon, dataset.dataThrough).status === 'ready',
  ).length
  const activeCity = cities.find((c) => c.cityId === city)
  const daysOld = (loadedAt - new Date(dataset.dataThrough).getTime()) / 86_400_000

  useEffect(() => {
    const params = new URLSearchParams({
      region: dataset.id,
      type,
      months: String(horizon),
      metric,
      sort,
      view,
    })
    if (city) params.set('city', city)
    if (query) params.set('q', query)
    if (selected) params.set('place', selected.id)
    if (comparedIds.length) params.set('compare', comparedIds.join(','))
    if (onlyComparable) params.set('eligible', '1')
    history.replaceState(null, '', `${location.pathname}?${params}`)
  }, [
    dataset.id,
    type,
    horizon,
    metric,
    city,
    query,
    selected,
    comparedIds,
    onlyComparable,
    sort,
    view,
  ])
  useEffect(() => {
    try {
      localStorage.setItem('hpa-saved', JSON.stringify(savedIds))
    } catch {
      /* Browsing works in storage-restricted contexts. */
    }
  }, [savedIds])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  function toggleCompared(id: string) {
    if (comparedIds.includes(id)) setComparedIds((ids) => ids.filter((x) => x !== id))
    else if (comparedIds.length < 3) {
      setComparedIds((ids) => [...ids, id])
      setToast('Added to neighborhood comparison')
    } else setToast('You can compare up to three neighborhoods. Remove one to add another.')
  }
  function reset() {
    setCity('')
    setQuery('')
    setShowSaved(false)
    setOnlyComparable(false)
    setSort('sales')
  }
  function download() {
    const blob = new Blob([exportRows(filtered, type, metric, horizon, dataset.dataThrough)], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `home-price-atlas-${dataset.id}-${type}-${horizon}mo.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <button className={!showSaved ? 'active' : ''} onClick={() => setShowSaved(false)}>
              Explore
            </button>
            <button className={showSaved ? 'active' : ''} onClick={() => setShowSaved(true)}>
              Saved{savedIds.length > 0 && <span className="nav-count">{savedIds.length}</span>}
            </button>
            <button onClick={() => dialog.current?.showModal()}>
              About the data <ArrowUpRight size={12} />
            </button>
          </nav>
          <a className="github-link" href={REPO} target="_blank" rel="noreferrer">
            Open source <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main className="page">
        <div className="intro">
          <div>
            <div className="eyebrow intro-eyebrow">
              <span />
              NEIGHBORHOOD MARKET EXPLORER
            </div>
            <h1>
              A closer look at the market<span>.</span>
            </h1>
            <p>Find the local patterns behind the headlines. One neighborhood at a time.</p>
          </div>
          <div className="region-picker">
            <button
              className="region-button"
              aria-expanded={regionMenu}
              onClick={() => setRegionMenu(!regionMenu)}
            >
              <span className="region-icon">
                <MapPin size={19} />
              </span>
              <span>
                <small>EXPLORING</small>
                <strong>{dataset.name}</strong>
              </span>
              <ChevronDown size={15} />
            </button>
            {regionMenu && (
              <div className="region-menu">
                <span className="eyebrow">YOUR REGIONS</span>
                {catalog.regions.map((r) => (
                  <button
                    key={r.id}
                    disabled={!r.available}
                    onClick={() => {
                      setRegionMenu(false)
                      if (r.id !== dataset.id) onRegion(r.id)
                    }}
                  >
                    <span>
                      <strong>{r.name}</strong>
                      <small>{r.description}</small>
                    </span>
                    {r.id === dataset.id && <Check size={16} />}
                  </button>
                ))}
                <a href={`${REPO}#adding-another-us-region`} target="_blank" rel="noreferrer">
                  Add another US region <ArrowUpRight size={13} />
                </a>
              </div>
            )}
            <span className="data-freshness">
              <span />
              Data through {dateLabel(dataset.dataThrough)}
              <button
                aria-label="Data freshness details"
                onClick={() => dialog.current?.showModal()}
              >
                <CircleHelp size={12} />
              </button>
            </span>
          </div>
        </div>
        {daysOld > 75 && (
          <div className="stale-banner">
            You’re viewing the latest imported snapshot, through {dateLabel(dataset.dataThrough)}.
            Refresh the data to bring this view up to date.
          </div>
        )}

        <section className="summary-grid" aria-label="Compare home types">
          {TYPES.map((t) => {
            const changes = scoped
              .map((r) => compare(r, t.id, metric, horizon, dataset.dataThrough).change)
              .filter((c): c is number => c !== null)
            const middle = median(changes)
            const Icon = t.id === 'single-family' ? House : t.id === 'condo' ? Building2 : Layers3
            return (
              <button
                key={t.id}
                aria-pressed={type === t.id}
                onClick={() => setType(t.id)}
                className={`summary-card ${type === t.id ? 'selected' : ''}`}
                style={{ '--type-color': t.color } as React.CSSProperties}
              >
                <div className="summary-top">
                  <span>
                    <Icon size={17} />
                    {t.label}
                  </span>
                  <span className={`type-indicator ${type === t.id ? 'checked' : ''}`}>
                    {type === t.id && <Check size={11} />}
                  </span>
                </div>
                <div className={`summary-value ${changeClass(middle)}`}>
                  {middle === null ? (
                    <span className="summary-na">Not enough data</span>
                  ) : (
                    <>
                      {middle < 0 ? <TrendingDown size={24} /> : <TrendingUp size={24} />}
                      {percent(middle)}
                    </>
                  )}
                </div>
                <div className="summary-bottom">
                  <span>Median neighborhood change</span>
                  <span>
                    {changes.length} areas <ArrowUpRight size={11} />
                  </span>
                </div>
              </button>
            )
          })}
        </section>
        <div className="summary-caption">
          <span>
            <span className="caption-rule" />
            {horizon}-month change in median{' '}
            {metric === 'price' ? 'sale price' : 'sale price / sq ft'} · Unweighted across
            comparable neighborhoods
          </span>
          <button onClick={() => dialog.current?.showModal()}>
            <CircleHelp size={12} />
            How we calculate this
          </button>
        </div>

        <section className="explore-section" aria-label="Explore neighborhoods">
          <div className="explore-header">
            <div>
              <h2>
                {showSaved ? 'Your saved neighborhoods' : 'Explore the neighborhood'}
                <span className="count-badge">{filtered.length}</span>
              </h2>
              <p>
                {activeCity ? `${activeCity.name}, ${activeCity.state}` : dataset.description}{' '}
                <span> / </span> {TYPES.find((t) => t.id === type)?.fullLabel}
              </p>
            </div>
            <div className="explore-actions">
              <button
                className="text-button"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(location.href)
                    .then(() => setToast('Link copied. Your filters and comparisons are included.'))
                    .catch(() => setToast('Copy the address in your browser to share this view.'))
                  if (!navigator.clipboard)
                    setToast('Copy the address in your browser to share this view.')
                }}
              >
                <Share2 size={14} />
                Share view
              </button>
              <button className="outline-button" onClick={download}>
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>
          <div className="toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search neighborhoods or cities"
                type="search"
                placeholder="Search neighborhoods or cities…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="select-wrap city-select">
              <MapPin size={14} />
              <select
                aria-label="Filter by city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="">All cities</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.cityId}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="select-wrap metric-select">
              <select
                aria-label="Price metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                <option value="price">Sale price</option>
                <option value="ppsf">Price / sq ft</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <div className="segmented period-switch" aria-label="Comparison period">
              {([3, 6, 12] as Horizon[]).map((n) => (
                <button
                  key={n}
                  aria-pressed={horizon === n}
                  onClick={() => setHorizon(n)}
                  className={horizon === n ? 'active' : ''}
                >
                  {n}M
                </button>
              ))}
            </div>
            <div className="segmented view-switch" aria-label="Display mode">
              <button
                aria-label="Map view"
                aria-pressed={view === 'map'}
                onClick={() => setView('map')}
                className={view === 'map' ? 'active' : ''}
              >
                <Map size={15} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={view === 'list' ? 'active' : ''}
              >
                <List size={16} />
              </button>
            </div>
          </div>
          <div className={`workspace ${view === 'list' ? 'list-only' : ''}`}>
            {view === 'map' && (
              <Suspense
                fallback={
                  <div className="map-shell map-skeleton">
                    <MapPin size={28} />
                    <span>Opening the atlas…</span>
                  </div>
                }
              >
                <MarketMap
                  dataset={dataset}
                  places={filtered}
                  type={type}
                  metric={metric}
                  horizon={horizon}
                  city={city}
                  selected={selected}
                  onSelect={(r) => setSelectedId(r.id)}
                  onCity={setCity}
                />
              </Suspense>
            )}
            <div className="directory">
              <div className="directory-header">
                <span>{filtered.length} neighborhoods</span>
                <label>
                  <ArrowDownUp size={12} />
                  <select
                    aria-label="Sort neighborhoods"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="sales">Most comparable sales</option>
                    <option value="name">By city & name</option>
                    <option value="rising">Biggest increases</option>
                    <option value="falling">Biggest decreases</option>
                  </select>
                </label>
              </div>
              <div className="directory-column-head">
                <span>NEIGHBORHOOD</span>
                <span>{horizon}-MO CHANGE</span>
              </div>
              <div className="directory-rows" data-testid="neighborhood-list">
                {filtered.map((place) => {
                  const c = compare(place, type, metric, horizon, dataset.dataThrough)
                  const isCompared = comparedIds.includes(place.id)
                  return (
                    <div
                      key={place.id}
                      className={`place-row ${selected?.id === place.id ? 'selected' : ''}`}
                    >
                      <button
                        className="place-main"
                        onClick={() => setSelectedId(place.id)}
                        aria-pressed={selected?.id === place.id}
                      >
                        <span className="place-info">
                          <strong>{place.name}</strong>
                          <span>
                            {place.city}
                            <i />
                            {money(c.current?.[metric])}
                            {metric === 'ppsf' ? ' / ft²' : ''}
                          </span>
                        </span>
                        <span className={`place-change ${changeClass(c.change)}`}>
                          {c.change == null ? (
                            <small>{c.status === 'thin' ? 'Low sales' : 'No comparison'}</small>
                          ) : (
                            <>
                              {percent(c.change)}
                              <small>{c.current?.sales} sales</small>
                            </>
                          )}
                        </span>
                      </button>
                      <button
                        className={`compare-place ${isCompared ? 'is-compared' : ''}`}
                        aria-label={`${isCompared ? 'Remove' : 'Add'} ${place.name} ${isCompared ? 'from' : 'to'} comparison`}
                        title="Compare neighborhood"
                        onClick={() => toggleCompared(place.id)}
                      >
                        {isCompared ? <Check size={13} /> : <Plus size={13} />}
                      </button>
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div className="empty-directory">
                    <Search size={27} />
                    <strong>
                      {showSaved ? 'No saved neighborhoods here yet' : 'No neighborhoods found'}
                    </strong>
                    <p>
                      {showSaved
                        ? 'Save a neighborhood from its detail panel to find it here.'
                        : 'Try another search or city, or include neighborhoods with limited data.'}
                    </p>
                    <button className="text-button" onClick={reset}>
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
                    checked={onlyComparable}
                    onChange={(e) => setOnlyComparable(e.target.checked)}
                  />
                  Comparable sales only
                </label>
                <span>
                  {comparableCount}/{scoped.length}
                </span>
              </div>
            </div>
          </div>
          <div className="explore-bottom">
            <span>
              <span className="legend-neutral" />
              Low sales = fewer than {MIN_SALES} sales in either comparison window.
            </span>
            {(city || query || showSaved || onlyComparable) && (
              <button onClick={reset}>
                Reset filters <X size={12} />
              </button>
            )}
            <a
              href="#local-picture"
              onClick={() =>
                chartAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Explore the local picture <ArrowDown size={12} />
            </a>
          </div>
        </section>

        <div ref={chartAnchor} id="local-picture" className="local-picture">
          <div className="selection-strip">
            <span>
              <Sparkles size={14} />
              {selected
                ? `Taking a closer look at ${selected.name}`
                : 'Select a neighborhood to get started'}
            </span>
            {selected && (
              <button
                className={savedIds.includes(selected.id) ? 'saved' : ''}
                onClick={() =>
                  setSavedIds((ids) =>
                    ids.includes(selected.id)
                      ? ids.filter((id) => id !== selected.id)
                      : [...ids, selected.id],
                  )
                }
              >
                <Bookmark
                  size={13}
                  fill={savedIds.includes(selected.id) ? 'currentColor' : 'none'}
                />
                {savedIds.includes(selected.id) ? 'Saved neighborhood' : 'Save neighborhood'}
              </button>
            )}
          </div>
          <TrendChart
            place={selected}
            dataset={dataset}
            type={type}
            horizon={horizon}
            metric={metric}
            compared={compared}
          />
          {compared.length > 0 && (
            <div className="comparison-tray">
              <span>COMPARING</span>
              {compared.map((p) => (
                <button key={p.id} onClick={() => toggleCompared(p.id)}>
                  {p.name}
                  <X size={12} />
                </button>
              ))}
              <span className="comparison-tray-hint">{compared.length}/3 neighborhoods</span>
            </div>
          )}
        </div>
        <footer className="page-footer">
          <div>
            <span className="footer-mark">
              <House size={14} />
            </span>
            <strong>Better context. More informed decisions.</strong>
            <span>Built with open tools and public data.</span>
          </div>
          <div>
            <a href="https://www.redfin.com/news/data-center/" target="_blank" rel="noreferrer">
              Data by Redfin <ArrowUpRight size={11} />
            </a>
            <button onClick={() => dialog.current?.showModal()}>Sources & methodology</button>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={11} />
            </a>
          </div>
        </footer>
      </main>
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
      <dialog ref={dialog} className="methodology-dialog">
        <div className="dialog-top">
          <span className="eyebrow">TRANSPARENT BY DESIGN</span>
          <button aria-label="Close data information" onClick={() => dialog.current?.close()}>
            <X size={20} />
          </button>
        </div>
        <h2>A little context goes a long way.</h2>
        <p>
          Home Price Atlas makes free housing data easier to explore. Here’s exactly what you’re
          looking at.
        </p>
        <div className="methodology-grid">
          <article>
            <h3>Sale prices, not appraisals</h3>
            <p>
              Changes compare median prices of homes sold in two rolling three-month windows.
              Different homes sell in each window. These are market signals, not estimates of how
              much a particular home appreciated. Price per square foot also remains sensitive to
              the mix of homes sold.
            </p>
          </article>
          <article>
            <h3>Three distinct source categories</h3>
            <p>
              We preserve Redfin’s Single Family Residential, Condo/Co-op, and Townhouse groups.
              “Condos” includes co-ops. Aggregate data cannot resolve townhouse-style condominiums
              or reclassify individual homes.
            </p>
          </article>
          <article>
            <h3>Small samples stay visible</h3>
            <p>
              Comparisons require at least {MIN_SALES} sales and valid prices in both periods. This
              is a screening rule, not a statistical confidence interval. Missing data is never
              filled with zero or borrowed from another property type. Summary cards show the
              unweighted median of eligible neighborhood changes.
            </p>
          </article>
          <article>
            <h3>Map locations have limits</h3>
            <p>
              The overview uses city-level metrics. Neighborhood points are approximate reference
              locations, matched by unique city and name to the EPA-hosted Zillow 2017 dataset. They
              are not Redfin boundaries. Neighborhoods without a match remain in the directory; no
              price is inferred from a point or nearby area.
            </p>
          </article>
          <article>
            <h3>One consistent reporting window</h3>
            <p>
              Current period: {dateLabel(dataset.dataThrough, 'long')}. Source updated:{' '}
              {dataset.sourceUpdatedAt.slice(0, 10)}. Imported: {dataset.generatedAt.slice(0, 10)}.
              All comparisons use this imported release; historical values may change when Redfin
              revises its source.
            </p>
          </article>
          <article>
            <h3>Free data, region by region</h3>
            <p>
              This release covers {dataset.description}. More US areas can be added through the
              region configuration. Available neighborhoods, classifications, and reporting depth
              depend on source coverage.
            </p>
          </article>
        </div>
        <div className="source-links">
          <a
            href="https://www.redfin.com/news/data-center/methodology/"
            target="_blank"
            rel="noreferrer"
          >
            Redfin methodology <ArrowUpRight size={14} />
          </a>
          <a
            href="https://www.redfin.com/news/data-center/downloads/"
            target="_blank"
            rel="noreferrer"
          >
            Redfin downloads <ArrowUpRight size={14} />
          </a>
          <a
            href="https://www.arcgis.com/home/item.html?id=56b89613f9f7450fb44e857691a244e7"
            target="_blank"
            rel="noreferrer"
          >
            Reference locations: Zillow / EPA <ArrowUpRight size={14} />
          </a>
          <a href={`${REPO}#data-and-methodology`} target="_blank" rel="noreferrer">
            Importer & calculations <ArrowUpRight size={14} />
          </a>
        </div>
        <button className="primary-button" onClick={() => dialog.current?.close()}>
          Back to exploring <ArrowRight size={15} />
        </button>
      </dialog>
    </>
  )
}
