import copy
import unittest
from boundaries import geometry_bounds, match_boundaries, validate_boundaries

SHAPE = {"type": "Polygon", "coordinates": [[[-122, 37], [-121, 37], [-121, 38], [-122, 38], [-122, 37]]]}
CITY = {"id": "city-1", "kind": "city", "name": "Test City", "city": "Test City"}
HOOD = {"id": "neighborhood-2", "kind": "neighborhood", "name": "Green Park", "city": "Test City"}


class BoundaryTests(unittest.TestCase):
    def test_city_and_reference_neighborhood_are_labeled_and_joined_by_id(self):
        cities = [{"geometry": SHAPE, "properties": {"BASENAME": "Test City", "GEOID": "0600001"}}]
        neighborhoods = [{"geometry": SHAPE, "properties": {"City": "Test City", "Name": "Green-Park", "RegionID": "42"}}]
        features = match_boundaries([CITY, HOOD], cities, neighborhoods, "BAS 2026")
        collection = {"type": "FeatureCollection", "region": "test", "features": features}
        self.assertEqual(validate_boundaries(collection, {"id": "test", "regions": [CITY, HOOD]}), {"city": 1, "neighborhood": 1})
        self.assertFalse(features[0]["properties"]["reference"])
        self.assertTrue(features[1]["properties"]["reference"])

    def test_ambiguous_names_are_not_guessed(self):
        candidate = {"geometry": SHAPE, "properties": {"City": "Test City", "Name": "Green Park", "RegionID": "42"}}
        self.assertEqual(match_boundaries([HOOD], [], [candidate, candidate], "BAS 2026"), [])

    def test_invalid_rings_and_incorrect_extents_are_rejected(self):
        invalid = copy.deepcopy(SHAPE)
        invalid["coordinates"][0].pop()
        with self.assertRaises(ValueError):
            geometry_bounds(invalid)
        feature = match_boundaries([CITY], [{"geometry": SHAPE, "properties": {"BASENAME": "Test City", "GEOID": "1"}}], [], "BAS 2026")[0]
        feature["bbox"] = [0, 0, 1, 1]
        with self.assertRaises(ValueError):
            validate_boundaries({"type": "FeatureCollection", "region": "test", "features": [feature]}, {"id": "test", "regions": [CITY]})
