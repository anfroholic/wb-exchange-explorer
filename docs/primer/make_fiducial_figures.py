"""Figures for docs/primer/fiducials.html, drawn from real design data.

    python docs/primer/make_fiducial_figures.py [--cob PATH] [--hz80 PATH]

Writes into docs/primer/img/:
  run2-fiducials.svg  the run 2 1x1 COB board, to scale, with its alignment marks labelled
  die-hz80.jpg        a wafer.space 0.5x1 die with its QR and rocket corners ringed
  die-zoom-*.jpg      those two corners at about 1 um per pixel
  die-eurosynth.jpg   the eurosynth die with its corner marks ringed

Defaults expect the sibling repositories next to this one in the GitHub folder.
"""
import argparse, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
GH = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
IMG = os.path.join(HERE, 'img')


# ---------- KiCad board ----------

def blocks(text, head):
    """Top-level-ish s-expression blocks that start with '(head'. Returns their text."""
    out, i = [], 0
    key = '(' + head
    while True:
        i = text.find(key, i)
        if i < 0:
            return out
        d, j = 0, i
        while True:
            c = text[j]
            if c == '(':
                d += 1
            elif c == ')':
                d -= 1
                if d == 0:
                    break
            elif c == '"':
                j = text.index('"', j + 1)
            j += 1
        out.append(text[i:j + 1])
        i = j + 1


def num(s):
    return float(s)


