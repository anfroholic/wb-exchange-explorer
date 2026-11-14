"""Write docs/wire_bond_design_rules.svg from the rule table in app/js/rules.js.

The table between the BEGIN RULES JSON and END RULES JSON markers is the only place a default value or tier lives.
This script draws the spec sheet from it, and tests/test_app.py checks the sheet and the app agree. Run after
changing a rule: python app/make_rules_svg.py
"""
import html
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_JS = ROOT / "app" / "js" / "rules.js"
OUT = ROOT / "docs" / "wire_bond_design_rules.svg"

GREEN, MAGENTA, BLUE = "#068770", "#d93aa7", "#3ea9da"
DEEP, INK, MUTED, LINE = "#0b6f5d", "#14201d", "#4d5c58", "#8a9a96"
GOLD, GOLD_DARK = "#e8b84a", "#9a6b00"
TIER = {
    "standard": ("STANDARD", GREEN, "#ffffff", "solid", "Read in a published standard (MIL-STD-883)."),
    "vendor": ("VENDOR GUIDE", BLUE, "#ffffff", "solid", "Read in a packaging house, vendor or bonding lab guide."),
    "thumb": ("RULE OF THUMB", "#ffffff", MAGENTA, "outline", "Read as a rule of thumb in a published source."),
    "placeholder": ("PLACEHOLDER", "url(#hatch)", "#3a3a3a", "dashed", "Ours. No source found: change it before trusting it."),
}
W, H = 1500, 2560


def read_rules():
    text = RULES_JS.read_text(encoding="utf-8")
    m = re.search(r"// BEGIN RULES JSON[^\n]*\n\s*const TABLE = (\[.*?\]);\s*// END RULES JSON", text, re.S)
    return json.loads(m[1])


RULES = read_rules()
BY = {r["key"]: r for r in RULES}
esc = lambda s: html.escape(str(s), quote=True)
out = []


def put(s):
    out.append(s)


def text(x, y, s, size=13, fill=INK, anchor="start", weight="normal", style="", rot=None, cls=None):
    tr = f' transform="rotate({rot} {x} {y})"' if rot is not None else ""
    st = f' font-style="{style}"' if style else ""
    c = f' class="{cls}"' if cls else ""
    put(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}"{st}{tr}{c}>{esc(s)}</text>')


def wrap(s, width, size):
    """Greedy wrap by an average glyph width: a little wide for this sans, so lines never run over."""
    per = max(8, int(width / (size * 0.54)))
    lines, cur = [], ""
    for word in s.split():
        if cur and len(cur) + 1 + len(word) > per:
            lines.append(cur)
            cur = word
        else:
            cur = (cur + " " + word).strip()
    if cur:
        lines.append(cur)
    return lines


def para(x, y, s, width, size=13, fill=INK, lead=1.38, weight="normal", style=""):
    for i, line in enumerate(wrap(s, width, size)):
        text(x, y + i * size * lead, line, size, fill, weight=weight, style=style)
    return y + len(wrap(s, width, size)) * size * lead


