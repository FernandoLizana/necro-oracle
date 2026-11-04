"""Tests for the garden module (also a runner via run_checks)."""

from garden import harvest, plant
from soil import enrich


def test_plant_and_harvest():
    """Planting then harvesting returns sorted, enriched plant names."""
    bed = plant(["Basil", "thyme"])
    assert harvest(bed) == ["basil", "thyme"]


def test_enrich_strips_and_lowercases():
    """enrich normalises whitespace and case."""
    assert enrich("  Rosemary  ") == "rosemary"


def run_checks():
    """Run the checks imperatively for the app entrypoint."""
    test_plant_and_harvest()
    test_enrich_strips_and_lowercases()
