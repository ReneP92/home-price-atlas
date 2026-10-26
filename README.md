# Home Price Atlas

A city and neighborhood home-price explorer, starting with California's Peninsula and western South Bay. Compare single-family homes, condos/co-ops, and townhomes using free public housing data.

**Run locally:** http://127.0.0.1:5173

## What it does

- Start with broader city samples, then drill into neighborhoods from Hillsborough through Los Gatos.
- Give all three property types equal prominence, with 3-, 6-, and 12-month comparisons.
- Switch between median sale price and median sale price per square foot.
- Compare property types within an area, or up to three cities/neighborhoods for one property type. Add a city benchmark to neighborhood price charts.
- Explore annual sales volume, sales-activity changes, median days on market, and reported inventory.
- See coverage, rising/flat/falling market breadth, and the middle 50% of area price changes. Filter by sample quality or direction; choose 5, 10, or 20 sales per comparison window.
- Scrub or play the reporting timeline. Dates, thresholds, metrics, geographic scope, comparisons, and map-view filters are shareable in the URL.
- Switch map coloring between price changes, price levels, sales activity, and days on market. Inspect markers, link selection to the directory, filter to the viewport, fit filtered areas, and expand the map.
- Save areas on your device and export the underlying observations and statistics as CSV.
- Run locally, with no paid data subscription, backend, account, or API key.

## Run locally

Requires Node.js 24+, Bun 1.4+, and Python 3.12+ (only for data refreshes).

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://127.0.0.1:5173. The checked-in regional snapshot makes the app usable immediately. An internet connection is needed for background map tiles and web fonts; the list, charts, and calculations use the local snapshot.

```sh
bun run lint
bun run test
bun run data:test
bun run data:validate
bunx playwright install chromium
bun run test:e2e
bun run build
```

### Command shortcuts

