"""A tiny append-only ledger used by the mixed-ruins demo."""


def record(book, name, amount):
    """Append an entry to the ledger and return the new ledger."""
    return list(book) + [{"name": str(name), "amount": int(amount)}]


def total(book):
    """Sum the amounts recorded in the ledger."""
    return sum(entry["amount"] for entry in book)
