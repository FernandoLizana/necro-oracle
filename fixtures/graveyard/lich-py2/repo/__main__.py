import lich
import crypt


def main():
    data = lich.summon("http://example.com")
    bones = crypt.bury(["ash", "yew"])
    crypt.exhume(bones)
    lich.chant(3)
    return data


if __name__ == "__main__":
    main()
