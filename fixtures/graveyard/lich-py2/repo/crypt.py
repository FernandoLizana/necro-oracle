def bury(names):
    bones = {}
    for n in names:
        print "burying", n
        bones[n] = 0777
    return bones


def exhume(bones):
    for name, depth in bones.iteritems():
        print "exhuming", name, "at", depth
