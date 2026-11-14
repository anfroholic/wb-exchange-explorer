"""Does "pad n goes to land n+1" fit this board and die, and does any other pairing fit better?

    python proto_pincheck.py BOARD.kicad_pcb DIE.die.json [--footprint REGEX] [--json OUT.json]

Tries every die rotation (0/90/180/270 on the board), both directions and every cyclic offset, and scores each against
two independent witnesses: the wires drawn in the COB footprint, and the nets on the lands. Pairing by itself is not
evidence; the drawn wires and the land nets were written by the board's author, without reference to this rule.

For the rule's own pairing it reports, wire by wire, whether the drawn wire's die end falls on the die edge and in the
order along that edge that the rule predicts, and whether it falls on the real pad.
"""
import argparse, json, math, re, statistics, sys
import proto_assemble as A


def split_drawn(cob):
    """Each drawn wire as (land number, land end, die end, distance from land end to that land's rectangle), in the board frame.
    Lines with no end near a land are not wires."""
    out, other = [], []
    geo = {no: A.land_geometry(cob, l) for no, l in cob['lands'].items()}

    def to_land(p):
        best = None
        for no, g in geo.items():
            dx, dy = p[0] - g['c'][0], p[1] - g['c'][1]
            along = abs(dx * g['u'][0] + dy * g['u'][1])
            across = abs(-dx * g['u'][1] + dy * g['u'][0])
            d = math.hypot(max(0, along - g['long'] / 2), max(0, across - g['short'] / 2))
            if best is None or d < best[0]:
                best = (d, no)
        return best

    for x0, y0, x1, y1, width in cob['drawn']:
        a, b = A.rot(x0, y0, cob['rot']), A.rot(x1, y1, cob['rot'])
        ra, rb = to_land(a), to_land(b)
        ra_, rb_ = (ra, a, b), (rb, b, a)
        (r, land_end, die_end) = min(ra_, rb_, key=lambda t: t[0][0])
        if r[0] > 0.1:
            other.append((a, b))
        else:
            out.append(dict(land=r[1], land_end=land_end, die_end=die_end, off_land=r[0], width=width))
    return out, other


def pad_edge(m, p, die_rot):
    """Which side of the die, in the board frame, the pad sits on, and its position along that side."""
    x, y = A.pad_board(m, p, die_rot)
    W, H = m['w'] / 2000, m['h'] / 2000
    if die_rot % 180:
        W, H = H, W
    d = {'R': W - x, 'L': W + x, 'B': H - y, 'T': H + y}
    k = min(d, key=d.get)
    return k, (x if k in 'BT' else y)


def point_edge(m, p, die_rot):
    W, H = m['w'] / 2000, m['h'] / 2000
    if die_rot % 180:
        W, H = H, W
    d = {'R': W - p[0], 'L': W + p[0], 'B': H - p[1], 'T': H + p[1]}
    k = min(d, key=d.get)
    return k, (p[0] if k in 'BT' else p[1])


def on_pad(m, p, q, die_rot):
    x, y = A.pad_board(m, p, die_rot)
    w, h = (p['w'] / 2000, p['h'] / 2000) if not die_rot % 180 else (p['h'] / 2000, p['w'] / 2000)
    return abs(q[0] - x) <= w and abs(q[1] - y) <= h


def nearest_pad(m, q, die_rot):
    return min(m['pads'], key=lambda p: math.dist(A.pad_board(m, p, die_rot), q))


def score(m, cob, wires, die_rot, sign, off):
    """How many witnesses agree with: land L pairs with pad (sign*(L-1)+off) mod N."""
    N = len(m['pads'])
    byn = {p['n']: p for p in m['pads']}
    near = 0
    for w in wires:
        target = (sign * (w['land'] - 1) + off) % N
        near += nearest_pad(m, w['die_end'], die_rot)['n'] == target
    netm = netc = 0
    for no, l in cob['lands'].items():
        ln = A.norm_net(l['net'])
        pn = A.norm_net(byn[(sign * (no - 1) + off) % N]['net'])
        if not ln or not pn or re.fullmatch(r'pad_\d+', ln):
            continue
        netc += 1
        netm += ln == pn
    padk = padkn = 0
    for no, l in cob['lands'].items():
        k = re.fullmatch(r'pad_(\d+)', A.norm_net(l['net']) or '')
        if k:
            padkn += 1
            padk += int(k[1]) == (sign * (no - 1) + off) % N
    length = sum(math.dist(A.pad_board(m, byn[(sign * (no - 1) + off) % N], die_rot), A.land_geometry(cob, l)['bond']) for no, l in cob['lands'].items())
    return dict(rot=die_rot, sign=sign, off=off, near=near, net=netm, netc=netc, padk=padk, padkn=padkn, length=length)


