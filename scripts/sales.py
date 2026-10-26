"""Audit local Redfin sold-home exports and calculate reference-neighborhood samples.

This is a transaction-level pilot, not a replacement for the Data Center snapshot.
Export completeness is unknown even below the 350-row cap. Outputs stay local in
.cache by default. No network requests, geocoding, or property-type inference.
"""
from __future__ import annotations

import argparse
import calendar
from collections import Counter
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import re
import statistics
import tempfile

from boundaries import geometry_bounds, name_key
from refresh import PROPERTY_TYPES

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {"SALE TYPE", "SOLD DATE", "PROPERTY TYPE", "ADDRESS", "CITY",
            "STATE OR PROVINCE", "ZIP OR POSTAL CODE", "PRICE", "STATUS",
            "SQUARE FEET", "LATITUDE", "LONGITUDE"}
NOTICE = "In accordance with local MLS rules, some MLS listings are not included in the download"


def numeric(value):
    try:
        number = float((value or "").strip().replace(",", "").removeprefix("$"))
        return number if math.isfinite(number) else None
    except ValueError:
        return None


def sale_date(value):
    for pattern in ("%B-%d-%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(value, pattern).date()
        except ValueError:
            pass
    raise ValueError("Invalid sold date")


def address_key(address):
    # Keep unit numbers: neighboring units at one building are distinct homes.
    text = re.sub(r"(?:#|\bunit\b|\bapt\b|\bsuite\b)\s*", " unit ", address.lower())
    return re.sub(r"[^a-z0-9]", "", text)


def normalize(row, as_of):
    if row["SALE TYPE"].upper() != "PAST SALE":
        return None, "not-closed-sale"
    if not row["SOLD DATE"]:
        return None, "missing-sale-date"
    try:
        date = sale_date(row["SOLD DATE"])
    except ValueError:
        return None, "invalid-sale-date"
    if date > as_of:
        return None, "after-reporting-date"
    if row["STATUS"].lower() != "sold":
        return None, "unconfirmed-sale-status"
    category = PROPERTY_TYPES.get(row["PROPERTY TYPE"])
    if not category:
        return None, "unsupported-property-type"
    price = numeric(row["PRICE"])
    if price is None or price <= 0:
        return None, "invalid-sale-price"
    lon, lat = numeric(row["LONGITUDE"]), numeric(row["LATITUDE"])
    if lon is None or lat is None or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None, "missing-or-invalid-location"
    url = next((value for key, value in row.items() if key.startswith("URL ")), "")
    home = re.search(r"/home/(\d+)(?:[/?#]|$)", url)
    if not home and not all(row[key] for key in ("ADDRESS", "CITY", "STATE OR PROVINCE", "ZIP OR POSTAL CODE")):
        return None, "missing-property-identity"
    sqft = numeric(row["SQUARE FEET"])
    sqft = sqft if sqft is not None and sqft > 0 else None
    return {
        "date": date.isoformat(), "propertyType": category,
        "sourcePropertyType": row["PROPERTY TYPE"], "price": price,
        "squareFeet": sqft, "location": [lon, lat],
        "address": row["ADDRESS"], "city": row["CITY"],
        "state": row["STATE OR PROVINCE"], "zip": row["ZIP OR POSTAL CODE"],
        "homeId": home[1] if home else None, "url": url,
        "source": row.get("SOURCE", ""), "mlsId": row.get("MLS#", ""),
    }, None


def read_exports(paths, as_of):
    records, audits, rejected = [], [], Counter()
    for path in paths:
        body = path.read_bytes()
        reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")), strict=True)
        if missing := REQUIRED - set(reader.fieldnames or []):
            raise ValueError(f"{path.name}: missing CSV columns: {sorted(missing)}")
        if len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError(f"{path.name}: duplicate CSV columns")
        audit = {"file": path.name, "sha256": hashlib.sha256(body).hexdigest(),
                 "rows": 0, "notices": [], "rejected": Counter(), "candidateRows": 0}
        metadata_path = path.with_suffix(".metadata.json")
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text())
            if metadata.get("sha256") != audit["sha256"]:
                raise ValueError(f"{path.name}: provenance checksum mismatch")
            audit["provenance"] = metadata
        for row in reader:
            if [value for value in row.values() if value is not None] == [NOTICE]:
                audit["notices"].append(NOTICE)
                continue
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{path.name}, line {reader.line_num}: malformed CSV row")
            audit["rows"] += 1
            record, reason = normalize({key: value.strip() for key, value in row.items()}, as_of)
            if reason:
                audit["rejected"][reason] += 1
                rejected[reason] += 1
            else:
                record["provenance"] = [{"file": path.name, "sha256": audit["sha256"], "line": reader.line_num}]
                records.append(record)
                audit["candidateRows"] += 1
        # Count the raw rows, before discarding nearby or non-sold records.
        audit["atExportCap"] = audit["rows"] >= 350
        audits.append(audit)
    return records, audits, rejected


