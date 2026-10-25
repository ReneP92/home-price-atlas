# Home Price Atlas

A neighborhood-level home-price explorer, starting with California's Peninsula and western South Bay. Compare single-family homes, condos/co-ops, and townhomes using free public housing data.

**[Explore the app](https://renep92.github.io/home-price-atlas/)**

## What it does

- Explore neighborhoods from Hillsborough through Los Gatos.
- Give all three property types equal prominence, with 3-, 6-, and 12-month comparisons.
- Switch between median sale price and median sale price per square foot.
- Compare property types within a neighborhood, or up to three neighborhoods for one property type.
- Search, filter by city, sort by change, and identify limited-data areas.
- Save neighborhoods on your device, share filtered URLs, and export the underlying comparison as CSV.
- Show city-level changes on the map overview and approximate neighborhood reference locations after selecting a city.
- Run as a static site, with no paid data subscription, backend, account, or API key.

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

## Data and methodology

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
- Comparisons require valid, positive values and **at least five sales in both windows**.
- Five sales is a screening rule, not a confidence guarantee or statistical interval.
- Monthly chart points below that threshold are gaps. Missing months are not interpolated.
- The three summary cards show the **unweighted median of eligible neighborhood changes** in the current search/city scope. They are not a pooled regional appreciation index. Each type may have a different eligible neighborhood set, shown by its area count.
- Three- and six-month comparisons are not annualized and can reflect seasonal effects.
- Historical observations may change when Redfin revises a release. Refreshes replace the snapshot consistently rather than mixing releases.

See [Redfin's methodology](https://www.redfin.com/news/data-center/methodology/) for definitions and source updates. Source dates and import dates are visible in the app's methodology dialog and stored in the snapshot.

### Map locations

The overview shows **city-level** metrics at approximate city centers defined in region configuration. Selecting a city shows available neighborhood reference points.

Neighborhood points come from the **[EPA-hosted Zillow 2017 neighborhood dataset](https://www.arcgis.com/home/item.html?id=56b89613f9f7450fb44e857691a244e7)**. A unique, exact normalized city and neighborhood-name match is required. These points are **approximate locators, not Redfin neighborhood boundaries**. Metrics are joined by Redfin region IDs, never by spatial proximity. Unmatched neighborhoods remain available in the list, charts, and export.

Reference locations are credited to Zillow and the US EPA. Background map tiles are provided by OpenStreetMap and are loaded only for the visible map, with attribution. Location matching can fail independently of price imports without dropping the underlying price history.

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

Outputs in `public/data/` are generated. Regenerate them with the importer rather than editing them manually. A monthly GitHub Actions workflow imports and validates a new snapshot, commits it, and explicitly starts the full CI/deployment workflow. It can also be triggered manually from the Actions tab. The live site updates only after those checks pass.

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
src/lib/market.ts        Period matching, sample rules, changes, formatting, exports
src/components/         MapLibre map and Recharts comparison chart
src/App.tsx             Search, filters, URL state, saved neighborhoods, data loading
e2e/                    Desktop and mobile user journeys
.github/workflows/       CI, GitHub Pages deployment, and monthly refresh
```

The frontend loads one selected regional snapshot. The data model preserves provider IDs, geographic level, source dates, observation windows, and original property categories. A future property-level provider can be added without making the current aggregate statistics pretend to be individual-home valuations.

## Deployment

GitHub Actions runs lint, unit tests, importer tests, and desktop/mobile E2E tests before publishing to GitHub Pages. Set the repository's Pages source to **GitHub Actions**.

For a different deployment path, set `BASE_PATH` at build time. Root-domain deployment uses `/` by default.

```sh
BASE_PATH=/home-price-atlas/ bun run build
BASE_PATH=/home-price-atlas/ bun run preview
```

## License and attribution

Application code is MIT licensed. Third-party housing data and reference locations retain their respective source terms and attribution requirements; the code license does not relicense those datasets. Redfin is the source of the market data. Zillow and the US EPA are the source of neighborhood reference locations. This project is independent of those organizations.
