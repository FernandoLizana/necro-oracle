# green-garden

A small, healthy Python 3 library used as a demo fixture for the Necro-Oracle.
It is tended and alive: it ships tests, continuous integration, a license, and
pinned, current dependencies.

## Installation

```
pip install green-garden
```

## Usage

```python
from green_garden.garden import plant, harvest

bed = plant(["basil", "thyme"])
print(harvest(bed))
```

## Getting started

Clone the repository, create a virtualenv, install the dependencies from
`requirements.txt`, and run `pytest` to see the tests pass.
