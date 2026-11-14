"""Prototype assembler: a COPY of a KiCad board + a die manifest -> die footprint, generated wires, 3D wire models.

    python proto_assemble.py BOARD.kicad_pcb DIE.die.json DIE.wrl OUTDIR
        [--footprint REGEX] [--die-rot DEG] [--land-bond MM] [--skip-attr] [--no-wblib]

Rule under test: die pad n pairs with COB land n+1. Type is picked from the net, and the types come from a WBLIB
footprint on the input board when it has one. Nothing is written to the source board.

Works on any COB whose ring footprint name matches --footprint (default: "padring"). The die rotation is measured:
of 0/90/180/270 on the board, it takes the one with the shortest total wire length under the rule. --die-rot overrides it.
Also compares the generated pairs against the wires drawn in the COB footprint and the nets on the lands, and writes
report.json beside the board. Rerunning on a generated board replaces the die and wires and keeps WBLIB.

Frames. "Local" is the footprint before rotation, KiCad y down. "Board" is relative to the footprint anchor, y down, after
the footprint's rotation. GDS y points up. A KiCad angle a maps (x, y) to (x cos a + y sin a, -x sin a + y cos a).
A .kicad_pcb stores pad positions in local coordinates but pad angles already include the footprint's rotation.
"""
import argparse, json, math, os, re, shutil, statistics, sys, uuid

REPO = r"C:\Users\anfro\Documents\GitHub\wb-exchange-explorer"
sys.path.insert(0, REPO)
try:
    from wbx import loop as wire_loop
except ImportError:  # wbx imports lxml and ezdxf for its exporters; only the moves model is needed here
    def wire_loop(moves, span, dz):
        pts, x, z = [(0.0, 0.0)], 0.0, 0.0
        for mv in moves.split():
            v, h = mv.split('/')
            z += float(v)
            x += float(h[:-1]) / 100 * span if h.endswith('%') else float(h)
            pts.append((x, z))
        pts.append((span, dz))
        return pts

# Colours only affect the 3D view, so they stay out of the library.
COLOURS = {'STD25': "0.95 0.72 0.25", 'PWR33': "0.98 0.45 0.30"}
DEFAULT_COLOUR = "0.70 0.80 0.95"
DEFAULT_TYPES = {
    'STD25': "ball-wedge Au 25 forward 180/0 30/12% -20/35%",
    'PWR33': "ball-wedge Au 33 forward 220/0 30/12% -30/40%",
}
LANDBOND = 0.2   # mm in from the inner end of the land
THICK, ATTACH = 280.0, 25.0
WIRE_ATTR = '(attr board_only exclude_from_pos_files exclude_from_bom)'
PLAIN_ATTR = '(attr exclude_from_pos_files exclude_from_bom)'


def u(s):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'wbx-asm/' + s))


def n(v):
    s = f"{v:.4f}".rstrip('0').rstrip('.')
    return '0' if s in ('', '-0') else s


def balanced(t, i):
    """Index just past the s-expression opening at t[i]."""
    depth, quoted, j = 0, False, i
    while True:
        c = t[j]
        if quoted:
            if c == '\\':
                j += 1
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted = True
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if not depth:
                return j + 1
        j += 1


def footprints(text):
    """Every top-level footprint as (start, end, lib id)."""
    out, pos = [], 0
    for m in iter(lambda: re.compile(r'\(footprint\s+"([^"]+)"').search(text, pos), None):
        e = balanced(text, m.start())
        out.append((m.start(), e, m[1]))
        pos = e
    return out


def rot(x, y, deg):
    a = math.radians(deg)
    return x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)


def wire_type(net, types):
    want = 'PWR33' if net and re.fullmatch(r'D?V(DD|SS)', net) else 'STD25'
    return want if want in types else next(iter(types))


def parse_type(name, value):
    """'ball-wedge Au 25 forward 180/0 30/12% -20/35%' -> fields. A bad value should stop the run, not pick a shape."""
    t = value.split()
    if len(t) < 5:
        raise ValueError(f'wb_type_{name}: expected "style material diameter direction moves...", got "{value}"')
    return dict(style=t[0], mat=t[1], d=float(t[2]), direction=t[3], moves=' '.join(t[4:]), col=COLOURS.get(name, DEFAULT_COLOUR), raw=value)


