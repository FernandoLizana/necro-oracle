"""Runnable entrypoint that plants a demo bed and prints the harvest."""

import tests.test_garden

from garden import harvest, plant


def main():
    """Plant a small bed and print its sorted harvest."""
    bed = plant(["Basil", "thyme"])
    print(harvest(bed))
    tests.test_garden.run_checks()


if __name__ == "__main__":
    main()
