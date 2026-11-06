def bury(names):
    """Bury a list of names and return their ledger of bones."""
    bones = {}
    for n in names:
        print "burying", n
        bones[n] = 0
    return bones


def exhume(bones):
    """Exhume every buried name, reciting its recorded depth."""
    for name, depth in bones.iteritems():
        print "exhuming", name, "at", depth