def read_library(text):
    """Types from a WBLIB footprint if the board has one, otherwise the defaults. Returns (types, found)."""
    for s, e, lib in footprints(text):
        fp = text[s:e]
        if re.search(r'\(property\s+"Reference"\s+"WBLIB"', fp):
            raw = dict(re.findall(r'\(property\s+"wb_type_([^"]+)"\s+"([^"]*)"', fp))
            if raw:
                return {k: parse_type(k, v) for k, v in raw.items()}, True
    return {k: parse_type(k, v) for k, v in DEFAULT_TYPES.items()}, False


def strip_generated(text):
    """Drop die and wire footprints from an earlier run, so regeneration replaces them."""
    for s, e, lib in reversed(footprints(text)):
        if lib.startswith(('wbx_die:', 'wbx_wire:')):
            text = text[:s].rstrip() + '\n' + text[e:].lstrip('\n')
    return text


def parse_cob(text, pattern):
    hits = [(s, e, lib) for s, e, lib in footprints(text) if re.search(pattern, lib)]
    if len(hits) != 1:
        raise SystemExit(f'expected one footprint matching "{pattern}", found {[h[2] for h in hits]}')
    s, e, lib = hits[0]
    fp = text[s:e]
    a = re.search(r'\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)', fp)
    ax, ay, frot = float(a[1]), float(a[2]), float(a[3] or 0)
    ref = re.search(r'\(property\s+"Reference"\s+"([^"]*)"', fp)[1]
    lands = {}
    extras = []
    for m in re.finditer(r'\(pad\s+"([^"]*)"\s+smd\s+(\w+)\s+\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)\s+\(size ([\d.]+) ([\d.]+)\)', fp):
        sx, sy = float(m[6]), float(m[7])
        if not m[1].isdigit() or max(sx, sy) > 2:   # the die paddle is a big smd pad too
            extras.append(m[1])
            continue
        tail = fp[m.end():balanced(fp, m.start())]
        net = re.search(r'\(net (?:\d+ )?"([^"]*)"\)', tail)
        lands[int(m[1])] = dict(x=float(m[3]), y=float(m[4]), abs_rot=float(m[5] or 0), sx=sx, sy=sy, shape=m[2], net=net[1] if net else None)
    drawn = []
    for m in re.finditer(r'\(fp_line\s+\(start ([-\d.]+) ([-\d.]+)\)\s+\(end ([-\d.]+) ([-\d.]+)\)\s+\(stroke\s+\(width ([\d.]+)\)[^)]*\)\s*\)\s+\(layer "Cmts.User"\)', fp):
        drawn.append(tuple(map(float, m.groups())))
    return dict(lib=lib, ref=ref, ax=ax, ay=ay, rot=frot, lands=lands, drawn=drawn)


def land_geometry(cob, l, land_bond=LANDBOND):
    """Board-frame centre, unit vector along the land, inner end, and bond point."""
    cx, cy = rot(l['x'], l['y'], cob['rot'])
    long_, deg = (l['sx'], l['abs_rot']) if l['sx'] >= l['sy'] else (l['sy'], l['abs_rot'] + 90)
    ux, uy = rot(1, 0, deg)
    # of the two ends, the inner one is nearer the die
    ends = [(cx + ux * long_ / 2, cy + uy * long_ / 2), (cx - ux * long_ / 2, cy - uy * long_ / 2)]
    inner = min(ends, key=lambda p: math.hypot(*p))
    sign = 1 if inner == ends[1] else -1
    bond = (inner[0] + sign * ux * land_bond, inner[1] + sign * uy * land_bond)
    return dict(c=(cx, cy), u=(ux, uy), long=long_, short=min(l['sx'], l['sy']), inner=inner, bond=bond, sign=sign)


def pad_board(m, p, die_rot):
    """Pad centre in the board frame, in mm, for a die rotated die_rot on the board about its centre."""
    cx = (p['x'] + p['w'] / 2 - m['w'] / 2) / 1000
    cy = -(p['y'] + p['h'] / 2 - m['h'] / 2) / 1000    # GDS y up -> KiCad y down
    return rot(cx, cy, die_rot)


def measure_rotation(m, cob):
    """Total rule wire length for each rotation. Returns {deg: mm}."""
    out = {}
    for deg in (0, 90, 180, 270):
        tot = 0.0
        for p in m['pads']:
            l = cob['lands'].get(p['n'] + 1)
            if l:
                tot += math.dist(pad_board(m, p, deg), land_geometry(cob, l)['bond'])
        out[deg] = tot
    return out


def corner(x, y):
    return ('B' if y > 0 else 'T') + ('L' if x < 0 else 'R')


