import urllib2


def summon(url):
    """Summon the raw bytes that live at a URL."""
    try:
        data = urllib2.urlopen(url).read()
    except Exception, e:
        print "summon failed:", e
        return None
    print "summoned", len(data), "bytes"
    return data


def chant(times):
    """Chant a counting loop the given number of times."""
    i = 0L
    while i <> times:
        print "chant", i
        i = i + 1
