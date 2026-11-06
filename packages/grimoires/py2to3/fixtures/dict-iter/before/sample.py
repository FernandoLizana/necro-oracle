def walk(d):
    for k, v in d.iteritems():
        use(k, v)
    for k in d.iterkeys():
        use(k)
    for v in d.itervalues():
        use(v)
    for k, v in d.items():
        use(k, v)