def pill(x, y, tier, w=118, h=18, size=10.5):
    label, fill, ink, kind, _ = TIER[tier]
    stroke = {"standard": GREEN, "vendor": BLUE, "thumb": MAGENTA, "placeholder": "#555"}[tier]
    dash = ' stroke-dasharray="4 3"' if kind == "dashed" else ""
    put(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.4"{dash}/>')
    text(x + w / 2, y + h / 2 + size * 0.36, label, size, ink, "middle", "bold", "italic" if tier == "placeholder" else "")


def bubble(x, y, key):
    """A rule's key on the drawing, coloured by its tier so a placeholder looks like one wherever it appears."""
    tier = BY[key]["tier"]
    _, fill, ink, kind, _ = TIER[tier]
    stroke = {"standard": GREEN, "vendor": BLUE, "thumb": MAGENTA, "placeholder": "#555"}[tier]
    dash = ' stroke-dasharray="3 2"' if kind == "dashed" else ""
    put(f'<rect x="{x}" y="{y - 12}" width="28" height="17" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.3"{dash}/>')
    text(x + 14, y + 1, key, 11, ink, "middle", "bold", "italic" if tier == "placeholder" else "")
    return x + 31


def tag(x, y, keys, words="", size=12):
    for k in keys:
        x = bubble(x, y, k)
    if words:
        text(x + 2, y + 1, words, size, INK)


def dim(x1, y1, x2, y2, colour="#2b3532"):
    put(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{colour}" stroke-width="1.1" marker-start="url(#arr)" marker-end="url(#arr)"/>')


def ext(x1, y1, x2, y2):
    put(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{LINE}" stroke-width="0.8" stroke-dasharray="3 3"/>')


def leader(x1, y1, x2, y2):
    put(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MUTED}" stroke-width="0.8"/>')


def frame(x, y, w, h, title, note):
    put(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#ffffff" stroke="#c9d3d1"/>')
    put(f'<rect x="{x}" y="{y}" width="{w}" height="34" rx="8" fill="#eef4f3"/><rect x="{x}" y="{y + 26}" width="{w}" height="8" fill="#eef4f3"/>')
    text(x + 14, y + 22, title, 14, DEEP, weight="bold")
    text(x + w - 14, y + 22, note, 11.5, MUTED, "end")


# ---------------------------------------------------------------- page
put(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif">')
put("<title>Wire bond design rules: generic values and where each comes from</title>")
put("""<defs>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#2b3532"/></marker>
<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f0f0f0"/><line x1="0" y1="0" x2="0" y2="7" stroke="#c4c4c4" stroke-width="2.2"/></pattern>
<pattern id="board" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#cfe3dd"/><line x1="0" y1="0" x2="0" y2="8" stroke="#a9cbc1" stroke-width="2"/></pattern>
</defs>""")
put(f'<rect width="{W}" height="{H}" fill="#f7f9f9"/>')

# Title band.
put(f'<rect x="0" y="0" width="{W}" height="104" fill="{DEEP}"/><rect x="0" y="100" width="{W}" height="4" fill="{MAGENTA}"/>')
text(30, 46, "Wire bond design rules", 30, "#ffffff", weight="bold")
text(30, 78, "Generic starting values for a die bonded to a board, each labelled by where it comes from. Nobody on this team has bonded yet, so every value is also a question for the bonding house.", 14, "#d8f3ec")
text(W - 30, 46, "Wire Bond Bench · November 2026", 13, "#d8f3ec", "end")

# Tier legend, two by two.
counts = {t: sum(r["tier"] == t for r in RULES) for t in TIER}
put(f'<rect x="30" y="116" width="{W - 60}" height="62" rx="8" fill="#ffffff" stroke="#c9d3d1"/>')
text(46, 151, "Tier of each value", 13, INK, weight="bold")
for i, (t, (label, *_rest, what)) in enumerate(TIER.items()):
    x, y = 190 + (i % 2) * 640, 124 + (i // 2) * 26
    pill(x, y, t)
    text(x + 128, y + 13.5, f"{counts[t]} rule{'' if counts[t] == 1 else 's'}. {what}", 12, MUTED)

# ---------------------------------------------------------------- plan view
frame(30, 186, 745, 740, "PLAN VIEW", "schematic, not to scale")
# Glob top dam, behind everything.
put('<rect x="64" y="232" width="676" height="508" rx="26" fill="none" stroke="#b78bb0" stroke-width="1.4" stroke-dasharray="7 5"/>')
text(722, 252, "glob top dam", 11, "#8a4f80", "end", style="italic")
# Die.
put('<rect x="90" y="330" width="290" height="330" fill="#dfe6e4" stroke="#33413d" stroke-width="1.6"/>')
text(110, 355, "DIE", 14, "#33413d", weight="bold")
pads = [(380, 26), (440, 26), (510, 64), (590, 26)]
for cy, h in pads:
    put(f'<rect x="344" y="{cy - h / 2}" width="26" height="{h}" fill="{GOLD}" stroke="{GOLD_DARK}" stroke-width="1"/>')
lands = [(320, 30), (410, 30), (515, 30), (650, 30)]
for cy, h in lands:
    put(f'<rect x="520" y="{cy - h / 2}" width="120" height="{h}" fill="{GOLD}" stroke="{GOLD_DARK}" stroke-width="1"/>')
wires = [((357, 380), (536, 320)), ((357, 440), (536, 410)), ((357, 494), (546, 515)), ((357, 526), (614, 515)), ((357, 590), (536, 650))]
for a, b in wires:
    put(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="{GOLD_DARK}" stroke-width="2.2"/>')
    put(f'<circle cx="{a[0]}" cy="{a[1]}" r="5" fill="{GOLD_DARK}"/><ellipse cx="{b[0]}" cy="{b[1]}" rx="7" ry="4" fill="{GOLD_DARK}"/>')
for i, (cy, _h) in enumerate(lands):
    text(562, cy + (30 if i == 2 else 4), f"land {i + 1}", 10.5, "#5b4300")

# W1/W2 along wire 1, offset up-left.
(ax, ay), (bx, by) = wires[0]
nx, ny = (ay - by), (bx - ax)
L = math.hypot(nx, ny); nx, ny = nx / L * 26, ny / L * 26
ext(ax, ay, ax - nx, ay - ny); ext(bx, by, bx - nx, by - ny)
dim(ax - nx, ay - ny, bx - nx, by - ny)
tag(392, 282, ["W1", "W2"], "length, bond to bond")
# W3: angle from the pad normal on wire 5.
(ax, ay), (bx, by) = wires[4]
ext(ax, ay, 470, ay)
ang = math.atan2(by - ay, bx - ax)
r = 74
put(f'<path d="M{ax + r},{ay} A{r},{r} 0 0 1 {ax + r * math.cos(ang):.1f},{ay + r * math.sin(ang):.1f}" fill="none" stroke="#2b3532" stroke-width="1.1" marker-end="url(#arr)"/>')
tag(452, 576, ["W3"], "≤ 45°")
text(470, 594, "pad normal", 10.5, MUTED, style="italic")
# W5/W6: gap between wires 1 and 2.
gx = 470
y1 = wires[0][0][1] + (gx - 357) / (536 - 357) * (320 - 380)
y2 = wires[1][0][1] + (gx - 357) / (536 - 357) * (410 - 440)
dim(gx, y1 + 3, gx, y2 - 3)
tag(478, 389, ["W5", "W6"], "gap")
# W4: no crossings, in words beside the die.
tag(110, 392, ["W4"], "no crossings in plan")
# P1/P2 pad opening, under the last pad.
ext(344, 603, 344, 628); ext(370, 603, 370, 628)
dim(344, 622, 370, 622)
tag(108, 626, ["P1", "P2"], "pad opening, short side")
leader(302, 622, 340, 622)
# P4 pitch between pads 1 and 2.
ext(318, 380, 344, 380); ext(318, 440, 344, 440)
dim(322, 380, 322, 440)
tag(108, 432, ["P4"], "pad pitch")
leader(196, 428, 318, 412)
# P3 long side and P5/P6 bonds on one pad.
ext(300, 478, 344, 478); ext(300, 542, 344, 542)
dim(304, 478, 304, 542)
tag(108, 482, ["P3"], "pad, long side")
leader(222, 478, 300, 500)
dim(332, 496, 332, 524)
tag(108, 540, ["P5", "P6"], "two bonds on one pad")
leader(298, 536, 328, 514)
# L1 land short side, L2 land pitch.
ext(640, 305, 662, 305); ext(640, 335, 662, 335)
dim(656, 305, 656, 335)
ext(640, 410, 700, 410); ext(640, 320, 700, 320)
dim(694, 320, 694, 410)
tag(660, 296, ["L1"])
tag(700, 372, ["L2"])
# L4 two bonds on one land.
ext(546, 515, 546, 486); ext(614, 515, 614, 486)
dim(546, 490, 614, 490)
tag(556, 478, ["L4"])
# P5 also applies to lands: note it.
text(650, 532, "P5 counts", 10.5, MUTED, style="italic")
text(650, 545, "lands too", 10.5, MUTED, style="italic")
# L3 die edge to land.
ext(380, 660, 380, 712); ext(520, 665, 520, 712)
dim(380, 706, 520, 706)
tag(404, 728, ["L3"], "die edge to land")
# L5 dam to land.
ext(640, 665, 640, 712)
dim(640, 700, 740, 700)
tag(664, 724, ["L5"])
# K1: a tall part outside the dam, with its keepout.
put('<rect x="600" y="800" width="96" height="40" fill="#cfd8d6" stroke="#33413d" stroke-width="1.3"/>')
text(648, 825, "part, height h", 11, INK, "middle")
put('<rect x="566" y="770" width="164" height="100" rx="6" fill="none" stroke="#33413d" stroke-width="1" stroke-dasharray="5 4"/>')
tag(420, 812, ["K1"], "keepout ≈ h")
leader(530, 808, 566, 808)
# D1: a second die beside the first.
put('<rect x="90" y="800" width="170" height="90" fill="#dfe6e4" stroke="#33413d" stroke-width="1.6"/>')
text(110, 850, "SECOND DIE", 12, "#33413d", weight="bold")
ext(140, 660, 140, 800)
dim(160, 660, 160, 800)
tag(176, 735, ["D1"], "die to die, side by side")
text(290, 890, "Keys are coloured by tier, so a placeholder looks like one wherever it appears.", 11.5, MUTED, style="italic")
text(290, 906, "Two keys on one dimension: the second is the same rule per wire diameter d.", 11.5, MUTED, style="italic")

# ---------------------------------------------------------------- side view
frame(790, 186, 680, 740, "SIDE VIEW", "sections, not to scale")
# Main section.
put('<rect x="806" y="560" width="648" height="40" fill="url(#board)" stroke="#5f7d75"/>')
text(820, 588, "BOARD", 11, "#3d5a52", weight="bold")
put('<rect x="870" y="552" width="190" height="8" fill="#b9c4c1"/>')
put('<rect x="870" y="470" width="190" height="82" fill="#dfe6e4" stroke="#33413d" stroke-width="1.6"/>')
text(890, 518, "DIE, thickness t", 12, "#33413d", weight="bold")
put(f'<rect x="1030" y="465" width="22" height="5" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
put(f'<rect x="1180" y="554" width="80" height="6" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
# Glob top dome and dam.
put('<path d="M842,560 C842,226 1296,226 1296,560" fill="#f6e7f2" fill-opacity="0.55" stroke="#b78bb0" stroke-width="1.4" stroke-dasharray="7 5"/>')
put('<rect x="1296" y="536" width="12" height="24" fill="#d9b9d2" stroke="#8a4f80"/>')
text(1314, 548, "dam", 10.5, "#8a4f80", style="italic")
# The loop: a cubic chain, sampled so the clearance dimension lands on the wire.
P =[(1041, 372), (1062, 346), (1104, 352), (1132, 380), (1166, 412), (1192, 496), (1204, 554)]
put(f'<path d="M1041,465 L1041,372 C1062,346 1104,352 1132,380 C1166,412 1192,496 1204,554" fill="none" stroke="{GOLD_DARK}" stroke-width="2.4"/>')


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0], u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1])


pts = [bez(P[0], P[1], P[2], P[3], i / 200) for i in range(201)] + [bez(P[3], P[4], P[5], P[6], i / 200) for i in range(201)]
peak = min(pts, key=lambda p: p[1])
at_edge = min(pts, key=lambda p: abs(p[0] - 1060))
put(f'<circle cx="1041" cy="462" r="7" fill="{GOLD_DARK}"/>')
put(f'<path d="M1196,554 L1218,554 L1214,548 L1200,548 z" fill="{GOLD_DARK}"/>')
# S3 loop height, from the board to the peak, on the left.
ext(peak[0], peak[1], 826, peak[1])
dim(830, 560, 830, peak[1] + 1)
text(824, 470, "S3 loop height", 12, INK, "middle", rot=-90)
# S1/S2 clearance at the die edge.
ext(1060, 470, 1086, 470)
ext(at_edge[0], at_edge[1], 1086, at_edge[1])
dim(1080, 470, 1080, at_edge[1] + 1)
tag(1180, 398, ["S1", "S2"], "over die edge")
leader(1178, 394, 1084, 418)
# S5 cover over the loop top, S4 glob top height.
dome_top = 560 - 0.75 * (560 - 226)
ext(peak[0], peak[1], 1006, peak[1])
ext(1069, dome_top, 1006, dome_top)
dim(1010, dome_top + 1, 1010, peak[1] - 1)
tag(900, 302, ["S5"], "cover")
leader(960, 300, 1006, 304)
ext(1069, dome_top, 1446, dome_top)
dim(1440, 560, 1440, dome_top + 1)
text(1458, 440, "S4 glob top height", 12, INK, "middle", rot=-90)
# Keys for S3 and S4, beside their rotated words.
bubble(846, 300, "S3")
bubble(1404, 300, "S4")
# W1 bond to bond, and L3 die edge to land, under the board.
ext(1041, 600, 1041, 628); ext(1204, 600, 1204, 628)
dim(1041, 622, 1204, 622)
tag(1214, 627, ["W1", "W2"], "bond to bond")
ext(1060, 600, 1060, 660); ext(1180, 600, 1180, 660)
dim(1060, 654, 1180, 654)
tag(1190, 659, ["L3"], "≥ 375 µm or 2 t")
# Ball and wedge.
leader(1034, 458, 990, 432)
tag(908, 432, ["B1"], "ball")
leader(1214, 552, 1236, 520)
tag(1222, 512, ["B2"], "wedge")
text(912, 452, "B3: bond inside pad", 10.5, MUTED, style="italic")
# K1: a tall part to the right, outside the dam, with the 45° line from the bond.
put('<rect x="1336" y="456" width="64" height="104" fill="#cfd8d6" stroke="#33413d" stroke-width="1.3"/>')
text(1368, 512, "part", 11, INK, "middle")
put('<line x1="1204" y1="554" x2="1316" y2="442" stroke="#33413d" stroke-width="1" stroke-dasharray="5 4"/>')
text(1288, 474, "45°", 11, INK)
tag(1336, 440, ["K1"], "keepout")
dim(1414, 456, 1414, 560)
text(1426, 512, "h", 12, INK, style="italic")

# Stacked section.
put('<line x1="806" y1="690" x2="1454" y2="690" stroke="#c9d3d1"/>')
text(806, 712, "Stacked die", 12.5, DEEP, weight="bold")
put('<rect x="806" y="860" width="648" height="34" fill="url(#board)" stroke="#5f7d75"/>')
put('<rect x="870" y="800" width="300" height="60" fill="#dfe6e4" stroke="#33413d" stroke-width="1.6"/>')
put('<rect x="870" y="750" width="190" height="50" fill="#e9eeed" stroke="#33413d" stroke-width="1.6"/>')
text(886, 780, "UPPER DIE", 11.5, "#33413d", weight="bold")
text(886, 838, "LOWER DIE", 11.5, "#33413d", weight="bold")
put(f'<rect x="1112" y="796" width="20" height="4" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
put(f'<rect x="1030" y="746" width="20" height="4" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
put(f'<rect x="1270" y="855" width="60" height="5" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
put(f'<rect x="1360" y="855" width="60" height="5" fill="{GOLD}" stroke="{GOLD_DARK}"/>')
put(f'<path d="M1122,796 L1122,770 C1160,742 1240,760 1290,855" fill="none" stroke="{GOLD_DARK}" stroke-width="2.2"/>')
put(f'<path d="M1040,746 L1040,720 C1120,690 1300,700 1380,855" fill="none" stroke="{GOLD_DARK}" stroke-width="2.2"/>')
ext(1060, 750, 1060, 726); ext(1122, 770, 1122, 726)
dim(1060, 730, 1122, 730)
tag(870, 732, ["D2"], "step to a bonded pad")

# ---------------------------------------------------------------- table
TY = 950
put(f'<rect x="30" y="{TY}" width="{W - 60}" height="40" rx="8" fill="{DEEP}"/>')
cols = [("Key", 44), ("Rule", 96), ("Value", 384), ("Condition", 492), ("Tier", 908), ("Source", 1040), ("In the app", 1366)]
for name, x in cols:
    text(x, TY + 26, name, 13, "#ffffff", weight="bold")
y = TY + 40
group = None
ENF = {"all": "every wire", "specified": "sized wires", "no": "not yet"}
for r in RULES:
    if r["group"] != group:
        group = r["group"]
        put(f'<rect x="30" y="{y}" width="{W - 60}" height="24" fill="#e3ecea"/>')
        text(44, y + 17, group.upper(), 11.5, DEEP, weight="bold")
        y += 24
    ph = r["tier"] == "placeholder"
    fill = "url(#hatch)" if ph else "#ffffff"
    dash = ' stroke="#777" stroke-dasharray="5 3"' if ph else ' stroke="#dde5e3"'
    on = r.get("on", True) is not False
    val = f'{r["value"]:g} {r["unit"]}' + ("" if on else " (off)")
    put(f'<g class="rule" data-rule="{esc(r["id"])}" data-key="{esc(r["key"])}" data-value="{r["value"]:g}" data-unit="{esc(r["unit"])}" data-tier="{esc(r["tier"])}" data-on="{str(on).lower()}" data-enforce="{esc(r["enforce"])}">')
    put(f'<rect x="30" y="{y}" width="{W - 60}" height="26" fill="{fill}"{dash}/>')
    st = "italic" if ph else ""
    ink = "#3a3a3a" if ph else INK
    text(44, y + 18, r["key"], 12.5, ink, weight="bold", style=st)
    text(96, y + 18, r["name"], 12.5, ink, style=st)
    text(384, y + 18, val, 12.5, ink, weight="bold", style=st)
    text(492, y + 18, r["short"], 12, ink, style=st)
    pill(908, y + 4, r["tier"], w=120)
    text(1040, y + 18, r["source"], 12, ink, style=st)
    text(1366, y + 18, ENF[r["enforce"]], 12, MUTED if r["enforce"] == "no" else ink, style="italic" if r["enforce"] == "no" else st)
    put("</g>")
    y += 26
y += 8
text(44, y + 12, "In the app: every wire, including wires left to the bonder; sized wires, only wires of a type with a diameter or loop, the rest counted as not checked; not yet, shown in the DRC rules panel as not enforced, never as a pass.", 11.5, MUTED)
text(44, y + 28, "A tripped placeholder only ever warns. Values for 25 µm wire scale with diameter where the source gives a table: see the condition and the sources file, docs/wire_bond_design_rules_sources.md.", 11.5, MUTED)
y += 50

# ---------------------------------------------------------------- too long, and open questions
BY_ = y
left_at = len(out)
text(52, BY_ + 32, "What does “too long” mean? Our best answer so far", 17, DEEP, weight="bold")
yy = para(52, BY_ + 58, "There is no one number. A wire is too long when the first of these four limits bites, and which one bites depends on the wire, the process and the signal.", 660, 13)
items = [
    ("1  Process.", "The bonding house's maximum for that wire. Europractice: 6 mm for 25 µm Au ball (4.5, 5.0, 6.0, 7.0 mm for 17.5 to 33 µm). Samtec: 6.35 mm. This is W1, the app's length check.", "vendor"),
    ("2  Sag and sweep.", "Sag and sweep grow with span over diameter. The 100-D rule caps span at 100 wire diameters, 2.5 mm for 25 µm wire. It comes from molded packages, where mold flow pushes wires; a glob top flows too. This is W2.", "thumb"),
    ("3  Clearance.", "A long, low wire sags towards the die edge and its neighbours. MIL-STD-883 rejects less than 2 wire diameters to a bare die edge or another wire (class S). These are S2 and W6.", "standard"),
    ("4  Electrical.", "1 mil Au wire has about 25 pH and 1.17 mΩ per mil: roughly 1 nH and 46 mΩ per mm. Too long is when that matters to the signal. No limit is set for this.", "vendor"),
]
yy += 6
for head, body, tier in items:
    pill(52, yy - 13, tier, w=118)
    text(180, yy, head, 13, INK, weight="bold")
    yy = para(180, yy + 18, body, 530, 12.5)
    yy += 8
yy = para(52, yy + 4, "What the app does today: W1 measures the straight plan distance from first bond to second, which is shorter than the wire by its loop, and warns over 6 mm. It runs on every wire, including those left to the bonder. W2 runs only where a type gives a diameter.", 660, 12.5, MUTED)
left_end = yy

QX = 750
right_at = len(out)
text(QX + 22, BY_ + 32, "Open questions, and what would answer each", 17, "#a42a7f", weight="bold")
qs = [
    ("What does too long mean for us?", "The house's maximum length per wire diameter and loop height; whether we glob top, since flow sweeps wires; the edge rates of our fastest signals."),
    ("Which wire: Au or Al, what diameter, ball or wedge?", "The house's standard wire. It sets P1, P2, P4, W1 and W2, which are quoted here for 25 µm Au ball."),
    ("Whose bonder, and which tool?", "Capillary or wedge tip size and bond head drawings. They set K1, P6, L4 and the pitches."),
    ("Glob top, dam, or nothing?", "The encapsulant datasheet and how it is dispensed. It sets S4, S5 and L5."),
    ("How tall are the parts near the die?", "Heights from the board's parts list. With them the app could enforce K1."),
    ("Do we want an inspection class?", "MIL-STD-883 class S, class B, or commercial. It sets W6, S2 and B1 to B3."),
    ("How thick is the die, and how thick the attach?", "Measured or from the foundry. L3 takes twice the thickness; S1 and D2 depend on it."),
    ("Are lands 150 µm from the die acceptable?", "Our example board has them; Samtec asks 375 µm without a ground plane. Ask the house about die attach bleed."),
    ("What step does a stacked die need?", "No source found. D2 is a placeholder borrowed from die to die spacing."),
]
yy = BY_ + 60
for i, (q, a) in enumerate(qs):
    text(QX + 22, yy, f"{i + 1}.", 13, "#a42a7f", weight="bold")
    yy = para(QX + 44, yy, q, 650, 13, INK, weight="bold")
    yy = para(QX + 44, yy + 1, a, 650, 12, MUTED)
    yy += 8
# Both boxes as tall as the longer, drawn behind their words.
bh = max(left_end, yy) - BY_ + 14
out.insert(right_at, f'<rect x="{QX}" y="{BY_}" width="720" height="{bh:.0f}" rx="8" fill="#ffffff" stroke="#c9d3d1"/><rect x="{QX}" y="{BY_}" width="6" height="{bh:.0f}" rx="3" fill="{MAGENTA}"/>')
out.insert(left_at, f'<rect x="30" y="{BY_}" width="700" height="{bh:.0f}" rx="8" fill="#ffffff" stroke="#c9d3d1"/><rect x="30" y="{BY_}" width="6" height="{bh:.0f}" rx="3" fill="{GREEN}"/>')

# ---------------------------------------------------------------- sources
SY = BY_ + bh + 20
src_at = len(out)
text(46, SY + 28, "Sources read for this sheet", 15, DEEP, weight="bold")
srcs = [
    ("standard", "MIL-STD-883G, TM 2010.11 internal visual (monolithic) and TM 2017.8 (hybrid), 2004. Bond size, separation, crossings.", "q-tech.com/wp-content/uploads/STD-883-2010.pdf and STD-883-2017.pdf"),
    ("vendor", "Europractice, ASIC prototype packaging design rules, 2024. Pad, pitch, length, angle, wires per pad, die to die.", "europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"),
    ("vendor", "Samtec, precision die attach design rules and guidelines, 2017. Land size and pitch, die edge to land, loop height, encapsulation.", "suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"),
    ("vendor", "STFC Interconnect Laboratory, helpful guidelines (G. Lockwood). 45° head clearance, 3 × d ball pads, 100 × 125 µm wedge pads.", "indico.global/event/1886/contributions/31130/attachments/15938/25564"),
    ("vendor", "CERN bond lab, recommendations. 60 µm pitch with 25 µm wire; 300 µm between two in-line bonds.", "bondlab.web.cern.ch/Recommendations.html"),
    ("thumb", "US patent 5,923,092. The 100-D rule for maximum span; 180 to 200 mil in industry at the time.", "patents.google.com/patent/US5923092A"),
    ("vendor", "Semiconductor Digest, Wire bonding considerations. 25 pH and 1.17 mΩ per mil of 1 mil Au wire.", "sst.semiconductor-digest.com/?p=36674"),
]
yy = SY + 54
for tier, what, url in srcs:
    pill(46, yy - 13, tier, w=118)
    text(176, yy, what, 12.5, INK)
    text(176, yy + 16, url, 11, BLUE)
    yy += 36
text(46, yy + 4, "Read and not used as a default: an LCSC blog (≤ 5 mm length, 60 to 120 µm ball pads), an Altium article (50 to 150 µm lands). Full notes and quotes: docs/wire_bond_design_rules_sources.md.", 11.5, MUTED)
text(46, yy + 22, "Generated from the rule table in app/js/rules.js by app/make_rules_svg.py. The app's DRC rules panel uses the same table, and a test checks they agree.", 11.5, MUTED)
sh = yy + 40 - SY
out.insert(src_at, f'<rect x="30" y="{SY}" width="{W - 60}" height="{sh:.0f}" rx="8" fill="#ffffff" stroke="#c9d3d1"/>')
H = int(SY + sh + 24)
out[0] = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif">'
out[3] = f'<rect width="{W}" height="{H}" fill="#f7f9f9"/>'
put("</svg>")

OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(RULES)} rules")
