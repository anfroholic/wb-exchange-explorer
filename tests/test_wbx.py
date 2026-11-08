import os, sys, tempfile
HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
import wbx
EX = os.path.join(HERE, "..", "examples", "example.wb.svg")

def test_example_passes():
    _, errs = wbx.check(wbx.rd(EX))
    assert errs == []

def test_round_trip_is_byte_identical():
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "rt.wb.svg")
        wbx.write(wbx.canon(wbx.rd(EX)), out)
        assert open(out, "rb").read() == open(EX, "rb").read()

def test_moved_die_is_caught():
    text = open(EX).read().replace("translate(1750 4250) scale(1 -1)", "translate(1950 4250) scale(1 -1)")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.wb.svg")
        open(p, "w").write(text)
        _, errs = wbx.check(wbx.rd(p))
    assert errs
