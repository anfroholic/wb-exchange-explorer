/* KiCad reader: s-expressions into footprints and boards, in millimetres, y down, as KiCad holds them.
   Each list remembers its source span, so a board can be edited by splicing and everything else stays byte-identical. */
(function (W) {
  'use strict';

  function parseSexpr(text) {
    const stack = [];
    let cur = null, root = null, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 40) {                                   // (
        const node = [];
        node.s = i;
        if (cur) cur.push(node);
        stack.push(cur);
        cur = node;
        i++;
      } else if (c === 41) {                            // )
        cur.e = i + 1;
        if (!stack[stack.length - 1]) root = cur;
        cur = stack.pop();
        i++;
        if (!cur) break;
      } else if (c === 34) {                            // "
        let j = i + 1, out = '', run = j;
        for (;;) {
          if (j >= n) throw new Error('Unterminated string in KiCad file.');
          const d = text.charCodeAt(j);
          if (d === 92) { out += text.slice(run, j); const e = text[j + 1]; out += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; run = j; continue; }
          if (d === 34) break;
          j++;
        }
        out += text.slice(run, j);
        if (cur) cur.push(out);
        i = j + 1;
      } else if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else {
        let j = i + 1;
        while (j < n) {
          const d = text.charCodeAt(j);
          if (d === 32 || d === 40 || d === 41 || d === 9 || d === 10 || d === 13) break;
          j++;
        }
        if (cur) cur.push(text.slice(i, j));
        i = j;
      }
    }
    if (!root) throw new Error('This file is not a complete KiCad s-expression.');
    return root;
  }

  const kid = (n, k) => { for (let i = 1; i < n.length; i++) if (Array.isArray(n[i]) && n[i][0] === k) return n[i]; return null; };
  const kids = (n, k) => { const o = []; for (let i = 1; i < n.length; i++) if (Array.isArray(n[i]) && n[i][0] === k) o.push(n[i]); return o; };
  const nums = n => n ? n.slice(1).map(Number) : [];
  const rad = d => d * Math.PI / 180;
  /* KiCad's rotation: an angle a maps (x, y) to (x cos a + y sin a, -x sin a + y cos a). */
  const rot = (x, y, d) => { if (!d) return [x, y]; const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [x * c + y * s, -x * s + y * c]; };

  function arcPts(a, m, b) {
    const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return [ax, ay, cx, cy];
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy), t0 = Math.atan2(ay - uy, ax - ux), t1 = Math.atan2(by - uy, bx - ux), t2 = Math.atan2(cy - uy, cx - ux);
    const norm = v => { while (v < 0) v += 2 * Math.PI; while (v >= 2 * Math.PI) v -= 2 * Math.PI; return v; };
    const ccw = norm(t1 - t0) < norm(t2 - t0);
    const sweep = ccw ? norm(t2 - t0) : -norm(t0 - t2);
    const N = Math.max(4, Math.ceil(Math.abs(sweep) / 0.2)), out = [];
    for (let i = 0; i <= N; i++) { const t = t0 + sweep * i / N; out.push(ux + r * Math.cos(t), uy + r * Math.sin(t)); }
    return out;
  }
  function polyPts(ptsNode) {
    const out = [];
    for (const k of ptsNode.slice(1)) {
      if (!Array.isArray(k)) continue;
      if (k[0] === 'xy') out.push(+k[1], +k[2]);
      else if (k[0] === 'arc') out.push(...arcPts(nums(kid(k, 'start')), nums(kid(k, 'mid')), nums(kid(k, 'end'))));
    }
    return out;
  }
  function graphic(n) {
    const type = n[0].replace(/^(fp|gr)_/, '');
    const layerN = kid(n, 'layer');
    const layer = layerN ? layerN[1] : null;
    const strokeN = kid(n, 'stroke');
    const w = strokeN && kid(strokeN, 'width') ? +kid(strokeN, 'width')[1] : kid(n, 'width') ? +kid(n, 'width')[1] : 0;
    const fillN = kid(n, 'fill');
    const fill = !!fillN && fillN[1] !== 'no' && fillN[1] !== 'none';
    const P = k => nums(kid(n, k));
    if (type === 'line') return { kind: 'line', layer, w, pts: [...P('start'), ...P('end')] };
    if (type === 'rect') {
      const a = P('start'), b = P('end');
      return { kind: 'poly', layer, w, fill, rect: true, pts: [a[0], a[1], b[0], a[1], b[0], b[1], a[0], b[1]] };
    }
    if (type === 'arc') return { kind: 'line', layer, w, pts: arcPts(P('start'), P('mid'), P('end')) };
    if (type === 'circle') {
      const c = P('center'), e = P('end'), r = Math.hypot(e[0] - c[0], e[1] - c[1]), pts = [];
      for (let i = 0; i < 48; i++) pts.push(c[0] + r * Math.cos(i * Math.PI / 24), c[1] + r * Math.sin(i * Math.PI / 24));
      return { kind: 'poly', layer, w, fill, pts };
    }
    if (type === 'poly') return { kind: 'poly', layer, w, fill: fillN ? fill : true, pts: polyPts(kid(n, 'pts')) };
    if (type === 'text') {
      const at = nums(kid(n, 'at')), eff = kid(n, 'effects'), font = eff && kid(eff, 'font'), size = font && kid(font, 'size');
      const hide = !!kid(n, 'hide') && kid(n, 'hide')[1] === 'yes' || n.includes('hide') || (eff && !!kid(eff, 'hide') && kid(eff, 'hide')[1] === 'yes');
      const just = eff && kid(eff, 'justify');
      return { kind: 'text', layer, x: at[0], y: at[1], rot: at[2] || 0, s: n[n[0] === 'gr_text' ? 1 : 2], size: size ? +size[1] : 1, hide, mirror: !!(just && just.includes('mirror')) };
    }
    return null;
  }
  function transformed(g, ox, oy, a) {
    if (g.kind === 'text') { const [x, y] = rot(g.x, g.y, a); return Object.assign({}, g, { x: x + ox, y: y + oy }); }
    const pts = new Array(g.pts.length);
    for (let i = 0; i < g.pts.length; i += 2) { const [x, y] = rot(g.pts[i], g.pts[i + 1], a); pts[i] = x + ox; pts[i + 1] = y + oy; }
    return Object.assign({}, g, { pts });
  }

  function parseFootprint(n, kindHint) {
    const at = nums(kid(n, 'at'));
    const fp = { lib: n[1], name: String(n[1]).split(':').pop(), x: at[0] || 0, y: at[1] || 0, rot: at[2] || 0,
      layer: kid(n, 'layer') ? kid(n, 'layer')[1] : 'F.Cu', props: {}, attrs: [], pads: [], gfxLocal: [], gfx: [], images: [], s: n.s, e: n.e, model: null };
    if (kid(n, 'attr')) fp.attrs = kid(n, 'attr').slice(1);
    for (let i = 1; i < n.length; i++) {
      const k = n[i];
      if (!Array.isArray(k)) continue;
      const head = k[0];
      if (head === 'property') {
        fp.props[k[1]] = k[2];
        if ((k[1] === 'Reference' || k[1] === 'Value') && kid(k, 'at')) {
          const hide = !!kid(k, 'hide') && kid(k, 'hide')[1] === 'yes';
          const g = graphic(['fp_text', 'user', k[2], ...k.slice(3)]);
          if (g && !hide && k[1] === 'Reference') { g.hide = false; fp.gfxLocal.push(g); }
        }
      } else if (head === 'fp_text') {
        const g = graphic(k);
        if (g) { g.isRef = k[1] === 'reference'; fp.gfxLocal.push(g); if (k[1] === 'reference') fp.props.Reference = k[2]; if (k[1] === 'value') fp.props.Value = k[2]; }
      } else if (/^fp_(line|rect|arc|circle|poly)$/.test(head)) {
        const g = graphic(k);
        if (g) fp.gfxLocal.push(g);
      } else if (head === 'pad') {
        const pat = nums(kid(k, 'at')), size = nums(kid(k, 'size')), lay = kid(k, 'layers');
        const netN = kid(k, 'net'), pf = kid(k, 'pinfunction');
        const rrN = kid(k, 'roundrect_rratio'), fab = kid(k, 'property');
        // (net 3 "name") before KiCad 10, (net "name") after
        const net = netN ? String(netN[netN.length - 1]) : null;
        fp.pads.push({ num: k[1], type: k[2], shape: k[3], lx: pat[0] || 0, ly: pat[1] || 0, rot: pat[2] || 0, w: size[0] || 0, h: size[1] === undefined ? size[0] : size[1],
          layers: lay ? lay.slice(1) : [], net: net || null, pinfunction: pf ? pf[1] : null, rr: rrN ? +rrN[1] : 0.25, drill: kid(k, 'drill') ? +kid(k, 'drill')[1] : 0,
          fab: fab ? String(fab[1]) : null });   // KiCad's fabrication property, e.g. pad_prop_fiducial_glob
      } else if (head === 'image') {
        const iat = nums(kid(k, 'at')), data = kid(k, 'data');
        if (data) fp.images.push({ x: iat[0] || 0, y: iat[1] || 0, scale: kid(k, 'scale') ? +kid(k, 'scale')[1] : 1, layer: kid(k, 'layer') ? kid(k, 'layer')[1] : null, b64: data.slice(1).join('') });
      } else if (head === 'model' && !fp.model) fp.model = k[1];
    }
    fp.ref = fp.props.Reference || '';
    fp.value = fp.props.Value || '';
    fp.wbKind = fp.props.wb_kind || null;
    fp.gfx = fp.gfxLocal.map(g => transformed(g, fp.x, fp.y, fp.rot));
    for (const p of fp.pads) {
      const [x, y] = rot(p.lx, p.ly, fp.rot);
      p.x = x + fp.x; p.y = y + fp.y;
      // A .kicad_pcb stores pad angles with the footprint's rotation already in them; a .kicad_mod has rotation 0.
    }
    return fp;
  }

  function parseBoard(text) {
    const root = parseSexpr(text);
    if (root[0] !== 'kicad_pcb') throw new Error('This is not a .kicad_pcb: it starts with "' + root[0] + '".');
    const b = { kind: 'board', version: kid(root, 'version') ? kid(root, 'version')[1] : '', fps: [], gfx: [], layers: [], props: {}, root: { s: root.s, e: root.e } };
    const layersN = kid(root, 'layers');
    if (layersN) for (const l of layersN.slice(1)) if (Array.isArray(l)) b.layers.push({ id: +l[0], name: l[1], type: l[2], alias: l[3] || null });
    b.layersSpan = layersN ? { s: layersN.s, e: layersN.e } : null;
    for (let i = 1; i < root.length; i++) {
      const k = root[i];
      if (!Array.isArray(k)) continue;
      const h = k[0];
      if (h === 'footprint' || h === 'module') b.fps.push(parseFootprint(k));
      else if (h === 'property') b.props[k[1]] = k[2];
      else if (/^gr_(line|rect|arc|circle|poly|text)$/.test(h)) { const g = graphic(k); if (g) b.gfx.push(g); }
      else if (h === 'segment') b.gfx.push({ kind: 'line', layer: kid(k, 'layer')[1], w: +kid(k, 'width')[1], pts: [...nums(kid(k, 'start')), ...nums(kid(k, 'end'))] });
      else if (h === 'arc') b.gfx.push({ kind: 'line', layer: kid(k, 'layer')[1], w: +kid(k, 'width')[1], pts: arcPts(nums(kid(k, 'start')), nums(kid(k, 'mid')), nums(kid(k, 'end'))) });
      else if (h === 'via') {
        const a = nums(kid(k, 'at')), s = +kid(k, 'size')[1];
        b.gfx.push({ kind: 'via', x: a[0], y: a[1], d: s, layer: '*' });
      } else if (h === 'zone') {
        const fills = kids(k, 'filled_polygon');
        for (const f of fills) b.gfx.push({ kind: 'poly', layer: kid(f, 'layer')[1], w: 0, fill: true, pts: polyPts(kid(f, 'pts')), zone: true });
      }
    }
    return b;
  }

  function parseFootprintFile(text) {
    const root = parseSexpr(text);
    if (root[0] !== 'footprint' && root[0] !== 'module') throw new Error('This is not a .kicad_mod: it starts with "' + root[0] + '".');
    const fp = parseFootprint(root);
    fp.x = fp.y = fp.rot = 0;
    return { kind: 'footprint', fps: [fp], gfx: [], layers: [], props: {} };
  }

  /* ---- what a substrate is: bond targets on the front copper ---- */
  const isFrontCopper = p => p.layers.some(l => l === 'F.Cu' || l === '*.Cu' || l === 'F&B.Cu');
  function landsFrom(fps, opts) {
    const maxLen = opts.maxLen, lands = [];
    let paddle = null, skipped = 0;
    const candidates = [];
    for (const fp of fps) {
      if (fp.wbKind === 'die' || fp.wbKind === 'wire' || fp.wbKind === 'type_library' || fp.wbKind === 'fiducial') continue;
      for (const p of fp.pads) {
        if (p.fab && p.fab.startsWith('pad_prop_fiducial')) continue;   // a fiducial is for cameras, never a bond target
        if (p.type === 'smd' || p.type === 'connect') {
          if (isFrontCopper(p)) candidates.push({ fp, p });
          else skipped++;
        }
      }
    }
    // The biggest pad, when it is much bigger than a land could be, is the paddle the die sits on.
    let best = null;
    for (const c of candidates) if (!best || c.p.w * c.p.h > best.p.w * best.p.h) best = c;
    for (const c of candidates) {
      const { fp, p } = c, longSide = Math.max(p.w, p.h);
      if (longSide > maxLen) {
        if (c === best) paddle = { x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, rr: p.rr, ref: fp.ref, num: p.num };
        continue;
      }
      if (!p.num) continue;
      lands.push({ fp, ref: fp.ref, num: p.num, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, rr: p.rr, net: p.net });
    }
    // Numbers must identify a land. Discrete land footprints all have pad "1", so their reference number is used instead.
    const seen = new Set(), dup = lands.some(l => { const d = seen.has(l.num); seen.add(l.num); return d; });
    for (const l of lands) {
      l.id = dup ? l.ref + '.' + l.num : l.num;
      const m = dup ? String(l.ref).match(/(\d+)$/) : String(l.num).match(/^(\d+)$/);
      l.ord = m ? +m[1] : null;
      delete l.fp;
    }
    lands.sort((a, b) => (a.ord === null ? 1e9 : a.ord) - (b.ord === null ? 1e9 : b.ord) || String(a.id).localeCompare(String(b.id)));
    return { lands, paddle, skipped };
  }
  function suggestSubstrate(board) {
    let best = -1, score = 0;
    board.fps.forEach((fp, i) => {
      if (fp.wbKind) return;
      const n = fp.pads.filter(p => (p.type === 'smd' || p.type === 'connect') && isFrontCopper(p)).length;
      const s = n + (/pad.?ring|cob|bond|substrate/i.test(fp.lib) ? 1000 : 0);
      if (n >= 4 && s > score) { score = s; best = i; }
    });
    return best;  // -1: use the whole board
  }

  /* ---- a footprint read as a die ---- */
  function sideLocal(x, y, o) {
    const d = { B: o.y1 - y, R: o.x1 - x, T: y - o.y0, L: x - o.x0 };
    let k = 'B';
    for (const s of 'RTL') if (d[s] < d[k]) k = s;
    return k;
  }
  function dieFromFootprint(fp) {
    const notes = [], rects = fp.gfxLocal.filter(g => g.kind === 'poly' && g.rect);
    const bbox = g => { const X = g.pts.filter((_, i) => i % 2 === 0), Y = g.pts.filter((_, i) => i % 2 === 1); return { x0: Math.min(...X), y0: Math.min(...Y), x1: Math.max(...X), y1: Math.max(...Y) }; };

    // Mechanical pads as this app writes them: a filled Fab rectangle with a Fab text holding "number net" over it.
    const texts = fp.gfxLocal.filter(g => g.kind === 'text' && g.layer === 'F.Fab');
    const filled = rects.filter(g => g.fill && g.layer === 'F.Fab');
    const mech = [];
    for (const g of filled) {
      const b = bbox(g);
      const t = texts.find(t => t.x >= b.x0 && t.x <= b.x1 && t.y >= b.y0 && t.y <= b.y1 && /^\S+( |$)/.test(t.s));
      mech.push({ b, label: t ? t.s : null });
    }
    const pads = [];
    for (const p of fp.pads) {
      if (p.type === 'np_thru_hole' || !p.num) continue;
      const swap = Math.abs(p.rot % 180) === 90;
      pads.push({ num: p.num, x: p.lx, y: p.ly, w: swap ? p.h : p.w, h: swap ? p.w : p.h, net: p.pinfunction || p.net || null, shape: p.shape, copper: p.layers.some(l => /Cu$/.test(l)) });
    }
    if (!pads.length && mech.length) {
      let auto = 1;
      for (const m of mech) {
        const [num, ...rest] = (m.label || '').split(' ');
        pads.push({ num: num || String(auto), x: (m.b.x0 + m.b.x1) / 2, y: (m.b.y0 + m.b.y1) / 2, w: m.b.x1 - m.b.x0, h: m.b.y1 - m.b.y0, net: rest.join(' ') || null });
        auto++;
      }
      if (mech.some(m => !m.label)) notes.push('Some Fab pads have no number text, so they were numbered in file order.');
    }
    pads.sort((a, b) => (parseInt(a.num) || 0) - (parseInt(b.num) || 0));

    // Outline: the largest unfilled rectangle on Fab or courtyard; otherwise the extent of those layers; otherwise the pads.
    let out = null, outlineFrom = '';
    const candidates = rects.filter(g => !g.fill && (g.layer === 'F.Fab' || g.layer === 'F.CrtYd' || g.layer === 'Edge.Cuts' || g.layer === 'Dwgs.User'))
      .map(g => bbox(g)).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    if (candidates.length) { out = candidates[0]; outlineFrom = 'a rectangle in the footprint'; }
    if (!out) {
      const lines = fp.gfxLocal.filter(g => g.kind !== 'text' && (g.layer === 'F.Fab' || g.layer === 'F.CrtYd'));
      if (lines.length) {
        const bs = lines.map(bbox);
        out = { x0: Math.min(...bs.map(b => b.x0)), y0: Math.min(...bs.map(b => b.y0)), x1: Math.max(...bs.map(b => b.x1)), y1: Math.max(...bs.map(b => b.y1)) };
        outlineFrom = 'the extent of its Fab and courtyard lines';
      }
    }
    if (!out && pads.length) {
      const m = 0.1;
      out = { x0: Math.min(...pads.map(p => p.x - p.w / 2)) - m, y0: Math.min(...pads.map(p => p.y - p.h / 2)) - m, x1: Math.max(...pads.map(p => p.x + p.w / 2)) + m, y1: Math.max(...pads.map(p => p.y + p.h / 2)) + m };
      outlineFrom = 'the pads plus 0.1 mm, because it has no outline';
      notes.push('The footprint has no die outline, so the size is a guess from the pads.');
    }
    if (!out) out = { x0: -1, y0: -1, x1: 1, y1: 1 };
    pads.forEach(p => { p.side = sideLocal(p.x, p.y, out); p.key = 'n' + p.num; });
    const counts = { B: 0, R: 0, T: 0, L: 0 };
    pads.forEach(p => counts[p.side]++);
    if (pads.some(p => p.copper)) notes.push('Its pads are on copper, so they would plot as substrate copper if this die is placed in a board for fabrication.');
    const copperless = fp.gfxLocal.filter(g => !(g.kind === 'poly' && g.fill && g.layer === 'F.Fab') && !(g.kind === 'text' && g.layer === 'F.Fab'));
    return { source: 'footprint', name: fp.name, ref: fp.ref, x0: out.x0, y0: out.y0, x1: out.x1, y1: out.y1, pads, gfx: copperless,
      images: fp.images, info: { outlineFrom, notes, counts, netsFound: pads.filter(p => p.net).length } };
  }

  /* ---- things a board may already say about wires and types ---- */
  function boardWires(board) {
    const out = [];
    for (const fp of board.fps) if (fp.wbKind === 'wire') {
      const line = fp.gfxLocal.find(g => g.kind === 'line');
      out.push({ ref: fp.ref, from: fp.props.wb_from, to: fp.props.wb_to, toKind: fp.props.wb_to_kind || null, type: fp.props.wb_type || fp.props.wb_profile || null, seq: fp.props.wb_seq ? +fp.props.wb_seq : null, net: fp.props.wb_net || null, line: line ? { x: fp.x, y: fp.y, dx: line.pts[2] - line.pts[0], dy: line.pts[3] - line.pts[1], w: line.w } : null });
    }
    out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    return out;
  }
  function boardTypes(board) {
    const out = [];
    const lib = board.fps.find(fp => fp.wbKind === 'type_library' || fp.ref === 'WBLIB');
    if (lib) for (const k of Object.keys(lib.props)) {
      const m = k.match(/^wb_type_(.+)$/);
      if (!m) continue;
      const t = String(lib.props[k]).trim().split(/\s+/);
      if (t.length >= 5) out.push({ name: m[1], style: t[0], material: t[1], d: +t[2], dir: t[3], moves: t.slice(4).join(' '), family: 'custom', fromBoard: true });
    }
    // The older example form: flat board properties, wb_profile_<i>_<field>.
    const idx = new Set();
    for (const k of Object.keys(board.props)) { const m = k.match(/^wb_profile_(\d+)_name$/); if (m) idx.add(m[1]); }
    for (const i of [...idx].sort()) {
      const f = k => board.props[`wb_profile_${i}_${k}`];
      out.push({ name: f('name'), style: f('style') || 'ball-wedge', material: f('material') || 'Au', d: +f('d') || 25, dir: f('dir') || 'forward', moves: f('moves') || '180/0', family: 'custom', fromBoard: true });
    }
    // UNDEFINED and GENERIC are reserved: whatever a board's library says about them, they never gain a diameter or a loop.
    return out.filter(t => !/^(undefined|generic)$/i.test(t.name));
  }
  // Lines drawn on Cmts.User inside the substrate footprint: some COBs carry placeholder wires there.
  function drawnLines(fps) {
    const out = [];
    for (const fp of fps) for (const g of fp.gfx) if (g.kind === 'line' && g.layer === 'Cmts.User' && g.pts.length === 4) out.push(g.pts);
    return out;
  }

  W.WBX = W.WBX || {};
  W.WBX.kicad = { parseSexpr, parseBoard, parseFootprintFile, landsFrom, suggestSubstrate, dieFromFootprint, boardWires, boardTypes, drawnLines, rot, kid, kids };
})(window);
