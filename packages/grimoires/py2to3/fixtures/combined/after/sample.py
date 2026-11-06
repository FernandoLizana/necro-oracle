def resurrect(d, x):
    print("summoning", x)
    total = 0
    for k, v in d.items():
        if k != v:
            print(k)
    try:
        name = str(x)
        label = "undead"
    except ValueError as err:
        print(err)
    return total, name, label
