import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  House,
  List,
  Map as MapIcon,
  MapPin,
  Search,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import { TYPES } from './types'
import type {
  AreaLevel,
  Catalog,
  Dataset,
  DirectionFilter,
  Horizon,
  MapBounds,
  MapFocus,
  MapLayer,
  Metric,
  Place,
  PropertyType,
  QualityFilter,
  TrendMetric,
} from './types'
import { compare, dateLabel, defaultPlace } from './lib/market'
import {
  exportStatistics,
  matchesDirection,
  parseMapBounds,
  reportingDates,
} from './lib/statistics'
import { boundaryInBounds } from './lib/boundaries'
import MarketOverview from './components/MarketOverview'
import Timeline from './components/Timeline'
import AreaDirectory from './components/AreaDirectory'
import PlaceStatistics from './components/PlaceStatistics'
import AreaTrends from './components/AreaTrends'
import Methodology from './components/Methodology'

const InteractiveMap = lazy(() => import('./components/InteractiveMap'))
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

export default function Explorer() {
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
        const response = await fetch(`${BASE}data/catalog.json`, { signal: controller.signal })
        if (!response.ok)
          throw new Error('The region catalog is unavailable. Run the data importer or try again.')
        const catalog: Catalog = await response.json()
        const chosen = catalog.regions.find(
          (r) => r.id === (regionId || catalog.defaultRegion) && r.available,
        )
        if (!chosen)
          throw new Error(
            'This region does not have a published snapshot yet. Return to the default region.',
          )
        const snapshot = await fetch(`${BASE}data/${chosen.id}.json`, { signal: controller.signal })
        if (!snapshot.ok)
          throw new Error('The market snapshot could not be loaded. Please try again.')
        const dataset: Dataset = await snapshot.json()
        if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.regions) || !dataset.dataThrough)
          throw new Error('This snapshot uses an unsupported data format.')
        try {
          const response = await fetch(`${BASE}data/${chosen.id}-boundaries.geojson`, {
            signal: controller.signal,
          })
          if (response.ok) {
            const boundaries = await response.json()
            if (
              boundaries.type === 'FeatureCollection' &&
              boundaries.schemaVersion === 1 &&
              boundaries.region === chosen.id &&
              Array.isArray(boundaries.features)
            )
              dataset.boundaries = boundaries
          }
        } catch {
          // Market data remains usable if a region has no boundary snapshot.
        }
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
              <p>Loading the latest market snapshot…</p>
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
  const initialBounds = parseMapBounds(initial.get('bbox'))
  const dates = useMemo(() => reportingDates(dataset), [dataset])
  const [level, setLevel] = useState<AreaLevel>(() =>
    initial.get('level') === 'neighborhood' ||
    (!initial.has('level') &&
      (initial.has('city') || initial.get('place')?.startsWith('neighborhood-')))
      ? 'neighborhood'
      : 'city',
  )
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
  const [date, setDate] = useState(
    () =>
      dates.find((d) => d.slice(0, 7) === initial.get('asof')?.slice(0, 7)) || dataset.dataThrough,
  )
  const [minimumSales, setMinimumSales] = useState(() =>
    [5, 10, 20].includes(Number(initial.get('minsales'))) ? Number(initial.get('minsales')) : 5,
  )
  const [city, setCity] = useState(() =>
    dataset.regions.some((r) => r.kind === 'city' && r.cityId === initial.get('city'))
      ? initial.get('city')!
      : '',
  )
  const [query, setQuery] = useState(initial.get('q') || '')
  const [quality, setQuality] = useState<QualityFilter>(() =>
    ['ready', 'thin', 'missing'].includes(initial.get('quality') || '')
      ? (initial.get('quality') as QualityFilter)
      : initial.get('eligible') === '1'
        ? 'ready'
        : 'all',
  )
  const [direction, setDirection] = useState<DirectionFilter>(() =>
    ['rising', 'falling', 'flat'].includes(initial.get('direction') || '')
      ? (initial.get('direction') as DirectionFilter)
      : 'all',
  )
  const [sort, setSort] = useState(() =>
    ['name', 'rising', 'falling', 'sales'].includes(initial.get('sort') || '')
      ? initial.get('sort')!
      : 'sales',
  )
  const [view, setView] = useState<'map' | 'list'>(initial.get('view') === 'list' ? 'list' : 'map')
  const [mapLayer, setMapLayer] = useState<MapLayer>(() =>
    ['price', 'sales', 'daysOnMarket'].includes(initial.get('layer') || '')
      ? (initial.get('layer') as MapLayer)
      : 'change',
  )
  const [matched, setMatched] = useState(initial.get('matched') === '1')
  const [expanded, setExpanded] = useState(false)
  const [viewportOnly, setViewportOnly] = useState(
    initial.get('mapview') === '1' && initialBounds !== null,
  )
  const [viewport, setViewport] = useState<MapBounds | null>(initialBounds)
  const [showSaved, setShowSaved] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState(
    () =>
      initial.get('place') ||
      defaultPlace(
        dataset.regions.filter((r) => r.kind === level && (!city || r.cityId === city)),
        date,
      )?.id ||
      '',
  )
  const [focus, setFocus] = useState<MapFocus>({
    place: null,
    request: 0,
    bounds: initialBounds || undefined,
  })
  const [comparedIds, setComparedIds] = useState<string[]>(() =>
    [...new Set((initial.get('compare') || '').split(','))]
      .filter((id) => dataset.regions.some((r) => r.id === id))
      .slice(0, 3),
  )
  const [chartMode, setChartMode] = useState<'types' | 'areas'>(
    initial.has('compare') ? 'areas' : 'types',
  )
  const [trend, setTrend] = useState<TrendMetric>(() =>
    ['sales', 'daysOnMarket', 'inventory'].includes(initial.get('trend') || '')
      ? (initial.get('trend') as TrendMetric)
      : 'price',
  )
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('hpa-saved') || '[]')
      return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  })
  const [toast, setToast] = useState('')
  const [loadedAt] = useState(() => Date.now())
  const [regionMenu, setRegionMenu] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const statsAnchor = useRef<HTMLDivElement>(null)
  const chartAnchor = useRef<HTMLDivElement>(null)

  const cities = useMemo(() => dataset.regions.filter((r) => r.kind === 'city'), [dataset])
  const neighborhoods = useMemo(
    () => dataset.regions.filter((r) => r.kind === 'neighborhood'),
    [dataset],
  )
  const boundaryById = useMemo(
    () => new Map(dataset.boundaries?.features.map((feature) => [feature.id, feature])),
    [dataset],
  )
  const mappedIds = useMemo(() => new Set(boundaryById.keys()), [boundaryById])
  const scoped = useMemo(
    () =>
      (level === 'city' ? cities : neighborhoods).filter(
        (r) =>
          (!city || r.cityId === city) &&
          (!showSaved || savedIds.includes(r.id)) &&
          (!query.trim() ||
            `${r.name} ${r.city}`.toLowerCase().includes(query.trim().toLowerCase())) &&
          (!viewportOnly || boundaryInBounds(boundaryById.get(r.id), viewport)),
      ),
    [
      level,
      cities,
      neighborhoods,
      city,
      showSaved,
      savedIds,
      query,
      viewportOnly,
      viewport,
      boundaryById,
    ],
  )
  const filtered = useMemo(
    () =>
      scoped
        .filter((r) => {
          const c = compare(r, type, metric, horizon, date, minimumSales)
          return (
            (quality === 'all' || quality === c.status) && matchesDirection(c.change, direction)
          )
        })
        .sort((a, b) => {
          if (sort === 'name') return a.name.localeCompare(b.name)
          const ac = compare(a, type, metric, horizon, date, minimumSales)
          const bc = compare(b, type, metric, horizon, date, minimumSales)
          if (ac.change == null) return bc.change == null ? a.name.localeCompare(b.name) : 1
          if (bc.change == null) return -1
          if (sort === 'sales')
            return (
              Math.min(bc.current!.sales!, bc.previous!.sales!) -
                Math.min(ac.current!.sales!, ac.previous!.sales!) || a.name.localeCompare(b.name)
            )
          return sort === 'rising' ? bc.change - ac.change : ac.change - bc.change
        }),
    [scoped, type, metric, horizon, date, minimumSales, quality, direction, sort],
  )
  const selected =
    filtered.find((r) => r.id === selectedId) ||
    filtered.find(
      (r) => compare(r, type, metric, horizon, date, minimumSales).status === 'ready',
    ) ||
    filtered[0] ||
    null
  const selectedCity =
    selected?.kind === 'neighborhood' ? cities.find((r) => r.cityId === selected.cityId) : undefined
  const activeCity = cities.find((c) => c.cityId === city)
  const compared = comparedIds
    .map((id) => dataset.regions.find((r) => r.id === id))
    .filter((r): r is Place => !!r)
  const activeHover = filtered.some((r) => r.id === hovered) ? hovered : null
  const daysOld = (loadedAt - new Date(dataset.dataThrough).getTime()) / 86_400_000
  const updateViewport = useCallback(
    (bounds: MapBounds) =>
      setViewport((previous) =>
        previous && previous.every((v, i) => Math.abs(v - bounds[i]) < 0.000001)
          ? previous
          : bounds,
      ),
    [],
  )

  useEffect(() => {
    const params = new URLSearchParams({
      region: dataset.id,
      level,
      type,
      months: String(horizon),
      metric,
      asof: date.slice(0, 7),
      minsales: String(minimumSales),
      sort,
      view,
      layer: mapLayer,
      trend,
    })
    if (city) params.set('city', city)
    if (query) params.set('q', query)
    if (selected) params.set('place', selected.id)
    if (quality !== 'all') params.set('quality', quality)
    if (direction !== 'all') params.set('direction', direction)
    if (matched) params.set('matched', '1')
    if (comparedIds.length) params.set('compare', comparedIds.join(','))
    if (viewportOnly && viewport) {
      params.set('mapview', '1')
      params.set('bbox', viewport.map((v) => v.toFixed(6)).join(','))
    }
    history.replaceState(null, '', `${location.pathname}?${params}`)
  }, [
    dataset.id,
    level,
    type,
    horizon,
    metric,
    date,
    minimumSales,
    sort,
    view,
    mapLayer,
    trend,
    city,
    query,
    selected,
    quality,
    direction,
    matched,
    comparedIds,
    viewportOnly,
    viewport,
  ])
  useEffect(() => {
    try {
      localStorage.setItem('hpa-saved', JSON.stringify(savedIds))
    } catch {
      /* Storage-restricted browsers can still explore. */
    }
  }, [savedIds])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  function selectPlace(place: Place) {
    setSelectedId(place.id)
    setFocus((previous) => ({ place, request: previous.request + 1 }))
  }
  function resetFilters() {
    setCity('')
    setQuery('')
    setShowSaved(false)
    setQuality('all')
    setDirection('all')
    setViewportOnly(false)
    setSort('sales')
    setFocus((previous) => ({ place: null, request: previous.request + 1 }))
  }
  function chooseQuality(next: QualityFilter) {
    setQuality(next)
    if (next === 'thin' || next === 'missing') setDirection('all')
  }
  function chooseDirection(next: DirectionFilter) {
    setDirection(next)
    if (next !== 'all' && (quality === 'thin' || quality === 'missing')) setQuality('all')
  }
  function chooseLevel(next: AreaLevel) {
    setLevel(next)
    setViewportOnly(false)
    setQuality('all')
    setDirection('all')
    setHovered(null)
    const pool = (next === 'city' ? cities : neighborhoods).filter(
      (r) => !city || r.cityId === city,
    )
    setSelectedId(defaultPlace(pool, date)?.id || '')
    setFocus((previous) => ({ place: activeCity || null, request: previous.request + 1 }))
  }
  function chooseCity(id: string) {
    setCity(id)
    setViewportOnly(false)
    setHovered(null)
    const pool = (level === 'city' ? cities : neighborhoods).filter((r) => !id || r.cityId === id)
    setSelectedId(defaultPlace(pool, date)?.id || '')
    setFocus((previous) => ({
      place: cities.find((c) => c.cityId === id) || null,
      request: previous.request + 1,
    }))
  }
  function drill(place: Place) {
    setLevel('neighborhood')
    setCity(place.cityId)
    setQuery('')
    setQuality('all')
    setDirection('all')
    setViewportOnly(false)
    setHovered(null)
    setChartMode('types')
    setSelectedId(
      defaultPlace(
        neighborhoods.filter((r) => r.cityId === place.cityId),
        date,
      )?.id || '',
    )
    setFocus((previous) => ({ place, request: previous.request + 1 }))
  }
  function viewCity(place: Place) {
    setLevel('city')
    resetFilters()
    setChartMode('types')
    selectPlace(place)
  }
  function toggleCompared(id: string) {
    if (comparedIds.includes(id)) {
      setComparedIds((ids) => ids.filter((x) => x !== id))
      if (comparedIds.length === 1) setChartMode('types')
    } else if (comparedIds.length < 3) {
      setComparedIds((ids) => [...ids, id])
      setChartMode('areas')
      setToast('Added to the comparison chart below')
    } else setToast('Compare up to three areas. Remove one to add another.')
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([exportStatistics(filtered, type, metric, horizon, date, minimumSales)], {
        type: 'text/csv;charset=utf-8;',
      }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `home-price-atlas-${dataset.id}-${type}-${horizon}mo.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function share() {
    navigator.clipboard
      ?.writeText(location.href)
      .then(() => setToast('Link copied with the selected date, filters, and comparisons.'))
      .catch(() => setToast('Copy the browser address to share this view.'))
    if (!navigator.clipboard) setToast('Copy the browser address to share this view.')
  }
  const noun = level === 'city' ? 'cities' : 'neighborhoods'

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
              LOCAL MARKET INTELLIGENCE
            </div>
            <h1>
              A closer look at the market<span>.</span>
            </h1>
            <p>Follow prices, activity, and the strength of the data behind them.</p>
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
              Latest data: {dateLabel(dataset.dataThrough)}
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
            The latest imported snapshot is through {dateLabel(dataset.dataThrough)}. Refresh the
            data to bring it up to date.
          </div>
        )}
        <MarketOverview
          places={scoped}
          type={type}
          metric={metric}
          horizon={horizon}
          date={date}
          minimumSales={minimumSales}
          level={level}
          quality={quality}
          direction={direction}
          matched={matched}
          onType={setType}
          onQuality={chooseQuality}
          onDirection={chooseDirection}
          onMatched={setMatched}
          onAbout={() => dialog.current?.showModal()}
        />
        <section className="explore-section" aria-label="Explore the market">
          <div className="explore-header">
            <div>
              <h2>
                {showSaved ? `Your saved ${noun}` : 'Explore the market'}
                <span className="count-badge">{filtered.length}</span>
              </h2>
              <p>
                {activeCity ? `${activeCity.name}, ${activeCity.state}` : dataset.description}
                <span> / </span>
                {TYPES.find((t) => t.id === type)?.fullLabel}
              </p>
            </div>
            <div className="explore-actions">
              <button className="text-button" onClick={share}>
                <Share2 size={14} />
                Share view
              </button>
              <button className="outline-button" onClick={download}>
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>
          <div className="scope-bar">
            <div className="segmented scope-switch" aria-label="Geographic detail">
              <button
                aria-label="City view"
                aria-pressed={level === 'city'}
                className={level === 'city' ? 'active' : ''}
                onClick={() => chooseLevel('city')}
              >
                Cities <span>{cities.length}</span>
              </button>
              <button
                aria-label="Neighborhood view"
                aria-pressed={level === 'neighborhood'}
                className={level === 'neighborhood' ? 'active' : ''}
                onClick={() => chooseLevel('neighborhood')}
              >
                Neighborhoods <span>{neighborhoods.length}</span>
              </button>
            </div>
            <p>
              {level === 'city'
                ? 'Broader samples. Select a city to explore its neighborhoods.'
                : 'Smaller samples. Use the city benchmark when local sales are thin.'}
            </p>
            {activeCity && level === 'neighborhood' && (
              <button className="city-context-button" onClick={() => viewCity(activeCity)}>
                {activeCity.name} city statistics <ArrowRight size={13} />
              </button>
            )}
          </div>
          <div className="toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search neighborhoods or cities"
                type="search"
                placeholder={`Search ${noun}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="select-wrap city-select">
              <MapPin size={14} />
              <select
                aria-label="Filter by city"
                value={city}
                onChange={(e) => chooseCity(e.target.value)}
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
            <label className="select-wrap sample-select">
              <select
                aria-label="Minimum sales per comparison window"
                value={minimumSales}
                onChange={(e) => setMinimumSales(Number(e.target.value))}
              >
                <option value={5}>5+ sales</option>
                <option value={10}>10+ sales</option>
                <option value={20}>20+ sales</option>
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
                <MapIcon size={15} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => {
                  setView('list')
                  setExpanded(false)
                  setViewportOnly(false)
                }}
                className={view === 'list' ? 'active' : ''}
              >
                <List size={16} />
              </button>
            </div>
          </div>
          <Timeline dates={dates} date={date} onChange={setDate} />
          {(quality !== 'all' || direction !== 'all' || viewportOnly || showSaved) && (
            <div className="active-filters">
              {quality !== 'all' && (
                <button onClick={() => setQuality('all')}>
                  {quality === 'ready'
                    ? 'Comparable only'
                    : quality === 'thin'
                      ? 'Low sales'
                      : 'Missing history'}
                  <X size={11} />
                </button>
              )}
              {direction !== 'all' && (
                <button onClick={() => setDirection('all')}>
                  {direction} prices
                  <X size={11} />
                </button>
              )}
              {viewportOnly && (
                <button onClick={() => setViewportOnly(false)}>
                  Inside map view
                  <X size={11} />
                </button>
              )}
              {showSaved && (
                <button onClick={() => setShowSaved(false)}>
                  Saved only
                  <X size={11} />
                </button>
              )}
              <span>
                {viewportOnly
                  ? 'Areas without matched boundaries are excluded.'
                  : 'Click a chip to remove its filter.'}
              </span>
            </div>
          )}
          <div
            className={`workspace ${view === 'list' ? 'list-only' : ''} ${expanded ? 'map-expanded' : ''}`}
          >
            {view === 'map' && (
              <Suspense
                fallback={
                  <div className="map-shell map-skeleton">
                    <MapPin size={28} />
                    <span>Opening the atlas…</span>
                  </div>
                }
              >
                <InteractiveMap
                  dataset={dataset}
                  places={filtered}
                  level={level}
                  type={type}
                  metric={metric}
                  horizon={horizon}
                  date={date}
                  minimumSales={minimumSales}
                  layer={mapLayer}
                  selected={selected}
                  hovered={activeHover}
                  focus={focus}
                  expanded={expanded}
                  viewportOnly={viewportOnly}
                  comparedIds={comparedIds}
                  onSelect={selectPlace}
                  onHover={setHovered}
                  onDrill={drill}
                  onViewport={updateViewport}
                  onViewportOnly={setViewportOnly}
                  onLayer={setMapLayer}
                  onExpand={() => setExpanded(!expanded)}
                  onDetails={() =>
                    statsAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  onCompare={toggleCompared}
                />
              </Suspense>
            )}
            <AreaDirectory
              mappedIds={mappedIds}
              places={filtered}
              level={level}
              selected={selected}
              hovered={activeHover}
              comparedIds={comparedIds}
              type={type}
              metric={metric}
              horizon={horizon}
              date={date}
              minimumSales={minimumSales}
              sort={sort}
              quality={quality}
              onSelect={selectPlace}
              onHover={setHovered}
              onCompare={toggleCompared}
              onSort={setSort}
              onQuality={chooseQuality}
              onReset={resetFilters}
            />
          </div>
          <div className="explore-bottom">
            <span>
              <span className="legend-neutral" />
              Current / prior sales are shown even when a price comparison is too thin.
            </span>
            <button onClick={resetFilters}>
              Reset filters <X size={12} />
            </button>
            <a
              href="#local-picture"
              onClick={() =>
                statsAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Activity & local context <ArrowRight size={12} />
            </a>
          </div>
        </section>
        <div ref={statsAnchor} id="local-picture" className="local-picture">
          <div className="selection-strip">
            <span>
              <Sparkles size={14} />
              {selected
                ? `Taking a closer look at ${selected.name}`
                : 'Select an area to get started'}
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
                {savedIds.includes(selected.id) ? 'Saved area' : 'Save area'}
              </button>
            )}
          </div>
          {selected && (
            <PlaceStatistics
              place={selected}
              city={selectedCity}
              type={type}
              metric={metric}
              horizon={horizon}
              date={date}
              minimumSales={minimumSales}
              onCity={viewCity}
              onTrend={(value) => {
                setTrend(value)
                setChartMode('types')
                chartAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          )}
          <div ref={chartAnchor} className="chart-anchor">
            <AreaTrends
              place={selected}
              city={selectedCity}
              type={type}
              metric={metric}
              horizon={horizon}
              date={date}
              minimumSales={minimumSales}
              compared={compared}
              mode={chartMode}
              onMode={setChartMode}
              trend={trend}
              onTrend={setTrend}
            />
          </div>
          {compared.length > 0 && (
            <div className="comparison-tray">
              <span>COMPARING</span>
              {compared.map((place) => (
                <button key={place.id} onClick={() => toggleCompared(place.id)}>
                  {place.name}
                  {place.kind === 'city' ? ' (city)' : ''}
                  <X size={12} />
                </button>
              ))}
              <span className="comparison-tray-hint">{compared.length}/3 areas</span>
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
      <Methodology dialog={dialog} dataset={dataset} date={date} minimumSales={minimumSales} />
    </>
  )
}