With [just](https://just.systems/) installed, run `just` to list the available recipes:

```sh
just setup          # Install dependencies and Chromium
just dev            # Start the local development server
just preview        # Build and serve a fresh local production preview
just check          # Run formatting, lint, tests, data validation, and build
just data-refresh   # Refresh the default region's public data
```

Commands accept extra arguments where useful:

```sh
just dev --port 5174
just e2e --project desktop
just test -t "annual"
just data-refresh peninsula-south-bay --since 2024-09-01
```

Individual recipes also include `install`, `browsers`, `build`, `lint`, `format`, `format-check`, `test`, `data-test`, and `data-validate`.

## Data and methodology

### How much sales information is available?

The initial September 2026 snapshot has **12,417 monthly area/type observations**, not 12,417 individual transaction records. Small neighborhoods often have too few sales for a stable comparison.

With five sales required in both windows, initial 12-month price-comparison coverage is:

| Property type | Cities (out of 22) | Neighborhoods (out of 246) |
| ------------- | -----------------: | -------------------------: |
| Single-family |                 22 |                         89 |
| Condo/co-op   |                 15 |                         21 |
| Townhouse     |                 12 |                         15 |

That is why the app opens at city level. Coverage is recalculated for the selected date, property type, threshold, and scope. The app keeps reported counts visible even when a price comparison is too thin. It never substitutes city data for a neighborhood without labeling the geographic level.

### Prices and property types

The primary source is the **[Redfin Data Center](https://www.redfin.com/news/data-center/)**. The importer discovers the current property-type export URLs from Redfin's public `index.json` and imports neighborhood and city CSVs. It preserves Redfin's categories:

| UI label      | Original source category  |
| ------------- | ------------------------- |
| Single-family | Single Family Residential |
| Condos        | Condo/Co-op               |
| Townhomes     | Townhouse                 |

These aggregate categories cannot resolve individual classification ambiguities. In particular, some townhouse-style buildings can legally be condominiums. The app does not relabel aggregate condo data as townhouse data.

**These are sale-price trends, not same-home appreciation estimates.** Different homes sell in different periods. Median price and median price per square foot are both sensitive to transaction mix. For example, a shift toward larger or newer homes can raise a neighborhood's median price without every home appreciating.

Redfin reports smaller geographies in **rolling three-month windows**, updated monthly and not seasonally adjusted. A point ending September represents July through September. A 12-month comparison uses that window against July through September of the prior year. The frontend calculates changes from the retained price levels in the same source release.

- Change = `(current value / prior value - 1) * 100`.
- Price comparisons require valid, positive values and **at least five sales in both windows by default**, adjustable to 10 or 20.
- These are sample-size screening rules, not confidence guarantees or statistical intervals.
- Price and median-days chart points below the threshold are gaps. Missing months are not interpolated. Sales and inventory charts preserve reported counts, including zero.
- The three summary cards show the **unweighted median of eligible area changes** in the current geographic/search/map scope, before quality and direction filters. They are not a pooled regional appreciation index. Each type may have a different eligible area set, shown by its count. **Same areas for all types** restricts only the cards to the shared eligible set.
- Three- and six-month comparisons are not annualized and can reflect seasonal effects.
- Historical observations may change when Redfin revises a release. Refreshes replace the snapshot consistently rather than mixing releases.

See [Redfin's methodology](https://www.redfin.com/news/data-center/methodology/) for definitions and source updates. Source dates and import dates are visible in the app's methodology dialog and stored in the snapshot.

### Activity, benchmarks, and market breadth

- **Annual sales** sum four adjacent, non-overlapping three-month windows ending 0, 3, 6, and 9 months before the selected date. Summing all twelve monthly rows would count overlapping windows repeatedly. All four counts must be present; otherwise the annual total is incomplete. The prior year uses the same calculation shifted back 12 months.
- These totals are reported sales, not unique properties. A home can sell more than once. Neighborhood sales are never summed into city totals because geographic definitions may overlap.
- **Sales activity** compares the reported current-window count with the count in the window 3, 6, or 12 months earlier. A zero baseline has no percentage-change result.
- **Days on market** shows the current reported median. The day-change comparison requires sufficient sales in both windows.
- **Inventory** is the source-reported inventory metric for the reporting window. It is not inferred from sales or converted into an unsupported supply estimate.
- **City-relative performance** is the percentage-point difference between an eligible neighborhood price change and the provider's matching city price change. The city benchmark uses the same property type, metric, dates, and release.
- **Market breadth** counts eligible rising, flat (within 0.05%), and falling areas. The middle 50% is the interquartile range of those area changes, not a home-price range or a confidence interval.
- **Trend charts** support prices, sales counts, days on market, and inventory. Adjacent count-chart points still overlap in time; annual totals use the separate disjoint-quarter calculation above. Legend items can be toggled independently.

### Map locations

The map and directory always use the same selected geographic level and filters. The initial city view uses approximate city centers defined in region configuration. Select a city marker and choose **Neighborhoods** to drill down, or use the geographic-level switch directly. Selecting a marker shows its price, change, and both sales counts; selecting a directory row focuses the corresponding map location.

Neighborhood points come from the **[EPA-hosted Zillow 2017 neighborhood dataset](https://www.arcgis.com/home/item.html?id=56b89613f9f7450fb44e857691a244e7)**. A unique, exact normalized city and neighborhood-name match is required. These points are **approximate locators, not Redfin neighborhood boundaries**. Metrics are joined by Redfin region IDs, never by spatial proximity. Unmatched neighborhoods remain available in the list, charts, and export.

**Filter to map view** explicitly excludes areas with no reference coordinates. The initial snapshot has 73 mapped neighborhood reference points. Selecting an unmapped neighborhood shows city context without inventing a neighborhood point. Map coloring for price level and sales activity uses a separate sequential scale; these colors do not imply appreciation. Missing values are never shown as zero.

Reference locations are credited to Zillow and the US EPA. The basemap is **[OpenFreeMap Positron](https://openfreemap.org/quick_start/)**: a light vector style with sharp labels, streets, and building footprints as you zoom. Its subdued palette keeps the price overlays readable. The public service requires no registration, API key, or subscription and supports commercial use and US-wide coverage.

MapLibre loads the provider's attribution automatically: OpenFreeMap, OpenMapTiles, and OpenStreetMap. Maps load over the internet while the app runs on localhost. Map location coverage is independent of the basemap provider; changing providers does not create missing neighborhood coordinates or price data.

### Source files

- [Current Redfin export index](https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/index.json)
- [Neighborhood property-type data](https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/property_types/monthly/all_neighborhoods.csv)
- [City property-type data](https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/property_types/monthly/all_cities.csv)
- [Neighborhood lookup](https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_api/lookup_files/housing_market/neighborhood_lookup.csv)
- [City lookup](https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_api/lookup_files/housing_market/city_lookup.csv)

The nationwide exports are large. The importer streams the newest-first files and stops at the retention cutoff after checking the observed date order. It retains only configured places and does not store the nationwide files. A local unordered export can be read using `--full-scan`. Failed validation leaves the last published snapshot intact.

## Refresh the data

```sh
bun run data:refresh
```

The default retention is approximately 26 months, enough for a full 12-month chart and prior-year comparisons. Override it when necessary:

```sh
python3 scripts/refresh.py --region peninsula-south-bay --since 2024-09-01
```

Official downloaded CSVs or ZIP archives can also be imported:

```sh
python3 scripts/refresh.py \
  --neighborhood-file /path/to/neighborhoods.csv \
  --city-file /path/to/cities.csv \
  --full-scan
```

Local files must contain the same dimension and metric columns as the public property-type exports. This intentionally rejects incomplete or differently shaped exports instead of guessing category or period information.

Outputs in `public/data/` are generated. Regenerate them with the importer rather than editing them manually. A monthly GitHub Actions workflow imports and validates a new snapshot, commits it, and runs the repository checks. It can also be triggered manually from the Actions tab. Pull the latest changes to use the updated snapshot locally.

## Adding another US region

Geography is configured in `config/regions.json`, not embedded in UI or calculation code.

1. Add a region with a unique slug, display name, state abbreviation, and `[west, south, east, north]` map bounds.
2. Add its cities using IDs from Redfin's **city lookup**, plus approximate city-center coordinates. Match county parent IDs when city names are ambiguous.
3. Run `python3 scripts/refresh.py --region your-region-id`.
4. Commit the configuration and generated snapshot. The region picker discovers it from the generated catalog.

The initial configuration covers 22 cities. Additional US regions become available only after a successful import. Coverage of each property type depends on the source; no neighborhood is assumed to have all three types.

## Architecture

```text
config/regions.json       Geographic scope and stable provider IDs
scripts/refresh.py       Streaming import, validation, reference-location matching
public/data/             Small generated regional snapshots and catalog
src/lib/market.ts        Period matching, sample rules, changes, and formatting
src/lib/statistics.ts    Annual sales, benchmarks, coverage, geographic filtering, exports
src/components/         Interactive map, timeline, coverage, activity cards, and trend charts
src/Explorer.tsx         Data loading, scope, filters, URL state, and saved comparisons
e2e/                    Desktop and mobile user journeys
.github/workflows/       Repository checks and monthly data refresh
```

The frontend loads one selected regional snapshot. The data model preserves provider IDs, geographic level, source dates, observation windows, and original property categories. A future property-level provider can be added without making the current aggregate statistics pretend to be individual-home valuations.

## Local production build

Build and preview the optimized app locally:

```sh
bun run build
bun run preview
```

Open http://127.0.0.1:4173. Both development and preview servers bind to localhost. GitHub Actions runs validation and build checks only; public hosting and deployment are disabled.

## License and attribution

Application code is MIT licensed. Third-party housing data and reference locations retain their respective source terms and attribution requirements; the code license does not relicense those datasets. Redfin is the source of the market data. Zillow and the US EPA are the source of neighborhood reference locations. This project is independent of those organizations.
