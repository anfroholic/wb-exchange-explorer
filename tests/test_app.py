"""Drive the Wire Bond Bench in a real browser, and hand what it writes to KiCad itself.

Needs Playwright and Chrome. KiCad checks need kicad-cli, and real-chip checks need the sibling repos;
each skips without them. Run with: python -m pytest tests/test_app.py
"""
import io, json, os, re, shutil, subprocess, zipfile
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

REPO = Path(__file__).resolve().parent.parent
APP = (REPO / "app" / "index.html").as_uri()
GITHUB = REPO.parent
RUN2 = GITHUB / "chip-on-board-wire-bonded-pcbs" / "run-2"
EURO = GITHUB / "eurosynth" / "final_chip" / "gds" / "chip_top.gds.gz"
BOARD_1X0P5 = RUN2 / "1x0p5-cob" / "mezzanine-1x0p5.kicad_pcb"
PADRING = GITHUB / "chip-on-board-wire-bonded-pcbs" / "lib" / "WaferSpace.pretty" / "waferspace_p5xp5_padring.kicad_mod"
KICAD_CLI = shutil.which("kicad-cli") or r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"
has_kicad = os.path.exists(KICAD_CLI)
real_chip = pytest.mark.skipif(not (EURO.exists() and BOARD_1X0P5.exists()), reason="needs the eurosynth and COB repos alongside this one")
needs_kicad = pytest.mark.skipif(not has_kicad, reason="needs kicad-cli")


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome", headless=True)
        except Exception as e:
            pytest.skip(f"no Chrome for Playwright: {e}")
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1600, "height": 950}, accept_downloads=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(APP)
    pg.wait_for_function("() => WBX.app && WBX.app.ready")
    yield pg
    assert not pg.errors, pg.errors
    ctx.close()


def settle(pg, timeout=120_000):
    pg.wait_for_timeout(150)
    pg.wait_for_function("() => document.getElementById('busy').hidden", timeout=timeout)
    pg.wait_for_timeout(150)
    pg.wait_for_function("() => document.getElementById('busy').hidden", timeout=timeout)


def load(pg, *paths):
    pg.set_input_files("#pickAny", [str(p) for p in paths])
    pg.wait_for_timeout(100)
    settle(pg)


def state(pg):
    return pg.evaluate("""() => { const a = WBX.app, S = a.S; return {
        lands: S.lands.length, pads: S.die ? S.die.pads.length : 0, wires: S.wires.length, regime: S.regime, rot: S.place.rot,
        dieW: S.die ? S.die.x1 - S.die.x0 : null, dieH: S.die ? S.die.y1 - S.die.y0 : null,
        padLayer: S.die && S.die.info.padLayer, firstNet: S.die && S.die.pads[0] && S.die.pads[0].net,
        regimes: Object.fromEntries(Object.entries(a.regimes).map(([k, v]) => [k, v && v.m])),
        checks: a.checks ? Object.fromEntries(a.checks.list.map(c => [c.id, c.status])) : {},
        art: !!(S.die && S.die.artCanvas), source: S.die && S.die.source };}""")


def export(pg, what, tmp_path):
    pg.click("#exportBtn")
    with pg.expect_download() as d:
        pg.click(f"[data-act=export][data-what={what}]")
    out = tmp_path / d.value.suggested_filename
    d.value.save_as(out)
    return out


def kicad(*args, cwd=None):
    r = subprocess.run([KICAD_CLI, *map(str, args)], capture_output=True, text=True, cwd=cwd, timeout=240)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout


def drc(board, tmp_path):
    report = tmp_path / "drc.json"
    kicad("pcb", "drc", "--format", "json", "-o", report, board)
    return json.loads(report.read_text(encoding="utf-8"))


# ---- the examples, from the page itself