def board_svg(pcb_path, out_path):
    t = open(pcb_path, encoding='utf-8').read()
    edge = next(b for b in blocks(t, 'gr_rect') if '"Edge.Cuts"' in b)
    bx0, by0, bx1, by1 = map(num, re.search(r'\(start ([-\d.]+) ([-\d.]+)\)\s+\(end ([-\d.]+) ([-\d.]+)\)', edge).groups())

    S = 40.0          # px per mm
    M = 30.0          # margin above and below
    LL, LR = 360.0, 400.0   # label columns, left and right
    W = LL + (bx1 - bx0) * S + LR
    H = (by1 - by0) * S + 2 * M

    def P(x, y):
        return (LL + (x - bx0) * S, M + (y - by0) * S)

    parts, shapes, fps = [], [], []
    for fp in blocks(t, 'footprint "'):
        name = re.match(r'\(footprint "([^"]+)"', fp).group(1)
        fps.append(name)
        at = re.search(r'\n\t\t\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)', fp)
        fx, fy, fr = num(at.group(1)), num(at.group(2)), num(at.group(3) or 0)
        side = re.search(r'\n\t\t\(layer "([FB])\.Cu"\)', fp).group(1)
        c, s = math.cos(math.radians(fr)), math.sin(math.radians(fr))

        def G(x, y):  # footprint local -> board, KiCad y down
            return (fx + x * c + y * s, fy - x * s + y * c)

        for pad in blocks(fp, 'pad "'):
            m = re.search(r'\(pad "([^"]*)" (\w+) (\w+)\s+\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)\s+\(size ([\d.]+) ([\d.]+)\)', pad)
            if not m:
                continue
            _, kind, shape, px, py, pr, w, h = m.groups()
            gx, gy = G(num(px), num(py))
            w, h = num(w), num(h)
            if pr and round(num(pr)) % 180 == 90:   # pad angles in board files are absolute
                w, h = h, w
            drill = re.search(r'\(drill ([\d.]+)', pad)
            parts.append(dict(fp=name, side=side, kind=kind, shape=shape, x=gx, y=gy, w=w, h=h,
                              drill=num(drill.group(1)) if drill else None))
        if 'padring' in name:
            for g in blocks(fp, 'fp_'):
                lay = re.search(r'\(layers? ([^)]*)\)', g)
                lay = lay.group(1) if lay else ''
                if g.startswith('(fp_circle') and 'F.Cu' in lay:
                    cx, cy = map(num, re.search(r'\(center ([-\d.]+) ([-\d.]+)\)', g).groups())
                    ex, ey = map(num, re.search(r'\(end ([-\d.]+) ([-\d.]+)\)', g).groups())
                    shapes.append(('dot', [G(cx, cy)], math.hypot(ex - cx, ey - cy)))
                elif g.startswith('(fp_poly'):
                    pts = [G(num(a), num(b)) for a, b in re.findall(r'\(xy ([-\d.]+) ([-\d.]+)\)', g)]
                    if 'F.Cu' in lay:
                        shapes.append(('cross', pts, None))
                    elif 'F.Mask' in lay:
                        shapes.append(('mask', pts, None))
                    elif 'Dwgs.User' in lay:
                        shapes.append(('diepad', pts, None))

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" font-family="Arial,Helvetica,sans-serif">',
         '<title>Run 2 1x1 chip-on-board, top side to scale, with its alignment marks labelled</title>',
         '<style>.l{fill:#e8eceb;font-size:19px}.s{fill:#a9c9c1;font-size:16px}.k{fill:#ff8fd8;font-weight:700;font-size:20px}'
         '.ld{stroke:#ff8fd8;stroke-width:1.4;fill:none}.dm{stroke:#e8eceb;stroke-width:1.2;fill:none}</style>',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#0c1311"/>']
    x0, y0 = P(bx0, by0)
    o.append(f'<rect x="{x0}" y="{y0}" width="{(bx1-bx0)*S}" height="{(by1-by0)*S}" rx="3" fill="#1d5a3a" stroke="#2f7d55" stroke-width="2"/>')
    for kind, pts, r in shapes:
        if kind == 'mask':
            o.append('<polygon fill="#4f4a33" points="' + ' '.join('%.1f,%.1f' % P(*p) for p in pts) + '"/>')
    back = [p for p in parts if p['side'] == 'B' and not p['drill']]
    for p in back:   # parts on the back, seen through the board
        cx, cy = P(p['x'], p['y'])
        o.append(f'<rect x="{cx-p["w"]*S/2:.1f}" y="{cy-p["h"]*S/2:.1f}" width="{p["w"]*S:.1f}" height="{p["h"]*S:.1f}" fill="none" stroke="#9fb7ae" stroke-width="1" stroke-dasharray="3 2" opacity=".7"/>')
    for p in parts:
        if p['side'] != 'F' and not p['drill']:
            continue
        cx, cy = P(p['x'], p['y'])
        if p['drill']:
            o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{p["w"]*S/2:.1f}" fill="#e3b23c"/><circle cx="{cx:.1f}" cy="{cy:.1f}" r="{p["drill"]*S/2:.1f}" fill="#0c1311"/>')
        else:
            o.append(f'<rect x="{cx-p["w"]*S/2:.1f}" y="{cy-p["h"]*S/2:.1f}" width="{p["w"]*S:.1f}" height="{p["h"]*S:.1f}" fill="#e3b23c"/>')
    dp = [p for k, pts, _ in shapes if k == 'diepad' for p in pts]
    if dp:
        dx0, dx1 = min(p[0] for p in dp) - .04, max(p[0] for p in dp) + .04
        dy0, dy1 = min(p[1] for p in dp) - .04, max(p[1] for p in dp) + .04
        a, b = P(dx0, dy0)
        o.append(f'<rect x="{a:.1f}" y="{b:.1f}" width="{(dx1-dx0)*S:.1f}" height="{(dy1-dy0)*S:.1f}" fill="#6d7a86" stroke="#9aa7b2" opacity=".92"/>')
        dc = P((dx0 + dx1) / 2, (dy0 + dy1) / 2)
        o.append(f'<text x="{dc[0]:.1f}" y="{dc[1]+5:.1f}" text-anchor="middle" class="l">die</text>')
    crosses = []
    for kind, pts, r in shapes:
        if kind == 'cross':
            o.append('<polygon fill="#ff8fd8" points="' + ' '.join('%.1f,%.1f' % P(*q) for q in pts) + '"/>')
            crosses.append(((min(q[0] for q in pts) + max(q[0] for q in pts)) / 2, (min(q[1] for q in pts) + max(q[1] for q in pts)) / 2))
        elif kind == 'dot':
            cx, cy = P(*pts[0])
            o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r*S:.1f}" fill="#ff8fd8"/>')
            dot = (pts[0], r)
    (ax, ay), (bx, by) = sorted(crosses, key=lambda q: q[1])
    sep = math.hypot(bx - ax, by - ay)
    A, B = P(ax, ay), P(bx, by)
    o.append(f'<line x1="{A[0]:.1f}" y1="{A[1]:.1f}" x2="{B[0]:.1f}" y2="{B[1]:.1f}" stroke="#ff8fd8" stroke-width="1.2" stroke-dasharray="6 5"/>')

    hole = next(p for p in parts if p['drill'] and 'fiducial' in p['fp'])
    caps = [n for n in fps if 'C_0201' in n]
    lands = [p for p in parts if 'padring' in p['fp'] and not p['drill'] and min(p['w'], p['h']) < 0.5]

    def label(side, ty, target, key, line1, line2=''):
        if side == 'L':
            tx = LL - 24
            o.append(f'<path class="ld" d="M{tx+6:.0f},{ty-5:.0f} L{target[0]:.1f},{target[1]:.1f}"/>')
            o.append(f'<text x="{tx-4}" y="{ty}" class="l" text-anchor="end">{line1} <tspan class="k">{key}</tspan></text>')
            if line2:
                o.append(f'<text x="{tx-4}" y="{ty+22}" class="s" text-anchor="end">{line2}</text>')
        else:
            tx = W - LR + 24
            o.append(f'<path class="ld" d="M{tx-6:.0f},{ty-5:.0f} L{target[0]:.1f},{target[1]:.1f}"/>')
            o.append(f'<text x="{tx}" y="{ty}" class="l"><tspan class="k">{key}</tspan> {line1}</text>')
            if line2:
                o.append(f'<text x="{tx}" y="{ty+22}" class="s">{line2}</text>')

    label('L', A[1] - 40, A, 'A', 'Copper cross, 0.45 mm', 'corner of the die cavity')
    label('R', B[1] + 40, B, 'B', 'Copper cross, 0.45 mm', f'opposite corner, {sep:.1f} mm from A')
    dp_ = P(*dot[0])
    label('L', dp_[1] - 20, dp_, 'C', f'Copper dot, {dot[1]*2:.1f} mm', 'beside pad 0; the die QR goes here')
    hp = P(hole['x'], hole['y'])
    label('L', hp[1] + 30, hp, 'D', f'Plated hole, {hole["w"]:.1f} mm pad', f'{hole["drill"]:.0f} mm drill, GND, "pin1_fiducial"')

    rx = W - LR + 24
    leg = [('Gold', f'{len(lands)} bond lands and the die pad'),
           ('Dark tan', 'die cavity, no solder mask'),
           ('Dashed', f'{len(caps)} 0201 capacitors and the'),
           ('', '0.4 mm connector, on the back'),
           ('', ''),
           ('', 'No copper fiducial for pick and'),
           ('', 'place on either side, and none on'),
           ('', 'the 24-up panel.')]
    for i, (k, v) in enumerate(leg):
        o.append(f'<text x="{rx}" y="{60 + i*25}" class="{"l" if i < 4 else "s"}">' + (f'<tspan font-weight="700">{k}</tspan> ' if k else '') + f'{v}</text>')
    sy = H - 20
    o.append(f'<path class="dm" d="M{rx},{sy} h{2*S} M{rx},{sy-5} v10 M{rx+2*S},{sy-5} v10"/><text x="{rx+2*S+8}" y="{sy+5}" class="s">2 mm</text>')
    o.append(f'<text x="{rx}" y="{sy-22}" class="s">Board {bx1-bx0:.0f} × {by1-by0:.0f} mm, seen from the top</text>')
    o.append('</svg>')
    open(out_path, 'w', encoding='utf-8').write('\n'.join(o))
    print('wrote', out_path, f'(cross spacing {sep:.2f} mm)')


