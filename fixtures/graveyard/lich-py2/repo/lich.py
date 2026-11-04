import urllib2


def summon(url):
    try:
        data = urllib2.urlopen(url).read()
    except Exception, e:
        print "summon failed:", e
        return None
    print "summoned", len(data), "bytes"
    return data


def chant(times):
    i = 0L
    while i <> times:
        print "chant", i
        i = i + 1
