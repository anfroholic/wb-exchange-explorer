"""Prototype die kit: GDS -> manifest, KiCad footprint + symbol, stand-in 3D model. Partial data allowed.

    python proto_diekit.py DIE.gds OUTDIR [--cell NAME] [--png RENDER.png] [--no-nets] [--no-anchor]

Pads are found on 37/0, walking the hierarchy. Nets come from 81/10 and 53/10 labels when present.
Pad numbers walk counter-clockwise from the corner holding the QR cell.
Prints what it found and what it fell back on.
"""
import argparse, json, os, re, uuid
import klayout.db as kdb

PAD = (37, 0)
LABELS = [(81, 10), (53, 10)]
GENERIC = {'PAD', 'pad', 'Pad', 'BOND', 'bond'}
MIN_UM = 30.0
QR = re.compile(r'ws_ip__(id|qrcode)', re.I)


def u(s):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'wbx/' + s))


def n(v):
    return f"{v:.4f}".rstrip('0').rstrip('.') or '0'


def find_anchor(c):
    """Corner holding the QR cell, searching two levels down."""
    b = c.bbox()

    def walk(cell, tr, depth):
        for i in cell.each_inst():
            t = tr * i.cplx_trans
            if QR.search(i.cell.name):
                return i.cell.bbox().transformed(t)
            if depth and i.cell.child_cells() and 'fd_' not in i.cell.name and not i.cell.name.startswith('VIA'):
                r = walk(i.cell, t, depth - 1)
                if r:
                    return r
        return None

    q = walk(c, kdb.ICplxTrans(), 2)
    if not q:
        return None
    return ('B' if q.center().y < b.center().y else 'T') + ('L' if q.center().x < b.center().x else 'R')


def extract(path, cell=None, use_nets=True, use_anchor=True):
    ly = kdb.Layout()
    ly.read(path)
    dbu = ly.dbu
    c = ly.cell(cell) if cell else ly.top_cell()
    b = c.bbox()
    boxes = []
    it = c.begin_shapes_rec(ly.layer(*PAD))
    while not it.at_end():
        bb = it.shape().bbox().transformed(it.trans())
        w, h = bb.width() * dbu, bb.height() * dbu
        if MIN_UM <= w <= 300 and MIN_UM <= h <= 300:  # the upper limit drops seal-ring strips
            boxes.append(bb)
        it.next()
    labels = []
    if use_nets:
        for l in LABELS:
            it = c.begin_shapes_rec(ly.layer(*l))
            while not it.at_end():
                s = it.shape()
                if s.is_text():
                    t = it.trans() * s.text
                    labels.append((t.string, t.x, t.y))
                it.next()
    W, H = b.width() * dbu, b.height() * dbu

    def edge(q):
        d = {'B': q.center().y - b.bottom, 'R': b.right - q.center().x, 'T': b.top - q.center().y, 'L': q.center().x - b.left}
        k = min(d, key=d.get)
        return k, d[k] * dbu

    # peripheral only: internal probe pads are not bond pads
    keep = [q for q in boxes if edge(q)[1] <= 2 * max(q.width(), q.height()) * dbu]
    side = {'B': [], 'R': [], 'T': [], 'L': []}
    for q in keep:
        side[edge(q)[0]].append(q)
    order = {'B': lambda q: q.center().x, 'R': lambda q: q.center().y, 'T': lambda q: -q.center().x, 'L': lambda q: -q.center().y}
    for k in side:
        side[k].sort(key=order[k])
    anchor = find_anchor(c) if use_anchor else None
    start = {'BL': 'B', 'BR': 'R', 'TR': 'T', 'TL': 'L'}.get(anchor or 'BL')
    seq = ['B', 'R', 'T', 'L']
    seq = seq[seq.index(start):] + seq[:seq.index(start)]

    def name(q):
        h = {s for s, x, y in labels if q.left <= x <= q.right and q.bottom <= y <= q.top}
        r = h - GENERIC
        return sorted(r, key=lambda s: (0 if '[' in s else 1, -len(s)))[0] if r else None

    pads = []
    i = 0
    for k in seq:
        for q in side[k]:
            pads.append(dict(n=i, side=k, x=round((q.left - b.left) * dbu, 3), y=round((q.bottom - b.bottom) * dbu, 3),
                             w=round(q.width() * dbu, 3), h=round(q.height() * dbu, 3), net=name(q)))
            i += 1
    m = dict(source=os.path.basename(path), cell=c.name, w=round(W, 3), h=round(H, 3), pad_layer="37/0", anchor=anchor,
             anchor_assumed=anchor is None, pads=pads, counts={k: len(v) for k, v in side.items()},
             dropped_internal=len(boxes) - len(keep))
    m['nets_found'] = sum(1 for p in pads if p['net'])
    return m


