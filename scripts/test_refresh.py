import csv
import io
import unittest

from refresh import FIELDS, consume, normalize_row, number


def row(**overrides):
    result = {
        "REGION ID": "123", "PROPERTY TYPE": "Townhouse", "FREQUENCY": "Rolling 3 Months",
        "PERIOD END": "2026-09-30", "PERIOD BEGIN": "2026-07-01", "LAST UPDATED": "2026-10-07",
        "IS SEASONALLY ADJUSTED": "false",
        **{field: "10" for field in FIELDS.values()},
    }
    result.update(overrides)
    return result


def reader(rows):
    text = io.StringIO()
    writer = csv.DictWriter(text, fieldnames=list(row()))
    writer.writeheader()
    writer.writerows(rows)
    text.seek(0)
    return csv.DictReader(text)


class ImportTests(unittest.TestCase):
    def test_preserves_categories_and_missing_values(self):
        self.assertEqual(normalize_row(row())[0], "townhouse")
        self.assertEqual(normalize_row(row(**{"PROPERTY TYPE": "Condo/Co-op"}))[0], "condo")
        self.assertIsNone(normalize_row(row(**{"PROPERTY TYPE": "All Residential"})))
        self.assertIsNone(number("NA"))
        self.assertEqual(number("0"), 0)
        with self.assertRaises(ValueError):
            number("Infinity")

    def test_rejects_incompatible_frequency_and_adjustment(self):
        for overrides in [{"FREQUENCY": "Monthly"}, {"IS SEASONALLY ADJUSTED": "true"}]:
            with self.assertRaises(ValueError):
                normalize_row(row(**overrides))

    def test_filters_geography_and_retention_without_fabricating_missing_months(self):
        regions = {"123": {"id": "neighborhood-123", "series": {}}}
        rows = [row(), row(**{"REGION ID": "999"}), row(**{"PERIOD END": "2024-08-31"})]
        result = consume(reader(rows), regions, "2025-01-01")
        self.assertEqual(result["observations"], 1)
        self.assertEqual(list(regions["123"]["series"]["townhouse"]), ["2026-09-30"])

    def test_rejects_conflicting_duplicates(self):
        regions = {"123": {"id": "neighborhood-123", "series": {}}}
        with self.assertRaisesRegex(ValueError, "Conflicting observations"):
            consume(reader([row(), row(**{"MEDIAN SALE PRICE NSA ($)": "20"})]), regions, "2025-01-01")

    def test_unordered_export_requires_full_scan(self):
        rows = [row(**{"PERIOD END": "2025-01-31"}), row()]
        with self.assertRaisesRegex(ValueError, "not newest-first"):
            consume(reader(rows), {"123": {"id": "n-123", "series": {}}}, "2025-01-01")
        result = consume(reader(rows), {"123": {"id": "n-123", "series": {}}}, "2025-06-01", True)
        self.assertEqual(result["observations"], 1)


if __name__ == "__main__":
    unittest.main()
