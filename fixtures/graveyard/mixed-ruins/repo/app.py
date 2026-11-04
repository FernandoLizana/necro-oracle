"""Runnable entrypoint for the mixed-ruins demo library."""

from ledger import record, total


def main():
    """Record a couple of entries and print the running total."""
    book = record([], "candles", 3)
    book = record(book, "incense", 5)
    print(total(book))


if __name__ == "__main__":
    main()
