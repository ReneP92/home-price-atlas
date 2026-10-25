"""Validate published snapshots and report actual type-specific coverage."""
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = {"single-family", "condo", "townhouse"}


def validate(data):
    assert data["schemaVersion"] == 1, "Unsupported schema"
    assert data["frequency"] == "Rolling 3 Months", "Incorrect frequency"
    assert data["seasonallyAdjusted"] is False, "Unexpected seasonal adjustment"
    ids = [r["id"] for r in data["regions"]]
    assert len(ids) == len(set(ids)), "Duplicate region identifiers"
    cities = {r["cityId"] for r in data["regions"] if r["kind"] == "city"}
    coverage = {t: {"neighborhoodsWithLatestPrice": 0, "comparable12Months": 0} for t in TYPES}
    latest = data["dataThrough"][:7]
    prior = f"{int(latest[:4]) - 1}{latest[4:]}"
    observations = 0
    for region in data["regions"]:
        assert region["cityId"] in cities, f"Missing parent: {region['id']}"
        assert set(region["series"]) <= TYPES, f"Unknown property type: {region['id']}"
        if region["center"] is not None:
            lon, lat = region["center"]
            assert -180 <= lon <= 180 and -90 <= lat <= 90, "Invalid reference location"
        for category, points in region["series"].items():
            dates = [p["date"] for p in points]
            assert dates == sorted(set(dates)), f"Unordered/duplicate observations: {region['id']}"
            for point in points:
                end = dt.date.fromisoformat(point["date"])
                start = dt.date.fromisoformat(point["start"])
                assert 88 <= (end - start).days <= 92, "Non-three-month observation window"
                for field in ("price", "ppsf", "sales", "daysOnMarket", "inventory"):
                    value = point[field]
                    assert value is None or (isinstance(value, (float, int)) and math.isfinite(value) and value >= 0), f"Invalid {field}"
                observations += 1
            if region["kind"] == "neighborhood":
                now = next((p for p in points if p["date"].startswith(latest)), None)
                before = next((p for p in points if p["date"].startswith(prior)), None)
                if now and now["price"]:
                    coverage[category]["neighborhoodsWithLatestPrice"] += 1
                if all(p and p["price"] and p["sales"] is not None and p["sales"] >= 5 for p in (now, before)):
                    coverage[category]["comparable12Months"] += 1
    assert any(c["neighborhoodsWithLatestPrice"] > 0 for c in coverage.values()), "No current neighborhood prices"
    return {"id": data["id"], "dataThrough": data["dataThrough"], "cities": len(cities),
            "neighborhoods": sum(r["kind"] == "neighborhood" for r in data["regions"]),
            "mappedNeighborhoods": sum(r["kind"] == "neighborhood" and r["center"] is not None for r in data["regions"]),
            "observations": observations, "coverage": coverage}


if __name__ == "__main__":
    catalog = json.loads((ROOT / "public/data/catalog.json").read_text())
    for region in catalog["regions"]:
        if region["available"]:
            data = json.loads((ROOT / "public/data" / f"{region['id']}.json").read_text())
            print(json.dumps(validate(data), indent=2))
