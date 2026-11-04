"""Garden operations: plant seeds into a bed and harvest them."""

from soil import enrich


def plant(seeds):
    """Create a new garden bed from an iterable of seed names."""
    bed = {"beds": [], "rows": 0}
    for seed in seeds:
        bed["beds"].append(enrich(seed))
        bed["rows"] += 1
    return bed


def harvest(bed):
    """Return the sorted list of grown plants from a planted bed."""
    return sorted(name for name in bed["beds"])
