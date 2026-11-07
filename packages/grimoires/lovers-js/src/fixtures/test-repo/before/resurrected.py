"""resurrected.py — purpose-built golden fixture for neubig/test-repo.

A tiny, representative slice of a minimal Python 3 "test repo" of generic
utility functions. These are purpose-built fixtures, NOT the repo's real source:
a handful of small top-level functions with JSON-serialisable signatures the
Lovers (VI) binding can bind across the pinned JSON-lines contract. All pure —
no I/O, no randomness, no clock.
"""


def add(a: int, b: int) -> int:
    """Integer sum of two numbers."""
    return a + b


def greet(name: str, excited: bool = False) -> str:
    """Build a greeting; add an exclamation mark when excited."""
    suffix = "!" if excited else "."
    return "Hello, " + name + suffix


def total(values: list) -> float:
    """Sum of a list of numbers as a float."""
    acc = 0.0
    for v in values:
        acc = acc + v
    return acc
