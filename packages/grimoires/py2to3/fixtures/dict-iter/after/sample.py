def walk(d):
    for k, v in d.items():
        use(k, v)
    for k in d.keys():
        use(k)
    for v in d.values():
        use(v)
    for k, v in d.items():
        use(k, v)