def deduplicate(records):
    """Join identity aliases per sale date; quarantine conflicting connected groups."""
    parents = list(range(len(records)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    aliases = {}
    for index, record in enumerate(records):
        keys = []
        if record["homeId"]:
            keys.append(("home", record["homeId"], record["date"]))
        if all(record[key] for key in ("address", "city", "state", "zip")):
            keys.append(("address", address_key(record["address"]), name_key(record["city"]),
                         record["state"].upper(), record["zip"], record["date"]))
        for key in keys:
            if key in aliases:
                parents[root(index)] = root(aliases[key])
            aliases[key] = index
    groups = {}
    for index, record in enumerate(records):
        groups.setdefault(root(index), []).append(record)
    unique, conflicts, duplicates = [], [], 0
    for group in groups.values():
        conflicting = [field for field in ("price", "propertyType", "squareFeet")
                       if len({record[field] for record in group if record[field] is not None}) > 1]
        if any(max(r["location"][axis] for r in group) - min(r["location"][axis] for r in group) > 0.00001 for axis in (0, 1)):
            conflicting.append("location")
        if conflicting:
            conflicts.append({"fields": conflicting, "records": group})
            continue
        merged = dict(group[0])
        merged["squareFeet"] = next((r["squareFeet"] for r in group if r["squareFeet"] is not None), None)
        merged["provenance"] = [source for record in group for source in record["provenance"]]
        duplicates += len(group) - 1
        unique.append(merged)
    return unique, conflicts, duplicates


def ring_relation(point, ring):
    """Return inside, outside, or edge. Edge points are not assigned by guesswork."""
    x, y = point
    inside = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        cross = (x - ax) * dy - (y - ay) * dx
        if abs(cross) / length <= 1e-9 and min(ax, bx) - 1e-9 <= x <= max(ax, bx) + 1e-9 and min(ay, by) - 1e-9 <= y <= max(ay, by) + 1e-9:
            return "edge"
        if (ay > y) != (by > y) and x < ax + (y - ay) * dx / dy:
            inside = not inside
    return "inside" if inside else "outside"


def geometry_relation(point, geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    result = "outside"
    for polygon in polygons:
        outer = ring_relation(point, polygon[0])
        holes = [ring_relation(point, ring) for ring in polygon[1:]]
        if outer == "inside" and all(hole == "outside" for hole in holes):
            return "inside"
        if outer == "edge" or (outer == "inside" and "edge" in holes):
            result = "edge"
    return result


def load_areas(path, city):
    collection = json.loads(path.read_text())
    if collection.get("type") != "FeatureCollection":
        raise ValueError("Expected a GeoJSON FeatureCollection")
    areas = [feature for feature in collection["features"] if name_key(feature["properties"]["city"]) == name_key(city)]
    cities = [feature for feature in areas if feature["properties"]["kind"] == "city"]
    if len(cities) != 1:
        raise ValueError(f"Expected exactly one city boundary for {city}")
    identifiers = set()
    for feature in areas:
        geometry_bounds(feature["geometry"])
        identifier = feature["properties"]["placeId"]
        if identifier in identifiers:
            raise ValueError("Duplicate boundary identifier")
        identifiers.add(identifier)
    return cities[0], [feature for feature in areas if feature["properties"]["kind"] == "neighborhood"]


def assign_areas(records, city, neighborhoods):
    scoped, counts = [], Counter()
    for record in records:
        relation = geometry_relation(record["location"], city["geometry"])
        if relation != "inside":
            counts["city-edge" if relation == "edge" else "outside-city"] += 1
            continue
        matches, edges = [], []
        for feature in neighborhoods:
            relation = geometry_relation(record["location"], feature["geometry"])
            if relation == "inside":
                matches.append(feature["properties"]["placeId"])
            elif relation == "edge":
                edges.append(feature["properties"]["placeId"])
        status = "boundary-edge" if edges else "overlapping-boundaries" if len(matches) > 1 else "matched" if matches else "no-neighborhood-boundary"
        counts[status] += 1
        if name_key(record["city"]) != name_key(city["properties"]["city"]):
            counts["city-label-mismatch"] += 1
        scoped.append({**record, "cityId": city["properties"]["placeId"],
                       "neighborhoodId": matches[0] if status == "matched" else None,
                       "assignment": status, "boundaryCandidates": sorted(matches + edges)})
    return scoped, counts


def month_start_shift(date, months):
    year, month = divmod(date.year * 12 + date.month - 1 + months, 12)
    return dt.date(year, month + 1, 1)


def window_summary(records, start, end, minimum):
    sample = [record for record in records if start <= record["date"] < end]
    ppsf = [record["price"] / record["squareFeet"] for record in sample if record["squareFeet"]]
    return {"start": start, "endExclusive": end, "sales": len(sample), "ppsfSales": len(ppsf),
            "medianPrice": round(statistics.median(r["price"] for r in sample), 2) if len(sample) >= minimum else None,
            "medianPpsf": round(statistics.median(ppsf), 2) if len(ppsf) >= minimum else None}


def summarize(records, areas, as_of, minimum):
    end = month_start_shift(as_of, 1)
    previous_end = month_start_shift(end, -12)
    results = []
    for area in areas:
        properties = area["properties"]
        id_field = "cityId" if properties["kind"] == "city" else "neighborhoodId"
        for category in PROPERTY_TYPES.values():
            subset = [r for r in records if r[id_field] == properties["placeId"] and r["propertyType"] == category]
            for months in (3, 6, 12):
                current = window_summary(subset, month_start_shift(end, -months).isoformat(), end.isoformat(), minimum)
                prior = window_summary(subset, month_start_shift(previous_end, -months).isoformat(), previous_end.isoformat(), minimum)
                changes = {}
                for field in ("medianPrice", "medianPpsf"):
                    changes[field] = round((current[field] / prior[field] - 1) * 100, 2) if current[field] and prior[field] else None
                results.append({"placeId": properties["placeId"], "name": properties["name"],
                                "kind": properties["kind"], "propertyType": category, "windowMonths": months,
                                "current": current, "prior": prior, "sampleChangePct": changes,
                                "meetsPriceSampleMinimum": changes["medianPrice"] is not None,
                                "completeness": "unverified-export-sample"})
    return results


def build_report(paths, boundaries, city_name, as_of, minimum=5):
    if minimum < 1:
        raise ValueError("Minimum sales must be positive")
    if as_of.day != calendar.monthrange(as_of.year, as_of.month)[1] or as_of >= dt.date.today().replace(day=1):
        raise ValueError("Reporting date must be the last day of a completed calendar month")
    city, neighborhoods = load_areas(boundaries, city_name)
    records, inputs, rejected = read_exports(paths, as_of)
    unique, conflicts, duplicates = deduplicate(records)
    scoped, assignments = assign_areas(unique, city, neighborhoods)
    dates = [record["date"] for record in scoped]
    statistics_rows = summarize(scoped, [city, *neighborhoods], as_of, minimum)
    coverage = {category: {str(months): sum(r["meetsPriceSampleMinimum"] for r in statistics_rows
                if r["kind"] == "neighborhood" and r["propertyType"] == category and r["windowMonths"] == months)
                for months in (3, 6, 12)} for category in PROPERTY_TYPES.values()}
    limitations = [
        "Export-sample statistics only. Market completeness and historical coverage are unverified.",
        "A sold-home search may omit earlier resales of the same property; it is not a complete transaction ledger.",
        "MLS download exclusions apply. Fewer than 350 rows does not establish completeness.",
        "Property types are preserved from each source row, not inferred from the requested search filter.",
        "Reference-neighborhood polygons may differ from Redfin reporting areas and do not cover every home.",
        "Sale-price mix changes are not same-home appreciation. Ordinary arm's-length sales are not independently verified.",
        "Zero counts mean no retained records in the export sample, not zero sales in the market.",
    ]
    if any(item["atExportCap"] for item in inputs):
        limitations.insert(0, "At least one export reached the 350-row cap; the requested search may be truncated.")
    return {
        "schemaVersion": 1, "source": "Redfin sold-home export pilot",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "city": city["properties"]["city"], "asOf": as_of.isoformat(),
        "minimumSales": minimum, "completeness": "unverified-export-sample",
        "limitations": limitations, "inputs": inputs, "rejectedRows": dict(rejected),
        "duplicatesRemoved": duplicates, "conflictingGroups": conflicts,
        "conflictingRows": sum(len(group["records"]) for group in conflicts),
        "assignments": dict(assignments), "retainedSales": len(scoped),
        "retainedDateRange": {"earliest": min(dates, default=None), "latest": max(dates, default=None)},
        "retainedByType": {category: sum(r["propertyType"] == category for r in scoped) for category in PROPERTY_TYPES.values()},
        "missingSquareFeet": sum(r["squareFeet"] is None for r in scoped),
        "neighborhoodsWithBoundaries": len(neighborhoods), "sampleCoverage": coverage,
        "boundaries": {"file": boundaries.name, "sha256": hashlib.sha256(boundaries.read_bytes()).hexdigest(),
                       "areas": [area["properties"] for area in [city, *neighborhoods]]},
        "statistics": statistics_rows,
        "sales": sorted(scoped, key=lambda r: (r["date"], r["address"], r["homeId"] or "")),
    }


def print_report(report, output):
    print(f"{report['city']} transaction pilot through {report['asOf']}")
    print("EXPORT SAMPLE ONLY - market coverage is unverified")
    print(f"Input rows: {sum(item['rows'] for item in report['inputs'])}; capped exports: {sum(item['atExportCap'] for item in report['inputs'])}")
    print(f"Retained city sales: {report['retainedSales']}; matched to one neighborhood: {report['assignments'].get('matched', 0)}")
    print(f"Observed sale dates: {report['retainedDateRange']['earliest']} to {report['retainedDateRange']['latest']} (not proof of complete history)")
    print(f"Duplicates removed: {report['duplicatesRemoved']}; conflicting rows quarantined: {report['conflictingRows']}")
    for reason, count in sorted(report["rejectedRows"].items()):
        print(f"  Excluded {reason}: {count}")
    for reason, count in sorted(report["assignments"].items()):
        if reason != "matched":
            print(f"  Geography {reason}: {count}")
    print(f"Neighborhood sample comparisons with >= {report['minimumSales']} sales in BOTH year-over-year windows (of {report['neighborhoodsWithBoundaries']} boundaries):")
    print("  Property type        Sales      3M     6M    12M")
    for category, counts in report["sampleCoverage"].items():
        print(f"  {category:<20} {report['retainedByType'][category]:>5}   {counts['3']:>5}  {counts['6']:>5}  {counts['12']:>5}")
    print(f"Local audit, normalized sales, and sample statistics: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="Downloaded Redfin sold-home CSVs; overlapping files are deduplicated")
    parser.add_argument("--city", default="Sunnyvale")
    parser.add_argument("--boundaries", type=Path, default=ROOT / "public/data/peninsula-south-bay-boundaries.geojson")
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.date.today().replace(day=1) - dt.timedelta(days=1))
    parser.add_argument("--minimum-sales", type=int, default=5)
    parser.add_argument("--output", type=Path, help="Local JSON output (default: .cache/sales-pilot/<city>.json)")
    args = parser.parse_args()
    output = args.output or ROOT / ".cache/sales-pilot" / f"{name_key(args.city)}.json"
    temporary = None
    try:
        if output.resolve() in {path.resolve() for path in [*args.files, args.boundaries]}:
            raise ValueError("Output must not overwrite an input file")
        report = build_report(args.files, args.boundaries, args.city, args.as_of, args.minimum_sales)
        content = json.dumps(report, indent=2, allow_nan=False) + "\n"
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        temporary.replace(output)
        print_report(report, output)
    except (ValueError, OSError, csv.Error) as error:
        parser.exit(1, f"Sales import failed: {error}\n")
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    main()