def footprint(m, out, model=None):
    W, H = m['w'], m['h']
    nm = m['cell']
    o = [f'(footprint "{nm}"', ' (version 20241229)', ' (generator "wbx_diekit")', ' (layer "F.Cu")',
         f' (descr "Die stand-in generated from {m["source"]}. Mechanical only, no copper: bond lands live on the board.")',
         ' (attr board_only exclude_from_pos_files exclude_from_bom)',
         f' (property "Reference" "U" (at 0 {n(-H / 2000 - .3)} 0) (layer "F.SilkS") (uuid "{u(nm + "ref")}") (effects (font (size .4 .4) (thickness .06))))',
         f' (property "Value" "{nm}" (at 0 {n(H / 2000 + .3)} 0) (layer "F.Fab") (uuid "{u(nm + "val")}") (effects (font (size .3 .3) (thickness .05))))',
         f' (property "wb_kind" "die" (at 0 0 0) (layer "F.Fab") (hide yes) (uuid "{u(nm + "kind")}") (effects (font (size .3 .3))))',
         f' (fp_rect (start {n(-W / 2000)} {n(-H / 2000)}) (end {n(W / 2000)} {n(H / 2000)}) (stroke (width 0.02) (type solid)) (fill no) (layer "F.Fab") (uuid "{u(nm + "o")}"))',
         f' (fp_rect (start {n(-W / 2000)} {n(-H / 2000)}) (end {n(W / 2000)} {n(H / 2000)}) (stroke (width 0.02) (type solid)) (fill no) (layer "F.CrtYd") (uuid "{u(nm + "c")}"))']
    for p in m['pads']:
        x0 = (p['x'] - W / 2) / 1000
        y0 = -(p['y'] + p['h'] - H / 2) / 1000
        o.append(f' (fp_rect (start {n(x0)} {n(y0)}) (end {n(x0 + p["w"] / 1000)} {n(y0 + p["h"] / 1000)}) (stroke (width 0.004) (type solid)) (fill yes) (layer "F.Fab") (uuid "{u(nm + "p" + str(p["n"]))}"))')
    if model:
        o.append(f' (model "{model}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))')
    o.append(')')
    open(out, 'w', encoding='utf-8').write('\n'.join(o) + '\n')


def symbol(m, out):
    """One pin per pad, grouped by die side. Pin number = pad number + 1, matching KiCad's 1-based footprint pads."""
    nm = m['cell']
    P = 2.54
    groups = {k: [p for p in m['pads'] if p['side'] == k] for k in 'LBRT'}

    def net(p):
        return p['net'] or f"P{p['n']}"

    longest = max(len(net(p)) for p in m['pads'])

    def half(c):
        # half the pin run, plus room for the facing side's pin names, snapped to the 2.54 grid
        return round((c * P / 2 + longest * 0.85 + 2.54) / 2.54) * 2.54

    hw = half(max(len(groups['B']), len(groups['T'])))
    hh = half(max(len(groups['L']), len(groups['R'])))
    o = ['(kicad_symbol_lib', ' (version 20241209)', ' (generator "wbx_diekit")',
         f' (symbol "{nm}" (pin_names (offset 0.5)) (exclude_from_sim no) (in_bom yes) (on_board yes)',
         f'  (property "Reference" "U" (at {n(-hw)} {n(hh + 1.5)} 0) (effects (font (size 1.27 1.27)) (justify left)))',
         f'  (property "Value" "{nm}" (at {n(hw)} {n(hh + 1.5)} 0) (effects (font (size 1.27 1.27)) (justify right)))',
         '  (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))',
         '  (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))',
         f'  (symbol "{nm}_0_1" (rectangle (start {n(-hw)} {n(hh)}) (end {n(hw)} {n(-hh)}) (stroke (width 0.254) (type default)) (fill (type background))))',
         f'  (symbol "{nm}_1_1"']

    def typ(s):
        return 'power_in' if s in ('VDD', 'DVDD', 'VSS', 'DVSS') else 'bidirectional'

    for k, g in groups.items():
        N = len(g)
        for j, p in enumerate(g):
            off = round((j - (N - 1) / 2) * 2) / 2 * P  # even counts sit on the half grid; 1.27 mm is still a valid KiCad pin grid
            if k == 'L':  # counter-clockwise around the symbol: left side runs top to bottom
                x, y, a = -hw - 2.54, -off, 0
            elif k == 'B':
                x, y, a = off, -hh - 2.54, 90
            elif k == 'R':
                x, y, a = hw + 2.54, off, 180
            else:
                x, y, a = -off, hh + 2.54, 270
            o.append(f'   (pin {typ(net(p))} line (at {n(x)} {n(y)} {a}) (length 2.54) (name "{net(p)}" (effects (font (size 1 1)))) (number "{p["n"] + 1}" (effects (font (size 1 1)))))')
    o += ['  )', ' )', ')']
    open(out, 'w', encoding='utf-8').write('\n'.join(o) + '\n')


