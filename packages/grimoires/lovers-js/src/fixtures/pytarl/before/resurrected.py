"""resurrected.py — purpose-built golden fixture for tomaes/pytarl.

A tiny, representative slice of a Python 3 roguelike's pure helpers (pytarl is a
"Python tiny attempt at a roguelike"). These are purpose-built fixtures, NOT the
repo's real source: a handful of small top-level functions with
JSON-serialisable signatures that the Lovers (VI) binding can bind across the
pinned JSON-lines contract. Everything here is pure — no I/O, no randomness, no
clock — so the deterministic template bridge has clean, bindable targets.
"""


def manhattan_distance(x1: int, y1: int, x2: int, y2: int) -> int:
    """Grid (taxicab) distance between two tiles."""
    return abs(x1 - x2) + abs(y1 - y2)


def clamp(value: int, low: int, high: int) -> int:
    """Clamp a value into the inclusive [low, high] range."""
    if value < low:
        return low
    if value > high:
        return high
    return value


def tile_passable(terrain: str, blocked: bool = False) -> bool:
    """Whether a tile of the given terrain may be walked onto."""
    if blocked:
        return False
    return terrain not in ("wall", "void")