def main():
    x = argparse.ArgumentParser()
    x.add_argument('board')
    x.add_argument('die_json')
    x.add_argument('--footprint', default='padring')
    x.add_argument('--json')
    a = x.parse_args()
    text = A.strip_generated(open(a.board, encoding='utf-8').read())
    m = json.load(open(a.die_json))
    cob = A.parse_cob(text, a.footprint)
    wires, other = split_drawn(cob)
    N = len(m['pads'])
    print(f"{cob['lib']} rot {cob['rot']:g}: lands {len(cob['lands'])}, pads {N}, drawn lines {len(cob['drawn'])}, of which wires {len(wires)}, other {len(other)}")
    if len(cob['lands']) != N:
        print('Land count differs from pad count; the offset search below only covers what pairs.')
    if not all(no - 1 < N for no in cob['lands']):
        raise SystemExit('lands numbered past the pad count: not comparable')
    trials = [score(m, cob, wires, r, s, o) for r in (0, 90, 180, 270) for s in (1, -1) for o in range(N)]
    witness = lambda t: t['near'] + t['net'] + t['padk']
    ranked = sorted(trials, key=lambda t: (-witness(t), t['length']))
    print('best pairings of', len(trials), '(land L -> pad sign*(L-1)+off):')
    for t in ranked[:5]:
        print(f"  rot {t['rot']:3d} sign {t['sign']:+d} off {t['off']:2d}: drawn wires nearest that pad {t['near']}/{len(wires)}; nets {t['net']}/{t['netc']}; pad_k {t['padk']}/{t['padkn']}; length {t['length']:.1f} mm")
    # the rule, at the rotation with the shortest wires
    lens = A.measure_rotation(m, cob)
    rr = min(lens, key=lens.get)
    rule = next(t for t in trials if t['rot'] == rr and t['sign'] == 1 and t['off'] == 0)
    print(f"the rule at rotation {rr}: drawn wires nearest that pad {rule['near']}/{len(wires)}; nets {rule['net']}/{rule['netc']}; pad_k {rule['padk']}/{rule['padkn']}")
    res = dict(cob=cob['lib'], die=m['cell'], cob_rot=cob['rot'], rule_rot=rr, drawn_lines=len(cob['drawn']), drawn_wires=len(wires), rule=rule, best=ranked[:5])
    if wires:
        byn = {p['n']: p for p in m['pads']}
        same_edge = in_order = hit_any = hit_rule = 0
        rule_err, near_err, land_off, land_from_inner, edge_miss = [], [], [], [], []
        edges = {}
        for w in wires:
            p = byn.get(w['land'] - 1)
            if not p:
                continue
            ke, _ = point_edge(m, w['die_end'], rr)
            kp, _ = pad_edge(m, p, rr)
            same_edge += ke == kp
            edges.setdefault(kp, []).append(w)
            np_ = nearest_pad(m, w['die_end'], rr)
            hit_any += any(on_pad(m, q, w['die_end'], rr) for q in m['pads'])
            hit_rule += on_pad(m, p, w['die_end'], rr)
            rule_err.append(math.dist(A.pad_board(m, p, rr), w['die_end']))
            near_err.append(math.dist(A.pad_board(m, np_, rr), w['die_end']))
            g = A.land_geometry(cob, cob['lands'][w['land']])
            land_off.append(w['off_land'])
            dx, dy = w['land_end'][0] - g['inner'][0], w['land_end'][1] - g['inner'][1]
            land_from_inner.append(-g['sign'] * -(dx * g['u'][0] + dy * g['u'][1]))
        # order: walk each edge's wires by land number; the die ends must run the same way as the pads
        for k, ws in edges.items():
            ws = sorted(ws, key=lambda w: w['land'])
            dies = [point_edge(m, w['die_end'], rr)[1] for w in ws]
            pads = [pad_edge(m, byn[w['land'] - 1], rr)[1] for w in ws]
            for i in range(len(ws) - 1):
                in_order += (dies[i + 1] - dies[i]) * (pads[i + 1] - pads[i]) > 0
            in_order += 1
        res.update(same_edge=same_edge, in_order=in_order, ends_on_any_pad=hit_any, ends_on_rule_pad=hit_rule,
                   err_rule_median=statistics.median(rule_err), err_rule_worst=max(rule_err), err_nearest_median=statistics.median(near_err), err_nearest_worst=max(near_err),
                   land_end_off_land_worst=max(land_off), land_end_from_inner_median=statistics.median(land_from_inner), land_end_from_inner_min=min(land_from_inner), land_end_from_inner_max=max(land_from_inner))
        print(f"against drawn wires: same edge {same_edge}/{len(wires)}, same order along the edge {in_order}/{len(wires)}")
        print(f"drawn die ends on a real pad: {hit_any}/{len(wires)}, on the rule's pad {hit_rule}/{len(wires)}")
        print(f"miss from the rule's pad centre: median {statistics.median(rule_err):.3f} mm, worst {max(rule_err):.3f} mm; from the nearest pad: median {statistics.median(near_err):.3f}, worst {max(near_err):.3f}")
        print(f"drawn land end: {max(land_off):.3f} mm worst off the land; {statistics.median(land_from_inner):.3f} mm in from the inner end, median, range {min(land_from_inner):.3f} to {max(land_from_inner):.3f}")
    if other:
        print('lines that are not wires, board frame:', [(tuple(round(v, 3) for v in a_), tuple(round(v, 3) for v in b_)) for a_, b_ in other])
    if a.json:
        json.dump(res, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
