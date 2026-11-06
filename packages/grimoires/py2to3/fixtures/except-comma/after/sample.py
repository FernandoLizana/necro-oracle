try:
    risky()
except ValueError as err:
    handle(err)
except (TypeError, KeyError) as exc:
    handle(exc)
except Exception as already:
    handle(already)