def segments_cross(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0


def norm_net(s):
    """Reduce a GDS pad label or a board net to one comparable name, or None if it says nothing."""
    if not s:
        return None
    s = s.lstrip('/')
    if re.fullmatch(r'D?VSS|GND', s):
        return 'GND'
    if re.fullmatch(r'D?VDD|VDD_\w+|PWR_AUX_\d+', s):
        return 'VDD'
    m = re.fullmatch(r'(\w+?)_?PAD(?:\[(\d+)\])?', s)
    if m:
        s = m[1] + ('_' + m[2] if m[2] else '')
    s = re.sub(r'^analog_', 'an_', s)
    s = re.sub(r'^input_', 'in_', s)
    return s


def compare_nets(m, cob):
    """Land nets against GDS labels, under the rule. Land nets named pad_k say which pad the board's author meant."""
    out = dict(compared=0, match=0, mismatch=[], unnamed=0, pad_k_match=0, pad_k_compared=0, supply_compared=0, supply_match=0)
    for p in m['pads']:
        l = cob['lands'].get(p['n'] + 1)
        if not l:
            continue
        ln, pn = norm_net(l['net']), norm_net(p['net'])
        k = re.fullmatch(r'pad_(\d+)', ln or '')
        if k:
            out['pad_k_compared'] += 1
            out['pad_k_match'] += int(k[1]) == p['n']
            if int(k[1]) != p['n']:
                out['mismatch'].append((p['n'], p['net'], l['net']))
            continue
        if not ln or not pn:
            out['unnamed'] += 1
            continue
        out['compared'] += 1
        if ln in ('GND', 'VDD') or pn in ('GND', 'VDD'):
            out['supply_compared'] += 1
            out['supply_match'] += ln == pn
        if ln == pn:
            out['match'] += 1
        else:
            out['mismatch'].append((p['n'], p['net'], l['net']))
    return out


def tube(pts, d, col):
    """VRML hexagonal tube along pts (x, y, z in um). 1 VRML unit = 2.54 mm in KiCad."""
    U = 1 / 2540.0
    R = d / 2
    verts, faces = [], []
    K = 6
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        t = [b[j] - a[j] for j in range(3)]
        L = math.sqrt(sum(v * v for v in t)) or 1
        t = [v / L for v in t]
        up = (0, 0, 1) if abs(t[2]) < .9 else (1, 0, 0)
        s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]
        S = math.sqrt(sum(v * v for v in s)) or 1
        s = [v / S for v in s]
        w = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]]
        for k in range(K):
            c, e = math.cos(2 * math.pi * k / K), math.sin(2 * math.pi * k / K)
            verts.append(tuple(p[j] + R * (c * s[j] + e * w[j]) for j in range(3)))
        if i:
            for k in range(K):
                q = (k + 1) % K
                faces += [(i - 1) * K + k, (i - 1) * K + q, i * K + q, i * K + k, -1]
    return ('#VRML V2.0 utf8\nShape { appearance Appearance { material Material { diffuseColor %s specularColor 0.9 0.8 0.5 shininess 0.6 } } '
            'geometry IndexedFaceSet { solid FALSE creaseAngle 1.2 coord Coordinate { point [ %s ] } coordIndex [ %s ] } }\n'
            % (col, ', '.join(f"{a * U:.5f} {b * U:.5f} {c * U:.5f}" for a, b, c in verts), ' '.join(map(str, faces))))


def smooth(pts, per=8):
    """Catmull-Rom through the loop control points, keeping the vertical rise crisp."""
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        a, b, c, d = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(per):
            t = s / per
            out.append(tuple(.5 * ((2 * b[j]) + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t ** 3) for j in range(2)))
    out.append(pts[-1])
    return out


def wblib_footprint(types, ax, ay):
    """One hidden field per type. No geometry, so it plots nothing and cannot collide with anything."""
    fields = '\n'.join(f'\t\t(property "wb_type_{k}" "{t["raw"]}" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u("lib" + k)}") (effects (font (size .1 .1))))' for k, t in types.items())
    return f'''\t(footprint "wbx_lib:wire_types"
\t\t(layer "F.Cu") (uuid "{u('wblib')}") (at {n(ax)} {n(ay)})
\t\t(property "Reference" "WBLIB" (at 0 -0.1 0) (layer "User.1") (hide yes) (uuid "{u('libr')}") (effects (font (size .1 .1) (thickness .01))))
\t\t(property "Value" "wire types" (at 0 0.1 0) (layer "User.1") (hide yes) (uuid "{u('libv')}") (effects (font (size .1 .1) (thickness .01))))
\t\t(property "wb_kind" "type_library" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u('libk')}") (effects (font (size .1 .1))))
{fields}
\t\t{WIRE_ATTR}
\t)'''


