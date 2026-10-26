"""Generate matched city and reference-neighborhood GeoJSON from public GIS data.

City shapes are Census municipal/CDP boundaries. Neighborhoods are explicitly
Zillow 2017 reference shapes, not asserted to be Redfin's statistical boundaries.
Ambiguous names are excluded. No circles, bounding-box polygons, or inferred
neighborhood shapes are generated for missing matches.
"""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import re
import unicodedata
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CENSUS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer"
ZILLOW = "https://gispub.epa.gov/arcgis/rest/services/OEI/Zillow_Neighborhoods/MapServer/1"


def read_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "HomePriceAtlas/0.1 (public housing research)"})
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.load(response)
    if "error" in result:
        raise ValueError(f"GIS source error: {result['error']}")
    return result


def name_key(value):
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


def query_features(layer, where, bounds):
    west, south, east, north = bounds
    params = {
        "f": "geojson", "where": where, "outFields": "*", "returnGeometry": "true",
        "geometry": f"{west},{south},{east},{north}", "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects", "inSR": "4326", "outSR": "4326",
        "geometryPrecision": "6", "maxAllowableOffset": "0.00005", "resultRecordCount": "1000",
    }
    features = []
    while True:
        params["resultOffset"] = len(features)
        result = read_json(layer + "/query?" + urllib.parse.urlencode(params))
        batch = result.get("features", [])
        features.extend(batch)
        if not result.get("exceededTransferLimit"):
            return features
        if not batch:
            raise ValueError("GIS pagination stopped before all features were returned")


def geometry_bounds(geometry):
    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Area geometry must be a Polygon or MultiPolygon")
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    points = []
    if not polygons:
        raise ValueError("Empty area geometry")
    for polygon in polygons:
        if not polygon:
            raise ValueError("Polygon has no rings")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Polygon rings must be closed and have at least four positions")
            for point in ring:
                if len(point) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point):
                    raise ValueError("Invalid coordinate")
                if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                    raise ValueError("Coordinate outside longitude/latitude bounds")
                points.append(point)
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def match_boundaries(regions, census_features, neighborhood_features, vintage):
    cities, neighborhoods = {}, {}
    for feature in census_features:
        key = name_key(feature["properties"]["BASENAME"])
        cities.setdefault(key, []).append(feature)
    for feature in neighborhood_features:
        properties = feature["properties"]
        key = (name_key(properties["City"]), name_key(properties["Name"]))
        neighborhoods.setdefault(key, []).append(feature)
    matched = []
    for region in regions:
        candidates = cities.get(name_key(region["name"]), []) if region["kind"] == "city" else neighborhoods.get((name_key(region["city"]), name_key(region["name"])), [])
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        geometry = candidate.get("geometry")
        if not geometry:
            continue
        bbox = geometry_bounds(geometry)
        source = candidate["properties"]
        is_reference = region["kind"] == "neighborhood"
        matched.append({
            "type": "Feature", "id": region["id"], "bbox": bbox, "geometry": geometry,
            "properties": {
                "placeId": region["id"], "name": region["name"], "city": region["city"],
                "kind": region["kind"], "reference": is_reference,
                "source": "Zillow / US EPA" if is_reference else "US Census Bureau",
                "vintage": "2017" if is_reference else vintage,
                "sourceId": str(source.get("RegionID") if is_reference else source.get("GEOID")),
                "match": "Unique normalized city and neighborhood name" if is_reference else "Unique normalized place name within the configured state and region",
            },
        })
    return matched


def validate_boundaries(collection, dataset):
    if collection.get("type") != "FeatureCollection" or collection.get("region") != dataset["id"]:
        raise ValueError("Boundary collection does not match the market region")
    known = {r["id"]: r for r in dataset["regions"]}
    seen = set()
    coverage = {"city": 0, "neighborhood": 0}
    for feature in collection["features"]:
        identifier = feature["id"]
        if identifier not in known or identifier in seen:
            raise ValueError("Unknown or duplicate market region in boundaries")
        seen.add(identifier)
        properties = feature["properties"]
        if properties["placeId"] != identifier or properties["kind"] != known[identifier]["kind"]:
            raise ValueError("Boundary identifier or geographic level mismatch")
        if properties["reference"] != (properties["kind"] == "neighborhood"):
            raise ValueError("Neighborhood reference boundaries must be labeled explicitly")
        if geometry_bounds(feature["geometry"]) != feature["bbox"]:
            raise ValueError("Stored boundary extent does not match its geometry")
        coverage[properties["kind"]] += 1
    if not coverage["city"]:
        raise ValueError("No city boundaries matched")
    return coverage


def refresh_boundaries(region_id):
    catalog = json.loads((ROOT / "config/regions.json").read_text())
    config = next(r for r in catalog["regions"] if r["id"] == region_id)
    state = config.get("stateFips", "")
    if not re.fullmatch(r"\d{2}", state):
        raise ValueError("Set the region's two-digit stateFips in config/regions.json")
    dataset = json.loads((ROOT / "public/data" / f"{region_id}.json").read_text())
    service = read_json(CENSUS + "?f=json")
    groups = [l for l in service["layers"] if re.fullmatch(r"BAS \d{4}", l["name"])]
    group = max(groups, key=lambda l: l["name"])
    layers = [l for l in service["layers"] if l["parentLayerId"] == group["id"] and l["name"] in ("Incorporated Places", "Census Designated Places")]
    if len(layers) != 2:
        raise ValueError("Could not discover Census place-boundary layers")
    census_features = []
    sources = []
    for layer in layers:
        url = CENSUS + f"/{layer['id']}"
        census_features.extend(query_features(url, f"STATE='{state}'", config["bounds"]))
        sources.append({"name": f"US Census {group['name']} {layer['name']}", "url": url})
    neighborhoods = query_features(ZILLOW, f"State='{config['state']}'", config["bounds"])
    sources.append({"name": "Zillow 2017 neighborhood boundaries via US EPA", "url": ZILLOW})
    collection = {
        "type": "FeatureCollection", "schemaVersion": 1, "region": region_id,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "generatedBy": "scripts/boundaries.py",
        "sources": sources,
        "features": match_boundaries(dataset["regions"], census_features, neighborhoods, group["name"]),
    }
    coverage = validate_boundaries(collection, dataset)
    path = ROOT / "public/data" / f"{region_id}-boundaries.geojson"
    pending = path.with_suffix(".geojson.tmp")
    pending.write_text(json.dumps(collection, separators=(",", ":")) + "\n")
    pending.replace(path)
    print(f"Boundaries: {coverage['city']} cities, {coverage['neighborhood']} reference neighborhoods ({path.stat().st_size // 1024} KB)")
    missing = [r["name"] for r in dataset["regions"] if r["kind"] == "city" and r["id"] not in {f['id'] for f in collection['features']}]
    if missing:
        print("Unmatched cities: " + ", ".join(missing))
    return collection


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="peninsula-south-bay")
    refresh_boundaries(parser.parse_args().region)
