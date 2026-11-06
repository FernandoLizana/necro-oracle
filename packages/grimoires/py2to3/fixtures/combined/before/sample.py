def resurrect(d, x):
    print "summoning", x
    total = 0L
    for k, v in d.iteritems():
        if k <> v:
            print k
    try:
        name = unicode(x)
        label = u"undead"
    except ValueError, err:
        print err
    return total, name, label
