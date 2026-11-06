try:
    risky()
except ValueError, err:
    handle(err)
except (TypeError, KeyError), exc:
    handle(exc)
except Exception as already:
    handle(already)
