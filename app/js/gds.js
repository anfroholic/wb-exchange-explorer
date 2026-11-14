/* GDSII reader for the browser: parse, flatten by layer, find bond pads, read labels, render artwork.
   Geometry stays in the file's ArrayBuffer; cells keep offsets into it, so a 100 MB chip stays cheap. */
(function (W) {
  'use strict';

  const R = { HEADER: 0x00, BGNLIB: 0x01, LIBNAME: 0x02, UNITS: 0x03, ENDLIB: 0x04, BGNSTR: 0x05, STRNAME: 0x06, ENDSTR: 0x07,
    BOUNDARY: 0x08, PATH: 0x09, SREF: 0x0a, AREF: 0x0b, TEXT: 0x0c, LAYER: 0x0d, DATATYPE: 0x0e, WIDTH: 0x0f, XY: 0x10, ENDEL: 0x11,
    SNAME: 0x12, COLROW: 0x13, NODE: 0x15, TEXTTYPE: 0x16, STRING: 0x19, STRANS: 0x1a, MAG: 0x1b, ANGLE: 0x1c, BOX: 0x2d, BOXTYPE: 0x2e };

  const PAD_MIN_SCAN_UM = 10, PAD_MAX_SCAN_UM = 1000;
  const pause = () => new Promise(r => setTimeout(r, 0));

  function real8(dv, o) {
    const b0 = dv.getUint8(o), sign = b0 & 0x80 ? -1 : 1, exp = (b0 & 0x7f) - 64;
    let m = 0;
    for (let i = 1; i < 8; i++) m = m * 256 + dv.getUint8(o + i);
    return m === 0 ? 0 : sign * m * Math.pow(16, exp - 14);
  }
  function ascii(dv, o, n) {
    let s = '';
    for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (c) s += String.fromCharCode(c); }
    return s;
  }
  function refMatrix(x, y, mag, angle, reflect) {
    const a = angle % 360;
    // exact cosines at right angles, so rectangles stay rectangles through deep hierarchy
    const c = a === 0 ? 1 : a === 90 || a === 270 || a === -90 || a === -270 ? 0 : a === 180 || a === -180 ? -1 : Math.cos(a * Math.PI / 180);
    const s = a === 0 || a === 180 || a === -180 ? 0 : a === 90 || a === -270 ? 1 : a === 270 || a === -90 ? -1 : Math.sin(a * Math.PI / 180);
    const f = reflect ? -1 : 1;
    return [c * mag, s * mag, -s * mag * f, c * mag * f, x, y];
  }
  function compose(A, B) {
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  }
  function boxThrough(m, x0, y0, x1, y1) {
    const X = [m[0] * x0 + m[2] * y0 + m[4], m[0] * x1 + m[2] * y0 + m[4], m[0] * x0 + m[2] * y1 + m[4], m[0] * x1 + m[2] * y1 + m[4]];
    const Y = [m[1] * x0 + m[3] * y0 + m[5], m[1] * x1 + m[3] * y0 + m[5], m[1] * x0 + m[3] * y1 + m[5], m[1] * x1 + m[3] * y1 + m[5]];
    return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)];
  }

  async function parse(buffer, onProgress) {
    const dv = new DataView(buffer), end = buffer.byteLength;
    if (end < 4 || dv.getUint8(2) !== R.HEADER) throw new Error('This is not a GDSII file: it has no HEADER record at the start.');
    const lib = { buf: buffer, dv, name: '', umPerDbu: 0.001, cells: new Map(), list: [], layers: [], layerIdx: new Map() };
    const layerOf = (l, d) => {
      const k = l + '/' + d;
      let i = lib.layerIdx.get(k);
      if (i === undefined) { i = lib.layers.length; lib.layers.push({ key: k, layer: l, dt: d, idx: i }); lib.layerIdx.set(k, i); }
      return i;
    };
    let cell = null, el = 0, layer = 0, dt = 0, width = 0, xyOff = 0, xyN = 0, sname = '', reflect = false, mag = 1, angle = 0, cols = 0, rows = 0, str = '';
    let p = 0, t = performance.now();
    const slot = li => { let s = cell.bins.get(li); if (!s) { s = { polys: [], paths: [], texts: [] }; cell.bins.set(li, s); } return s; };
    const addShape = () => {
      if (!xyN) return;
      const li = layerOf(layer, dt), s = slot(li);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0, o = xyOff; i < xyN; i++, o += 8) {
        const x = dv.getInt32(o), y = dv.getInt32(o + 4);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (el === R.PATH) {
        s.paths.push(xyOff, xyN, width);
        const hw = Math.abs(width) / 2;
        x0 -= hw; y0 -= hw; x1 += hw; y1 += hw;
      } else {
        s.polys.push(xyOff, xyN);
        const wu = (x1 - x0) * lib.umPerDbu, hu = (y1 - y0) * lib.umPerDbu;
        if (xyN <= 17 && wu >= PAD_MIN_SCAN_UM && hu >= PAD_MIN_SCAN_UM && wu <= PAD_MAX_SCAN_UM && hu <= PAD_MAX_SCAN_UM) cell.padBins.add(li);
      }
      if (x0 < cell.x0) cell.x0 = x0; if (y0 < cell.y0) cell.y0 = y0; if (x1 > cell.x1) cell.x1 = x1; if (y1 > cell.y1) cell.y1 = y1;
    };
    while (p + 4 <= end) {
      const len = dv.getUint16(p), type = dv.getUint8(p + 2);
      if (len < 4) break;                 // null padding after ENDLIB
      const o = p + 4, n = len - 4;
      switch (type) {
        case R.LIBNAME: lib.name = ascii(dv, o, n); break;
        case R.UNITS: lib.umPerDbu = real8(dv, o + 8) * 1e6; break;
        case R.BGNSTR: cell = { name: '', refs: [], bins: new Map(), padBins: new Set(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, referenced: false }; break;
        case R.STRNAME: cell.name = ascii(dv, o, n); lib.cells.set(cell.name, cell); lib.list.push(cell); break;
        case R.ENDSTR: cell = null; break;
        case R.BOUNDARY: case R.PATH: case R.SREF: case R.AREF: case R.TEXT: case R.BOX:
          el = type; layer = dt = width = xyN = xyOff = 0; sname = ''; reflect = false; mag = 1; angle = 0; cols = rows = 0; str = ''; break;
        case R.NODE: el = R.NODE; break;
        case R.LAYER: layer = dv.getInt16(o); break;
        case R.DATATYPE: case R.TEXTTYPE: case R.BOXTYPE: dt = dv.getInt16(o); break;
        case R.WIDTH: width = dv.getInt32(o); break;
        case R.SNAME: sname = ascii(dv, o, n); break;
        case R.COLROW: cols = dv.getInt16(o); rows = dv.getInt16(o + 2); break;
        case R.STRANS: reflect = !!(dv.getUint8(o) & 0x80); break;
        case R.MAG: mag = real8(dv, o); break;
        case R.ANGLE: angle = real8(dv, o); break;
        case R.STRING: str = ascii(dv, o, n); break;
        case R.XY:
          // A polygon over the 8191-point record limit continues in another XY record; each part is kept as its own shape.
          if (xyN && (el === R.BOUNDARY || el === R.PATH || el === R.BOX)) addShape();
          xyOff = o; xyN = n >> 3; break;
        case R.ENDEL:
          if (!cell) break;
          if (el === R.BOUNDARY || el === R.PATH || el === R.BOX) addShape();
          else if (el === R.TEXT && xyN) slot(layerOf(layer, dt)).texts.push({ s: str, x: dv.getInt32(xyOff), y: dv.getInt32(xyOff + 4) });
          else if (el === R.SREF && xyN) cell.refs.push({ name: sname, m: refMatrix(dv.getInt32(xyOff), dv.getInt32(xyOff + 4), mag, angle, reflect), cols: 0 });
          else if (el === R.AREF && xyN >= 3) {
            const x = dv.getInt32(xyOff), y = dv.getInt32(xyOff + 4);
            cell.refs.push({ name: sname, m: refMatrix(x, y, mag, angle, reflect), cols, rows,
              ax: (dv.getInt32(xyOff + 8) - x) / (cols || 1), ay: (dv.getInt32(xyOff + 12) - y) / (cols || 1),
              bx: (dv.getInt32(xyOff + 16) - x) / (rows || 1), by: (dv.getInt32(xyOff + 20) - y) / (rows || 1) });
          }
          el = 0; break;
        case R.ENDLIB: p = end; continue;
      }
      p += len;
      if ((p & 0xfff) < len && performance.now() - t > 60) {
        if (onProgress) onProgress(p / end);
        await pause();
        t = performance.now();
      }
    }
    finish(lib);
    return lib;
  }

  // Resolve references and compute, per cell: bounding box, which layers its subtree holds, and flattened shape counts.
  function finish(lib) {
    const N = lib.layers.length;
    for (const c of lib.list) {
      for (const r of c.refs) { r.cell = lib.cells.get(r.name) || null; if (r.cell) r.cell.referenced = true; }
      c.refs = c.refs.filter(r => r.cell);
    }
    const FLAG_SHAPE = 1, FLAG_TEXT = 2, FLAG_PAD = 4;
    const visit = (c, depth) => {
      if (c.sub) return;
      if (depth > 64) throw new Error('GDS hierarchy is deeper than 64 levels, or it references itself.');
      c.sub = new Uint8Array(N);
      c.count = new Float64Array(N);
      for (const [li, s] of c.bins) {
        if (s.polys.length || s.paths.length) c.sub[li] |= FLAG_SHAPE;
        if (s.texts.length) c.sub[li] |= FLAG_TEXT;
        c.count[li] += s.polys.length / 2 + s.paths.length / 3;
      }
      for (const li of c.padBins) c.sub[li] |= FLAG_PAD;
      for (const r of c.refs) {
        visit(r.cell, depth + 1);
        const k = r.cols ? r.cols * r.rows : 1;
        for (let i = 0; i < N; i++) { c.sub[i] |= r.cell.sub[i]; c.count[i] += r.cell.count[i] * k; }
        if (r.cell.x0 === Infinity) continue;
        const b = boxThrough(r.m, r.cell.x0, r.cell.y0, r.cell.x1, r.cell.y1);
        const dx = r.cols ? [0, (r.cols - 1) * r.ax, (r.rows - 1) * r.bx, (r.cols - 1) * r.ax + (r.rows - 1) * r.bx] : [0];
        const dy = r.cols ? [0, (r.cols - 1) * r.ay, (r.rows - 1) * r.by, (r.cols - 1) * r.ay + (r.rows - 1) * r.by] : [0];
        c.x0 = Math.min(c.x0, b[0] + Math.min(...dx)); c.x1 = Math.max(c.x1, b[2] + Math.max(...dx));
        c.y0 = Math.min(c.y0, b[1] + Math.min(...dy)); c.y1 = Math.max(c.y1, b[3] + Math.max(...dy));
      }
    };
    for (const c of lib.list) visit(c, 0);
    lib.FLAG = { SHAPE: FLAG_SHAPE, TEXT: FLAG_TEXT, PAD: FLAG_PAD };
    lib.tops = lib.list.filter(c => !c.referenced && c.x0 !== Infinity).sort((a, b) => area(b) - area(a));
    if (!lib.tops.length) throw new Error('The GDS has no top cell holding geometry.');
    // cell choice: top cells first, then the biggest others, so a die can be picked out of a reticle
    const rest = lib.list.filter(c => c.referenced && c.x0 !== Infinity).sort((a, b) => area(b) - area(a)).slice(0, 40);
    lib.choices = lib.tops.concat(rest);
  }
  const area = c => (c.x1 - c.x0) * (c.y1 - c.y0);

  /* Depth-first over instances with an explicit stack, so it can give the page time to breathe. enter(cell, m) returns
     false to skip a subtree. Returns false if cancelled. */
  async function walk(top, m0, enter, ctl) {
    if (!enter(top, m0)) return true;
    const st = [{ cell: top, m: m0, r: 0, i: 0, j: 0 }];
    let ops = 0, t = performance.now();
    while (st.length) {
      const f = st[st.length - 1], refs = f.cell.refs;
      if (f.r >= refs.length) { st.pop(); continue; }
      const R0 = refs[f.r];
      let mm;
      if (R0.cols) {
        const M = R0.m.slice();
        M[4] += f.i * R0.ax + f.j * R0.bx;
        M[5] += f.i * R0.ay + f.j * R0.by;
        mm = compose(f.m, M);
        if (++f.i >= R0.cols) { f.i = 0; if (++f.j >= R0.rows) { f.j = 0; f.r++; } }
      } else { mm = compose(f.m, R0.m); f.r++; }
      if (enter(R0.cell, mm) && R0.cell.refs.length && st.length < 64) st.push({ cell: R0.cell, m: mm, r: 0, i: 0, j: 0 });
      if ((++ops & 0x3ff) === 0 && performance.now() - t > 40) {
        if (ctl && ctl.onTick) ctl.onTick();
        await pause();
        t = performance.now();
        if (ctl && ctl.cancelled) return false;
      }
    }
    return true;
  }
  const IDENT = [1, 0, 0, 1, 0, 0];

  // Flattened bounding boxes of pad-sized shapes on one layer, in dbu.
  async function padBoxes(lib, top, li, ctl) {
    const out = [], seen = new Set(), um = lib.umPerDbu, dv = lib.dv;
    const lo = PAD_MIN_SCAN_UM / um, hi = PAD_MAX_SCAN_UM / um;
    await walk(top, IDENT, (cell, m) => {
      if (!(cell.sub[li] & lib.FLAG.PAD) || out.length > 20000) return false;
      if (!cell.padBins.has(li)) return true;
      const polys = cell.bins.get(li).polys;
      for (let k = 0; k < polys.length; k += 2) {
        const off = polys[k], n = polys[k + 1];
        if (n > 17) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0, o = off; i < n; i++, o += 8) {
          const x = dv.getInt32(o), y = dv.getInt32(o + 4);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 - x0 < lo || y1 - y0 < lo || x1 - x0 > hi || y1 - y0 > hi) continue;
        const b = boxThrough(m, x0, y0, x1, y1);
        const key = b.map(v => Math.round(v)).join(',');
        if (!seen.has(key)) { seen.add(key); out.push(b); }
      }
      return true;
    }, ctl);
    return out;
  }

  const sideOf = (b, box) => {
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const d = { B: cy - box.y0, R: box.x1 - cx, T: box.y1 - cy, L: cx - box.x0 };
    let k = 'B';
    for (const s of 'RTL') if (d[s] < d[k]) k = s;
    return [k, d[k]];
  };
  const peripheral = (b, box, um) => sideOf(b, box)[1] <= 2 * Math.max(b[2] - b[0], b[3] - b[1]);

  /* Rank layers by how regular their edge boxes are. Real bond pads are nearly all one size, while top metal around the
     edge mixes pads with power straps. Ties go to the smaller box, because a passivation opening is what a bond lands on
     and the metal under it is bigger. */
  async function padCandidates(lib, top, opts, ctl) {
    const um = lib.umPerDbu, box = { x0: top.x0, y0: top.y0, x1: top.x1, y1: top.y1 }, out = [];
    for (const L of lib.layers) {
      if (!(top.sub[L.idx] & lib.FLAG.PAD)) continue;
      const all = await padBoxes(lib, top, L.idx, ctl);
      const sized = all.filter(b => { const w = (b[2] - b[0]) * um, h = (b[3] - b[1]) * um; return w >= opts.minUm && h >= opts.minUm && w <= opts.maxUm && h <= opts.maxUm; });
      const edge = sized.filter(b => peripheral(b, box, um));
      if (!edge.length) continue;
      const tally = new Map();
      for (const b of edge) {
        const a = Math.round((b[2] - b[0]) * um), c = Math.round((b[3] - b[1]) * um), k = Math.min(a, c) + '×' + Math.max(a, c);
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      let modal = 0, size = '';
      for (const [k, v] of tally) if (v > modal) { modal = v; size = k; }
      const mean = edge.reduce((a, b) => a + (b[2] - b[0]) * um, 0) / edge.length;
      out.push({ key: L.key, idx: L.idx, dt: L.dt, boxes: all, count: edge.length, mean, size, modal, score: modal * modal / edge.length });
    }
    // a drawing layer beats a pin or label datatype holding the same boxes
    out.sort((a, b) => b.score - a.score || a.mean - b.mean || (a.dt ? 1 : 0) - (b.dt ? 1 : 0));
    return out;
  }

  // Corner of a marker cell (QR by default), searching three levels down.
  function findMark(lib, top, re) {
    let hit = null;
    const go = (cell, m, d) => {
      for (const r of cell.refs) {
        if (hit) return;
        const mm = compose(m, r.m);
        if (re.test(r.cell.name)) { hit = { name: r.cell.name, box: boxThrough(mm, r.cell.x0, r.cell.y0, r.cell.x1, r.cell.y1) }; return; }
        if (d && r.cell.refs.length && r.cell.refs.length < 4000 && !/^VIA|fd_/.test(r.cell.name)) go(r.cell, mm, d - 1);
      }
    };
    go(top, IDENT, 3);
    if (!hit) return null;
    const cx = (hit.box[0] + hit.box[2]) / 2, cy = (hit.box[1] + hit.box[3]) / 2;
    hit.corner = (cy < (top.y0 + top.y1) / 2 ? 'B' : 'T') + (cx < (top.x0 + top.x1) / 2 ? 'L' : 'R');
    return hit;
  }

  const GENERIC = new Set(['PAD', 'pad', 'Pad', 'BOND', 'bond']);
  async function labelsOnPads(lib, top, boxes, ctl) {
    const hits = boxes.map(() => new Map());   // per pad: label -> layer key
    const layers = new Map();
    const box = top, margin = Math.max(...boxes.map(b => Math.max(b[2] - b[0], b[3] - b[1])), 0) * 3;
    for (const L of lib.layers) {
      if (!(top.sub[L.idx] & lib.FLAG.TEXT)) continue;
      let onPads = 0;
      await walk(top, IDENT, (cell, m) => {
        if (!(cell.sub[L.idx] & lib.FLAG.TEXT)) return false;
        const s = cell.bins.get(L.idx);
        if (!s || !s.texts.length) return true;
        for (const t of s.texts) {
          const x = m[0] * t.x + m[2] * t.y + m[4], y = m[1] * t.x + m[3] * t.y + m[5];
          if (x > box.x0 + margin && x < box.x1 - margin && y > box.y0 + margin && y < box.y1 - margin) continue;
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) { hits[i].set(t.s, L.key); onPads++; break; }
          }
        }
        return true;
      }, ctl);
      if (onPads) layers.set(L.key, onPads);
    }
    return { hits, layers };
  }
  function bestLabel(map, only) {
    const names = [...map.keys()].filter(s => !GENERIC.has(s) && (!only || map.get(s) === only));
    if (!names.length) return null;
    names.sort((a, b) => (a.includes('[') ? 0 : 1) - (b.includes('[') ? 0 : 1) || b.length - a.length);
    return names[0];
  }

  /* Pad numbering: start at pin 1 and walk the ring. Order is counter-clockwise from the bottom-left of the bottom edge,
     then rotated and possibly reversed. An explicit first pad overrides the corner. */
  function ringOrder(items, corner, dir, firstKey) {
    const groups = { B: [], R: [], T: [], L: [] };
    for (const q of items) groups[q.side].push(q);
    groups.B.sort((a, b) => a.cx - b.cx); groups.R.sort((a, b) => a.cy - b.cy);
    groups.T.sort((a, b) => b.cx - a.cx); groups.L.sort((a, b) => b.cy - a.cy);
    const ccw = [...groups.B, ...groups.R, ...groups.T, ...groups.L];
    if (!ccw.length) return ccw;
    const list = dir === 'cw' ? ccw.slice().reverse() : ccw;
    let start = 0;
    if (firstKey != null) {
      const i = list.findIndex(q => q.key === firstKey);
      if (i >= 0) start = i;
    } else {
      const seq = dir === 'cw' ? { BL: 'L', TL: 'T', TR: 'R', BR: 'B' } : { BL: 'B', BR: 'R', TR: 'T', TL: 'L' };
      // the side leaving this corner in walking direction, falling back to the next populated side
      const order = dir === 'cw' ? ['L', 'T', 'R', 'B'] : ['B', 'R', 'T', 'L'];
      const first = seq[corner] || order[0];
      for (let k = 0; k < 4; k++) {
        const side = order[(order.indexOf(first) + k) % 4];
        const i = list.findIndex(q => q.side === side);
        if (i >= 0) { start = i; break; }
      }
    }
    return list.slice(start).concat(list.slice(0, start));
  }

  /* The die model every other part of the app uses: outline and pads in millimetres, y down, origin at the die centre,
     exactly as a KiCad footprint would hold them. */
  async function buildDie(lib, top, opts, ctl) {
    const um = lib.umPerDbu;
    const box = { x0: top.x0, y0: top.y0, x1: top.x1, y1: top.y1 };
    const W = (box.x1 - box.x0) * um / 1000, H = (box.y1 - box.y0) * um / 1000;
    const cands = opts.candidates || await padCandidates(lib, top, opts, ctl);
    const chosen = cands.find(c => c.key === opts.padLayer) || cands[0];
    const mark = opts.markRe ? findMark(lib, top, opts.markRe) : null;
    const notes = [];
    let boxes = chosen ? chosen.boxes : [];
    const dropped = { size: 0, internal: 0 };
    boxes = boxes.filter(b => {
      const w = (b[2] - b[0]) * um, h = (b[3] - b[1]) * um;
      const ok = w >= opts.minUm && h >= opts.minUm && w <= opts.maxUm && h <= opts.maxUm;
      if (!ok) dropped.size++;
      return ok;
    });
    if (opts.peripheralOnly) {
      const n0 = boxes.length;
      boxes = boxes.filter(b => peripheral(b, box, um));
      dropped.internal = n0 - boxes.length;
    }
    const { hits, layers: labelLayers } = await labelsOnPads(lib, top, boxes, ctl);
    const items = boxes.map((b, i) => {
      const [side] = sideOf(b, box);
      const key = [b[0], b[1]].map(v => Math.round(v)).join(',');
      const raw = bestLabel(hits[i], opts.labelLayer && opts.labelLayer !== 'auto' ? opts.labelLayer : null);
      const m = raw && raw.match(/^(\d+):(.+)$/);
      return { key, side, b, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, net: m ? m[2] : raw, labelNum: m ? +m[1] : null };
    }).filter(q => !(opts.removed || []).includes(q.key));

    const withNum = items.length && items.every(q => q.labelNum != null) && new Set(items.map(q => q.labelNum)).size === items.length;
    let corner = opts.corner, cornerSource;
    if (corner === 'labels') { corner = 'BL'; cornerSource = 'labels'; }
    else if (corner === 'auto') {
      if (withNum) cornerSource = 'labels';
      else if (mark) { corner = mark.corner; cornerSource = 'mark'; }
      else { corner = 'BL'; cornerSource = 'assumed'; }
    } else cornerSource = 'set';
    let ordered;
    if (cornerSource === 'labels' && withNum) ordered = items.slice().sort((a, b) => a.labelNum - b.labelNum);
    else ordered = ringOrder(items, corner, opts.dir, opts.firstKey);
    const pads = ordered.map((q, i) => ({
      num: cornerSource === 'labels' && withNum ? String(q.labelNum) : String(i + 1), key: q.key, side: q.side,
      x: ((q.b[0] + q.b[2]) / 2 - box.x0) * um / 1000 - W / 2,
      y: -(((q.b[1] + q.b[3]) / 2 - box.y0) * um / 1000 - H / 2),
      w: (q.b[2] - q.b[0]) * um / 1000, h: (q.b[3] - q.b[1]) * um / 1000, net: q.net || null,
    }));
    if (!chosen) notes.push('No layer holds pad-sized shapes around the die edge. Check the size limits.');
    const counts = { B: 0, R: 0, T: 0, L: 0 };
    pads.forEach(p => counts[p.side]++);
    return {
      source: 'gds', name: top.name, x0: -W / 2, y0: -H / 2, x1: W / 2, y1: H / 2, pads, gfx: [],
      info: { cell: top.name, padLayer: chosen ? chosen.key : null, candidates: cands.map(c => ({ key: c.key, count: c.count, mean: c.mean, size: c.size, modal: c.modal })),
        corner, cornerSource, dir: opts.dir, mark: mark ? { name: mark.name, corner: mark.corner } : null, netsFound: pads.filter(p => p.net).length,
        labelLayers: [...labelLayers.entries()].map(([k, n]) => ({ key: k, n })), dropped, counts, umPerDbu: um, notes },
      candidatesRaw: cands,
    };
  }

  /* ---- artwork ---- */
  const KNOWN = { '34/0': '#4f9fd8', '36/0': '#768ae5', '42/0': '#a184e6', '46/0': '#c76fb6', '81/0': '#4fb79d', '53/0': '#b7d36a', '37/0': '#e0ae4a', '35/0': '#5d7fa0', '38/0': '#6f6fb5', '40/0': '#8a6fc0', '41/0': '#8a6fc0', '18/0': '#a0a05a', '30/0': '#d06a5a', '33/0': '#607a8a' };
  function layerColour(key, i) {
    if (KNOWN[key]) return KNOWN[key];
    return 'hsl(' + ((i * 47) % 360) + ' 55% 62%)';
  }
  /* Which layers to paint first. Metals show a die best, and bottom-of-stack layers mostly hide under them. GF180 layers
     are named directly; anything else gets its layers with the most drawn shapes, up to a budget. */
  function defaultLayers(lib, top) {
    const present = lib.layers.filter(L => top.count[L.idx] > 0);
    const gf = ['34/0', '36/0', '42/0', '46/0', '81/0', '53/0', '37/0'].filter(k => present.some(L => L.key === k));
    let on;
    if (gf.length >= 4) on = new Set(gf);
    else {
      const small = present.filter(L => top.count[L.idx] < 3e6).sort((a, b) => b.layer - a.layer).slice(0, 8);
      on = new Set(small.map(L => L.key));
    }
    return present.map((L, i) => ({ key: L.key, idx: L.idx, count: top.count[L.idx], colour: layerColour(L.key, i), on: on.has(L.key) }))
      .sort((a, b) => a.idx === b.idx ? 0 : lib.layers[a.idx].layer - lib.layers[b.idx].layer || lib.layers[a.idx].dt - lib.layers[b.idx].dt);
  }

  /* Rasterise straight into one byte mask per layer, then blend the masks. Going through canvas paths took minutes on a
     real chip: most shapes are small rectangles, and writing them to a typed array is a hundred times cheaper. */
  function binGeometry(lib, bin) {
    if (bin.rects) return;
    const dv = lib.dv, polys = bin.polys, rects = [], others = [];
    for (let k = 0; k < polys.length; k += 2) {
      const o = polys[k]; let n = polys[k + 1];
      if (n > 1 && dv.getInt32(o) === dv.getInt32(o + (n - 1) * 8) && dv.getInt32(o + 4) === dv.getInt32(o + (n - 1) * 8 + 4)) n--;
      if (n < 3) continue;
      let isRect = false;
      if (n === 4) {
        const x0 = dv.getInt32(o), y0 = dv.getInt32(o + 4), x1 = dv.getInt32(o + 8), y1 = dv.getInt32(o + 12), x2 = dv.getInt32(o + 16), y2 = dv.getInt32(o + 20), x3 = dv.getInt32(o + 24), y3 = dv.getInt32(o + 28);
        if ((x0 === x1 && y1 === y2 && x2 === x3 && y3 === y0) || (y0 === y1 && x1 === x2 && y2 === y3 && x3 === x0)) {
          isRect = true;
          rects.push(Math.min(x0, x2), Math.min(y0, y2), Math.max(x0, x2), Math.max(y0, y2));
        }
      }
      if (!isRect) {
        const P = new Int32Array(n * 2);
        for (let i = 0; i < n * 2; i++) P[i] = dv.getInt32(o + i * 4);
        others.push(P);
      }
    }
    const paths = bin.paths;
    for (let k = 0; k < paths.length; k += 3) {
      const n = paths[k + 1], hw = Math.abs(paths[k + 2]) / 2;
      let o = paths[k], x0 = dv.getInt32(o), y0 = dv.getInt32(o + 4);
      for (let i = 1; i < n; i++) {
        o += 8;
        const x1 = dv.getInt32(o), y1 = dv.getInt32(o + 4);
        if (x0 === x1) rects.push(x0 - hw, Math.min(y0, y1), x0 + hw, Math.max(y0, y1));
        else if (y0 === y1) rects.push(Math.min(x0, x1), y0 - hw, Math.max(x0, x1), y0 + hw);
        else {
          const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l * hw, ny = dx / l * hw;
          others.push(new Int32Array([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]));
        }
        x0 = x1; y0 = y1;
      }
    }
    bin.rects = new Int32Array(rects);
    bin.others = others;
  }
  function fillPoly(mask, pw, ph, P, a, b, c, d, e, f) {
    const n = P.length / 2, X = new Float64Array(n), Y = new Float64Array(n);
    let miny = Infinity, maxy = -Infinity, minx = Infinity, maxx = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[2 * i], y = P[2 * i + 1], px = a * x + c * y + e, py = b * x + d * y + f;
      X[i] = px; Y[i] = py;
      if (py < miny) miny = py; if (py > maxy) maxy = py; if (px < minx) minx = px; if (px > maxx) maxx = px;
    }
    if (maxx - minx < 0.3 && maxy - miny < 0.3) return;
    const r0 = Math.max(0, Math.floor(miny)), r1 = Math.min(ph - 1, Math.ceil(maxy));
    if (maxy - miny < 1.5 || maxx - minx < 1.5) {
      // too small to scan: its bounding box is the right pixels at this scale
      const c0 = Math.max(0, Math.floor(minx)), c1 = Math.min(pw, Math.ceil(maxx));
      for (let r = r0; r < Math.min(ph, Math.ceil(maxy)); r++) mask.fill(1, r * pw + c0, r * pw + c1);
      return;
    }
    const xs = [];
    for (let r = r0; r <= r1; r++) {
      const yc = r + 0.5;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const y0 = Y[i], y1 = Y[j];
        if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) xs.push(X[i] + (yc - y0) / (y1 - y0) * (X[j] - X[i]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.round(xs[k])), c1 = Math.min(pw, Math.max(Math.round(xs[k + 1]), Math.round(xs[k]) + 1));
        if (c1 > c0) mask.fill(1, r * pw + c0, r * pw + c1);
      }
    }
  }
  const parseColour = (() => {
    let t = null;
    return c => {
      if (!t) t = document.createElement('canvas').getContext('2d');
      t.fillStyle = c;
      const v = t.fillStyle;
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    };
  })();
  async function render(lib, top, layers, maxPx, ctl) {
    const bw = top.x1 - top.x0, bh = top.y1 - top.y0, s = maxPx / Math.max(bw, bh);
    const pw = Math.max(1, Math.round(bw * s)), ph = Math.max(1, Math.round(bh * s));
    const out = document.createElement('canvas'); out.width = pw; out.height = ph;
    const octx = out.getContext('2d');
    const image = octx.createImageData(pw, ph), rgba = image.data;
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 0x16; rgba[i + 1] = 0x21; rgba[i + 2] = 0x1f; rgba[i + 3] = 255; }
    const mask = new Uint8Array(pw * ph), on = layers.filter(l => l.on), FLAG = lib.FLAG.SHAPE;
    let done = 0;
    for (const L of on) {
      if (ctl && ctl.cancelled) return null;
      mask.fill(0);
      const li = L.idx;
      const ok = await walk(top, [s, 0, 0, -s, -top.x0 * s, top.y1 * s], (cell, m) => {
        if (!(cell.sub[li] & FLAG)) return false;
        const bb = boxThrough(m, cell.x0, cell.y0, cell.x1, cell.y1);
        if ((bb[2] - bb[0] < 0.5 && bb[3] - bb[1] < 0.5) || bb[2] < 0 || bb[3] < 0 || bb[0] > pw || bb[1] > ph) return false;
        const bin = cell.bins.get(li);
        if (!bin) return true;
        if (!bin.rects) binGeometry(lib, bin);
        const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], R = bin.rects;
        const straight = (b === 0 && c === 0) || (a === 0 && d === 0);
        for (let k = 0; k < R.length; k += 4) {
          const x0 = R[k], y0 = R[k + 1], x1 = R[k + 2], y1 = R[k + 3];
          let u0, v0, u1, v1;
          if (straight) {
            const p0 = a * x0 + c * y0 + e, q0 = b * x0 + d * y0 + f, p1 = a * x1 + c * y1 + e, q1 = b * x1 + d * y1 + f;
            if (p0 < p1) { u0 = p0; u1 = p1; } else { u0 = p1; u1 = p0; }
            if (q0 < q1) { v0 = q0; v1 = q1; } else { v0 = q1; v1 = q0; }
          } else { const B = boxThrough(m, x0, y0, x1, y1); u0 = B[0]; v0 = B[1]; u1 = B[2]; v1 = B[3]; }
          if (u1 - u0 < 0.3 && v1 - v0 < 0.3) continue;
          let c0 = Math.round(u0), c1 = Math.round(u1), r0 = Math.round(v0), r1 = Math.round(v1);
          if (c1 === c0) c1++;
          if (r1 === r0) r1++;
          if (c0 < 0) c0 = 0; if (r0 < 0) r0 = 0; if (c1 > pw) c1 = pw; if (r1 > ph) r1 = ph;
          for (let r = r0; r < r1; r++) {
            const row = r * pw;
            if (c1 - c0 < 16) for (let q = c0; q < c1; q++) mask[row + q] = 1;
            else mask.fill(1, row + c0, row + c1);
          }
        }
        for (const P of bin.others) fillPoly(mask, pw, ph, P, a, b, c, d, e, f);
        return true;
      }, ctl);
      if (!ok) return null;
      const [cr, cg, cb] = parseColour(L.colour), al = L.key === '37/0' ? 0.9 : 0.62, be = 1 - al;
      const ar = cr * al, ag = cg * al, ab = cb * al;
      for (let i = 0, j = 0, n = mask.length; i < n; i++, j += 4) {
        if (mask[i]) { rgba[j] = ar + rgba[j] * be; rgba[j + 1] = ag + rgba[j + 1] * be; rgba[j + 2] = ab + rgba[j + 2] * be; }
      }
      done++;
      if (ctl && ctl.onLayer) {
        octx.putImageData(image, 0, 0);
        ctl.onLayer(done / on.length, L.key, out);
      }
      await pause();
    }
    octx.putImageData(image, 0, 0);
    return out;
  }

  W.WBX = W.WBX || {};
  W.WBX.gds = { parse, buildDie, padCandidates, defaultLayers, render, ringOrder, findMark };
})(window);
