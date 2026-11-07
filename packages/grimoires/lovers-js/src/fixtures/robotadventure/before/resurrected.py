"""resurrected.py — purpose-built golden fixture for ArmstrongJ/robotadventure.

A tiny, representative slice of a Python 3 text-adventure's pure helpers
(robotadventure is a small robot-themed adventure game). These are purpose-built
fixtures, NOT the repo's real source: a handful of small top-level functions
with JSON-serialisable signatures the Lovers (VI) binding can bind across the
pinned JSON-lines contract. All pure — no I/O, no randomness, no clock.
"""


def normalize_command(raw: str) -> str:
    """Lower-case and collapse whitespace in a player's typed command."""
    return " ".join(raw.lower().split())


def charge_level(battery: float, capacity: float) -> float:
    """Fraction of the robot's battery remaining, pinned to [0.0, 1.0]."""
    if capacity <= 0.0:
        return 0.0
    ratio = battery / capacity
    if ratio < 0.0:
        return 0.0
    if ratio > 1.0:
        return 1.0
    return ratio


def can_move(direction: str, exits: list, locked: bool = False) -> bool:
    """Whether the robot may travel in `direction` from the current room."""
    if locked:
        return False
    return direction in exits
