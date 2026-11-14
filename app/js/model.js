/* The marriage: place a die on a substrate, generate wires under different regimes, and measure them.
   Everything is in board millimetres, y down, except loop moves and heights, which are micrometres as in SPEC.md. */
(function (W) {
  'use strict';
  const { rot } = W.WBX.kicad;

  /* ---- loops: same moves model as wbx.loop ---- */
  function parseMoves(moves, span) {
    const pts = [[0, 0]];
    let x = 0, z = 0;
    for (const m of String(moves).trim().split(/\s+/).filter(Boolean)) {
      const [v, h] = m.split('/');
      if (v === undefined || h === undefined || isNaN(parseFloat(v)) || isNaN(parseFloat(h))) return null;
      z += parseFloat(v);
      x += h.endsWith('%') ? parseFloat(h) / 100 * span : parseFloat(h);
      pts.push([x, z]);
    }
    return pts;
  }
  function loopPts(moves, span, dz) {
    const p = parseMoves(moves, span) || [[0, 0]];
    p.push([span, dz]);
    return p;
  }
  function zAt(pts, x) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a[0] <= x && x <= b[0] && b[0] > a[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return pts[pts.length - 1][1];
  }
  function smooth(pts, per) {
    const out = [], P = [pts[0], ...pts, pts[pts.length - 1]];
    per = per || 8;
    for (let i = 1; i < P.length - 2; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2];
      for (let s = 0; s < per; s++) {
        const t = s / per;
        out.push([0, 1].map(j => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t * t * t)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // A vertical rise from the first bond stays crisp; the spline starts at the top of it.
  function loopCurve(type, span, dz) {
    const pts = loopPts(type.moves, span, dz);
    if (type.interp === 'polyline') return pts;
    if (pts.length > 2 && pts[1][0] === 0) return [pts[0], ...smooth(pts.slice(1))];
    return smooth(pts);
  }

  /* Two types leave the wire and loop to the person at the bonder. This pad goes to this land, and nothing more is said.
     GENERIC is a decision: someone chose to let the bonder pick. UNDEFINED means nobody has said anything, as on a board whose wires name no type.
     Neither has a spec. d 0 and empty moves are there so nothing reads them as one; both draw along choicePath, below. */
  const UNDEFINED = 'UNDEFINED', UNDEFINED_LABEL = 'Undefined: not specified';
  const GENERIC = 'GENERIC', GENERIC_LABEL = "Generic: bonder's choice";
  const CHOICE_TUBE_UM = 20;  // a visible thickness for drawings and 3D models of these wires, never a wire size
  const UNDEFINED_TYPE = () => ({ name: UNDEFINED, bonderChoice: true, family: 'undefined', style: '', material: '', d: 0, dir: 'forward', moves: '', interp: 'spline', colour: '#a9b4b1' });
  const GENERIC_TYPE = () => ({ name: GENERIC, bonderChoice: true, generic: true, family: 'generic', style: '', material: '', d: 0, dir: 'forward', moves: '', interp: 'spline', colour: '#d3dbd9' });
  // Bonder's choice: either of the two. Anything that needs a wire size or a loop asks this, never the names.
  const isBonderChoice = t => !!t && t.bonderChoice === true;
  const isGenericType = t => isBonderChoice(t) && t.generic === true;
  const isUndefinedType = t => isBonderChoice(t) && t.generic !== true;
  const isBonderChoiceWire = (S, w) => isBonderChoice(typeOf(S, w.type));
  const isUndefinedWire = (S, w) => isUndefinedType(typeOf(S, w.type));
  const RESERVED_NAME = /^(undefined|generic)$/i;
  const typeLabel = name => name === UNDEFINED ? UNDEFINED_LABEL : name === GENERIC ? GENERIC_LABEL : name;
  /* The one path for every bonder's choice wire, generic or undefined: a single shallow arc from end to end, s in um along the run, z in um above the board.
     It is a parabola over the straight line between the two bond heights. Its lift is a quarter of the height difference, which levels it off at the higher end,
     plus at least 4% of the span, and more if needed to pass over each [s, zMin] in clear: the die edges it leaves. No vertical rise, flat top or kink,
     so it never passes for a loop, and it bends the same way all along, so it renders clean. */
  function choicePath(span, z0, z1, clear, n) {
    n = n || 32;
    const dz = Math.abs(z1 - z0), out = [];
    let extra = 0.04 * span;
    for (const [s, zMin] of clear || []) {
      const t = s / span, b = t * (1 - t);
      if (!(t > 0 && t < 1)) continue;
      extra = Math.max(extra, (zMin - (z0 + (z1 - z0) * t) - dz * b) / (4 * b));
    }
    const lift = dz / 4 + extra;
    for (let i = 0; i <= n; i++) { const t = i / n; out.push([t * span, z0 + (z1 - z0) * t + 4 * lift * t * (1 - t)]); }
    return out;
  }
  /* A wire's stand-in path: it clears the edge of each die it bonds to by the drawn tube's width, or less where the pad is that close to the edge,
     so it rises no steeper than 1 in 2. Ends at both heights, zA at the die pad and zB at the far end, neither assumed to be the board. */
  function choiceCurve(e) {
    const span = e.len * 1000, gap = s => Math.min(CHOICE_TUBE_UM, 0.5 * s), clear = [];
    const exit = dieExit(e.die, e.a, e.b, e.len) * 1000;
    clear.push([exit, e.zA + gap(exit)]);
    if (e.toDie) { const back = dieExit(e.toDie, e.b, e.a, e.len) * 1000; clear.push([span - back, e.zB + gap(back)]); }
    return choicePath(span, e.zA, e.zB, clear);
  }
  // A session saved before these types existed gets them first in the list, with its own types, rules, default and wires left alone.
  function ensureReserved(S, is, re, make) {
    if (S.types.some(is)) return;
    const clash = S.types.find(t => !isBonderChoice(t) && re.test(t.name));
    if (clash) {
      const name = clash.name + '_1';
      for (const w of S.wires) if (w.type === clash.name) w.type = name;
      for (const r of S.typeRules) if (r.type === clash.name) r.type = name;
      if (S.defaultType === clash.name) S.defaultType = name;
      clash.name = name;
    }
    S.types.unshift(make());
  }
  function ensureUndefinedType(S) {
    ensureReserved(S, isUndefinedType, /^undefined$/i, UNDEFINED_TYPE);
    ensureReserved(S, isGenericType, /^generic$/i, GENERIC_TYPE);
  }
  const DEFAULT_TYPES = () => [
    GENERIC_TYPE(),
    UNDEFINED_TYPE(),
    { name: 'STD25', family: 'trapezoid', style: 'ball-wedge', material: 'Au', d: 25, dir: 'forward', moves: '180/0 30/12% -20/35%', interp: 'spline', colour: '#e8b84a' },
    { name: 'PWR33', family: 'trapezoid', style: 'ball-wedge', material: 'Au', d: 33, dir: 'forward', moves: '220/0 30/12% -30/40%', interp: 'spline', colour: '#f0764d' },
    { name: 'DOWN25', family: 'low', style: 'ball-wedge', material: 'Au', d: 25, dir: 'forward', moves: '110/0 25/20%', interp: 'spline', colour: '#69e28f' },
    { name: 'WEDGE25', family: 'custom', style: 'wedge-wedge', material: 'Al', d: 25, dir: 'forward', moves: '70/6% 50/18% -10/30%', interp: 'polyline', colour: '#8ad6fa' },
    { name: 'REV25', family: 'custom', style: 'ball-wedge', material: 'Au', d: 25, dir: 'reverse', moves: '470/0 -30/78%', interp: 'spline', colour: '#c5acfb' },
    { name: 'JEDEC4', family: 'jedec4', style: 'ball-wedge', material: 'Au', d: 25, dir: 'forward', moves: '200/0 0/12.5%', interp: 'polyline', colour: '#fa8fd8' },
  ];
  const FAMILIES = {
    triangle: { label: 'Triangle', make: (h, p) => `${h}/0` },
    trapezoid: { label: 'Trapezoid', make: (h, p) => `${h}/0 0/${p}%` },
    m: { label: 'M-shape', make: (h, p) => { const dip = Math.round(h * 0.18), q = Math.max(1, Math.round(p / 2)); return `${h}/0 ${-dip}/${q}% ${dip}/${q}%`; } },
    low: { label: 'Low', make: (h, p) => `${Math.round(h * 0.55)}/0 ${Math.round(h * 0.2)}/${p}%` },
    jedec4: { label: 'JEDEC 4-point', make: (h) => `${h}/0 0/12.5%` },
    custom: { label: 'Custom', make: null },
  };
  // Limits come labelled, because none of them is ours: see planning/wire_bond_lifecycle, section 10.
  const DEFAULT_LIMITS = () => ({ lengthMm: 6, angleDeg: 45, gapUm: 60, edgeUm: 40, moldUm: 0 });
  const PAD_FOR_WIRE = { 25: { open: 55, pitch: 65 }, 33: { open: 70, pitch: null } };

  /* ---- frames ---- */
  const dieToBoard = (place, x, y) => { const [a, b] = rot(x, y, place.rot); return [a + place.x, b + place.y]; };
  const boardToDie = (place, x, y) => rot(x - place.x, y - place.y, -place.rot);
  const dieCentre = die => [(die.x0 + die.x1) / 2, (die.y0 + die.y1) / 2];

  /* ---- several die ----
     S.dies has one slot per die: { id, die, place, ... }. A slot's die is null while it waits for a file.
     S.die and S.place read the selected slot, S.active. Anything about a wire goes through the slots the wire names.
     Nothing here assumes an arrangement: a die can sit anywhere, at any size, over or beside any other. */
  const placedDies = S => S.dies.filter(d => d.die);
  const dieById = (S, id) => S.dies.find(d => d.id === id) || null;
  const activeDie = S => dieById(S, S.active) || S.dies[0];
  const wireDieId = (S, w) => w.die == null ? (placedDies(S)[0] || {}).id : w.die;
  const isDieToDie = w => w.toPad != null;
  const padKey = (id, num) => id + '\t' + num;
  // Every pad and land a wire touches, so two wires can be asked whether they share an end.
  function wireEndKeys(S, w) {
    const k = [padKey(wireDieId(S, w), w.pad)];
    if (isDieToDie(w)) k.push(padKey(w.toDie, w.toPad)); else k.push('land\t' + w.land);
    return k;
  }
  const wireTouchesDie = (S, w, id) => wireDieId(S, w) === id || w.toDie === id;
  const wiresOnPad = (S, id, num) => S.wires.filter(w => wireEndKeys(S, w).includes(padKey(id, num)));

  // Heights in um above the board's top. The attach layer is under the die, except at a custom height, where the number is the die's underside.
  function dieSupport(S, d) {
    const on = d.place.on;
    if (!on || on === 'board' || on === 'custom') return null;
    const sup = dieById(S, on);
    return sup && sup.die && sup !== d ? sup : null;
  }
  function dieBottom(S, d, seen) {
    if (d.place.on === 'custom') return Math.max(0, +d.place.customUm || 0);
    seen = seen || new Set();
    seen.add(d.id);
    const sup = dieSupport(S, d);
    return (sup && !seen.has(sup.id) ? dieBottom(S, sup, seen) + sup.place.thick : 0) + d.place.attach;
  }
  const dieTop = (S, d) => dieBottom(S, d) + d.place.thick;
  const dieBase = (S, d) => d.place.on === 'custom' ? dieBottom(S, d) : dieBottom(S, d) - d.place.attach;
  // The die sitting on this one, directly or through another.
  function stackedOn(S, d) {
    const out = [], seen = new Set([d.id]);
    const walk = x => { for (const o of S.dies) if (dieSupport(S, o) === x && !seen.has(o.id)) { seen.add(o.id); out.push(o); walk(o); } };
    walk(d);
    return out;
  }
  // Lowest first, each die after whatever it sits on.
  const stackOrder = S => placedDies(S).map((d, i) => ({ d, i, z: dieBottom(S, d) })).sort((a, b) => a.z - b.z || a.i - b.i).map(o => o.d);
  const dieCorners = d => [[d.die.x0, d.die.y0], [d.die.x1, d.die.y0], [d.die.x1, d.die.y1], [d.die.x0, d.die.y1]].map(q => dieToBoard(d.place, q[0], q[1]));
  const inOutline = (d, q) => { const [x, y] = boardToDie(d.place, q[0], q[1]); return x > d.die.x0 && x < d.die.x1 && y > d.die.y0 && y < d.die.y1; };
  // Separating axes: two outlines at any rotation overlap unless an edge normal of one separates them. Touching doesn't count.
  function outlinesOverlap(a, b) {
    const A = dieCorners(a), B = dieCorners(b), span = (P, n) => { const v = P.map(p => p[0] * n[0] + p[1] * n[1]); return [Math.min(...v), Math.max(...v)]; };
    for (const P of [A, B]) for (let i = 0; i < 2; i++) {
      const n = [P[i + 1][1] - P[i][1], P[i][0] - P[i + 1][0]], s = span(A, n), t = span(B, n), eps = 1e-9 * (Math.abs(n[0]) + Math.abs(n[1]));
      if (s[1] <= t[0] + eps || t[1] <= s[0] + eps) return false;
    }
    return true;
  }
  // The stretch of a straight run a to b that lies over a die's outline, as mm from a, or null if it misses.
  function clipToDie(d, a, b) {
    const [ax, ay] = boardToDie(d.place, a[0], a[1]), [bx, by] = boardToDie(d.place, b[0], b[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t0 = 0, t1 = 1;
    for (const [o, v, lo, hi] of [[ax, bx - ax, d.die.x0, d.die.x1], [ay, by - ay, d.die.y0, d.die.y1]]) {
      if (Math.abs(v) < 1e-12) { if (o <= lo || o >= hi) return null; continue; }
      let u = (lo - o) / v, w = (hi - o) / v;
      if (u > w) [u, w] = [w, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, w);
      if (t0 >= t1) return null;
    }
    return [t0 * len, t1 * len];
  }

  function landAxis(l) {
    const horizontal = l.w >= l.h;
    const [ux, uy] = rot(1, 0, horizontal ? l.rot : l.rot + 90);
    return { ux, uy, long: Math.max(l.w, l.h), short: Math.min(l.w, l.h) };
  }
  /* Where a wire ends on a land. mode "inner": mm in from the end nearest the die (question 8 in the plan). */
  function landBond(l, place, die, bond) {
    const { ux, uy, long } = landAxis(l);
    if (bond.mode === 'centre') return [l.x, l.y];
    const [cx, cy] = dieToBoard(place, ...dieCentre(die));
    const e1 = [l.x + ux * long / 2, l.y + uy * long / 2], e2 = [l.x - ux * long / 2, l.y - uy * long / 2];
    const near1 = Math.hypot(e1[0] - cx, e1[1] - cy) < Math.hypot(e2[0] - cx, e2[1] - cy);
    const inner = near1 ? e1 : e2, sign = near1 ? -1 : 1, d = Math.min(bond.mm, long / 2);
    return [inner[0] + sign * ux * d, inner[1] + sign * uy * d];
  }
  /* A wire is { die, pad, land } from a pad to a land, or { die, pad, toDie, toPad } from a pad to a pad on another die.
     a is always the die, pad end. b is the land, or the far pad. zA and zB are their heights in um. */
  function wireEnds(S, w) {
    const d = dieById(S, wireDieId(S, w));
    const pad = d && d.die && d.padBy.get(w.pad);
    if (!pad) return null;
    let a;
    if (w.padOff) a = dieToBoard(d.place, pad.x + w.padOff[0], pad.y + w.padOff[1]);
    else a = dieToBoard(d.place, pad.x, pad.y);
    const zA = dieTop(S, d);
    let b;
    if (isDieToDie(w)) {
      const t = dieById(S, w.toDie), toPad = t && t.die && t.padBy.get(w.toPad);
      if (!toPad) return null;
      const off = w.toPadOff || [0, 0];
      b = dieToBoard(t.place, toPad.x + off[0], toPad.y + off[1]);
      return { a, b, pad, land: null, toPad, die: d, toDie: t, zA, zB: dieTop(S, t), len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    }
    const land = S.landBy.get(w.land);
    if (!land) return null;
    if (w.landOff) { const ax = landAxis(land); b = [land.x + ax.ux * w.landOff[0] - ax.uy * w.landOff[1], land.y + ax.uy * w.landOff[0] + ax.ux * w.landOff[1]]; }
    else b = landBond(land, d.place, d.die, S.bond);
    return { a, b, pad, land, toPad: null, die: d, toDie: null, zA, zB: 0, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  }
  // The net at the far end of a wire, and how the two ends are named. Die names appear once there is more than one die.
  const farNet = e => e.land ? e.land.net : e.toPad.net;
  function wireLabels(S, e) {
    const many = placedDies(S).length > 1;
    return {
      from: (many ? e.die.id + '.' : '') + e.pad.num,
      fromWords: (many ? e.die.id + ' pad ' : 'pad ') + e.pad.num,
      to: e.land ? String(e.land.id) : e.toDie.id + '.' + e.toPad.num,
      toWords: e.land ? 'land ' + e.land.id : e.toDie.id + ' pad ' + e.toPad.num,
    };
  }

  function normNet(s) {
    if (!s) return null;
    s = String(s).replace(/^\//, '');
    if (/^(D?VSS|GND)$/i.test(s)) return 'GND';
    if (/^(D?VDD|VDD_\w+|PWR_AUX_\d+)$/i.test(s)) return 'VDD';
    const m = s.match(/^(\w+?)_?PAD(?:\[(\d+)\])?$/);
    if (m) s = m[1] + (m[2] ? '_' + m[2] : '');
    return s.replace(/^analog_/, 'an_').replace(/^input_/, 'in_');
  }
  // True, false, or null when the two ends can't be compared. A land net "pad_k" names die pad k, counted from zero.
  function netsAgree(padNet, padNum, landNet) {
    const ln = normNet(landNet), pn = normNet(padNet);
    const k = ln && ln.match(/^pad_(\d+)$/);
    if (k) return +k[1] + 1 === +padNum;
    if (!ln || !pn) return null;
    return ln === pn;
  }
  // The same question for a wire's two ends, whichever kind of far end it has.
  function endsAgree(e) {
    if (e.land) return netsAgree(e.pad.net, e.pad.num, e.land.net);
    const a = normNet(e.pad.net), b = normNet(e.toPad.net);
    return a && b ? a === b : null;
  }

  /* ---- type rules ---- */
  function typeFor(S, net) {
    for (const r of S.typeRules) {
      if (!r.match) continue;
      let hit = false;
      try { hit = new RegExp(r.match).test(String(net || '').replace(/^\//, '')); } catch (e) { /* a half-typed pattern matches nothing */ }
      if (hit && S.types.some(t => t.name === r.type)) return r.type;
    }
    return S.defaultType && S.types.some(t => t.name === S.defaultType) ? S.defaultType : S.types[0] && S.types[0].name;
  }
  const mkWire = (S, pad, land, extra) => Object.assign({ die: S.active, pad: pad.num, land: land.id, type: typeFor(S, pad.net || land.net) }, extra);
  const mkDieWire = (S, dieId, pad, toDie, toPad, extra) => Object.assign({ die: dieId, pad: pad.num, land: null, toDie, toPad: toPad.num, type: typeFor(S, pad.net || toPad.net) }, extra);

  /* ---- regimes ----
     Each runs for the selected die, S.die, against the lands. Lands another die's wires hold are left free where the rule allows a choice. */
  const landsHeldByOthers = S => new Set(S.wires.filter(w => !isDieToDie(w) && wireDieId(S, w) !== S.active).map(w => w.land));
  function regimeNumber(S, offset) {
    const byOrd = new Map(S.lands.filter(l => l.ord !== null).map(l => [l.ord, l]));
    const out = [];
    S.die.pads.forEach((p, i) => {
      const n = parseInt(p.num, 10);
      const l = byOrd.get((isNaN(n) ? i + 1 : n) + offset);
      if (l) out.push(mkWire(S, p, l));
    });
    return out;
  }
  function regimeNets(S) {
    const pairs = [];
    for (const p of S.die.pads) {
      const [ax, ay] = dieToBoard(S.place, p.x, p.y);
      for (const l of S.lands) if (netsAgree(p.net, p.num, l.net) === true) pairs.push({ p, l, d: Math.hypot(l.x - ax, l.y - ay) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const used = new Set(), usedL = landsHeldByOthers(S), out = [];
    for (const q of pairs) if (!used.has(q.p.num) && !usedL.has(q.l.id)) { used.add(q.p.num); usedL.add(q.l.id); out.push(mkWire(S, q.p, q.l)); }
    // Supplies may share a land: a pad left over after one-to-one pairing goes to its nearest land on the same net.
    for (const q of pairs) if (!used.has(q.p.num)) { used.add(q.p.num); out.push(mkWire(S, q.p, q.l)); }
    // A named pad with no land on its net goes to the nearest pad on another die with the same net.
    const usedFar = new Set();
    for (const w of S.wires) if (!wireTouchesDie(S, w, S.active)) for (const k of wireEndKeys(S, w)) usedFar.add(k);
    for (const p of S.die.pads) {
      const pn = normNet(p.net);
      if (used.has(p.num) || !pn) continue;
      const [ax, ay] = dieToBoard(S.place, p.x, p.y);
      let best = null, bd = Infinity;
      for (const d of placedDies(S)) if (d.id !== S.active) for (const q of d.die.pads) {
        if (normNet(q.net) !== pn || usedFar.has(padKey(d.id, q.num))) continue;
        const [bx, by] = dieToBoard(d.place, q.x, q.y), v = Math.hypot(bx - ax, by - ay);
        if (v < bd) { bd = v; best = { d, q }; }
      }
      if (best) { used.add(p.num); usedFar.add(padKey(best.d.id, best.q.num)); out.push(mkDieWire(S, S.active, p, best.d.id, best.q)); }
    }
    return out;
  }
  /* Geometry only, no names and no numbers: both rings in angular order around the die, paired without crossing at the
     rotation that gives the shortest total wire. Pads or lands may be skipped when the counts differ. */
  function regimeRing(S) {
    const die = S.die;
    const [cx, cy] = dieToBoard(S.place, ...dieCentre(die));
    const ang = (x, y) => Math.atan2(y - cy, x - cx);
    const pads = die.pads.map(p => { const b = dieToBoard(S.place, p.x, p.y); return { p, x: b[0], y: b[1], t: ang(b[0], b[1]) }; }).sort((a, b) => a.t - b.t);
    const held = landsHeldByOthers(S);
    const lands = S.lands.filter(l => !held.has(l.id)).map(l => { const b = landBond(l, S.place, die, S.bond); return { l, x: b[0], y: b[1], t: ang(b[0], b[1]) }; }).sort((a, b) => a.t - b.t);
    const N = pads.length, M = lands.length;
    if (!N || !M) return [];
    const C = pads.map(a => lands.map(b => Math.hypot(a.x - b.x, a.y - b.y)));
    const SKIP = 1e4;   // leaving a pad or land out is allowed only when the counts force it
    let best = Infinity, bestPairs = [];
    for (let off = 0; off < M; off++) {
      if (N === M) {
        let tot = 0;
        for (let i = 0; i < N; i++) tot += C[i][(i + off) % M];
        if (tot < best) { best = tot; bestPairs = pads.map((_, i) => [i, (i + off) % M]); }
        continue;
      }
      const dp = [], from = [];
      for (let i = 0; i <= N; i++) { dp.push(new Float64Array(M + 1).fill(Infinity)); from.push(new Uint8Array(M + 1)); }
      dp[0][0] = 0;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
        const v = dp[i][j];
        if (v === Infinity) continue;
        if (i < N && j < M) { const c = v + C[i][(j + off) % M]; if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; from[i + 1][j + 1] = 1; } }
        if (j < M && v + (N > M ? SKIP : 0) < dp[i][j + 1]) { dp[i][j + 1] = v + (N > M ? SKIP : 0); from[i][j + 1] = 2; }
        if (i < N && v + SKIP < dp[i + 1][j]) { dp[i + 1][j] = v + SKIP; from[i + 1][j] = 3; }
      }
      if (dp[N][M] < best) {
        best = dp[N][M];
        const pairs = [];
        let i = N, j = M;
        while (i || j) { const f = from[i][j]; if (f === 1) { pairs.push([i - 1, (j - 1 + off) % M]); i--; j--; } else if (f === 2) j--; else i--; }
        bestPairs = pairs.reverse();
      }
    }
    return bestPairs.map(([i, j]) => mkWire(S, pads[i].p, lands[j].l));
  }
  // The board speaks for all of its die at once, so this one isn't limited to the selected die.
  function regimeBoard(S) {
    const out = [], placed = placedDies(S);
    // "D2.7" means pad 7 of the die called D2.
    const padEnd = raw => {
      for (const d of placed) if (raw.startsWith(d.id + '.')) { const pad = d.padBy.get(raw.slice(d.id.length + 1)); if (pad) return { d, pad }; }
      return null;
    };
    for (const w of S.boardWires || []) {
      const fromRaw = String(w.from || ''), toRaw = String(w.to || '');
      // With one die, the name in front of the pad number doesn't matter: someone else's board may call its die anything.
      let from = padEnd(fromRaw);
      if (!from && placed.length === 1) { const pad = placed[0].padBy.get(fromRaw.split('.').pop()); if (pad) from = { d: placed[0], pad }; }
      if (!from) continue;
      // A board that names no type we can read has said nothing about the wire, so no rule or default speaks for it.
      const type = S.types.some(t => t.name === w.type) ? w.type : UNDEFINED;
      const far = w.toKind === 'die' || !S.landBy.has(toRaw) ? padEnd(toRaw) : null;
      if (far) { out.push(mkDieWire(S, from.d.id, from.pad, far.d.id, far.pad, { type, seq: w.seq })); continue; }
      if (w.toKind === 'die') continue;
      const land = S.landBy.get(toRaw) || S.landBy.get(toRaw.split('.').pop()) || S.lands.find(l => l.ref === toRaw);
      if (land) out.push({ die: from.d.id, pad: from.pad.num, land: land.id, type, seq: w.seq });
    }
    return out;
  }
  function regimeDrawn(S) {
    const out = [], tol = 0.15, used = new Set();
    for (const ln of S.drawn || []) {
      const ends = [[ln[0], ln[1]], [ln[2], ln[3]]];
      const nearLand = e => { let b = null, d = Infinity; for (const l of S.lands) { const v = pointToLand(e, l); if (v < d) { d = v; b = l; } } return [b, d]; };
      const nearPad = e => { let b = null, d = Infinity; for (const p of S.die.pads) { const q = dieToBoard(S.place, p.x, p.y), v = Math.hypot(e[0] - q[0], e[1] - q[1]) - Math.max(p.w, p.h) / 2; if (v < d) { d = v; b = p; } } return [b, d]; };
      const [l0, ld0] = nearLand(ends[0]), [l1, ld1] = nearLand(ends[1]);
      const landEnd = ld0 <= ld1 ? 0 : 1, l = landEnd ? l1 : l0, ld = landEnd ? ld1 : ld0;
      const [p, pd] = nearPad(ends[1 - landEnd]);
      if (l && p && ld <= tol && pd <= tol && !used.has(p.num)) { used.add(p.num); out.push(mkWire(S, p, l)); }
    }
    return out;
  }
  const REGIMES = {
    number: { label: 'Number rule', what: 'Die pad n goes to land n + offset. Needs pin 1 and a direction, nothing more.', run: S => regimeNumber(S, S.numberOffset || 0) },
    ring: { label: 'Shortest ring', what: 'Angular order around the die, at the rotation with the least wire. Needs no names or numbers.', run: regimeRing },
    nets: { label: 'Net names', what: 'Pads and lands on the same net. Needs GDS labels or pad nets, and named lands.', run: regimeNets },
    board: { label: 'From the board', what: 'Wires already in the board as wb_ footprints. Geometry is recalculated.', run: regimeBoard, needs: S => (S.boardWires || []).length > 0 },
    drawn: { label: 'Drawn lines', what: 'Comment-layer lines in the substrate footprint, snapped to a pad and land within 0.15 mm.', run: regimeDrawn, needs: S => (S.drawn || []).length > 0 },
  };

  function pointToLand(e, l) {
    const { ux, uy, long, short } = landAxis(l);
    const dx = e[0] - l.x, dy = e[1] - l.y, a = Math.abs(dx * ux + dy * uy) - long / 2, b = Math.abs(-dx * uy + dy * ux) - short / 2;
    return Math.max(a, b, 0);
  }

  /* ---- measuring ---- */
  function segCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function segDist(a, b, c, d) {
    if (segCross(a, b, c, d)) return 0;
    const pt = (p, s, e) => {
      const dx = e[0] - s[0], dy = e[1] - s[1], l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l)) : 0;
      return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy);
    };
    return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
  }
  // Angle between a wire and the normal of the die edge its pad sits on, in the board frame. With a pad at each end, the worse of the two.
  function padAngle(S, e) {
    const at = (pad, d, from, to) => {
      const n = { B: [0, 1], T: [0, -1], L: [-1, 0], R: [1, 0] }[pad.side] || [0, 1];
      const [nx, ny] = rot(n[0], n[1], d.place.rot);
      const dx = (to[0] - from[0]) / (e.len || 1), dy = (to[1] - from[1]) / (e.len || 1);
      return Math.acos(Math.max(-1, Math.min(1, nx * dx + ny * dy))) * 180 / Math.PI;
    };
    const near = at(e.pad, e.die, e.a, e.b);
    return e.toPad ? Math.max(near, at(e.toPad, e.toDie, e.b, e.a)) : near;
  }
  // How far along a run it leaves a die's outline, measured from the end on that die, in mm.
  function dieExit(slot, from, to, len) {
    const [ax, ay] = boardToDie(slot.place, from[0], from[1]);
    const [bx, by] = boardToDie(slot.place, to[0], to[1]);
    const d = slot.die, ux = (bx - ax) / (len || 1), uy = (by - ay) / (len || 1), ts = [];
    if (Math.abs(ux) > 1e-9) ts.push((d.x0 - ax) / ux, (d.x1 - ax) / ux);
    if (Math.abs(uy) > 1e-9) ts.push((d.y0 - ay) / uy, (d.y1 - ay) / uy);
    const pos = ts.filter(t => t > 1e-9);
    return pos.length ? Math.min(...pos) : 0;
  }
  function typeOf(S, name) { return S.types.find(t => t.name === name) || S.types.find(isUndefinedType) || S.types[0]; }
  /* Where a wire's loop meets the die it runs over, as { d, s, z, ref, clear, kind }, with s in um from end a.
     On a die it bonds to, that's the edge it crosses. A wire that never leaves that die's outline crosses no edge of it.
     Any other die in its way is measured over the whole stretch above it, against the top, or the underside if the wire runs beneath an overhang. */
  function wireEdges(S, e, rawPts, zOf, span, reverse) {
    const out = [];
    const exit = dieExit(e.die, e.a, e.b, e.len) * 1000;
    const edge = (d, s, ref) => { const z = zOf(s); out.push({ d, s, z, ref, clear: z - ref, kind: 'edge' }); };
    if (!e.toDie || exit < span) edge(e.die, exit, e.zA);
    if (e.toDie) {
      const back = dieExit(e.toDie, e.b, e.a, e.len) * 1000;
      if (back < span) edge(e.toDie, span - back, e.zB);
    }
    if (!out.length) edge(e.die, exit, e.zA);
    for (const d of placedDies(S)) {
      if (d === e.die || d === e.toDie) continue;
      const iv = clipToDie(d, e.a, e.b);
      if (!iv) continue;
      const s0 = iv[0] * 1000, s1 = iv[1] * 1000;
      const ss = [s0, s1, ...rawPts.map(p => reverse ? span - p[0] : p[0]).filter(s => s > s0 && s < s1)];
      const zs = ss.map(zOf), hi = Math.max(...zs), base = dieBase(S, d);
      if (hi <= base) { out.push({ d, s: ss[zs.indexOf(hi)], z: hi, ref: base, clear: base - hi, kind: 'under', s0, s1 }); continue; }
      const lo = Math.min(...zs), top = dieTop(S, d);
      out.push({ d, s: ss[zs.indexOf(lo)], z: lo, ref: top, clear: lo - top, kind: 'over', s0, s1 });
    }
    return out;
  }
  // Everything the views and checks need about one wire. Heights are um above the board's top surface: zTop at the die pad end, zEnd at the far end.
  function wireProfile(S, w, e) {
    const type = typeOf(S, w.type), choice = isBonderChoice(type);
    const zTop = e.zA, zEnd = e.zB;
    // A bonder's choice wire has no direction either: its path runs from end a, the die pad, to end b.
    const span = e.len * 1000, reverse = !choice && type.dir === 'reverse';
    const baseZ = reverse ? zEnd : zTop, dz = reverse ? zTop - zEnd : zEnd - zTop;
    const stand = choice ? choiceCurve(e) : null;
    const rawPts = choice ? stand.map(p => [p[0], p[1] - baseZ]) : loopPts(type.moves, span, dz);
    const zOf = s => zAt(rawPts, reverse ? span - s : s) + baseZ;
    const exit = dieExit(e.die, e.a, e.b, e.len) * 1000;
    const edges = wireEdges(S, e, rawPts, zOf, span, reverse);
    const worst = edges.reduce((m, x) => x.clear < m.clear ? x : m);
    const peak = Math.max(...rawPts.map(p => p[1])) + baseZ;
    const curve = choice ? stand : loopCurve(type, span, dz).map(p => [p[0], p[1] + baseZ]);
    /* choice gates every check that needs a wire size or loop, and undef is kept equal to it for code written before GENERIC.
       generic and dashed say how to draw it: GENERIC solid, UNDEFINED dashed, along the same path. */
    return { type, choice, undef: choice, generic: isGenericType(type), dashed: isUndefinedType(type), span, reverse, zTop, zEnd, exit, edges, worst, clearance: worst.clear, peak, curve, zOf, firstAtDie: !reverse };
  }
  function measure(S, wires) {
    const rows = [];
    for (const w of wires) { const e = wireEnds(S, w); if (e) rows.push({ w, e }); }
    let cross = 0, agree = 0, compared = 0, total = 0, longest = 0, worstAngle = 0;
    const padsUsed = new Set(), padsOn = {};
    const use = (id, num) => { const k = padKey(id, num); if (!padsUsed.has(k)) { padsUsed.add(k); padsOn[id] = (padsOn[id] || 0) + 1; } };
    for (let i = 0; i < rows.length; i++) {
      const { w, e } = rows[i];
      total += e.len; longest = Math.max(longest, e.len);
      worstAngle = Math.max(worstAngle, padAngle(S, e));
      use(e.die.id, w.pad);
      if (e.toDie) use(e.toDie.id, w.toPad);
      const ok = endsAgree(e);
      if (ok !== null) { compared++; if (ok) agree++; }
      for (let j = i + 1; j < rows.length; j++) if (segCross(e.a, e.b, rows[j].e.a, rows[j].e.b)) cross++;
    }
    return { wires: rows.length, total, longest, worstAngle, cross, agree, compared, padsUsed: padsUsed.size, padsOn, estimate: rows.some(r => isBonderChoiceWire(S, r.w)) };
  }
  /* Facts about how the die sit, which need no wire: they hold whatever anyone bonds. Silent with one die. */
  function stackChecks(S, add) {
    const dies = placedDies(S);
    if (dies.length < 2) return;
    const clash = [];
    for (let i = 0; i < dies.length; i++) for (let j = i + 1; j < dies.length; j++) {
      const a = dies[i], b = dies[j];
      if (dieBottom(S, a) < dieTop(S, b) - 1e-6 && dieBottom(S, b) < dieTop(S, a) - 1e-6 && outlinesOverlap(a, b)) clash.push(a.id + ' and ' + b.id);
    }
    add('overlap', 'Die overlapping at the same height', 'Geometry', clash.length ? 'fail' : 'ok', clash.length ? clash.join(', ') : 'none', [], 'Both outline and height range overlap, so these die are in the same space.');
    const adrift = dies.filter(d => dieSupport(S, d) && !outlinesOverlap(d, dieSupport(S, d)));
    if (adrift.length) add('support', 'Die not over what it sits on', 'Geometry', 'warn', adrift.map(d => `${d.id} on ${d.place.on}`).join(', '), [], 'Its height comes from that die, but the outlines do not overlap.');
  }

  function check(S) {
    const L = S.limits, out = [], rows = [];
    for (const w of S.wires) { const e = wireEnds(S, w); if (e) rows.push({ w, e, prof: wireProfile(S, w, e) }); }
    const add = (id, label, source, status, value, wires, detail, limitKey, unit) => out.push({ id, label, source, status, value, wires: wires || [], detail, limitKey, unit });
    const fmt = (v, d) => (+v).toFixed(d === undefined ? 2 : d);
    const dies = placedDies(S), many = dies.length > 1;
    if (!rows.length) { stackChecks(S, add); return { rows, list: out }; }

    /* Pairing and endpoints are known for every wire, so those checks see them all. Anything that needs the wire's size or
       loop only sees wires that have them. The rest are counted as not checked, which never reads as a pass. */
    // Generic and undefined wires both leave the wire and loop to the bonder, so prof.choice gates both the same way.
    const specified = rows.filter(r => !r.prof.choice), open = rows.length - specified.length;
    const unknown = open ? `${open} left to the bonder, not checked` : '';
    const judged = (id, label, source, status, value, wires, detail, limitKey, unit) => {
      if (!specified.length) add(id, label, source, 'na', `not checked: ${open} left to the bonder`, [], "It needs the wire or loop, which are the bonder's call. " + detail, limitKey, unit);
      else { add(id, label, source, status, unknown ? `${value}; ${unknown}` : value, wires, detail, limitKey, unit); out[out.length - 1].notChecked = open; }
    };
    if (open) {
      const gen = rows.filter(r => r.prof.generic).length, und = open - gen;
      add('undefined', 'Wires left to the bonder', 'This session', 'info', `${open} of ${rows.length}`, rows.filter(r => r.prof.choice).map(r => r.w),
        `${gen} generic, chosen to be left to the bonder, and ${und} undefined, where nothing was said. Pad and land are set. Wire and loop are not, so their drawn paths are stand-ins and their lengths are estimates.`);
    }

    let bad = rows.filter(r => r.e.len > L.lengthMm);
    // What is measured, and what the limit is: a service maximum for one wire, not a physical law. See docs/wire_bond_design_rules.svg.
    add('length', 'Wire length, straight bond to bond', 'Europractice, 25 µm Au', bad.length ? 'warn' : 'ok', `longest ${fmt(Math.max(...rows.map(r => r.e.len)))} mm${open ? ', estimate' : ''}`, bad.map(r => r.w),
      `${bad.length} over ${fmt(L.lengthMm, 1)} mm. Measures the straight plan distance from first bond to second bond; the wire itself is longer by its loop. The limit is a vendor's standard service maximum for 25 µm Au ball wire, not a physical limit` + (open ? ', so for a wire left to the bonder it is only a guide' : ''), 'lengthMm', 'mm');

    bad = rows.filter(r => padAngle(S, r.e) > L.angleDeg);
    add('angle', 'Angle from pad normal', 'Europractice', bad.length ? 'warn' : 'ok', `worst ${fmt(Math.max(...rows.map(r => padAngle(S, r.e))), 1)}°`, bad.map(r => r.w), `${bad.length} over the limit`, 'angleDeg', '°');

    const crossed = new Set();
    // Two wires leaving one die to the board are at the same level, so a crossing in plan is a crossing. Any other pair may pass at different heights, so those are compared by height.
    const sameLevel = (a, b) => !a.e.toDie && !b.e.toDie && a.e.die === b.e.die;
    const overCross = [];
    let minGap = Infinity, gapBad = new Set();
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (segCross(a.e.a, a.e.b, b.e.a, b.e.b)) {
        if (sameLevel(a, b)) { crossed.add(a.w); crossed.add(b.w); } else overCross.push([a, b]);
      }
      const ka = wireEndKeys(S, a.w), kb = wireEndKeys(S, b.w);
      if (ka[0] === kb[0] || ka[1] === kb[1] || ka[0] === kb[1] || ka[1] === kb[0]) continue;
      const g = segDist(a.e.a, a.e.b, b.e.a, b.e.b) * 1000;
      if (g < minGap) minGap = g;
      if (g < L.gapUm) { gapBad.add(a.w); gapBad.add(b.w); }
    }
    add('cross', 'Crossings in plan view', 'Europractice', crossed.size > W.WBX.rules.value(S, 'crossings') ? 'fail' : 'ok', crossed.size ? `${crossed.size} wires cross` : 'none', [...crossed], many ? 'Compares wires from one die to the board. The next row covers every other pair.' : '');
    if (many) {
      // No limit exists for wires passing over each other, so the only number used is the wire gap we already have.
      let closest = Infinity, unknownPairs = 0;
      const close = new Set(), seen = new Set();
      for (const [a, b] of overCross) {
        seen.add(a.w); seen.add(b.w);
        if (a.prof.choice || b.prof.choice) { unknownPairs++; continue; }
        const at = q => { const dx = q.e.b[0] - q.e.a[0], dy = q.e.b[1] - q.e.a[1], o = q === a ? b : a, ox = o.e.b[0] - o.e.a[0], oy = o.e.b[1] - o.e.a[1], den = dx * oy - dy * ox; return den ? ((o.e.a[0] - q.e.a[0]) * oy - (o.e.a[1] - q.e.a[1]) * ox) / den : 0; };
        const sep = Math.abs(a.prof.zOf(at(a) * a.prof.span) - b.prof.zOf(at(b) * b.prof.span)) - (a.prof.type.d + b.prof.type.d) / 2;
        closest = Math.min(closest, sep);
        if (sep < L.gapUm) { close.add(a.w); close.add(b.w); }
      }
      const bits = [];
      if (overCross.length) bits.push(`${overCross.length} crossing${overCross.length > 1 ? 's' : ''}`);
      if (closest < Infinity) bits.push(`closest ${fmt(closest, 0)} µm apart`);
      if (unknownPairs) bits.push(`${unknownPairs} left to the bonder, not compared`);
      add('crossz', 'Crossings between different die', 'WBX example rule', close.size ? 'fail' : unknownPairs ? 'warn' : 'ok', bits.length ? bits.join(', ') : 'none', close.size ? [...close] : [...seen],
        'Where two wires cross in plan and their die or far ends differ, this compares loop heights as drawn, less the wire sizes, with the wire to wire gap limit. A generic or undefined wire has no loop to compare.');
      out[out.length - 1].notChecked = unknownPairs;
    }
    add('gap', 'Wire to wire gap', 'WBX example rule', gapBad.size ? 'warn' : 'ok', minGap === Infinity ? 'one wire' : `smallest ${fmt(minGap, 0)} µm`, [...gapBad], many ? 'Plan view only, across every die: it ignores loop height and stack height.' : 'Plan view only: it ignores loop height.', 'gapUm', 'µm');

    bad = specified.filter(r => r.prof.clearance < L.edgeUm);
    judged('edge', 'Clearance at die edge', 'WBX example rule', bad.length ? 'fail' : 'ok', `lowest ${fmt(Math.min(...specified.map(r => r.prof.clearance)), 0)} µm`, bad.map(r => r.w), many ? 'Loop height above each die the wire crosses: at the edge of a die it bonds to, and along the whole stretch over any other. Beneath an overhang, the gap to its underside.' : 'Loop height above the die where the wire leaves it.', 'edgeUm', 'µm');
    if (many) {
      const over = rows.filter(r => r.prof.edges.some(x => x.kind !== 'edge'));
      if (over.length) add('overdie', 'Wires running over another die', 'Geometry', 'info', `${over.length} of ${rows.length}`, over.map(r => r.w), 'In plan, these pass above or below a die they do not bond to.');
    }

    /* Pad opening and pad pitch are numbers about the die, not the wire, so they run on every wired pad, as length does.
       Both are quoted for 25 µm Au; the rules per wire diameter, which need a real wire, are in ruleChecks. */
    const padMinUm = W.WBX.rules.value(S, 'padMin'), tooSmall = [];
    let smallest = Infinity;
    for (const r of rows) for (const p of r.e.toPad ? [r.e.pad, r.e.toPad] : [r.e.pad]) {
      const s = Math.min(p.w, p.h) * 1000;
      smallest = Math.min(smallest, s);
      if (s < padMinUm - 1e-6 && !tooSmall.includes(r.w)) tooSmall.push(r.w);
    }
    add('padsize', 'Die pad opening, smallest side', 'Europractice', tooSmall.length ? 'warn' : 'ok', `smallest ${fmt(smallest, 0)} µm`, tooSmall,
      `${tooSmall.length} wires on a pad under ${fmt(padMinUm, 0)} µm. Quoted for 25 µm Au ball; 33 µm wants 70 µm` + (open ? ', so for a wire left to the bonder it is only a guide' : ''), 'padMin', 'µm');

    const padPitchUm = W.WBX.rules.value(S, 'padPitch'), wiredPads = new Map(), tight = new Set();
    for (const r of rows) { wiredPads.set(padKey(r.e.die.id, r.w.pad), r.e.die); if (r.e.toDie) wiredPads.set(padKey(r.e.toDie.id, r.w.toPad), r.e.toDie); }
    let pitchMin = Infinity;
    for (const d of dies) {
      const onDie = d.die.pads.filter(p => wiredPads.has(padKey(d.id, p.num)));
      for (let i = 0; i < onDie.length; i++) {
        let near = Infinity;
        for (let j = 0; j < onDie.length; j++) if (i !== j) near = Math.min(near, Math.hypot(onDie[i].x - onDie[j].x, onDie[i].y - onDie[j].y));
        if (near < Infinity) { pitchMin = Math.min(pitchMin, near * 1000); if (near * 1000 < padPitchUm - 1e-6) tight.add(padKey(d.id, onDie[i].num)); }
      }
    }
    if (pitchMin < Infinity) add('pitch', 'Die pad pitch', 'Europractice', tight.size ? 'warn' : 'ok', `smallest ${fmt(pitchMin, 0)} µm`, rows.filter(r => wireEndKeys(S, r.w).some(k => tight.has(k))).map(r => r.w),
      `Centre to centre, between wired pads on one die. Quoted for 25 µm Au ball; 33 µm wants 80 µm.`, 'padPitch', 'µm');

    const onPad = (p, d, q) => { const [x, y] = boardToDie(d.place, q[0], q[1]); return Math.abs(x - p.x) <= p.w / 2 + 1e-6 && Math.abs(y - p.y) <= p.h / 2 + 1e-6; };
    const offPad = rows.filter(r => !onPad(r.e.pad, r.e.die, r.e.a) || (r.e.toPad && !onPad(r.e.toPad, r.e.toDie, r.e.b)));
    const offLand = rows.filter(r => r.e.land && pointToLand(r.e.b, r.e.land) > 1e-6);
    add('onpad', 'First bond on its pad, second on its land', 'SPEC.md', offPad.length + offLand.length ? 'fail' : 'ok', offPad.length + offLand.length ? `${offPad.length} off pad, ${offLand.length} off land` : 'all on target', [...offPad, ...offLand].map(r => r.w), '');

    const mism = [], cmp = [];
    for (const r of rows) { const a = endsAgree(r.e); if (a !== null) { cmp.push(r); if (!a) mism.push(r.w); } }
    add('nets', many ? 'Net at each end of a wire' : 'Pad net against land net', 'SPEC.md', !cmp.length ? 'na' : mism.length ? 'warn' : 'ok', cmp.length ? `${cmp.length - mism.length} of ${cmp.length} agree` : 'nothing to compare', mism,
      cmp.length ? '' : 'Needs names on the pads and on the lands.');

    if (L.moldUm > 0) {
      bad = specified.filter(r => r.prof.peak > L.moldUm);
      judged('mold', 'Loop top under the glob top', 'SPEC.md', bad.length ? 'fail' : 'ok', `highest ${fmt(Math.max(...specified.map(r => r.prof.peak)), 0)} µm`, bad.map(r => r.w), '', 'moldUm', 'µm');
      // The stack's own height is known whoever bonds it, so wires left to the bonder don't hold this back.
      if (many) {
        const tall = dies.reduce((m, d) => dieTop(S, d) > dieTop(S, m) ? d : m);
        add('moldstack', 'Top of the die stack under the glob top', 'Geometry', dieTop(S, tall) > L.moldUm ? 'fail' : 'ok', `${tall.id} at ${fmt(dieTop(S, tall), 0)} µm`, [], 'The highest die top, before any wire.');
      }
    }
    const onLand = rows.filter(r => r.e.land && dies.some(d => inOutline(d, r.e.b)));
    if (onLand.length) add('underdie', 'Second bond under the die', 'WBX', 'fail', `${onLand.length} wires`, onLand.map(r => r.w), 'The land is covered by the die at this placement.');
    // The same thing one level up: a wired pad with a higher die over it.
    const covers = (end, own) => dies.find(d => d !== own && dieBase(S, d) >= dieTop(S, own) - 1e-6 && inOutline(d, end)) || null;
    const buried = rows.filter(r => covers(r.e.a, r.e.die) || (r.e.toDie && covers(r.e.b, r.e.toDie)));
    if (buried.length) add('underupper', 'Bonded pad under a higher die', 'WBX', 'fail', `${buried.length} wires`, buried.map(r => r.w), 'A pad with a wire is covered by a die above it at this placement. Whether it could be bonded before that die goes on is not judged here.');
    stackChecks(S, add);

    const used = new Set();
    for (const r of rows) { used.add(padKey(r.e.die.id, r.w.pad)); if (r.e.toDie) used.add(padKey(r.e.toDie.id, r.w.toPad)); }
    const free = [], all = dies.reduce((n, d) => n + d.die.pads.length, 0);
    for (const d of dies) for (const p of d.die.pads) if (!used.has(padKey(d.id, p.num))) free.push(many ? d.id + '.' + p.num : p.num);
    add('unbonded', 'Die pads with no wire', 'Info', free.length ? 'info' : 'ok', free.length ? `${free.length} of ${all}` : 'all bonded', [], free.length ? `Pads ${free.slice(0, 16).join(', ')}${free.length > 16 ? ', …' : ''}` : '');
    const usedL = new Set(rows.map(r => r.w.land));
    const freeL = S.lands.filter(l => !usedL.has(l.id));
    add('unusedland', 'Lands with no wire', 'Info', freeL.length ? 'info' : 'ok', freeL.length ? `${freeL.length} of ${S.lands.length}` : 'all used', [], '');
    ruleChecks(S, rows, add, judged);
    W.WBX.rules.decorate(S, out);
    return { rows, list: out };
  }

  /* ---- DRC rules beyond the first checks (app/js/rules.js). Each row passes its rule id where a limit key goes, so rules.decorate
     gives it its tier and switch, and the Checks tab its input. Every placed die is walked, and a wire whose far end is another
     die's pad is checked at both pads. Anything needing a wire diameter or a loop goes through judged, so wires left to the bonder
     are counted as not checked, never passed. ---- */
  function ruleChecks(S, rows, add, judged) {
    const R = W.WBX.rules, dies = placedDies(S), many = dies.length > 1;
    if (!rows.length) return;
    const fmt = (v, d) => (+v).toFixed(d === undefined ? 0 : d);
    const val = id => R.value(S, id);
    const off = (rule, id, label) => { if (R.on(S, rule)) return false; add(id, label, '', 'off', '', [], '', rule); return true; };
    const specified = rows.filter(r => !r.prof.choice && r.prof.type.d > 0);
    const uniq = a => [...new Set(a)];
    const corners = l => { const { ux, uy, long, short } = landAxis(l), a = long / 2, b = short / 2; return [[a, b], [-a, b], [-a, -b], [a, -b]].map(([p, q]) => [l.x + ux * p - uy * q, l.y + uy * p + ux * q]); };
    const ringDist = (P, Q) => { let m = Infinity; for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) m = Math.min(m, segDist(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length])); return m; };
    const landDieDist = (l, d) => corners(l).some(q => inOutline(d, q)) || dieCorners(d).some(q => pointToLand(q, l) === 0) ? 0 : ringDist(corners(l), dieCorners(d));

    // W2: span per diameter.
    if (!off('lengthPerD', 'lengthd', 'Wire span per diameter')) {
      const k = val('lengthPerD'), bad = specified.filter(r => r.e.len * 1000 > k * r.prof.type.d);
      judged('lengthd', 'Wire span per diameter', '', bad.length ? 'warn' : 'ok', specified.length ? `longest ${fmt(Math.max(...specified.map(r => r.e.len * 1000 / r.prof.type.d)))} × d` : '', bad.map(r => r.w),
        `Straight bond to bond span over the wire's diameter. ${fmt(k)} × d is ${fmt(k * 25 / 1000, 1)} mm for 25 µm wire: the 100-D rule, about sag and sweep in molded packages.`, 'lengthPerD', '× d');
    }
    // W6: separation per diameter, between wire surfaces in plan. Crossing pairs are the crossing checks' business.
    if (!off('wireGapPerD', 'gapd', 'Wire to wire separation per diameter')) {
      const k = val('wireGapPerD'), bad = new Set();
      let worst = Infinity;
      for (let i = 0; i < specified.length; i++) for (let j = i + 1; j < specified.length; j++) {
        const a = specified[i], b = specified[j], ka = wireEndKeys(S, a.w), kb = wireEndKeys(S, b.w);
        if (ka.some(x => kb.includes(x)) || segCross(a.e.a, a.e.b, b.e.a, b.e.b)) continue;
        const dd = Math.max(a.prof.type.d, b.prof.type.d), g = segDist(a.e.a, a.e.b, b.e.a, b.e.b) * 1000 - (a.prof.type.d + b.prof.type.d) / 2;
        worst = Math.min(worst, g / dd);
        if (g < k * dd) { bad.add(a.w); bad.add(b.w); }
      }
      judged('gapd', 'Wire to wire separation per diameter', '', bad.size ? 'warn' : 'ok', worst < Infinity ? `smallest ${fmt(worst, 1)} × d` : 'no pair to compare', [...bad],
        'Gap between wire surfaces in plan, over the larger diameter. Plan view ignores loop height, so it is conservative. MIL-STD-883 asks 2 × d for class S, 1 × d for class B.', 'wireGapPerD', '× d');
    }
    // S2: die edge clearance per diameter.
    if (!off('edgeClearPerD', 'edged', 'Die edge clearance per diameter')) {
      const k = val('edgeClearPerD'), bad = specified.filter(r => r.prof.clearance < k * r.prof.type.d);
      judged('edged', 'Die edge clearance per diameter', '', bad.length ? 'warn' : 'ok', specified.length ? `lowest ${fmt(Math.min(...specified.map(r => r.prof.clearance / r.prof.type.d)), 1)} × d` : '', bad.map(r => r.w),
        'Loop height over the die edge it crosses, over the wire diameter. The standard measures past the first 5 mil (127 µm) from a ball bond; this measures at the edge.', 'edgeClearPerD', '× d');
    }
    // S3: highest loop.
    if (!off('loopMax', 'loop', 'Loop height, highest')) {
      const lim = val('loopMax'), bad = specified.filter(r => r.prof.peak > lim);
      judged('loop', 'Loop height, highest', '', bad.length ? 'warn' : 'ok', specified.length ? `highest ${fmt(Math.max(...specified.map(r => r.prof.peak)))} µm` : '', bad.map(r => r.w), 'Top of the loop above the board, as drawn from its type.', 'loopMax', 'µm');
    }
    // S5: glob top cover. Only with a glob top.
    if (!off('globCover', 'globcover', 'Glob top cover over loop')) {
      if (!R.on(S, 'globTop')) add('globcover', 'Glob top cover over loop', '', 'na', 'no glob top set', [], 'Runs when Glob top height is on in DRC rules.', 'globCover', 'µm');
      else {
        const top = val('globTop'), cover = val('globCover'), bad = specified.filter(r => r.prof.peak + cover > top);
        judged('globcover', 'Glob top cover over loop', '', bad.length ? 'warn' : 'ok', specified.length ? `least ${fmt(top - Math.max(...specified.map(r => r.prof.peak)))} µm over a loop` : '', bad.map(r => r.w),
          `Glob top height less the highest loop top. Needs ${fmt(cover)} µm under a ${fmt(top)} µm glob top.`, 'globCover', 'µm');
      }
    }
    // P3: largest pad side, every wired pad.
    if (!off('padMax', 'padmax', 'Die pad opening, largest side')) {
      const lim = val('padMax'), bad = [];
      let big = 0;
      for (const r of rows) for (const p of r.e.toPad ? [r.e.pad, r.e.toPad] : [r.e.pad]) { const s = Math.max(p.w, p.h) * 1000; big = Math.max(big, s); if (s > lim + 1e-6) bad.push(r.w); }
      add('padmax', 'Die pad opening, largest side', '', bad.length ? 'warn' : 'ok', `largest ${fmt(big)} µm`, uniq(bad), 'A big pad bonds fine. This flags a shape that may have been read as a pad by mistake.', 'padMax', 'µm');
    }
    // P2: pad opening per diameter, at both pads of a die to die wire.
    if (!off('padPerD', 'padd', 'Die pad opening per wire diameter')) {
      const k = val('padPerD'), bad = [];
      let worst = Infinity;
      for (const r of specified) for (const p of r.e.toPad ? [r.e.pad, r.e.toPad] : [r.e.pad]) { const q = Math.min(p.w, p.h) * 1000 / r.prof.type.d; worst = Math.min(worst, q); if (q < k - 1e-9) bad.push(r.w); }
      judged('padd', 'Die pad opening per wire diameter', '', bad.length ? 'warn' : 'ok', worst < Infinity ? `smallest ${fmt(worst, 1)} × d` : '', uniq(bad), `Short side of the pad over the wire diameter: ${fmt(k * 25)} µm for 25 µm wire. Europractice's table works out near 2.2 × d.`, 'padPerD', '× d');
    }
    // P5, P6, L4: bonds sharing a pad or a land. Positions nobody set are the bonder's, so those are checked for room instead.
    const ends = new Map();
    for (const r of rows) {
      const k = wireEndKeys(S, r.w), push = (key, o) => { if (!ends.has(key)) ends.set(key, []); ends.get(key).push(Object.assign({ r }, o)); };
      push(k[0], { pos: r.e.a, set: !!r.w.padOff, long: Math.max(r.e.pad.w, r.e.pad.h), land: false });
      if (r.e.land) push(k[1], { pos: r.e.b, set: !!r.w.landOff, long: landAxis(r.e.land).long, land: true });
      else push(k[1], { pos: r.e.b, set: !!r.w.toPadOff, long: Math.max(r.e.toPad.w, r.e.toPad.h), land: false });
    }
    if (!off('bondsPerPad', 'perpad', 'Bonds on one pad or land')) {
      const lim = val('bondsPerPad'), over = [...ends.values()].filter(g => g.length > lim);
      add('perpad', 'Bonds on one pad or land', '', over.length ? 'warn' : 'ok', `most ${Math.max(...[...ends.values()].map(g => g.length))} on one`, uniq(over.flatMap(g => g.map(x => x.r.w))),
        `${over.length} pads or lands over ${fmt(lim)}. Counts wire ends, so a die to die wire counts at both pads.`, 'bondsPerPad', 'bonds');
    }
    for (const [rule, id, label, onLand] of [['multiPad', 'multipad', 'Spacing of bonds on one die pad', false], ['multiLand', 'multiland', 'Spacing of bonds on one land', true]]) {
      if (off(rule, id, label)) continue;
      const s = val(rule), groups = [...ends.values()].filter(g => g.length > 1 && g[0].land === onLand), bad = [];
      let closest = Infinity, roomed = 0;
      for (const g of groups) {
        if (g.every(x => x.set)) {
          for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
            const dd = Math.hypot(g[i].pos[0] - g[j].pos[0], g[i].pos[1] - g[j].pos[1]) * 1000;
            closest = Math.min(closest, dd);
            if (dd < s - 1e-6) bad.push(g[i].r.w, g[j].r.w);
          }
        } else { roomed++; if ((g.length - 1) * s > g[0].long * 1000 + 1e-6) bad.push(...g.map(x => x.r.w)); }
      }
      const bits = [];
      if (!groups.length) bits.push(`no ${onLand ? 'land' : 'pad'} has two bonds`);
      if (closest < Infinity) bits.push(`closest ${fmt(closest)} µm apart`);
      if (roomed) bits.push(`${roomed} with positions not set, room checked`);
      add(id, label, '', bad.length ? 'warn' : 'ok', bits.join('; '), uniq(bad),
        `Centre to centre where the bond positions were set by dragging an end. Otherwise the bonder places them, and the ${onLand ? 'land' : 'pad'}'s long side must fit them at ${fmt(s)} µm.`, rule, 'µm');
    }
    // L1, L2, L3: lands with a wire.
    const landRows = rows.filter(r => r.e.land), lands = uniq(landRows.map(r => r.e.land));
    if (lands.length && !off('landMin', 'landmin', 'Land, smallest side')) {
      const lim = val('landMin'), small = new Set(lands.filter(l => Math.min(l.w, l.h) * 1000 < lim - 1e-6));
      add('landmin', 'Land, smallest side', '', small.size ? 'warn' : 'ok', `smallest ${fmt(Math.min(...lands.map(l => Math.min(l.w, l.h) * 1000)))} µm`, landRows.filter(r => small.has(r.e.land)).map(r => r.w), 'Short side of each land with a wire.', 'landMin', 'µm');
    }
    if (lands.length && !off('landPitch', 'landpitch', 'Land pitch')) {
      const lim = val('landPitch'), tight = new Set();
      let m = Infinity;
      for (const l of lands) {
        let near = Infinity;
        for (const o of S.lands) if (o !== l) near = Math.min(near, Math.hypot(o.x - l.x, o.y - l.y) * 1000);
        if (near < Infinity) { m = Math.min(m, near); if (near < lim - 1e-6) tight.add(l); }
      }
      add('landpitch', 'Land pitch', '', tight.size ? 'warn' : 'ok', m < Infinity ? `smallest ${fmt(m)} µm` : 'one land', landRows.filter(r => tight.has(r.e.land)).map(r => r.w), 'Centre to centre, from each wired land to the nearest other land.', 'landPitch', 'µm');
    }
    if (landRows.length && !off('landToDie', 'landdie', 'Die edge to land')) {
      const lim = val('landToDie'), bad = [];
      let worst = Infinity, thickRule = false;
      for (const r of landRows) {
        const need = Math.max(lim, 2 * r.e.die.place.thick), dd = landDieDist(r.e.land, r.e.die) * 1000;
        if (need > lim) thickRule = true;
        worst = Math.min(worst, dd - need);
        if (dd < need - 1e-6) bad.push(r.w);
      }
      const closest = Math.min(...landRows.map(r => landDieDist(r.e.land, r.e.die) * 1000));
      add('landdie', 'Die edge to land', '', bad.length ? 'warn' : 'ok', `closest ${fmt(closest)} µm`, bad,
        `Plan distance from the die outline to the nearest edge of each wired land, against ${fmt(lim)} µm or twice the die thickness, whichever is more` + (thickRule ? '. Twice the thickness governs here, and the thickness is assumed unless you set it' : '') + '.', 'landToDie', 'µm');
    }
    // D1, D2: several die. Silent with one.
    if (many && !off('dieToDie', 'diedie', 'Die to die, side by side')) {
      const lim = val('dieToDie'), close = [];
      let m = Infinity;
      for (let i = 0; i < dies.length; i++) for (let j = i + 1; j < dies.length; j++) {
        const a = dies[i], b = dies[j];
        if (outlinesOverlap(a, b)) continue;
        const dd = ringDist(dieCorners(a), dieCorners(b)) * 1000;
        m = Math.min(m, dd);
        if (dd < lim - 1e-6) close.push(`${a.id} and ${b.id} at ${fmt(dd)} µm`);
      }
      if (m < Infinity) add('diedie', 'Die to die, side by side', '', close.length ? 'warn' : 'ok', close.length ? close.join(', ') : `closest ${fmt(m)} µm`, [], 'Plan distance between die outlines that do not overlap.', 'dieToDie', 'µm');
    }
    if (many && !off('stackStep', 'step', 'Stacked die step to a bonded pad')) {
      const lim = val('stackStep'), bad = [];
      let m = Infinity;
      for (const r of rows) {
        const pads = [[r.e.die, r.e.pad]];
        if (r.e.toDie) pads.push([r.e.toDie, r.e.toPad]);
        for (const [x, p] of pads) {
          const q = dieToBoard(x.place, p.x, p.y);
          for (const y of dies) {
            if (y === x || dieBase(S, y) < dieTop(S, x) - 1e-6 || !outlinesOverlap(x, y) || inOutline(y, q)) continue;
            const c = dieCorners(y);
            let dd = Infinity;
            for (let i = 0; i < 4; i++) dd = Math.min(dd, segDist(q, q, c[i], c[(i + 1) % 4]) * 1000);
            m = Math.min(m, dd);
            if (dd < lim - 1e-6) bad.push(r.w);
          }
        }
      }
      if (m < Infinity) add('step', 'Stacked die step to a bonded pad', '', bad.length ? 'warn' : 'ok', `closest ${fmt(m)} µm`, uniq(bad), 'Plan distance from a bonded pad on a lower die to the edge of a die above it. A pad covered by the upper die is a separate check.', 'stackStep', 'µm');
    }
    // Rules with no data behind them yet. These never read as a pass.
    const later = R.notEnforced().filter(r => R.on(S, r.id));
    if (later.length) add('notenforced', 'Rules not enforced yet', 'DRC rules', 'na', `${later.length} rules`, [], later.map(r => `${r.key} ${r.name}: ${r.why}`).join(' '));
  }

  // Default placement: on the paddle if there is one, otherwise centred on the lands, at the rotation with the least wire.
  function autoPlace(S) {
    const die = S.die;
    if (!die) return;
    const [dcx, dcy] = dieCentre(die);
    let cx, cy, from;
    const me = activeDie(S), sup = dieSupport(S, me), firstDie = placedDies(S)[0] === me;
    const before = firstDie ? [] : S.dies.filter(d => d.die && d !== me && d.die.placed);
    if (sup) { [cx, cy] = dieToBoard(sup.place, ...dieCentre(sup.die)); from = sup.id; }
    else if (before.length) {
      // A die that isn't the first goes beside the others, clear of them.
      const X = [], Y = [];
      for (const d of before) for (const q of dieCorners(d)) { X.push(q[0]); Y.push(q[1]); }
      cx = Math.max(...X) + Math.max(die.x1 - die.x0, die.y1 - die.y0) / 2 + 0.5; cy = (Math.min(...Y) + Math.max(...Y)) / 2; from = 'the space beside ' + before.map(d => d.id).join(', ');
    }
    else if (S.existingDie) { cx = S.existingDie.x; cy = S.existingDie.y; from = 'the die already in the board'; }
    else if (S.paddle) { cx = S.paddle.x; cy = S.paddle.y; from = 'the paddle'; }
    else if (S.lands.length) {
      const X = S.lands.map(l => l.x), Y = S.lands.map(l => l.y);
      cx = (Math.min(...X) + Math.max(...X)) / 2; cy = (Math.min(...Y) + Math.max(...Y)) / 2; from = 'the middle of the lands';
    } else { cx = 0; cy = 0; from = 'the origin'; }
    const trial = (deg) => {
      const place = Object.assign({}, S.place, { rot: deg });
      const [ox, oy] = rot(dcx, dcy, deg);
      place.x = cx - ox; place.y = cy - oy;
      let tot = 0, n = 0;
      const byOrd = new Map(S.lands.filter(l => l.ord !== null).map(l => [l.ord, l]));
      die.pads.forEach((p, i) => {
        const v = parseInt(p.num, 10), l = byOrd.get((isNaN(v) ? i + 1 : v) + (S.numberOffset || 0));
        if (!l) return;
        const a = dieToBoard(place, p.x, p.y), b = landBond(l, place, die, S.bond);
        tot += Math.hypot(a[0] - b[0], a[1] - b[1]); n++;
      });
      return { place, tot, n };
    };
    const T = [0, 90, 180, 270].map(trial);
    let best = T[0];
    if (T.some(t => t.n)) for (const t of T) if (t.tot < best.tot) best = t;
    if (firstDie && !sup && S.existingDie && S.existingDie.rot != null) best = trial(S.existingDie.rot);
    S.place = best.place;
    S.placeNote = { from, lengths: T.map((t, i) => ({ rot: i * 90, mm: t.tot })) };
  }

  W.WBX.model = { UNDEFINED, UNDEFINED_LABEL, GENERIC, GENERIC_LABEL, CHOICE_TUBE_UM, RESERVED_NAME, isBonderChoice, isBonderChoiceWire, isGenericType, isUndefinedType, isUndefinedWire, typeLabel, ensureUndefinedType, choicePath, choiceCurve, parseMoves, loopPts, loopCurve, zAt, DEFAULT_TYPES, FAMILIES, DEFAULT_LIMITS, REGIMES, dieToBoard, boardToDie, dieCentre, landAxis, landBond, wireEnds, wireProfile, padAngle, typeFor, typeOf, netsAgree, endsAgree, normNet, measure, check, autoPlace, pointToLand,
    placedDies, dieById, activeDie, wireDieId, isDieToDie, padKey, wireEndKeys, wireTouchesDie, wiresOnPad, dieSupport, dieBottom, dieTop, dieBase, stackedOn, stackOrder, dieCorners, inOutline, outlinesOverlap, clipToDie, farNet, wireLabels, mkDieWire };
})(window);
