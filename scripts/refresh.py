"""Build small, region-scoped snapshots from free Redfin Data Center exports.

The current public S3 files are newest-first. We stream CSVs, verify that ordering,
and stop at the retention boundary. Use --full-scan for exports without this order.
Raw public downloads are never committed. A failed import leaves the last good
snapshot intact. No API key or paid subscription is required.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import math
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
DATA_BASE = BASE + "redfin_data_center/"
LOOKUPS = BASE + "redfin_api/lookup_files/housing_market/"
PROPERTY_TYPES = {
    "Single Family Residential": "single-family",
    "Condo/Co-op": "condo",
    "Townhouse": "townhouse",
}
FIELDS = {
    "price": "MEDIAN SALE PRICE NSA ($)",
    "ppsf": "MEDIAN SALE PRICE PER SQ.FT. ($)",
    "sales": "HOMES SOLD",
    "daysOnMarket": "MEDIAN DAYS ON MARKET (DAYS)",
    "inventory": "INVENTORY",
}


def fetch(url: str):
    return urllib.request.urlopen(urllib.request.Request(
        url, headers={"User-Agent": "HomePriceAtlas/0.1 (public housing research)"}
    ), timeout=120)


def read_json(url: str):
    with fetch(url) as response:
        return json.load(response)


def number(value: str | None):
    if value is None or value.strip() in ("", "NA", "N/A", "null"):
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite value: {value}")
    return round(result, 2)


def normalize_row(row: dict[str, str]):
    category = PROPERTY_TYPES.get(row.get("PROPERTY TYPE", ""))
    if not category:
        return None
    if row.get("FREQUENCY") != "Rolling 3 Months":
        raise ValueError("Expected rolling-three-month observations")
    if row.get("IS SEASONALLY ADJUSTED", "false").lower() != "false":
        raise ValueError("Cannot mix seasonally adjusted and unadjusted data")
    date = row["PERIOD END"]
    dt.date.fromisoformat(date)
    dt.date.fromisoformat(row["PERIOD BEGIN"])
    point = {"date": date, "start": row["PERIOD BEGIN"]}
    for name, field in FIELDS.items():
        point[name] = number(row.get(field))
        if point[name] is not None and point[name] < 0:
            raise ValueError(f"Negative {name} for {row['REGION ID']}")
    return category, point


def consume(reader, regions, since, full_scan=False):
    required = {"REGION ID", "PROPERTY TYPE", "PERIOD END", "PERIOD BEGIN", "FREQUENCY", *FIELDS.values()}
    if missing := required - set(reader.fieldnames or []):
        raise ValueError(f"Missing CSV columns: {sorted(missing)}")
    previous = "9999-12-31"
    latest = ""
    updated = ""
    count = 0
    for index, row in enumerate(reader):
        date = row["PERIOD END"]
        dt.date.fromisoformat(date)
        if not full_scan and date > previous:
            raise ValueError("Source is not newest-first. Re-run with --full-scan.")
        previous = date
        if date < since:
            if full_scan:
                continue
            break
        latest = max(latest, date)
        updated = max(updated, row.get("LAST UPDATED", ""))
        region = regions.get(row["REGION ID"])
        if region is not None and (result := normalize_row(row)):
            category, point = result
            series = region["series"].setdefault(category, {})
            if point["date"] in series and series[point["date"]] != point:
                raise ValueError(f"Conflicting observations: {region['id']} {category} {date}")
            series[date] = point
            count += 1
        if index and index % 100_000 == 0:
            print(f"  scanned {index:,} rows; {count:,} local observations; through {date}", flush=True)
    return {"dataThrough": latest, "sourceUpdatedAt": updated, "observations": count}


def load_export(url, local_path, regions, since, full_scan):
    if local_path:
        path = Path(local_path)
        if path.suffix.lower() == ".zip":
            totals = []
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    if name.lower().endswith(".csv"):
                        with archive.open(name) as file:
                            totals.append(consume(csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig")), regions, since, True))
            if not totals:
                raise ValueError("No CSVs found in ZIP")
            return {"dataThrough": max(t["dataThrough"] for t in totals),
                    "sourceUpdatedAt": max(t["sourceUpdatedAt"] for t in totals),
                    "observations": sum(t["observations"] for t in totals)}
        with path.open(encoding="utf-8-sig", newline="") as file:
            return consume(csv.DictReader(file), regions, since, full_scan)
    with fetch(url) as response:
        return consume(csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig", newline="")), regions, since, full_scan)


def normalized_name(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def add_locations(regions, config):
    """Name-matched reference points, NOT Redfin boundaries or spatial joins.

    Only unique exact normalized city+neighborhood names are matched. A point is
    approximate and explicitly labeled. Unmatched series remain fully browsable.
    """
    west, south, east, north = config["bounds"]
    params = urllib.parse.urlencode({
        "f": "json", "where": "State = 'CA'" if config["state"] == "CA" else f"State = '{config['state']}'",
        "geometry": f"{west},{south},{east},{north}", "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326", "spatialRel": "esriSpatialRelIntersects",
        "outFields": "City,Name,RegionID", "returnGeometry": "true", "resultRecordCount": "1000",
    })
    base = "https://gispub.epa.gov/arcgis/rest/services/OEI/Zillow_Neighborhoods/MapServer/2/query?"
    locations = {}
    offset = 0
    while True:
        result = read_json(base + params + f"&resultOffset={offset}")
        if "error" in result:
            raise ValueError(result["error"])
        for feature in result.get("features", []):
            attrs, geom = feature["attributes"], feature.get("geometry", {})
            if "x" not in geom or "y" not in geom:
                continue
            key = (normalized_name(attrs["City"]), normalized_name(attrs["Name"]))
            locations.setdefault(key, []).append([round(geom["x"], 6), round(geom["y"], 6)])
        if not result.get("exceededTransferLimit"):
            break
        offset += len(result["features"])
    matched = 0
    for region in regions.values():
        if region["kind"] != "neighborhood":
            continue
        key = (normalized_name(region["city"]), normalized_name(region["name"]))
        if len(points := locations.get(key, [])) == 1:
            region["center"] = points[0]
            region["locationMethod"] = "Approximate location: exact city/name match to Zillow 2017 reference point. Not a Redfin boundary."
            matched += 1
    print(f"  matched {matched} approximate neighborhood reference points", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="peninsula-south-bay")
    parser.add_argument("--since", help="Earliest period-end date to retain (default: 26 months ago)")
    parser.add_argument("--neighborhood-file", help="Official Redfin CSV or ZIP, instead of the public bulk URL")
    parser.add_argument("--city-file", help="Official Redfin city CSV or ZIP")
    parser.add_argument("--full-scan", action="store_true", help="Scan unordered exports in full")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "config/regions.json").read_text())
    config = next((r for r in catalog["regions"] if r["id"] == args.region), None)
    if not config:
        parser.error(f"Unknown region: {args.region}")
    since = args.since or (dt.date.today() - dt.timedelta(days=800)).replace(day=1).isoformat()
    dt.date.fromisoformat(since)
    cities = {c["id"]: c for c in config["cities"]}
    regions = {
        c["id"]: {"id": "city-" + c["id"], "providerId": c["id"], "kind": "city",
                  "name": c["name"], "city": c["name"], "cityId": c["id"], "state": config["state"],
                  "center": c["center"], "series": {}}
        for c in config["cities"]
    }
    with fetch(LOOKUPS + "neighborhood_lookup.csv") as response:
        for row in csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig")):
            if city := cities.get(row["PARENT REGION ID"]):
                key = row["REGION ID"]
                # City and neighborhood IDs belong to independent namespaces.
                regions["neighborhood-" + key] = {
                    "id": "neighborhood-" + key, "providerId": key, "kind": "neighborhood",
                    "name": row["REGION NAME"], "city": city["name"], "cityId": city["id"],
                    "state": config["state"], "center": None, "series": {},
                }
    source_index = read_json(DATA_BASE + "index.json")
    sources = []
    for kind, file in [("neighborhood", args.neighborhood_file), ("city", args.city_file)]:
        selected = {r["providerId"]: r for r in regions.values() if r["kind"] == kind}
        url = DATA_BASE + source_index["property_types"]["monthly"][kind]["all"]
        print(f"Importing {kind} series since {since}: {file or url}", flush=True)
        result = load_export(url, file, selected, since, args.full_scan)
        if not result["observations"]:
            raise ValueError(f"No local {kind} observations found. Existing snapshot was not replaced.")
        sources.append({"kind": kind, "url": url, **result})
        print(f"  imported {result['observations']:,} observations", flush=True)
    # Geometry failure should not discard successfully imported prices. Missing
    # reference locations are explicit, and all series still appear in the directory.
    try:
        add_locations(regions, config)
    except (urllib.error.URLError, ValueError, TimeoutError) as error:
        print(f"Reference locations unavailable: {error}", file=sys.stderr)
    for region in regions.values():
        region["series"] = {key: sorted(values.values(), key=lambda p: p["date"])
                            for key, values in region["series"].items()}
    through = min(s["dataThrough"] for s in sources)
    dataset = {
        "schemaVersion": 1, "id": config["id"], "name": config["name"],
        "description": config["description"], "bounds": config["bounds"],
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "dataThrough": through,
        "sourceUpdatedAt": min(s["sourceUpdatedAt"] for s in sources), "sources": sources,
        "frequency": "Rolling 3 Months", "seasonallyAdjusted": False,
        "regions": sorted(regions.values(), key=lambda r: (r["city"], r["kind"], r["name"])),
    }
    destination = ROOT / "public/data" / (config["id"] + ".json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.with_suffix(".json.tmp")
    pending.write_text(json.dumps(dataset, separators=(",", ":")) + "\n")
    pending.replace(destination)
    # The frontend catalog is generated from region configuration, not hardcoded UI.
    public_catalog = {"defaultRegion": catalog["defaultRegion"], "regions": [
        {"id": r["id"], "name": r["name"], "description": r["description"],
         "available": (ROOT / "public/data" / (r["id"] + ".json")).exists()}
        for r in catalog["regions"]
    ]}
    (destination.parent / "catalog.json").write_text(json.dumps(public_catalog, indent=2) + "\n")
    print(f"Wrote {destination.relative_to(ROOT)} ({destination.stat().st_size / 1024:.0f} KB), through {through}", flush=True)
    from boundaries import refresh_boundaries
    refresh_boundaries(config["id"])


if __name__ == "__main__":
    main()
