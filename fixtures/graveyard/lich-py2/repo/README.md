# Lich

A small Python 2 utility that summons bytes from a URL and keeps a
ledger of buried names. It was written for Python 2.7 and never made
the crossing to Python 3, but the code itself is simple and whole.

## Install

    python setup.py install

## Usage

    python -m lich

Point it at a URL and it will chant the bytes back to you. The `crypt`
module records the names you bury and exhumes them on demand.

## Getting started

Run the tests with `pytest`, then read `lich.py` for the summoning
logic and `crypt.py` for the ledger of bones.
