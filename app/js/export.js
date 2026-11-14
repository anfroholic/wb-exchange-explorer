/* Writers for KiCad: die footprint, die kit, assembled board with 3D wires, bondlist.
   Follows the decided model: the die is mechanical with no copper, nets stay on the lands, one footprint per wire,
   and the type library lives in the board as fields on a footprint. */
(function (W) {
  'use strict';
  const M = W.WBX.model;

  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  const n = v => { const s = (+v).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' || s === '' ? '0' : s; };
  function fnv(s, seed) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // Same names give the same uuids, so re-exporting doesn't churn a board in version control.
  function uuid(key) {
    const hex = [0x811c9dc5, 0x1234567, 0x9e3779b9, 0xdeadbeef].map(s => fnv('wbx/' + key, s).toString(16).padStart(8, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  const safe = s => String(s).replace(/[^\w.+-]+/g, '_') || 'die';
  const uu = k => `(uuid ${q(uuid(k))})`;
  const hiddenProp = (owner, key, val, layer) => `\t\t(property ${q(key)} ${q(val)} (at 0 0 0) (layer ${q(layer)}) (hide yes) ${uu(owner + '/p/' + key)} (effects (font (size 0.1 0.1) (thickness 0.01))))`;

  /* KiCad sizes a reference image at 300 pixels per inch times its scale. */
  function artForKicad(canvas, maxPx) {
    if (!canvas) return null;
    const s = Math.min(1, maxPx / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const b64 = c.toDataURL('image/png').split(',')[1];
    const lines = [];
    for (let i = 0; i < b64.length; i += 76) lines.push(q(b64.slice(i, i + 76)));
    return { lines, px: c.width };
  }

  function dieItems(die, key, angle, art, origin) {
    const o = [];
    const W_ = die.x1 - die.x0, H_ = die.y1 - die.y0;
    o.push(`\t\t(fp_rect (start ${n(die.x0)} ${n(die.y0)}) (end ${n(die.x1)} ${n(die.y1)}) (stroke (width 0.02) (type solid)) (fill no) (layer "F.Fab") ${uu(key + '/o')})`);
    o.push(`\t\t(fp_rect (start ${n(die.x0)} ${n(die.y0)}) (end ${n(die.x1)} ${n(die.y1)}) (stroke (width 0.02) (type solid)) (fill no) (layer "F.CrtYd") ${uu(key + '/c')})`);
    for (const p of die.pads) {
      const x0 = p.x - p.w / 2, y0 = p.y - p.h / 2;
      o.push(`\t\t(fp_rect (start ${n(x0)} ${n(y0)}) (end ${n(x0 + p.w)} ${n(y0 + p.h)}) (stroke (width 0.001) (type solid)) (fill yes) (layer "F.Fab") ${uu(key + '/p' + p.num)})`);
      // KiCad blanks the number of a pad with no copper when it loads one, so numbers and names live in Fab text over the pad.
      const size = Math.max(0.01, Math.min(p.w, p.h) * 0.22);
      o.push(`\t\t(fp_text user ${q(p.num + (p.net ? ' ' + String(p.net).replace(/\s+/g, '_') : ''))} (at ${n(p.x)} ${n(p.y)} ${n(angle)}) (layer "F.Fab") ${uu(key + '/t' + p.num)} (effects (font (size ${n(size)} ${n(size)}) (thickness ${n(size / 8)}))))`);
    }
    if (art) {
      const scale = W_ / (art.px * 25.4 / 300);
      // Unlike every other footprint item, KiCad reads an image's position in board coordinates, not relative to the footprint.
      const ax = (die.x0 + die.x1) / 2 + (origin ? origin[0] : 0), ay = (die.y0 + die.y1) / 2 + (origin ? origin[1] : 0);
      o.push(`\t\t(image (at ${n(ax)} ${n(ay)}) (layer "F.Fab") (scale ${scale.toFixed(6)}) ${uu(key + '/img')}\n\t\t\t(data ${art.lines.join('\n\t\t\t\t')})\n\t\t)`);
    }
    return o;
  }

  function dieFootprintFile(die, opts) {
    opts = opts || {};
    const name = safe(opts.name || die.name), art = opts.art === false ? null : artForKicad(die.artCanvas, opts.artPx || 1024);
    const h = die.y1 - die.y0;
    const descr = die.source === 'gds' ? `Die stand-in from ${die.fileName || 'a GDS'}. Mechanical only, no copper: bond lands live on the board.` : `Die footprint, rewritten as mechanical only.`;
    const out = [`(footprint ${q(name)}`, `\t(version 20260206)`, `\t(generator "wbx_explorer")`, `\t(generator_version "10.0")`, `\t(layer "F.Cu")`, `\t(descr ${q(descr)})`,
      `\t(property "Reference" "D" (at 0 ${n(die.y0 - 0.3)} 0) (layer "F.Fab") ${uu(name + '/r')} (effects (font (size 0.3 0.3) (thickness 0.05))))`,
      `\t(property "Value" ${q(name)} (at 0 ${n(die.y1 + 0.3)} 0) (layer "F.Fab") ${uu(name + '/v')} (effects (font (size 0.3 0.3) (thickness 0.05))))`,
      hiddenProp(name, 'wb_kind', 'die', 'F.Fab'),
      `\t(attr board_only exclude_from_pos_files exclude_from_bom)`,
      ...dieItems(die, name, 0, art)];
    if (opts.model) out.push(`\t(model ${q(opts.model)} (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))`);
    out.push(')');
    return out.join('\n') + '\n';
  }

  /* ---- 3D ---- */
  const U = 1 / 2540;  // KiCad reads one VRML unit as 2.54 mm; inputs here are micrometres
  // A generic or undefined wire's tube is M.CHOICE_TUBE_UM across, only so it can be seen. It isn't a wire size.
  const NEUTRAL_SHINE = '0.35 0.35 0.35';  // no gold highlight on a wire whose metal nobody has picked
  function tube(pts, d, colour, shine) {
    const R = d / 2, K = 6, verts = [], faces = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const L = Math.hypot(...t) || 1;
      t = t.map(v => v / L);
      const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
      const Sn = Math.hypot(...s) || 1;
      s = s.map(v => v / Sn);
      const w = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
      for (let k = 0; k < K; k++) {
        const c = Math.cos(2 * Math.PI * k / K), e = Math.sin(2 * Math.PI * k / K);
        verts.push([0, 1, 2].map(j => p[j] + R * (c * s[j] + e * w[j])));
      }
      if (i) for (let k = 0; k < K; k++) { const m = (k + 1) % K; faces.push((i - 1) * K + k, (i - 1) * K + m, i * K + m, i * K + k, -1); }
    });
    return `#VRML V2.0 utf8\nShape { appearance Appearance { material Material { diffuseColor ${colour} specularColor ${shine || '0.9 0.8 0.5'} shininess 0.6 } } geometry IndexedFaceSet { solid FALSE creaseAngle 1.2 coord Coordinate { point [ ${verts.map(v => v.map(c => (c * U).toFixed(5)).join(' ')).join(', ')} ] } coordIndex [ ${faces.join(' ')} ] } }\n`;
  }
  const hexToVrml = hex => { const m = String(hex).match(/^#(..)(..)(..)$/); return m ? [m[1], m[2], m[3]].map(v => (parseInt(v, 16) / 255).toFixed(3)).join(' ') : '0.9 0.72 0.25'; };

  // base lifts the whole model: a die on another die starts at that one's top. Heights are um above the board.
  function dieWrl(die, thick, attach, base) {
    base = base || 0;
    const zTop = base + attach + thick;
    const X0 = die.x0 * 1000, X1 = die.x1 * 1000, Y0 = -die.y1 * 1000, Y1 = -die.y0 * 1000;
    const shape = (col, pts, idx) => `Shape { appearance Appearance { material Material { diffuseColor ${col} specularColor 0.15 0.15 0.15 shininess 0.25 } } geometry IndexedFaceSet { solid FALSE coord Coordinate { point [ ${pts.map(p => p.map(c => (c * U).toFixed(5)).join(' ')).join(', ')} ] } coordIndex [ ${idx.join(' ')} ] } }`;
    const box = (col, x0, y0, z0, x1, y1, z1) => shape(col, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 3, 2, 1, -1, 4, 5, 6, 7, -1, 0, 1, 5, 4, -1, 1, 2, 6, 5, -1, 2, 3, 7, 6, -1, 3, 0, 4, 7, -1]);
    const face = (col, rects, z) => { const pts = [], idx = []; for (const r of rects) { const k = pts.length; pts.push([r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z]); idx.push(k, k + 1, k + 2, k + 3, -1); } return shape(col, pts, idx); };
    const S = [box('0.35 0.35 0.37', X0 - 10, Y0 - 10, base, X1 + 10, Y1 + 10, base + attach), box('0.20 0.22 0.27', X0, Y0, base + attach, X1, Y1, zTop)];
    if (die.artCanvas) {
      // A coarse mosaic of the artwork: runs of similar colour become flat rectangles, which keeps the file small.
      const cols = 240, rows = Math.max(1, Math.round(cols * (Y1 - Y0) / (X1 - X0)));
      const c = document.createElement('canvas'); c.width = cols; c.height = rows;
      const ctx = c.getContext('2d'); ctx.drawImage(die.artCanvas, 0, 0, cols, rows);
      const d = ctx.getImageData(0, 0, cols, rows).data, buckets = new Map(), cw = (X1 - X0) / cols, ch = (Y1 - Y0) / rows;
      const bk = i => [d[i] >> 5, d[i + 1] >> 5, d[i + 2] >> 5].join();
      for (let r = 0; r < rows; r++) {
        let k = 0;
        while (k < cols) {
          const b = bk((r * cols + k) * 4);
          let e = k;
          while (e + 1 < cols && bk((r * cols + e + 1) * 4) === b) e++;
          if (!buckets.has(b)) buckets.set(b, []);
          buckets.get(b).push([X0 + k * cw, Y1 - (r + 1) * ch, X0 + (e + 1) * cw, Y1 - r * ch]);
          k = e + 1;
        }
      }
      for (const [b, rects] of buckets) S.push(face(b.split(',').map(v => ((+v * 32 + 16) / 255).toFixed(3)).join(' '), rects, zTop + 1));
    }
    S.push(face('0.86 0.86 0.80', die.pads.map(p => [(p.x - p.w / 2) * 1000, -(p.y + p.h / 2) * 1000, (p.x + p.w / 2) * 1000, -(p.y - p.h / 2) * 1000]), zTop + 2));
    return '#VRML V2.0 utf8\n' + S.join('\n') + '\n';
  }

  /* ---- schematic symbol ---- */
  function symbolFile(die) {
    const name = safe(die.name), P = 2.54;
    const groups = { L: [], B: [], R: [], T: [] };
    die.pads.forEach(p => groups[p.side].push(p));
    const pin = p => (p.net || 'P' + p.num).replace(/\s+/g, '_');
    const longest = Math.max(1, ...die.pads.map(p => pin(p).length));
    const half = c => Math.round((c * P / 2 + longest * 0.85 + 2.54) / 2.54) * 2.54;
    const hw = half(Math.max(groups.B.length, groups.T.length)), hh = half(Math.max(groups.L.length, groups.R.length));
    const pins = [];
    for (const k of 'LBRT') {
      const g = groups[k], N = g.length;
      g.forEach((p, j) => {
        const off = Math.round((j - (N - 1) / 2) * 2) / 2 * P;
        const [x, y, a] = k === 'L' ? [-hw - 2.54, -off, 0] : k === 'B' ? [off, -hh - 2.54, 90] : k === 'R' ? [hw + 2.54, off, 180] : [-off, hh + 2.54, 270];
        const type = /^(D?VDD|D?VSS|GND)$/i.test(pin(p)) ? 'power_in' : 'bidirectional';
        pins.push(`\t\t\t(pin ${type} line (at ${n(x)} ${n(y)} ${a}) (length 2.54) (name ${q(pin(p))} (effects (font (size 1 1)))) (number ${q(p.num)} (effects (font (size 1 1)))))`);
      });
    }
    return `(kicad_symbol_lib
\t(version 20241209)
\t(generator "wbx_explorer")
\t(symbol ${q(name)} (pin_names (offset 0.5)) (exclude_from_sim no) (in_bom yes) (on_board yes)
\t\t(property "Reference" "U" (at ${n(-hw)} ${n(hh + 1.5)} 0) (effects (font (size 1.27 1.27)) (justify left)))
\t\t(property "Value" ${q(name)} (at ${n(hw)} ${n(hh + 1.5)} 0) (effects (font (size 1.27 1.27)) (justify right)))
\t\t(property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
\t\t(property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
\t\t(symbol ${q(name + '_0_1')} (rectangle (start ${n(-hw)} ${n(hh)}) (end ${n(hw)} ${n(-hh)}) (stroke (width 0.254) (type default)) (fill (type background))))
\t\t(symbol ${q(name + '_1_1')}
${pins.join('\n')}
\t\t)
\t)
)
`;
  }

  /* ---- assembled board ---- */
  const LAYER_IDS = { 'User.1': 39, 'User.2': 41, 'User.3': 43, 'User.4': 45, 'User.5': 47, 'User.6': 49, 'User.7': 51, 'User.8': 53, 'User.9': 55 };
  function pickWireLayer(text, board) {
    const usedIn = name => new RegExp('\\(layer\\s+"' + name.replace('.', '\\.') + '"\\)').test(text);
    for (const name of Object.keys(LAYER_IDS)) if (!usedIn(name)) return { name, inTable: board.layers.some(l => l.name === name) };
    return { name: 'User.9', inTable: board.layers.some(l => l.name === 'User.9') };
  }
  const BLANK_LAYERS = [[0, 'F.Cu', 'signal'], [2, 'B.Cu', 'signal'], [9, 'F.Adhes', 'user', 'F.Adhesive'], [11, 'B.Adhes', 'user', 'B.Adhesive'], [13, 'F.Paste', 'user'], [15, 'B.Paste', 'user'], [5, 'F.SilkS', 'user', 'F.Silkscreen'], [7, 'B.SilkS', 'user', 'B.Silkscreen'], [1, 'F.Mask', 'user'], [3, 'B.Mask', 'user'], [17, 'Dwgs.User', 'user', 'User.Drawings'], [19, 'Cmts.User', 'user', 'User.Comments'], [21, 'Eco1.User', 'user', 'User.Eco1'], [23, 'Eco2.User', 'user', 'User.Eco2'], [25, 'Edge.Cuts', 'user'], [27, 'Margin', 'user'], [31, 'F.CrtYd', 'user', 'F.Courtyard'], [29, 'B.CrtYd', 'user', 'B.Courtyard'], [35, 'F.Fab', 'user'], [33, 'B.Fab', 'user']];

  // A .kicad_mod substrate needs a board around it. It sits at (ox, oy) on the sheet with a plain outline.
  function boardFromFootprint(S, ox, oy) {
    const src = S.substrate.text;
    const fp = S.substrate.board.fps[0];
    const body = src.slice(src.indexOf('('), src.lastIndexOf(')'));
    const withAt = body.replace(/\(layer\s+"[^"]*"\)/, m => `${m}\n\t(at ${n(ox)} ${n(oy)})`).replace(/\(version\s+\S+\)\s*/, '').replace(/\(generator\s+"[^"]*"\)\s*/, '').replace(/\(generator_version\s+"[^"]*"\)\s*/, '');
    const X = [], Y = [];
    for (const p of fp.pads) { X.push(p.x - p.w, p.x + p.w); Y.push(p.y - p.h, p.y + p.h); }
    for (const d of M.placedDies(S)) for (const [x, y] of M.dieCorners(d)) { X.push(x); Y.push(y); }
    const x0 = Math.min(...X) - 1, x1 = Math.max(...X) + 1, y0 = Math.min(...Y) - 1, y1 = Math.max(...Y) + 1;
    const rows = BLANK_LAYERS.map(r => `\t\t(${r[0]} ${q(r[1])} ${r[2]}${r[3] ? ' ' + q(r[3]) : ''})`);
    const text = `(kicad_pcb\n\t(version 20260206)\n\t(generator "wbx_explorer")\n\t(generator_version "10.0")\n\t(general\n\t\t(thickness 0.8)\n\t\t(legacy_teardrops no)\n\t)\n\t(paper "A4")\n\t(layers\n${rows.join('\n')}\n\t)\n\t(setup\n\t\t(pad_to_mask_clearance 0)\n\t)\n${withAt})\n\t(gr_rect (start ${n(x0 + ox)} ${n(y0 + oy)}) (end ${n(x1 + ox)} ${n(y1 + oy)}) (stroke (width 0.05) (type solid)) (fill no) (layer "Edge.Cuts") ${uu('edge')})\n\t(embedded_fonts no)\n)\n`;
    return text;
  }

  function assemble(S, opts) {
    opts = opts || {};
    const sub = S.substrate, die = S.die, files = {}, notes = [];
    const fromMod = sub.board.kind === 'footprint';
    const ox = fromMod ? 100 : 0, oy = fromMod ? 100 : 0;
    let text = fromMod ? boardFromFootprint(S, ox, oy) : sub.text;
    let removed = 0;
    if (!fromMod) {
      // Regenerating replaces what an earlier run wrote, and a die or wire that came in with the board.
      const gen = sub.board.fps.filter(f => f.wbKind === 'die' || f.wbKind === 'wire' || f.wbKind === 'type_library').sort((a, b) => b.s - a.s);
      for (const f of gen) { text = text.slice(0, f.s).replace(/\s+$/, '') + '\n\t' + text.slice(f.e).replace(/^\s+/, ''); removed++; }
    }
    const layer = pickWireLayer(text, sub.board);
    if (fromMod || !layer.inTable) {
      // KiCad won't load a board whose layer table doesn't start with F.Cu, so a new row goes last
      const table = text.search(/\(layers\b/);
      let depth = 0, end = table;
      for (; end < text.length; end++) { if (text[end] === '(') depth++; else if (text[end] === ')' && --depth === 0) break; }
      text = text.slice(0, end).replace(/\s+$/, '') + `\n\t\t(${LAYER_IDS[layer.name]} ${q(layer.name)} user "Wirebond")\n\t` + text.slice(end);
    }
    const ring = sub.selectedRef || 'L';
    const fps = [], attr = '(attr board_only exclude_from_pos_files exclude_from_bom)';
    /* One footprint per die, named by its reference, which is what the wires call it. The first keeps the keys a single die
       always had, so a one-die board writes the same bytes as before. A die off the board says what it sits on. */
    const dies = M.placedDies(S), first = dies[0];
    for (const d of dies) {
      const die = d.die, P = d.place, key = d === first ? 'die' : 'die/' + d.id, model = d === first ? 'die' : 'die_' + safe(d.id);
      const name = safe(die.name), art = artForKicad(die.artCanvas, opts.artPx || 1024);
      const rotArt = art && Math.abs(P.rot % 360) > 1e-6;
      if (rotArt) notes.push(`The ${dies.length > 1 ? d.id + ' ' : ''}die artwork was left out of the board because the die is rotated. KiCad doesn't turn a footprint's image with it. The 3D model still shows it.`);
      const y = die.y0 - 0.3, sup = M.dieSupport(S, d), on = sup ? sup.id : P.on === 'custom' ? 'custom' : 'board';
      const stack = on === 'board' ? '' : `${hiddenProp(key, 'wb_sits_on', on, 'F.Fab')}\n${hiddenProp(key, 'wb_bottom_um', +M.dieBottom(S, d).toFixed(3), 'F.Fab')}\n`;
      fps.push(`\t(footprint ${q(name)}\n\t\t(layer "F.Cu") ${uu(key)} (at ${n(P.x + ox)} ${n(P.y + oy)} ${n(P.rot)})
\t\t(property "Reference" ${q(d.id)} (at 0 ${n(y)} ${n(P.rot)}) (layer "F.Fab") ${uu(key + '/r')} (effects (font (size 0.3 0.3) (thickness 0.05))))
\t\t(property "Value" ${q(name)} (at 0 ${n(die.y1 + 0.3)} ${n(P.rot)}) (layer "F.Fab") ${uu(key + '/v')} (effects (font (size 0.3 0.3) (thickness 0.05))))
${hiddenProp(key, 'wb_kind', 'die', 'F.Fab')}
${hiddenProp(key, 'wb_thickness_um', P.thick, 'F.Fab')}
${hiddenProp(key, 'wb_attach_um', P.attach, 'F.Fab')}
${stack}\t\t${attr}
${dieItems(die, key, P.rot, rotArt ? null : art, [P.x + ox, P.y + oy]).join('\n')}
\t\t(model "\${KIPRJMOD}/3d/${model}.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
\t)`);
      const base = M.dieBase(S, d);
      files[`3d/${model}.wrl`] = dieWrl(die, P.thick, M.dieBottom(S, d) - base, base);
    }
    const rows = [];
    S.wires.forEach((w, i) => {
      const e = M.wireEnds(S, w);
      if (!e) return;
      const prof = M.wireProfile(S, w, e), T = prof.type, wn = 'W' + String(i + 1).padStart(2, '0');
      const ux = (e.b[0] - e.a[0]) / (e.len || 1), uy = (e.b[1] - e.a[1]) / (e.len || 1);
      // The wire's own frame starts at the die pad. A reverse loop is drawn from the land, so it is mirrored along the span.
      // A generic or undefined wire has no loop to model, so its curve is the shared stand-in path, as a thin neutral tube of nominal size.
      const path = prof.curve.map(p => {
        const s = prof.reverse ? prof.span - p[0] : p[0];
        return [ux * s, -uy * s, p[1]];
      });
      files[`3d/${wn}.wrl`] = prof.choice ? tube(path, M.CHOICE_TUBE_UM, hexToVrml(T.colour), NEUTRAL_SHINE) : tube(path, T.d, hexToVrml(T.colour));
      // A wire between two die names the far pad as "die.pad" and says so in wb_to_kind, which a wire to a land doesn't carry.
      const net = (e.land ? e.land.net : e.toPad.net) || e.pad.net || '';
      const to = !e.land ? e.toDie.id + '.' + e.toPad.num : String(e.land.id).includes('.') ? e.land.id : `${e.land.ref || ring}.${e.land.id}`;
      const toKind = e.land ? '' : `\n${hiddenProp(wn, 'wb_to_kind', 'die', layer.name)}`;
      const owner = wn;
      fps.push(`\t(footprint "wbx_wire"\n\t\t(layer "F.Cu") ${uu(owner)} (at ${n(e.a[0] + ox)} ${n(e.a[1] + oy)})
\t\t(property "Reference" ${q(wn)} (at 0 -0.1 0) (layer ${q(layer.name)}) (hide yes) ${uu(owner + '/r')} (effects (font (size 0.1 0.1) (thickness 0.01))))
\t\t(property "Value" ${q(T.name)} (at 0 0.1 0) (layer ${q(layer.name)}) (hide yes) ${uu(owner + '/v')} (effects (font (size 0.1 0.1) (thickness 0.01))))
${hiddenProp(owner, 'wb_kind', 'wire', layer.name)}
${hiddenProp(owner, 'wb_from', e.die.id + '.' + e.pad.num, layer.name)}
${hiddenProp(owner, 'wb_to', to, layer.name)}${toKind}
${hiddenProp(owner, 'wb_type', T.name, layer.name)}
${hiddenProp(owner, 'wb_net', net, layer.name)}
${hiddenProp(owner, 'wb_seq', i + 1, layer.name)}
\t\t${attr}
\t\t(fp_line (start 0 0) (end ${n(e.b[0] - e.a[0])} ${n(e.b[1] - e.a[1])}) (stroke (width ${n(T.d / 1000)}) (type ${prof.dashed ? 'dash' : 'solid'})) (layer ${q(layer.name)}) ${uu(owner + '/l')})
\t\t(model "\${KIPRJMOD}/3d/${wn}.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
\t)`);
      rows.push({ wn, w, e, prof, net, to, seq: i + 1 });
    });
    // Generic and undefined have no spec to list, so each field is plain words, and only when a wire uses that type.
    const usedTypes = S.types.filter(t => !M.isBonderChoice(t));
    const stand = `the 3D model is a ${M.CHOICE_TUBE_UM} um visual stand-in, not a wire size or loop`;
    const choiceFields = [];
    if (rows.some(r => r.prof.generic)) choiceFields.push(hiddenProp('wblib', 'wb_type_' + M.GENERIC, `generic: bonder's choice, chosen on purpose; the wire and loop are picked at the machine; ${stand}`, layer.name));
    if (rows.some(r => r.prof.dashed)) choiceFields.push(hiddenProp('wblib', 'wb_type_' + M.UNDEFINED, `not specified: no wire or loop given; ${stand}`, layer.name));
    fps.push(`\t(footprint "wbx_wire_types"\n\t\t(layer "F.Cu") ${uu('wblib')} (at ${n(first.place.x + ox)} ${n(first.place.y + oy)})
\t\t(property "Reference" "WBLIB" (at 0 -0.1 0) (layer ${q(layer.name)}) (hide yes) ${uu('wblib/r')} (effects (font (size 0.1 0.1) (thickness 0.01))))
\t\t(property "Value" "wire types" (at 0 0.1 0) (layer ${q(layer.name)}) (hide yes) ${uu('wblib/v')} (effects (font (size 0.1 0.1) (thickness 0.01))))
${hiddenProp('wblib', 'wb_kind', 'type_library', layer.name)}
${usedTypes.map(t => hiddenProp('wblib', 'wb_type_' + t.name, `${t.style} ${t.material} ${t.d} ${t.dir} ${t.moves}`, layer.name)).concat(choiceFields).join('\n')}
\t\t${attr}
\t)`);
    const k = text.trimEnd().lastIndexOf(')');
    const tail = text.slice(k);
    // keep the board's closing embedded_fonts token last, where KiCad writes it
    const ef = text.slice(0, k).search(/\(embedded_fonts\s+\w+\)\s*$/);
    const at = ef >= 0 ? ef : k;
    text = text.slice(0, at).replace(/\s+$/, '') + '\n' + fps.join('\n') + '\n\t' + text.slice(at);
    files['assembly.kicad_pcb'] = text;
    return { files, notes, rows, layer: layer.name, removed, ox, oy };
  }

  /* With one die, the columns are as they always were. With several, from and to name the die ("D2.7"), and two more
     columns say what the far end is and which die the coordinates are measured from: the first die's centre. */
  function bondlist(S) {
    const dies = M.placedDies(S), many = dies.length > 1;
    const [cx, cy] = M.dieToBoard(dies[0].place, ...M.dieCentre(dies[0].die));
    const out = ['seq,wire,net,from,to,x1_um,y1_um,z1_um,x2_um,y2_um,z2_um,type,length_um,peak_um' + (many ? ',to_kind,origin' : '')];
    const csv = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    S.wires.forEach((w, i) => {
      const e = M.wireEnds(S, w);
      if (!e) return;
      const p = M.wireProfile(S, w, e);
      const X = v => ((v - cx) * 1000).toFixed(3), Y = v => ((cy - v) * 1000).toFixed(3);
      const first = p.reverse ? e.b : e.a, second = p.reverse ? e.a : e.b;
      const from = many ? e.die.id + '.' + e.pad.num : 'die.' + e.pad.num, to = e.land ? e.land.id : e.toDie.id + '.' + e.toPad.num;
      const row = [i + 1, 'W' + String(i + 1).padStart(2, '0'), (e.land ? e.land.net : e.toPad.net) || e.pad.net || '', from, to, X(first[0]), Y(first[1]), p.reverse ? p.zEnd : p.zTop, X(second[0]), Y(second[1]), p.reverse ? p.zTop : p.zEnd, p.type.name, p.span.toFixed(1), p.choice ? '' : p.peak.toFixed(1)];
      if (many) row.push(e.land ? 'land' : 'die', dies[0].id);
      out.push(row.map(csv).join(','));
    });
    return out.join('\r\n') + '\r\n';
  }

  /* ---- wirebond.svg ----
     The drawing SPEC.md describes: one SVG unit is 1 um, y down, and every wb:kind element is drawn. The board is cropped to
     the bond area and shifted so it starts near 0. Each die group flips y, so its pads read as GDS numbers measured from
     the die's lower-left corner. Shapes with no wb:kind (artwork, balls, labels, the side view's loops) are decoration. */
  const SVGNS = 'http://www.w3.org/2000/svg', WBNS = 'urn:wbx:0.1', INKNS = 'http://www.inkscape.org/namespaces/inkscape';
  const um = v => n(Math.round(v * 1000) / 1000);
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Type colours are picked for the app's dark canvas, so the drawing darkens them to read on white.
  const deep = hex => { const m = String(hex).match(/^#(..)(..)(..)$/); return m ? '#' + [m[1], m[2], m[3]].map(v => Math.round(parseInt(v, 16) * 0.72).toString(16).padStart(2, '0')).join('') : '#8a6a1c'; };
  const CHOICE_INK = '#7d8a87';

  function wbSvg(S, opts) {
    opts = opts || {};
    const R = W.WBX.rules, rot = W.WBX.kicad.rot;
    const dies = M.stackOrder(S), first = M.placedDies(S)[0], ring = (S.substrate && S.substrate.selectedRef) || 'L';
    const design = opts.design || (S.substrate ? S.substrate.fileName.replace(/\.[^.]+$/, '') : first.die.name);
    const landName = l => String(l.id).includes('.') ? String(l.id) : `${l.ref || ring}.${l.id}`;

    const wires = [];
    S.wires.forEach((w, i) => { const e = M.wireEnds(S, w); if (e) wires.push({ w, e, prof: M.wireProfile(S, w, e), wn: 'W' + String(i + 1).padStart(2, '0'), seq: i + 1 }); });

    // The crop: every die, land, the paddle and both ends of every wire, with a margin.
    const X = [], Y = [];
    const box = (x, y, w, h) => { const r = Math.hypot(w, h) / 2; X.push(x - r, x + r); Y.push(y - r, y + r); };
    for (const d of dies) for (const [x, y] of M.dieCorners(d)) { X.push(x); Y.push(y); }
    for (const l of S.lands) box(l.x, l.y, l.w, l.h);
    if (S.paddle) box(S.paddle.x, S.paddle.y, S.paddle.w, S.paddle.h);
    for (const r of wires) { X.push(r.e.a[0], r.e.b[0]); Y.push(r.e.a[1], r.e.b[1]); }
    const span0 = Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y), 0.5), mg = Math.max(0.2, 0.06 * span0);
    const ox = Math.floor((Math.min(...X) - mg) * 10) * 100, oy = Math.floor((Math.min(...Y) - mg) * 10) * 100;
    const PW = Math.ceil((Math.max(...X) + mg) * 10) * 100 - ox, PH = Math.ceil((Math.max(...Y) + mg) * 10) * 100 - oy;
    const px = v => um(v * 1000 - ox), py = v => um(v * 1000 - oy);
    const U = Math.max(PW, PH) / 100;  // one text unit, so the lettering scales with the drawing
    const fs = { h: 2.6 * U, t: 1.8 * U, s: 1.4 * U };

    const o = [];
    const layer = (label, attrs) => `<g inkscape:groupmode="layer" inkscape:label="${xe(label)}"${attrs ? ' ' + attrs : ''}>`;
    let right = PW;  // the widest any text reaches, from an average glyph width, so the view box holds it
    const text = (x, y, cls, s, extra) => {
      if (fs[cls]) right = Math.max(right, x + String(s).length * fs[cls] * 0.56);
      return `<text x="${um(x)}" y="${um(y)}" class="${cls}"${extra ? ' ' + extra : ''}>${xe(s)}</text>`;
    };
    const title = s => `<title>${xe(s)}</title>`;

    o.push(text(0, -1.4 * U, 'h', `${design}: top view (1 unit = 1 µm, true scale)`));
    o.push(`<rect x="0" y="0" width="${um(PW)}" height="${um(PH)}" class="sub"/>`);

    // substrate: lands and the paddle
    o.push(layer('substrate'));
    if (S.paddle) {
      const p = S.paddle;
      o.push(`<rect x="${px(p.x - p.w / 2)}" y="${py(p.y - p.h / 2)}" width="${um(p.w * 1000)}" height="${um(p.h * 1000)}"${p.rot ? ` transform="rotate(${n(-p.rot)} ${px(p.x)} ${py(p.y)})"` : ''} class="cu paddle">${title('Die paddle ' + (p.ref || '') + ' ' + (p.num || ''))}</rect>`);
    }
    for (const l of S.lands) {
      const rx = l.shape === 'circle' || l.shape === 'oval' ? Math.min(l.w, l.h) / 2 : l.shape === 'roundrect' ? Math.min(l.w, l.h) * (l.rr || 0.25) : 0;
      o.push(`<rect x="${px(l.x - l.w / 2)}" y="${py(l.y - l.h / 2)}" width="${um(l.w * 1000)}" height="${um(l.h * 1000)}"${rx ? ` rx="${um(rx * 1000)}"` : ''}${l.rot ? ` transform="rotate(${n(-l.rot)} ${px(l.x)} ${py(l.y)})"` : ''} class="cu" wb:kind="land" wb:name="${xe(landName(l))}"${l.net ? ` wb:net="${xe(l.net)}"` : ''}>${title(`${landName(l)}${l.net ? ' net ' + l.net : ', no net'}`)}</rect>`);
    }
    o.push('</g>');

    // dies, lowest first, each with its artwork under it
    for (const d of dies) {
      const die = d.die, P = d.place, Wd = (die.x1 - die.x0) * 1000, Hd = (die.y1 - die.y0) * 1000;
      const turn = P.rot % 360 ? ` rotate(${n(-P.rot)})` : '';
      if (die.artCanvas && opts.art !== false) {
        const art = artForKicad(die.artCanvas, opts.artPx || 1024);
        o.push(`<g transform="translate(${px(P.x)} ${py(P.y)})${turn}">${title(die.name + ' artwork')}<image x="${um(die.x0 * 1000)}" y="${um(die.y0 * 1000)}" width="${um(Wd)}" height="${um(Hd)}" preserveAspectRatio="none" href="data:image/png;base64,${art.lines.map(s => s.slice(1, -1)).join('')}"/></g>`);
      }
      const [tx, ty] = rot(die.x0, die.y1, P.rot);
      const info = die.info || {};
      const sup = M.dieSupport(S, d);
      o.push(layer('die ' + d.id, `transform="translate(${px(P.x + tx)} ${py(P.y + ty)})${turn} scale(1 -1)" wb:kind="die" wb:name="${xe(d.id)}"${die.source === 'gds' && info.cell ? ` wb:gds-cell="${xe(info.cell)}"` : ''}${info.padLayer ? ` wb:pad-layer="${xe(info.padLayer)}"` : ''}`));
      o.push(`<rect x="0" y="0" width="${um(Wd)}" height="${um(Hd)}" class="die${die.artCanvas && opts.art !== false ? ' art' : ''}" wb:kind="outline">${title(`${d.id}: ${die.name}, ${n(Wd / 1000)} × ${n(Hd / 1000)} mm${sup ? ', on ' + sup.id : ''}`)}</rect>`);
      for (const p of die.pads) {
        o.push(`<rect x="${um((p.x - p.w / 2 - die.x0) * 1000)}" y="${um((die.y1 - p.y - p.h / 2) * 1000)}" width="${um(p.w * 1000)}" height="${um(p.h * 1000)}" class="pad" wb:kind="pad" wb:name="${xe(p.num)}"${p.net ? ` wb:net="${xe(p.net)}"` : ''}>${title(`${d.id} pad ${p.num}${p.net ? ' net ' + p.net : ''}`)}</rect>`);
      }
      o.push('</g>');
    }

    // wires, then the balls and land labels drawn from them
    const ink = T => M.isBonderChoice(T) ? CHOICE_INK : deep(T.colour);
    const widthOf = r => r.prof.choice ? M.CHOICE_TUBE_UM : r.prof.type.d;
    o.push(layer('wires'));
    for (const r of wires) {
      const { e, prof } = r, T = prof.type, net = (e.land ? e.land.net : e.toPad.net) || e.pad.net || '';
      const to = e.land ? landName(e.land) : e.toDie.id + '.' + e.toPad.num;
      const what = prof.choice ? M.typeLabel(T.name) : `${T.material} ${T.d} µm ${T.style}, ${T.name}`;
      o.push(`<line x1="${px(e.a[0])}" y1="${py(e.a[1])}" x2="${px(e.b[0])}" y2="${py(e.b[1])}" stroke-width="${um(widthOf(r))}" stroke="${ink(T)}"${prof.dashed ? ` stroke-dasharray="${um(3 * M.CHOICE_TUBE_UM)} ${um(2 * M.CHOICE_TUBE_UM)}"` : ''} class="w" wb:kind="wire" wb:name="${r.wn}" wb:from="${xe(e.die.id + '.' + e.pad.num)}" wb:to="${xe(to)}"${e.land ? '' : ' wb:to-kind="die"'} wb:profile="${xe(T.name)}" wb:seq="${r.seq}"${net ? ` wb:net="${xe(net)}"` : ''}>${title(`${r.wn}${net ? ' ' + net : ''}: ${e.die.id}.${e.pad.num} to ${to}, ${what}, ${n(e.len)} mm, seq ${r.seq}`)}</line>`);
    }
    o.push('</g>', layer('bonds (derived)'));
    for (const r of wires) {
      if (r.prof.choice) continue;
      const at = r.prof.reverse ? r.e.b : r.e.a;
      o.push(`<circle cx="${px(at[0])}" cy="${py(at[1])}" r="${um(1.3 * r.prof.type.d)}" fill="${ink(r.prof.type)}"/>`);
    }
    o.push('</g>', layer('labels (derived)'));
    for (const l of S.lands) {
      if (!l.net) continue;
      const size = Math.min(1.2 * U, Math.min(l.w, l.h) * 1000 * 0.45);
      o.push(`<text x="${px(l.x)}" y="${um(l.y * 1000 - oy + size * 0.35)}" class="lab" font-size="${um(size)}" text-anchor="middle">${xe(l.net)}</text>`);
    }
    o.push('</g>');

    // Side view: z up is -y. Layers are true thickness; the loops are each wire seen from the front, as decoration.
    const sub = S.substrate && S.substrate.text && S.substrate.text.match(/\(general\s*\(thickness\s+([\d.]+)\)/);
    const subT = sub ? +sub[1] * 1000 : 800;  // what boardFromFootprint gives a footprint substrate
    const glob = R.on(S, 'globTop') ? +R.value(S, 'globTop') : 0;
    const peak = Math.max(0, ...dies.map(d => M.dieTop(S, d)), ...wires.map(r => r.prof.peak), glob);
    const Y0 = PH + 6 * U + peak;
    o.push(text(0, PH + 4 * U, 'h', 'Side view, looking along +y (true scale, z up)'));
    o.push(layer('stack', `transform="translate(0 ${um(Y0)})" wb:kind="stack"`));
    const lay = (name, role, x0, x1, z, t, extra, words) => `<rect x="${um(x0)}" y="${um(-(z + t))}" width="${um(x1 - x0)}" height="${um(t)}" class="L-${role}" wb:kind="layer" wb:name="${xe(name)}" wb:role="${role}"${extra || ''}>${title(words)}</rect>`;
    const layers = [{ name: 'SUB', role: 'substrate', z: -subT, t: subT, words: `Substrate, ${n(subT)} µm${sub ? '' : ' assumed'}` }];
    o.push(lay('SUB', 'substrate', 0, PW, -subT, subT, '', layers[0].words));
    for (const d of dies) {
      const xs = M.dieCorners(d).map(c => c[0] * 1000 - ox), x0 = Math.min(...xs), x1 = Math.max(...xs);
      const top = M.dieTop(S, d), bot = M.dieBottom(S, d), base = M.dieBase(S, d);
      if (bot - base > 0) {
        const words = `${d.id} attach, ${n(bot - base)} µm assumed`;
        o.push(lay(d.id + ' attach', 'attach', x0 - 10, x1 + 10, base, bot - base, '', words));
        layers.push({ name: d.id + ' attach', z: base, t: bot - base, words });
      }
      const words = `${d.id} die, ${n(top - bot)} µm assumed`;
      o.push(lay(d.id, 'die', x0, x1, bot, top - bot, '', words));
      layers.push({ name: d.id, z: bot, t: top - bot, words });
    }
    if (glob) {
      const xs = wires.flatMap(r => [r.e.a[0], r.e.b[0]]).concat(dies.flatMap(d => M.dieCorners(d).map(c => c[0]))).map(x => x * 1000 - ox);
      const x0 = Math.max(0, Math.min(...xs) - 200), x1 = Math.min(PW, Math.max(...xs) + 200), words = `Glob top, ${n(glob)} µm from the DRC rules`;
      o.push(lay('glob top', 'mold', x0, x1, 0, glob, '', words));
      layers.push({ name: 'glob top', z: 0, t: glob, words });
    }
    for (const r of wires) {
      const { e, prof } = r, ux = (e.b[0] - e.a[0]) / (e.len || 1);
      const pts = prof.curve.map(p => { const s = prof.reverse ? prof.span - p[0] : p[0]; return `${um(e.a[0] * 1000 - ox + ux * s)},${um(-p[1])}`; });
      o.push(`<polyline points="${pts.join(' ')}" class="w" stroke="${ink(prof.type)}" stroke-width="${um(widthOf(r))}"${prof.dashed ? ` stroke-dasharray="${um(3 * M.CHOICE_TUBE_UM)} ${um(2 * M.CHOICE_TUBE_UM)}"` : ''}/>`);
    }
    o.push('</g>');
    const bottom0 = Y0 + subT;

    // The right-hand column: loop profiles, stack, key.
    const used = S.types.filter(t => wires.some(r => r.prof.type === t));
    const spans = t => wires.filter(r => r.prof.type === t).map(r => r.prof.span).sort((a, b) => a - b);
    const refSpan = t => { const s = spans(t); return s.length ? Math.round(s[s.length >> 1] / 10) * 10 : 1000; };
    const refs = used.map(refSpan), maxRef = Math.max(1000, ...refs);
    const CX = PW + 8 * U, TX = CX + maxRef + 3 * U;
    let yy = 0;
    o.push(text(CX, -1.4 * U, 'h', 'Loop profiles (drawn at reference span)'));
    used.forEach((t, i) => {
      const ref = refs[i];
      if (M.isBonderChoice(t)) {
        const h = 2 * U;
        o.push(layer('profile ' + t.name, `transform="translate(${um(CX)} ${um(yy + h)})" wb:kind="profile" wb:name="${xe(t.name)}" wb:choice="${t.generic ? 'generic' : 'undefined'}"`));
        o.push(`<line x1="0" y1="0" x2="${um(ref)}" y2="0" class="w" stroke="${CHOICE_INK}" stroke-width="${M.CHOICE_TUBE_UM}"${t.generic ? '' : ` stroke-dasharray="${um(3 * M.CHOICE_TUBE_UM)} ${um(2 * M.CHOICE_TUBE_UM)}"`}>${title(M.typeLabel(t.name))}</line></g>`);
        o.push(text(TX, yy + U, 't', M.typeLabel(t.name)));
        o.push(text(TX, yy + 3 * U, 's', t.generic ? 'Chosen on purpose: wire and loop are picked at the bonder.' : 'Nobody has said: no wire or loop given.'));
        o.push(text(TX, yy + 4.8 * U, 's', `No size or loop: drawn ${M.CHOICE_TUBE_UM} µm wide, and loop checks skip it.`));
        yy += 8 * U;
        return;
      }
      const ctrl = M.loopPts(t.moves, ref, 0), curve = M.loopCurve(t, ref, 0);
      const top = Math.max(0, ...curve.map(p => p[1])), h = Math.max(top, 2 * U);
      o.push(layer('profile ' + t.name, `transform="translate(${um(CX)} ${um(yy + h)})" wb:kind="profile" wb:name="${xe(t.name)}" wb:material="${xe(t.material)}" wb:style="${xe(t.style)}" wb:dir="${xe(t.dir)}" wb:moves="${xe(t.moves)}" wb:interp="${xe(t.interp)}" wb:ref-span="${um(ref)}"`));
      o.push(`<polyline points="${ctrl.map(p => um(p[0]) + ',' + um(-p[1])).join(' ')}" class="w ctrl" stroke="${ink(t)}" stroke-width="${um(t.d)}">${title(`${t.name} moves ${t.moves}`)}</polyline>`);
      o.push(`<line x1="0" y1="0" x2="${um(ref)}" y2="0" class="base"/>`);
      if (t.interp !== 'polyline') o.push(`<polyline points="${curve.map(p => um(p[0]) + ',' + um(-p[1])).join(' ')}" class="w" stroke="${ink(t)}" stroke-width="${um(t.d)}"/>`);
      o.push('</g>');
      o.push(text(TX, yy + U, 't', `${t.name}: ${t.material} ${t.d} µm, ${t.style}`));
      o.push(text(TX, yy + 3 * U, 's', `${t.dir === 'reverse' ? 'reverse, first bond on the land' : 'forward, first bond on the die'}; moves ${t.moves}`));
      o.push(text(TX, yy + 4.8 * U, 's', `control points at ${n(ref)} µm span, ${t.interp} between them`));
      yy += Math.max(h, 5 * U) + 3 * U;
    });
    yy += 3 * U;
    o.push(text(CX, yy, 'h', 'Stack')); yy += 3 * U;
    for (const L of layers.slice().reverse()) { o.push(text(CX, yy, 't', `${L.words}, z ${n(L.z)} to ${n(L.z + L.t)}`)); yy += 2.4 * U; }
    yy += 3 * U;
    o.push(text(CX, yy, 'h', 'Key')); yy += 3 * U;
    for (const t of used) {
      const n_ = wires.filter(r => r.prof.type === t).length;
      o.push(`<line x1="${um(CX)}" y1="${um(yy - 0.5 * U)}" x2="${um(CX + 4 * U)}" y2="${um(yy - 0.5 * U)}" class="w" stroke="${ink(t)}" stroke-width="${um(0.6 * U)}"${M.isUndefinedType(t) ? ` stroke-dasharray="${um(U)} ${um(0.6 * U)}"` : ''}/>`);
      o.push(text(CX + 5.5 * U, yy, 't', `${M.typeLabel(t.name)}: ${n_} wire${n_ === 1 ? '' : 's'}`)); yy += 2.4 * U;
    }
    yy += 2 * U;
    const gap = R.on(S, 'wireGap') ? R.value(S, 'wireGap') : null, edge = R.on(S, 'edgeClear') ? R.value(S, 'edgeClear') : null;
    for (const s of [
      `${wires.length} wires on ${dies.length} die. Hover any wire, pad, land or layer for details.`,
      gap != null || edge != null ? `Rules: ${[gap != null && `wire gap ${n(gap)} µm`, edge != null && `die edge clearance ${n(edge)} µm`].filter(Boolean).join(', ')}.` : 'No wire gap or edge clearance rule set.',
      'Die thickness and attach are assumed. Written by Wire Bond Bench.',
    ]) { o.push(text(CX, yy, 's', s)); yy += 2.2 * U; }

    const VX = -2 * U, VY = -5 * U, VW = right + 2 * U - VX, VH = Math.max(bottom0, yy) + 3 * U - VY;
    const style = `text{font-family:Helvetica,Arial,sans-serif;fill:#222}.h{font-size:${um(fs.h)}px;font-weight:bold}.t{font-size:${um(fs.t)}px}.s{font-size:${um(fs.s)}px;fill:#555}`
      + '.sub{fill:#eef3ea;stroke:#9aa;stroke-width:4}.cu{fill:#d9a441}.paddle{fill-opacity:.5}.die{fill:#c9ccd6;stroke:#667;stroke-width:4}.die.art{fill:none}.pad{fill:#f7f7fa;fill-opacity:.85;stroke:#445;stroke-width:2}'
      + '.w{fill:none;stroke-linecap:round;stroke-linejoin:round}.ctrl{stroke-opacity:.35}.base{stroke:#bbb;stroke-width:4}.lab{fill:#333}'
      + '.L-substrate{fill:#eef3ea;stroke:#9aa;stroke-width:4}.L-attach{fill:#888}.L-die{fill:#c9ccd6;stroke:#667;stroke-width:4}.L-mold{fill:#7aa7c7;fill-opacity:.18;stroke:#7aa7c7;stroke-width:4;stroke-dasharray:30 20}';
    const rootAttrs = [`wb:version="0.1"`, `wb:units="um"`, `wb:design="${xe(design)}"`];
    if (gap != null) rootAttrs.push(`wb:rule-wire-gap="${n(gap)}"`);
    if (edge != null) rootAttrs.push(`wb:rule-edge-clear="${n(edge)}"`);
    const pxW = 1400;
    return `<?xml version='1.0' encoding='utf-8'?>
<svg xmlns="${SVGNS}" xmlns:wb="${WBNS}" xmlns:inkscape="${INKNS}" viewBox="${um(VX)} ${um(VY)} ${um(VW)} ${um(VH)}" width="${pxW}" height="${Math.round(pxW * VH / VW)}" ${rootAttrs.join(' ')}>
<title>Wire bond diagram: ${xe(design)}</title>
<style>${style}</style>
${o.join('\n')}
</svg>
`;
  }

  /* ---- zip, stored ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const [name, content] of Object.entries(files)) {
      const nb = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + data.length;
    }
    const cs = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    const count = Object.keys(files).length;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }

  W.WBX.export = { dieFootprintFile, dieWrl, symbolFile, assemble, bondlist, wbSvg, zip, safe };
})(window);