def wrl(m, out, png=None, thick=280.0, attach=25.0, cols=240):
    """VRML stand-in, centred on the die, z up from the board surface. KiCad reads 1 VRML unit as 2.54 mm."""
    U = 1 / 2540.0
    W, H = m['w'], m['h']
    ztop = attach + thick

    def shape(col, pts, idx):
        return ('Shape { appearance Appearance { material Material { diffuseColor %s specularColor 0.15 0.15 0.15 shininess 0.25 } } '
                'geometry IndexedFaceSet { solid FALSE coord Coordinate { point [ %s ] } coordIndex [ %s ] } }'
                % (col, ', '.join(f"{a * U:.5f} {b * U:.5f} {c * U:.5f}" for a, b, c in pts), ' '.join(map(str, idx))))

    def face(col, rects, z):
        pts, idx = [], []
        for x0, y0, x1, y1 in rects:
            k = len(pts)
            pts += [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
            idx += [k, k + 1, k + 2, k + 3, -1]
        return shape(col, pts, idx)

    def box(col, x0, y0, z0, x1, y1, z1):
        pts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        return shape(col, pts, [0, 3, 2, 1, -1, 4, 5, 6, 7, -1, 0, 1, 5, 4, -1, 1, 2, 6, 5, -1, 2, 3, 7, 6, -1, 3, 0, 4, 7, -1])

    S = [box('0.35 0.35 0.37', -W / 2 - 10, -H / 2 - 10, 0, W / 2 + 10, H / 2 + 10, attach),
         box('0.20 0.22 0.27', -W / 2, -H / 2, attach, W / 2, H / 2, ztop)]
    if png:
        from PIL import Image
        im = Image.open(png).convert('RGB')
        rows = max(1, round(cols * H / W))
        im = im.resize((cols, rows), Image.BOX)
        px = im.load()
        cw, ch = W / cols, H / rows
        buckets = {}

        def bucket(p):
            return tuple(v // 32 * 32 + 16 for v in p)

        for r in range(rows):
            c = 0
            while c < cols:
                p = px[c, r]
                if sum(p) > 720:  # background of the render
                    c += 1
                    continue
                q = bucket(p)
                e = c
                while e + 1 < cols and bucket(px[e + 1, r]) == q and sum(px[e + 1, r]) <= 720:
                    e += 1
                buckets.setdefault(q, []).append((-W / 2 + c * cw, H / 2 - (r + 1) * ch, -W / 2 + (e + 1) * cw, H / 2 - r * ch))
                c = e + 1
        for q, rects in buckets.items():
            S.append(face(' '.join(f"{v / 255:.3f}" for v in q), rects, ztop + 1))
    S.append(face('0.86 0.86 0.80', [(p['x'] - W / 2, p['y'] - H / 2, p['x'] + p['w'] - W / 2, p['y'] + p['h'] - H / 2) for p in m['pads']], ztop + 2))
    open(out, 'w', encoding='utf-8').write('#VRML V2.0 utf8\n' + '\n'.join(S) + '\n')


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('gds')
    a.add_argument('out')
    a.add_argument('--cell')
    a.add_argument('--png')
    a.add_argument('--no-nets', action='store_true')
    a.add_argument('--no-anchor', action='store_true')
    a.add_argument('--tag', default='')
    x = a.parse_args()
    os.makedirs(x.out, exist_ok=True)
    m = extract(x.gds, x.cell, not x.no_nets, not x.no_anchor)
    base = m['cell'] + x.tag
    m['cell'] = base
    json.dump(m, open(f"{x.out}/{base}.die.json", 'w'), indent=1)
    lib = f"{x.out}/wbx_die.pretty"
    os.makedirs(lib, exist_ok=True)
    footprint(m, f"{lib}/{base}.kicad_mod")
    symbol(m, f"{x.out}/{base}.kicad_sym")
    wrl(m, f"{x.out}/{base}.wrl", x.png)
    print(f"{base}: {m['w']} x {m['h']} um, {len(m['pads'])} pads {m['counts']}, internal dropped {m['dropped_internal']}, "
          f"anchor {m['anchor'] or 'NONE, assumed BL'}, nets {m['nets_found']}/{len(m['pads'])}")
    print(' first pads:', [(p['n'], p['side'], p['net']) for p in m['pads'][:4]])