def test_gds_on_a_board(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    s = state(page)
    assert (s["pads"], s["lands"], s["wires"]) == (20, 20, 21)      # 21 wires: the example doubles VBUS
    assert s["regime"] == "board" and s["padLayer"] == "37/0" and s["art"]
    assert (round(s["dieW"], 3), round(s["dieH"], 3)) == (2.5, 2.5)
    # Everything passes but one vendor rule: Samtec asks 375 µm from die edge to land, and this example's lands are 150 µm out.
    assert all(v in ("ok", "na", "info") for k, v in s["checks"].items() if k != "landdie"), s["checks"]
    assert s["checks"]["landdie"] == "warn"


def test_two_footprints_need_no_gds(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    s = state(page)
    assert s["source"] == "footprint" and not s["art"]
    assert (s["pads"], s["lands"]) == (20, 20)
    assert s["regimes"]["ring"]["cross"] == 0 and s["regimes"]["ring"]["wires"] == 20


def test_every_regime_can_be_applied_and_type_rules_run(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.evaluate("""() => { const S = WBX.app.S; S.typeRules = [{ match: '^(D?V(DD|SS)|VBUS)$', type: 'PWR33' }]; S.defaultType = 'STD25'; }""")
    for k in ("number", "ring", "nets", "board"):
        page.click(f"[data-regime={k}] p")
        assert state(page)["regime"] == k
    page.click("[data-regime=number] p")
    types = page.evaluate("() => { const S = WBX.app.S; return S.wires.map(w => [S.padBy.get(w.pad).net, w.type]); }")
    assert ["VBUS", "PWR33"] in types and ["A0", "STD25"] in types


def test_manual_wire_survives_a_regime_change_and_moving_the_die_moves_it(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.click("[data-regime=manual] p")
    assert state(page)["wires"] == 0
    page.keyboard.press("w")
    def at(js):
        x, y = page.evaluate(f"""() => {{ const a = WBX.app, S = a.S, v = a.plan; const q = {js}; return v.toScreen(q[0], q[1]); }}""")
        box = page.locator("#plan").bounding_box()
        return box["x"] + x, box["y"] + y
    pad = at("WBX.model.dieToBoard(S.place, S.die.pads[0].x, S.die.pads[0].y)")
    land = at("[S.lands[4].x, S.lands[4].y]")
    page.mouse.click(*pad)
    page.mouse.click(*land)
    assert state(page)["wires"] == 1
    page.click("[data-regime=ring] p")
    wires = page.evaluate("() => WBX.app.S.wires.filter(w => w.pinned).map(w => [w.pad, w.land])")
    assert len(wires) == 1 and state(page)["wires"] == 20
    before = page.evaluate("() => { const S = WBX.app.S, e = WBX.model.wireEnds(S, S.wires[0]); return e.a; }")
    page.keyboard.press("m")
    box = page.locator("#plan").bounding_box()
    cx, cy = at("WBX.model.dieToBoard(S.place, 0, 0)")
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 25, cy + 12, steps=4); page.mouse.up()
    after = page.evaluate("() => { const S = WBX.app.S, e = WBX.model.wireEnds(S, S.wires[0]); return e.a; }")
    assert after != before and state(page)["wires"] == 20


def test_session_survives_a_reload(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.evaluate("() => WBX.app.saveNow()")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    s = state(page)
    assert (s["pads"], s["lands"], s["wires"]) == (20, 20, 21) and s["art"]
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    assert state(page)["pads"] == 0


def test_bad_files_explain_themselves(page, tmp_path):
    bad = tmp_path / "broken.gds"
    bad.write_bytes(b"not gds at all")
    wrong = tmp_path / "wrong.kicad_pcb"
    wrong.write_text('(footprint "x")')
    load(page, bad)
    load(page, wrong)
    toasts = page.locator(".toast").all_inner_texts()
    assert any("not a GDSII" in t for t in toasts) and any("not a .kicad_pcb" in t for t in toasts)


def test_file_contents_never_become_markup(page, tmp_path):
    mod = tmp_path / "evil.kicad_mod"
    mod.write_text('(footprint "<img src=x onerror=window.pwned=1>" (layer "F.Cu") '
                   '(fp_rect (start -1 -1) (end 1 1) (stroke (width 0.02) (type solid)) (fill no) (layer "F.Fab")) '
                   '(pad "1<b>" smd rect (at 0.8 0) (size 0.1 0.1) (layers "F.Cu") (net 1 "<img src=x onerror=window.pwned=2>")))')
    load(page, mod)
    page.click("[data-act=dieMode][data-mode=footprint]")
    page.set_input_files("#pickAny", [str(mod)])
    settle(page)
    page.click("[data-tab=wires]")
    page.wait_for_timeout(100)
    assert page.evaluate("() => window.pwned") is None
    assert page.locator("#left img, #right img, #inspector img").count() == 0


# ---- KiCad itself

@needs_kicad
def test_example_board_opens_in_kicad_and_round_trips(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    assert len(list((tmp_path / "out" / "3d").glob("W*.wrl"))) == 21
    assert "violations" in drc(pcb, tmp_path)
    # Read back what we wrote: the die, wires and types all come home, by regime "board".
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, pcb)
    s = state(page)
    assert (s["pads"], s["lands"], s["wires"]) == (20, 20, 21)
    assert s["regime"] == "board" and s["source"] == "footprint"
    assert page.evaluate("() => { const S = WBX.app.S; return S.wires.filter(w => w.type === 'PWR33').length; }") == 2


@needs_kicad
def test_footprint_substrate_gets_a_board_kicad_will_open(page, tmp_path):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    drc(pcb, tmp_path)
    kicad("pcb", "export", "svg", "--layers", "F.Cu,User.1", "--mode-single", "-o", tmp_path / "plot.svg", pcb)
    assert (tmp_path / "plot.svg").stat().st_size > 1000


@needs_kicad
def test_die_kit_is_valid_for_kicad_and_the_footprint_reads_back_the_same(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    before = page.evaluate("() => WBX.app.S.die.pads.map(p => [p.num, p.net, +p.x.toFixed(4), +p.y.toFixed(4), +p.w.toFixed(4), +p.h.toFixed(4)])")
    z = export(page, "kit", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "kit")
    lib = next((tmp_path / "kit").glob("*.pretty"))
    kicad("fp", "upgrade", "--force", lib, "-o", tmp_path / "up.pretty")
    mod = next((tmp_path / "up.pretty").glob("*.kicad_mod"))
    text = mod.read_text(encoding="utf-8")
    assert "(image" in text and '"1 ' in text
    sym = next((tmp_path / "kit").glob("*.kicad_sym"))
    kicad("sym", "upgrade", "--force", sym, "-o", tmp_path / "up.kicad_sym")
    assert "(pin " in (tmp_path / "up.kicad_sym").read_text(encoding="utf-8")
    # KiCad's own re-save of the footprint is the second option: a footprint standing in for the GDS.
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, tmp_path / "up.pretty" / mod.name)      # it says wb_kind die, so it goes to the die without being told
    after = page.evaluate("() => WBX.app.S.die.pads.map(p => [p.num, p.net, +p.x.toFixed(4), +p.y.toFixed(4), +p.w.toFixed(4), +p.h.toFixed(4)])")
    assert sorted(after) == sorted(before)
    assert state(page)["art"]


# ---- real files

@real_chip
def test_real_chip_on_its_run2_board(page):
    load(page, BOARD_1X0P5, EURO)
    s = state(page)
    assert s["padLayer"] == "37/0" and s["pads"] == 72 and s["lands"] == 72 and s["rot"] == 0
    assert s["firstNet"] == "clk_PAD"       # pad 1 beside the QR, as the GDS, the board and the slot config all say
    m = s["regimes"]["number"]
    assert m["wires"] == 72 and m["cross"] == 0 and m["agree"] == m["compared"] == 72
    assert round(m["longest"], 2) == 2.95 and round(m["worstAngle"], 1) == 45.4     # the plan's numbers for this pairing
    assert s["regime"] == "number" and s["art"]
    # Section 10's numbers are for these wire sizes, which now have to be asked for.
    page.evaluate("""() => { const S = WBX.app.S; S.typeRules = [{ match: '^(D?V(DD|SS)|VBUS)$', type: 'PWR33' }]; S.defaultType = 'STD25'; }""")
    page.click("[data-regime=number] p")
    s = state(page)
    # As section 10 of the plan flags. Pad opening per wire diameter (P2) is what catches pads too small for 33 µm wire now;
    # the absolute opening (P1) is quoted for 25 µm wire, and runs on every wire.
    assert s["checks"]["angle"] == "warn" and s["checks"]["padd"] == "warn"


@real_chip
@needs_kicad
def test_real_assembly_in_kicad_keeps_fab_outputs_unchanged(page, tmp_path):
    load(page, BOARD_1X0P5, BOARD_1X0P5.with_suffix(".kicad_pro"), BOARD_1X0P5.with_suffix(".kicad_sch"), EURO)
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    # KiCad places a footprint's image in board coordinates, so the artwork has to name the die's position on the board.
    text = pcb.read_text(encoding="utf-8")
    die_at = re.search(r'\(footprint "chip_top".*?\(at ([\d.]+) ([\d.]+)', text, re.S)
    image_at = re.search(r'\(image \(at ([\d.]+) ([\d.]+)\)', text)
    assert image_at[1] == die_at[1] and image_at[2] == die_at[2]
    report = drc(pcb, tmp_path)
    orig = drc(BOARD_1X0P5, tmp_path)
    assert len(report["unconnected_items"]) == len(orig["unconnected_items"])
    # Nothing new but the board-only die, wires and type library, which KiCad notes have no library to compare against.
    new = [v for v in report["violations"] if v["type"] != "lib_footprint_issues"]
    old = [v for v in orig["violations"] if v["type"] != "lib_footprint_issues"]
    assert len(new) == len(old), [v["description"] for v in new][:8]
    # The decided model says no copper changes: the generated board's Gerbers match the source board's.
    def gerbers(board, name):
        out = tmp_path / name
        out.mkdir()
        kicad("pcb", "export", "gerbers", "--layers", "F.Cu,B.Cu,F.Mask,F.Paste,F.SilkS,Edge.Cuts", "--no-x2", "--no-netlist", "-o", str(out) + os.sep, board)
        return {f.suffix: re.sub(r"(?m)^G04 #@!.*$|^%TF.*$|^G04 Created.*$", "", f.read_text(encoding="utf-8", errors="replace")) for f in out.iterdir() if f.suffix.startswith(".g") and f.suffix != ".gbrjob"}
    a, b = gerbers(BOARD_1X0P5, "orig"), gerbers(pcb, "mine")
    assert a.keys() == b.keys() and a, a.keys()
    for k in a:
        assert a[k] == b[k], f"{k} changed"


@pytest.mark.skipif(not (PADRING.exists() and EURO.exists()), reason="needs the COB and eurosynth repos alongside this one")
def test_real_footprint_file_as_substrate(page):
    load(page, PADRING)
    s = state(page)
    assert s["lands"] >= 56


# ---- the 3D view: a drag moves the part of the board that was grabbed

def tilt_drag(pg, offset, delta, button="left"):
    """Drag in the 3D view from `offset` px off the pivot by `delta` px. Returns yaw and pitch before and after, and how far the board point under the press moved on screen."""
    box = pg.locator("#tilt").bounding_box()
    px, py = pg.evaluate("() => { const t = WBX.app.tilt; return [t.w / 2 + t.cx, t.h / 2 + t.cy]; }")
    gx, gy = box["x"] + px + offset[0], box["y"] + py + offset[1]
    before = pg.evaluate("""([sx, sy]) => { const t = WBX.app.tilt, a = t.yaw * Math.PI / 180, X = (sx - t.w / 2 - t.cx) / t.z, Y = (sy - t.h / 2 - t.cy) / (t.z * Math.sin(t.pitch * Math.PI / 180));
        const x = t.c0[0] + X * Math.cos(a) + Y * Math.sin(a), y = t.c0[1] - X * Math.sin(a) + Y * Math.cos(a);
        return { yaw: t.yaw, pitch: t.pitch, x, y, at: t.project(x, y, 0) }; }""", [px + offset[0], py + offset[1]])
    assert before["at"][:2] == pytest.approx([px + offset[0], py + offset[1]])
    pg.mouse.move(gx, gy)
    pg.mouse.down(button=button)
    pg.mouse.move(gx + delta[0], gy + delta[1], steps=8)
    pg.mouse.up(button=button)
    after = pg.evaluate("([x, y]) => { const t = WBX.app.tilt; return { yaw: t.yaw, pitch: t.pitch, at: t.project(x, y, 0) }; }", [before["x"], before["y"]])
    return {"dyaw": after["yaw"] - before["yaw"], "dpitch": after["pitch"] - before["pitch"],
            "moved": [after["at"][0] - before["at"][0], after["at"][1] - before["at"][1]]}


def test_3d_drag_moves_the_grabbed_part_of_the_board(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.click("#toolbar [data-act=mode][data-mode='3d']")
    page.wait_for_function("() => WBX.app.tilt.fitted && WBX.app.tilt.c0")

    def home():
        page.evaluate("() => { const t = WBX.app.tilt; t.yaw = -25; t.pitch = 52; }")

    # Sideways: the two halves of the board turn opposite ways, and each follows the cursor.
    home(); below = tilt_drag(page, (0, 150), (80, 0))
    home(); above = tilt_drag(page, (0, -150), (80, 0))
    assert below["dyaw"] == pytest.approx(-28) and above["dyaw"] == pytest.approx(28)
    assert below["moved"][0] > 20 and above["moved"][0] > 20
    home(); assert tilt_drag(page, (0, 150), (-80, 0))["moved"][0] < -20
    home(); assert tilt_drag(page, (0, -150), (-80, 0))["moved"][0] < -20

    # Up and down, by the same test, in all four combinations.
    for off, dy, want in [(150, 60, 18), (150, -60, -18), (-150, 60, -18), (-150, -60, 18)]:
        home()
        d = tilt_drag(page, (0, off), (0, dy))
        assert d["dpitch"] == pytest.approx(want)
        assert d["moved"][1] * dy > 0, (off, dy, d)

    # The sign is locked at the press: a drag that crosses the pivot does not turn back.
    home()
    d = tilt_drag(page, (0, 20), (80, -120))
    assert d["dyaw"] == pytest.approx(-28)

    # Above or below the pivot, not the canvas: pan the pivot well down, then press below the canvas middle but above the pivot.
    tilt_drag(page, (0, 0), (0, 200), button="right")
    assert page.evaluate("() => WBX.app.tilt.cy") == 200
    home()
    assert tilt_drag(page, (0, -100), (80, 0))["dyaw"] == pytest.approx(28)


# ---- picking wires in the 3D view

def tilt_ready(pg):
    pg.get_by_role("button", name="Try a GDS on a board").click()
    settle(pg)
    pg.click("#toolbar [data-act=mode][data-mode='3d']")
    pg.wait_for_timeout(100)


def wire_point(pg):
    """The index and page position of the wire point farthest from every other wire, so a click there can only mean one wire."""
    i, x, y = pg.evaluate("""() => {
        const t = WBX.app.tilt, S = WBX.app.S;
        let best = null;
        for (const r of t.rows) {
            const q = r.pts[r.pts.length >> 1];
            let near = Infinity;
            for (const o of t.rows) if (o !== r) for (const p of o.pts) near = Math.min(near, Math.hypot(p[0] - q[0], p[1] - q[1]));
            if (!best || near > best.near) best = { near, i: S.wires.indexOf(r.w), x: q[0], y: q[1] };
        }
        return [best.i, best.x, best.y];
    }""")
    box = pg.locator("#tilt").bounding_box()
    return i, box["x"] + x, box["y"] + y


def picked(pg):
    return pg.evaluate("() => WBX.app.S.wires.indexOf(WBX.app.selWire)")


def test_clicking_a_wire_in_3d_marks_it_in_the_panel(page):
    tilt_ready(page)
    i, x, y = wire_point(page)
    box = page.locator("#tilt").bounding_box()
    page.mouse.move(box["x"] + 4, box["y"] + box["height"] - 4)
    assert page.evaluate("() => document.getElementById('tilt').style.cursor") == ""
    page.mouse.move(x, y)
    assert page.evaluate("() => document.getElementById('tilt').style.cursor") == "pointer"

    # A drag that starts on a wire orbits and picks nothing.
    view = "() => [WBX.app.tilt.yaw, WBX.app.tilt.pitch]"
    before = page.evaluate(view)
    page.mouse.down(); page.mouse.move(x + 30, y + 20, steps=4); page.mouse.up()
    assert picked(page) == -1 and page.evaluate(view) != before
    page.wait_for_timeout(50)
    i, x, y = wire_point(page)

    # Regimes has no row for a wire, so the click lands on the Wires tab. A shaky click leaves the view where it was.
    before = page.evaluate(view)
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 2, y + 1); page.mouse.up()
    assert picked(page) == i and page.evaluate(view) == before
    assert page.evaluate("() => WBX.app.tab") == "wires"
    assert page.locator("tr.on").evaluate_all("r => r.map(e => +e.dataset.wire)") == [i]

    # Types marks the wire's type without rebuilding the panel.
    page.click("[data-tab=types]")
    want = page.evaluate("() => WBX.app.S.types.indexOf(WBX.model.typeOf(WBX.app.S, WBX.app.selWire.type))")
    assert page.locator(".type.on").evaluate_all("r => r.map(e => +e.dataset.type)") == [want]
    page.evaluate("() => { document.querySelector('.type.on').dataset.kept = 1; }")
    page.mouse.click(box["x"] + 4, box["y"] + box["height"] - 4)
    assert picked(page) == -1 and page.locator(".type.on").count() == 0 and page.evaluate("() => WBX.app.tab") == "types"
    page.mouse.click(x, y)
    assert picked(page) == i and page.locator(".type.on[data-kept]").count() == 1

    # Escape clears it everywhere; the panel still follows a row click, and the 3D view repaints to show it on top.
    page.keyboard.press("Escape")
    assert picked(page) == -1 and page.locator(".type.on").count() == 0
    page.click("[data-tab=wires]")
    page.click("tr[data-wire='3'] td")
    page.wait_for_timeout(50)
    assert page.evaluate("() => { const t = WBX.app.tilt; return t.rows[t.rows.length - 1].w === WBX.app.selWire; }")

    # Picking follows the exaggerated loop, not the true-height one.
    page.keyboard.press("Escape")
    page.locator("#zExag").evaluate("e => { e.value = 5; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.wait_for_timeout(50)
    i, x, y = wire_point(page)
    page.mouse.click(x, y)
    assert picked(page) == i


def test_checks_tab_marks_entries_naming_the_wire_or_goes_to_wires(page):
    tilt_ready(page)
    # The one rule this example trips, die edge to land, names every wire, so it goes off here.
    page.evaluate("() => { WBX.app.S.rules.landToDie.on = false; WBX.app.refresh(); }")
    page.click("[data-tab=checks]")
    i, x, y = wire_point(page)
    # This example passes everything, so the wire has no entry.
    page.mouse.click(x, y)
    assert picked(page) == i and page.evaluate("() => WBX.app.tab") == "wires"
    assert page.locator("tr.on").count() == 1
    # Tighten a limit so every wire is named by that one check.
    page.evaluate("() => { WBX.app.S.limits.lengthMm = 0.01; WBX.app.selWire = null; WBX.app.refresh(); }")
    page.click("[data-tab=checks]")
    page.wait_for_timeout(50)
    page.mouse.click(x, y)
    assert page.evaluate("() => WBX.app.tab") == "checks"
    assert page.locator(".check.hit").evaluate_all("r => r.map(e => e.dataset.check)") == ["length"]


def test_a_picked_wire_scrolls_into_view_even_with_the_wire_tool_left_on(page):
    page.set_viewport_size({"width": 1600, "height": 520})
    tilt_ready(page)
    page.keyboard.press("w")        # left over from the plan view: it must not swallow a 3D click
    page.click("[data-tab=types]")
    # Move the wire's type to the last card, and scroll away from it.
    page.evaluate("() => { const a = WBX.app, S = a.S; S.types.push(S.types.splice(S.types.findIndex(t => t.name === 'STD25'), 1)[0]); a.refresh(); document.getElementById('tabBody').scrollTop = 0; }")
    page.wait_for_timeout(50)
    i, x, y = wire_point(page)
    assert page.evaluate(f"() => WBX.app.S.wires[{i}].type") == "STD25"
    page.mouse.click(x, y)
    assert picked(page) == i and page.locator(".type.on").count() == 1
    assert page.evaluate("""() => { const b = document.getElementById('tabBody').getBoundingClientRect(), c = document.querySelector('.type.on').getBoundingClientRect();
        return c.top < b.bottom && c.bottom > b.top && document.getElementById('tabBody').scrollTop > 0; }""")
    # The sticky header must not cover a row scrolled up from below.
    page.click("[data-tab=wires]")
    page.evaluate("() => { const b = document.getElementById('tabBody'); b.scrollTop = b.scrollHeight; }")
    page.keyboard.press("Escape")
    page.mouse.click(x, y)
    assert page.evaluate("""() => { const h = document.querySelector('table.wires th').getBoundingClientRect(), b = document.getElementById('tabBody').getBoundingClientRect(), c = document.querySelector('tr.on').getBoundingClientRect();
        return c.top >= h.bottom - 1 && c.bottom <= b.bottom + 1; }""")


# ---- the undefined wire: pad to land is set, and the wire and loop are the bonder's call

def types_in_use(pg):
    return pg.evaluate("() => [...new Set(WBX.app.S.wires.map(w => w.type))]")


def test_new_session_wires_are_generic_under_every_regime(page):
    assert page.evaluate("() => { const S = WBX.app.S; return [S.defaultType, S.typeRules, S.types[0].name, S.types[1].name]; }") == ["GENERIC", [], "GENERIC", "UNDEFINED"]
    assert page.evaluate("() => WBX.app.S.types.map(t => t.name).includes('STD25') && WBX.app.S.types.map(t => t.name).includes('PWR33')")
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    # A net name that the old power rule would have caught.
    page.evaluate("() => { WBX.app.S.die.pads[0].net = 'VBUS'; WBX.app.S.lands[0].net = 'VBUS'; }")
    for k in ("number", "ring"):
        page.click(f"[data-regime={k}] p")
        assert state(page)["wires"] and types_in_use(page) == ["GENERIC"], k
    assert page.evaluate("() => WBX.model.REGIMES.nets.run(WBX.app.S).every(w => w.type === 'GENERIC')")
    # The regimes that read a file, fed directly: a drawn line gets the default, and board wires that name no type we can read stay undefined,
    # because nobody said anything about them. One that names GENERIC keeps it.
    assert page.evaluate("""() => { const a = WBX.app, S = a.S, M = WBX.model, p = S.die.pads[0], q = M.dieToBoard(S.place, p.x, p.y), l = S.lands[0];
        S.drawn = [[q[0], q[1], l.x, l.y]]; S.boardWires = [{ from: 'D1.' + p.num, to: l.id, type: null }, { from: 'D1.' + p.num, to: l.id, type: 'NO_SUCH_TYPE' }, { from: 'D1.' + p.num, to: l.id, type: 'GENERIC' }];
        const d = M.REGIMES.drawn.run(S), b = M.REGIMES.board.run(S);
        return d.length === 1 && d[0].type === 'GENERIC' && b.map(w => w.type).join() === 'UNDEFINED,UNDEFINED,GENERIC'; }""")
    # By hand, with the Wire tool.
    page.click("[data-regime=manual] p")
    assert state(page)["wires"] == 0
    page.keyboard.press("w")
    def at(js):
        x, y = page.evaluate(f"() => {{ const a = WBX.app, S = a.S, q = {js}; return a.plan.toScreen(q[0], q[1]); }}")
        box = page.locator("#plan").bounding_box()
        return box["x"] + x, box["y"] + y
    page.mouse.click(*at("WBX.model.dieToBoard(S.place, S.die.pads[0].x, S.die.pads[0].y)"))
    page.mouse.click(*at("[S.lands[4].x, S.lands[4].y]"))
    assert state(page)["wires"] == 1 and types_in_use(page) == ["GENERIC"]


def test_undefined_is_labelled_and_the_default_is_shown(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    page.click("[data-tab=types]")
    assert "New wires get Generic: bonder's choice" in page.locator("#defaultNote").inner_text()
    gen, und = page.locator(".type").nth(0), page.locator(".type").nth(1)
    assert "Generic: bonder's choice" in gen.inner_text() and "default" in gen.inner_text() and "decision" in gen.inner_text()
    assert "Undefined: not specified" in und.inner_text() and "Nobody has said" in und.inner_text() and und.locator(".tag").count() == 0
    for card in (gen, und):
        assert card.locator("input, [data-act=delType]").count() == 0 and card.get_attribute("data-tip")
    # Picking another default moves the mark and the sentence at once.
    page.select_option("[data-bind=defaultType]", "STD25")
    assert "New wires get STD25" in page.locator("#defaultNote").inner_text()
    assert page.locator(".type").nth(2).locator(".tag").inner_text() == "default" and gen.locator(".tag").count() == 0
    page.click("[data-tab=wires]")
    first = page.locator("table.wires tbody tr").first
    assert first.locator("select").evaluate("s => s.selectedOptions[0].text") == "Generic" and "≈" in first.inner_text()
    page.evaluate("() => { WBX.app.S.wires[0].type = 'UNDEFINED'; }")
    page.click("[data-tab=types]")
    page.click("[data-tab=wires]")
    first = page.locator("table.wires tbody tr").first
    assert first.locator("select").evaluate("s => s.selectedOptions[0].text") == "Undefined" and "≈" in first.inner_text()


def test_undefined_wires_draw_dashed_in_plan_loop_and_3d(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    page.evaluate("""() => { window.dashed = []; const P = CanvasRenderingContext2D.prototype, set = P.setLineDash, st = P.stroke; let on = false;
        P.setLineDash = function (d) { on = d.length > 0; return set.call(this, d); };
        P.stroke = function () { window.dashed.push([this.canvas.id, on, this.strokeStyle]); return st.apply(this, arguments); }; }""")
    def strokes(canvas, paint, name, dashed=True):
        return page.evaluate(f"""() => {{ window.dashed.length = 0; const a = WBX.app; {paint};
            const col = WBX.model.DEFAULT_TYPES().find(t => t.name === '{name}').colour;
            return window.dashed.filter(d => d[0] === '{canvas}' && d[1] === {'true' if dashed else 'false'} && d[2] === col).length; }}""")
    n = state(page)["wires"]
    loop = "WBX.view.drawLoop(document.getElementById('loop'), a.S, a.S.wires[0], WBX.model.wireEnds(a.S, a.S.wires[0]))"
    # A new session's wires are generic: solid, never dashed.
    assert strokes("plan", "a.plan.paint()", "GENERIC", dashed=False) >= n and strokes("plan", "a.plan.paint()", "GENERIC") == 0
    assert strokes("loop", loop, "GENERIC", dashed=False) == 1 and strokes("loop", loop, "GENERIC") == 0
    page.evaluate("() => { for (const w of WBX.app.S.wires) w.type = 'UNDEFINED'; }")
    assert strokes("plan", "a.plan.paint()", "UNDEFINED") == n
    assert strokes("loop", loop, "UNDEFINED") == 1
    page.click("#toolbar [data-act=mode][data-mode='3d']")
    assert strokes("tilt", "a.tilt.paint()", "UNDEFINED") == n
    page.evaluate("() => { for (const w of WBX.app.S.wires) w.type = 'GENERIC'; }")
    assert strokes("tilt", "a.tilt.paint()", "GENERIC", dashed=False) == n and strokes("tilt", "a.tilt.paint()", "GENERIC") == 0


def test_checks_on_undefined_wires_are_not_passes_or_failures(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    page.click("[data-regime=ring] p")
    # Limits nothing could meet: a wire with a size or a loop would fail these. A pad too small for any wire, too.
    page.evaluate("""() => { const a = WBX.app, S = a.S; Object.assign(S.limits, { edgeUm: 1e6, moldUm: 1 }); S.die.pads.forEach(p => { p.w = p.h = 0.01; }); a.checks = WBX.model.check(S); }""")
    got = page.evaluate("""() => WBX.app.checks.list.map(c => [c.id, c.status, c.value, c.wires.length])""")
    by = {c[0]: c for c in got}
    for k in ("edge", "mold", "padd", "loop", "edged"):
        assert by[k][1] == "na" and "not checked" in by[k][2] and by[k][3] == 0, by[k]
    assert by["undefined"][1] == "info" and by["undefined"][2] == "20 of 20"
    # Pad opening and pitch are about the die, not the wire, so they run on every wire, as length does.
    for k in ("length", "angle", "gap", "onpad", "padsize", "pitch"):
        assert by[k][1] in ("ok", "warn", "fail"), by[k]
    assert "estimate" in by["length"][2]
    assert page.evaluate("""() => { const S = WBX.app.S; return S.wires.every(w => { const e = WBX.model.wireEnds(S, w), p = WBX.model.wireProfile(S, w, e);
        return p.undef && [p.span, p.peak, p.clearance, p.exit, ...p.curve.flat()].every(Number.isFinite); }); }""")
    # Pairing checks still bite: swap two neighbouring lands and the wires cross.
    page.evaluate("""() => { const a = WBX.app, S = a.S, x = S.wires[3], y = S.wires[4], l = x.land; x.land = y.land; y.land = l; a.checks = WBX.model.check(S); }""")
    assert page.evaluate("() => WBX.app.checks.list.find(c => c.id === 'cross').status") == "fail"
    # The page calls them not checked, and a mix says so beside its pass.
    page.evaluate("() => { const S = WBX.app.S; S.wires[0].type = 'STD25'; S.limits.edgeUm = 1; S.limits.moldUm = 0; }")
    page.click("[data-tab=checks]")
    assert page.locator("[data-check=edge] .tag").inner_text() == "pass, 19 not checked"
    assert "19 left to the bonder, not checked" in page.locator("[data-check=edge] .val").inner_text()
    page.evaluate("() => { const S = WBX.app.S; S.wires[0].type = 'UNDEFINED'; }")
    page.click("[data-tab=wires]")
    page.click("[data-tab=checks]")
    assert page.locator("[data-check=edge] .tag").inner_text() == "not checked"


WIRE_FP = re.compile(r'\(footprint "wbx_wire"\n.*?\n\t\)', re.S)


def test_undefined_export_claims_nothing_and_reads_back_undefined(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.click("[data-regime=number] p")        # the example board's own wires carry types; the number rule's don't
    n = state(page)["wires"]
    assert types_in_use(page) == ["GENERIC"]
    page.evaluate("() => { for (const w of WBX.app.S.wires) w.type = 'UNDEFINED'; }")
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    text = pcb.read_text(encoding="utf-8")
    wires = WIRE_FP.findall(text)
    assert len(wires) == n
    for w in wires:
        assert '"wb_type" "UNDEFINED"' in w and "(stroke (width 0) (type dash))" in w
    assert '"wb_type_UNDEFINED" "not specified: no wire or loop given; the 3D model is a 20 um visual stand-in, not a wire size or loop"' in text
    assert "wb_type_GENERIC" not in text        # only listed when a wire uses it
    assert '"wb_type_STD25" "ball-wedge Au 25 forward' in text      # the types people can opt into are still listed
    csv = export(page, "bond", tmp_path).read_text(encoding="utf-8").splitlines()
    assert csv[1].split(",")[11] == "UNDEFINED" and csv[1].split(",")[13] == ""
    # Read back.
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, pcb)
    s = state(page)
    assert s["regime"] == "board" and s["wires"] == n and types_in_use(page) == ["UNDEFINED"]
    # A library that tries to give UNDEFINED a spec doesn't get to.
    forged = tmp_path / "forged.kicad_pcb"
    forged.write_text(text.replace("not specified: no wire or loop given; the 3D model is a 20 um visual stand-in, not a wire size or loop", "ball-wedge Au 25 forward 180/0"), encoding="utf-8")
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, forged)
    assert page.evaluate("() => { const t = WBX.app.S.types.find(t => t.name === 'UNDEFINED'); return [t.d, t.material, WBX.model.isUndefinedType(t)]; }") == [0, "", True]
    # A board with no type information at all, from anyone else.
    bare = tmp_path / "bare.kicad_pcb"
    bare_text = re.sub(r'\n\s*\(property "wb_type(_\w+)?" [^\n]*', "", text)
    assert '"wb_type' not in bare_text
    bare.write_text(bare_text, encoding="utf-8")
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, bare)
    s = state(page)
    assert s["regime"] == "board" and s["wires"] == n and types_in_use(page) == ["UNDEFINED"]


def test_real_types_export_as_before(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    assert "PWR33" in types_in_use(page) and "UNDEFINED" not in types_in_use(page)
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    text = next((tmp_path / "out").glob("*.kicad_pcb")).read_text(encoding="utf-8")
    wires = "".join(WIRE_FP.findall(text))
    assert "UNDEFINED" not in text and "GENERIC" not in text and "(type dash)" not in wires
    assert wires.count("(stroke (width 0.025) (type solid))") + wires.count("(stroke (width 0.033) (type solid))") == 21
    assert '"wb_type" "PWR33"' in wires and '"wb_type_PWR33"' in text
    row = export(page, "bond", tmp_path).read_text(encoding="utf-8").splitlines()[1].split(",")
    assert row[11] not in ("UNDEFINED", "GENERIC") and float(row[13]) > 0


def test_old_session_loads_with_undefined_added_and_its_choices_kept(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    # What a session saved before this type existed looks like, with a type of its own that happens to use the name.
    page.evaluate("""async () => { const S = WBX.app.S;
        S.types = S.types.filter(t => !WBX.model.isBonderChoice(t));
        S.types.push({ name: 'UNDEFINED', family: 'custom', style: 'ball-wedge', material: 'Au', d: 18, dir: 'forward', moves: '100/0', interp: 'spline', colour: '#123456' });
        S.typeRules = [{ match: '^(D?V(DD|SS)|VBUS)$', type: 'PWR33' }, { match: '^A0$', type: 'UNDEFINED' }]; S.defaultType = 'STD25';
        S.wires[0].type = 'UNDEFINED'; S.wires[1].type = 'DOWN25';
        await WBX.app.saveNow(); }""")
    before = page.evaluate("() => WBX.app.S.wires.slice(1).map(w => [w.pad, w.land, w.type])")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    got = page.evaluate("""() => { const S = WBX.app.S; return { first: S.types[1].name, flag: WBX.model.isUndefinedType(S.types[1]), gen: WBX.model.isGenericType(S.types[0]), names: S.types.map(t => t.name), d: S.types.find(t => t.name === 'UNDEFINED_1').d,
        wire0: S.wires[0].type, wires: S.wires.slice(1).map(w => [w.pad, w.land, w.type]), rules: S.typeRules, def: S.defaultType }; }""")
    assert got["first"] == "UNDEFINED" and got["flag"] and got["gen"] and got["names"][0] == "GENERIC" and {"STD25", "PWR33", "DOWN25"} <= set(got["names"])
    assert got["d"] == 18 and got["wire0"] == "UNDEFINED_1" and got["wires"] == before
    assert got["def"] == "STD25" and got["rules"] == [{"match": "^(D?V(DD|SS)|VBUS)$", "type": "PWR33"}, {"match": "^A0$", "type": "UNDEFINED_1"}]
    # Start over gives the new defaults, not the old session's.
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    assert page.evaluate("() => { const S = WBX.app.S; return [S.defaultType, S.typeRules.length]; }") == ["GENERIC", 0]


def test_undefined_cant_be_deleted_or_renamed_and_catches_deleted_types(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.click("[data-tab=types]")
    for k in (0, 1):
        assert page.locator(".type").nth(k).locator("[data-act=delType]").count() == 0
    # A real type can't take either reserved name, in any case.
    for reserved in ("undefined", "Generic"):
        field = page.locator(".type [data-bind='type.name']").first
        assert field.input_value() == "STD25"
        field.fill(reserved)
        field.press("Tab")
        assert "STD25" in page.evaluate("() => WBX.app.S.types.map(t => t.name)")
    # Deleting the default type leaves its wires, and the default, on generic.
    page.evaluate("() => { WBX.app.S.defaultType = 'STD25'; }")
    count = page.evaluate("() => WBX.app.S.wires.filter(w => w.type === 'STD25').length")
    assert count
    page.locator(".type").nth(2).locator("[data-act=delType]").click()
    assert page.evaluate("() => { const S = WBX.app.S; return [S.defaultType, S.wires.filter(w => w.type === 'GENERIC').length, S.types.some(t => t.name === 'STD25')]; }") == ["GENERIC", count, False]
    # Deleting another type sends its wires to whatever the default is.
    page.evaluate("() => { const S = WBX.app.S; S.defaultType = 'DOWN25'; S.wires[0].type = 'PWR33'; WBX.app.renderRight && WBX.app.renderRight(); }")
    page.click("[data-tab=wires]")
    page.click("[data-tab=types]")
    i = page.evaluate("() => WBX.app.S.types.findIndex(t => t.name === 'PWR33')")
    page.locator(".type").nth(i).locator("[data-act=delType]").click()
    assert page.evaluate("() => [WBX.app.S.wires[0].type, WBX.app.S.defaultType]") == ["DOWN25", "DOWN25"]


@needs_kicad
def test_undefined_wires_survive_a_save_in_kicad(page, tmp_path):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    n = state(page)["wires"]
    page.evaluate("() => { for (const w of WBX.app.S.wires) w.type = 'UNDEFINED'; }")
    assert types_in_use(page) == ["UNDEFINED"]
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    # Its 3D model is the shared stand-in arc: 33 rings of six points, in the neutral grey with no gold highlight.
    wrl = (tmp_path / "out" / "3d" / "W01.wrl").read_text(encoding="utf-8")
    assert "0.663 0.706 0.694" in wrl and "specularColor 0.35 0.35 0.35" in wrl and re.search(r"point \[ (.*?) \]", wrl)[1].count(",") == 33 * 6 - 1
    kicad("pcb", "upgrade", "--force", pcb)
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    load(page, pcb)
    s = state(page)
    assert s["regime"] == "board" and s["wires"] == n and types_in_use(page) == ["UNDEFINED"]


# ---- several die: side by side or stacked, with wires die to board and die to die

SMALL_DIE = ('(footprint "small_die" (layer "F.Cu") (property "Reference" "U9" (at 0 0 0) (layer "F.Fab")) '
             '(fp_rect (start -0.5 -0.5) (end 0.5 0.5) (stroke (width 0.02) (type solid)) (fill no) (layer "F.Fab")) '
             '(pad "1" smd rect (at -0.4 0) (size 0.08 0.08) (layers "F.Cu") (net 1 "LINK")) '
             '(pad "2" smd rect (at 0.4 0) (size 0.08 0.08) (layers "F.Cu")) '
             '(pad "3" smd rect (at 0 -0.4) (size 0.08 0.08) (layers "F.Cu")) '
             '(pad "4" smd rect (at 0 0.4) (size 0.08 0.08) (layers "F.Cu")))')


def add_small_die(pg, tmp_path):
    """The GDS example, plus a second, smaller die from a footprint, which starts beside the first."""
    pg.get_by_role("button", name="Try a GDS on a board").click()
    settle(pg)
    assert pg.locator(".dielist").count() == 0          # one die: no list, only the way to add another
    pg.click("[data-act=addDie]")
    pg.click("[data-act=dieMode][data-mode=footprint]")
    mod = tmp_path / "small_die.kicad_mod"
    mod.write_text(SMALL_DIE)
    pg.evaluate("() => { document.getElementById('pickAny').dataset.role = 'die'; }")
    pg.set_input_files("#pickAny", [str(mod)])
    settle(pg)


def dies(pg):
    return pg.evaluate("""() => { const S = WBX.app.S, M = WBX.model; return S.dies.map(d => ({ id: d.id, pads: d.die ? d.die.pads.length : 0, on: d.place.on,
        bottom: d.die ? M.dieBottom(S, d) : null, top: d.die ? M.dieTop(S, d) : null })); }""")


def wire_kinds(pg):
    return pg.evaluate("""() => { const S = WBX.app.S, M = WBX.model; return S.wires.map(w => ({ from: M.wireDieId(S, w) + '.' + w.pad,
        to: M.isDieToDie(w) ? w.toDie + '.' + w.toPad : 'land ' + w.land, d2d: M.isDieToDie(w), pinned: !!w.pinned })); }""")


def stack_small_on_first(pg):
    pg.select_option("[data-bind='place.on']", "D1")
    pg.wait_for_timeout(50)


def plan_at(pg, js):
    x, y = pg.evaluate(f"() => {{ const a = WBX.app, S = a.S, M = WBX.model, q = {js}; return a.plan.toScreen(q[0], q[1]); }}")
    box = pg.locator("#plan").bounding_box()
    return box["x"] + x, box["y"] + y


def pad_at(pg, die, i):
    return plan_at(pg, f"(() => {{ const d = M.dieById(S, '{die}'), p = d.die.pads[{i}]; return M.dieToBoard(d.place, p.x, p.y); }})()")


def test_a_second_die_stacks_and_its_height_follows(page, tmp_path):
    add_small_die(page, tmp_path)
    d = dies(page)
    assert [x["id"] for x in d] == ["D1", "D2"] and d[1]["pads"] == 4 and page.locator(".dierow").count() == 2
    assert d[1]["bottom"] == 25 and page.evaluate("() => WBX.app.S.active") == "D2"
    # Beside the first, it doesn't overlap, and its own wires start by hand while D1 keeps the board's.
    st = state(page)
    assert st["checks"]["overlap"] == "ok" and st["wires"] == 21
    stack_small_on_first(page)
    d = dies(page)
    assert d[1]["on"] == "D1" and d[1]["bottom"] == d[0]["top"] + 25 == 330 and d[1]["top"] == 610
    assert page.evaluate("() => { const S = WBX.app.S, M = WBX.model; return M.outlinesOverlap(S.dies[0], S.dies[1]); }")
    assert "Underside 330" in page.locator("#dieHeights").inner_text()
    # D1 gets thicker and moves: D2 rises with it and goes along.
    page.click(".dierow[data-id=D1]")
    page.fill("[data-bind='place.thick']", "400")
    page.locator("[data-bind='place.thick']").press("Tab")
    assert dies(page)[1]["bottom"] == 25 + 400 + 25
    before = page.evaluate("() => { const S = WBX.app.S; return [S.dies[1].place.x - S.dies[0].place.x, S.dies[1].place.y - S.dies[0].place.y]; }")
    page.fill("[data-bind='place.x']", str(page.evaluate("() => WBX.app.S.dies[0].place.x + 0.3")))
    page.locator("[data-bind='place.x']").press("Tab")
    after = page.evaluate("() => { const S = WBX.app.S; return [S.dies[1].place.x - S.dies[0].place.x, S.dies[1].place.y - S.dies[0].place.y]; }")
    assert after == pytest.approx(before)
    # A custom height: at 0 it's in the same space as D1, which the checks call out.
    page.click(".dierow[data-id=D2]")
    page.select_option("[data-bind='place.on']", "custom")
    assert dies(page)[1]["bottom"] == 450
    page.fill("[data-bind='place.customUm']", "0")
    page.locator("[data-bind='place.customUm']").press("Tab")
    assert dies(page)[1]["bottom"] == 0 and state(page)["checks"]["overlap"] == "fail"
    # Removing the lower die brings the upper one down to what it sat on.
    page.select_option("[data-bind='place.on']", "D1")
    page.click(".dierow[data-id=D1] [data-act=removeDie]")
    d = dies(page)
    assert [x["id"] for x in d] == ["D2"] and d[0]["on"] == "board" and d[0]["bottom"] == 25
    assert all(k["from"].startswith("D2.") for k in wire_kinds(page))


def wire_stack(page, tmp_path):
    """D2 on D1, with one wire from D2 to a D1 pad and one from D2 to a land, both by hand."""
    add_small_die(page, tmp_path)
    stack_small_on_first(page)
    page.keyboard.press("w")
    page.mouse.click(*pad_at(page, "D2", 0))
    page.mouse.click(*pad_at(page, "D1", 0))
    page.mouse.click(*pad_at(page, "D2", 1))
    page.mouse.click(*plan_at(page, "[S.lands[10].x, S.lands[10].y]"))
    page.keyboard.press("v")
    k = [x for x in wire_kinds(page) if x["pinned"]]
    assert len(k) == 2 and k[0]["d2d"] and k[0]["from"] == "D2.1" and k[0]["to"].startswith("D1.") and not k[1]["d2d"]
    return k


def test_die_to_die_and_die_to_land_wires_survive_a_regime_change_and_a_reload(page, tmp_path):
    pinned = wire_stack(page, tmp_path)
    # Both ends of a die to die wire are up on a die, at different heights.
    z = page.evaluate("""() => { const S = WBX.app.S, M = WBX.model, w = S.wires.find(M.isDieToDie), e = M.wireEnds(S, w), p = M.wireProfile(S, w, e);
        return [p.zTop, p.zEnd, p.curve[0][1], p.curve[p.curve.length - 1][1]]; }""")
    assert z == pytest.approx([610, 305, 610, 305])
    # A regime for D2 runs against the lands. D1's wires, and the pinned ones, stay.
    page.click("[data-regime=ring] p")
    assert [x for x in wire_kinds(page) if x["pinned"]] == pinned
    assert sum(1 for x in wire_kinds(page) if x["from"].startswith("D1.") and not x["d2d"]) == 21
    # Now D1, under the number rule. D2's wires stay.
    page.click(".dierow[data-id=D1]")
    page.click("[data-regime=number] p")
    k = wire_kinds(page)
    assert [x for x in k if x["pinned"]] == pinned and state(page)["regime"] == "number"
    assert sum(1 for x in k if x["from"].startswith("D1.")) == 19      # pad 1 already has the wire from D2
    # The Select tool drags the far end of a die to die wire, on the D1 pad.
    page.evaluate("() => { const S = WBX.app.S; WBX.app.selWire = S.wires.find(WBX.model.isDieToDie); WBX.app.refresh(); }")
    end = page.evaluate("() => { const S = WBX.app.S, e = WBX.model.wireEnds(S, WBX.app.selWire); return WBX.app.plan.toScreen(...e.b); }")
    box = page.locator("#plan").bounding_box()
    page.mouse.move(box["x"] + end[0], box["y"] + end[1]); page.mouse.down(); page.mouse.move(box["x"] + end[0] + 2, box["y"] + end[1] + 1, steps=2); page.mouse.up()
    assert page.evaluate("() => !!WBX.app.selWire.toPadOff && !WBX.app.selWire.padOff")
    # A reload brings back both die, the stack and every wire.
    page.evaluate("() => WBX.app.saveNow()")
    before = wire_kinds(page)
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    assert wire_kinds(page) == before and dies(page)[1]["on"] == "D1" and dies(page)[1]["bottom"] == 330
    # The nets regime pairs pads on different die when nothing on the board carries the net, and the far pad is free.
    page.evaluate("""() => { const S = WBX.app.S, p = S.dies[0].die.pads[5]; p.net = 'LINK';
        S.wires = S.wires.filter(w => !w.pinned && !(w.die === 'D1' && w.pad === p.num)); WBX.app.selectDie('D2'); WBX.app.refresh(); }""")
    page.click("[data-regime=nets] p")
    assert {"from": "D2.1", "to": "D1." + page.evaluate("() => WBX.app.S.dies[0].die.pads[5].num"), "d2d": True, "pinned": False} in wire_kinds(page)


def test_3d_draws_the_stack_in_order_and_picks_a_die_to_die_wire(page, tmp_path):
    wire_stack(page, tmp_path)
    page.click("#toolbar [data-act=mode][data-mode='3d']")
    page.wait_for_timeout(150)
    assert page.evaluate("() => WBX.app.tilt.paintOrder().map(d => d.id)") == ["D1", "D2"]
    for d2d in ("true", "false"):
        i, x, y = page.evaluate("""() => { const t = WBX.app.tilt, S = WBX.app.S, M = WBX.model;
            const r = t.rows.find(r => r.w.pinned && M.isDieToDie(r.w) === %s), q = r.pts[Math.round(r.pts.length * 0.3)];
            return [S.wires.indexOf(r.w), q[0], q[1]]; }""" % d2d)
        box = page.locator("#tilt").bounding_box()
        page.keyboard.press("Escape")
        page.mouse.click(box["x"] + x, box["y"] + y)
        assert picked(page) == i, d2d
    page.screenshot(path=str(tmp_path / "stack3d.png"))


def test_several_die_export_and_read_back_with_both_kinds_of_wire(page, tmp_path):
    wire_stack(page, tmp_path)
    before = sorted((k["from"], k["to"]) for k in wire_kinds(page))
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    text = pcb.read_text(encoding="utf-8")
    assert '"wb_from" "D2.1"' in text and '"wb_to_kind" "die"' in text and '"wb_sits_on" "D1"' in text
    assert (tmp_path / "out" / "3d" / "die.wrl").exists() and (tmp_path / "out" / "3d" / "die_D2.wrl").exists()
    csv = export(page, "bond", tmp_path).read_text(encoding="utf-8").splitlines()
    assert csv[0].endswith(",to_kind,origin") and any(",D2.1,D1." in r and r.split(",")[-2] == "die" for r in csv[1:])

    def read_back(board):
        page.click("[data-act=reset]")
        page.wait_for_timeout(100)
        load(page, board)
        d = dies(page)
        assert [x["id"] for x in d] == ["D1", "D2"] and d[1]["on"] == "D1" and d[1]["bottom"] == 330
        assert state(page)["regime"] == "board"
        assert sorted((k["from"], k["to"]) for k in wire_kinds(page)) == before
    read_back(pcb)
    if has_kicad:
        drc(pcb, tmp_path)
        saved = pcb.with_name("saved_by_kicad.kicad_pcb")       # a new name: the file input ignores the same file twice
        shutil.copy(pcb, saved)
        kicad("pcb", "upgrade", "--force", saved)
        read_back(saved)


WB = "{urn:wbx:0.1}"


def wb_svg(pg, tmp_path):
    from lxml import etree
    f = export(pg, "svg", tmp_path)
    assert f.name.endswith(".wb.svg")
    return f, etree.parse(str(f)).getroot()


def wb_kind(root, kind):
    return [e for e in root.iter() if e.get(WB + "kind") == kind]


def bonds_on_pads(root):
    """Every wire's die end, taken back through its die group's transform, lies on the pad its wb:from names."""
    import math
    groups = {g.get(WB + "name"): g for g in wb_kind(root, "die")}
    wires = wb_kind(root, "wire")
    for w in wires:
        die, pad = w.get(WB + "from").split(".", 1)
        g = groups[die]
        m = re.fullmatch(r"translate\(([-\d.]+) ([-\d.]+)\)(?: rotate\(([-\d.]+)\))? scale\(1 -1\)", g.get("transform"))
        tx, ty, r = float(m[1]), float(m[2]), math.radians(float(m[3] or 0))
        dx, dy = float(w.get("x1")) - tx, float(w.get("y1")) - ty
        gx, gy = dx * math.cos(r) + dy * math.sin(r), -(-dx * math.sin(r) + dy * math.cos(r))
        p = next(e for e in g if e.get(WB + "kind") == "pad" and e.get(WB + "name") == pad)
        x, y, pw, ph = (float(p.get(k)) for k in ("x", "y", "width", "height"))
        assert x - 1e-3 <= gx <= x + pw + 1e-3 and y - 1e-3 <= gy <= y + ph + 1e-3, (w.get(WB + "name"), gx, gy, x, y)
    return len(wires)


def wbx_check(path):
    import sys
    sys.path.insert(0, str(REPO))
    import wbx
    m = wbx.rd(str(path))
    return m, wbx.check(m)[1]


def test_wb_svg_of_the_example_passes_the_python_checker(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    f, root = wb_svg(page, tmp_path)
    assert f.name == "example.wb.svg"
    assert root.get(WB + "version") == "0.1" and root.get(WB + "units") == "um" and root.get(WB + "rule-wire-gap") == "60"
    assert not root.findall(".//{http://www.w3.org/2000/svg}script")
    m, errs = wbx_check(f)
    assert errs == [] and len(m["wires"]) == 21 and len(m["pads"]) == 20 and len(m["lands"]) == 20
    assert {p["name"] for p in m["prof"]} == {"STD25", "PWR33", "DOWN25"}
    assert all(w["frm"].startswith("D1.") for w in m["wires"])
    assert bonds_on_pads(root) == 21
    # The die's top is the attach and die stacked on the board, as the app has them.
    die = next(s for s in m["stack"] if s["role"] == "die")
    assert die["z"] == 25 and die["t"] == 280
    # The artwork goes in as decoration: an image with no wb:kind.
    assert len(root.findall(".//{http://www.w3.org/2000/svg}image")) == 1


DIAG_SVG = "() => document.getElementById('diagPicture').shadowRoot.querySelector('svg')"


def test_diagram_view_shows_the_file_the_export_writes_and_follows_edits(page, tmp_path):
    # Before a die: a word on what it's for, no error.
    page.click("#toolbar [data-act=mode][data-mode=diagram]")
    assert page.locator("#diagTools").is_visible() and page.locator("#diagMsg").is_visible()
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.wait_for_timeout(400)
    assert not page.locator("#diagMsg").is_visible()
    assert page.locator("#diagMeta").inner_text().startswith("example.wb.svg · ")
    # The drawing: in its own shadow root, sized to fit, with every wire there and hover text on it, and its style kept inside.
    pic = page.evaluate(f"""() => {{ const s = ({DIAG_SVG})(), r = s.getRootNode(), b = s.getBoundingClientRect();
        return {{ wires: r.querySelectorAll('[*|kind=wire]').length, titled: r.querySelectorAll('[*|kind=wire] > title').length, w: b.width, h: b.height,
                 font: getComputedStyle(document.querySelector('#toolbar button')).fontFamily }}; }}""")
    assert pic["wires"] == 21 and pic["titled"] == 21 and pic["w"] > 300 and pic["h"] > 100
    assert "Helvetica" not in pic["font"]
    w0 = pic["w"]
    page.click("#diagTools [data-act=diagZoom][data-what=in]")
    assert page.evaluate(f"() => ({DIAG_SVG})().getBoundingClientRect().width") > w0 * 1.4
    page.click("#toolbar [data-act=fit]")
    assert abs(page.evaluate(f"() => ({DIAG_SVG})().getBoundingClientRect().width") - w0) < 2
    # It follows edits: turn the die and the drawing turns with it, without leaving the view.
    page.click("#toolbar [data-act=rotate]")
    page.wait_for_timeout(500)
    die = page.evaluate(f"() => [...({DIAG_SVG})().getRootNode().querySelectorAll('[*|kind=die]')].map(g => g.getAttribute('transform')).join()")
    assert "rotate(-90)" in die
    # Both: drawing and code side by side. The code is highlighted, wb: attributes marked, the artwork shortened only here.
    page.click("#diagTools [data-act=diagPane][data-tab=both]")
    code = page.locator("#diagCode")
    assert code.is_visible() and page.locator("#diagPicture").is_visible()
    assert code.locator(".sx-wb", has_text="wb:kind").count() > 21
    assert "shortened in this view" in code.inner_text() and "rotate(-90)" in code.inner_text()
    page.click("#diagTools [data-act=diagPane][data-tab=code]")
    assert code.is_visible() and not page.locator("#diagPicture").is_visible()
    assert untipped(page) == []
    # Download from the view is byte for byte the menu's export.
    with page.expect_download() as d:
        page.click("#diagTools [data-act=diagDownload]")
    shown = tmp_path / "shown.wb.svg"
    d.value.save_as(shown)
    exported = export(page, "svg", tmp_path)
    assert shown.read_bytes() == exported.read_bytes()
    assert "shortened" not in exported.read_text(encoding="utf-8")
    # Other views hide it again.
    page.click("#toolbar [data-act=mode][data-mode=plan]")
    assert not page.locator("#diagBox").is_visible() and not page.locator("#diagTools").is_visible()


def test_wb_svg_draws_generic_wires_and_a_turned_die(page, tmp_path):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    f, root = wb_svg(page, tmp_path)
    prof = wb_kind(root, "profile")
    assert [(p.get(WB + "name"), p.get(WB + "choice")) for p in prof] == [("GENERIC", "generic")]
    assert {w.get("stroke-width") for w in wb_kind(root, "wire")} == {"20"} and not any(w.get("stroke-dasharray") for w in wb_kind(root, "wire"))
    m, errs = wbx_check(f)
    assert errs == [] and len(m["wires"]) == 20
    page.click("#toolbar [data-act=rotate]")
    f, root = wb_svg(page, tmp_path)
    assert "rotate(-90)" in wb_kind(root, "die")[0].get("transform")
    assert bonds_on_pads(root) == 20


def test_wb_svg_names_both_ends_of_a_die_to_die_wire(page, tmp_path):
    wire_stack(page, tmp_path)
    f, root = wb_svg(page, tmp_path)
    assert sorted(g.get(WB + "name") for g in wb_kind(root, "die")) == ["D1", "D2"]
    d2d = [w for w in wb_kind(root, "wire") if w.get(WB + "to-kind") == "die"]
    assert len(d2d) == 1 and d2d[0].get(WB + "from") == "D2.1" and d2d[0].get(WB + "to").startswith("D1.")
    assert bonds_on_pads(root) == 23
    # D2 sits on D1: its layer starts at D1's top plus attach.
    d2 = next(e for e in wb_kind(root, "layer") if e.get(WB + "name") == "D2")
    assert -float(d2.get("y")) - float(d2.get("height")) == 330


def test_old_single_die_snapshot_still_loads(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.wait_for_timeout(1200)
    # A session as saved before several die: one die and its placement at the top level, and wires with no die.
    n = page.evaluate("""async () => { const S = WBX.app.S, die = Object.assign({}, S.die); delete die.artCanvas;
        const snap = { v: 1, substrate: { text: S.substrate.text, fileName: S.substrate.fileName, selected: S.substrate.selected }, die, gdsFile: null,
            place: { x: S.place.x, y: S.place.y, rot: S.place.rot, thick: 280, attach: 25 }, wires: S.wires.map(w => ({ pad: w.pad, land: w.land, type: w.type, seq: w.seq })),
            types: S.types, typeRules: [], defaultType: S.defaultType, limits: S.limits, bond: S.bond, numberOffset: 0, regime: 'board', sidecars: {}, maxLand: 2, landSkip: [],
            gdsOpts: S.gdsOpts, netOverride: {}, dieRemoved: [], dieMode: 'gds', layers: null, placeNote: null };
        const db = await new Promise(ok => { const r = indexedDB.open('wire-bond-bench', 1); r.onsuccess = () => ok(r.result); });
        await new Promise(ok => { const t = db.transaction('session', 'readwrite'); t.objectStore('session').put(snap, 'current'); t.oncomplete = ok; });
        db.close(); return snap.wires.length; }""")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    s = state(page)
    assert (s["pads"], s["lands"], s["wires"]) == (20, 20, n) and s["regime"] == "board"
    assert [x["id"] for x in dies(page)] == ["D1"] and not any(k["d2d"] for k in wire_kinds(page))
    assert page.locator(".dielist").count() == 0 and page.locator("[data-act=addDie]").count() == 1


# ---- selecting several wires, and changing them together

def wires_ready(pg):
    pg.get_by_role("button", name="Try a GDS on a board").click()
    settle(pg)
    pg.click("[data-tab=wires]")


def selected(pg):
    return pg.evaluate("() => { const a = WBX.app, S = a.S; return [...a.selWires].map(w => S.wires.indexOf(w)).sort((x, y) => x - y); }")


def row(pg, i):
    return pg.locator(f"tr[data-wire='{i}'] td").first


def marked_rows(pg):
    return pg.locator("tr.on").evaluate_all("r => r.map(e => +e.dataset.wire)")


def test_wire_list_selects_like_a_desktop_list(page):
    wires_ready(page)
    n = state(page)["wires"]
    row(page, 3).click()
    assert selected(page) == [3] and picked(page) == 3 and marked_rows(page) == [3]
    assert page.locator("#inspector h4").inner_text().startswith("Wire W04")
    # Shift selects a range from the anchor, in the order shown, and selects no text.
    row(page, 6).click(modifiers=["Shift"])
    assert selected(page) == [3, 4, 5, 6] and marked_rows(page) == [3, 4, 5, 6]
    assert page.evaluate("() => getSelection().toString()") == ""
    # Ctrl toggles one and moves the anchor; Ctrl+Shift adds a range to what's there.
    row(page, 9).click(modifiers=["Control"])
    assert selected(page) == [3, 4, 5, 6, 9] and picked(page) == 9
    row(page, 11).click(modifiers=["Control", "Shift"])
    assert selected(page) == [3, 4, 5, 6, 9, 10, 11]
    row(page, 4).click(modifiers=["Control"])
    assert selected(page) == [3, 5, 6, 9, 10, 11] and marked_rows(page) == [3, 5, 6, 9, 10, 11]
    # Shift alone replaces the selection with the range, upward too.
    row(page, 2).click(modifiers=["Shift"])
    assert selected(page) == [2, 3, 4]
    assert page.locator("#inspector h4").inner_text() == "3 wires selected"
    # Ctrl+A in the list takes every wire; Escape clears.
    page.keyboard.press("Control+a")
    assert selected(page) == list(range(n)) and len(marked_rows(page)) == n
    page.keyboard.press("Escape")
    assert selected(page) == [] and picked(page) == -1 and marked_rows(page) == []
    # The arrows move through the list, and Shift stretches from the anchor.
    row(page, 3).click()
    page.keyboard.press("ArrowDown")
    assert selected(page) == [4]
    page.keyboard.press("Shift+ArrowDown"); page.keyboard.press("Shift+ArrowDown")
    assert selected(page) == [4, 5, 6] and picked(page) == 6
    # A plain click still picks one wire alone, with its own panel.
    row(page, 8).click()
    assert selected(page) == [8] and picked(page) == 8 and page.locator("#inspector h4").inner_text().startswith("Wire W09")
    # Ctrl+A in a text field is the field's own.
    page.click("[data-tab=types]")
    field = page.locator(".type [data-bind='type.name']").nth(1)
    field.click()
    page.keyboard.press("Control+a")
    assert selected(page) == [8] and page.evaluate("() => { const e = document.activeElement; return e.selectionEnd - e.selectionStart; }") == len(field.input_value())


def test_bulk_edit_sets_every_selected_wire_and_shows_mixed(page):
    wires_ready(page)
    types = page.evaluate("() => WBX.app.S.types.map(t => t.name)")
    assert len(types) >= 3
    # Give the three wires two types and one pin, so both read as mixed.
    page.evaluate(f"() => {{ const S = WBX.app.S; S.wires[2].type = {json.dumps(types[1])}; S.wires[3].type = {json.dumps(types[2])}; S.wires[4].type = {json.dumps(types[2])}; S.wires.forEach(w => {{ w.pinned = false; }}); S.wires[2].pinned = true; WBX.app.refresh(); }}")
    before = page.evaluate("() => WBX.app.S.wires.map(w => [w.type, !!w.pinned])")
    row(page, 2).click()
    row(page, 4).click(modifiers=["Shift"])
    ins = page.locator("#inspector")
    assert ins.locator("h4").inner_text() == "3 wires selected"
    pick = ins.locator("[data-bind=selType]")
    assert pick.input_value() == "" and "Mixed" in pick.locator("option:checked").inner_text()
    assert pick.locator("option").count() == len(types) + 1
    pin = ins.locator("[data-bind=bulkPin]")
    assert pin.evaluate("e => e.indeterminate") and "mixed" in ins.locator(".bulkpin").inner_text()
    # A type change reaches the three and nothing else, and pins nothing, as a single change doesn't.
    target = types[0]
    pick.select_option(target)
    after = page.evaluate("() => WBX.app.S.wires.map(w => [w.type, !!w.pinned])")
    assert [after[i][0] for i in (2, 3, 4)] == [target] * 3
    assert [a for i, a in enumerate(after) if i not in (2, 3, 4)] == [b for i, b in enumerate(before) if i not in (2, 3, 4)]
    assert [a[1] for a in after] == [b[1] for b in before]
    assert selected(page) == [2, 3, 4] and ins.locator("[data-bind=selType]").input_value() == target
    # Pinned: mixed, then all, then none.
    ins.locator("[data-bind=bulkPin]").click()
    assert page.evaluate("() => WBX.app.S.wires.slice(2, 5).map(w => !!w.pinned)") == [True] * 3
    ins.locator("[data-bind=bulkPin]").click()
    assert page.evaluate("() => WBX.app.S.wires.slice(2, 5).map(w => !!w.pinned)") == [False] * 3
    # Reset ends shows when any has a moved end, and resets them all.
    page.evaluate("() => { const S = WBX.app.S; S.wires[3].padOff = [0.01, 0]; S.wires[4].landOff = [0.02, 0]; WBX.app.refresh(); }")
    ins.locator("[data-act=resetEnds]").click()
    assert page.evaluate("() => WBX.app.S.wires.slice(2, 5).some(w => w.padOff || w.landOff)") is False
    # Several wires ask before going, as there's no undo. Declined, nothing goes.
    n = state(page)["wires"]
    keep = page.evaluate("() => WBX.app.S.wires.filter((w, i) => i < 2 || i > 4).map(w => [w.pad, w.land])")
    page.once("dialog", lambda d: d.dismiss())
    page.locator("table.wires").focus()
    page.keyboard.press("Delete")
    assert state(page)["wires"] == n and selected(page) == [2, 3, 4]
    page.once("dialog", lambda d: d.accept())
    page.locator("table.wires").focus()
    page.keyboard.press("Delete")
    assert state(page)["wires"] == n - 3 and selected(page) == []
    assert page.evaluate("() => WBX.app.S.wires.map(w => [w.pad, w.land])") == keep
    # One wire goes without asking, as before.
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    row(page, 0).click()
    page.keyboard.press("Delete")
    assert state(page)["wires"] == n - 4 and not dialogs


def test_selection_shows_in_both_views_and_ctrl_click_there_adds(page):
    wires_ready(page)
    magenta = """() => { const a = WBX.app; a.plan.paint(); const c = a.plan.c, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 217) < 6 && Math.abs(d[i + 1] - 58) < 6 && Math.abs(d[i + 2] - 167) < 6) n++; return n; }"""
    none = page.evaluate(magenta)
    row(page, 2).click()
    one = page.evaluate(magenta)
    row(page, 7).click(modifiers=["Shift"])
    many = page.evaluate(magenta)
    assert none < one < many
    # No end handles with several selected, so a drag can't move one wire's end by surprise.
    assert page.evaluate("() => { const a = WBX.app, S = a.S, e = WBX.model.wireEnds(S, a.selWire), [x, y] = a.plan.toScreen(...e.b); const h = a.plan.hit(x, y); return !h || h.kind !== 'handle'; }")

    # Ctrl+click on a wire in the plan adds it; a plain click picks it alone.
    page.keyboard.press("Escape")
    row(page, 2).click()
    i, x, y = page.evaluate("""() => { const a = WBX.app, S = a.S, v = a.plan;
        for (let i = S.wires.length - 1; i >= 0; i--) { const e = WBX.model.wireEnds(S, S.wires[i]), [x, y] = v.toScreen((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2), h = v.hit(x, y);
            if (i !== 2 && h && h.kind === 'wire' && h.w === S.wires[i]) return [i, x, y]; } }""")
    box = page.locator("#plan").bounding_box()
    page.keyboard.down("Control"); page.mouse.click(box["x"] + x, box["y"] + y); page.keyboard.up("Control")
    assert selected(page) == sorted([2, i]) and picked(page) == i
    page.keyboard.down("Control"); page.mouse.click(box["x"] + x, box["y"] + y); page.keyboard.up("Control")
    assert selected(page) == [2]
    page.mouse.click(box["x"] + x, box["y"] + y)
    assert selected(page) == [i]

    # The 3D view paints every selected wire last, the primary on top, and Ctrl+click there adds too.
    page.click("#toolbar [data-act=mode][data-mode='3d']")
    page.wait_for_timeout(100)
    i, x, y = wire_point(page)
    j = 0 if i else 1
    page.click("[data-tab=wires]")
    row(page, j).click()
    page.keyboard.down("Control"); page.mouse.click(x, y); page.keyboard.up("Control")
    page.wait_for_timeout(50)
    assert selected(page) == sorted([i, j]) and picked(page) == i
    assert page.evaluate("() => { const t = WBX.app.tilt, a = WBX.app, r = t.rows.slice(-2).map(r => r.w); return a.selWires.has(r[0]) && r[1] === a.selWire; }")
    page.keyboard.down("Control"); page.mouse.click(x, y); page.keyboard.up("Control")
    assert selected(page) == [j]
    page.mouse.click(x, y)
    assert selected(page) == [i]


def test_selection_clears_when_wires_are_regenerated_and_isnt_saved(page):
    wires_ready(page)
    row(page, 1).click()
    row(page, 5).click(modifiers=["Shift"])
    assert len(selected(page)) == 5
    page.click("[data-tab=regimes]")
    page.click("[data-regime=ring] p")
    assert selected(page) == [] and picked(page) == -1
    assert page.locator("#inspector h4").inner_text() == "Nothing selected"
    page.click("[data-tab=wires]")
    row(page, 0).click()
    page.keyboard.press("Control+a")
    page.evaluate("() => WBX.app.saveNow()")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    assert selected(page) == [] and page.evaluate("() => WBX.app.S.wires.length") > 0


# ---- the generic wire: a decision to leave the wire and loop to the bonder, drawn along the same stand-in path as undefined

def test_generic_and_undefined_follow_one_path(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    got = page.evaluate("""() => { const S = WBX.app.S, M = WBX.model, out = [];
        for (const w of S.wires) {
            const e = M.wireEnds(S, w), keep = w.type;
            w.type = 'GENERIC'; const g = M.wireProfile(S, w, e);
            w.type = 'UNDEFINED'; const u = M.wireProfile(S, w, e);
            w.type = keep;
            const ref = M.choiceCurve(e), c = g.curve;
            const bend = c.slice(2).map((p, i) => p[1] - 2 * c[i + 1][1] + c[i][1]);
            out.push({ same: JSON.stringify(c) === JSON.stringify(u.curve) && JSON.stringify(c) === JSON.stringify(ref),
                ends: [c[0][1] - e.zA, c[c.length - 1][1] - e.zB], arc: bend.every(v => v < 0), overEdge: g.zOf(g.exit) - e.zA,
                rise: g.peak - Math.max(e.zA, e.zB), span: g.span, dash: [g.dashed, u.dashed], gate: [g.choice, u.choice] });
        }
        return out; }""")
    assert got
    for r in got:
        assert r["same"], r                                   # one path, from one function
        assert r["ends"] == pytest.approx([0, 0], abs=1e-9)
        assert r["arc"], r                                    # one smooth arc: it bends the same way everywhere, so no kinks
        assert r["overEdge"] >= 19.5, r                 # a tube's width above the pad where it leaves the die: it doesn't cut the corner
        assert 0 < r["rise"] < 0.12 * r["span"], r           # shallow: nothing like a loop's rise
        assert r["dash"] == [False, True] and r["gate"] == [True, True]
    # Both end heights count, neither of them 0: up onto a taller die, it levels off at the high end and arrives there.
    p = page.evaluate("() => WBX.model.choicePath(1000, 330, 610)")
    assert p[0][1] == pytest.approx(330) and p[-1][1] == pytest.approx(610)
    assert all(q[1] >= 610 for q in p if q[0] >= 900 and q[0] < 1000)
    # Asked to pass over a die edge, it lifts just enough, and stays one arc.
    q = page.evaluate("() => { const M = WBX.model, p = M.choicePath(330, 305, 0, [[110, 325]]); return [M.zAt(p, 110), p.length]; }")
    assert q[0] >= 325 - 0.5 and q[1] == 33


def test_generic_gates_checks_exactly_as_undefined_does(page):
    page.get_by_role("button", name="Try two footprints").click()
    settle(page)
    page.click("[data-regime=ring] p")
    run = """(t) => { const S = WBX.app.S; Object.assign(S.limits, { edgeUm: 1e6, moldUm: 1 }); S.wires.forEach((w, i) => { w.type = typeof t === 'string' ? t : t[i % 2]; });
        return WBX.model.check(S).list.map(c => [c.id, c.status, c.value, c.wires.length, c.detail]); }"""
    gen = page.evaluate(run, "GENERIC")
    und = page.evaluate(run, "UNDEFINED")
    mix = page.evaluate(run, ["GENERIC", "UNDEFINED"])
    strip = lambda rows: [r[:4] for r in rows if r[0] != "undefined"]
    assert strip(gen) == strip(und) == strip(mix)
    by = {r[0]: r for r in gen}
    # The loop checks need a loop: not checked. (Which diameter checks exist is the rules panel's business; they match across the two above.)
    for k in ("edge", "mold"):
        assert by[k][1] == "na" and "not checked" in by[k][2], by[k]
    for k in ("length", "angle", "gap", "onpad", "cross"):
        assert by[k][1] in ("ok", "warn", "fail"), by[k]
    # One row counts both kinds, and says how many of each.
    left = [next(r for r in rows if r[0] == "undefined") for rows in (gen, und, mix)]
    assert {tuple(r[1:4]) for r in left} == {("info", "20 of 20", 20)}
    assert "20 generic" in left[0][4] and "20 undefined" in left[1][4] and "10 generic" in left[2][4] and "10 undefined" in left[2][4]


def test_generic_exports_solid_and_reads_back_generic(page, tmp_path):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    page.click("[data-regime=number] p")
    n = state(page)["wires"]
    assert types_in_use(page) == ["GENERIC"]
    page.evaluate("() => { WBX.app.S.wires[0].type = 'UNDEFINED'; }")
    z = export(page, "board", tmp_path)
    zipfile.ZipFile(z).extractall(tmp_path / "out")
    pcb = next((tmp_path / "out").glob("*.kicad_pcb"))
    text = pcb.read_text(encoding="utf-8")
    wires = WIRE_FP.findall(text)
    gen = [w for w in wires if '"wb_type" "GENERIC"' in w]
    assert len(wires) == n and len(gen) == n - 1 and all("(stroke (width 0) (type solid))" in w for w in gen)
    assert '"wb_type_GENERIC" "generic: bonder\'s choice, chosen on purpose; the wire and loop are picked at the machine; the 3D model is a 20 um visual stand-in, not a wire size or loop"' in text
    assert '"wb_type_UNDEFINED" "not specified' in text
    # The 3D model is the shared arc as a neutral tube: 33 rings of six points, with no gold highlight, peaking a little above the pad.
    wrl = (tmp_path / "out" / "3d" / "W02.wrl").read_text(encoding="utf-8")
    pts = [tuple(map(float, v.split())) for v in re.search(r"point \[ (.*?) \]", wrl)[1].split(", ")]
    assert "diffuseColor 0.827 0.859 0.851" in wrl and "specularColor 0.35 0.35 0.35" in wrl and len(pts) == 33 * 6
    zs = [p[2] * 2540 for p in pts]
    top = page.evaluate("() => WBX.model.dieTop(WBX.app.S, WBX.app.S.dies[0])")
    assert top < max(zs) < top + 300 and min(zs) < 20
    csv = export(page, "bond", tmp_path).read_text(encoding="utf-8").splitlines()
    assert csv[2].split(",")[11] == "GENERIC" and csv[2].split(",")[13] == ""
    assert csv[1].split(",")[11] == "UNDEFINED" and csv[1].split(",")[13] == ""

    def read_back(board, want):
        page.click("[data-act=reset]")
        page.wait_for_timeout(100)
        load(page, board)
        s = state(page)
        assert s["regime"] == "board" and s["wires"] == n
        assert page.evaluate("() => WBX.app.S.wires.map(w => w.type)") == want
    read_back(pcb, ["UNDEFINED"] + ["GENERIC"] * (n - 1))
    if has_kicad:
        # Saved by KiCad itself, under another name so the file picker sees a new file.
        saved = tmp_path / "saved.kicad_pcb"
        shutil.copy(pcb, saved)
        kicad("pcb", "upgrade", "--force", saved)
        read_back(saved, ["UNDEFINED"] + ["GENERIC"] * (n - 1))
    # Without wb_type, nobody has said anything: undefined, not generic.
    bare = tmp_path / "bare.kicad_pcb"
    bare.write_text(re.sub(r'\n\s*\(property "wb_type(_\w+)?" [^\n]*', "", pcb.read_text(encoding="utf-8")), encoding="utf-8")
    read_back(bare, ["UNDEFINED"] * n)


def test_session_from_before_generic_loads_with_its_choices_kept(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    # A session saved with UNDEFINED as the default and no GENERIC, and a type of its own that happens to be called Generic.
    page.evaluate("""async () => { const S = WBX.app.S;
        S.types = S.types.filter(t => !WBX.model.isGenericType(t));
        S.types.push({ name: 'Generic', family: 'custom', style: 'ball-wedge', material: 'Au', d: 30, dir: 'forward', moves: '150/0', interp: 'spline', colour: '#654321' });
        S.typeRules = [{ match: '^A0$', type: 'Generic' }]; S.defaultType = 'UNDEFINED';
        S.wires.forEach(w => { w.type = 'UNDEFINED'; }); S.wires[1].type = 'Generic';
        await WBX.app.saveNow(); }""")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    got = page.evaluate("""() => { const S = WBX.app.S, M = WBX.model; return { names: S.types.map(t => t.name), gen: M.isGenericType(S.types[0]), d: S.types.find(t => t.name === 'Generic_1').d,
        types: S.wires.map(w => w.type), rules: S.typeRules, def: S.defaultType }; }""")
    assert got["names"][:2] == ["GENERIC", "UNDEFINED"] and got["gen"] and got["d"] == 30
    assert got["def"] == "UNDEFINED" and got["rules"] == [{"match": "^A0$", "type": "Generic_1"}]
    assert got["types"][1] == "Generic_1" and set(got["types"][:1] + got["types"][2:]) == {"UNDEFINED"}


# ---- DRC rules: one table in app/js/rules.js drives the panel, the checks and docs/wire_bond_design_rules.svg

RULES_SVG = REPO / "docs" / "wire_bond_design_rules.svg"


def drc_ready(pg, which="Try a GDS on a board"):
    pg.get_by_role("button", name=which).click()
    settle(pg)
    pg.click("[data-tab=checks]")


def check_row(pg, cid):
    return pg.evaluate(f"() => {{ const c = WBX.app.checks.list.find(c => c.id === '{cid}'); return c && {{ status: c.status, tier: c.tier, value: c.value, wires: c.wires.length }}; }}")


def test_drc_panel_edits_a_rule_and_the_checks_follow(page):
    drc_ready(page)
    assert check_row(page, "length")["status"] == "ok"
    # Opened from the Checks tab and from the top bar, apart from the placement controls.
    page.click("#tabBody [data-act=openDrc]")
    assert page.locator("#drc").evaluate("d => d.open")
    page.click("#drc [data-act=closeDrc]")
    page.click("#drcBtn")
    field = page.locator("#drc [data-bind='drc.value'][data-rule=lengthMax]")
    field.fill("0.5")
    field.press("Tab")
    row = check_row(page, "length")
    assert row["status"] == "warn" and row["tier"] == "vendor" and row["wires"] > 0
    assert page.evaluate("() => [WBX.app.S.rules.lengthMax.value, WBX.app.S.limits.lengthMm]") == [0.5, 0.5]
    # The shortcut in Checks shows the same value, and the panel says it was changed here.
    assert page.locator("#tabBody [data-check=length] [data-rule=lengthMax]").input_value() == "0.5"
    assert "Changed here" in page.locator("#drc [data-drc=lengthMax]").inner_text()
    # Wording says what is measured and what the limit rests on.
    detail = page.locator("#tabBody [data-check=length] small").inner_text()
    assert "straight plan distance from first bond to second bond" in detail and "25 µm Au" in detail and "not a physical limit" in detail


def test_drc_rule_switched_off_is_off_not_a_pass(page):
    drc_ready(page)
    page.click("#drcBtn")
    page.evaluate("() => { WBX.app.S.limits.lengthMm = 0.01; WBX.app.refresh(); }")
    assert check_row(page, "length")["status"] == "warn"
    page.locator("#drc [data-bind='drc.on'][data-rule=lengthMax]").uncheck()
    row = check_row(page, "length")
    assert row["status"] == "off" and row["wires"] == 0
    assert page.locator("#tabBody [data-check=length] .tag").last.inner_text() == "off"
    assert "off" in page.locator("#drc [data-drc=lengthMax] .tag").inner_text()
    page.locator("#drc [data-bind='drc.on'][data-rule=lengthMax]").check()
    assert check_row(page, "length")["status"] == "warn"


def test_drc_rules_export_then_import_round_trip(page, tmp_path):
    drc_ready(page)
    page.click("#drcBtn")
    page.evaluate("() => { const R = WBX.app.S.rules; R.lengthMax.value = 4.5; R.wireGap.on = false; R.padPitch.value = 80; WBX.app.refresh(); }")
    with page.expect_download() as d:
        page.click("#drc [data-act=drcExport]")
    out = tmp_path / d.value.suggested_filename
    d.value.save_as(out)
    data = json.loads(out.read_text(encoding="utf-8"))
    by = {r["id"]: r for r in data["rules"]}
    assert data["format"] == "wbx-drc-rules" and by["lengthMax"]["value"] == 4.5 and by["wireGap"]["on"] is False and by["padPitch"]["tier"] == "vendor"
    page.on("dialog", lambda dlg: dlg.accept())
    page.click("#drc [data-act=drcReset]")
    assert page.evaluate("() => [WBX.app.S.rules.lengthMax.value, WBX.app.S.rules.wireGap.on]") == [6, True]
    page.set_input_files("#pickRules", str(out))
    page.wait_for_function("() => WBX.app.S.rules.lengthMax.value === 4.5")
    assert page.evaluate("() => [WBX.app.S.rules.wireGap.on, WBX.app.S.rules.padPitch.value, WBX.rules.get(WBX.app.S, 'padPitch').tier]") == [False, 80, "vendor"]
    # A bonding house's own file, with its own source. Its numbers read as theirs, and unknown names are left out.
    house = tmp_path / "house.json"
    house.write_text(json.dumps({"rules": [{"id": "wireGap", "value": 45, "on": True, "source": "Our house, rev A"}, {"id": "noSuchRule", "value": 1}]}), encoding="utf-8")
    page.set_input_files("#pickRules", str(house))
    page.wait_for_function("() => WBX.app.S.rules.wireGap.value === 45")
    g = page.evaluate("() => { const g = WBX.rules.get(WBX.app.S, 'wireGap'); return [g.tier, g.source, WBX.app.S.rules.lengthMax.value]; }")
    assert g == ["vendor", "Our house, rev A", 4.5]
    assert "Your file: Our house, rev A" in page.locator("#drc [data-drc=wireGap]").inner_text()


def test_old_session_limits_become_rules_and_rules_save_with_the_session(page):
    drc_ready(page)
    # What a session saved before the DRC rules holds: five limits, no rules.
    page.evaluate("""async () => { await WBX.app.saveNow();
        const db = await new Promise((ok, bad) => { const r = indexedDB.open('wire-bond-bench', 1); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
        const snap = await new Promise(ok => { const r = db.transaction('session').objectStore('session').get('current'); r.onsuccess = () => ok(r.result); });
        delete snap.rules; snap.limits = { lengthMm: 3.5, angleDeg: 30, gapUm: 80, edgeUm: 55, moldUm: 900 };
        await new Promise(ok => { const t = db.transaction('session', 'readwrite'); t.objectStore('session').put(snap, 'current'); t.oncomplete = ok; });
        db.close(); }""")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    got = page.evaluate("""() => { const R = WBX.app.S.rules; return [R.lengthMax.value, R.angleMax.value, R.wireGap.value, R.edgeClear.value, R.globTop.value, R.globTop.on, R.padPitch.value, WBX.app.S.limits.moldUm]; }""")
    assert got == [3.5, 30, 80, 55, 900, True, 65, 900]
    # A newer session keeps its rules through a reload, and Start over brings the defaults back.
    page.evaluate("async () => { WBX.app.S.rules.padPitch.value = 72; WBX.app.S.rules.keepout.on = false; await WBX.app.saveNow(); }")
    page.reload()
    page.wait_for_function("() => WBX.app && WBX.app.ready")
    assert page.evaluate("() => [WBX.app.S.rules.padPitch.value, WBX.app.S.rules.keepout.on, WBX.app.S.rules.lengthMax.value]") == [72, False, 3.5]
    page.click("[data-act=reset]")
    page.wait_for_timeout(100)
    assert page.evaluate("() => [WBX.app.S.rules.padPitch.value, WBX.app.S.rules.lengthMax.value, WBX.app.S.limits.moldUm]") == [65, 6, 0]


def test_rules_not_enforced_or_needing_a_wire_never_read_as_a_pass(page):
    drc_ready(page, "Try two footprints")
    page.click("[data-tab=regimes]")
    page.click("[data-regime=ring] p")
    page.click("[data-tab=checks]")
    page.click("#drcBtn")
    later = page.evaluate("() => WBX.rules.TABLE.filter(r => r.enforce === 'no').map(r => r.id)")
    assert len(later) >= 3
    for rid in later:
        assert page.locator(f"#drc [data-drc={rid}] .top .tag").inner_text() == "not enforced yet", rid
    ids = page.evaluate("() => WBX.app.checks.list.map(c => c.rule).filter(Boolean)")
    assert not set(later) & set(ids)
    assert check_row(page, "notenforced")["status"] == "na"
    # Every rule needing a wire's diameter or loop reads not checked on bonder's choice wires, and never pass.
    sized = page.evaluate("() => WBX.rules.TABLE.filter(r => r.enforce === 'specified' && r.id !== 'globTop' && r.id !== 'globCover').map(r => r.id)")
    rows = page.evaluate("() => WBX.app.checks.list.filter(c => c.rule).map(c => [c.rule, c.status])")
    for rid, status in rows:
        if rid in sized:
            assert status == "na", (rid, status)
    # A rule that needs only the geometry still runs on them.
    assert dict(rows)["lengthMax"] in ("ok", "warn") and dict(rows)["padPitch"] in ("ok", "warn")


def test_a_tripped_placeholder_warns_and_says_it_is_a_placeholder(page):
    drc_ready(page)
    # Wire gap and edge clearance are ours. Edge clearance would fail as a vendor rule; as a placeholder it only warns.
    page.evaluate("() => { const S = WBX.app.S; S.rules.wireGap.value = 1e5; S.rules.edgeClear.value = 1e5; WBX.app.refresh(); }")
    for cid in ("gap", "edge"):
        row = check_row(page, cid)
        assert row["status"] == "warn" and row["tier"] == "placeholder", (cid, row)
        assert page.locator(f"#tabBody [data-check={cid}] .tier").inner_text() == "Placeholder"
    # The same rule given a vendor's source and tier fails.
    page.evaluate("() => { WBX.app.S.rules.edgeClear.tier = 'vendor'; WBX.app.S.rules.edgeClear.source = 'test'; WBX.app.refresh(); }")
    assert check_row(page, "edge")["status"] == "fail"


def test_rule_defaults_match_the_spec_sheet(page):
    svg = RULES_SVG.read_text(encoding="utf-8")
    sheet = {m["rule"]: m for m in (dict(re.findall(r'data-([\w-]+)="([^"]*)"', g)) for g in re.findall(r'<g class="rule"([^>]*)>', svg))}
    table = page.evaluate("() => WBX.rules.TABLE.map(r => ({ id: r.id, key: r.key, value: r.value, unit: r.unit, tier: r.tier, on: r.on !== false, enforce: r.enforce }))")
    assert len(sheet) == len(table) and sheet.keys() == {r["id"] for r in table}
    for r in table:
        s = sheet[r["id"]]
        assert (s["key"], float(s["value"]), s["unit"], s["tier"], s["on"] == "true", s["enforce"]) == (r["key"], float(r["value"]), r["unit"], r["tier"], r["on"], r["enforce"]), r["id"]
    # Every key drawn on the sheet is a rule in the table.
    keys = {r["key"] for r in table}
    for key in set(re.findall(r'>([WSPLDKB]\d)</text>', svg)):
        assert key in keys, key


def test_drc_rules_walk_every_die_and_both_ends_of_a_die_to_die_wire(page, tmp_path):
    wire_stack(page, tmp_path)
    got = page.evaluate("""() => { const S = WBX.app.S, M = WBX.model, c = M.check(S).list, by = Object.fromEntries(c.map(x => [x.id, x]));
        const d2d = S.wires.find(w => M.isDieToDie(w)), keys = M.wireEndKeys(S, d2d);
        return { ids: c.map(x => x.id), step: by.step && [by.step.status, by.step.tier], keys, both: keys.every(k => k.startsWith('D')) }; }""")
    # D2 sits on D1, so the step from D1's bonded pads to D2's edge is measured; it's a placeholder, so it can only warn.
    assert got["step"] and got["step"][1] == "placeholder" and got["step"][0] in ("ok", "warn")
    assert got["both"] and {"perpad", "multipad", "padmax", "pitch", "padsize"} <= set(got["ids"])
    # Beside D1 on the board instead, the side by side distance is measured.
    page.click(".dierow[data-id=D2]")
    page.select_option("[data-bind='place.on']", "board")
    page.evaluate("() => { const S = WBX.app.S, d = S.dies[1]; d.place.x += 5; WBX.app.refresh(); }")
    row = page.evaluate("() => { const c = WBX.model.check(WBX.app.S).list.find(x => x.id === 'diedie'); return c && [c.status, c.tier]; }")
    assert row and row[1] == "vendor"


# ---- tips: every control and value says what it is and what it changes

TIPPED = ("button, input:not([type=file]), select, [role=button], .tag, .tier, .stats > div, .metrics > div, "
          "table.wires th, #inspector dt, .dierow span, .dierow small")


def untipped(pg):
    """Every visible control and tagged value with no tip of its own or from what holds it, and every native title."""
    pg.evaluate("() => document.querySelectorAll('#left details, #inspector details').forEach(d => { d.open = true; })")
    return pg.evaluate("""sel => { const T = WBX.tips, out = [];
        const seen = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        for (const e of document.querySelectorAll(sel)) {
            if (!seen(e)) continue;
            const a = T.anchorOf(e);
            if (!a || !T.textFor(a).trim()) out.push(e.outerHTML.slice(0, 120));
        }
        for (const e of document.querySelectorAll('[title]')) out.push('title: ' + e.outerHTML.slice(0, 120));
        return out; }""", TIPPED)


def every_view(pg, where):
    """Each tab, each menu, 3D, the DRC rules panel and the inspector, checked for tips. Returns what's missing, by where."""
    missing = []
    def look(what):
        missing.extend(f"{where} / {what}: {m}" for m in untipped(pg))
    for tab in ("regimes", "checks", "wires", "types"):
        pg.click(f"[data-tab={tab}]")
        look(tab)
    for menu in ("sampleMenu", "exportMenu", "showMenu"):
        pg.click(f"[data-menu={menu}]")
        look(menu)
        pg.click(f"[data-menu={menu}]")
    pg.click("#toolbar [data-act=mode][data-mode='3d']")
    look("3d")
    pg.click("#toolbar [data-act=mode][data-mode=diagram]")
    pg.click("#diagTools [data-act=diagPane][data-tab=both]")
    look("diagram")
    pg.click("#diagTools [data-act=diagPane][data-tab=picture]")
    pg.click("#toolbar [data-act=mode][data-mode=plan]")
    pg.click("#drcBtn")
    look("drc")
    pg.click("#drc [data-act=closeDrc]")
    # A pad, a land, one wire, and several wires in the inspector.
    for sel in ("'p' + WBX.model.padKey(S.active, S.die.pads[0].num)", "'l' + S.lands[0].id"):
        pg.evaluate(f"() => {{ const a = WBX.app, S = a.S; a.selWire = null; a.sel = {sel}; a.refresh(); }}")
        look("inspector " + sel[:3])
    pg.click("[data-tab=wires]")
    pg.locator("tr[data-wire='1'] td").first.click()
    look("one wire")
    pg.locator("tr[data-wire='4'] td").first.click(modifiers=["Shift"])
    assert pg.locator("#inspector h4").inner_text() == "4 wires selected"
    look("bulk")
    pg.keyboard.press("Escape")
    return missing


def test_every_control_and_value_has_a_tip(page, tmp_path):
    # Before anything is loaded: the welcome screen, and the export button disabled, which says why.
    assert untipped(page) == []
    assert page.locator("#exportBtn").is_disabled() and "Needs a die" in page.evaluate("() => WBX.tips.textFor(document.getElementById('exportBtn'))")
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    missing = every_view(page, "one die")
    # Two die, the second stacked on the first, so the die list, Sits on and the stack checks show.
    page.click("[data-act=addDie]")
    page.click("[data-act=dieMode][data-mode=footprint]")
    mod = tmp_path / "small_die.kicad_mod"
    mod.write_text(SMALL_DIE)
    page.evaluate("() => { document.getElementById('pickAny').dataset.role = 'die'; }")
    page.set_input_files("#pickAny", [str(mod)])
    settle(page)
    stack_small_on_first(page)
    assert page.locator(".dierow").count() == 2 and page.locator("[data-bind='place.on'] option").count() >= 3
    missing += every_view(page, "two die")
    page.select_option("[data-bind='place.on']", "custom")
    missing += [f"custom height: {m}" for m in untipped(page)]
    assert missing == []


def tip_open(pg):
    return pg.evaluate("() => { const t = document.getElementById('uitip'); return t.matches(':popover-open') ? t.innerText : null; }")


def test_tips_show_on_hover_and_focus_and_go_on_escape_scroll_and_press(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    wire = page.locator("#toolbar [data-tool=wire]")
    want = page.evaluate("() => WBX.tips.textFor(document.querySelector('#toolbar [data-tool=wire]'))")
    # Hover: nothing at once, then the tip after its wait, beside the button and not over it, and inside the window.
    wire.hover()
    page.wait_for_timeout(120)
    assert tip_open(page) is None
    page.wait_for_timeout(500)
    assert tip_open(page) == want and "pinned" in want
    a, t = wire.bounding_box(), page.locator("#uitip").bounding_box()
    assert t["y"] >= a["y"] + a["height"] or t["y"] + t["height"] <= a["y"]
    assert t["x"] >= 0 and t["x"] + t["width"] <= 1600 and t["y"] + t["height"] <= 950
    assert wire.get_attribute("aria-describedby") == "uitip" and wire.get_attribute("title") is None
    # Escape hides it, and it stays hidden over the same button.
    page.keyboard.press("Escape")
    assert tip_open(page) is None
    page.wait_for_timeout(500)
    assert tip_open(page) is None and wire.get_attribute("aria-describedby") is None
    # Keyboard focus shows it too.
    page.mouse.move(800, 940)
    page.locator("#toolbar [data-act=fit]").focus()
    page.keyboard.press("Tab")
    page.wait_for_timeout(600)
    assert page.evaluate("() => document.activeElement.dataset.menu") == "showMenu"
    assert tip_open(page) == page.evaluate("() => WBX.tips.textFor(document.querySelector('[data-menu=showMenu]'))")
    page.keyboard.press("Escape")
    assert tip_open(page) is None
    # Scrolling the panel hides it, and so does pressing the mouse.
    page.click("[data-tab=checks]")
    page.locator("[data-check=length] .tier").hover()
    page.wait_for_timeout(600)
    assert "Europractice" in tip_open(page)
    page.evaluate("() => { const b = document.getElementById('tabBody'); b.scrollTop += 40; }")
    page.wait_for_timeout(50)
    assert tip_open(page) is None
    page.locator("[data-check=length] .tag").hover()
    page.wait_for_timeout(600)
    assert tip_open(page).startswith("Pass")
    page.mouse.down(); page.mouse.up()
    assert tip_open(page) is None
    # No tips over the plan, where dragging happens: only the canvas's own hover tip.
    page.mouse.move(*plan_at(page, "M.dieToBoard(S.place, ...M.dieCentre(S.die))"))
    page.wait_for_timeout(600)
    assert tip_open(page) is None


def test_info_marks_explain_without_acting_and_tips_follow_the_rules(page):
    page.get_by_role("button", name="Try a GDS on a board").click()
    settle(page)
    assert state(page)["regime"] == "board"
    # Clicking the ⓘ in a regime card shows what that regime needs, and doesn't pick the regime.
    page.click("[data-regime=number] .info")
    assert state(page)["regime"] == "board" and tip_open(page).startswith("Needs:")
    assert page.locator("[data-regime=number] .info").get_attribute("aria-label") == "About Number rule"
    # Above the DRC dialog too, and the numbers come from the rule table as it stands now.
    page.click("#drcBtn")
    field = page.locator("#drc [data-bind='drc.value'][data-rule=lengthMax]")
    field.fill("4.5")
    field.press("Tab")
    page.mouse.move(800, 940)
    page.locator("#drc [data-drc=lengthMax] .tier").hover()
    page.wait_for_timeout(600)
    text = tip_open(page)
    assert "Vendor guide" in text and "Default 6 mm" in text and "You changed it to 4.5 mm" in text and "Europractice" in text
    page.locator("#drc [data-drc=wireGap] .tier").hover()
    page.wait_for_timeout(600)
    assert "only ever warns" in tip_open(page)
    page.click("#drc [data-act=closeDrc]")
    page.click("[data-tab=regimes]")
    assert "is 4.5 mm now" in page.evaluate("() => WBX.tips.textFor(document.querySelector('[data-regime=board] [data-tip=\"metric:longest\"]'))")
    # The loop view explains its numbers from an ⓘ beside it, not from the canvas.
    page.click("#loopBox .info")
    assert "peak" in tip_open(page) and "clearance" in tip_open(page)