def main(a):
    board, die_json, die_wrl, out = a.board, a.die_json, a.die_wrl, a.out
    os.makedirs(os.path.join(out, '3d'), exist_ok=True)
    src = open(board, encoding='utf-8').read()
    types, from_board = read_library(src)
    text = strip_generated(src)
    m = json.load(open(die_json))
    cob = parse_cob(text, a.footprint)
    ax, ay, lands = cob['ax'], cob['ay'], cob['lands']
    attr = PLAIN_ATTR if a.skip_attr else WIRE_ATTR
    W, H = m['w'], m['h']
    pads = m['pads']
    print('die', m['cell'], W, H, 'pads', len(pads), m['counts'], '| cob', cob['lib'], cob['ref'], 'at', ax, ay, 'rot', cob['rot'], '| lands', len(lands), '| drawn', len(cob['drawn']))
    print('types', 'from WBLIB on the board' if from_board else 'defaults', {k: t['raw'] for k, t in types.items()})
    missing = [p['n'] + 1 for p in pads if p['n'] + 1 not in lands]
    unused = sorted(set(lands) - {p['n'] + 1 for p in pads})
    if missing or unused:
        print(f'PAIRING INCOMPLETE: pads with no land {missing}; lands with no pad {unused}')
    lens = measure_rotation(m, cob)
    die_rot = a.die_rot if a.die_rot is not None else min(lens, key=lens.get)
    rel = (die_rot - cob['rot']) % 360
    first = pad_board(m, pads[0], die_rot)
    first_land = land_geometry(cob, lands[1])['c'] if 1 in lands else (0, 0)
    print('rule wire length by die rotation, mm:', {k: round(v, 1) for k, v in lens.items()})
    print(f'die rotation: {die_rot:g} on the board, {rel:g} relative to the footprint; pad 0 corner {corner(*first)}, land 1 corner {corner(*first_land)}')
    shutil.copy(die_wrl, os.path.join(out, '3d', 'die.wrl'))
    ztop = ATTACH + THICK
    fps = []
    fps.append(f'''\t(footprint "wbx_die:{m['cell']}"
\t\t(layer "F.Cu") (uuid "{u('die')}") (at {n(ax)} {n(ay)} {n(die_rot)})
\t\t(property "Reference" "D1" (at 0 {n(H / 2000 + .25)} {n(die_rot)}) (layer "F.Fab") (uuid "{u('dr')}") (effects (font (size .3 .3) (thickness .05))))
\t\t(property "Value" "{m['cell']}" (at 0 0 {n(die_rot)}) (layer "F.Fab") (uuid "{u('dv')}") (effects (font (size .3 .3) (thickness .05))))
\t\t(property "wb_kind" "die" (at 0 0 {n(die_rot)}) (layer "F.Fab") (hide yes) (uuid "{u('dk')}") (effects (font (size .3 .3))))
\t\t{attr}
\t\t(fp_rect (start {n(-W / 2000)} {n(-H / 2000)}) (end {n(W / 2000)} {n(H / 2000)}) (stroke (width 0.02) (type solid)) (fill no) (layer "F.Fab") (uuid "{u('do')}"))
\t\t(model "${{KIPRJMOD}}/3d/die.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
\t)''')
    spans, tcount, rows, segs, angles = [], {}, [], [], []
    for p in pads:
        no = p['n'] + 1
        if no not in lands:
            continue
        l = lands[no]
        dx, dy = pad_board(m, p, die_rot)
        g = land_geometry(cob, l, a.land_bond)
        lx, ly = g['bond']
        net = p['net'] or f"P{p['n']}"
        tp = wire_type(p['net'], types)
        tcount[tp] = tcount.get(tp, 0) + 1
        T = types[tp]
        x1, y1 = ax + dx, ay + dy
        x2, y2 = ax + lx, ay + ly
        span = math.dist((x1, y1), (x2, y2)) * 1000
        spans.append(span)
        segs.append(((dx, dy), (lx, ly)))
        # angle between the wire and the land's own axis, the bonder's approach to the land
        wx, wy = (dx - lx) / (span / 1000), (dy - ly) / (span / 1000)
        angles.append(math.degrees(math.acos(min(1, abs(wx * g['u'][0] + wy * g['u'][1])))))
        rows.append([p['n'], p['net'], round(dx, 3), round(dy, 3), round(lx, 3), round(ly, 3), tp, round(g['c'][0], 3), round(g['c'][1], 3), int(round(l['abs_rot'])) % 360])
        loop = wire_loop(T['moves'], span, -ztop)
        ux, uy = (x2 - x1) * 1000 / span, (y2 - y1) * 1000 / span
        # model space: x as board x, y up (board y flipped), z up
        path = [(ux * b, -uy * b, ztop + c) for b, c in [loop[0]] + smooth(loop[1:])]
        name = f"W{no:02d}"
        open(os.path.join(out, '3d', name + '.wrl'), 'w').write(tube(path, T['d'], T['col']))
        fps.append(f'''\t(footprint "wbx_wire:wire"
\t\t(layer "F.Cu") (uuid "{u(name)}") (at {n(x1)} {n(y1)})
\t\t(property "Reference" "{name}" (at 0 -0.1 0) (layer "User.1") (hide yes) (uuid "{u(name + 'r')}") (effects (font (size .1 .1) (thickness .01))))
\t\t(property "Value" "{tp}" (at 0 0.1 0) (layer "User.1") (hide yes) (uuid "{u(name + 'v')}") (effects (font (size .1 .1) (thickness .01))))
\t\t(property "wb_kind" "wire" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u(name + 'k')}") (effects (font (size .1 .1))))
\t\t(property "wb_from" "D1.{no}" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u(name + 'f')}") (effects (font (size .1 .1))))
\t\t(property "wb_to" "{cob['ref']}.{no}" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u(name + 't')}") (effects (font (size .1 .1))))
\t\t(property "wb_type" "{tp}" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u(name + 'y')}") (effects (font (size .1 .1))))
\t\t(property "wb_net" "{net}" (at 0 0 0) (layer "User.1") (hide yes) (uuid "{u(name + 'n')}") (effects (font (size .1 .1))))
\t\t{attr}
\t\t(fp_line (start 0 0) (end {n(x2 - x1)} {n(y2 - y1)}) (stroke (width {n(T['d'] / 1000)}) (type solid)) (layer "User.1") (uuid "{u(name + 'l')}"))
\t\t(model "${{KIPRJMOD}}/3d/{name}.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
\t)''')
    crossings = sum(segments_cross(*segs[i], *segs[j]) for i in range(len(segs)) for j in range(i + 1, len(segs)))
    nets = compare_nets(m, cob)
    print(f"span {min(spans):.0f}-{max(spans):.0f} um; types {tcount}; crossings {crossings}; max angle to land axis {max(angles):.1f} deg")
    print(f"nets on both ends: {nets['match']}/{nets['compared']} match (supply {nets['supply_match']}/{nets['supply_compared']}); pad_k lands {nets['pad_k_match']}/{nets['pad_k_compared']}; unnamed {nets['unnamed']}; mismatches {nets['mismatch'][:12]}")
    k = text.rstrip().rfind(')')
    tail = '' if a.no_wblib or from_board else '\n' + wblib_footprint(types, ax, ay)
    new = text[:k] + '\n'.join(fps) + tail + '\n' + text[k:]
    base = os.path.join(out, 'assembly')
    open(base + '.kicad_pcb', 'w', encoding='utf-8').write(new)
    for ext in ('.kicad_pro', '.kicad_sch'):   # the schematic lets DRC run its parity check on the copy
        side = os.path.splitext(board)[0] + ext
        if os.path.exists(side) and os.path.abspath(side) != os.path.abspath(base + ext):
            shutil.copy(side, base + ext)
    report = dict(cob=cob['lib'], ref=cob['ref'], cob_rot=cob['rot'], die=m['cell'], die_rot=die_rot, die_rot_rel_footprint=rel, lengths_by_rot=lens,
                  pad0_corner=corner(*first), land1_corner=corner(*first_land), pads=len(pads), lands=len(lands), wires=len(rows),
                  span_um=[min(spans), max(spans)], span_median_um=statistics.median(spans), types=tcount, crossings=crossings, max_land_angle=max(angles), nets=nets,
                  types_source='WBLIB' if from_board else 'defaults', w=W, h=H, rows=rows)
    json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=1)
    print('wrote', base + '.kicad_pcb')


if __name__ == '__main__':
    x = argparse.ArgumentParser()
    x.add_argument('board')
    x.add_argument('die_json')
    x.add_argument('die_wrl')
    x.add_argument('out')
    x.add_argument('--footprint', default='padring')
    x.add_argument('--die-rot', type=float)
    x.add_argument('--land-bond', type=float, default=LANDBOND)
    x.add_argument('--skip-attr', action='store_true', help='leave board_only off, to measure what it changes')
    x.add_argument('--no-wblib', action='store_true', help='leave WBLIB off, to measure what it changes')
    main(x.parse_args())