# ---------- die renders ----------

def ring(draw, box, w=6, col=(217, 58, 167)):
    x0, y0, x1, y1 = box
    for i in range(w):
        draw.ellipse((x0 - i, y0 - i, x1 + i, y1 + i), outline=col)


def die_figures(hz80_path, euro_path):
    from PIL import Image, ImageDraw
    im = Image.open(hz80_path).convert('RGB')
    w, h = im.size
    s = 300                                  # about 300 um at this render's ~1 um/px
    im.crop((0, h - s, s, h)).save(os.path.join(IMG, 'die-zoom-qr.jpg'), quality=88)
    im.crop((w - s, 0, w, s)).save(os.path.join(IMG, 'die-zoom-rocket.jpg'), quality=88)
    th = 900
    t = im.resize((round(w * th / h), th), Image.LANCZOS)
    d = ImageDraw.Draw(t)
    k = th / h
    R = 105 * k                              # QR and rocket, measured on the full render
    for cx, cy in ((96, h - 98), (w - 88, 102)):
        ring(d, (cx * k - R, cy * k - R, cx * k + R, cy * k + R), w=4)
    t.save(os.path.join(IMG, 'die-hz80.jpg'), quality=88)

    e = Image.open(euro_path).convert('RGB')
    d = ImageDraw.Draw(e)
    ring(d, (-8, e.height - 75, 70, e.height + 8))       # QR, bottom left
    ring(d, (e.width - 95, -10, e.width + 10, 95))        # triangle, top right
    ring(d, (-5, -5, 70, 62), w=4, col=(62, 169, 218))     # rocket, top left
    e.save(os.path.join(IMG, 'die-eurosynth.jpg'), quality=88)
    print('wrote die figures')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--cob', default=os.path.join(GH, 'chip-on-board-wire-bonded-pcbs', 'run-2', '1x1-cob', '1x1-mezzanine.kicad_pcb'))
    ap.add_argument('--hz80', default=os.path.join(GH, 'temp-reticle_diagrams', 'gds_renders', 'HZ80_chip_top_14_0.png'))
    ap.add_argument('--euro', default=os.path.join(IMG, 'eurosynth-die.jpg'))
    a = ap.parse_args()
    board_svg(a.cob, os.path.join(IMG, 'run2-fiducials.svg'))
    die_figures(a.hz80, a.euro)
