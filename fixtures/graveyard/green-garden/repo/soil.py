"""Soil helpers used by the garden module."""


def enrich(seed):
    """Normalise a seed name into a grown plant label."""
    return str(seed).strip().lower()
