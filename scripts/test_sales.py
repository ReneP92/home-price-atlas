import copy
import csv
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from sales import (NOTICE, REQUIRED, assign_areas, build_report, deduplicate,
                   geometry_relation, normalize, read_exports, summarize)

AS_OF = dt.date(2025, 3, 31)
SHAPE = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}


def feature(identifier, kind, geometry=SHAPE):
    return {"type": "Feature", "geometry": copy.deepcopy(geometry),
            "properties": {"placeId": identifier, "kind": kind, "name": identifier,
                           "city": "Test City", "source": "Synthetic fixture", "vintage": "2025",
                           "reference": kind == "neighborhood"}}


CITY = feature("city-1", "city")
HOOD = feature("neighborhood-1", "neighborhood")


def row(**changes):
    result = {key: "" for key in REQUIRED}
    result.update({"SALE TYPE": "PAST SALE", "SOLD DATE": "March-1-2025", "STATUS": "Sold",
                   "PROPERTY TYPE": "Condo/Co-op", "PRICE": "1000000", "SQUARE FEET": "1000",
                   "ADDRESS": "123 Sample St #1", "CITY": "Test City", "STATE OR PROVINCE": "CA",
                   "ZIP OR POSTAL CODE": "99999", "LATITUDE": "5", "LONGITUDE": "5",
                   "URL (SEE SOURCE)": "https://www.redfin.com/CA/Test-City/test/home/123"})
    result.update(changes)
    return result


def sale(**changes):
    result, reason = normalize(row(**changes), AS_OF)
    assert reason is None
    result["provenance"] = [{"file": "synthetic.csv", "line": 2}]
    return result


def write_csv(path, rows, notice=True):
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=list(row()))
        writer.writeheader()
        if notice:
            csv.writer(file).writerow([NOTICE])
        writer.writerows(rows)


