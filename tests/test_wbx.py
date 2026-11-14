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

def test_placement_forms_must_agree():
    text = open(EX).read().replace('wb:place-tol="50"', 'wb:place-tol="80"')
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.wb.svg")
        open(p, "w").write(text)
        _, errs = wbx.check(wbx.rd(p))
    assert any("feature control frame" in e for e in errs) and any("drawn zone" in e for e in errs)

def test_loose_placement_tolerance_is_caught():
    m = wbx.canon(wbx.rd(EX)); m['tol']['width'] = 100
    _, errs = wbx.check(m)
    assert any(e.startswith("placement") and "die edge clearance" in e for e in errs)

def test_moved_die_is_caught():
    text = open(EX).read().replace("translate(1750 4250) scale(1 -1)", "translate(1950 4250) scale(1 -1)")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.wb.svg")
        open(p, "w").write(text)
        _, errs = wbx.check(wbx.rd(p))
    assert errs

# ---- fiducials (draft) ----
def test_fiducials_read_in_both_frames():
    F = {f['name']: f for f in wbx.rd(EX)['fid']}
    assert (F['F1']['frame'], F['F1']['role'], F['F1']['datum']) == ('board', 'align', 'B')
    assert F['P1']['role'] == 'orient'
    assert (F['QR']['frame'], F['QR']['shape'], F['TRI']['shape']) == ('U1', 'g', 'path')
    m = wbx.rd(EX)
    assert wbx.fref(F['QR'], m) == (1750 + 100, 4250 - 100)   # bounding-box centre, out of the die's flipped frame

def test_look_alike_eye_points_warn():
    m = wbx.canon(wbx.rd(EX)); F = {f['name']: f for f in m['fid']}
    qr = F['QR']; tri = F['TRI']
    tri.clear(); tri.update(name='QR2', frame='U1', role='align', shape='g',
                            parts=[dict(p, x=p['x'] + 2300, y=p['y'] + 2300) for p in qr['parts']])
    res, errs = wbx.check(m)
    assert errs == [] and any(w.startswith('F5') for w in res.get('warn', []))

def test_fiducial_near_a_land_or_off_the_die_is_an_error():
    m = wbx.canon(wbx.rd(EX)); F = {f['name']: f for f in m['fid']}
    l = m['lands'][0]; F['P1'].update(x=l['x'] + l['w'] + 100, y=l['y'])
    F['TRI']['path'] = 'M2600,2470 L2330,2470 L2470,2330 Z'
    _, errs = wbx.check(m)
    assert any(e.startswith('F3 P1') for e in errs) and any(e.startswith('F2 U1.TRI') for e in errs)

def test_one_eye_point_warns():
    m = wbx.canon(wbx.rd(EX)); m['fid'] = [f for f in m['fid'] if f['name'] != 'TRI']
    res, errs = wbx.check(m)
    assert errs == [] and any(w.startswith('F1 U1') for w in res['warn'])

def test_curved_fiducial_path_is_refused():
    try:
        wbx.pathpts('M0,0 C10,10 20,10 30,0 Z')
    except ValueError:
        return
    assert False, 'a curve should be refused'
