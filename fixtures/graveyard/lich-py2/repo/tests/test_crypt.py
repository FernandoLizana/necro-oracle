import crypt


def test_bury_records_zero_depth():
    assert crypt.bury(["ash", "yew"]) == {"ash": 0, "yew": 0}


def test_bury_empty_is_empty():
    assert crypt.bury([]) == {}