class SalesTests(unittest.TestCase):
    def test_only_confirmed_dated_sales_with_valid_prices_and_locations_are_used(self):
        cases = [({"SALE TYPE": "MLS Listing", "STATUS": "Active"}, "not-closed-sale"),
                 ({"SOLD DATE": ""}, "missing-sale-date"),
                 ({"SOLD DATE": "February-30-2025"}, "invalid-sale-date"),
                 ({"SOLD DATE": "April-1-2025"}, "after-reporting-date"),
                 ({"STATUS": "Pending"}, "unconfirmed-sale-status"),
                 ({"PRICE": "NaN"}, "invalid-sale-price"),
                 ({"PRICE": "-20"}, "invalid-sale-price"),
                 ({"LATITUDE": "inf"}, "missing-or-invalid-location"),
                 ({"LONGITUDE": "181"}, "missing-or-invalid-location"),
                 ({"PROPERTY TYPE": "Multi-Family"}, "unsupported-property-type"),
                 ({"ADDRESS": "", "URL (SEE SOURCE)": ""}, "missing-property-identity")]
        for changes, reason in cases:
            with self.subTest(changes=changes):
                self.assertEqual(normalize(row(**changes), AS_OF), (None, reason))
        record, _ = normalize(row(**{"PRICE": "$1,000,000", "SQUARE FEET": "0"}), AS_OF)
        self.assertEqual(record["price"], 1000000)
        self.assertIsNone(record["squareFeet"])

    def test_source_property_type_is_preserved(self):
        self.assertEqual(sale()["propertyType"], "condo")
        self.assertEqual(sale(**{"PROPERTY TYPE": "Townhouse"})["propertyType"], "townhouse")
        self.assertEqual(sale(**{"PROPERTY TYPE": "Single Family Residential"})["propertyType"], "single-family")

    def test_overlapping_exports_deduplicate_without_merging_units_or_resales(self):
        original = sale()
        alias = sale(**{"ADDRESS": "123 Sample St Unit 1", "URL (SEE SOURCE)": ""})
        unit = sale(**{"ADDRESS": "123 Sample St #2", "URL (SEE SOURCE)": "https://www.redfin.com/home/456"})
        resale = sale(**{"SOLD DATE": "March-1-2024", "PRICE": "900000"})
        unique, conflicts, duplicates = deduplicate([original, alias, unit, resale])
        self.assertEqual((len(unique), len(conflicts), duplicates), (3, 0, 1))
        self.assertEqual(len(unique[0]["provenance"]), 2)

    def test_conflicting_prices_types_or_locations_quarantine_entire_alias_group(self):
        for changes in ({"PRICE": "1100000"}, {"PROPERTY TYPE": "Townhouse"}, {"LATITUDE": "6"}):
            with self.subTest(changes=changes):
                records = [sale(), sale(**{"URL (SEE SOURCE)": "", **changes}),
                           sale(**{"ADDRESS": "123 Sample Street #1"})]
                unique, conflicts, _ = deduplicate(records)
                self.assertEqual(unique, [])
                self.assertEqual(len(conflicts[0]["records"]), 3)

    def test_duplicate_with_missing_size_can_be_enriched(self):
        unique, conflicts, _ = deduplicate([sale(**{"SQUARE FEET": ""}), sale()])
        self.assertEqual(conflicts, [])
        self.assertEqual(unique[0]["squareFeet"], 1000)

    def test_polygon_holes_edges_and_multipolygons(self):
        shape = copy.deepcopy(SHAPE)
        shape["coordinates"].append([[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]])
        self.assertEqual(geometry_relation([5, 5], shape), "outside")
        self.assertEqual(geometry_relation([4, 5], shape), "edge")
        self.assertEqual(geometry_relation([0, 5], shape), "edge")
        self.assertEqual(geometry_relation([3, 3], shape), "inside")
        other = [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]]
        multi = {"type": "MultiPolygon", "coordinates": [shape["coordinates"], other]}
        self.assertEqual(geometry_relation([20.5, 20.5], multi), "inside")
        self.assertEqual(geometry_relation([15, 15], multi), "outside")

    def test_city_scope_is_spatial_and_ambiguous_neighborhoods_are_not_guessed(self):
        scoped, counts = assign_areas([sale(**{"CITY": "Postal City"}), sale(**{"LATITUDE": "15"})], CITY, [HOOD])
        self.assertEqual(len(scoped), 1)
        self.assertEqual(scoped[0]["neighborhoodId"], "neighborhood-1")
        self.assertEqual(counts["outside-city"], 1)
        self.assertEqual(counts["city-label-mismatch"], 1)
        scoped, _ = assign_areas([sale()], CITY, [HOOD, feature("neighborhood-2", "neighborhood")])
        self.assertIsNone(scoped[0]["neighborhoodId"])
        self.assertEqual(scoped[0]["assignment"], "overlapping-boundaries")
        scoped, _ = assign_areas([sale()], CITY, [])
        self.assertEqual(scoped[0]["assignment"], "no-neighborhood-boundary")
        half = {"type": "Polygon", "coordinates": [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]]}
        scoped, _ = assign_areas([sale()], CITY, [feature("edge", "neighborhood", half)])
        self.assertEqual(scoped[0]["assignment"], "boundary-edge")
        self.assertIsNone(scoped[0]["neighborhoodId"])

    def test_windows_pool_transactions_and_require_separate_price_per_sqft_samples(self):
        # Q1 median = 1000; Q4 median = 100. The pooled median is 950, not 550.
        records = [sale(**{"SOLD DATE": date, "PRICE": str(price), "SQUARE FEET": sqft})
                   for date, price, sqft in [("2025-03-31", 900, ""), ("2025-03-01", 1000, "1"),
                                            ("2025-01-01", 1100, "1"), ("2024-10-01", 100, "1"),
                                            ("2024-03-31", 450, "1"), ("2024-01-01", 500, "1"),
                                            ("2023-12-01", 550, "1"), ("2023-10-01", 50, "1"),
                                            ("2023-09-30", 1, "1")]]
        scoped, _ = assign_areas(records, CITY, [HOOD])
        result = summarize(scoped, [HOOD], AS_OF, 3)
        condo = {r["windowMonths"]: r for r in result if r["propertyType"] == "condo"}
        self.assertEqual(condo[6]["current"]["medianPrice"], 950)
        self.assertEqual(condo[6]["prior"]["medianPrice"], 475)
        self.assertEqual(condo[6]["sampleChangePct"]["medianPrice"], 100)
        self.assertEqual(condo[6]["current"]["sales"], 4)
        self.assertEqual(condo[6]["prior"]["sales"], 4)
        self.assertIsNone(condo[3]["current"]["medianPpsf"])
        self.assertIsNone(condo[3]["sampleChangePct"]["medianPrice"])
        self.assertEqual(condo[3]["prior"]["sales"], 2)
        for entry in result:
            if entry["propertyType"] != "condo":
                self.assertEqual(entry["current"]["sales"], 0)
                self.assertIsNone(entry["current"]["medianPrice"])

    def test_leap_year_windows_have_exact_calendar_endpoints(self):
        result = summarize([], [HOOD], dt.date(2024, 2, 29), 5)
        annual = next(r for r in result if r["windowMonths"] == 12)
        self.assertEqual(annual["current"]["start"], "2023-03-01")
        self.assertEqual(annual["current"]["endExclusive"], "2024-03-01")
        self.assertEqual(annual["prior"]["start"], "2022-03-01")
        self.assertEqual(annual["prior"]["endExclusive"], "2023-03-01")

    def test_cap_is_measured_before_filtering_or_deduplicating(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sales.csv"
            write_csv(path, [row()] * 349 + [row(**{"SALE TYPE": "MLS Listing"})])
            records, audits, rejected = read_exports([path], AS_OF)
            self.assertEqual(len(records), 349)
            self.assertTrue(audits[0]["atExportCap"])
            self.assertEqual(audits[0]["notices"], [NOTICE])
            self.assertEqual(rejected["not-closed-sale"], 1)
            unique, _, duplicates = deduplicate(records)
            self.assertEqual((len(unique), duplicates), (1, 348))

    def test_schema_malformed_rows_and_modified_provenance_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sales.csv"
            path.write_text("<html>not an export</html>")
            with self.assertRaisesRegex(ValueError, "missing CSV columns"):
                read_exports([path], AS_OF)
            write_csv(path, [row()])
            with path.open("a") as file:
                file.write("PAST SALE,2025-03-01\n")
            with self.assertRaisesRegex(ValueError, "malformed CSV row"):
                read_exports([path], AS_OF)
            write_csv(path, [row()])
            path.with_suffix(".metadata.json").write_text('{"sha256": "wrong"}')
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                read_exports([path], AS_OF)

    def test_cli_import_and_failure_preserve_previous_output_and_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, boundaries, output = folder / "sales.csv", folder / "boundaries.json", folder / "report.json"
            write_csv(source, [row(), row(), row(**{"SOLD DATE": "March-1-2024"})])
            boundaries.write_text(json.dumps({"type": "FeatureCollection", "features": [CITY, HOOD]}))
            command = [sys.executable, str(Path(__file__).with_name("sales.py")), str(source),
                       "--boundaries", str(boundaries), "--city", "Test City", "--as-of", AS_OF.isoformat(),
                       "--output", str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output.read_text())
            self.assertEqual(report["retainedSales"], 2)
            self.assertEqual(report["duplicatesRemoved"], 1)
            self.assertEqual(report["retainedDateRange"], {"earliest": "2024-03-01", "latest": "2025-03-01"})
            self.assertEqual(report["completeness"], "unverified-export-sample")
            self.assertEqual(len(report["statistics"]), 18)
            original = output.read_bytes()
            result = subprocess.run([*command, "--minimum-sales", "0"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), original)
            source_bytes = source.read_bytes()
            result = subprocess.run([*command, "--output", str(source)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_bytes(), source_bytes)
            with self.assertRaisesRegex(ValueError, "completed calendar month"):
                build_report([source], boundaries, "Test City", dt.date(2025, 3, 15))


if __name__ == "__main__":
    unittest.main()
